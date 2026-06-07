"use client";

import { useState, useEffect, useCallback } from "react";

// ── Tab 定義 ──────────────────────────────────────────────────────────────────
export type ViewTab =
  | "home" | "kline" | "chips" | "market" | "ranking"
  | "screener" | "news" | "backtest" | "analysis" | "compare" | "calendar";

export interface TabDef {
  id: ViewTab;
  label: string;
  visible: boolean;
}

export const DEFAULT_TABS: TabDef[] = [
  { id: "home",     label: "首頁",   visible: true },
  { id: "kline",    label: "走勢圖", visible: true },
  { id: "chips",    label: "籌碼",   visible: true },
  { id: "market",   label: "大盤",   visible: true },
  { id: "ranking",  label: "排行",   visible: true },
  { id: "screener", label: "選股",   visible: true },
  { id: "news",     label: "新聞",   visible: true },
  { id: "backtest", label: "回測",   visible: true },
  { id: "analysis", label: "分析",   visible: true },
  { id: "compare",  label: "比較",   visible: true },
  { id: "calendar", label: "月曆",   visible: true },
];

const LS_KEY = "jaystock_tab_config_v1";

function lsLoad(): TabDef[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { id: ViewTab; visible: boolean }[];
    // 合併：保留新加的 tab、移除已刪除的 tab
    const merged: TabDef[] = saved
      .map((s) => {
        const def = DEFAULT_TABS.find((d) => d.id === s.id);
        if (!def) return null;
        return { ...def, visible: s.visible };
      })
      .filter(Boolean) as TabDef[];
    // 補上 saved 裡沒有的新 tab（append 到最後）
    DEFAULT_TABS.forEach((def) => {
      if (!merged.find((m) => m.id === def.id)) merged.push(def);
    });
    return merged;
  } catch {
    return null;
  }
}

function lsSave(tabs: TabDef[]) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify(tabs.map((t) => ({ id: t.id, visible: t.visible })))
    );
  } catch {}
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useTabConfig() {
  const [tabs, setTabs] = useState<TabDef[]>(DEFAULT_TABS);

  // 初始化：讀 localStorage
  useEffect(() => {
    const saved = lsLoad();
    if (saved) setTabs(saved);
  }, []);

  // 可見的 tab（依順序）
  const visibleTabs = tabs.filter((t) => t.visible);

  // 更新順序（來自 WorkspaceModal 拖曳）
  const reorder = useCallback((next: TabDef[]) => {
    setTabs(next);
    lsSave(next);
  }, []);

  // 切換顯示/隱藏
  const toggleVisible = useCallback((id: ViewTab) => {
    setTabs((prev) => {
      const next = prev.map((t) =>
        t.id === id ? { ...t, visible: !t.visible } : t
      );
      lsSave(next);
      return next;
    });
  }, []);

  // 重設為預設
  const reset = useCallback(() => {
    setTabs(DEFAULT_TABS);
    lsSave(DEFAULT_TABS);
  }, []);

  return { tabs, visibleTabs, reorder, toggleVisible, reset };
}
