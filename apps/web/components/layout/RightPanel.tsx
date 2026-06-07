"use client";

import type { Quote } from "@/lib/api";
import { RightPanelSkeleton } from "@/components/ui/Skeleton";

interface RightPanelProps {
  quote:      Quote | null;
  isLoading?: boolean;
}

function StatCard({
  label,
  value,
  color,
  glow,
}: {
  label: string;
  value: string;
  color?: string;
  glow?: "up" | "down" | "brand";
}) {
  const glowStyle =
    glow === "up"
      ? { textShadow: "0 0 8px rgba(239,68,68,0.6), 0 0 20px rgba(239,68,68,0.25)" }
      : glow === "down"
      ? { textShadow: "0 0 8px rgba(34,197,94,0.6), 0 0 20px rgba(34,197,94,0.25)" }
      : glow === "brand"
      ? { textShadow: "0 0 8px rgba(59,130,246,0.6)" }
      : {};
  return (
    <div
      className="flex items-center justify-between py-1.5"
      style={{ borderBottom: "1px solid var(--border)", fontSize: "12px" }}
    >
      <span style={{ color: "var(--text-tertiary)", letterSpacing: "0.02em" }}>{label}</span>
      <span
        className="num font-semibold"
        style={{ color: color ?? "var(--text-primary)", ...glowStyle }}
      >
        {value}
      </span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: "9px",
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--color-brand)",
        padding: "12px 0 6px",
        borderBottom: "1px solid var(--border)",
        marginBottom: "2px",
      }}
    >
      {label}
    </div>
  );
}

export default function RightPanel({ quote, isLoading }: RightPanelProps) {
  const q = quote;

  const isUp   = q ? q.change > 0  : false;
  const isDown = q ? q.change < 0  : false;
  const changeColor = isUp
    ? "var(--color-up)"
    : isDown
    ? "var(--color-down)"
    : "var(--color-flat)";

  const priceGlowStyle = isUp
    ? { textShadow: "0 0 16px rgba(239,68,68,0.7), 0 0 40px rgba(239,68,68,0.35), 0 0 80px rgba(239,68,68,0.15)" }
    : isDown
    ? { textShadow: "0 0 16px rgba(34,197,94,0.7), 0 0 40px rgba(34,197,94,0.35), 0 0 80px rgba(34,197,94,0.15)" }
    : {};

  return (
    <aside
      className="shrink-0 border-l overflow-y-auto hidden lg:flex lg:flex-col"
      style={{
        width: "var(--panel-right)",
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
      }}
    >
      {isLoading && !q ? (
        <RightPanelSkeleton />
      ) : q ? (
        <>
          {/* ── 大字價格區 ──────────────────────────────── */}
          <div
            style={{
              padding: "16px 16px 14px",
              borderBottom: "1px solid var(--border)",
              background: isUp
                ? "linear-gradient(180deg, rgba(239,68,68,0.06) 0%, transparent 100%)"
                : isDown
                ? "linear-gradient(180deg, rgba(34,197,94,0.06) 0%, transparent 100%)"
                : undefined,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* 頂部 accent 光條 */}
            <div style={{
              position: "absolute", top: 0, left: "20%", right: "20%", height: "1px",
              background: isUp
                ? "linear-gradient(90deg,transparent,rgba(239,68,68,0.6),transparent)"
                : isDown
                ? "linear-gradient(90deg,transparent,rgba(34,197,94,0.6),transparent)"
                : "transparent",
            }} />

            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "2px" }}>
              <span
                className="num"
                style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-brand)", letterSpacing: "0.06em" }}
              >
                {q.symbol}
              </span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)" }}>
                {q.name}
              </span>
            </div>

            {/* 大字價格 + glow */}
            <div
              className="num"
              style={{
                fontSize: "36px",
                fontWeight: 700,
                letterSpacing: "-1.5px",
                lineHeight: 1.1,
                color: changeColor,
                ...priceGlowStyle,
              }}
            >
              {q.price.toFixed(2)}
            </div>

            {/* 漲跌幅 badge */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                marginTop: "6px",
                padding: "3px 10px",
                borderRadius: "4px",
                background: isUp
                  ? "rgba(239,68,68,0.1)"
                  : isDown
                  ? "rgba(34,197,94,0.1)"
                  : "rgba(107,114,128,0.1)",
                border: `1px solid ${isUp ? "rgba(239,68,68,0.25)" : isDown ? "rgba(34,197,94,0.25)" : "rgba(107,114,128,0.2)"}`,
              }}
            >
              <span className="num" style={{ fontSize: "13px", fontWeight: 700, color: changeColor }}>
                {q.change > 0 ? "▲" : q.change < 0 ? "▼" : "—"}
                {Math.abs(q.change).toFixed(2)}
              </span>
              <span className="num" style={{ fontSize: "11px", color: changeColor, opacity: 0.8 }}>
                ({q.change_pct > 0 ? "+" : ""}{q.change_pct.toFixed(2)}%)
              </span>
            </div>

            {q.time && (
              <div style={{ fontSize: "10px", color: "var(--text-tertiary)", marginTop: "6px" }}>
                {q.time}
              </div>
            )}
          </div>

          {/* ── 今日行情卡 ───────────────────────────────── */}
          <div style={{ padding: "0 16px" }}>
            <SectionHeader label="今日行情" />
            <StatCard label="開盤" value={q.open.toFixed(2)} />
            <StatCard label="最高" value={q.high.toFixed(2)}  color="var(--color-up)"   glow="up" />
            <StatCard label="最低" value={q.low.toFixed(2)}   color="var(--color-down)" glow="down" />
            <StatCard label="昨收" value={q.prev_close.toFixed(2)} />
            <StatCard label="成交量" value={formatVolume(q.volume)} />
            {q.bid > 0 && <StatCard label="買進" value={q.bid.toFixed(2)} />}
            {q.ask > 0 && <StatCard label="賣出" value={q.ask.toFixed(2)} />}
          </div>

          {/* ── 振幅資訊 ─────────────────────────────────── */}
          <div style={{ padding: "0 16px", marginBottom: "8px" }}>
            <SectionHeader label="區間" />
            <StatCard
              label="振幅"
              value={`${(((q.high - q.low) / q.prev_close) * 100).toFixed(2)}%`}
              color="var(--text-secondary)"
            />
            <StatCard
              label="與昨收差"
              value={`${q.change > 0 ? "+" : ""}${((q.price - q.prev_close) / q.prev_close * 100).toFixed(2)}%`}
              color={changeColor}
              glow={isUp ? "up" : isDown ? "down" : undefined}
            />
          </div>
        </>
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
