import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "./utils/markdownParser";
import "./Chat.css";

function getInitials(name = "Student") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function formatTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Chat({
  apiBase,
  studentId,
  student,
  subjects = {
    math: { icon: "M" },
    science: { icon: "S" },
    history: { icon: "H" },
  },
  initialSubject = "math",
  model = "models/gemini-2.5-flash-lite",
  onUpload,
  onToast,
}) {
  const [chatSubject, setChatSubject] = useState(initialSubject);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState([]);

  const feedRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const lineHeight = 22;
    const maxRows = 5;
    const maxHeight = lineHeight * maxRows;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [chatInput]);

  useEffect(() => {
    if (!feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages, chatLoading]);

  function toast(message, type = "error") {
    if (typeof onToast === "function") {
      onToast(message, type);
    }
  }

  async function sendMessage() {
    const question = chatInput.trim();
    if (!question || chatLoading) return;
    if (!studentId) {
      toast("Create a profile first", "error");
      return;
    }

    const studentMsg = { role: "student", text: question, ts: Date.now() };
    setMessages((prev) => [...prev, studentMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const response = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          subject: chatSubject,
          question,
          model,
        }),
      });

      if (!response.ok) {
        let detail = "Chat failed";
        try {
          const payload = await response.json();
          detail = payload.detail || detail;
        } catch {
          detail = await response.text();
        }
        throw new Error(detail);
      }

      const payload = await response.json();
      setMessages((prev) => [
        ...prev,
        { role: "tutor", text: payload.answer || "No response", ts: Date.now() },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "tutor", text: `I hit an error: ${err.message}`, ts: Date.now() },
      ]);
      toast("Chat failed", "error");
    } finally {
      setChatLoading(false);
    }
  }

  async function handleAttachment(file) {
    if (!file) return;

    try {
      if (typeof onUpload === "function") {
        await onUpload(chatSubject, file);
      }

      setMessages((prev) => [
        ...prev,
        { role: "student", text: `Uploaded: ${file.name}`, ts: Date.now() },
      ]);
    } catch (err) {
      toast(`Upload failed: ${err.message}`, "error");
    }
  }

  return (
    <section className="chat-root">
      <header className="chat-header">
        <div className="chat-title">
          <h3>Tutor Chat</h3>
          <small>Ask me anything about {chatSubject}</small>
        </div>

        <div className="chat-controls">
          <div className="chat-control">
            <label>Model</label>
            <select value={model} disabled>
              <option value="models/gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
            </select>
          </div>

          <div className="chat-control">
            <label>Subject</label>
            <select value={chatSubject} onChange={(e) => setChatSubject(e.target.value)}>
              {Object.keys(subjects).map((s) => (
                <option key={s} value={s}>
                  {subjects[s]?.icon || "*"} {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="chat-feed" ref={feedRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">🤖</div>
            <div>Ask me anything about {chatSubject}</div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <article key={`${msg.role}-${idx}-${msg.ts || idx}`} className={`chat-row ${msg.role}`}>
            <div className="chat-bubble">
              {msg.role === "tutor" && <div className="chat-avatar tutor">TF</div>}

              <div className="chat-content">
                <div className="chat-text">
                  {msg.role === "tutor" ? renderMarkdown(msg.text) : msg.text}
                </div>
                <div className="chat-meta">{formatTime(msg.ts)}</div>
              </div>

              {msg.role === "student" && (
                <div className="chat-avatar tutor">{getInitials(student?.name || "Student")}</div>
              )}
            </div>
          </article>
        ))}

        {chatLoading && (
          <article className="chat-row tutor">
            <div className="chat-bubble">
              <div className="chat-avatar tutor">TF</div>
              <div className="chat-content">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div className="chat-meta">{formatTime(Date.now())}</div>
              </div>
            </div>
          </article>
        )}
      </div>

      <footer className="chat-input-shell">
        <div className="chat-input-wrap">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            value={chatInput}
            placeholder="Type your question..."
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />

          <div className="chat-actions">
            <button
              type="button"
              className="chat-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Upload file"
              aria-label="Upload file"
            >
              📎
            </button>

            <button
              type="button"
              className="chat-icon-btn send"
              onClick={sendMessage}
              disabled={chatLoading || !chatInput.trim()}
              title="Send"
              aria-label="Send message"
            >
              ➤
            </button>

            <input
              ref={fileInputRef}
              className="chat-file-input"
              type="file"
              accept="application/pdf,image/*,*/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAttachment(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </footer>
    </section>
  );
}
