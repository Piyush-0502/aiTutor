import json
import uuid
from pathlib import Path
from typing import Any, Dict, List

SUBJECTS = ["math", "science", "history"]
ROOT_DIR = Path(__file__).resolve().parents[1]
STUDENTS_FILE = ROOT_DIR / "students.json"


def _blank_profile() -> Dict[str, Any]:
    return {
        "grade": "",
        "school": "",
        "board": "",
        "target_exam": "",
        "preferred_language": "English",
        "study_hours_per_week": 0,
        "learning_style": "mixed",
        "guardian_name": "",
    }


def _blank_subject_stats() -> Dict[str, Dict[str, Any]]:
    return {
        subject: {
            "weak_topics": [],
            "quizzes_taken": 0,
        }
        for subject in SUBJECTS
    }


def _seed_default_student() -> Dict[str, Dict[str, Any]]:
    return {
        "student_001": {
            "id": "student_001",
            "name": "Alex",
            "level": "medium",
            "profile": _blank_profile(),
            "subject_stats": _blank_subject_stats(),
        }
    }


def ensure_students_file() -> None:
    if not STUDENTS_FILE.exists():
        STUDENTS_FILE.write_text(
            json.dumps(_seed_default_student(), indent=2),
            encoding="utf-8",
        )
        return

    students = load_students()
    changed = False

    if "student_001" not in students:
        students["student_001"] = _seed_default_student()["student_001"]
        changed = True

    for sid, profile in students.items():
        if "id" not in profile:
            profile["id"] = sid
            changed = True
        if "level" not in profile:
            profile["level"] = "medium"
            changed = True
        if "subject_stats" not in profile:
            profile["subject_stats"] = _blank_subject_stats()
            changed = True
        if "profile" not in profile or not isinstance(profile.get("profile"), dict):
            profile["profile"] = _blank_profile()
            changed = True

        for key, value in _blank_profile().items():
            if key not in profile["profile"]:
                profile["profile"][key] = value
                changed = True

        for subject in SUBJECTS:
            if subject not in profile["subject_stats"]:
                profile["subject_stats"][subject] = {
                    "weak_topics": [],
                    "quizzes_taken": 0,
                }
                changed = True

            profile["subject_stats"][subject].setdefault("weak_topics", [])
            profile["subject_stats"][subject].setdefault("quizzes_taken", 0)

    if changed:
        save_students(students)


def load_students() -> Dict[str, Dict[str, Any]]:
    if not STUDENTS_FILE.exists():
        return {}

    raw = STUDENTS_FILE.read_text(encoding="utf-8").strip()
    if not raw:
        return {}

    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
        return {}
    except json.JSONDecodeError:
        return {}


def save_students(students: Dict[str, Dict[str, Any]]) -> None:
    STUDENTS_FILE.write_text(json.dumps(students, indent=2), encoding="utf-8")


def create_student(name: str, level: str, details: Dict[str, Any] | None = None) -> Dict[str, Any]:
    ensure_students_file()
    students = load_students()
    sid = f"student_{uuid.uuid4().hex[:8]}"

    profile_details = _blank_profile()
    if details:
        for key in profile_details.keys():
            if key in details and details[key] is not None:
                profile_details[key] = details[key]

    profile = {
        "id": sid,
        "name": name.strip(),
        "level": level.lower().strip(),
        "profile": profile_details,
        "subject_stats": _blank_subject_stats(),
    }
    students[sid] = profile
    save_students(students)
    return profile


def get_student(student_id: str) -> Dict[str, Any]:
    ensure_students_file()
    students = load_students()
    student = students.get(student_id)
    if not student:
        raise KeyError(f"Student not found: {student_id}")
    return student


def get_weak_topics(student_id: str, subject: str) -> List[str]:
    student = get_student(student_id)
    stats = student.get("subject_stats", {}).get(subject, {})
    topics = stats.get("weak_topics", [])
    return topics if isinstance(topics, list) else []


def increment_quizzes_taken(student_id: str, subject: str) -> None:
    students = load_students()
    student = students.get(student_id)
    if not student:
        raise KeyError(f"Student not found: {student_id}")

    student.setdefault("subject_stats", _blank_subject_stats())
    student["subject_stats"].setdefault(subject, {"weak_topics": [], "quizzes_taken": 0})
    student["subject_stats"][subject]["quizzes_taken"] = (
        student["subject_stats"][subject].get("quizzes_taken", 0) + 1
    )
    save_students(students)


def add_weak_topics(student_id: str, subject: str, topics: List[str]) -> List[str]:
    students = load_students()
    student = students.get(student_id)
    if not student:
        raise KeyError(f"Student not found: {student_id}")

    student.setdefault("subject_stats", _blank_subject_stats())
    student["subject_stats"].setdefault(subject, {"weak_topics": [], "quizzes_taken": 0})

    existing = set(student["subject_stats"][subject].get("weak_topics", []))
    for topic in topics:
        cleaned = topic.strip()
        if cleaned:
            existing.add(cleaned)

    updated = sorted(existing)
    student["subject_stats"][subject]["weak_topics"] = updated
    save_students(students)
    return updated


def update_student(student_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    students = load_students()
    student = students.get(student_id)
    if not student:
        raise KeyError(f"Student not found: {student_id}")

    if "name" in payload and payload["name"] is not None:
        student["name"] = str(payload["name"]).strip() or student.get("name", "Student")

    if "level" in payload and payload["level"] is not None:
        student["level"] = str(payload["level"]).strip().lower() or student.get("level", "medium")

    incoming_profile = payload.get("profile") or {}
    if not isinstance(incoming_profile, dict):
        incoming_profile = {}

    student.setdefault("profile", _blank_profile())
    for key in _blank_profile().keys():
        if key in incoming_profile and incoming_profile[key] is not None:
            student["profile"][key] = incoming_profile[key]

    save_students(students)
    return student
