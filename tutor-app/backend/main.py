import logging
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import google.generativeai as genai
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import APP_CONFIG
from .ingest import extract_pdf_text, ingest_pdf_bytes
from .quiz import evaluate_quiz, generate_quiz_with_context
from .retriever import SUBJECTS, retrieve_context, retrieve_context_records, validate_subject
from .student import (
    add_weak_topics,
    create_student,
    ensure_students_file,
    get_student,
    get_weak_topics,
    increment_quizzes_taken,
    update_student,
)

app = FastAPI(title="Personalized Tutor App", version="1.0.0")

allow_credentials = "*" not in APP_CONFIG.allowed_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=APP_CONFIG.allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tutor.rag")




def _ensure_gemini_configured() -> None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    genai.configure(api_key=api_key)


def _extract_upload_text(filename: str, payload: bytes) -> str:
    lower_name = filename.lower().strip()
    if lower_name.endswith(".pdf"):
        pages = extract_pdf_text(payload)
        return "\n\n".join(text for _, text in pages).strip()

    if lower_name.endswith((".txt", ".md", ".markdown", ".csv", ".html", ".htm")):
        try:
            return payload.decode("utf-8").strip()
        except UnicodeDecodeError:
            return payload.decode("latin-1", errors="ignore").strip()

    try:
        return payload.decode("utf-8").strip()
    except UnicodeDecodeError:
        return payload.decode("latin-1", errors="ignore").strip()


def _extract_json_payload(text: str) -> Dict[str, Any]:
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




class StudentCreateRequest(BaseModel):
    name: str
    level: str = Field(default="medium", pattern="^(easy|medium|hard)$")
    grade: Optional[str] = None
    school: Optional[str] = None
    board: Optional[str] = None
    target_exam: Optional[str] = None
    preferred_language: Optional[str] = None
    study_hours_per_week: Optional[int] = Field(default=None, ge=0, le=80)
    learning_style: Optional[str] = None
    guardian_name: Optional[str] = None


class StudentUpdateRequest(BaseModel):
    name: Optional[str] = None
    level: Optional[str] = Field(default=None, pattern="^(easy|medium|hard)$")
    profile: Optional[Dict[str, Any]] = None


class ChatRequest(BaseModel):
    student_id: str
    subject: str
    question: str
    topic: Optional[str] = None
    model: str = Field(default=APP_CONFIG.chat_model)


class QuizGenerateRequest(BaseModel):
    student_id: str
    subject: str
    topic: str
    difficulty: str = Field(default="medium", pattern="^(easy|medium|hard)$")
    n_questions: int = Field(default=5, ge=1, le=20)
    model: str = Field(default=APP_CONFIG.quiz_model)


class QuizEvaluateRequest(BaseModel):
    student_id: str
    subject: str
    questions: List[Dict[str, Any]]
    answers: Any


@app.post("/question-bank/generate")
async def generate_question_bank(
    files: Optional[List[UploadFile]] = File(default=None),
    subject: str = Form(...),
    query: Optional[str] = Form(default=None),
    topic: Optional[str] = Form(default=None),
    n_questions: int = Form(default=10),
    model: str = Form(default=APP_CONFIG.chat_model),
) -> Dict[str, Any]:
    try:
        clean_subject = validate_subject(subject)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    count = max(5, min(20, int(n_questions or 10)))
    prompt_text = " ".join(part for part in [query, topic] if part and str(part).strip()).strip()

    extracted_sections: List[str] = []
    source_files: List[str] = []

    for file in files or []:
        payload = await file.read()
        if not payload:
          continue
        text = _extract_upload_text(file.filename or "uploaded-file", payload)
        if text:
            source_files.append(file.filename or "uploaded-file")
            extracted_sections.append(f"File: {file.filename or 'uploaded-file'}\n{text}")

    if not extracted_sections and not prompt_text:
        raise HTTPException(status_code=400, detail="Provide a query/topic or upload at least one file")

    source_text = "\n\n".join(extracted_sections).strip()
    question_bank_topic = prompt_text or (topic or "the uploaded material").strip() or "the uploaded material"

    prompt = f"""
You are creating a clean study question bank.

Generate exactly {count} multiple-choice questions.

Requirements:
- Subject: {clean_subject}
- Topic or query: {question_bank_topic}
- Use the uploaded material if provided.
- If no uploaded material exists, base the bank on the topic/query.
- Keep the questions useful for revision and practice.
- Every question must have 4 options exactly.
- Return STRICT JSON only using this schema:
{{
  "title": "short bank title",
  "subject": "{clean_subject}",
  "topic": "{question_bank_topic}",
  "questions": [
    {{
      "id": "q1",
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explanation": "..."
    }}
  ]
}}
- Answer must exactly match one of the option strings.

Uploaded material:
{source_text if source_text else 'No file content provided.'}
""".strip()

    _ensure_gemini_configured()
    model_instance = genai.GenerativeModel(model)

    try:
        response = model_instance.generate_content(prompt)
        parsed = _extract_json_payload(str(getattr(response, "text", "") or ""))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Question bank generation failed: {exc}") from exc

    questions = parsed.get("questions", [])
    if not isinstance(questions, list) or not questions:
        raise HTTPException(status_code=500, detail="Question bank generation returned no questions")

    normalized_questions: List[Dict[str, Any]] = []
    for i, q in enumerate(questions[:count], start=1):
        options = q.get("options", [])
        if not isinstance(options, list) or len(options) != 4:
            raise HTTPException(status_code=500, detail=f"Invalid options for question {i}")

        answer = str(q.get("answer", "")).strip()
        if answer not in options:
            upper = answer.upper()
            if upper in {"A", "B", "C", "D"}:
                idx = ord(upper) - ord("A")
                answer = options[idx]
            else:
                raise HTTPException(status_code=500, detail=f"Answer must be one of options for question {i}")

        normalized_questions.append(
            {
                "id": q.get("id", f"q{i}"),
                "question": str(q.get("question", "")).strip(),
                "options": options,
                "answer": answer,
                "explanation": str(q.get("explanation", "")).strip(),
            }
        )

    title = str(parsed.get("title") or f"{clean_subject.title()} Question Bank").strip()

    return {
        "title": title,
        "subject": clean_subject,
        "topic": question_bank_topic,
        "model": model,
        "questions": normalized_questions,
        "source_files": source_files,
        "source_mode": "files" if source_files else "query",
        "count": len(normalized_questions),
    }


@app.post("/summarize")
async def summarize_files(
    files: List[UploadFile] = File(...),
    topic: Optional[str] = Form(default=None),
    model: str = Form(default=APP_CONFIG.chat_model),
) -> Dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one file")

    extracted_sections: List[str] = []
    source_files: List[str] = []

    for file in files:
        payload = await file.read()
        if not payload:
            continue
        text = _extract_upload_text(file.filename or "uploaded-file", payload)
        if text:
            source_files.append(file.filename or "uploaded-file")
            extracted_sections.append(f"File: {file.filename or 'uploaded-file'}\n{text}")

    if not extracted_sections:
        raise HTTPException(status_code=400, detail="No readable text found in the uploaded files")

    combined_text = "\n\n".join(extracted_sections)
    summary_topic = (topic or "the uploaded files").strip() or "the uploaded files"

    prompt = f"""
You are a concise study assistant.
Create one combined summary for {summary_topic}.

Requirements:
- Use simple, student-friendly language.
- Merge the files into one clean summary.
- Keep it short but useful.
- Include key points and important terms.
- Do not mention that this is a machine-generated summary.

Return plain text with short headings and bullet points when useful.

Input files:
{combined_text}
""".strip()

    _ensure_gemini_configured()
    model_instance = genai.GenerativeModel(model)

    try:
        response = model_instance.generate_content(prompt)
        summary_text = str(getattr(response, "text", "") or "").strip()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Summary generation failed: {exc}") from exc

    if not summary_text:
        raise HTTPException(status_code=500, detail="Summary generation returned empty output")

    return {
        "summary": summary_text,
        "topic": summary_topic,
        "model": model,
        "source_files": source_files,
    }


@app.on_event("startup")
def startup() -> None:
    ensure_students_file()


@app.get("/subjects")
def list_subjects() -> Dict[str, List[str]]:
    return {"subjects": SUBJECTS}




@app.post("/ingest/{subject}")
async def ingest_subject_pdf(
    subject: str,
    file: UploadFile = File(...),
    board: Optional[str] = None,
    standard: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        clean_subject = validate_subject(subject)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        stats = ingest_pdf_bytes(
            clean_subject,
            file.filename,
            payload,
            board=board,
            standard=standard,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {exc}") from exc

    return {
        "message": "PDF ingested successfully",
        "subject": clean_subject,
        "filename": file.filename,
        **stats,
    }


@app.post("/student/create")
def create_student_profile(req: StudentCreateRequest) -> Dict[str, Any]:
    try:
        details = {
            "grade": req.grade,
            "school": req.school,
            "board": req.board,
            "target_exam": req.target_exam,
            "preferred_language": req.preferred_language,
            "study_hours_per_week": req.study_hours_per_week,
            "learning_style": req.learning_style,
            "guardian_name": req.guardian_name,
        }
        profile = create_student(req.name, req.level, details=details)
        return profile
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to create student: {exc}") from exc


@app.get("/student/{student_id}")
def get_student_profile(student_id: str) -> Dict[str, Any]:
    try:
        return get_student(student_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to fetch student: {exc}") from exc


@app.put("/student/{student_id}")
def update_student_profile(student_id: str, req: StudentUpdateRequest) -> Dict[str, Any]:
    try:
        payload = req.model_dump(exclude_none=True)
        return update_student(student_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to update student: {exc}") from exc


@app.post("/chat")
def tutor_chat(req: ChatRequest) -> Dict[str, Any]:
    try:
        clean_subject = validate_subject(req.subject)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        student = get_student(req.student_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    profile = student.get("profile") or {}
    board = str(profile.get("board") or "general").strip().lower()
    standard = str(profile.get("grade") or "general").strip().lower()
    logger.info(
        "[RAG] chat_request student=%s subject=%s board=%s standard=%s question=%s",
        req.student_id,
        clean_subject,
        board,
        standard,
        req.question[:200],
    )

    query_text = " ".join(part for part in [req.topic, req.question] if part and str(part).strip()).strip()
    if not query_text:
        query_text = req.question

    records = retrieve_context_records(
        clean_subject,
        query_text,
        top_k=4,
        board=board,
        standard=standard,
    )
    logger.info(
        "[RAG] attempt=syllabus-board-std filters={board:%s, standard:%s} hits=%d",
        board or "",
        standard or "",
        len(records),
    )

    used_fallback = False
    if not records:
        records = retrieve_context_records(
            clean_subject,
            query_text,
            top_k=4,
            board=None,
            standard=None,
        )
        used_fallback = True
        logger.info(
            "[RAG] attempt=semantic-subject-only filters={board:, standard:} hits=%d",
            len(records),
        )

    chunks = [r.get("document", "") for r in records if r.get("document")]

    if records:
        for idx, rec in enumerate(records, start=1):
            meta = rec.get("metadata") or {}
            distance = rec.get("distance")
            chunk = str(rec.get("document") or "")
            logger.info(
                "[RAG] chunk_%d distance=%s metadata=%s preview=%s",
                idx,
                f"{distance:.4f}" if isinstance(distance, (int, float)) else "n/a",
                {
                    "source": meta.get("source"),
                    "board": meta.get("board"),
                    "standard": meta.get("standard"),
                    "subject": meta.get("subject"),
                    "page": meta.get("page"),
                },
                chunk[:220].replace("\n", " "),
            )

    level = student.get("level", "medium")
    weak_topics = get_weak_topics(req.student_id, clean_subject)
    weak_text = ", ".join(weak_topics) if weak_topics else "None"
    context_text = "\n\n".join([f"Context {i + 1}:\n{c}" for i, c in enumerate(chunks)])

    if APP_CONFIG.strict_syllabus:
        context_policy = "- If context is limited or missing, answer conservatively and mention that syllabus context was not found."
    else:
        context_policy = "- If context is limited or missing, provide a general answer about the topic."

    system_prompt = f"""
You are a friendly personalized tutor.
Student name: {student.get('name', 'Student')}
Student level: {level}
Subject: {clean_subject}
Weak topics to reinforce: {weak_text}

Instructions:
- Explain clearly in an encouraging, tutor-like tone.
- Match explanation depth to student level.
- Use examples when useful.
{context_policy}

Context:
{context_text}
""".strip()

    _ensure_gemini_configured()
    model = genai.GenerativeModel(req.model)

    logger.info("[RAG] sending_to_llm model=%s context_chunks=%d", req.model, len(chunks))

    try:
        response = model.generate_content(f"{system_prompt}\n\nStudent question: {req.question}")
        answer = str(getattr(response, "text", "") or "").strip()
        logger.info("[RAG] llm_response preview=%s", answer[:280].replace("\n", " "))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Tutor response generation failed: {exc}") from exc

    return {
        "answer": answer,
        "subject": clean_subject,
        "context_used": chunks,
        **({"warning": "No relevant syllabus found. Using general subject context."} if used_fallback else {}),
    }


@app.post("/quiz/generate")
def quiz_generate(req: QuizGenerateRequest) -> Dict[str, Any]:
    try:
        clean_subject = validate_subject(req.subject)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        student = get_student(req.student_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    profile = student.get("profile") or {}
    board = str(profile.get("board") or "general").strip().lower()
    standard = str(profile.get("grade") or "general").strip().lower()

    context_query = f"{req.topic} {req.difficulty}"
    chunks = retrieve_context(
        clean_subject,
        context_query,
        top_k=5,
        board=board,
        standard=standard,
    )

    used_fallback = False
    if not chunks:
        chunks = retrieve_context(
            clean_subject,
            context_query,
            top_k=5,
            board=None,
            standard=None,
        )
        used_fallback = bool(chunks)

    if not chunks:
        raise HTTPException(
            status_code=400,
            detail=(
                "No relevant syllabus found for this subject. "
                "Upload the matching board/std/subject PDF first."
            ),
        )

    weak_topics = get_weak_topics(req.student_id, clean_subject)

    try:
        quiz_payload = generate_quiz_with_context(
            subject=clean_subject,
            topic=req.topic,
            board=board,
            standard=standard,
            difficulty=req.difficulty,
            n_questions=req.n_questions,
            context_chunks=chunks,
            weak_topics=weak_topics,
            model=req.model,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Quiz generation failed: {exc}") from exc

    return {
        "subject": clean_subject,
        "topic": req.topic,
        "difficulty": req.difficulty,
        **({"warning": "No relevant syllabus found. Using general subject context."} if used_fallback else {}),
        **quiz_payload,
    }


@app.post("/quiz/evaluate")
def quiz_evaluate(req: QuizEvaluateRequest) -> Dict[str, Any]:
    try:
        clean_subject = validate_subject(req.subject)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        get_student(req.student_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        evaluation, wrong_topics = evaluate_quiz(req.questions, req.answers)
        increment_quizzes_taken(req.student_id, clean_subject)
        updated_weak_topics = add_weak_topics(req.student_id, clean_subject, wrong_topics)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Quiz evaluation failed: {exc}") from exc

    return {
        **evaluation,
        "updated_weak_topics": updated_weak_topics,
    }


@app.get("/")
def root() -> Dict[str, str]:
    return {"message": "Tutor API is running"}


@app.get("/health/runtime")
def runtime_health(live_checks: bool = True) -> Dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    report: Dict[str, Any] = {
        "ok": True,
        "checks": {
            "gemini_api_key": {"ok": bool(api_key), "detail": "configured" if api_key else "missing"},
        },
        "config": {
            "chat_model": APP_CONFIG.chat_model,
            "quiz_model": APP_CONFIG.quiz_model,
            "embedding_model": APP_CONFIG.embedding_model,
            "strict_syllabus": APP_CONFIG.strict_syllabus,
            "allowed_origins": APP_CONFIG.allowed_origins,
        },
    }

    if not api_key:
        report["ok"] = False
        report["note"] = "Set GEMINI_API_KEY to enable live model checks"
        return report

    if not live_checks:
        return report

    try:
        _ensure_gemini_configured()
    except Exception as exc:
        report["ok"] = False
        report["checks"]["gemini_config"] = {"ok": False, "detail": str(exc)}
        return report

    try:
        embedding = genai.embed_content(
            model=APP_CONFIG.embedding_model,
            content="runtime health check",
            task_type="retrieval_query",
        ).get("embedding")
        emb_ok = bool(embedding)
        report["checks"]["embedding_call"] = {
            "ok": emb_ok,
            "detail": f"vector_dim={len(embedding)}" if emb_ok else "empty embedding",
        }
        if not emb_ok:
            report["ok"] = False
    except Exception as exc:
        report["ok"] = False
        report["checks"]["embedding_call"] = {"ok": False, "detail": str(exc)}

    models_to_check = sorted({APP_CONFIG.chat_model, APP_CONFIG.quiz_model})
    for model_name in models_to_check:
        key = f"model_call:{model_name}"
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(
                "Reply with OK",
                generation_config={"max_output_tokens": 8},
            )
            text = (getattr(response, "text", "") or "").strip()
            ok = bool(text)
            report["checks"][key] = {
                "ok": ok,
                "detail": text[:60] if ok else "empty response",
            }
            if not ok:
                report["ok"] = False
        except Exception as exc:
            report["ok"] = False
            report["checks"][key] = {"ok": False, "detail": str(exc)}

    return report
