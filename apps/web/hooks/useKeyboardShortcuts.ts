"use client";

import { useEffect, useRef } from "react";

interface UseKeyboardShortcutsOptions {
  /** 自選股清單（依序），用於 ↑↓ 切換 */
  watchlistSymbols: string[];
  /** 目前顯示的股票 */
  currentSymbol: string;
  /** 換股回呼 */
  onSymbolChange: (sym: string) => void;
  /** 聚焦搜尋框 */
  onFocusSearch: () => void;
}

/**
 * 全局鍵盤快捷鍵
 *
 * / → 聚焦搜尋框
 * ↑ → 切自選股上一檔
 * ↓ → 切自選股下一檔
 *
 * 當焦點在 INPUT / TEXTAREA / SELECT / contenteditable 時不觸發，
 * 避免干擾打字。
 */
export function useKeyboardShortcuts({
  watchlistSymbols,
  currentSymbol,
  onSymbolChange,
  onFocusSearch,
}: UseKeyboardShortcutsOptions) {
  // 用 ref 避免 handler 裡的 closure stale
  const symRef  = useRef(currentSymbol);
  const listRef = useRef(watchlistSymbols);

  // ⚠️ react-hooks/refs：ref.current 賦值必須在 effect 裡，不能在 render body
  useEffect(() => { symRef.current  = currentSymbol;    }, [currentSymbol]);
  useEffect(() => { listRef.current = watchlistSymbols; }, [watchlistSymbols]);

  useEffect(() => {
    function isTyping(e: KeyboardEvent): boolean {
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function handler(e: KeyboardEvent) {
      if (isTyping(e)) return;

      // / → 聚焦搜尋
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onFocusSearch();
        return;
      }

      // ↑↓ → 切自選股
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const list = listRef.current;
        if (list.length === 0) return;
        const idx = list.indexOf(symRef.current);
        let next: number;
        if (idx === -1) {
          next = 0;
        } else if (e.key === "ArrowDown") {
          next = Math.min(idx + 1, list.length - 1);
        } else {
          next = Math.max(idx - 1, 0);
        }
        if (list[next] !== symRef.current) {
          e.preventDefault();
          onSymbolChange(list[next]);
        }
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onFocusSearch, onSymbolChange]);
}
