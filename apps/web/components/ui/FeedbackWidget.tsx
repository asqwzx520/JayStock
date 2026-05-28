"use client";

/**
 * FeedbackWidget — Beta 用戶回饋按鈕
 *
 * 右下角浮動按鈕；點擊後展開表單。
 * POST /api/v1/feedback  →  FastAPI 後端紀錄
 */

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Category = "bug" | "feature" | "ux" | "other";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "bug",     label: "🐛 Bug 回報" },
  { value: "feature", label: "💡 功能建議" },
  { value: "ux",      label: "🎨 UX 意見" },
  { value: "other",   label: "💬 其他" },
];

export default function FeedbackWidget() {
  const [open,     setOpen]     = useState(false);
  const [category, setCategory] = useState<Category>("feature");
  const [message,  setMessage]  = useState("");
  const [contact,  setContact]  = useState("");
  const [status,   setStatus]   = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;

    setStatus("sending");
    try {
      const res = await fetch(`${API_BASE}/api/v1/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.trim(),
          contact: contact.trim() || null,
          url: window.location.href,
          ua:  navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setStatus("sent");
      setTimeout(() => {
        setOpen(false);
        setStatus("idle");
        setMessage("");
        setContact("");
      }, 2000);
    } catch (err) {
      console.error("[Feedback]", err);
      setStatus("error");
    }
  }

  return (
    <>
      {/* ── 浮動觸發按鈕 ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="開啟回饋表單"
        title="意見回饋"
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg
                   flex items-center justify-center text-lg
                   transition-transform hover:scale-110 active:scale-95"
        style={{
          background: "var(--color-brand)",
          color: "#fff",
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}
      >
        {open ? "✕" : "💬"}
      </button>

      {/* ── 回饋面板 ── */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 rounded-xl shadow-2xl p-4 flex flex-col gap-3"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
              意見回饋
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(251,191,36,0.15)", color: "#FBBF24" }}>
              Beta
            </span>
          </div>

          {status === "sent" ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <span className="text-3xl">🎉</span>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>感謝您的回饋！</p>
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>我們會認真評估每一則建議</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {/* Category */}
              <div className="grid grid-cols-2 gap-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className="px-2 py-1.5 rounded text-xs font-medium transition-colors text-left"
                    style={{
                      background:
                        category === c.value
                          ? "var(--color-brand)"
                          : "var(--bg-surface)",
                      color:
                        category === c.value
                          ? "#fff"
                          : "var(--text-secondary)",
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* Message */}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="請描述您的回饋…"
                rows={4}
                required
                className="w-full text-sm p-2 rounded resize-none"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  outline: "none",
                }}
              />

              {/* Contact (optional) */}
              <input
                type="email"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Email（選填，方便我們回覆）"
                className="w-full text-xs p-2 rounded"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  outline: "none",
                }}
              />

              {status === "error" && (
                <p className="text-xs" style={{ color: "var(--color-up)" }}>
                  送出失敗，請稍後再試
                </p>
              )}

              <button
                type="submit"
                disabled={status === "sending" || !message.trim()}
                className="w-full py-2 rounded text-sm font-medium transition-opacity disabled:opacity-50"
                style={{ background: "var(--color-brand)", color: "#fff" }}
              >
                {status === "sending" ? "送出中…" : "送出回饋"}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
