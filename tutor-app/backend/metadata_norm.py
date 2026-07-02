import re
from typing import Optional


def _clean_spaces(value: str) -> str:
    return " ".join(value.strip().lower().split())


def normalize_topic(value: Optional[str]) -> str:
    if not value:
        return "general"
    cleaned = re.sub(r"[^a-zA-Z0-9]+", " ", value).strip().lower()
    cleaned = " ".join(cleaned.split())
    return cleaned or "general"


def normalize_board(value: Optional[str]) -> str:
    if not value:
        return "general"
    raw = _clean_spaces(value)
    compact = raw.replace("-", " ")

    if "cbse" in compact or "central board" in compact:
        return "cbse"
    if "icse" in compact:
        return "icse"
    if "state" in compact:
        return "state"
    if compact in {"ib", "international baccalaureate"}:
        return "ib"
    if "cambridge" in compact:
        return "cambridge"

    return raw.replace(" ", "-")


def normalize_standard(value: Optional[str]) -> str:
    if not value:
        return "general"

    raw = _clean_spaces(value)

    # class 10 / class-10th / std10 / grade_10, etc.
    m = re.search(r"(?:std|standard|class|grade)?\s*[-_ ]*?(\d{1,2})(?:st|nd|rd|th)?", raw)
    if m:
        return f"std-{int(m.group(1))}"

    if re.fullmatch(r"\d{1,2}", raw):
        return f"std-{int(raw)}"

    return raw.replace(" ", "-")


def normalize_learner_profile(value: Optional[str]) -> str:
    if not value:
        return "general"
    raw = _clean_spaces(value)
    if raw in {"easy", "medium", "hard", "general"}:
        return raw

    # map class/grade style profile to standard profile token
    std = normalize_standard(raw)
    if std != "general":
        return std

    return raw.replace(" ", "-")
