"use client";

/**
 * CalendarView — 財報 / 除權息月曆
 *
 * 顯示自選股未來 30 天的事件：
 *   🟡 exdiv   除息日
 *   🔵 earnings 財報公布
 *   🟢 agm     股東常會
 *
 * 資料從 /api/v1/calendar 取得，每 6 小時快取（後端負責）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getCalendar, type CalendarEvent, type CalendarEventType } from "@/lib/api";

// ── localStorage helpers (same pattern as HomeDashboard) ─────────────────────
const LS_KEY = "stockpulse_watchlist_v2";

interface WatchlistItem  { symbol: string; name: string }
interface WatchlistState { items: Record<string, WatchlistItem[]> }

function loadWatchlistSymbols(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const state = JSON.parse(raw) as WatchlistState;
    const seen  = new Set<string>();
    const syms: string[] = [];
    Object.values(state.items ?? {}).forEach((items) =>
      items.forEach((it) => {
        if (!seen.has(it.symbol)) { seen.add(it.symbol); syms.push(it.symbol); }
      })
    );
    return syms;
  } catch { return []; }
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const EVENT_STYLES: Record<CalendarEventType, { bg: string; text: string; dot: string }> = {
  exdiv:    { bg: "rgba(251,191,36,0.15)",  text: "#fbbf24", dot: "#fbbf24" },  // amber
  earnings: { bg: "rgba(59,130,246,0.15)",  text: "#60a5fa", dot: "#60a5fa" },  // blue
  agm:      { bg: "rgba(34,197,94,0.15)",   text: "#4ade80", dot: "#4ade80" },  // green
};

const EVENT_ICON: Record<CalendarEventType, string> = {
  exdiv:    "💰",
  earnings: "📋",
  agm:      "🏛️",
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Build a list of 35 calendar cells (5 weeks) starting from Sunday of today's week */
function buildCalendarGrid(today: Date): Date[] {
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay()); // go back to Sunday
  return Array.from({ length: 35 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EventChip({ ev }: { ev: CalendarEvent }) {
  const s = EVENT_STYLES[ev.type];
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1 py-0.5 rounded leading-tight truncate max-w-full"
      style={{ background: s.bg, color: s.text }}
      title={`${ev.symbol} ${ev.name}｜${ev.label}${ev.value ? `｜${ev.value}元` : ""}`}
    >
      <span>{ev.symbol}</span>
      <span style={{ opacity: 0.7 }}>{ev.label.slice(0, 2)}</span>
    </span>
  );
}

function CalendarCell({
  day,
  isToday,
  isThisMonth,
  isInWindow,
  events,
  onSelect,
  selected,
}: {
  day:          Date;
  isToday:      boolean;
  isThisMonth:  boolean;
  isInWindow:   boolean;
  events:       CalendarEvent[];
  onSelect:     (d: string) => void;
  selected:     string | null;
}) {
  const iso     = isoDate(day);
  const hasSel  = selected === iso;
  const dimmed  = !isInWindow;

  return (
    <div
      onClick={() => events.length > 0 && onSelect(iso)}
      className="min-h-[72px] p-1 rounded-lg flex flex-col gap-0.5 transition-colors cursor-default"
      style={{
        background: hasSel
          ? "rgba(99,102,241,0.12)"
          : events.length > 0
            ? "var(--bg-elevated)"
            : "transparent",
        border:  hasSel ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent",
        opacity: dimmed ? 0.35 : 1,
        cursor:  events.length > 0 ? "pointer" : "default",
      }}
    >
      {/* Day number */}
      <div
        className="w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium self-end shrink-0"
        style={{
          background: isToday ? "var(--color-brand)" : "transparent",
          color: isToday
            ? "#fff"
            : isThisMonth
              ? "var(--text-primary)"
              : "var(--text-tertiary)",
        }}
      >
        {day.getDate()}
      </div>

      {/* Event chips — max 3 shown */}
      <div className="flex flex-col gap-0.5 min-w-0 w-full">
        {events.slice(0, 3).map((ev, i) => (
          <EventChip key={i} ev={ev} />
        ))}
        {events.length > 3 && (
          <span className="text-[9px] pl-0.5" style={{ color: "var(--text-tertiary)" }}>
            +{events.length - 3} 更多
          </span>
        )}
      </div>
    </div>
  );
}

// ── Detail panel shown when a day is clicked ──────────────────────────────────

function DayDetail({ dateStr, events, onClose }: { dateStr: string; events: CalendarEvent[]; onClose: () => void }) {
  const d = parseYMD(dateStr);
  const label = `${d.getMonth() + 1}月${d.getDate()}日`;

  return (
    <div
      className="mt-4 rounded-xl p-4"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {label} 的事件（{events.length} 筆）
        </span>
        <button
          onClick={onClose}
          className="text-xs px-2 py-0.5 rounded"
          style={{ color: "var(--text-tertiary)", background: "var(--bg-surface)" }}
        >
          ✕
        </button>
      </div>
      <div className="space-y-2">
        {events.map((ev, i) => {
          const s = EVENT_STYLES[ev.type];
          return (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2 rounded-lg"
              style={{ background: s.bg }}
            >
              <span className="text-base">{EVENT_ICON[ev.type]}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium" style={{ color: s.text }}>
                  {ev.symbol} {ev.name}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {ev.label}{ev.value ? `｜每股 ${ev.value} 元` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {(Object.entries(EVENT_STYLES) as [CalendarEventType, typeof EVENT_STYLES[CalendarEventType]][]).map(
        ([type, s]) => (
          <span key={type} className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.dot }} />
            {EVENT_ICON[type]} {type === "exdiv" ? "除息日" : type === "earnings" ? "財報公布" : "股東常會"}
          </span>
        )
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CalendarView() {
  const [events,    setEvents]    = useState<CalendarEvent[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [selected,  setSelected]  = useState<string | null>(null);
  const [symbols,   setSymbols]   = useState<string[]>([]);

  // Load symbols from localStorage (client-only)
  useEffect(() => {
    setSymbols(loadWatchlistSymbols());
  }, []);

  // Fetch calendar events
  const load = useCallback(async () => {
    if (!symbols.length) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await getCalendar(symbols);
      setEvents(res.events);
    } catch (e) {
      setError("無法載入月曆資料");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [symbols]);

  useEffect(() => { load(); }, [load]);

  // Build grid
  const today     = useMemo(() => new Date(), []);
  const todayISO  = isoDate(today);
  const endDate   = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + 29); return d; }, [today]);
  const grid      = useMemo(() => buildCalendarGrid(today), [today]);

  // Map events by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((ev) => {
      (map[ev.date] ??= []).push(ev);
    });
    return map;
  }, [events]);

  const selectedEvents = selected ? (eventsByDate[selected] ?? []) : [];

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!symbols.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <span className="text-3xl">📅</span>
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
          請先加入自選股，月曆才會顯示事件
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            📅 財報 / 除權息月曆
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            自選股未來 30 天事件（{symbols.length} 支股票）
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          style={{
            background: "var(--bg-elevated)",
            color:      "var(--text-secondary)",
            border:     "1px solid var(--border)",
          }}
        >
          {loading ? "載入中…" : "↺ 重新整理"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-down)" }}
        >
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center text-[11px] pb-1 font-medium" style={{ color: "var(--text-tertiary)" }}>
              {w}
            </div>
          ))}
          {Array.from({ length: 35 }).map((_, i) => (
            <div
              key={i}
              className="min-h-[72px] rounded-lg animate-pulse"
              style={{ background: "var(--bg-elevated)" }}
            />
          ))}
        </div>
      )}

      {/* Calendar grid */}
      {!loading && (
        <>
          <div className="grid grid-cols-7 gap-1">
            {/* Weekday headers */}
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="text-center text-[11px] pb-1 font-medium"
                style={{ color: "var(--text-tertiary)" }}
              >
                {w}
              </div>
            ))}

            {/* Day cells */}
            {grid.map((day, i) => {
              const iso        = isoDate(day);
              const isToday    = iso === todayISO;
              const isThisMonth = day.getMonth() === today.getMonth();
              const isInWindow = iso >= todayISO && iso <= isoDate(endDate);
              const dayEvents  = eventsByDate[iso] ?? [];
              return (
                <CalendarCell
                  key={i}
                  day={day}
                  isToday={isToday}
                  isThisMonth={isThisMonth}
                  isInWindow={isInWindow}
                  events={dayEvents}
                  onSelect={setSelected}
                  selected={selected}
                />
              );
            })}
          </div>

          {/* Day detail panel */}
          {selected && selectedEvents.length > 0 && (
            <DayDetail
              dateStr={selected}
              events={selectedEvents}
              onClose={() => setSelected(null)}
            />
          )}

          {/* No events message */}
          {events.length === 0 && !error && (
            <div
              className="text-center py-8 text-sm rounded-xl"
              style={{ color: "var(--text-tertiary)", background: "var(--bg-elevated)" }}
            >
              未來 30 天內，自選股沒有除息或財報事件
            </div>
          )}

          {/* Legend */}
          <div className="mt-1 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <Legend />
          </div>

          {/* Event summary list */}
          {events.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                即將到來的事件（{events.length} 筆）
              </p>
              {events.map((ev, i) => {
                const s    = EVENT_STYLES[ev.type];
                const d    = parseYMD(ev.date);
                const diff = Math.round((d.getTime() - new Date(todayISO).getTime()) / 86400000);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg stock-row-shimmer"
                    style={{ background: "var(--bg-elevated)" }}
                  >
                    <span className="text-base shrink-0">{EVENT_ICON[ev.type]}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                        {ev.symbol}
                      </span>
                      <span className="text-xs ml-1.5" style={{ color: "var(--text-tertiary)" }}>
                        {ev.name}
                      </span>
                    </div>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                      style={{ background: s.bg, color: s.text }}
                    >
                      {ev.label}
                    </span>
                    <span className="text-[11px] shrink-0 w-16 text-right" style={{ color: "var(--text-secondary)" }}>
                      {ev.date.slice(5)}
                      {diff === 0
                        ? <span className="ml-1 text-[10px]" style={{ color: "var(--color-brand)" }}>今天</span>
                        : diff > 0
                          ? <span className="ml-1 text-[10px]" style={{ color: "var(--text-tertiary)" }}>{diff}天後</span>
                          : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
