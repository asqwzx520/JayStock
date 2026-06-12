"use client";

/**
 * P14-41: 日報酬分析面板
 * 從資金曲線計算每日報酬，顯示近 60 日 bar chart + 分佈直方圖 + 統計摘要。
 */

import type { BacktestEquityPoint } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  equityCurve: BacktestEquityPoint[];
}

function barColor(r: number): string {
  if (r >= 0.03)  return "#22c55e";
  if (r >= 0.01)  return "#86efac";
  if (r >= 0)     return "#bbf7d0";
  if (r >= -0.01) return "#fca5a5";
  if (r >= -0.03) return "#ef4444";
  return "#991b1b";
}

export default function DailyReturnsPanel({ equityCurve }: Props) {
  const { returns, stats, histogram, recent60 } = useMemo(() => {
    if (!equityCurve || equityCurve.length < 2) {
      return { returns: [], stats: null, histogram: [], recent60: [] };
    }

    const rets: { date: string; r: number }[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].value;
      const cur  = equityCurve[i].value;
      if (prev > 0) {
        rets.push({ date: equityCurve[i].time, r: (cur - prev) / prev });
      }
    }

    if (rets.length === 0) return { returns: rets, stats: null, histogram: [], recent60: [] };

    const vals  = rets.map(r => r.r);
    const mean  = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std   = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const best  = Math.max(...vals);
    const worst = Math.min(...vals);
    const pos   = vals.filter(v => v > 0).length;
    const neg   = vals.filter(v => v < 0).length;

    // 直方圖：20 個 bin，範圍 ±5%
    const BIN_COUNT = 20;
    const RANGE     = 0.05;
    const binWidth  = (RANGE * 2) / BIN_COUNT;
    const bins      = Array.from({ length: BIN_COUNT }, (_, i) => ({
      lo:    -RANGE + i * binWidth,
      hi:    -RANGE + (i + 1) * binWidth,
      count: 0,
    }));
    for (const v of vals) {
      const idx = Math.min(
        BIN_COUNT - 1,
        Math.max(0, Math.floor((v + RANGE) / binWidth))
      );
      bins[idx].count++;
    }

    return {
      returns:    rets,
      stats:      { mean, std, best, worst, pos, neg, total: vals.length },
      histogram:  bins,
      recent60:   rets.slice(-60),
    };
  }, [equityCurve]);

  if (!stats) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        資料不足，無法計算日報酬
      </div>
    );
  }

  const maxHistCount = Math.max(...histogram.map(b => b.count), 1);
  const maxAbsRet    = Math.max(...recent60.map(r => Math.abs(r.r)), 0.001);

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* ── 統計摘要 ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "平均日報酬", value: `${(stats.mean * 100).toFixed(3)}%` },
          { label: "日報酬標準差", value: `${(stats.std * 100).toFixed(3)}%` },
          { label: "單日最大漲幅", value: `+${(stats.best * 100).toFixed(2)}%`, color: "#22c55e" },
          { label: "單日最大跌幅", value: `${(stats.worst * 100).toFixed(2)}%`,  color: "#ef4444" },
          { label: "上漲天數", value: `${stats.pos} 天（${((stats.pos / stats.total) * 100).toFixed(1)}%）`, color: "#22c55e" },
          { label: "下跌天數", value: `${stats.neg} 天（${((stats.neg / stats.total) * 100).toFixed(1)}%）`, color: "#ef4444" },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          >
            <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: s.color ?? "var(--text-primary)" }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── 近 60 日日報酬 bar chart ─────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          近 60 日日報酬
        </div>
        <div
          className="rounded-lg p-3 overflow-x-auto"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          <svg viewBox={`0 0 ${recent60.length * 8} 80`} style={{ width: "100%", minWidth: `${recent60.length * 8}px`, height: 80 }}>
            {recent60.map((d, i) => {
              const barH = Math.max(1, Math.abs(d.r) / maxAbsRet * 34);
              const isPos = d.r >= 0;
              const y    = isPos ? 38 - barH : 42;
              return (
                <rect
                  key={i}
                  x={i * 8 + 1}
                  y={y}
                  width={6}
                  height={barH}
                  fill={barColor(d.r)}
                  rx={1}
                >
                  <title>{d.date}: {(d.r * 100).toFixed(2)}%</title>
                </rect>
              );
            })}
            {/* zero line */}
            <line x1={0} y1={40} x2={recent60.length * 8} y2={40} stroke="var(--border)" strokeWidth={0.5} />
          </svg>
          <div className="flex justify-between text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
            <span>{recent60[0]?.date}</span>
            <span>{recent60[recent60.length - 1]?.date}</span>
          </div>
        </div>
      </div>

      {/* ── 分佈直方圖 ───────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          日報酬分佈（全回測期間，共 {stats.total} 個交易日）
        </div>
        <div
          className="rounded-lg p-3"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          <svg viewBox="0 0 400 120" style={{ width: "100%", height: 120 }}>
            {histogram.map((bin, i) => {
              const barH = Math.max(0, (bin.count / maxHistCount) * 80);
              const x    = i * 20 + 10;
              const fill = bin.lo >= 0 ? "#22c55e" : "#ef4444";
              return (
                <g key={i}>
                  <rect x={x} y={90 - barH} width={18} height={barH} fill={fill} rx={1} opacity={0.85}>
                    <title>{`${(bin.lo * 100).toFixed(1)}%~${(bin.hi * 100).toFixed(1)}%: ${bin.count} 天`}</title>
                  </rect>
                </g>
              );
            })}
            {/* zero line */}
            <line x1={200} y1={5} x2={200} y2={90} stroke="var(--text-tertiary)" strokeWidth={0.8} strokeDasharray="2,2" />
            {/* baseline */}
            <line x1={10} y1={90} x2={410} y2={90} stroke="var(--border)" strokeWidth={0.5} />
            {/* labels */}
            <text x={10}  y={105} fontSize={8} fill="var(--text-tertiary)">-5%</text>
            <text x={195} y={105} fontSize={8} fill="var(--text-tertiary)">0</text>
            <text x={390} y={105} fontSize={8} fill="var(--text-tertiary)">+5%</text>
          </svg>
        </div>
      </div>
    </div>
  );
}
