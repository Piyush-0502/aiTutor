# Module Documentation - Frontend & Backend

## Frontend Modules

### Core Application Files

#### `src/App.jsx`
**Role**: Main application component and state management hub
**Tasks**:
- Manages global application state (authentication, student profile, chat sessions, quizzes)
- Handles routing between pages (home, chat, quiz, exam, profile, notes, question-bank, summarize)
- Implements all major features: chat, quiz generation/evaluation, question bank generation, file summarization
- Manages localStorage persistence for sessions, notes, quiz history, question banks
- Handles student onboarding and profile management
- Implements note-taking system with drag-drop and selection support
- Manages toasts/notifications
- Coordinates API calls to backend
- Controls sidebar navigation and mobile responsiveness

#### `src/Chat.jsx`
**Role**: Dedicated chat interface component
**Tasks**:
- Renders individual chat conversation thread
- Displays chat messages with markdown rendering
- Handles user input and message submission
- Manages file attachments for PDFs
- Shows typing indicators during AI response
- Implements auto-scroll to latest messages
- Formats timestamps for messages
- Gets student initials for avatar display

#### `src/main.jsx`
**Role**: Application entry point
**Tasks**:
- Mounts React app into DOM
- Imports root App component
- Loads global CSS styles

#### `src/styles.css`
**Role**: Global stylesheet
**Tasks**:
- Defines layout grid and flexbox structures
- Styles all UI components (buttons, cards, forms, dialogs)
- Implements dark theme with glass-morphism design
- Responsive design for mobile/tablet/desktop
- Animations and transitions
- Quiz progress indicators and score visualization
- Chat message styling
- Note-taking UI styles
- Modal and form styles
- Exam section and question bank styles

#### `src/utils/markdownParser.js`
**Role**: Markdown rendering utility
**Tasks**:
- Converts markdown text to HTML
- Renders formatted lists, emphasis, code blocks
- Handles KaTeX math equations (inline and block)
- Implements syntax highlighting for code blocks
- Sanitizes HTML for security

#### `index.html`
**Role**: HTML template
**Tasks**:
- Root HTML file with required meta tags
- Loads Vite entry point (main.jsx)
- Defines page title and viewport settings

#### `package.json`
**Role**: Project configuration
**Tasks**:
- Lists dependencies: React, ReactDOM, jsPDF, dotenv
- Defines build scripts
- Specifies dev server configuration

#### `vite.config.js`
**Role**: Vite build configuration
**Tasks**:
- Configures React plugin
- Sets up environment variables (VITE_API_BASE, VITE_TUTOR_MODEL)
- Defines build optimization settings

---

## Backend Modules

### Core Backend Files

#### `main.py`
**Role**: FastAPI application server and API endpoints
**Tasks**:
- Initializes FastAPI app with CORS middleware
- Defines request/response models using Pydantic
- Implements RESTful endpoints:
  - `/chat` - Chat interaction with RAG pipeline
  - `/quiz/generate` - Generate quiz from retrieved context
  - `/quiz/evaluate` - Evaluate student answers and calculate scores
  - `/ingest/{subject}` - Upload and process PDF documents
  - `/student/*` - Student profile CRUD operations
  - `/question-bank/generate` - Generate question bank from uploaded files
  - `/summarize` - Create study summaries from files
  - `/health/runtime` - System health checks
- Routes requests to appropriate backend modules
- Handles error responses and logging
- Manages file uploads and processing

#### `config.py`
**Role**: Application configuration and constants
**Tasks**:
- Defines APP_CONFIG with model names and settings
- Sets allowed CORS origins
- Configures API keys and model parameters
- Stores application-wide settings

#### `ingest.py`
**Role**: Document ingestion and vectorization pipeline
**Tasks**:
- Extracts text from PDF files
- Chunks documents into manageable pieces
- Cleans and normalizes text content
- Generates embeddings using Gemini API
- Stores chunks in Chroma vector database
- Handles metadata (board, standard, subject, source)
- Manages collection creation and document insertion

#### `retriever.py`
**Role**: Context retrieval and semantic search
**Tasks**:
- Manages Chroma vector database connections
- Implements semantic search across document collections
- Retrieves relevant context chunks for queries
- Filters by subject, board, and standard
- Validates subject names
- Implements similarity-based ranking
- Combines multiple chunks for context window

#### `quiz.py`
**Role**: Quiz generation and evaluation
**Tasks**:
- Generates multiple-choice quizzes using Gemini API
- Extracts JSON quiz structure from model responses
- Validates question format (4 options, single answer)
- Normalizes quiz data
- Evaluates student answers against correct answers
- Calculates scores and percentages
- Identifies weak topics from incorrect answers
- Returns detailed result objects with explanations

#### `student.py`
**Role**: Student profile management
**Tasks**:
- Creates new student profiles
- Stores and retrieves student data
- Updates student profile information
- Manages weak topics tracking (subjects they struggle with)
- Tracks quiz history per subject
- Persists data to students.json file
- Ensures students.json file exists

#### `metadata_norm.py`
**Role**: Metadata normalization and syllabus management
**Tasks**:
- Normalizes board names (CBSE, ICSE, etc.)
- Normalizes standard/grade names (Std 6, Std 8, Std 10)
- Manages syllabus definitions per board/standard/subject
- Validates if topic exists in curriculum
- Implements strict syllabus checking option

#### `rag_pipeline_test.py`
**Role**: Diagnostic testing tool for RAG pipeline
**Tasks**:
- Tests Chroma database connectivity
- Performs test searches with natural language queries
- Validates embedding quality
- Displays search results and distance metrics
- Provides debugging information for retrieval issues
- Command-line interface for testing with custom parameters

---

## Data Flow Summary

```
Frontend (React) 
    ↓ (HTTP requests)
Backend (FastAPI)
    ↓
Modules:
  - Student.py (profile management)
  - Retriever.py (semantic search) → Chroma DB
  - Quiz.py (generation/evaluation) + Gemini API
  - Ingest.py (document processing) → Chroma DB
    ↑ (JSON responses)
Frontend (display results)
```

---

## Technology Stack

### Frontend
- **React**: UI framework
- **Vite**: Build tool
- **jsPDF**: PDF generation
- **CSS**: Styling with glass-morphism design

### Backend
- **FastAPI**: Web framework
- **Pydantic**: Data validation
- **Chroma**: Vector database for embeddings
- **Google Generative AI (Gemini)**: LLM for chat, quiz generation
- **PyPDF**: PDF text extraction
- **ChromaDB**: Vector similarity search
