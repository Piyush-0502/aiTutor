import json
import os
import re
from typing import Any, Dict, List, Tuple

import google.generativeai as genai

try:
    from .config import APP_CONFIG
except ImportError:
    from config import APP_CONFIG


def _ensure_gemini_configured() -> None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    genai.configure(api_key=api_key)


def _extract_json(text: str) -> Dict[str, Any]:
    raw = text.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    code_block_match = re.search(r"```json\s*(\{[\s\S]*\})\s*```", raw, flags=re.IGNORECASE)
    if code_block_match:
        return json.loads(code_block_match.group(1))

    brace_match = re.search(r"(\{[\s\S]*\})", raw)
    if brace_match:
        return json.loads(brace_match.group(1))

    raise ValueError("Model response did not contain valid JSON")


def generate_quiz_with_context(
    subject: str,
    topic: str,
    board: str,
    standard: str,
    difficulty: str,
    n_questions: int,
    context_chunks: List[str],
    weak_topics: List[str],
    model: str = APP_CONFIG.quiz_model,
) -> Dict[str, Any]:
    _ensure_gemini_configured()

    context_text = "\n\n".join([f"Context {i + 1}:\n{chunk}" for i, chunk in enumerate(context_chunks)])
    weak_text = ", ".join(weak_topics) if weak_topics else "None"

    prompt = f"""
You are an expert tutor creating a quiz.

Rules:
- Use ONLY the provided context.
- Generate exactly {n_questions} multiple-choice questions.
- Subject: {subject}
- Topic: {topic}
- Board: {board}
- Standard: {standard}
- Difficulty: {difficulty}
- Student weak topics: {weak_text}
- Every question must have 4 options exactly.
- Questions must align with the specified board/standard syllabus scope.
- If context is insufficient for this board/standard/topic scope, do not invent external facts.
- Return STRICT JSON with this schema:
{{
  "questions": [
    {{
      "id": "q1",
      "topic": "{topic}",
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explanation": "..."
    }}
  ]
}}
- Answer must be exactly one of the strings in options.

Context:
{context_text}
""".strip()

    model_instance = genai.GenerativeModel(model)
    try:
        response = model_instance.generate_content(prompt)
        parsed = _extract_json(response.text)
    except Exception as exc:
        raise RuntimeError(f"Quiz generation failed: {exc}") from exc

    questions = parsed.get("questions", [])
    if not isinstance(questions, list) or not questions:
        raise ValueError("Quiz generation returned no questions")

    normalized_questions: List[Dict[str, Any]] = []
    for i, q in enumerate(questions[:n_questions], start=1):
        options = q.get("options", [])
        if not isinstance(options, list) or len(options) != 4:
            raise ValueError(f"Invalid options for question {i}")

        answer = str(q.get("answer", "")).strip()
        if answer not in options:
            upper = answer.upper()
            if upper in {"A", "B", "C", "D"}:
                idx = ord(upper) - ord("A")
                answer = options[idx]
            else:
                raise ValueError(f"Answer must be one of options for question {i}")

        normalized_questions.append(
            {
                "id": q.get("id", f"q{i}"),
                "topic": q.get("topic", topic),
                "question": q.get("question", "").strip(),
                "options": options,
                "answer": answer,
                "explanation": q.get("explanation", "").strip(),
            }
        )

    return {"questions": normalized_questions}


def evaluate_quiz(questions: List[Dict[str, Any]], answers: Any) -> Tuple[Dict[str, Any], List[str]]:
    total = len(questions)
    if total == 0:
        return {"score": 0, "total": 0, "percentage": 0, "results": []}, []

    correct_count = 0
    results = []
    weak_topics: List[str] = []

    for idx, q in enumerate(questions):
        qid = q.get("id", f"q{idx + 1}")
        correct_answer = q.get("answer")

        if isinstance(answers, dict):
            student_answer = answers.get(qid)
        elif isinstance(answers, list):
            student_answer = answers[idx] if idx < len(answers) else None
        else:
            student_answer = None

        is_correct = student_answer == correct_answer
        if is_correct:
            correct_count += 1
        else:
            topic = q.get("topic") or "General"
            weak_topics.append(topic)

        results.append(
            {
                "id": qid,
                "question": q.get("question"),
                "selected": student_answer,
                "correct": correct_answer,
                "is_correct": is_correct,
                "explanation": q.get("explanation", ""),
                "topic": q.get("topic", "General"),
            }
        )

    percentage = round((correct_count / total) * 100, 2)
    payload = {
        "score": correct_count,
        "total": total,
        "percentage": percentage,
        "results": results,
    }
    return payload, weak_topics
