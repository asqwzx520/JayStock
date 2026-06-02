"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { StockItem } from "@/lib/api";
import { searchStocks } from "@/lib/api";

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

interface HeaderProps {
  currentSymbol: string;
  onSelectStock: (symbol: string, name: string) => void;
}

export default function Header({ currentSymbol, onSelectStock }: HeaderProps) {
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
    <header
      className="flex items-center gap-4 px-4 border-b shrink-0"
      style={{
        height: "var(--header-h)",
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center gap-2 font-semibold text-lg">
        <span style={{ color: "var(--color-brand)" }}>StockPulse</span>
      </div>

      <div className="relative flex-1 max-w-md">
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

      <div
        className="num text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        {currentSymbol || "—"}
      </div>

      {/* Google 登入/登出按鈕 */}
      <AuthButton />

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
    </header>
  );
}
