import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { renderMarkdown } from "./utils/markdownParser";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE;
const DEFAULT_MODEL = import.meta.env.VITE_TUTOR_MODEL || "models/gemini-2.5-flash-lite";

const BASE_SUBJECTS = {
  math: {
    icon: "📐",
    color: "math",
    description: "Solve with guided steps and clear breakdowns.",
  },
  science: {
    icon: "🧪",
    color: "science",
    description: "Learn concepts with intuition and experiment logic.",
  },
  history: {
    icon: "🏛️",
    color: "history",
    description: "Connect events, causes, and timelines confidently.",
  },
};

const EXAM_RESOURCES = [
  { id: "projects", icon: "🧩", title: "Projects", desc: "Track project briefs, milestones, and submissions." },
  { id: "textbooks", icon: "📚", title: "Textbooks", desc: "Access chapter-wise textbook material and references." },
  { id: "notes", icon: "📝", title: "Notes", desc: "Store quick revision notes and important formulas." },
  // { id: "ppts", icon: "📽️", title: "PPTs", desc: "Browse slides for lessons, summaries, and revision." },
  // { id: "worksheets", icon: "📄", title: "Worksheets", desc: "Practice worksheets and topic-wise assignments." },
  { id: "question-bank", icon: "🧠", title: "Question Bank", desc: "Collect model questions for exam preparation." },
  { id: "summarize", icon: "✂️", title: "Summarize", desc: "Create concise summaries from uploaded resources." },
];

const OWN_NOTES_SAMPLE = [
  { id: "u1", title: "Trigonometry Quick Revision", subject: "Math", type: "User Slides" },
  { id: "u2", title: "Acids, Bases and Salts Summary", subject: "Science", type: "Handwritten Notes" },
  { id: "u3", title: "Modern India Important Dates", subject: "History", type: "One Pager" },
];

const SHARED_NOTES_SAMPLE = [
  { id: "s1", title: "Algebra Formula Deck", subject: "Math", type: "Shared PPT", owner: "Riya S." },
  { id: "s2", title: "Light Chapter Master Notes", subject: "Science", type: "Shared Notes", owner: "Karan P." },
  { id: "s3", title: "Industrial Revolution Crash Sheet", subject: "History", type: "Shared Slides", owner: "Neha T." },
];

function dedupeChatSessions(list = []) {
  const bestBySignature = new Map();

  for (const session of list) {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const signature = JSON.stringify([
      session?.subject || "",
      session?.title || "",
      messages.map((m) => [m?.role || "", String(m?.text || "")]),
    ]);

    const current = bestBySignature.get(signature);
    if (!current) {
      bestBySignature.set(signature, session);
      continue;
    }

    const currTs = new Date(current?.updatedAt || 0).getTime();
    const nextTs = new Date(session?.updatedAt || 0).getTime();
    if (nextTs >= currTs) bestBySignature.set(signature, session);
  }

  return Array.from(bestBySignature.values()).sort(
    (a, b) => new Date(b?.updatedAt || 0) - new Date(a?.updatedAt || 0)
  );
}

function toSubjectKey(name = "") {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function initials(name = "Student") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0].toUpperCase())
    .join("");
}

function compactModelName(model = "") {
  const tail = String(model).split("/").pop() || "model";
  return tail.length > 14 ? `${tail.slice(0, 14)}...` : tail;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch {
      try {
        detail = await response.text();
      } catch {}
    }
    throw new Error(detail || "Request failed");
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function Toasts({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function Sidebar({ collapsed, mobileOpen, onToggle, onNavigate, activePage, onLogout }) {
  const nav = [
    ["home", "🏠", "Home"],
    ["chat", "💬", "Tutor Chat"],
    ["quiz", "🧠", "Quiz Lab"],
    ["exam", "🗂️", "Exam Section"],
    ["profile", "👤", "Profile"],
  ];

  return (
    <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
      <div className="brand">
        <div className="brand-mark">TF</div>
        {!collapsed && <span>TutorFlow</span>}
      </div>

      <button className="collapse-btn" onClick={onToggle}>
        ☰ {!collapsed && <span>Toggle Sidebar</span>}
      </button>

      <div className="nav">
        {nav.map(([id, icon, label]) => (
          <button
            key={id}
            className={`nav-btn ${activePage === id ? "active" : ""}`}
            onClick={() => onNavigate(id)}
          >
            <span className="icon">{icon}</span>
            {!collapsed && <span className="label">{label}</span>}
          </button>
        ))}
      </div>

      <button className="sidebar-logout" onClick={onLogout}>
        ⎋ {!collapsed && <span>Logout</span>}
      </button>

      {!collapsed && (
        <div className="sidebar-footer">
          <h4>Daily Momentum</h4>
          <p>Small steps compound. 15 focused minutes today beats 0 perfect minutes.</p>
        </div>
      )}
    </aside>
  );
}

export default function App() {
  const [page, setPage] = useState("home");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 980);
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem("tutorflow_auth") === "1"
  );
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [studentId, setStudentId] = useState(localStorage.getItem("student_id") || "");
  const [student, setStudent] = useState(null);

  const [chatSubject, setChatSubject] = useState("math");
  const [chatTopic, setChatTopic] = useState("");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatSessions, setChatSessions] = useState([]);
  const [chatSessionsHydrated, setChatSessionsHydrated] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesItems, setNotesItems] = useState([]);
  const [notesItemsHydrated, setNotesItemsHydrated] = useState(false);
  const [activeNote, setActiveNote] = useState(null);
  const [customSubjects, setCustomSubjects] = useState([]);
  const [customSubjectsHydrated, setCustomSubjectsHydrated] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectDescription, setNewSubjectDescription] = useState("");
  const [newSubjectIcon, setNewSubjectIcon] = useState("✨");
  const [selectionDraft, setSelectionDraft] = useState({
    open: false,
    text: "",
    x: 0,
    y: 0,
  });
  const chatFeedRef = useRef(null);

  const [quizStep, setQuizStep] = useState(1);
  const [quizConfig, setQuizConfig] = useState({
    subject: "math",
    topic: "",
    difficulty: "medium",
    n_questions: 5,
  });
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizData, setQuizData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [revealedAnswers, setRevealedAnswers] = useState({});
  const [quizHistory, setQuizHistory] = useState([]);
  const [selectedQuizHistoryId, setSelectedQuizHistoryId] = useState("");
  const [quizHistoryHydrated, setQuizHistoryHydrated] = useState(false);

  const [onboardingOpen, setOnboardingOpen] = useState(!studentId);
  const [onboardingName, setOnboardingName] = useState("");
  const [onboardingLevel, setOnboardingLevel] = useState("medium");
  const [onboardingGrade, setOnboardingGrade] = useState("");
  const [onboardingSchool, setOnboardingSchool] = useState("");
  const [onboardingBoard, setOnboardingBoard] = useState("");
  const [onboardingTargetExam, setOnboardingTargetExam] = useState("");
  const [onboardingLanguage, setOnboardingLanguage] = useState("English");
  const [onboardingHours, setOnboardingHours] = useState(6);
  const [onboardingStyle, setOnboardingStyle] = useState("mixed");
  const [onboardingGuardian, setOnboardingGuardian] = useState("");
  const [onboardingBusy, setOnboardingBusy] = useState(false);

  const [profileForm, setProfileForm] = useState({
    name: "",
    level: "medium",
    grade: "",
    school: "",
    board: "",
    target_exam: "",
    preferred_language: "English",
    study_hours_per_week: 0,
    learning_style: "mixed",
    guardian_name: "",
  });
  const [profileSaving, setProfileSaving] = useState(false);

  const [toasts, setToasts] = useState([]);
  const [activeExamResource, setActiveExamResource] = useState("");
  const [notesSearch, setNotesSearch] = useState("");
  const [notesView, setNotesView] = useState("user");
  const [questionBanks, setQuestionBanks] = useState([]);
  const [questionBanksHydrated, setQuestionBanksHydrated] = useState(false);
  const [questionBankLoading, setQuestionBankLoading] = useState(false);
  const [questionBankSearch, setQuestionBankSearch] = useState("");
  const [activeQuestionBank, setActiveQuestionBank] = useState(null);
  const [questionBankForm, setQuestionBankForm] = useState({
    subject: quizConfig.subject || "math",
    topic: "",
    query: "",
    n_questions: 10,
    files: [],
  });
  const [summaryResult, setSummaryResult] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryForm, setSummaryForm] = useState({ topic: "", files: [] });

  const userNotesCatalog = useMemo(
    () =>
      [...notesItems]
        .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))
        .map((item, idx) => {
        const text = String(item?.text || "").trim();
        const firstLine = text.split("\n").find((x) => x.trim()) || "Untitled note";
        const title = firstLine.length > 72 ? `${firstLine.slice(0, 72)}...` : firstLine;
        const snippet = text.length > 160 ? `${text.slice(0, 160)}...` : text;
        return {
          id: item?.id || `user-note-${idx}`,
          title,
          subject: "General",
          type: item?.source ? `Saved (${item.source})` : "Saved note",
          text,
          snippet,
          createdAt: item?.createdAt || "",
        };
      }),
    [notesItems]
  );

  const filteredUserNotes = useMemo(() => {
    const q = notesSearch.trim().toLowerCase();
    if (!q) return userNotesCatalog;
    return userNotesCatalog.filter((item) =>
      [item.title, item.subject, item.type, item.text].some((x) => String(x).toLowerCase().includes(q))
    );
  }, [notesSearch, userNotesCatalog]);

  const filteredSharedNotes = useMemo(() => {
    const q = notesSearch.trim().toLowerCase();
    if (!q) return SHARED_NOTES_SAMPLE;
    return SHARED_NOTES_SAMPLE.filter((item) =>
      [item.title, item.subject, item.type, item.owner].some((x) => String(x).toLowerCase().includes(q))
    );
  }, [notesSearch]);

  const progressPct = useMemo(() => ((quizStep - 1) / 2) * 100, [quizStep]);
  const sortedSessions = useMemo(
    () => dedupeChatSessions(chatSessions),
    [chatSessions]
  );

  const activeSession = useMemo(
    () => chatSessions.find((s) => s.id === selectedSessionId) || null,
    [chatSessions, selectedSessionId]
  );

  const chatStorageKey = useMemo(
    () => `tutorflow_chat_sessions_${studentId || "anonymous"}`,
    [studentId]
  );

  const subjectStorageKey = useMemo(
    () => `tutorflow_custom_subjects_${studentId || "anonymous"}`,
    [studentId]
  );

  const quizHistoryStorageKey = useMemo(
    () => `tutorflow_quiz_history_${studentId || "anonymous"}`,
    [studentId]
  );

  const questionBanksStorageKey = useMemo(
    () => `tutorflow_question_banks_${studentId || "anonymous"}`,
    [studentId]
  );

  const userNotesStorageKey = useMemo(
    () => `tutorflow_user_notes_${studentId || "anonymous"}`,
    [studentId]
  );

  const subjects = useMemo(() => {
    const userSubjects = customSubjects.reduce((acc, item) => { if (!item || !item.key) return acc; acc[item.key] = { icon: item.icon || "✨", color: item.key, description: item.description || item.name || item.key }; return acc; }, {});
    return { ...BASE_SUBJECTS, ...userSubjects };
  }, [customSubjects]);

  function toast(message, type = "success") {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  }

  async function generateQuestionBank({ files = [], subject, query = "", topic = "", n_questions = 10, model = DEFAULT_MODEL } = {}) {
    if (!subject) {
      toast("Select a subject first", "error");
      return;
    }
    setQuestionBankLoading(true);
    try {
      const form = new FormData();
      for (const f of files || []) form.append("files", f);
      form.append("subject", subject);
      if (query) form.append("query", query);
      if (topic) form.append("topic", topic);
      form.append("n_questions", String(n_questions || 10));
      form.append("model", model);

      const res = await fetch(`${API_BASE}/question-bank/generate`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Question bank generation failed");
      }
      const payload = await res.json();
      setQuestionBanks((prev) => [payload, ...prev]);
      toast("Question bank created", "success");
      return payload;
    } catch (err) {
      toast(String(err?.message || err), "error");
      throw err;
    } finally {
      setQuestionBankLoading(false);
    }
  }

  function openQuestionBankViewer(bank) {
    setActiveQuestionBank(bank);
  }

  function closeQuestionBankViewer() {
    setActiveQuestionBank(null);
  }

  async function summarizeFiles({ files = [], topic = "", model = DEFAULT_MODEL } = {}) {
    if (!files || !files.length) {
      toast("Please attach at least one file to summarize", "error");
      return;
    }
    setSummaryLoading(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      if (topic) form.append("topic", topic);
      form.append("model", model);

      const res = await fetch(`${API_BASE}/summarize`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Summary failed");
      }
      const payload = await res.json();
      setSummaryResult(payload);
      toast("Summary created", "success");
      return payload;
    } catch (err) {
      toast(String(err?.message || err), "error");
      throw err;
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadStudent() {
    if (!studentId) return;
    try {
      const profile = await api(`/student/${studentId}`);
      setStudent(profile);
    } catch (err) {
      // ignore
    }
  }

  useEffect(() => {
    loadStudent();
  }, [studentId]);

  useEffect(() => {
    setChatSessionsHydrated(false);
    try {
      const raw = localStorage.getItem(chatStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setChatSessions(Array.isArray(parsed) ? parsed : []);
    } catch {
      setChatSessions([]);
    } finally {
      setChatSessionsHydrated(true);
    }
  }, [chatStorageKey]);

  useEffect(() => {
    if (!chatSessionsHydrated) return;
    localStorage.setItem(chatStorageKey, JSON.stringify(chatSessions));
  }, [chatSessions, chatStorageKey, chatSessionsHydrated]);

  useEffect(() => {
    setCustomSubjectsHydrated(false);
    try {
      const raw = localStorage.getItem(subjectStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setCustomSubjects(Array.isArray(parsed) ? parsed : []);
    } catch {
      setCustomSubjects([]);
    } finally {
      setCustomSubjectsHydrated(true);
    }
  }, [subjectStorageKey]);

  useEffect(() => {
    if (!customSubjectsHydrated) return;
    localStorage.setItem(subjectStorageKey, JSON.stringify(customSubjects));
  }, [customSubjects, subjectStorageKey, customSubjectsHydrated]);

  useEffect(() => {
    setNotesItemsHydrated(false);
    try {
      const raw = localStorage.getItem(userNotesStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setNotesItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setNotesItems([]);
    } finally {
      setNotesItemsHydrated(true);
    }
  }, [userNotesStorageKey]);

  useEffect(() => {
    if (!notesItemsHydrated) return;
    localStorage.setItem(userNotesStorageKey, JSON.stringify(notesItems));
  }, [notesItems, userNotesStorageKey, notesItemsHydrated]);

  useEffect(() => {
    setQuizHistoryHydrated(false);
    try {
      const raw = localStorage.getItem(quizHistoryStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setQuizHistory(Array.isArray(parsed) ? parsed : []);
    } catch {
      setQuizHistory([]);
    } finally {
      setQuizHistoryHydrated(true);
    }
  }, [quizHistoryStorageKey]);

  useEffect(() => {
    if (!quizHistoryHydrated) return;
    localStorage.setItem(quizHistoryStorageKey, JSON.stringify(quizHistory));
  }, [quizHistory, quizHistoryStorageKey, quizHistoryHydrated]);

  useEffect(() => {
    setQuestionBanksHydrated(false);
    try {
      const raw = localStorage.getItem(questionBanksStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setQuestionBanks(Array.isArray(parsed) ? parsed : []);
    } catch {
      setQuestionBanks([]);
    } finally {
      setQuestionBanksHydrated(true);
    }
  }, [questionBanksStorageKey]);

  useEffect(() => {
    if (!questionBanksHydrated) return;
    localStorage.setItem(questionBanksStorageKey, JSON.stringify(questionBanks));
  }, [questionBanks, questionBanksStorageKey, questionBanksHydrated]);

  useEffect(() => {
    if (!studentId || messages.length === 0) return;

    const now = new Date().toISOString();
    const sessionId = selectedSessionId || crypto.randomUUID();

    setChatSessions((prev) => {
      const copy = prev.filter((s) => s.id !== sessionId);
      copy.unshift({
        id: sessionId,
        title: buildSessionTitle(messages),
        subject: chatSubject,
        topic: chatTopic,
        model: selectedModel,
        messages,
        updatedAt: now,
      });
      return copy.slice(0, 200);
    });

    if (!selectedSessionId) {
      setSelectedSessionId(sessionId);
    }
  }, [studentId, messages, chatSubject, chatTopic, selectedModel, selectedSessionId]);

  useEffect(() => {
    if (!student) return;
    const p = student.profile || {};
    setProfileForm({
      name: student.name || "",
      level: student.level || "medium",
      grade: p.grade || "",
      school: p.school || "",
      board: p.board || "",
      target_exam: p.target_exam || "",
      preferred_language: p.preferred_language || "English",
      study_hours_per_week: Number(p.study_hours_per_week || 0),
      learning_style: p.learning_style || "mixed",
      guardian_name: p.guardian_name || "",
    });
  }, [student]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 980);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const feed = chatFeedRef.current;
    if (!feed || messages.length === 0) return;

    const last = messages[messages.length - 1];
    const shouldForceScroll = last?.role === "student";
    if (isPinnedToBottom || shouldForceScroll) {
      feed.scrollTop = feed.scrollHeight;
      setIsPinnedToBottom(true);
    }

    if (last?.role === "tutor") setShowJumpToLatest(true);
  }, [messages, isPinnedToBottom]);

  useEffect(() => {
    const subjectKeys = Object.keys(subjects);
    if (!subjectKeys.length) return;
    if (!subjects[chatSubject]) setChatSubject(subjectKeys[0]);
    if (!subjects[quizConfig.subject]) setQuizConfig((p) => ({ ...p, subject: subjectKeys[0] }));
  }, [subjects, chatSubject, quizConfig.subject]);

  function navigate(nextPage) {
    setPage(nextPage);
    if (isMobile) setMobileOpen(false);
  }

  function addCustomSubject() {
    const name = newSubjectName.trim();
    if (!name) return;

    const key = toSubjectKey(name);
    if (!key) return;

    if (subjects[key]) {
      toast("Subject already exists", "error");
      return;
    }

    const description = newSubjectDescription.trim() || "Custom subject";
    const icon = (newSubjectIcon.trim() || "✨").slice(0, 2);

    setCustomSubjects((prev) => [
      ...prev,
      {
        key,
        name,
        description,
        icon,
      },
    ]);
    setNewSubjectName("");
    setNewSubjectDescription("");
    setNewSubjectIcon("✨");
    setChatSubject(key);
    setQuizConfig((prev) => ({ ...prev, subject: key }));
    toast("Subject added", "success");
  }

  async function createStudentProfile() {
    if (!onboardingName.trim()) {
      toast("Please enter your name", "error");
      return;
    }
    setOnboardingBusy(true);
    try {
      const profile = await api("/student/create", {
        method: "POST",
        body: JSON.stringify({
          name: onboardingName.trim(),
          level: onboardingLevel,
          grade: onboardingGrade.trim(),
          school: onboardingSchool.trim(),
          board: onboardingBoard.trim(),
          target_exam: onboardingTargetExam.trim(),
          preferred_language: onboardingLanguage,
          study_hours_per_week: Number(onboardingHours || 0),
          learning_style: onboardingStyle,
          guardian_name: onboardingGuardian.trim(),
        }),
      });
      setStudentId(profile.id);
      setStudent(profile);
      localStorage.setItem("student_id", profile.id);
      setOnboardingOpen(false);
      toast("Profile created", "success");
    } catch (err) {
      toast(`Could not create profile: ${err.message}`, "error");
    } finally {
      setOnboardingBusy(false);
    }
  }

  async function saveProfile() {
    if (!studentId) return;
    setProfileSaving(true);
    try {
      const payload = {
        name: profileForm.name.trim(),
        level: profileForm.level,
        profile: {
          grade: profileForm.grade.trim(),
          school: profileForm.school.trim(),
          board: profileForm.board.trim(),
          target_exam: profileForm.target_exam.trim(),
          preferred_language: profileForm.preferred_language,
          study_hours_per_week: Number(profileForm.study_hours_per_week || 0),
          learning_style: profileForm.learning_style,
          guardian_name: profileForm.guardian_name.trim(),
        },
      };

      const updated = await api(`/student/${studentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setStudent(updated);
      toast("Profile updated", "success");
    } catch (err) {
      toast(`Profile update failed: ${err.message}`, "error");
    } finally {
      setProfileSaving(false);
    }
  }

  async function uploadPdf(subject, file, topic = "") {
    const form = new FormData();
    form.append("file", file);

    const params = new URLSearchParams();
    const cleanTopic = (topic || "").trim();
    if (cleanTopic) params.set("topic", cleanTopic);
    const query = params.toString();
    const endpoint = `${API_BASE}/ingest/${subject}${query ? `?${query}` : ""}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        let detail = "Upload failed";
        try {
          const payload = await response.json();
          detail = payload.detail || detail;
        } catch {
          detail = await response.text();
        }
        throw new Error(detail);
      }
      const payload = await response.json();
      toast(`PDF uploaded. ${payload.chunks || 0} chunks indexed.`, "success");
    } catch (err) {
      toast(`Upload failed: ${err.message}`, "error");
    }
  }

  async function handleChatAttachment(file) {
    if (!file) return;

    try {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Only PDF files are supported for attachments");
      }

      await uploadPdf(chatSubject, file, chatTopic);
      setMessages((prev) => [...prev, { role: "student", text: `Uploaded PDF: ${file.name}` }]);
    } catch (err) {
      toast(`Attachment failed: ${err.message}`, "error");
    }
  }

  function onChatScroll() {
    const feed = chatFeedRef.current;
    if (!feed) return;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 72;
    setIsPinnedToBottom(nearBottom);
    if (nearBottom) setShowJumpToLatest(false);
  }

  function jumpToLatest() {
    const feed = chatFeedRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
    setIsPinnedToBottom(true);
    setShowJumpToLatest(false);
  }

  function buildSessionTitle(msgs) {
    const firstStudent = (msgs || []).find((m) => m.role === "student")?.text || "Untitled chat";
    const oneLine = String(firstStudent).replace(/\s+/g, " ").trim();
    return oneLine.slice(0, 72) || "Untitled chat";
  }

  function loadConversation(sessionId) {
    const found = chatSessions.find((s) => s.id === sessionId);
    if (!found) {
      toast("Conversation not found", "error");
      return;
    }
    setChatSubject(found.subject || "math");
    setChatTopic(found.topic || "");
    setSelectedModel(found.model || DEFAULT_MODEL);
    setMessages(Array.isArray(found.messages) ? found.messages : []);
    setSelectedSessionId(found.id);
    setPage("chat");
    toast("Conversation loaded", "success");
  }

  function deleteConversation(sessionId) {
    setChatSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (selectedSessionId === sessionId) {
      setSelectedSessionId("");
      setMessages([]);
    }
    toast("Conversation deleted", "success");
  }

  function startNewConversation() {
    setSelectedSessionId("");
    setMessages([]);
    setShowJumpToLatest(false);
    setIsPinnedToBottom(true);
  }

  function addNote(rawText, source = "selection") {
    const text = String(rawText || "").replace(/\r\n/g, "\n").trim();
    if (!text) return;
    setNotesItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text, source, createdAt: new Date().toISOString() },
    ]);
  }

  function removeNote(id) {
    setNotesItems((prev) => prev.filter((x) => x.id !== id));
  }

  function clearSelectionDraft() {
    setSelectionDraft({ open: false, text: "", x: 0, y: 0 });
  }

  function onChatSelection() {
    const sel = window.getSelection();
    const selectedText = sel?.toString()?.trim() || "";
    if (!selectedText || !sel?.rangeCount) {
      clearSelectionDraft();
      return;
    }

    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer?.nodeType === 3
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    const inTutorMessage = node?.closest?.(".message-line.tutor");
    if (!inTutorMessage) {
      clearSelectionDraft();
      return;
    }

    const rect = range.getBoundingClientRect();
    setSelectionDraft({
      open: true,
      text: selectedText,
      x: Math.max(12, rect.left + window.scrollX),
      y: Math.max(12, rect.top + window.scrollY - 42),
    });
  }

  function addSelectionToNotes() {
    if (!selectionDraft.text) return;
    addNote(selectionDraft.text, "selection");
    toast("Added to notes", "success");
    clearSelectionDraft();
    window.getSelection()?.removeAllRanges();
    if (!notesOpen) setNotesOpen(true);
  }

  function onMessageDragStart(event, text) {
    const sel = window.getSelection();
    const selectedText = sel?.toString() || "";
    const selectedNode = sel?.rangeCount
      ? (sel.getRangeAt(0).commonAncestorContainer?.nodeType === 3
        ? sel.getRangeAt(0).commonAncestorContainer.parentElement
        : sel.getRangeAt(0).commonAncestorContainer)
      : null;
    const inTutorMessage = selectedNode?.closest?.(".message-line.tutor");
    const payload = inTutorMessage && selectedText.trim() ? selectedText : String(text || "");
    event.dataTransfer.setData("text/plain", payload.replace(/\r\n/g, "\n"));
    event.dataTransfer.effectAllowed = "copy";
  }

  function onNotesDrop(event) {
    event.preventDefault();
    const text = event.dataTransfer.getData("text/plain") || selectionDraft.text;
    if (!text) return;
    addNote(text, "drag");
    toast("Dropped into notes", "success");
    clearSelectionDraft();
  }

  function downloadFile(filename, mimeType, content) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportNotesWord() {
    if (!notesItems.length) {
      toast("No notes to export", "error");
      return;
    }
    const rows = notesItems
      .map((n, idx) => {
        const safe = n.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");
        return `<li><strong>${idx + 1}.</strong><div>${safe}</div></li>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tutor Notes</title><style>body{font-family:Segoe UI,Arial,sans-serif;padding:24px;line-height:1.5}li{margin:12px 0}li div{white-space:pre-wrap;margin-top:4px}</style></head><body><h2>Tutor Notes</h2><ol>${rows}</ol></body></html>`;
    downloadFile("tutor-notes.doc", "application/msword", html);
    toast("Word file downloaded", "success");
  }

  function exportNotesPdf() {
    if (!notesItems.length) {
      toast("No notes to export", "error");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 42;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Tutor Notes", margin, y);
    y += 28;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    const ensurePageSpace = (requiredHeight = 18) => {
      if (y + requiredHeight <= pageHeight - margin) return;
      doc.addPage();
      y = margin;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
    };

    notesItems.forEach((note, idx) => {
      const title = `${idx + 1}.`;
      const content = String(note.text || "").replace(/\r\n/g, "\n");
      const wrapped = doc.splitTextToSize(content, contentWidth - 16);

      ensurePageSpace(18);
      doc.setFont("helvetica", "bold");
      doc.text(title, margin, y);
      y += 16;

      doc.setFont("helvetica", "normal");
      for (const line of wrapped) {
        ensurePageSpace(14);
        doc.text(line, margin + 16, y);
        y += 14;
      }

      y += 8;
    });

    doc.save("tutor-notes.pdf");
    toast("PDF downloaded", "success");
  }

  function exportSummaryPdf() {
    if (!summaryResult?.summary) {
      toast("No summary to export", "error");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 42;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Study Summary", margin, y);
    y += 26;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    if (summaryResult.topic) {
      const topicText = `Topic: ${summaryResult.topic}`;
      const topicLines = doc.splitTextToSize(topicText, contentWidth);
      topicLines.forEach((line) => {
        if (y + 14 > pageHeight - margin) {
          doc.addPage();
          y = margin;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(11);
        }
        doc.text(line, margin, y);
        y += 14;
      });
      y += 10;
    }

    const summaryText = String(summaryResult.summary).replace(/\r\n/g, "\n");
    const lines = doc.splitTextToSize(summaryText, contentWidth);
    lines.forEach((line) => {
      if (y + 14 > pageHeight - margin) {
        doc.addPage();
        y = margin;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
      }
      doc.text(line, margin, y);
      y += 14;
    });

    const filename = `summary${summaryResult.topic ? `-${summaryResult.topic}` : ""}`
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/(^-|-$)/g, "")
      .toLowerCase() || "summary.pdf";

    doc.save(`${filename}.pdf`);
    toast("PDF downloaded", "success");
  }

  function exportQuestionBankPdf(bank = activeQuestionBank) {
    const questionBank = bank;
    if (!questionBank?.questions?.length) {
      toast("No question bank to export", "error");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 42;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(questionBank.title || "Question Bank", margin, y);
    y += 26;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const metaLines = [];
    if (questionBank.subject) metaLines.push(`Subject: ${questionBank.subject}`);
    if (questionBank.topic) metaLines.push(`Topic: ${questionBank.topic}`);
    metaLines.push(`Questions: ${questionBank.count || questionBank.questions.length}`);
    metaLines.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, contentWidth);
      wrapped.forEach((wrappedLine) => {
        if (y + 14 > pageHeight - margin) {
          doc.addPage();
          y = margin;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(11);
        }
        doc.text(wrappedLine, margin, y);
        y += 14;
      });
      y += 4;
    });
    y += 8;

    const ensurePageSpace = (requiredHeight = 18) => {
      if (y + requiredHeight <= pageHeight - margin) return;
      doc.addPage();
      y = margin;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
    };

    questionBank.questions.forEach((q, qi) => {
      const questionText = typeof q === "string"
        ? q
        : q.question || q.prompt || q.title || q.statement || "(Question text unavailable)";
      const wrappedQuestion = doc.splitTextToSize(`Q${qi + 1}. ${questionText.replace(/\r\n/g, "\n")}`, contentWidth);

      ensurePageSpace(18);
      doc.setFont("helvetica", "bold");
      doc.text(wrappedQuestion[0], margin, y);
      y += 14;
      if (wrappedQuestion.length > 1) {
        doc.setFont("helvetica", "normal");
        for (let i = 1; i < wrappedQuestion.length; i += 1) {
          ensurePageSpace(14);
          doc.text(wrappedQuestion[i], margin + 12, y);
          y += 14;
        }
      }
      y += 6;

      const options = Array.isArray(q.options) ? q.options : [];
      options.forEach((opt, optIdx) => {
        const label = `${String.fromCharCode(65 + optIdx)}. ${String(opt || "").replace(/\r\n/g, "\n")}`;
        const wrappedOpt = doc.splitTextToSize(label, contentWidth - 24);
        wrappedOpt.forEach((line) => {
          ensurePageSpace(14);
          doc.text(line, margin + 18, y);
          y += 14;
        });
      });

      if (q.explanation) {
        const explanationLines = doc.splitTextToSize(`Explanation: ${String(q.explanation).replace(/\r\n/g, "\n")}`, contentWidth - 24);
        ensurePageSpace(14);
        doc.setFont("helvetica", "italic");
        explanationLines.forEach((line) => {
          ensurePageSpace(14);
          doc.text(line, margin + 18, y);
          y += 14;
        });
        doc.setFont("helvetica", "normal");
      }

      y += 12;
    });

    const filename = `${(questionBank.title || "question-bank").replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase()}.pdf`;
    doc.save(filename);
    toast("PDF downloaded", "success");
  }

  function buildTutorFollowUp(action, tutorText) {
    const excerpt = String(tutorText || "").replace(/\s+/g, " ").trim().slice(0, 700);

    if (action === "simplify") {
      return `Rewrite this explanation in very simple language for a school student. Use short points and keep it easy to remember. Source text: ${excerpt}`;
    }
    if (action === "example") {
      return `Give one more worked example for the same topic. Show step-by-step method and final answer. Source text: ${excerpt}`;
    }
    if (action === "practice") {
      return `Create 3 practice questions from this topic with answers at the end. Keep difficulty medium. Source text: ${excerpt}`;
    }
    return "";
  }

  async function copyTutorMessage(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      toast("Response copied", "success");
    } catch {
      toast("Copy not available in this browser context", "error");
    }
  }

  async function runTutorAction(action, tutorText) {
    if (chatLoading) return;
    if (action === "copy") {
      await copyTutorMessage(tutorText);
      return;
    }
    const followUp = buildTutorFollowUp(action, tutorText);
    if (!followUp) return;
    await sendMessage(followUp);
  }

  async function sendMessage(overrideQuestion = "") {
    const question = String(overrideQuestion || chatInput).trim();
    if (!question || chatLoading) return;
    if (!studentId) {
      toast("Create a profile first", "error");
      return;
    }

    setMessages((prev) => [...prev, { role: "student", text: question }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const payload = await api("/chat", {
        method: "POST",
        body: JSON.stringify({
          student_id: studentId,
          subject: chatSubject,
          question,
          topic: chatTopic.trim() || undefined,
          model: selectedModel,
        }),
      });
      if (payload?.warning) {
        toast(payload.warning, "warning");
      }
      setMessages((prev) => [...prev, { role: "tutor", text: payload.answer || "No response" }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "tutor", text: `I hit an error: ${err.message}` }]);
      toast("Chat failed", "error");
    } finally {
      setChatLoading(false);
    }
  }

  async function generateQuiz() {
    if (!quizConfig.topic.trim()) {
      toast("Enter a topic first", "error");
      return;
    }

    setQuizLoading(true);
    try {
      const payload = await api("/quiz/generate", {
        method: "POST",
        body: JSON.stringify({
          student_id: studentId,
          subject: quizConfig.subject,
          topic: quizConfig.topic.trim(),
          difficulty: quizConfig.difficulty,
          n_questions: Number(quizConfig.n_questions || 5),
          model: selectedModel,
        }),
      });
      setQuizData(payload);
      if (payload?.warning) {
        toast(payload.warning, "warning");
      }
      setAnswers({});
      setQuizResult(null);
      setRevealedAnswers({});
      setSelectedQuizHistoryId("");
      setQuizStep(2);
      toast("Quiz generated", "success");
    } catch (err) {
      toast(`Quiz generation failed: ${err.message}`, "error");
    } finally {
      setQuizLoading(false);
    }
  }

  async function evaluateQuiz() {
    if (!quizData?.questions?.length) return;

    const unanswered = quizData.questions.filter((q) => !answers[q.id]);
    if (unanswered.length) {
      toast(`Please answer ${unanswered.length} remaining question(s)`, "error");
      return;
    }

    setQuizLoading(true);
    try {
      const payload = await api("/quiz/evaluate", {
        method: "POST",
        body: JSON.stringify({
          student_id: studentId,
          subject: quizConfig.subject,
          questions: quizData.questions,
          answers,
        }),
      });

      const historyEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        subject: quizConfig.subject,
        topic: quizConfig.topic.trim(),
        difficulty: quizConfig.difficulty,
        n_questions: Number(quizConfig.n_questions || 5),
        score: Number(payload?.score || 0),
        total: Number(payload?.total || quizData?.questions?.length || 0),
        percentage: Number(payload?.percentage || 0),
        results: Array.isArray(payload?.results) ? payload.results : [],
        questions: Array.isArray(quizData?.questions) ? quizData.questions : [],
        answers,
      };

      setQuizResult(payload);
      setQuizHistory((prev) => [historyEntry, ...prev].slice(0, 100));
      setSelectedQuizHistoryId(historyEntry.id);
      setQuizStep(3);
      toast("Quiz saved", "success");
      await loadStudent();
    } catch (err) {
      toast(`Quiz evaluation failed: ${err.message}`, "error");
    } finally {
      setQuizLoading(false);
    }
  }

  const score = Number(quizResult?.percentage || 0);
  const circle = 301.59;
  const dashOffset = circle * (1 - score / 100);

  function handleLoginSubmit(event) {
    event.preventDefault();
    if (!loginId.trim() || !loginPassword.trim()) {
      setLoginError("Please enter both ID and password.");
      return;
    }
    localStorage.setItem("tutorflow_auth", "1");
    setIsAuthenticated(true);
    setLoginError("");
    setLoginId("");
    setLoginPassword("");
  }

  function handleLogout() {
    localStorage.removeItem("tutorflow_auth");
    setIsAuthenticated(false);
  }

  function loadQuizFromHistory(entryId) {
    const entry = quizHistory.find((item) => item.id === entryId);
    if (!entry) {
      toast("Saved quiz not found", "error");
      return;
    }

    setQuizConfig((prev) => ({
      ...prev,
      subject: entry.subject || prev.subject,
      topic: entry.topic || "",
      difficulty: entry.difficulty || prev.difficulty,
      n_questions: Number(entry.n_questions || entry.total || prev.n_questions || 5),
    }));
    setQuizData({ questions: Array.isArray(entry.questions) ? entry.questions : [] });
    setAnswers(entry.answers || {});
    setQuizResult({
      score: Number(entry.score || 0),
      total: Number(entry.total || 0),
      percentage: Number(entry.percentage || 0),
      results: Array.isArray(entry.results) ? entry.results : [],
    });
    setRevealedAnswers({});
    setSelectedQuizHistoryId(entry.id);
    setQuizStep(3);
    toast("Loaded previous quiz", "success");
  }

  if (!isAuthenticated) {
    return (
      <>
        <section className="login-screen">
          <div className="login-card glass-card">
            <p className="login-kicker">TutorFlow Access</p>
            <h1>sign in</h1>

            <form className="login-form" onSubmit={handleLoginSubmit}>
              <label htmlFor="login-id">Student ID</label>
              <input
                id="login-id"
                type="text"
                placeholder="Enter any ID"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
              />

              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                placeholder="Enter any password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />

              {loginError && <p className="login-error">{loginError}</p>}

              <button type="submit" className="btn main login-btn">
                Login
              </button>
            </form>
          </div>
        </section>
        <Toasts toasts={toasts} />
      </>
    );
  }

  return (
    <>
      <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
        <Sidebar
          collapsed={collapsed && !isMobile}
          mobileOpen={mobileOpen}
          onToggle={() => {
            if (isMobile) {
              setMobileOpen((x) => !x);
            } else {
              setCollapsed((x) => !x);
            }
          }}
          onNavigate={navigate}
          activePage={page}
          onLogout={handleLogout}
        />

        <main className="main">
          {isMobile && (
            <div className="mobile-row">
              <button className="collapse-btn" onClick={() => setMobileOpen((x) => !x)}>
                Menu
              </button>
            </div>
          )}

          {page === "question-bank" && (
            <section className="page active question-bank-page">
              <div className="page-header">
                <div>
                  <h2>Question Bank Builder</h2>
                  <p className="muted">Create practice questions from a topic, prompt, or uploaded PDF.</p>
                </div>
                <button className="btn alt" type="button" onClick={() => navigate("exam")}>Back to Exam</button>
              </div>
              <div className="glass-card question-bank-wrap">
                <div className="question-bank-form">
                  <select
                    value={questionBankForm.subject}
                    onChange={(e) => setQuestionBankForm((prev) => ({ ...prev, subject: e.target.value }))}
                  >
                    {Object.keys(subjects).map((s) => (
                      <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Topic or query (optional)"
                    value={questionBankForm.topic}
                    onChange={(e) => setQuestionBankForm((prev) => ({ ...prev, topic: e.target.value }))}
                  />
                  <label className="btn alt upload-btn">
                    Attach files
                    <input
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={(e) => {
                        const files = e.target.files ? Array.from(e.target.files) : [];
                        setQuestionBankForm((prev) => ({ ...prev, files }));
                      }}
                    />
                  </label>
                  {questionBankForm.files.length > 0 && (
                    <div className="uploaded-files">
                      <strong>Selected files:</strong>
                      <span>{questionBankForm.files.map((file) => file.name).join(", ")}</span>
                    </div>
                  )}
                  <input
                    type="number"
                    min={5}
                    max={20}
                    value={questionBankForm.n_questions}
                    onChange={(e) => setQuestionBankForm((prev) => ({ ...prev, n_questions: Number(e.target.value || 10) }))}
                  />
                  <button
                    className="btn main"
                    onClick={async () => {
                      try {
                        const bank = await generateQuestionBank({
                          files: questionBankForm.files,
                          subject: questionBankForm.subject,
                          topic: questionBankForm.topic,
                          query: questionBankForm.query,
                          n_questions: questionBankForm.n_questions,
                        });
                        openQuestionBankViewer(bank);
                      } catch (e) {
                        // handled in generateQuestionBank
                      }
                    }}
                    disabled={questionBankLoading}
                  >
                    {questionBankLoading ? "Generating..." : "Create Bank"}
                  </button>
                </div>

                <div className="question-bank-list">
                  {questionBanks.length === 0 && <p className="muted">No banks yet.</p>}
                  {questionBanks.map((b, idx) => (
                    <article key={b.title || idx} className="question-bank-item">
                      <div className="question-bank-item-head">
                        <h4>{b.title || `Bank ${idx + 1}`}</h4>
                        <div className="question-bank-options">
                          <button className="btn" onClick={() => openQuestionBankViewer(b)}>Open</button>
                        </div>
                      </div>
                      <p className="muted">{b.count} questions • {b.source_files?.join(", ")}</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          )}

          {page === "summarize" && (
            <section className="page active summarize-page">
              <div className="page-header">
                <div>
                  <h2>Summarize Resources</h2>
                  <p className="muted">Upload PDFs to generate a concise study summary.</p>
                </div>
                <button className="btn alt" type="button" onClick={() => navigate("exam")}>Back to Exam</button>
              </div>
              <div className="glass-card summarize-wrap">
                <div className="summarize-head">
                  <h3>Summary Builder</h3>
                </div>
                <div className="summarize-card">
                  <div className="summarize-form">
                    <input
                      placeholder="Optional topic"
                      value={summaryForm.topic}
                      onChange={(e) => setSummaryForm((prev) => ({ ...prev, topic: e.target.value }))}
                    />
                    <label className="summarize-upload-btn btn alt upload-btn">
                      Attach files
                      <input
                        type="file"
                        accept="application/pdf"
                        multiple
                        onChange={(e) => {
                          const files = e.target.files ? Array.from(e.target.files) : [];
                          setSummaryForm((prev) => ({ ...prev, files }));
                        }}
                      />
                    </label>
                    {summaryForm.files.length > 0 && (
                      <div className="uploaded-files">
                        <strong>Selected files:</strong>
                        <span>{summaryForm.files.map((file) => file.name).join(", ")}</span>
                      </div>
                    )}
                    <button
                      className="btn main"
                      onClick={async () => {
                        await summarizeFiles({ files: summaryForm.files, topic: summaryForm.topic });
                      }}
                      disabled={summaryLoading}
                    >
                      {summaryLoading ? "Summarizing..." : "Create Summary"}
                    </button>
                  </div>

                  {summaryResult && (
                    <div className="summarize-selected">
                      <div className="summary-output-card">
                        <div className="summary-output-header">
                          <h4>Summary {summaryResult.topic ? `(${summaryResult.topic})` : ""}</h4>
                          <button className="btn alt" type="button" onClick={exportSummaryPdf}>Save PDF</button>
                        </div>
                        <div className="summary-output">{renderMarkdown(summaryResult.summary)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {page === "home" && (
            <section className="page active">
              <div className="hero glass-card">
                <div className="hero-grid">
                  <div>
                    <h1>Welcome back, {student?.name || "Student"} 👋</h1>
                    <p>
                      Your custom learning cockpit is ready. Pick a subject, chat with your tutor,
                      and level up where it matters most.
                    </p>
                    <div className="hero-actions">
                      <button className="btn main" onClick={() => navigate("chat")}>Ask Tutor</button>
                      <button className="btn alt" onClick={() => navigate("quiz")}>Take Quiz</button>
                    </div>
                  </div>
                  <div className="hero-kpis">
                    <div className="hero-kpi">
                      <span>Quizzes Taken</span>
                      <strong>
                        {Object.values(student?.subject_stats || {}).reduce(
                          (acc, stat) => acc + Number(stat?.quizzes_taken || 0),
                          0
                        )}
                      </strong>
                    </div>
                    <div className="hero-kpi">
                      <span>Tracked Weak Topics</span>
                      <strong>
                        {Object.values(student?.subject_stats || {}).reduce(
                          (acc, stat) => acc + Number((stat?.weak_topics || []).length),
                          0
                        )}
                      </strong>
                    </div>
                    <div className="hero-kpi">
                      <span>Current Level</span>
                      <strong>{student?.level || "medium"}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="subject-grid">
                {Object.entries(subjects).map(([subject, info]) => (
                  <article key={subject} className={`subject-card ${info.color}`}>
                    <div className="subject-icon">{info.icon}</div>
                    <h3>{subject[0].toUpperCase() + subject.slice(1)}</h3>
                    <p>{info.description}</p>
                    <div className="subject-actions">
                      <button
                        className="btn main"
                        onClick={() => { setChatSubject(subject); navigate("chat"); }}
                      >
                        Start Learning
                      </button>
                      <button
                        className="btn alt"
                        onClick={() => { setQuizConfig((p) => ({ ...p, subject })); navigate("quiz"); }}
                      >
                        Take Quiz
                      </button>
                      <label className="btn alt upload-btn">
                        Upload PDF
                        <input
                          type="file"
                          accept="application/pdf"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPdf(subject, f); e.target.value = ""; }}
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>

              <div className="glass-card add-subject-wrap">
                <h3>Add New Subject</h3>
                <p className="muted">Create your own subject and use it in chat and quizzes.</p>
                <div className="add-subject-row">
                  <input
                    value={newSubjectName}
                    placeholder="Subject name"
                    onChange={(e) => setNewSubjectName(e.target.value)}
                  />
                  <input
                    value={newSubjectDescription}
                    placeholder="Short description (optional)"
                    onChange={(e) => setNewSubjectDescription(e.target.value)}
                  />
                  <input
                    value={newSubjectIcon}
                    placeholder="Icon"
                    maxLength={2}
                    onChange={(e) => setNewSubjectIcon(e.target.value)}
                  />
                  <button className="btn main" type="button" onClick={addCustomSubject}>
                    Add Subject
                  </button>
                </div>
              </div>

              {/* <div className="glass-card summary-wrap">
                <h3>Progress Snapshot</h3>
                <div className="summary-grid">
                  {Object.keys(subjects).map((subject) => (<div key={subject} className="summary-card"><strong>{subject}</strong></div>))}
                </div>
              </div> */}
            </section>
          )}

          {page === "chat" && (
            <section className="page active chat-page">
              <div className="chat-wrap">
                <div className="chat-header">
                  <div className="header-controls">
                    <div className="control-group">
                      <label>Topic (optional)</label>
                      <input
                        value={chatTopic}
                        placeholder="e.g. algebra"
                        onChange={(e) => setChatTopic(e.target.value)}
                      />
                    </div>
                    <div className="control-group notes-toggle-wrap">
                      <label>Notes</label>
                      <button
                        className="btn alt"
                        type="button"
                        onClick={() => setNotesOpen((x) => !x)}
                      >
                        {notesOpen ? "Hide Notes" : "Create Notes"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className={`chat-main ${notesOpen ? "notes-open" : ""}`}>
                  <aside className="chat-history">
                    <div className="chat-history-head">
                      <h4>Previous Chats</h4>
                      <button type="button" className="btn alt" onClick={startNewConversation}>
                        New Chat
                      </button>
                    </div>

                    <div className="chat-history-list">
                      {sortedSessions.length === 0 && (
                        <p className="chat-history-empty">No chats yet. Start asking questions.</p>
                      )}
                      {sortedSessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          className={`history-item ${session.id === selectedSessionId ? "active" : ""}`}
                          onClick={() => loadConversation(session.id)}
                        >
                          <strong>{session.title || "Untitled chat"}</strong>
                          <span>
                            {session.subject ? session.subject[0].toUpperCase() + session.subject.slice(1) : "General"}
                            {" • "}
                            {new Date(session.updatedAt).toLocaleString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  </aside>

                  <div className="chat-left">
                    <div
                      className="chat-feed"
                      ref={chatFeedRef}
                      onScroll={onChatScroll}
                      onMouseUp={onChatSelection}
                    >
                      {messages.length === 0 && (
                        <div className="empty-state">
                          Ask your first question to start chatting.
                        </div>
                      )}
                      {messages.map((msg, idx) => (
                        <article key={idx} className={`message-line ${msg.role}`}>
                          <section
                            className="message-body"
                            onDragStart={(e) => msg.role === "tutor" && onMessageDragStart(e, msg.text)}
                          >
                            {msg.role === "tutor" ? renderMarkdown(msg.text) : <p className="student-plain">{msg.text}</p>}
                            {msg.role === "tutor" && (
                              <div className="message-actions">
                                <button type="button" className="message-action-btn" onClick={() => runTutorAction("copy", msg.text)}>
                                  Copy
                                </button>
                                <button type="button" className="message-action-btn" onClick={() => runTutorAction("simplify", msg.text)} disabled={chatLoading}>
                                  Simplify
                                </button>
                                <button type="button" className="message-action-btn" onClick={() => runTutorAction("example", msg.text)} disabled={chatLoading}>
                                  Another Example
                                </button>
                                <button type="button" className="message-action-btn" onClick={() => runTutorAction("practice", msg.text)} disabled={chatLoading}>
                                  3 Practice Qs
                                </button>
                                <button type="button" className="message-action-btn" onClick={() => addNote(msg.text, "full-response")}>Add Full to Notes</button>
                              </div>
                            )}
                          </section>
                          {msg.role === "student" && (
                            <span className="avatar student">{initials(student?.name || "S")}</span>
                          )}
                        </article>
                      ))}

                      {chatLoading && (
                        <article className="message-line tutor loading-line">
                          <div className="thinking-dots">
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                        </article>
                      )}

                      {showJumpToLatest && (
                        <button className="jump-latest" onClick={jumpToLatest} type="button">
                          Jump to latest
                        </button>
                      )}
                    </div>

                    <div className="chat-input-section">
                      <div className="chat-input-row">
                        <textarea
                          className="chat-textarea"
                          value={chatInput}
                          placeholder="Type your question..."
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                        />
                        <div className="input-actions">
                          <select
                            className="input-model-select"
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            title={selectedModel}
                            aria-label="Select model"
                          >
                            <option value={DEFAULT_MODEL}>✨ {compactModelName(DEFAULT_MODEL)}</option>
                          </select>
                          <label className="btn alt attach-btn" title="Upload file or image">
                            ⎙
                            <input
                              type="file"
                              accept="application/pdf"
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleChatAttachment(f); e.target.value = ""; }}
                            />
                          </label>
                          <button
                            className={`btn main send-btn ${chatLoading ? "loading" : ""}`}
                            onClick={sendMessage}
                            disabled={chatLoading || !chatInput.trim()}
                            title="Send"
                          >
                            ➤
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {notesOpen && (
                    <aside className="notes-panel" onDragOver={(e) => e.preventDefault()} onDrop={onNotesDrop}>
                      <div className="notes-head">
                        <h4>Notes</h4>
                        <small>Select text/formulas or drag tutor blocks here.</small>
                      </div>
                      <div className="notes-actions">
                        <button type="button" className="btn alt" onClick={exportNotesWord}>Save Word</button>
                        <button type="button" className="btn alt" onClick={exportNotesPdf}>Save PDF</button>
                        <button type="button" className="btn alt" onClick={() => setNotesItems([])}>Clear</button>
                      </div>
                      <div className="notes-drop-hint">Drop here to add note</div>
                      <div className="notes-list">
                        {notesItems.length === 0 && <p className="notes-empty">No notes yet.</p>}
                        {notesItems.map((note, idx) => (
                          <article key={note.id} className="note-item" draggable onDragStart={(e) => onMessageDragStart(e, note.text)}>
                            <div className="note-top">
                              <strong>#{idx + 1}</strong>
                              <button type="button" className="message-action-btn" onClick={() => removeNote(note.id)}>Remove</button>
                            </div>
                            <pre className="note-text">{note.text}</pre>
                          </article>
                        ))}
                      </div>
                    </aside>
                  )}
                </div>

                {selectionDraft.open && (
                  <button
                    type="button"
                    className="selection-add-btn"
                    style={{ left: `${selectionDraft.x}px`, top: `${selectionDraft.y}px` }}
                    onClick={addSelectionToNotes}
                  >
                    Save to Notes
                  </button>
                )}
              </div>
            </section>
          )}

          {page === "quiz" && (
            <section className="page active">
              <div className="glass-card quiz-wrap">
                <div className="quiz-history-panel">
                  <div className="quiz-history-head">
                    <h3>Previous Quizzes</h3>
                    <small>Click any quiz to reopen results.</small>
                  </div>
                  <div className="quiz-history-list">
                    {quizHistory.length === 0 && (
                      <p className="quiz-history-empty">No previous quizzes yet.</p>
                    )}
                    {quizHistory.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`quiz-history-item ${selectedQuizHistoryId === entry.id ? "active" : ""}`}
                        onClick={() => loadQuizFromHistory(entry.id)}
                      >
                        <strong>
                          {(entry.subject || "general")[0].toUpperCase() + (entry.subject || "general").slice(1)}
                          {entry.topic ? ` • ${entry.topic}` : ""}
                        </strong>
                        <span>
                          Score: {Number(entry.score || 0)}/{Number(entry.total || 0)} ({Number(entry.percentage || 0).toFixed(1)}%)
                        </span>
                        <span>{new Date(entry.createdAt).toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="progress">
                  <span style={{ width: `${progressPct}%` }}></span>
                </div>

                {quizStep === 1 && (
                  <div className="wizard-step active">
                    <h3>Quiz Configuration</h3>
                    <div className="row">
                      <select
                        value={quizConfig.subject}
                        onChange={(e) => setQuizConfig((prev) => ({ ...prev, subject: e.target.value }))}
                      >
                        {Object.keys(subjects).map((s) => (
                          <option key={s} value={s}>
                            {s[0].toUpperCase() + s.slice(1)}
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder="Topic (e.g., Algebra)"
                        value={quizConfig.topic}
                        onChange={(e) => setQuizConfig((prev) => ({ ...prev, topic: e.target.value }))}
                      />
                      <select
                        value={quizConfig.difficulty}
                        onChange={(e) =>
                          setQuizConfig((prev) => ({ ...prev, difficulty: e.target.value }))
                        }
                      >
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={quizConfig.n_questions}
                        onChange={(e) =>
                          setQuizConfig((prev) => ({ ...prev, n_questions: Number(e.target.value || 5) }))
                        }
                      />
                      <button className="btn main" onClick={generateQuiz} disabled={quizLoading}>
                        {quizLoading ? "Generating..." : "Generate Quiz"}
                      </button>
                    </div>
                  </div>
                )}

                {quizStep === 2 && (
                  <div className="wizard-step active">
                    <h3>Answer Questions</h3>
                    <div>
                      {(quizData?.questions || []).map((q, idx) => (
                        <article key={q.id || idx} className="question-card">
                          <div className="question-title">
                            <h4>Q{idx + 1}</h4>
                            <div className="quiz-rich-text">{renderMarkdown(q.question || "")}</div>
                          </div>
                          {q.options.map((opt, optIdx) => (
                            <div
                              key={`${q.id || idx}-${optIdx}`}
                              className={`option ${answers[q.id] === opt ? "selected" : ""}`}
                              onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                            >
                              <strong>{String.fromCharCode(65 + optIdx)}.</strong>
                              <div className="option-text quiz-rich-text">{renderMarkdown(opt || "")}</div>
                            </div>
                          ))}
                        </article>
                      ))}
                    </div>
                    <button className="btn main" onClick={evaluateQuiz} disabled={quizLoading}>
                      {quizLoading ? "Submitting..." : "Submit Answers"}
                    </button>
                  </div>
                )}

                {quizStep === 3 && (
                  <div className="wizard-step active">
                    <h3>Results</h3>
                    <div className="score-wrap">
                      <svg className="score-svg" viewBox="0 0 120 120">
                        <defs>
                          <linearGradient id="scoreGradient" x1="0" x2="1" y1="0" y2="1">
                            <stop offset="0%" stopColor="#22d3a6" />
                            <stop offset="100%" stopColor="#5cc8ff" />
                          </linearGradient>
                        </defs>
                        <circle className="score-bg" cx="60" cy="60" r="48"></circle>
                        <circle
                          className="score-ring"
                          cx="60"
                          cy="60"
                          r="48"
                          style={{ strokeDasharray: circle, strokeDashoffset: dashOffset }}
                        ></circle>
                      </svg>
                      <div>
                        <h2>
                          {quizResult?.score}/{quizResult?.total} ({score.toFixed(1)}%)
                        </h2>
                        <p>
                          {score >= 85
                            ? "Excellent work. You are mastering this topic."
                            : score >= 60
                              ? "Solid progress. A bit more practice will lock it in."
                              : "Great attempt. We identified weak spots to improve next."}
                        </p>
                      </div>
                    </div>

                    <div className="results-list">
                      {(quizResult?.results || []).map((item, idx) => (
                        <article key={item.id || idx} className={`result-item ${item.is_correct ? "result-good" : "result-bad"}`}>
                          <div className="result-header">
                            <span className="result-number">Q{idx + 1}</span>
                            <span className="result-status">{item.is_correct ? "✓ Correct" : "✗ Incorrect"}</span>
                            <small className="result-topic">{item.topic}</small>
                          </div>
                          <div className="result-question">
                            <strong>Question:</strong>
                            <p>{item.question}</p>
                          </div>
                          <div className="result-answers">
                            <div className="answer-row">
                              <strong>Your Answer:</strong>
                              <span className={`answer-badge ${item.is_correct ? "correct" : "incorrect"}`}>
                                {item.selected || "Not answered"}
                              </span>
                            </div>
                            {!item.is_correct && (
                              <div className="answer-row">
                                <strong>Correct Answer:</strong>
                                <span className="answer-badge correct">{item.correct}</span>
                              </div>
                            )}
                          </div>
                          {item.explanation && (
                            <div className="result-explanation">
                              <strong>Explanation:</strong>
                              <p>{item.explanation}</p>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>

                    <button
                      className="btn alt"
                      onClick={() => { setQuizStep(1); setQuizData(null); setAnswers({}); setQuizResult(null); }}
                    >
                      Create Another Quiz
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {page === "exam" && (
            <section className="page active exam-page">
              <div className="glass-card exam-wrap">
                <h2>Exam Section</h2>
                <p className="muted">Select any resource type. Backend integration will be connected next.</p>

                <div className="exam-grid">
                  {EXAM_RESOURCES.map((item) => (
                    <article
                      key={item.id}
                      className={`exam-card ${activeExamResource === item.id ? "active" : ""}`}
                      onClick={() => {
                        if (item.id === "notes") return setPage("notes");
                        if (item.id === "question-bank") return setPage("question-bank");
                        if (item.id === "summarize") return setPage("summarize");
                        setPage("exam");
                        setActiveExamResource(item.id);
                      }}
                    >
                      <div className="exam-icon">{item.icon}</div>
                      <h3>{item.title}</h3>
                      <p>{item.desc}</p>
                      <button
                        type="button"
                        className="btn alt"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.id === "notes") return setPage("notes");
                          if (item.id === "question-bank") return setPage("question-bank");
                          if (item.id === "summarize") return setPage("summarize");
                          setPage("exam");
                          setActiveExamResource(item.id);
                        }}
                      >
                        {item.id === "notes" ? "Open Notes" : "Open"}
                      </button>
                    </article>
                  ))}
                </div>
                {/* resource panel removed in favor of dedicated pages for question-bank and summarize */}
              </div>
            </section>
          )}

          {page === "notes" && (
            <section className="page active notes-page">
              <div className="glass-card notes-page-wrap">
                <div className="notes-page-head">
                  <h2>Notes</h2>
                  <button type="button" className="btn alt" onClick={() => navigate("exam")}>Back to Exam</button>
                </div>

                <div className="notes-hub notes-hub-page">
                  <div className="notes-search-wrap">
                    <input
                      className="notes-search-input"
                      value={notesSearch}
                      onChange={(e) => setNotesSearch(e.target.value)}
                      placeholder="Search notes by title, subject, type..."
                    />
                  </div>

                  <div className="notes-tabs">
                    <button
                      type="button"
                      className={`notes-tab ${notesView === "user" ? "active" : ""}`}
                      onClick={() => setNotesView("user")}
                    >
                      User
                    </button>
                    <button
                      type="button"
                      className={`notes-tab ${notesView === "network" ? "active" : ""}`}
                      onClick={() => setNotesView("network")}
                    >
                      Network
                    </button>
                  </div>

                  <section className="notes-section-card">
                    <div className="notes-section-head">
                      <h4>{notesView === "user" ? "User Notes" : "Other User Notes"}</h4>
                    </div>

                    <div className="notes-list-grid">
                      {notesView === "user" && filteredUserNotes.length === 0 && (
                        <p className="notes-empty-state">No matching user notes.</p>
                      )}
                      {notesView === "network" && filteredSharedNotes.length === 0 && (
                        <p className="notes-empty-state">No matching shared notes.</p>
                      )}

                      {notesView === "user" && filteredUserNotes.map((note) => (
                        <article key={note.id} className="note-preview-card" onClick={() => setActiveNote(note)}>
                          <h5>{note.title}</h5>
                          <p>{note.subject}</p>
                          <small>{note.type}</small>
                          <p className="note-snippet">{note.snippet || note.text || ""}</p>
                          {note.createdAt && (
                            <small>{new Date(note.createdAt).toLocaleString()}</small>
                          )}
                        </article>
                      ))}

                      {notesView === "network" && filteredSharedNotes.map((note) => (
                        <article key={note.id} className="note-preview-card" onClick={() => setActiveNote(note)}>
                          <h5>{note.title}</h5>
                          <p>{note.subject}</p>
                          <small>{note.type} • by {note.owner}</small>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
              {activeNote && (
                <div className="notes-detail-modal" onClick={() => setActiveNote(null)}>
                  <div className="notes-detail-card" onClick={(e) => e.stopPropagation()}>
                    <div className="notes-detail-header">
                      <div>
                        <h3>{activeNote.title || "Note Detail"}</h3>
                        <p>{activeNote.subject || activeNote.type || "Note"}</p>
                      </div>
                      <button type="button" className="btn alt modal-close-btn" onClick={() => setActiveNote(null)}>
                        Close
                      </button>
                    </div>
                    <div className="notes-detail-body">{renderMarkdown(activeNote.text || activeNote.snippet || "")}</div>
                  </div>
                </div>
              )}
            </section>
          )}

          {page === "profile" && (
            <section className="page active">
              <div className="glass-card profile-head">
                <div className="avatar-lg">{initials(student?.name || "Student")}</div>
                <div>
                  <h2>{student?.name || "Student"}</h2>
                  <p>
                    <span className="badge">Level: {student?.level || "medium"}</span>
                  </p>
                  <p className="muted">Personalized progress profile and weak-topic tracker.</p>
                </div>
              </div>

              <div className="glass-card profile-edit">
                <h3>Student Profile</h3>
                <div className="profile-grid">
                  <input
                    placeholder="Student name"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))}
                  />
                  <select
                    value={profileForm.level}
                    onChange={(e) => setProfileForm((p) => ({ ...p, level: e.target.value }))}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                  <select
                    value={profileForm.grade}
                    onChange={(e) => setProfileForm((p) => ({ ...p, grade: e.target.value }))}
                  >
                    <option value="">Standard (optional)</option>
                    <option value="std-1">STD 1</option>
                    <option value="std-2">STD 2</option>
                    <option value="std-3">STD 3</option>
                    <option value="std-4">STD 4</option>
                    <option value="std-5">STD 5</option>
                    <option value="std-6">STD 6</option>
                    <option value="std-7">STD 7</option>
                    <option value="std-8">STD 8</option>
                    <option value="std-9">STD 9</option>
                    <option value="std-10">STD 10</option>
                    <option value="std-11">STD 11</option>
                    <option value="std-12">STD 12</option>
                  </select>
                  <input
                    placeholder="School"
                    value={profileForm.school}
                    onChange={(e) => setProfileForm((p) => ({ ...p, school: e.target.value }))}
                  />
                  <select
                    value={profileForm.board}
                    onChange={(e) => setProfileForm((p) => ({ ...p, board: e.target.value }))}
                  >
                    <option value="">Board (optional)</option>
                    <option value="cbse">CBSE</option>
                    <option value="icse">ICSE</option>
                    <option value="state">State Board</option>
                    <option value="ib">IB</option>
                    <option value="cambridge">Cambridge</option>
                  </select>
                  <input
                    placeholder="Target exam"
                    value={profileForm.target_exam}
                    onChange={(e) => setProfileForm((p) => ({ ...p, target_exam: e.target.value }))}
                  />
                  <select
                    value={profileForm.preferred_language}
                    onChange={(e) =>
                      setProfileForm((p) => ({ ...p, preferred_language: e.target.value }))
                    }
                  >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Bilingual">Bilingual</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    max="80"
                    placeholder="Study hours/week"
                    value={profileForm.study_hours_per_week}
                    onChange={(e) =>
                      setProfileForm((p) => ({
                        ...p,
                        study_hours_per_week: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <select
                    value={profileForm.learning_style}
                    onChange={(e) => setProfileForm((p) => ({ ...p, learning_style: e.target.value }))}
                  >
                    <option value="visual">Visual</option>
                    <option value="reading">Reading/Writing</option>
                    <option value="practice">Practice-first</option>
                    <option value="mixed">Mixed</option>
                  </select>
                  <input
                    placeholder="Guardian name"
                    value={profileForm.guardian_name}
                    onChange={(e) => setProfileForm((p) => ({ ...p, guardian_name: e.target.value }))}
                  />
                </div>
                <div className="profile-actions">
                  <button className="btn main" onClick={saveProfile} disabled={profileSaving}>
                    {profileSaving ? "Saving..." : "Save Profile"}
                  </button>
                  <button className="btn alt" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
              </div>

              <div className="profile-stats">
                {Object.keys(subjects).map((subject) => (<div key={subject}></div>))}
              </div>
            </section>
          )}
        </main>
      </div>

      {activeQuestionBank && (
        <div className={`modal active`} onClick={closeQuestionBankViewer}>
          <div className="modal-card question-bank-viewer-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>{activeQuestionBank.title}</h2>
                <small>{activeQuestionBank.subject} • {activeQuestionBank.count} questions</small>
              </div>
              <div className="modal-head-actions">
                <button className="btn alt" type="button" onClick={() => exportQuestionBankPdf(activeQuestionBank)}>Save PDF</button>
                <button className="btn alt modal-close-btn" type="button" onClick={closeQuestionBankViewer}>Close</button>
              </div>
            </div>
            <div className="question-bank-viewer-list">
              {(activeQuestionBank.questions || []).map((q, qi) => {
                const rawQuestion = typeof q === "string"
                  ? q
                  : q?.question ?? q?.prompt ?? q?.title ?? q?.statement ?? q?.text;

                const fallbackQuestionText = (() => {
                  if (typeof q !== "object" || q === null) return "";
                  const stringValues = Object.entries(q)
                    .filter(([, value]) => typeof value === "string" && value.trim().length > 8)
                    .map(([, value]) => value.trim());
                  return stringValues.find((value) => /question|prompt|statement|text|title/i.test(value)) || stringValues[0] || "";
                })();

                const questionText = String(rawQuestion ?? fallbackQuestionText ?? "").trim();
                const options = Array.isArray(q?.options) ? q.options : [];
                const explanation = typeof q === "string" ? "" : q?.explanation || q?.answer_explanation || q?.clarification || q?.details || "";

                return (
                  <div key={(typeof q === "object" && q?.id) ? q.id : qi} className="question-bank-viewer-item">
                    <div className="question-bank-viewer-header">
                      <span className="question-bank-viewer-label">Q{qi + 1}</span>
                    </div>
                    <div className="question-bank-viewer-content">
                      <div className="question-bank-viewer-question quiz-rich-text">
                        {renderMarkdown(questionText || "(Question text not available)")}
                      </div>
                      {options.length > 0 ? (
                        <div className="question-bank-viewer-options">
                          {options.map((opt, optIdx) => (
                            <div key={optIdx} className={`question-bank-viewer-option ${(typeof q === "object" && q.answer === opt) ? 'correct' : ''}`}>
                              <span className="question-bank-option-key">{String.fromCharCode(65 + optIdx)}.</span>
                              <div className="question-bank-option-body quiz-rich-text">{renderMarkdown(opt)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="question-bank-viewer-no-options">No answer options available.</div>
                      )}
                      {explanation && (
                        <div className="question-bank-viewer-explanation quiz-rich-text">
                          <strong>Explanation:</strong>
                          {renderMarkdown(explanation)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className={`modal ${onboardingOpen ? "active" : ""}`}>
        <div className="modal-card">
          <h2>Welcome to TutorFlow</h2>
          <p>Let us build your detailed student profile in one minute.</p>
          <div className="modal-fields">
            <input
              placeholder="Your name"
              value={onboardingName}
              onChange={(e) => setOnboardingName(e.target.value)}
            />
            <select value={onboardingLevel} onChange={(e) => setOnboardingLevel(e.target.value)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <select value={onboardingGrade} onChange={(e) => setOnboardingGrade(e.target.value)}>
              <option value="">Standard (optional)</option>
              <option value="std-1">STD 1</option>
              <option value="std-2">STD 2</option>
              <option value="std-3">STD 3</option>
              <option value="std-4">STD 4</option>
              <option value="std-5">STD 5</option>
              <option value="std-6">STD 6</option>
              <option value="std-7">STD 7</option>
              <option value="std-8">STD 8</option>
              <option value="std-9">STD 9</option>
              <option value="std-10">STD 10</option>
              <option value="std-11">STD 11</option>
              <option value="std-12">STD 12</option>
            </select>
            <input
              placeholder="School"
              value={onboardingSchool}
              onChange={(e) => setOnboardingSchool(e.target.value)}
            />
            <select value={onboardingBoard} onChange={(e) => setOnboardingBoard(e.target.value)}>
              <option value="">Board (optional)</option>
              <option value="cbse">CBSE</option>
              <option value="icse">ICSE</option>
              <option value="state">State Board</option>
              <option value="ib">IB</option>
              <option value="cambridge">Cambridge</option>
            </select>
            <input
              placeholder="Target exam (optional)"
              value={onboardingTargetExam}
              onChange={(e) => setOnboardingTargetExam(e.target.value)}
            />
            <select value={onboardingLanguage} onChange={(e) => setOnboardingLanguage(e.target.value)}>
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
              <option value="Bilingual">Bilingual</option>
            </select>
            <input
              type="number"
              min="0"
              max="80"
              placeholder="Study hours per week"
              value={onboardingHours}
              onChange={(e) => setOnboardingHours(Number(e.target.value || 0))}
            />
            <select value={onboardingStyle} onChange={(e) => setOnboardingStyle(e.target.value)}>
              <option value="visual">Visual</option>
              <option value="reading">Reading/Writing</option>
              <option value="practice">Practice-first</option>
              <option value="mixed">Mixed</option>
            </select>
            <input
              placeholder="Guardian name"
              value={onboardingGuardian}
              onChange={(e) => setOnboardingGuardian(e.target.value)}
            />
            <button className="btn main" onClick={createStudentProfile} disabled={onboardingBusy}>
              {onboardingBusy ? "Creating..." : "Start Learning"}
            </button>
          </div>
        </div>
      </div>

      <Toasts toasts={toasts} />
    </>
  );
}
