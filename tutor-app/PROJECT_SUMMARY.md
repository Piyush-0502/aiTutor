Project Summary — Tutor App

Purpose
- A simple educational assistant that ingests curriculum content, indexes it, and serves interactive Q&A and quizzes via a web frontend.

Working (what it does)
- Ingest: Parse source files (PDF/HTML/Markdown), normalize metadata, and split into manageable text chunks.
- Embed & Store: Convert chunks to vector embeddings and persist them in a local vector index for semantic search.
- Retrieve: Embed user queries, search the vector index for relevant passages, then filter/rerank by metadata.
- RAG/Generate: Assemble retrieved passages into a context window and generate answers or quiz items using a language model.
- Frontend: Provide a chat-like and quiz UI; call backend APIs and render returned content for students.
- Student Management: Store simple student profiles and progress in JSON to personalize quizzes and difficulty.

Components (what each part is responsible for)
- Ingest/Preprocessing: Text extraction, normalization, chunking, and metadata tagging.
- Embedding & Vector Store: Produce and store embeddings for semantic similarity search.
- Retriever: Fast nearest-neighbor search and metadata filtering.
- RAG Pipeline: Context assembly, prompt templates, and orchestrating model calls for answers or quizzes.
- Quiz Module: Create questions, choose distractors, and score responses.
- API Server: Expose endpoints for search, generation, and student/session management.
- Frontend (React/Vite): UI for chat, quizzes, and rendering of formatted content.

Very simple data flow (one-liner)
- Source content → Ingest & chunk → Embed → Store in vector DB → User query → Retrieve top passages → Assemble context → Generate response → Show in frontend

Minimal requirements (very basic)
- Python runtime for backend processing
- A local vector store (file-backed) and embedding model or API
- Node.js for the frontend dev server (Vite)
- Basic storage for student records (JSON file)

How to convert this file to PDF
Option A — Using Pandoc (recommended if installed):

```powershell
pandoc tutor-app/PROJECT_SUMMARY.md -o tutor-app/PROJECT_SUMMARY.pdf
```

Option B — Convert to HTML first, then print to PDF with Chrome (if Chrome is installed):

```powershell
pandoc -s tutor-app/PROJECT_SUMMARY.md -o tutor-app/summary.html
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --print-to-pdf="tutor-app/PROJECT_SUMMARY.pdf" "file:///%CD%/tutor-app/summary.html"
```

If you want, I can run the conversion here (if you confirm), or I can produce a one-page PDF and place it in the repo for you.