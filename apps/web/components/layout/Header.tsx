"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { StockItem, IndexQuote, AlertNotification } from "@/lib/api";
import { searchStocks, getMarketIndices, alertsApi } from "@/lib/api";

const AuthButton = dynamic(() => import("@/components/auth/AuthButton"), { ssr: false });

// ── Theme Toggle ──────────────────────────────────────────────────────────────
function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const t = (document.documentElement.dataset.theme || "dark") as "dark" | "light";
    setTheme(t);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("stockpulse_theme", next); } catch {}
  }

  return { theme, toggle };
}

// ── Notification Bell ─────────────────────────────────────────────────────────
function NotificationBell() {
  const [notifications, setNotifications] = useState<AlertNotification[]>([]);
  const [open, setOpen]                   = useState(false);
  const panelRef                          = useRef<HTMLDivElement>(null);

  // Poll unread alerts every 60s
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await alertsApi.getUnread();
        if (!cancelled) setNotifications(res.notifications);
      } catch {}
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleMarkAll() {
    try {
      await alertsApi.markAllRead();
      setNotifications([]);
    } catch {}
  }

  async function handleDelete(id: string) {
    try {
      await alertsApi.delete(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {}
  }

  async function handleMarkOne(id: string) {
    try {
      await alertsApi.markRead(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {}
  }

  const unread = notifications.length;

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        title={unread > 0 ? `${unread} 則未讀警報` : "到價提醒"}
        className="relative flex items-center justify-center w-7 h-7 rounded transition-colors shrink-0"
        style={{
          background: open ? "var(--bg-elevated)" : "transparent",
          color:      "var(--text-secondary)",
          border:     "1px solid var(--border)",
        }}
        aria-label="到價提醒通知"
      >
        🔔
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center rounded-full text-[9px] font-bold"
            style={{ background: "var(--color-down)", color: "#fff" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 w-72 rounded-lg shadow-xl z-50 overflow-hidden"
          style={{
            background: "var(--bg-surface)",
            border:     "1px solid var(--border)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              到價提醒 {unread > 0 && <span style={{ color: "var(--color-down)" }}>({unread})</span>}
            </span>
            {unread > 0 && (
              <button
                onClick={handleMarkAll}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "var(--color-brand)", background: "var(--bg-elevated)" }}
              >
                全部已讀
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
                暫無未讀提醒
              </div>
            ) : (
              notifications.map((n) => {
                const isAbove  = n.alert_type === "above";
                const color    = isAbove ? "var(--color-up)" : "var(--color-down)";
                const arrow    = isAbove ? "▲" : "▼";
                const label    = isAbove ? "突破" : "跌破";
                const dateStr  = new Date(n.created_at).toLocaleString("zh-TW", {
                  month: "2-digit", day: "2-digit",
                  hour:  "2-digit", minute: "2-digit",
                });
                return (
                  <div
                    key={n.id}
                    className="flex items-start gap-2 px-3 py-2.5 border-b"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {/* Icon */}
                    <span className="text-base shrink-0 mt-0.5" style={{ color }}>
                      {arrow}
                    </span>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs" style={{ color: "var(--text-primary)" }}>
                        <span className="num font-semibold">{n.symbol}</span>
                        {" "}
                        <span style={{ color }}>{label} {n.threshold}</span>
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        觸發價 <span className="num">{n.price}</span>
                        {" · "}{dateStr}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        onClick={() => handleMarkOne(n.id)}
                        className="text-[9px] px-1.5 py-0.5 rounded leading-none"
                        style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
                        title="標記已讀"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => handleDelete(n.id)}
                        className="text-[9px] px-1.5 py-0.5 rounded leading-none"
                        style={{ background: "var(--bg-elevated)", color: "var(--color-down)" }}
                        title="刪除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-1.5 text-[9px]" style={{ color: "var(--text-tertiary)", borderTop: "1px solid var(--border)" }}>
            盤中每 5 分鐘檢查 · 觸發後自動清除設定
          </div>
        </div>
      )}
    </div>
  );
}

// ── Market Indices Bar ────────────────────────────────────────────────────────
function IndicesBar() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await getMarketIndices();
        if (!cancelled) setIndices(res.indices);
      } catch {}
    }
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (indices.length === 0) return null;

  return (
    <div
      className="flex items-center gap-5 px-4 overflow-x-auto shrink-0"
      style={{
        height: "28px",
        background: "var(--bg-elevated)",
        borderBottom: "1px solid var(--border)",
        fontSize: "11px",
      }}
    >
      {indices.map((idx) => {
        const pct = idx.change_pct;
        const color =
          pct == null ? "var(--text-secondary)"
          : pct > 0   ? "var(--color-up)"
          : pct < 0   ? "var(--color-down)"
          :              "var(--text-secondary)";
        const arrow = pct == null ? "" : pct > 0 ? "▲" : pct < 0 ? "▼" : "";
        return (
          <div key={idx.id} className="flex items-center gap-1 shrink-0">
            <span style={{ color: "var(--text-tertiary)" }}>
              {idx.flag} {idx.name}
            </span>
            {idx.price != null && (
              <span className="num font-medium" style={{ color: "var(--text-primary)" }}>
                {idx.price.toLocaleString()}
              </span>
            )}
            {pct != null && (
              <span className="num" style={{ color }}>
                {arrow}{Math.abs(pct).toFixed(2)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface HeaderProps {
  onSelectStock: (symbol: string, name: string) => void;
}

export default function Header({ onSelectStock }: HeaderProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await searchStocks(query);
        setResults(res.data);
        setOpen(res.data.length > 0);
        setActiveIdx(-1);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  function select(item: StockItem) {
    onSelectStock(item.symbol, item.name);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      select(results[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="shrink-0" style={{ background: "var(--bg-surface)" }}>
      {/* Row 1: Logo + Search + Auth */}
      <header
        className="flex items-center gap-4 px-4 border-b"
        style={{
          height: "var(--header-h)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-center gap-2 font-semibold text-lg">
          <span style={{ color: "var(--color-brand)" }}>StockPulse</span>
        </div>

        <div className="relative flex-1 min-w-0 max-w-md">
          <input
            ref={inputRef}
            type="text"
            placeholder="搜尋股票代號或名稱... (如 2330、台積電)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            className="w-full h-8 px-3 text-sm rounded-md outline-none"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
            }}
          />
          {open && (
            <div
              className="absolute top-full left-0 right-0 mt-1 rounded-md overflow-hidden z-50 shadow-lg"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
              }}
            >
              {results.map((item, i) => (
                <button
                  key={item.symbol}
                  className="flex items-center gap-3 w-full px-3 py-2 text-sm text-left"
                  style={{
                    background:
                      i === activeIdx ? "var(--bg-elevated)" : "transparent",
                    color: "var(--text-primary)",
                  }}
                  onMouseDown={() => select(item)}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <span className="num font-medium w-14">{item.symbol}</span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {item.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Google 登入/登出按鈕 */}
        <div className="ml-auto flex items-center gap-2">
          <AuthButton />

          {/* Price Alert Notifications */}
          <NotificationBell />

          {/* Theme Toggle */}
          <button
            onClick={toggle}
            title={theme === "dark" ? "切換淺色模式" : "切換深色模式"}
            className="flex items-center justify-center w-7 h-7 rounded transition-colors text-base shrink-0"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
            aria-label={theme === "dark" ? "切換淺色模式" : "切換深色模式"}
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </header>

      {/* Row 2: Market indices ticker */}
      <IndicesBar />
    </div>
  );
}
