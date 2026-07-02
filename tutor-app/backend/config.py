import os
from dataclasses import dataclass
from pathlib import Path
from typing import List

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")


def _parse_csv_env(name: str, default: List[str]) -> List[str]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return default
    values = [part.strip() for part in raw.split(",")]
    return [value for value in values if value]


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


@dataclass(frozen=True)
class AppConfig:
    allowed_origins: List[str]
    chat_model: str
    quiz_model: str
    embedding_model: str
    strict_syllabus: bool


def load_config() -> AppConfig:
    return AppConfig(
        allowed_origins=_parse_csv_env(
            "ALLOWED_ORIGINS",
            ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"],
        ),
        chat_model=os.getenv("CHAT_MODEL", "models/gemini-2.5-flash-lite").strip(),
        quiz_model=os.getenv("QUIZ_MODEL", "models/gemini-2.5-flash-lite").strip(),
        embedding_model=os.getenv("EMBEDDING_MODEL", "models/gemini-embedding-001").strip(),
        strict_syllabus=_parse_bool_env("STRICT_SYLLABUS_MODE", False),
    )


APP_CONFIG = load_config()