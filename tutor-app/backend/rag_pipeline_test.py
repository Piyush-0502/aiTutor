import argparse
from pathlib import Path
from typing import Any, Dict, List

import chromadb
from chromadb.config import Settings
from dotenv import load_dotenv

from backend.retriever import embed_text, validate_subject


def _preview(text: str, n: int = 180) -> str:
    one_line = " ".join((text or "").split())
    return one_line[:n]


def _print_hits(title: str, result: Dict[str, List[Any]]) -> None:
    docs = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    dists = (result.get("distances") or [[]])[0]

    print(f"\n{title}: hits={len(docs)}")
    for i, doc in enumerate(docs, start=1):
        meta = metas[i - 1] if i - 1 < len(metas) else {}
        dist = dists[i - 1] if i - 1 < len(dists) else None
        dist_text = f"{dist:.4f}" if isinstance(dist, (int, float)) else "n/a"
        print(
            f"  {i}. distance={dist_text} "
            f"board={meta.get('board')} standard={meta.get('standard')} "
            f"subject={meta.get('subject')} source={meta.get('source')}"
        )
        print(f"     preview: {_preview(str(doc))}")


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG pipeline diagnostic for Chroma + Gemini embeddings")
    parser.add_argument("--subject", default="math", help="Subject collection to test (math/science/history)")
    parser.add_argument("--board", default="cbse", help="Board metadata filter")
    parser.add_argument("--standard", default="std-10", help="Standard metadata filter")
    parser.add_argument(
        "--query",
        default="explain pair of linear equations in two variables",
        help="Natural language query to test retrieval",
    )
    parser.add_argument("--top-k", type=int, default=4, help="Top k results")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")

    clean_subject = validate_subject(args.subject)
    chroma_dir = root / "chroma_db"
    client = chromadb.PersistentClient(
        path=str(chroma_dir),
        settings=Settings(anonymized_telemetry=False),
    )

    collection_name = f"subject_{clean_subject}"
    collection = client.get_or_create_collection(name=collection_name)

    print("=" * 72)
    print("RAG DIAGNOSTIC")
    print("=" * 72)
    print(f"chroma_dir: {chroma_dir}")
    print(f"collection: {collection_name}")
    print(f"total_chunks_in_collection: {collection.count()}")
    print(f"filters: board={args.board}, standard={args.standard}")
    print(f"query: {args.query}")

    where_filter = {
        "$and": [
            {"board": args.board.strip().lower()},
            {"standard": args.standard.strip().lower()},
        ]
    }

    try:
        query_embedding = embed_text(args.query, task_type="retrieval_query")
        print("\nembedding_check: OK")
        print(f"embedding_dimensions: {len(query_embedding)}")
    except Exception as exc:
        print("\nembedding_check: FAILED")
        print("reason:")
        print(exc)
        print("\nLikely cause: Gemini embedding quota/rate limit exceeded.")
        return

    try:
        scoped = collection.query(
            query_embeddings=[query_embedding],
            n_results=args.top_k,
            where=where_filter,
            include=["documents", "metadatas", "distances"],
        )
        _print_hits("scoped_query(board+standard)", scoped)
    except Exception as exc:
        print("\nscoped_query(board+standard): FAILED")
        print(exc)
        return

    try:
        semantic = collection.query(
            query_embeddings=[query_embedding],
            n_results=args.top_k,
            include=["documents", "metadatas", "distances"],
        )
        _print_hits("semantic_subject_only", semantic)
    except Exception as exc:
        print("\nsemantic_subject_only: FAILED")
        print(exc)
        return

    scoped_hits = len((scoped.get("documents") or [[]])[0])
    semantic_hits = len((semantic.get("documents") or [[]])[0])

    print("\n" + "=" * 72)
    if scoped_hits == 0 and semantic_hits == 0:
        print("RESULT: No retrieval hits.")
        print("Check if ingestion inserted chunks into this subject collection.")
    elif scoped_hits == 0 and semantic_hits > 0:
        print("RESULT: Semantic works, but board/standard filter is too strict or mismatched.")
        print("Verify student profile board/grade normalization and ingest metadata values.")
    else:
        print("RESULT: RAG retrieval path is working for this query.")
    print("=" * 72)


if __name__ == "__main__":
    main()
