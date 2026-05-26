"use client";

import type { Quote } from "@/lib/api";

interface RightPanelProps {
  quote: Quote | null;
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="num font-medium" style={{ color: color || "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

export default function RightPanel({ quote }: RightPanelProps) {
  const q = quote;

  const changeColor = q
    ? q.change > 0
      ? "var(--color-up)"
      : q.change < 0
        ? "var(--color-down)"
        : "var(--color-flat)"
    : undefined;

  return (
    <aside
      className="shrink-0 border-l overflow-y-auto hidden xl:block"
      style={{
        width: "var(--panel-right)",
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
      }}
    >
      {q ? (
        <div className="p-4">
          <div className="mb-4">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="num text-xs" style={{ color: "var(--text-secondary)" }}>
                {q.symbol}
              </span>
              <span className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {q.name}
              </span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="num text-2xl font-bold" style={{ color: changeColor }}>
                {q.price.toFixed(2)}
              </span>
              <span className="num text-sm" style={{ color: changeColor }}>
                {q.change > 0 ? "▲" : q.change < 0 ? "▼" : "—"}
                {Math.abs(q.change).toFixed(2)} ({q.change_pct > 0 ? "+" : ""}
                {q.change_pct.toFixed(2)}%)
              </span>
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
              {q.time || "—"}
            </div>
          </div>

          <div
            className="border-t pt-3"
            style={{ borderColor: "var(--border)" }}
          >
            <Row label="開盤" value={q.open.toFixed(2)} />
            <Row label="最高" value={q.high.toFixed(2)} color="var(--color-up)" />
            <Row label="最低" value={q.low.toFixed(2)} color="var(--color-down)" />
            <Row label="昨收" value={q.prev_close.toFixed(2)} />
            <Row label="成交量" value={formatVolume(q.volume)} />
            <Row label="內盤" value={q.bid.toFixed(2)} />
            <Row label="外盤" value={q.ask.toFixed(2)} />
          </div>
        </div>
      ) : (
        <div
          className="flex items-center justify-center h-full text-sm"
          style={{ color: "var(--text-tertiary)" }}
        >
          選擇一檔股票以查看詳情
        </div>
      )}
    </aside>
  );
}

function formatVolume(v: number): string {
  if (v >= 100_000_000) return (v / 100_000_000).toFixed(2) + " 億";
  if (v >= 10_000) return (v / 10_000).toFixed(0) + " 萬";
  return v.toLocaleString();
}
