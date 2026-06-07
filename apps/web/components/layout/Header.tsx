"use client";

import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { StockItem, AlertNotification, WatchlistState } from "@/lib/api";
import { searchStocks, getMarketIndices, alertsApi, watchlistApi } from "@/lib/api";
import { usePushNotification } from "@/hooks/usePushNotification";

const AuthButton = dynamic(() => import("@/components/auth/AuthButton"), { ssr: false });

// ── Web Push 訂閱按鈕 ─────────────────────────────────────────────────────────
function PushSubscribeButton() {
  const { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe } =
    usePushNotification();
  const [tooltip, setTooltip] = useState("");

  if (!isSupported || permission === "unsupported") return null;

  function getUserId(): string | null {
    try { return localStorage.getItem("stockpulse_user_id"); } catch { return null; }
  }

  async function handleClick() {
    const userId = getUserId();
    if (!userId) {
      setTooltip("請先登入以啟用推播");
      setTimeout(() => setTooltip(""), 2000);
      return;
    }
    if (isSubscribed) {
      const ok = await unsubscribe(userId);
      setTooltip(ok ? "已關閉背景推播" : "取消失敗，請重試");
    } else {
      if (permission === "denied") {
        setTooltip("瀏覽器封鎖通知，請點網址列🔒解除");
        setTimeout(() => setTooltip(""), 3500);
        return;
      }
      try {
        const ok = await subscribe(userId);
        setTooltip(ok ? "✅ 背景推播已啟用！" : "啟用失敗，請稍後再試");
      } catch (err) {
        if (err instanceof Error && err.message === "VAPID_NOT_READY") {
          setTooltip("後端部署中，請等幾分鐘再試");
        } else {
          setTooltip("啟用失敗，請稍後再試");
        }
      }
    }
    setTimeout(() => setTooltip(""), 3000);
  }

  const active = isSubscribed;
  const label  = isSubscribed ? "關閉到價推播" : "開啟到價推播";

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={isLoading}
        title={label}
        aria-label={label}
        className="flex items-center justify-center w-7 h-7 rounded transition-colors shrink-0"
        style={{
          background: active ? "rgba(59,130,246,0.15)" : "var(--bg-elevated)",
          color:      active ? "var(--color-brand)"    : "var(--text-secondary)",
          border:     `1px solid ${active ? "var(--color-brand)" : "var(--border)"}`,
          opacity:    isLoading ? 0.5 : 1,
        }}
      >
        {/* Broadcast / Push icon（區別於到價通知鈴鐺）*/}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* 手機 */}
          <rect x="7" y="2" width="10" height="16" rx="2"/>
          <line x1="12" y1="18" x2="12" y2="20"/>
          {/* 訊號弧線 */}
          <path d="M4 6.5 A9 9 0 0 1 20 6.5" opacity={active ? "1" : "0.4"}/>
          <path d="M6.5 9.5 A6 6 0 0 1 17.5 9.5" opacity={active ? "1" : "0.4"}/>
        </svg>
      </button>
      {tooltip && (
        <div
          className="absolute right-0 top-9 z-50 whitespace-nowrap rounded px-2 py-1 text-xs"
          style={{
            background: "var(--bg-elevated)",
            border:     "1px solid var(--border)",
            color:      "var(--text-primary)",
            boxShadow:  "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

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

// ── Ticker Tape（跑馬燈）────────────────────────────────────────────────────
interface TickerItem {
  key: string;
  label: string;
  price: string;
  change: number | null;
  changePct: number | null;
}

function TickerTape() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await getMarketIndices();
        const idxItems: TickerItem[] = res.indices.map((idx) => ({
          key: idx.id,
          label: `${idx.flag} ${idx.name}`,
          price: idx.price != null ? idx.price.toLocaleString() : "--",
          change: idx.change ?? null,
          changePct: idx.change_pct ?? null,
        }));
        if (!cancelled) setItems(idxItems);
      } catch {
        if (!cancelled) setItems([]);
      }
    }

    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (items.length === 0) return null;

  // 複製兩份讓捲動無縫
  const all = [...items, ...items];
  const duration = Math.max(items.length * 6, 36);

  return (
    <div
      className="shrink-0 overflow-hidden relative"
      style={{
        height: "34px",
        background: "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* 左右漸層遮罩 */}
      <div style={{
        position: "absolute", top: 0, left: 0, bottom: 0, width: "60px", zIndex: 2,
        background: "linear-gradient(90deg, var(--bg-surface), transparent)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: "60px", zIndex: 2,
        background: "linear-gradient(270deg, var(--bg-surface), transparent)",
        pointerEvents: "none",
      }} />

      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-inner {
          display: inline-flex;
          animation: ticker-scroll ${duration}s linear infinite;
          white-space: nowrap;
          height: 34px;
          align-items: center;
        }
        .ticker-inner:hover { animation-play-state: paused; }
      `}</style>
      <div className="ticker-inner">
        {all.map((item, i) => {
          const isUp   = item.change != null && item.change > 0;
          const isDown = item.change != null && item.change < 0;
          const upColor   = "var(--color-up)";
          const downColor = "var(--color-down)";
          const color  = isUp ? upColor : isDown ? downColor : "var(--text-secondary)";
          const arrow  = isUp ? "▲" : isDown ? "▼" : "";
          const glowStyle = isUp
            ? { textShadow: "0 0 8px rgba(239,68,68,0.6), 0 0 20px rgba(239,68,68,0.3)" }
            : isDown
            ? { textShadow: "0 0 8px rgba(34,197,94,0.6), 0 0 20px rgba(34,197,94,0.3)" }
            : {};
          return (
            <span
              key={`${item.key}-${i}`}
              className="inline-flex items-center gap-2"
              style={{
                padding: "0 20px",
                height: "34px",
                borderRight: "1px solid var(--border)",
                fontSize: "12px",
                gap: "8px",
              }}
            >
              <span style={{
                color: "var(--text-tertiary)",
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                letterSpacing: "0.05em",
                fontSize: "11px",
              }}>
                {item.label}
              </span>
              {item.price !== "--" && (
                <span className="num" style={{
                  color: color,
                  fontWeight: 700,
                  fontSize: "13px",
                  ...glowStyle,
                }}>
                  {item.price}
                </span>
              )}
              {item.changePct != null && (
                <span className="num" style={{
                  color,
                  fontSize: "11px",
                  fontWeight: 600,
                  ...glowStyle,
                }}>
                  {arrow}{Math.abs(item.changePct).toFixed(2)}%
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface HeaderProps {
  onSelectStock: (symbol: string, name: string) => void;
  currentSymbol?: string;
  currentName?: string;
}

export default function Header({ onSelectStock, currentSymbol, currentName }: HeaderProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { theme, toggle } = useTheme();

  // ── 自選股快速浮層 ────────────────────────────────────────────────────────
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const watchlistPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 先讀 localStorage 快速顯示
    try {
      const raw = localStorage.getItem("stockpulse_watchlist_v2");
      if (raw) {
        const state = JSON.parse(raw) as { items?: Record<string, { symbol: string }[]>; groups?: unknown[] };
        if (state.items) {
          const syms = Object.values(state.items).flat().map((i) => i.symbol);
          setWatchlistSymbols(syms);
        }
      }
    } catch {}
    // 再從 Supabase 同步
    watchlistApi.get().then((remote) => {
      const syms = Object.values(remote.items).flat().map((i) => i.symbol);
      setWatchlistSymbols(syms);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!watchlistOpen) return;
    function handleClick(e: MouseEvent) {
      if (watchlistPanelRef.current && !watchlistPanelRef.current.contains(e.target as Node)) {
        setWatchlistOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [watchlistOpen]);

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
        className="flex items-center gap-3 px-4 border-b"
        style={{
          height: "var(--header-h)",
          borderColor: "var(--border)",
        }}
      >
        {/* Logo — 漸層發光版 */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 800,
              fontSize: "14px",
              letterSpacing: "2px",
              background: "linear-gradient(135deg, #60a5fa 0%, #818cf8 50%, #a78bfa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              filter: "drop-shadow(0 0 6px rgba(99,102,241,0.5))",
            }}
          >
            JAYSTOCK
          </span>
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--color-down)",
              boxShadow: "0 0 8px var(--color-down), 0 0 16px rgba(34,197,94,0.4)",
              animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
            }}
            title="市場資料更新中"
          />
        </div>

        {/* 當前股票 chip */}
        {currentSymbol && (
          <div
            className="flex items-center gap-2 shrink-0 px-2 py-1"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              fontSize: "12px",
            }}
          >
            <span className="num font-bold" style={{ color: "var(--color-brand)", letterSpacing: "0.05em" }}>
              {currentSymbol}
            </span>
            {currentName && (
              <span style={{ color: "var(--text-secondary)" }}>{currentName}</span>
            )}
          </div>
        )}

        {/* 分隔 */}
        <div style={{ width: "1px", height: "18px", background: "var(--border)", flexShrink: 0 }} />

        <div className="relative flex-1 min-w-0 max-w-sm">
          <input
            ref={inputRef}
            type="text"
            placeholder="搜尋股票代號或名稱..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            className="w-full h-8 px-3 text-sm outline-none"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-sans)",
            }}
          />
          {open && (
            <div
              className="absolute top-full left-0 right-0 mt-1 overflow-hidden z-50 shadow-lg"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
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

        {/* 自選股快速浮層 */}
        <div className="ml-auto relative" ref={watchlistPanelRef}>
          <button
            onClick={() => setWatchlistOpen((v) => !v)}
            title="快速切換自選股"
            className="flex items-center gap-1.5 h-7 px-3 transition-colors shrink-0"
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: watchlistOpen ? "var(--color-brand)" : "var(--text-secondary)",
              background: watchlistOpen ? "rgba(59,130,246,0.1)" : "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            ☆ 自選股
            {watchlistSymbols.length > 0 && (
              <span className="num" style={{ color: "var(--text-tertiary)", fontSize: "10px" }}>
                ({watchlistSymbols.length})
              </span>
            )}
          </button>

          {watchlistOpen && (
            <div
              className="absolute right-0 top-full mt-1.5 overflow-hidden z-50"
              style={{
                width: "180px",
                maxHeight: "320px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-md)",
                boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
                overflowY: "auto",
              }}
            >
              <div className="px-3 py-2 border-b" style={{ borderColor: "var(--border)", fontSize: "10px", color: "var(--text-tertiary)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                自選股
              </div>
              {watchlistSymbols.length === 0 ? (
                <div className="px-3 py-4 text-center" style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                  尚未加入自選股
                </div>
              ) : (
                watchlistSymbols.map((sym) => (
                  <button
                    key={sym}
                    onClick={() => { onSelectStock(sym, ""); setWatchlistOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 border-b transition-colors"
                    style={{
                      borderColor: "var(--border)",
                      background: sym === currentSymbol ? "rgba(59,130,246,0.08)" : "transparent",
                      fontSize: "12px",
                    }}
                  >
                    <span
                      className="num font-bold"
                      style={{
                        color: sym === currentSymbol ? "var(--color-brand)" : "var(--text-primary)",
                        letterSpacing: "0.03em",
                      }}
                    >
                      {sym}
                    </span>
                    {sym === currentSymbol && (
                      <span style={{ fontSize: "9px", color: "var(--color-brand)", marginLeft: "auto" }}>▶</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Google 登入/登出按鈕 */}
        <div className="flex items-center gap-2">
          <AuthButton />

          {/* Price Alert Notifications */}
          <NotificationBell />

          {/* Web Push 訂閱按鈕 */}
          <PushSubscribeButton />

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

      {/* Row 2: Ticker tape（大盤指數 + 自選股滾動行情）*/}
      <TickerTape />
    </div>
  );
}
