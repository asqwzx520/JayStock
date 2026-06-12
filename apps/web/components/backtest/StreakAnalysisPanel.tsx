"use client";

/**
 * P16-47: 連勝連敗風險分析
 * 分析連勝/連敗分佈，估算期望最長連敗與破產風險。
 */

import type { BacktestTrade } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades: BacktestTrade[];
}

function computeStreaks(trades: BacktestTrade[]) {
  const results = trades.map(t => t.pnl > 0);
  const winStreaks: number[] = [];
  const lossStreaks: number[] = [];
  let cur = 0;
  let prev: boolean | null = null;

  for (const r of results) {
    if (prev === null || r !== prev) {
      if (prev !== null) {
        if (prev) winStreaks.push(cur);
        else lossStreaks.push(cur);
      }
      cur = 1;
    } else {
      cur++;
    }
    prev = r;
  }
  if (prev !== null) {
    if (prev) winStreaks.push(cur);
    else lossStreaks.push(cur);
  }
  return { winStreaks, lossStreaks };
}

function streakDist(streaks: number[]): { len: number; count: number }[] {
  const map = new Map<number, number>();
  for (const s of streaks) map.set(s, (map.get(s) ?? 0) + 1);
  return Array.from(map.entries())
    .map(([len, count]) => ({ len, count }))
    .sort((a, b) => a.len - b.len);
}

// 期望最長連敗（負二項分佈近似）
function expectedMaxLoss(winRate: number, n: number): number {
  if (winRate <= 0 || winRate >= 1 || n <= 0) return 0;
  const lossRate = 1 - winRate;
  // 期望值近似：log(n) / log(1/lossRate)
  return Math.log(n) / Math.log(1 / lossRate);
}

// 破產風險：Kelly 公式 + ruin probability
// P(ruin) ≈ ((1-f)/f)^(capital/unit) where f = Kelly fraction
function ruinProbability(winRate: number, avgWin: number, avgLoss: number): number {
  if (winRate <= 0 || winRate >= 1 || avgLoss === 0) return 0;
  const r = Math.abs(avgWin / avgLoss);
  // Gambler's ruin for simplified model: p(ruin) ≈ ((1-p)/p)^1 if p < 0.5, 0 otherwise
  const q = 1 - winRate;
  if (winRate <= 0.5) return Math.min(1, (q / winRate) ** 1);
  return Math.max(0, (q / winRate) ** 10); // approximate for high win rate
}

export default function StreakAnalysisPanel({ trades }: Props) {
  const analysis = useMemo(() => {
    if (!trades || trades.length < 4) return null;

    const { winStreaks, lossStreaks } = computeStreaks(trades);
    const winRate   = trades.filter(t => t.pnl > 0).length / trades.length;
    const maxWin    = Math.max(0, ...winStreaks);
    const maxLoss   = Math.max(0, ...lossStreaks);
    const avgWinPct = trades.filter(t => t.pnl > 0).reduce((s, t) => s + (t.pnl_pct ?? 0), 0) /
      Math.max(1, trades.filter(t => t.pnl > 0).length);
    const avgLossPct = Math.abs(
      trades.filter(t => t.pnl <= 0).reduce((s, t) => s + (t.pnl_pct ?? 0), 0) /
      Math.max(1, trades.filter(t => t.pnl <= 0).length)
    );
    const expMaxLoss = expectedMaxLoss(winRate, trades.length);
    const ruin       = ruinProbability(winRate, avgWinPct, avgLossPct);

    const winDist  = streakDist(winStreaks);
    const lossDist = streakDist(lossStreaks);

    return { maxWin, maxLoss, winRate, expMaxLoss, ruin, winDist, lossDist, avgWinPct, avgLossPct };
  }, [trades]);

  if (!analysis) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        交易筆數不足（需至少 4 筆）
      </div>
    );
  }

  const { maxWin, maxLoss, winRate, expMaxLoss, ruin, winDist, lossDist, avgWinPct, avgLossPct } = analysis;
  const ruinPct = ruin * 100;
  const ruinColor = ruinPct > 30 ? "#ef4444" : ruinPct > 10 ? "#f59e0b" : "#22c55e";
  const maxLossDist = Math.max(1, ...winDist.map(d => d.count), ...lossDist.map(d => d.count));

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 關鍵指標 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "最長連勝",    value: `${maxWin} 筆`,                          color: "#22c55e" },
          { label: "最長連敗",    value: `${maxLoss} 筆`,                         color: "#ef4444" },
          { label: "期望最長連敗", value: `${expMaxLoss.toFixed(1)} 筆`,          color: "#f59e0b",
            hint: "統計期望值（負二項近似）" },
          { label: "破產風險估算", value: `${ruinPct.toFixed(1)}%`,               color: ruinColor,
            hint: "基於勝率與盈虧比的簡化估算" },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          >
            <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: s.color }}>{s.value}</div>
            {s.hint && <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{s.hint}</div>}
          </div>
        ))}
      </div>

      {/* ── 連敗警告 ──────────────────────────────────────────── */}
      {maxLoss >= Math.ceil(expMaxLoss) && (
        <div
          className="rounded-lg p-3 flex gap-2 items-start"
          style={{ background: "#fef2f2", border: "1px solid #fca5a5" }}
        >
          <span>⚠️</span>
          <div className="text-[11px]" style={{ color: "#991b1b" }}>
            最長連敗（{maxLoss} 筆）已超過統計期望值（{expMaxLoss.toFixed(1)} 筆），
            代表策略曾經歷超預期的逆境。連續 {maxLoss} 筆虧損的複利損失約為{" "}
            <strong>{((1 - (1 + avgLossPct) ** -maxLoss) * 100).toFixed(1)}%</strong>。
          </div>
        </div>
      )}

      {/* ── 分佈圖（並排） ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          { title: "連勝分佈", dist: winDist,  color: "#22c55e" },
          { title: "連敗分佈", dist: lossDist, color: "#ef4444" },
        ].map(({ title, dist, color }) => (
          <div key={title}>
            <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>{title}</div>
            <div
              className="rounded-lg p-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              {dist.length === 0 ? (
                <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>無資料</div>
              ) : (
                <svg viewBox={`0 0 200 90`} style={{ width: "100%", height: 90 }}>
                  {dist.map((d, i) => {
                    const barH = (d.count / maxLossDist) * 65;
                    const x    = i * (200 / dist.length) + 4;
                    const w    = Math.max(4, 200 / dist.length - 6);
                    return (
                      <g key={d.len}>
                        <rect x={x} y={70 - barH} width={w} height={barH} fill={color} rx={2} opacity={0.8}>
                          <title>{`連續 ${d.len} 筆: ${d.count} 次`}</title>
                        </rect>
                        <text x={x + w / 2} y={82} fontSize={7} textAnchor="middle" fill="var(--text-tertiary)">
                          {d.len}
                        </text>
                        {d.count > 0 && (
                          <text x={x + w / 2} y={70 - barH - 2} fontSize={7} textAnchor="middle" fill={color}>
                            {d.count}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  <line x1={0} y1={70} x2={200} y2={70} stroke="var(--border)" strokeWidth={0.5} />
                  <text x={100} y={88} fontSize={7} textAnchor="middle" fill="var(--text-tertiary)">連續筆數</text>
                </svg>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── 盈虧統計 ──────────────────────────────────────────── */}
      <div
        className="rounded-lg p-3 grid grid-cols-3 gap-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
      >
        <div className="text-center">
          <div className="text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>勝率</div>
          <div className="text-sm font-bold" style={{ color: winRate >= 0.5 ? "#22c55e" : "#ef4444" }}>
            {(winRate * 100).toFixed(1)}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>平均獲利</div>
          <div className="text-sm font-bold" style={{ color: "#22c55e" }}>
            +{(avgWinPct * 100).toFixed(2)}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>平均虧損</div>
          <div className="text-sm font-bold" style={{ color: "#ef4444" }}>
            -{(avgLossPct * 100).toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>
        破產風險基於 Gambler&apos;s ruin 簡化模型，假設每筆交易獨立。實際風險取決於資金管理策略。
      </div>
    </div>
  );
}
