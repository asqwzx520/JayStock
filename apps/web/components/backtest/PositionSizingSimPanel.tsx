"use client";

/**
 * P20-59: 倉位大小模擬比較
 * 使用實際交易報酬率，模擬不同倉位策略下的最終資金曲線：
 * - 原始（回測設定）
 * - 固定 50% / 75% 倉位
 * - Half Kelly
 * - 波動率目標（10% 年化波動率）
 */

import type { BacktestTrade, BacktestStats } from "@/lib/api";
import { useMemo, useState } from "react";

interface Props {
  trades:         BacktestTrade[];
  stats:          BacktestStats;
  initialCapital: number;
  positionSizePct?: number;
}

interface SimResult {
  label:      string;
  color:      string;
  finalEq:    number;
  totalRet:   number;
  maxDD:      number;
  curve:      number[];
}

function simulate(trades: BacktestTrade[], initialCapital: number, sizeFn: (i: number) => number): SimResult["curve"] {
  let equity = initialCapital;
  const curve = [equity];
  for (let i = 0; i < trades.length; i++) {
    const f   = Math.max(0, Math.min(1, sizeFn(i)));
    const ret = trades[i].pnl_pct ?? 0;
    equity    = equity * (1 + f * ret);
    curve.push(equity);
  }
  return curve;
}

function curveStats(curve: number[], initialCapital: number): { finalEq: number; totalRet: number; maxDD: number } {
  const finalEq  = curve[curve.length - 1];
  const totalRet = (finalEq - initialCapital) / initialCapital;
  let peak = initialCapital, maxDD = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return { finalEq, totalRet, maxDD };
}

export default function PositionSizingSimPanel({ trades, stats, initialCapital, positionSizePct = 1.0 }: Props) {
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const sims = useMemo((): SimResult[] => {
    if (!trades || trades.length === 0) return [];

    // Kelly fraction（半 Kelly 更安全）
    const wins   = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const wr     = wins.length / trades.length;
    const avgWin  = wins.length ? wins.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / losses.length) : 0.01;
    const fullKelly = avgLoss > 0 ? wr / avgLoss - (1 - wr) / avgWin : 0;
    const halfKelly = Math.max(0.05, Math.min(0.5, fullKelly / 2));

    // 波動率目標：使每筆交易的「貢獻波動率」 = 10% / sqrt(252)
    const targetDailyVol = 0.10 / Math.sqrt(252);
    const tradeVols = trades.map(t => Math.abs(t.pnl_pct ?? 0.01));
    const medVol = [...tradeVols].sort((a, b) => a - b)[Math.floor(tradeVols.length / 2)] ?? 0.02;
    const volTargetF = Math.max(0.05, Math.min(1.0, targetDailyVol / medVol));

    const configs: { label: string; color: string; f: (i: number) => number }[] = [
      { label: `原始（${(positionSizePct * 100).toFixed(0)}%）`, color: "#6366f1", f: () => positionSizePct },
      { label: "固定 50%",           color: "#f59e0b", f: () => 0.50 },
      { label: "固定 75%",           color: "#22c55e", f: () => 0.75 },
      { label: `Half Kelly（${(halfKelly * 100).toFixed(0)}%）`, color: "#ec4899", f: () => halfKelly },
      { label: `波動率目標（${(volTargetF * 100).toFixed(0)}%）`, color: "#14b8a6", f: () => volTargetF },
    ];

    return configs.map(({ label, color, f }) => {
      const curve = simulate(trades, initialCapital, f);
      const { finalEq, totalRet, maxDD } = curveStats(curve, initialCapital);
      return { label, color, finalEq, totalRet, maxDD, curve };
    });
  }, [trades, initialCapital, positionSizePct]);

  if (sims.length === 0) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        無交易資料
      </div>
    );
  }

  // SVG 資金曲線
  const CW = 440, CH = 140, CP = 10;
  const n      = sims[0].curve.length;
  const allVals = sims.flatMap(s => s.curve);
  const minV   = Math.min(...allVals);
  const maxV   = Math.max(...allVals);
  const cx     = (i: number) => CP + (i / (n - 1)) * (CW - CP * 2);
  const cy     = (v: number) => CP + (1 - (v - minV) / (maxV - minV)) * (CH - CP * 2);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 說明 ────────────────────────────────────────── */}
      <div className="text-[10px] px-2 py-1.5 rounded"
        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
        以實際交易報酬率為基礎，模擬不同倉位規則的資金路徑。<br />
        結果僅供參考：不含滑點/手續費的重新計算，且假設每筆獨立。
      </div>

      {/* ── 資金曲線比較圖 ──────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          模擬資金曲線（按交易序號）
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <svg viewBox={`0 0 ${CW} ${CH + 14}`} style={{ width: "100%", height: CH + 14 }}>
            {/* 初始資金水平線 */}
            <line x1={CP} y1={cy(initialCapital)} x2={CW - CP} y2={cy(initialCapital)}
              stroke="var(--border)" strokeWidth={0.8} strokeDasharray="3,2" />
            {/* 各策略曲線 */}
            {sims.map(s => (
              <polyline key={s.label}
                points={s.curve.map((v, i) => `${cx(i)},${cy(v)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={highlighted === null || highlighted === s.label ? 1.5 : 0.5}
                opacity={highlighted === null || highlighted === s.label ? 1 : 0.25}
                strokeLinejoin="round"
              />
            ))}
            {/* X/Y 軸標籤 */}
            <text x={CP} y={CH + 12} fontSize={7} fill="var(--text-tertiary)">交易 1</text>
            <text x={CW - CP} y={CH + 12} fontSize={7} textAnchor="end" fill="var(--text-tertiary)">
              第 {n - 1} 筆
            </text>
          </svg>
        </div>
        {/* 圖例 */}
        <div className="flex flex-wrap gap-3 mt-2">
          {sims.map(s => (
            <button key={s.label}
              className="flex items-center gap-1 text-[9px] transition-opacity"
              style={{ opacity: highlighted === null || highlighted === s.label ? 1 : 0.4 }}
              onClick={() => setHighlighted(prev => prev === s.label ? null : s.label)}
            >
              <div className="w-4 h-1.5 rounded-full" style={{ background: s.color }} />
              <span style={{ color: "var(--text-secondary)" }}>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 比較表格 ────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          各策略最終結果比較
        </div>
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["策略","最終資金","總報酬","最大回撤","回報/回撤"].map(h => (
                  <th key={h} className="px-2 py-1 text-center"
                    style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sims.map((s, i) => {
                const calmar = s.maxDD > 0 ? s.totalRet / s.maxDD : 999;
                const isOrig = i === 0;
                return (
                  <tr key={s.label}
                    style={{
                      borderBottom: "1px solid var(--border)22",
                      background: isOrig ? "var(--bg-elevated)66" : "transparent",
                      fontWeight: isOrig ? 600 : 400,
                    }}>
                    <td className="px-2 py-1 flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                      <span style={{ color: "var(--text-primary)" }}>{s.label}</span>
                    </td>
                    <td className="px-2 py-1 text-center font-mono"
                      style={{ color: s.finalEq >= initialCapital ? "#22c55e" : "#ef4444" }}>
                      {(s.finalEq / 1_000_000).toFixed(3)}M
                    </td>
                    <td className="px-2 py-1 text-center font-mono"
                      style={{ color: s.totalRet >= 0 ? "#22c55e" : "#ef4444" }}>
                      {s.totalRet >= 0 ? "+" : ""}{(s.totalRet * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-1 text-center font-mono" style={{ color: "#ef4444" }}>
                      -{(s.maxDD * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-1 text-center font-mono"
                      style={{ color: calmar >= 1 ? "#22c55e" : "#f59e0b" }}>
                      {calmar >= 99 ? "∞" : calmar.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          點擊圖例可高亮單一策略曲線
        </div>
      </div>
    </div>
  );
}
