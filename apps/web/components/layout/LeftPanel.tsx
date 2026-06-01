"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { Quote, WatchlistState, WatchlistGroup, WatchlistItem } from "@/lib/api";
import { getQuotesBatch, watchlistApi, getUserId } from "@/lib/api";

const HotRanking = dynamic(() => import("@/components/market/HotRanking"), { ssr: false });

// ── localStorage helpers ───────────────────────────────────────────────────
const LS_KEY = "stockpulse_watchlist_v2";

function lsLoad(): WatchlistState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as WatchlistState) : null;
  } catch { return null; }
}

function lsSave(s: WatchlistState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

const DEFAULT_STATE: WatchlistState = {
  groups: [{ id: "default", name: "自選股", sort_order: 0 }],
  items: {
    default: ["2330","2317","2454","2881","2882","0050","2603","3008"].map((s, i) => ({
      id: `item_${s}`, symbol: s, note: "", tags: [],
      sort_order: i, price_alert_above: null, price_alert_below: null,
    })),
  },
};

// ── helpers ───────────────────────────────────────────────────────────────
function sortedGroups(s: WatchlistState): WatchlistGroup[] {
  return [...s.groups].sort((a, b) => a.sort_order - b.sort_order);
}
function groupItems(s: WatchlistState, gid: string): WatchlistItem[] {
  return [...(s.items[gid] ?? [])].sort((a, b) => a.sort_order - b.sort_order);
}

// ── Component ──────────────────────────────────────────────────────────────
interface Props {
  currentSymbol: string;
  onSelectStock: (symbol: string) => void;
}

export default function LeftPanel({ currentSymbol, onSelectStock }: Props) {
  const [panelMode, setPanelMode]   = useState<"watchlist" | "ranking">("watchlist");
  const [state, setState]           = useState<WatchlistState>(DEFAULT_STATE);
  const [activeGid, setActiveGid]   = useState<string>("default");
  const [quotes, setQuotes]         = useState<Record<string, Quote>>({});

  // UI flags
  const [showAddStock, setShowAddStock]   = useState(false);
  const [addInput, setAddInput]           = useState("");
  const [addingGroup, setAddingGroup]     = useState(false);
  const [newGroupName, setNewGroupName]   = useState("");
  const [editingNote, setEditingNote]     = useState<string | null>(null);   // item id
  const [noteInput, setNoteInput]         = useState("");
  const [alertEditing, setAlertEditing]   = useState<string | null>(null);   // item id
  const [alertAbove, setAlertAbove]       = useState("");
  const [alertBelow, setAlertBelow]       = useState("");
  const [reorderMode, setReorderMode]     = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Boot: load localStorage → try backend sync ─────────────────────────
  useEffect(() => {
    const local = lsLoad() ?? DEFAULT_STATE;
    setState(local);
    setActiveGid(local.groups[0]?.id ?? "default");

    // Attempt backend sync (non-blocking)
    watchlistApi.get()
      .then((remote) => {
        // Simple merge: backend wins if it has more groups or more items
        const remoteTotal = Object.values(remote.items).flat().length;
        const localTotal  = Object.values(local.items).flat().length;
        const merged = remoteTotal >= localTotal ? remote : local;
        setState(merged);
        lsSave(merged);
      })
      .catch(() => { /* backend unavailable — localStorage is fine */ });
  }, []);

  // ── Debounced backend sync whenever state changes ──────────────────────
  const scheduleSync = useCallback((next: WatchlistState) => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      watchlistApi.sync(next).catch(() => {});
    }, 800);
  }, []);

  function update(next: WatchlistState) {
    setState(next);
    lsSave(next);
    scheduleSync(next);
  }

  // ── Quote polling ──────────────────────────────────────────────────────
  const allSymbols = [...new Set(Object.values(state.items).flat().map(it => it.symbol))];

  const fetchQuotes = useCallback(async () => {
    if (allSymbols.length === 0) return;
    try { setQuotes(await getQuotesBatch(allSymbols)); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSymbols.join(",")]);

  useEffect(() => {
    fetchQuotes();
    const id = setInterval(fetchQuotes, 15_000);
    return () => clearInterval(id);
  }, [fetchQuotes]);

  // ── Derived ────────────────────────────────────────────────────────────
  const groups      = sortedGroups(state);
  const activeGroup = groups.find(g => g.id === activeGid) ?? groups[0];
  const items       = activeGroup ? groupItems(state, activeGroup.id) : [];

  // ── Group helpers ──────────────────────────────────────────────────────
  function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    const gid = `g_${Date.now()}`;
    const next: WatchlistState = {
      groups: [...state.groups, { id: gid, name, sort_order: state.groups.length }],
      items: { ...state.items, [gid]: [] },
    };
    update(next);
    setActiveGid(gid);
    setNewGroupName(""); setAddingGroup(false);
  }

  function deleteGroup(gid: string) {
    if (state.groups.length <= 1) return;
    const newItems = { ...state.items };
    delete newItems[gid];
    const next: WatchlistState = {
      groups: state.groups.filter(g => g.id !== gid),
      items: newItems,
    };
    update(next);
    if (activeGid === gid) setActiveGid(next.groups[0].id);
  }

  // ── Stock helpers ──────────────────────────────────────────────────────
  function addStock() {
    const sym = addInput.trim().toUpperCase();
    if (!sym || !activeGroup) return;
    const gid = activeGroup.id;
    if ((state.items[gid] ?? []).some(it => it.symbol === sym)) {
      setAddInput(""); setShowAddStock(false); return;
    }
    const iid = `item_${Date.now()}`;
    const newItem: WatchlistItem = {
      id: iid, symbol: sym, note: "", tags: [],
      sort_order: (state.items[gid] ?? []).length,
      price_alert_above: null, price_alert_below: null,
    };
    const next: WatchlistState = {
      ...state,
      items: { ...state.items, [gid]: [...(state.items[gid] ?? []), newItem] },
    };
    update(next);
    setAddInput(""); setShowAddStock(false);
  }

  function removeStock(iid: string) {
    const next: WatchlistState = {
      ...state,
      items: Object.fromEntries(
        Object.entries(state.items).map(([gid, its]) => [gid, its.filter(it => it.id !== iid)])
      ),
    };
    update(next);
  }

  function moveItem(iid: string, dir: -1 | 1) {
    const gid = activeGroup!.id;
    const sorted = groupItems(state, gid);
    const idx = sorted.findIndex(it => it.id === iid);
    const swap = idx + dir;
    if (swap < 0 || swap >= sorted.length) return;
    const reordered = sorted.map((it, i) => {
      if (i === idx) return { ...it, sort_order: sorted[swap].sort_order };
      if (i === swap) return { ...it, sort_order: sorted[idx].sort_order };
      return it;
    });
    // Also swap sort_order values directly
    const aOld = sorted[idx].sort_order;
    const bOld = sorted[swap].sort_order;
    const fixed = reordered.map(it => {
      if (it.id === iid)           return { ...it, sort_order: bOld };
      if (it.id === sorted[swap].id) return { ...it, sort_order: aOld };
      return it;
    });
    const next: WatchlistState = { ...state, items: { ...state.items, [gid]: fixed } };
    update(next);
  }

  function saveNote(iid: string) {
    const next: WatchlistState = {
      ...state,
      items: Object.fromEntries(
        Object.entries(state.items).map(([gid, its]) => [
          gid, its.map(it => it.id === iid ? { ...it, note: noteInput } : it),
        ])
      ),
    };
    update(next);
    setEditingNote(null); setNoteInput("");
  }

  // ── 匯出 ──────────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!activeGroup) return;
    const rows = groupItems(state, activeGroup.id);
    const header = "﻿代碼,名稱,現價,漲跌幅(%),備注";
    const lines = rows.map(it => {
      const q = quotes[it.symbol];
      return [
        it.symbol,
        q?.name ?? "",
        q?.price?.toFixed(2) ?? "",
        q ? (q.change_pct >= 0 ? "+" : "") + q.change_pct.toFixed(2) : "",
        `"${(it.note ?? "").replace(/"/g, '""')}"`,
      ].join(",");
    });
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `watchlist_${activeGroup.name}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `watchlist_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  function saveAlert(iid: string) {
    const above = alertAbove ? parseFloat(alertAbove) : null;
    const below = alertBelow ? parseFloat(alertBelow) : null;
    const next: WatchlistState = {
      ...state,
      items: Object.fromEntries(
        Object.entries(state.items).map(([gid, its]) => [
          gid, its.map(it => it.id === iid
            ? { ...it, price_alert_above: above, price_alert_below: below } : it),
        ])
      ),
    };
    update(next);
    setAlertEditing(null); setAlertAbove(""); setAlertBelow("");
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <aside
      className="shrink-0 border-r flex flex-col overflow-hidden hidden lg:flex"
      style={{ width: "var(--panel-left)", background: "var(--bg-surface)", borderColor: "var(--border)" }}
    >
      {/* Top mode switcher: 自選股 / 熱門 */}
      <div className="shrink-0 flex border-b" style={{ borderColor: "var(--border)" }}>
        {(["watchlist", "ranking"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setPanelMode(mode)}
            className="flex-1 py-1.5 text-xs font-medium transition-colors"
            style={{
              color:        panelMode === mode ? "var(--color-accent)" : "var(--text-tertiary)",
              borderBottom: panelMode === mode ? "2px solid var(--color-accent)" : "2px solid transparent",
            }}
          >
            {mode === "watchlist" ? "自選股" : "熱門排行"}
          </button>
        ))}
      </div>

      {/* ── 熱門排行模式 ── */}
      {panelMode === "ranking" && (
        <div className="flex-1 min-h-0">
          <HotRanking onSelectSymbol={onSelectStock} />
        </div>
      )}

      {/* ── 自選股模式 ── */}
      {panelMode === "watchlist" && <>

      {/* Group tabs */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 pt-2 pb-1.5 overflow-x-auto"
        style={{ borderBottom: "1px solid var(--border)" }}>
        {groups.map((g) => (
          <button key={g.id} onClick={() => setActiveGid(g.id)}
            className="px-2 py-0.5 text-xs rounded whitespace-nowrap transition-colors"
            style={{
              background: activeGid === g.id ? "var(--color-brand)" : "transparent",
              color: activeGid === g.id ? "#fff" : "var(--text-secondary)",
            }}>
            {g.name}
          </button>
        ))}
        {addingGroup ? (
          <input autoFocus value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addGroup(); if (e.key === "Escape") { setAddingGroup(false); setNewGroupName(""); } }}
            onBlur={() => { if (!newGroupName.trim()) setAddingGroup(false); }}
            placeholder="群組名稱"
            className="text-xs px-1.5 py-0.5 rounded w-20 outline-none"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--color-brand)" }}
          />
        ) : (
          <button onClick={() => setAddingGroup(true)} title="新增群組"
            className="px-1.5 py-0.5 text-xs rounded shrink-0"
            style={{ color: "var(--text-tertiary)" }}>
            ＋
          </button>
        )}
      </div>

      {/* Group header row */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          {activeGroup?.name}
          <span className="ml-1 font-normal normal-case">({items.length})</span>
        </span>
        <div className="flex items-center gap-1">
          {/* Reorder toggle */}
          <button onClick={() => setReorderMode(v => !v)}
            className="text-xs px-1.5 py-0.5 rounded transition-colors"
            title="排序模式"
            style={{
              background: reorderMode ? "rgba(99,102,241,0.2)" : "var(--bg-elevated)",
              color: reorderMode ? "#818cf8" : "var(--text-tertiary)",
            }}>
            ⇅
          </button>
          {/* Delete group */}
          {groups.length > 1 && (
            <button onClick={() => deleteGroup(activeGroup!.id)}
              className="text-xs px-1 rounded opacity-30 hover:opacity-70 transition-opacity"
              style={{ color: "var(--color-down)" }} title="刪除此群組">
              ✕
            </button>
          )}
          {/* Add stock */}
          <button onClick={() => setShowAddStock(v => !v)}
            className="text-xs px-1.5 py-0.5 rounded transition-colors"
            title="新增股票"
            style={{
              background: showAddStock ? "var(--color-brand)" : "var(--bg-elevated)",
              color: showAddStock ? "#fff" : "var(--color-brand)",
            }}>
            ＋
          </button>
        </div>
      </div>

      {/* Add stock input */}
      {showAddStock && (
        <div className="shrink-0 flex gap-1.5 px-2 pb-2">
          <input autoFocus value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addStock(); if (e.key === "Escape") { setShowAddStock(false); setAddInput(""); } }}
            placeholder="輸入代碼（如 2330）"
            className="flex-1 text-xs px-2 py-1 rounded outline-none"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          />
          <button onClick={addStock}
            className="text-xs px-2 py-1 rounded font-medium shrink-0"
            style={{ background: "var(--color-brand)", color: "#fff" }}>
            加入
          </button>
        </div>
      )}

      {/* Stock list */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-6 text-xs text-center" style={{ color: "var(--text-tertiary)" }}>
            點擊 ＋ 新增股票
          </div>
        ) : (
          items.map((item, idx) => {
            const q          = quotes[item.symbol];
            const isActive   = item.symbol === currentSymbol;
            const priceColor = q
              ? q.change > 0 ? "var(--color-up)" : q.change < 0 ? "var(--color-down)" : "var(--color-flat)"
              : undefined;
            const hasAlert   = item.price_alert_above !== null || item.price_alert_below !== null;

            return (
              <div key={item.id}>
                {/* Main row */}
                <div className="flex items-center group"
                  style={{ borderLeft: isActive ? "2px solid var(--color-brand)" : "2px solid transparent" }}>

                  {/* Reorder arrows */}
                  {reorderMode && (
                    <div className="flex flex-col px-0.5 shrink-0">
                      <button onClick={() => moveItem(item.id, -1)} disabled={idx === 0}
                        className="text-[10px] leading-none px-0.5 disabled:opacity-20"
                        style={{ color: "var(--text-tertiary)" }}>▲</button>
                      <button onClick={() => moveItem(item.id, 1)} disabled={idx === items.length - 1}
                        className="text-[10px] leading-none px-0.5 disabled:opacity-20"
                        style={{ color: "var(--text-tertiary)" }}>▼</button>
                    </div>
                  )}

                  {/* Stock info button */}
                  <button onClick={() => onSelectStock(item.symbol)}
                    className="flex items-center justify-between flex-1 px-2 py-2 text-sm transition-colors min-w-0"
                    style={{ background: isActive ? "var(--bg-elevated)" : "transparent" }}>
                    <div className="text-left min-w-0">
                      <div className="num font-medium flex items-center gap-1" style={{ color: "var(--text-primary)" }}>
                        {item.symbol}
                        {hasAlert && <span title="已設到價提醒" style={{ color: "#f59e0b", fontSize: 9 }}>◆</span>}
                      </div>
                      <div className="text-xs truncate max-w-[88px]" style={{ color: "var(--text-secondary)" }}>
                        {q?.name ?? "—"}
                      </div>
                    </div>
                    {q ? (
                      <div className="text-right num shrink-0">
                        <div className="text-sm font-medium" style={{ color: priceColor }}>{q.price.toFixed(2)}</div>
                        <div className="text-xs" style={{ color: priceColor }}>
                          {q.change_pct > 0 ? "+" : ""}{q.change_pct.toFixed(2)}%
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>…</div>
                    )}
                  </button>

                  {/* Action buttons (visible on hover) */}
                  {!reorderMode && (
                    <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pr-1 gap-0.5">
                      {/* Alert bell */}
                      <button onClick={() => { setAlertEditing(item.id); setAlertAbove(item.price_alert_above?.toString() ?? ""); setAlertBelow(item.price_alert_below?.toString() ?? ""); }}
                        className="text-[10px] px-1 rounded leading-none"
                        title="到價提醒"
                        style={{ color: hasAlert ? "#f59e0b" : "var(--text-tertiary)", background: "var(--bg-elevated)" }}>
                        🔔
                      </button>
                      {/* Note */}
                      <button onClick={() => { setEditingNote(item.id); setNoteInput(item.note); }}
                        className="text-[10px] px-1 rounded leading-none"
                        title="備注"
                        style={{ color: item.note ? "#60a5fa" : "var(--text-tertiary)", background: "var(--bg-elevated)" }}>
                        ✎
                      </button>
                      {/* Remove */}
                      <button onClick={() => removeStock(item.id)}
                        className="text-[10px] px-1 rounded leading-none"
                        title="移除"
                        style={{ color: "var(--text-tertiary)", background: "var(--bg-elevated)" }}>
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {/* Note editor (inline) */}
                {editingNote === item.id && (
                  <div className="px-2 pb-2 flex gap-1.5">
                    <input autoFocus value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveNote(item.id); if (e.key === "Escape") { setEditingNote(null); } }}
                      placeholder="備注..."
                      className="flex-1 text-xs px-2 py-1 rounded outline-none"
                      style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                    />
                    <button onClick={() => saveNote(item.id)}
                      className="text-xs px-2 py-1 rounded shrink-0"
                      style={{ background: "var(--color-brand)", color: "#fff" }}>
                      存
                    </button>
                  </div>
                )}

                {/* Note display */}
                {item.note && editingNote !== item.id && (
                  <div className="px-3 pb-1.5 text-[10px]" style={{ color: "#60a5fa", marginTop: -4 }}>
                    {item.note}
                  </div>
                )}

                {/* Alert editor (inline) */}
                {alertEditing === item.id && (
                  <div className="px-2 pb-2" style={{ background: "var(--bg-elevated)", borderRadius: 4, margin: "0 6px 4px" }}>
                    <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>到價提醒 — {item.symbol}</div>
                    <div className="flex gap-1 mb-1">
                      <span className="text-[10px]" style={{ color: "var(--color-up)", lineHeight: "24px" }}>突破</span>
                      <input value={alertAbove} onChange={(e) => setAlertAbove(e.target.value)}
                        placeholder="價格" type="number"
                        className="flex-1 text-xs px-1.5 py-1 rounded outline-none"
                        style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                      />
                    </div>
                    <div className="flex gap-1 mb-1.5">
                      <span className="text-[10px]" style={{ color: "var(--color-down)", lineHeight: "24px" }}>跌破</span>
                      <input value={alertBelow} onChange={(e) => setAlertBelow(e.target.value)}
                        placeholder="價格" type="number"
                        className="flex-1 text-xs px-1.5 py-1 rounded outline-none"
                        style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                      />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => saveAlert(item.id)}
                        className="flex-1 text-xs py-0.5 rounded"
                        style={{ background: "var(--color-brand)", color: "#fff" }}>
                        儲存
                      </button>
                      <button onClick={() => { setAlertEditing(null); }}
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ background: "var(--bg-surface)", color: "var(--text-tertiary)" }}>
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer: sync status + export */}
      <div className="shrink-0 px-3 py-1.5 flex items-center justify-between text-[9px]"
        style={{ color: "var(--text-tertiary)", borderTop: "1px solid var(--border)" }}>
        <span>{getUserId().slice(0, 8)}… · 已同步</span>
        <div className="flex items-center gap-1">
          <button
            onClick={exportCSV}
            title="匯出目前群組 CSV"
            className="px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 9 }}
          >
            CSV↓
          </button>
          <button
            onClick={exportJSON}
            title="匯出全部自選股 JSON"
            className="px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 9 }}
          >
            JSON↓
          </button>
        </div>
      </div>

      </> /* end watchlist mode */}
    </aside>
  );
}
