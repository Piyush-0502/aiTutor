# Personalized Student Tutor App

A full-stack personalized EdTech tutor app with:
- FastAPI backend for chat, ingestion, quiz generation, and evaluation
- Gemini (`gemini-1.5-flash`) for tutor and quiz generation
- Gemini embeddings (`text-embedding-004`) for retrieval
- ChromaDB local vector store, per subject
- PyMuPDF PDF ingestion
- React + Vite premium frontend

## Project Structure

```
tutor-app/
├── backend/
│   ├── __init__.py
│   ├── main.py
│   ├── ingest.py
│   ├── retriever.py
│   ├── quiz.py
│   └── student.py
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       └── styles.css
├── docs/
│   ├── math/
│   ├── science/
│   └── history/
├── students.json
└── requirements.txt
```

## Setup

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Set Gemini API key environment variable:

Windows PowerShell:
```powershell
$env:GEMINI_API_KEY="YOUR_API_KEY"
```

Linux/macOS:
```bash
export GEMINI_API_KEY="YOUR_API_KEY"
```

3. Run backend server:

```bash
uvicorn backend.main:app --reload
```

4. Run frontend:

```bash
cd frontend
npm install
npm run dev
```

Then open the local Vite URL printed in the terminal (default `http://localhost:5173`).

## API Endpoints

- `POST /ingest/{subject}`: Upload PDF for a subject (`math`, `science`, `history`)
- `GET /subjects`: List available subjects
- `POST /chat`: Tutor RAG chat
- `POST /quiz/generate`: Generate contextual quiz
- `POST /quiz/evaluate`: Evaluate quiz and update weak topics
- `GET /student/{student_id}`: Fetch student profile
- `POST /student/create`: Create a new student profile

## Notes

- `students.json` is automatically maintained by the backend.
- On first run, `student_001` is seeded if it does not exist.
- Ingest subject PDFs through `/ingest/{subject}` before chat/quiz for best results.
