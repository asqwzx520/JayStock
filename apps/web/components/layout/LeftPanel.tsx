"use client";

import { useState, useEffect } from "react";
import type { Quote } from "@/lib/api";
import { getQuotesBatch } from "@/lib/api";

const DEFAULT_WATCHLIST = ["2330", "2317", "2454", "2881", "2882", "0050", "2603", "3008"];

interface LeftPanelProps {
  currentSymbol: string;
  onSelectStock: (symbol: string) => void;
}

export default function LeftPanel({
  currentSymbol,
  onSelectStock,
}: LeftPanelProps) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getQuotesBatch(DEFAULT_WATCHLIST);
        if (!cancelled) setQuotes(data);
      } catch {
        // silent
      }
    }

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <aside
      className="shrink-0 border-r overflow-y-auto hidden lg:block"
      style={{
        width: "var(--panel-left)",
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
      }}
    >
      <div
        className="px-3 py-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-tertiary)" }}
      >
        自選股
      </div>

      {DEFAULT_WATCHLIST.map((sym) => {
        const q = quotes[sym];
        const isActive = sym === currentSymbol;
        return (
          <button
            key={sym}
            onClick={() => onSelectStock(sym)}
            className="flex items-center justify-between w-full px-3 py-2 text-sm transition-colors"
            style={{
              background: isActive ? "var(--bg-elevated)" : "transparent",
              borderLeft: isActive
                ? "2px solid var(--color-brand)"
                : "2px solid transparent",
            }}
          >
            <div className="text-left">
              <div className="num font-medium" style={{ color: "var(--text-primary)" }}>
                {sym}
              </div>
              <div
                className="text-xs truncate max-w-[100px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {q?.name || "—"}
              </div>
            </div>
            {q ? (
              <div className="text-right num">
                <div
                  className="text-sm font-medium"
                  style={{
                    color:
                      q.change > 0
                        ? "var(--color-up)"
                        : q.change < 0
                          ? "var(--color-down)"
                          : "var(--color-flat)",
                  }}
                >
                  {q.price.toFixed(2)}
                </div>
                <div
                  className="text-xs"
                  style={{
                    color:
                      q.change_pct > 0
                        ? "var(--color-up)"
                        : q.change_pct < 0
                          ? "var(--color-down)"
                          : "var(--color-flat)",
                  }}
                >
                  {q.change_pct > 0 ? "+" : ""}
                  {q.change_pct.toFixed(2)}%
                </div>
              </div>
            ) : (
              <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                ...
              </div>
            )}
          </button>
        );
      })}
    </aside>
  );
}
