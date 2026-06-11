"use client";

import { useMemo } from "react";
import type { BacktestTrade, BacktestMonthlyReturn } from "@/lib/api";

// ── Mini bar chart (pure SVG) ─────────────────────────────────────────────────

function SVGBar({
  values, colors, width = 420, height = 110,
}: {
  values: number[];
  colors: string[];
  width?: number;
  height?: number;
}) {
  if (!values.length) return null;
  const max = Math.max(...values.map(Math.abs), 1);
  const bw  = Math.max(2, Math.floor(width / values.length) - 1);
  const mid = height / 2;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      {values.map((v, i) => {
        const barH = Math.max(1, (Math.abs(v) / max) * (mid - 4));
        const x = i * (bw + 1);
        const y = v >= 0 ? mid - barH : mid;
        return (
          <rect key={i} x={x} y={y} width={bw} height={barH} fill={colors[i]} rx="1" />
        );
      })}
      <line x1="0" y1={mid} x2={width} y2={mid} stroke="#555" strokeWidth="0.5" />
    </svg>
  );
}

// ── P&L Histogram ─────────────────────────────────────────────────────────────

function PnLHistogram({ pnlPcts }: { pnlPcts: number[] }) {
  const { bars } = useMemo(() => {
    if (!pnlPcts.length) return { bars: [] };
    const min = Math.min(...pnlPcts);
    const max = Math.max(...pnlPcts);
    const bins = 20;
    const step = (max - min) / bins || 0.001;
    const counts = Array(bins).fill(0);
    const edges  = Array.from({ length: bins }, (_, i) => min + i * step);
    for (const v of pnlPcts) {
      const b = Math.min(bins - 1, Math.floor((v - min) / step));
      counts[b]++;
    }
    return { bars: counts.map((c, i) => ({ count: c, center: edges[i] + step / 2 })) };
  }, [pnlPcts]);

  const maxCount = Math.max(...bars.map(b => b.count), 1);

  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-1 font-medium">
        P&amp;L 報酬率分佈（{pnlPcts.length} 筆）
      </p>
      <div className="flex items-end gap-px h-24 w-full">
        {bars.map((b, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm transition-opacity hover:opacity-80"
            style={{
              height:     `${(b.count / maxCount) * 100}%`,
              background: b.center >= 0 ? "#22c55e" : "#ef4444",
              minHeight:  b.count > 0 ? "2px" : "0",
            }}
            title={`${b.center >= 0 ? "+" : ""}${(b.center * 100).toFixed(1)}%: ${b.count} 筆`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
        <span>{(Math.min(...pnlPcts) * 100).toFixed(1)}%</span>
        <span>0%</span>
        <span>+{(Math.max(...pnlPcts) * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ── Streak analysis ───────────────────────────────────────────────────────────

interface StreakStats {
  maxWin:       number;
  maxLoss:      number;
  avgWin:       number;
  avgLoss:      number;
  currentStreak: number;
  currentType:  "win" | "loss" | "none";
  streakBars:   { val: number; type: "win" | "loss" }[];  // running streak length
}

function calcStreaks(trades: BacktestTrade[]): StreakStats {
  if (!trades.length) return {
    maxWin: 0, maxLoss: 0, avgWin: 0, avgLoss: 0,
    currentStreak: 0, currentType: "none", streakBars: [],
  };

  let maxWin = 0, maxLoss = 0;
  let curWin = 0, curLoss = 0;
  const allWin: number[] = [], allLoss: number[] = [];
  const streakBars: { val: number; type: "win" | "loss" }[] = [];

  for (const t of trades) {
    const win = t.pnl > 0;
    if (win) {
      curWin++;
      curLoss = 0;
      maxWin = Math.max(maxWin, curWin);
      allWin.push(curWin);
      streakBars.push({ val: curWin, type: "win" });
    } else {
      curLoss++;
      curWin = 0;
      maxLoss = Math.max(maxLoss, curLoss);
      allLoss.push(curLoss);
      streakBars.push({ val: curLoss, type: "loss" });
    }
  }

  const last = trades[trades.length - 1];
  const currentType = last.pnl > 0 ? "win" : "loss";
  const currentStreak = last.pnl > 0 ? curWin : curLoss;

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    maxWin, maxLoss,
    avgWin:  avg(allWin),
    avgLoss: avg(allLoss),
    currentStreak, currentType,
    streakBars,
  };
}

// ── Monthly heatmap ───────────────────────────────────────────────────────────

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MonthlyHeatmap({ monthly }: { monthly: BacktestMonthlyReturn[] }) {
  const { years, grid } = useMemo(() => {
    const years = [...new Set(monthly.map(m => m.year))].sort();
    const map = new Map<string, number>();
    for (const m of monthly) {
      map.set(`${m.year}-${m.month}`, m.return_pct);
    }
    const grid: (number | null)[][] = years.map(y =>
      Array.from({ length: 12 }, (_, mo) => map.get(`${y}-${mo + 1}`) ?? null)
    );
    return { years, grid };
  }, [monthly]);

  if (!years.length) return null;

  // Color scale: red → white → green, range ±10%
  function cellColor(v: number | null): string {
    if (v === null) return "transparent";
    const capped = Math.max(-10, Math.min(10, v));
    const t = (capped + 10) / 20;  // 0..1
    if (t >= 0.5) {
      // white → green
      const g = Math.round((t - 0.5) * 2 * 150);
      return `rgba(${150 - g}, ${200}, ${150 - g}, 0.85)`;
    } else {
      // red → white
      const r = Math.round((0.5 - t) * 2 * 150);
      return `rgba(${200}, ${150 - r}, ${150 - r}, 0.85)`;
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] font-mono w-full min-w-[480px]">
        <thead>
          <tr>
            <th className="w-10 text-left text-muted-foreground pb-1">年</th>
            {MONTH_LABELS.map(m => (
              <th key={m} className="text-center text-muted-foreground pb-1 font-normal">{m}</th>
            ))}
            <th className="text-center text-muted-foreground pb-1 font-normal">年度</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y, yi) => {
            const row = grid[yi];
            const yearTotal = row.reduce<number>((acc, v) => acc + (v ?? 0), 0);
            return (
              <tr key={y}>
                <td className="text-muted-foreground pr-1 py-0.5">{y}</td>
                {row.map((v, mi) => (
                  <td key={mi} className="py-0.5 px-px">
                    <div
                      className="rounded text-center tabular-nums"
                      style={{
                        background: cellColor(v),
                        padding:    "1px 2px",
                        color:      "var(--text-primary, #eee)",
                      }}
                    >
                      {v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : ""}
                    </div>
                  </td>
                ))}
                <td className={`text-center font-semibold ${yearTotal >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {yearTotal >= 0 ? "+" : ""}{yearTotal.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Hold period distribution ──────────────────────────────────────────────────

function HoldDaysDist({ trades }: { trades: BacktestTrade[] }) {
  const buckets = useMemo(() => {
    const labels = ["1d", "2-3d", "4-7d", "8-14d", "15-30d", ">30d"];
    const counts = [0, 0, 0, 0, 0, 0];
    for (const t of trades) {
      const d = t.hold_days;
      if (d <= 1) counts[0]++;
      else if (d <= 3) counts[1]++;
      else if (d <= 7) counts[2]++;
      else if (d <= 14) counts[3]++;
      else if (d <= 30) counts[4]++;
      else counts[5]++;
    }
    return labels.map((l, i) => ({ label: l, count: counts[i] }));
  }, [trades]);

  const max = Math.max(...buckets.map(b => b.count), 1);

  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-2 font-medium">持倉天數分佈</p>
      <div className="space-y-1">
        {buckets.map(b => (
          <div key={b.label} className="flex items-center gap-2 text-[10px]">
            <span className="w-12 text-right text-muted-foreground shrink-0">{b.label}</span>
            <div
              className="h-4 rounded-sm bg-blue-500/70 transition-all"
              style={{ width: `${(b.count / max) * 100}%`, minWidth: b.count > 0 ? "2px" : "0" }}
            />
            <span className="text-muted-foreground shrink-0">{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Exit reason breakdown ─────────────────────────────────────────────────────

function ExitReasonBreakdown({ trades }: { trades: BacktestTrade[] }) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of trades) {
      const r = t.exit_reason ?? "signal";
      counts[r] = (counts[r] ?? 0) + 1;
    }
    const total = trades.length || 1;
    return Object.entries(counts).map(([reason, count]) => ({
      reason,
      count,
      pct: count / total * 100,
    })).sort((a, b) => b.count - a.count);
  }, [trades]);

  const REASON_LABELS: Record<string, string> = {
    signal:        "信號出場",
    stop_loss:     "停損出場",
    take_profit:   "停利出場",
    end_of_period: "到期出場",
  };

  const REASON_COLORS: Record<string, string> = {
    signal:        "#3b82f6",
    stop_loss:     "#ef4444",
    take_profit:   "#22c55e",
    end_of_period: "#a78bfa",
  };

  if (data.every(d => d.reason === "signal")) return null;

  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-2 font-medium">出場原因分佈</p>
      <div className="space-y-1">
        {data.map(d => (
          <div key={d.reason} className="flex items-center gap-2 text-[10px]">
            <span className="w-16 shrink-0" style={{ color: REASON_COLORS[d.reason] ?? "#888" }}>
              {REASON_LABELS[d.reason] ?? d.reason}
            </span>
            <div
              className="h-3 rounded-sm transition-all"
              style={{
                width:      `${d.pct}%`,
                minWidth:   "2px",
                background: REASON_COLORS[d.reason] ?? "#888",
              }}
            />
            <span className="text-muted-foreground">{d.count} ({d.pct.toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  trades:         BacktestTrade[];
  monthlyReturns: BacktestMonthlyReturn[];
}

export default function TradeDistPanel({ trades, monthlyReturns }: Props) {
  const streaks = useMemo(() => calcStreaks(trades), [trades]);
  const pnlPcts = useMemo(() => trades.map(t => t.pnl_pct), [trades]);

  if (!trades.length) {
    return (
      <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
        請先執行一次回測以取得交易記錄
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* P&L histogram */}
      <PnLHistogram pnlPcts={pnlPcts} />

      {/* Streak analysis */}
      <div className="space-y-2">
        <p className="text-[10px] font-medium text-muted-foreground">連勝 / 連敗分析</p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded border border-border p-2 space-y-1">
            <p className="text-muted-foreground text-[10px]">最長連勝</p>
            <p className="font-semibold text-green-500 text-lg">{streaks.maxWin} 次</p>
            <p className="text-[10px] text-muted-foreground">平均連勝 {streaks.avgWin.toFixed(1)} 次</p>
          </div>
          <div className="rounded border border-border p-2 space-y-1">
            <p className="text-muted-foreground text-[10px]">最長連敗</p>
            <p className="font-semibold text-red-500 text-lg">{streaks.maxLoss} 次</p>
            <p className="text-[10px] text-muted-foreground">平均連敗 {streaks.avgLoss.toFixed(1)} 次</p>
          </div>
        </div>
        {/* Current streak */}
        {streaks.currentStreak > 0 && (
          <p className="text-[10px]">
            目前{streaks.currentType === "win" ? "連勝" : "連敗"}：
            <span className={streaks.currentType === "win" ? "text-green-500" : "text-red-500"}>
              {streaks.currentStreak} 次
            </span>
          </p>
        )}
        {/* Streak bar viz (mini) */}
        <SVGBar
          values={streaks.streakBars.map(b => b.val)}
          colors={streaks.streakBars.map(b => b.type === "win" ? "#22c55e" : "#ef4444")}
          height={60}
        />
      </div>

      {/* Hold days */}
      <HoldDaysDist trades={trades} />

      {/* Exit reason */}
      <ExitReasonBreakdown trades={trades} />

      {/* Monthly heatmap */}
      {monthlyReturns.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground">月份 P&amp;L 熱力圖（%）</p>
          <MonthlyHeatmap monthly={monthlyReturns} />
        </div>
      )}
    </div>
  );
}
