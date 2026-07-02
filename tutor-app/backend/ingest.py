import io
import json
import sys
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import fitz
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ENV_PATH)

try:
    from .retriever import SUBJECTS, add_chunks, validate_subject
except ImportError:
    from retriever import SUBJECTS, add_chunks, validate_subject

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


# ─────────────────────────────────────────────
#  Text helpers
# ─────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    chunks: List[str] = []
    start = 0
    while start < len(cleaned):
        end = start + chunk_size
        chunks.append(cleaned[start:end])
        if end >= len(cleaned):
            break
        start = max(0, end - overlap)
    return chunks


def extract_pdf_text(pdf_bytes: bytes) -> List[Tuple[int, str]]:
    page_texts: List[Tuple[int, str]] = []
    with fitz.open(stream=io.BytesIO(pdf_bytes), filetype="pdf") as doc:
        for idx, page in enumerate(doc, start=1):
            text = page.get_text("text")
            if text and text.strip():
                page_texts.append((idx, text.strip()))
    return page_texts


# ─────────────────────────────────────────────
#  Metadata inference
# ─────────────────────────────────────────────

def _infer_standard(raw: str) -> str:
    """
    Accepts: class10, class-10, class 10, class 10th, std10, std-10,
             grade10, grade-10, 10th, 10  →  std-10
    """
    return normalize_standard(raw)


def _infer_board(raw: str) -> str:
    return normalize_board(raw)


# Add this mapping at the top of ingest.py
SUBJECT_ALIASES = {
    "maths"   : "math",
    "biology" : "science",
    "physics" : "science",
    "chemistry": "science",
    "social"  : "history",
    "sst"     : "history",
}

def _infer_subject_from_path(file_path: Path) -> Optional[str]:
    parts = [p.strip().lower() for p in file_path.parts]
    for part in parts:
        if part in SUBJECTS:
            return part
        # check aliases
        if part in SUBJECT_ALIASES:
            return SUBJECT_ALIASES[part]
    return None
def _infer_metadata_from_path(file_path: Path) -> Dict[str, str]:
    """
    Expected structure:  docs / BOARD / STANDARD / SUBJECT / file.pdf
    board and standard come from folder names — subject is separate.
    """
    parts = [p.strip().lower() for p in file_path.parts]
    board    = "general"
    standard = "general"

    for idx, part in enumerate(parts):
        # board detection
        for known in ("cbse", "icse", "ib", "cambridge", "state"):
            if known in part:
                board = known
                break
        # standard detection — any part containing a digit after class/std/grade/or alone
        if re.search(r"(?:class|grade|std|standard)[\s_-]*\d{1,2}", part):
            standard = _infer_standard(part)
        elif re.fullmatch(r"\d{1,2}(?:th|st|nd|rd)?", part):
            standard = _infer_standard(part)

    return {
        "board": normalize_board(board),
        "standard": normalize_standard(standard),
    }


# ─────────────────────────────────────────────
#  Core ingest functions
# ─────────────────────────────────────────────

def ingest_pdf_bytes(
    subject        : str,
    filename       : str,
    pdf_bytes      : bytes,
    board          : str = "general",
    standard       : str = "general",
    source_path    : Optional[str] = None,
) -> Dict[str, int]:
    clean_subject = validate_subject(subject)

    # Override board/standard from path if available
    if source_path:
        path_meta = _infer_metadata_from_path(Path(source_path))
        if board    == "general": board    = path_meta.get("board",    "general")
        if standard == "general": standard = path_meta.get("standard", "general")

    # Normalize
    board = normalize_board(board)
    standard = normalize_standard(standard)

    pages = extract_pdf_text(pdf_bytes)

    all_chunks : List[str]         = []
    metadata   : List[Dict]        = []

    for page_number, page_text in pages:
        for chunk_index, chunk in enumerate(chunk_text(page_text)):
            all_chunks.append(chunk)
            metadata.append({
                "subject"    : clean_subject,
                "board"      : board,
                "standard"   : standard,
                "source"     : filename.strip().lower(),
                "source_file": filename.strip().lower(),
                "page"       : str(page_number),
                "chunk_index": str(chunk_index),
            })

    inserted = add_chunks(clean_subject, all_chunks, metadata)
    return {"pages": len(pages), "chunks": inserted}


def ingest_pdf_file(
    subject   : str,
    file_path : Path,
    board     : str = "general",
    standard  : str = "general",
) -> Dict[str, int]:
    return ingest_pdf_bytes(
        subject     = subject,
        filename    = file_path.name,
        pdf_bytes   = file_path.read_bytes(),
        board       = board,
        standard    = standard,
        source_path = str(file_path),
    )


# ─────────────────────────────────────────────
#  Bulk ingest helpers
# ─────────────────────────────────────────────

def _make_summary() -> Dict:
    return {
        "started_at"  : datetime.utcnow().isoformat() + "Z",
        "total_files" : 0,
        "total_pages" : 0,
        "total_chunks": 0,
        "errors"      : [],
    }


def _process_file(pdf: Path, summary: Dict, board: str = "general", standard: str = "general"):
    subject = _infer_subject_from_path(pdf)
    if not subject:
        summary["errors"].append({
            "file" : str(pdf),
            "error": "Cannot infer subject. Put PDF inside a folder named math/science/history.",
        })
        return

    try:
        meta = _infer_metadata_from_path(pdf)
        stats = ingest_pdf_file(
            subject,
            pdf,
            board=board,
            standard=standard,
        )
        summary["total_files"]  += 1
        summary["total_pages"]  += stats.get("pages",  0)
        summary["total_chunks"] += stats.get("chunks", 0)
        print(
            f"   ✅  {pdf.name}  →  {stats['chunks']} chunks  "
            f"(board={board}, std={standard}, subject={subject})"
        )
    except Exception as exc:
        summary["errors"].append({"file": str(pdf), "error": str(exc)})
        print(f"   ❌  {pdf.name}  →  {exc}")


def ingest_all_pdfs(docs_root: Path) -> Dict:
    summary = _make_summary()
    summary["docs_root"] = str(docs_root)
    pdfs = sorted(docs_root.rglob("*.pdf")) if docs_root.exists() else []
    print(f"\n📂  Found {len(pdfs)} PDFs under {docs_root}\n")
    for pdf in pdfs:
        meta = _infer_metadata_from_path(pdf)
        _process_file(pdf, summary, board=meta["board"], standard=meta["standard"])
    summary["finished_at"] = datetime.utcnow().isoformat() + "Z"
    return summary


# ─────────────────────────────────────────────
#  Interactive CLI
# ─────────────────────────────────────────────

def _divider():
    print("\n" + "─" * 50)


def _pick(prompt: str, options: List[str], allow_all: bool = True) -> Optional[str]:
    """
    Show numbered list, return chosen value or None for 'all'.
    """
    print(f"\n{prompt}")
    if allow_all:
        print("  0) All")
    for i, opt in enumerate(options, 1):
        print(f"  {i}) {opt}")

    while True:
        raw = input("\nEnter number: ").strip()
        if allow_all and raw == "0":
            return None            # means "all"
        if raw.isdigit():
            idx = int(raw)
            if 1 <= idx <= len(options):
                return options[idx - 1]
        print("  Invalid choice. Try again.")


def _list_subdirs(path: Path) -> List[str]:
    if not path.exists():
        return []
    return sorted(p.name for p in path.iterdir() if p.is_dir())


def _ingest_scope(docs_root: Path, board: Optional[str], standard: Optional[str]):
    """Ingest files matching board/standard scope (None = all)."""
    summary = _make_summary()

    # Build search root
    search_root = docs_root
    if board:
        search_root = docs_root / board
    if board and standard:
        search_root = docs_root / board / standard

    pdfs = sorted(search_root.rglob("*.pdf")) if search_root.exists() else []

    if not pdfs:
        print(f"\n⚠️  No PDFs found under {search_root}")
        return

    print(f"\n📂  {len(pdfs)} PDFs found. Starting ingestion...\n")

    for pdf in pdfs:
        meta = _infer_metadata_from_path(pdf)
        _process_file(pdf, summary,
                      board    = board    or meta["board"],
                      standard = standard or meta["standard"])

    summary["finished_at"] = datetime.utcnow().isoformat() + "Z"
    _print_summary(summary)


def _ingest_single_file(docs_root: Path):
    path_str = input("\nEnter full path to PDF file: ").strip()
    pdf = Path(path_str).expanduser().resolve()

    if not pdf.exists() or pdf.suffix.lower() != ".pdf":
        print(f"❌  File not found or not a PDF: {pdf}")
        return

    subject = _infer_subject_from_path(pdf)
    if not subject:
        print("\n⚠️  Could not auto-detect subject from path.")
        subject = _pick("Select subject:", SUBJECTS, allow_all=False)

    meta = _infer_metadata_from_path(pdf)

    print(f"\n📄  File    : {pdf.name}")
    print(f"   Subject  : {subject}")
    print(f"   Board    : {meta['board']}")
    print(f"   Standard : {meta['standard']}")

    confirm = input("\nProceed? (y/n): ").strip().lower()
    if confirm != "y":
        print("Cancelled.")
        return

    summary = _make_summary()
    _process_file(pdf, summary, board=meta["board"], standard=meta["standard"])
    summary["finished_at"] = datetime.utcnow().isoformat() + "Z"
    _print_summary(summary)


def _print_summary(summary: Dict):
    _divider()
    print(f"\n📊  Ingestion Summary")
    print(f"   Files   : {summary['total_files']}")
    print(f"   Pages   : {summary['total_pages']}")
    print(f"   Chunks  : {summary['total_chunks']}")
    if summary["errors"]:
        print(f"\n⚠️  Errors ({len(summary['errors'])}):")
        for err in summary["errors"]:
            print(f"   • {Path(err['file']).name}: {err['error']}")
    print()


def interactive_cli(docs_root: Path):
    print("\n" + "═" * 50)
    print("       📚  TutorFlow — PDF Ingestion CLI")
    print("═" * 50)

    while True:
        _divider()
        print("\nWhat do you want to ingest?")
        print("  1) All PDFs (everything under docs/)")
        print("  2) Select Board")
        print("  3) Single File")
        print("  4) Exit")

        choice = input("\nEnter choice: ").strip()

        # ── Option 1: All PDFs ──────────────────────────
        if choice == "1":
            print(f"\n⚠️  This will ingest ALL PDFs under {docs_root}")
            confirm = input("Confirm? (y/n): ").strip().lower()
            if confirm == "y":
                _ingest_scope(docs_root, board=None, standard=None)

        # ── Option 2: Select Board ──────────────────────
        elif choice == "2":
            boards = _list_subdirs(docs_root)
            if not boards:
                print(f"\n❌  No board folders found under {docs_root}")
                print("    Expected structure: docs/CBSE/class-10/science/file.pdf")
                continue

            board = _pick("Select Board:", boards)

            if board is None:
                # All boards — but still pick standard
                std_sets = set()
                for b in boards:
                    for s in _list_subdirs(docs_root / b):
                        std_sets.add(s)
                standards = sorted(std_sets)
            else:
                standards = _list_subdirs(docs_root / board)

            if not standards:
                # No standard subfolders — ingest whole board
                _ingest_scope(docs_root, board=board, standard=None)
                continue

            print(f"\nBoard: {board or 'All'}")
            standard = _pick("Select Standard:", standards)

            if standard is None:
                _ingest_scope(docs_root, board=board, standard=None)
            else:
                # Optionally filter by subject too
                if board:
                    subject_dirs = _list_subdirs(docs_root / board / standard)
                else:
                    subject_dirs = list(SUBJECTS)

                subject_dirs = [s for s in subject_dirs if s in SUBJECTS]

                if subject_dirs:
                    print(f"\nBoard: {board or 'All'} | Standard: {standard}")
                    subject_choice = _pick("Select Subject:", subject_dirs)

                    if subject_choice is None:
                        _ingest_scope(docs_root, board=board, standard=standard)
                    else:
                        # Ingest only specific subject folder
                        if board:
                            search = docs_root / board / standard / subject_choice
                        else:
                            search = docs_root
                        pdfs = sorted(search.rglob("*.pdf"))
                        print(f"\n📂  {len(pdfs)} PDFs found for {subject_choice}. Ingesting...\n")
                        summary = _make_summary()
                        for pdf in pdfs:
                            _process_file(pdf, summary, board=board or "general", standard=standard)
                        summary["finished_at"] = datetime.utcnow().isoformat() + "Z"
                        _print_summary(summary)
                else:
                    _ingest_scope(docs_root, board=board, standard=standard)

        # ── Option 3: Single File ───────────────────────
        elif choice == "3":
            _ingest_single_file(docs_root)

        # ── Option 4: Exit ──────────────────────────────
        elif choice == "4":
            print("\n👋  Exiting. Goodbye!\n")
            break

        else:
            print("  Invalid choice. Enter 1, 2, 3 or 4.")


# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────

def _default_docs_root() -> Path:
    return Path(__file__).resolve().parents[1] / "docs"


if __name__ == "__main__":
    root = _default_docs_root()
    if len(sys.argv) > 1:
        root = Path(sys.argv[1]).expanduser().resolve()

    # Non-interactive mode: pass --all flag to skip CLI
    if "--all" in sys.argv:
        report = ingest_all_pdfs(root)
        print(json.dumps(report, indent=2))
    else:
        interactive_cli(root)
