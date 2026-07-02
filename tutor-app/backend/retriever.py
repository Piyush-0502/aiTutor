import os
from pathlib import Path
from typing import Dict, List, Optional

import chromadb
import google.generativeai as genai
from dotenv import load_dotenv
from chromadb.config import Settings
import logging

try:
    from .config import APP_CONFIG
except ImportError:
    from config import APP_CONFIG

try:
    from .metadata_norm import (
        normalize_board,
        normalize_standard,
    )
except ImportError:
    from metadata_norm import (
        normalize_board,
        normalize_standard,
    )

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

SUBJECTS = ["math", "science", "history"]
ROOT_DIR = Path(__file__).resolve().parents[1]
CHROMA_DIR = ROOT_DIR / "chroma_db"
CHROMA_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_RECOVERY_DIR = ROOT_DIR / "chroma_db_rebuilt"

# Silence telemetry warnings in local/dev environments.
os.environ.setdefault("ANONYMIZED_TELEMETRY", "FALSE")
os.environ.setdefault("CHROMA_TELEMETRY_ENABLED", "false")
logging.getLogger("chromadb.telemetry").setLevel(logging.CRITICAL)
logging.getLogger("chromadb.telemetry.product.posthog").setLevel(logging.CRITICAL)

def _make_client(path: Path):
    path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(
        path=str(path),
        settings=Settings(anonymized_telemetry=False),
    )


_client = _make_client(CHROMA_DIR)
_active_chroma_dir = CHROMA_DIR


def _rebuild_client() -> None:
    global _client
    global _active_chroma_dir
    _active_chroma_dir = CHROMA_RECOVERY_DIR
    _client = _make_client(_active_chroma_dir)


def _ensure_gemini_configured() -> None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    genai.configure(api_key=api_key)


def normalize_subject(subject: str) -> str:
    return subject.lower().strip()


def validate_subject(subject: str) -> str:
    clean = normalize_subject(subject)
    if clean not in SUBJECTS:
        raise ValueError(f"Unsupported subject '{subject}'. Allowed subjects: {', '.join(SUBJECTS)}")
    return clean


def _collection_name(subject: str) -> str:
    clean = validate_subject(subject)
    return f"subject_{clean}"


def _get_collection(subject: str):
    name = _collection_name(subject)
    try:
        return _client.get_or_create_collection(name=name)
    except KeyError as exc:
        if str(exc) != "'_type'":
            raise
        _rebuild_client()
        return _client.get_or_create_collection(name=name)


def embed_text(text: str, task_type: str) -> List[float]:
    _ensure_gemini_configured()
    response = genai.embed_content(
        model=APP_CONFIG.embedding_model,
        content=text,
        task_type=task_type,
    )
    embedding = response.get("embedding")
    if not embedding:
        raise RuntimeError("Embedding generation returned empty vector")
    return embedding


def add_chunks(subject: str, chunks: List[str], metadatas: List[Dict[str, str]]) -> int:
    if not chunks:
        return 0

    collection = _get_collection(subject)
    try:
        embeddings = [embed_text(chunk, task_type="retrieval_document") for chunk in chunks]
    except Exception as exc:
        raise RuntimeError(f"Embedding failed during ingestion: {exc}") from exc
    ids = [f"{normalize_subject(subject)}_{i}_{abs(hash(chunks[i]))}" for i in range(len(chunks))]

    collection.add(
        ids=ids,
        documents=chunks,
        metadatas=metadatas,
        embeddings=embeddings,
    )
    return len(chunks)


def _build_where_filter(
    board: Optional[str] = None,
    standard: Optional[str] = None,
    source: Optional[str] = None,
) -> Optional[Dict[str, object]]:
    clauses: List[Dict[str, str]] = []

    if board and board.strip():
        clauses.append({"board": normalize_board(board)})

    if standard and standard.strip():
        clauses.append({"standard": normalize_standard(standard)})

    if source and source.strip():
        clauses.append({"source": source.strip().lower()})

    if not clauses:
        return None

    if len(clauses) == 1:
        return clauses[0]

    return {"$and": clauses}


def retrieve_context(
    subject: str,
    query: str,
    top_k: int = 3,
    board: Optional[str] = None,
    standard: Optional[str] = None,
    source: Optional[str] = None,
) -> List[str]:
    """
    Try to retrieve context via embedding + similarity search.
    Returns empty list if retrieval fails (e.g., embeddings not available).
    """
    try:
        records = retrieve_context_records(
            subject=subject,
            query=query,
            top_k=top_k,
            board=board,
            standard=standard,
            source=source,
        )
        return [r["document"] for r in records]
    except Exception:
        return []


def retrieve_context_records(
    subject: str,
    query: str,
    top_k: int = 3,
    board: Optional[str] = None,
    standard: Optional[str] = None,
    source: Optional[str] = None,
) -> List[Dict[str, object]]:
    """Retrieve matched chunks with metadata and distance for debugging/traceability."""
    try:
        collection = _get_collection(subject)
        query_embedding = embed_text(query, task_type="retrieval_query")
        where_filter = _build_where_filter(
            board=board,
            standard=standard,
            source=source,
        )

        query_args: Dict[str, object] = {
            "query_embeddings": [query_embedding],
            "n_results": top_k,
            "include": ["documents", "metadatas", "distances"],
        }
        if where_filter:
            query_args["where"] = where_filter

        results = collection.query(**query_args)
        docs = (results.get("documents") or [[]])[0]
        metas = (results.get("metadatas") or [[]])[0]
        dists = (results.get("distances") or [[]])[0]

        out: List[Dict[str, object]] = []
        for idx, doc in enumerate(docs):
            out.append(
                {
                    "document": doc,
                    "metadata": metas[idx] if idx < len(metas) else {},
                    "distance": dists[idx] if idx < len(dists) else None,
                }
            )
        return out
    except Exception:
        return []
