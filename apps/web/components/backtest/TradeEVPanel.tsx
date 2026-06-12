"use client";

/**
 * P18-53: 交易期望值分析（Expected Value）
 * - EV = win_rate * avg_win - (1-win_rate) * avg_loss
 * - 損益平衡最低勝率
 * - 滾動 20 筆 EV 穩定性曲線
 * - 勝率 / 盈虧比敏感度矩陣
 */

import type { BacktestTrade } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades: BacktestTrade[];
}

function cellColor(ev: number, base: number): string {
  const delta = ev - base;
  if (delta > 0.03)  return "#15803d";
  if (delta > 0.01)  return "#22c55e";
  if (delta > -0.01) return "var(--bg-elevated)";
  if (delta > -0.03) return "#fca5a5";
  return "#ef4444";
}

function cellText(ev: number, base: number): string {
  const delta = ev - base;
  return Math.abs(delta) > 0.01 ? "#fff" : "var(--text-primary)";
}

export default function TradeEVPanel({ trades }: Props) {
  const analysis = useMemo(() => {
    if (!trades || trades.length < 4) return null;

    const wins  = trades.filter(t => t.pnl > 0);
    const loses = trades.filter(t => t.pnl <= 0);
    const wr    = wins.length / trades.length;

    const avgWinPct  = wins.length  ? wins.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / wins.length   : 0;
    const avgLossPct = loses.length ? Math.abs(loses.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / loses.length) : 0;

    const ev = wr * avgWinPct - (1 - wr) * avgLossPct;

    // 損益平衡最低勝率：wr_min * avgWin = (1-wr_min) * avgLoss
    const wrBreakeven = avgLossPct > 0 ? avgLossPct / (avgWinPct + avgLossPct) : null;

    // Kelly fraction
    const kellyF = avgLossPct > 0 ? wr / avgLossPct - (1 - wr) / avgWinPct : 0;

    // EV per day held
    const evPerDay = trades.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) /
      trades.reduce((s, t) => s + Math.max(1, t.hold_days), 0);

    // 滾動 20 筆 EV
    const rollingEV: number[] = [];
    for (let i = 20; i <= trades.length; i++) {
      const slice = trades.slice(i - 20, i);
      const w  = slice.filter(t => t.pnl > 0);
      const l  = slice.filter(t => t.pnl <= 0);
      const wr2 = w.length / slice.length;
      const aw  = w.length  ? w.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / w.length  : 0;
      const al  = l.length  ? Math.abs(l.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / l.length) : 0;
      rollingEV.push(wr2 * aw - (1 - wr2) * al);
    }

    // 敏感度矩陣：勝率 × 盈虧比
    const wrValues  = [0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65];
    const pfValues  = [1.0, 1.5, 2.0, 2.5, 3.0];
    // 計算各組合 EV（假設 avgLoss 不變，用 pf * avgLoss = avgWin）
    const matrix = wrValues.map(w =>
      pfValues.map(pf => {
        const aw = pf * avgLossPct;
        return w * aw - (1 - w) * avgLossPct;
      })
    );

    return { ev, wr, avgWinPct, avgLossPct, wrBreakeven, kellyF, evPerDay, rollingEV, wrValues, pfValues, matrix };
  }, [trades]);

  if (!analysis) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        交易筆數不足（需至少 4 筆）
      </div>
    );
  }

  const { ev, wr, avgWinPct, avgLossPct, wrBreakeven, kellyF, evPerDay, rollingEV, wrValues, pfValues, matrix } = analysis;

  // 滾動 EV 圖
  const CW = 420, CH = 80, CP = 10;
  const evMax = Math.max(Math.abs(ev) * 2, 0.01, ...rollingEV.map(Math.abs));
  const evX = (i: number) => CP + (i / (rollingEV.length - 1 || 1)) * (CW - CP * 2);
  const evY = (v: number) => CH / 2 - (v / evMax) * (CH / 2 - CP);

  // 目前勝率在矩陣中的 index
  const curWrIdx = wrValues.reduce((best, w, i) =>
    Math.abs(w - wr) < Math.abs(wrValues[best] - wr) ? i : best, 0);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 核心指標 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "每筆期望值（EV）",
            value: `${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(3)}%`,
            color: ev >= 0 ? "#22c55e" : "#ef4444",
            hint:  ev >= 0 ? "每筆交易平均正期望" : "策略負期望，長期必然虧損",
          },
          {
            label: "每持倉日期望值",
            value: `${evPerDay >= 0 ? "+" : ""}${(evPerDay * 100).toFixed(4)}%/日`,
            color: evPerDay >= 0 ? "#22c55e" : "#ef4444",
            hint:  "EV ÷ 平均持倉天數，越高越有效率",
          },
          {
            label: "損益平衡勝率",
            value: wrBreakeven !== null ? `${(wrBreakeven * 100).toFixed(1)}%` : "N/A",
            color: wr >= (wrBreakeven ?? 0) ? "#22c55e" : "#ef4444",
            hint:  `目前勝率 ${(wr * 100).toFixed(1)}%，${wr >= (wrBreakeven ?? 0) ? "高於損平線 ✓" : "低於損平線 ✗"}`,
          },
          {
            label: "Full Kelly 建議倉位",
            value: kellyF > 0 ? `${(Math.min(kellyF, 1) * 100).toFixed(1)}%` : "不建議",
            color: kellyF > 0 ? "#f59e0b" : "#ef4444",
            hint:  "Half Kelly 更安全：" + (kellyF > 0 ? `${(Math.min(kellyF / 2, 1) * 100).toFixed(1)}%` : "N/A"),
          },
        ].map(s => (
          <div key={s.label} className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{s.hint}</div>
          </div>
        ))}
      </div>

      {/* EV 分解 */}
      <div className="rounded-lg p-3 grid grid-cols-3 gap-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="text-center">
          <div className="text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>
            獲利貢獻 = WR × AvgWin
          </div>
          <div className="text-sm font-bold" style={{ color: "#22c55e" }}>
            {(wr * avgWinPct * 100).toFixed(3)}%
          </div>
        </div>
        <div className="text-center text-2xl font-bold" style={{ color: "var(--text-tertiary)" }}>
          −
        </div>
        <div className="text-center">
          <div className="text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>
            虧損拖累 = (1-WR) × AvgLoss
          </div>
          <div className="text-sm font-bold" style={{ color: "#ef4444" }}>
            {((1 - wr) * avgLossPct * 100).toFixed(3)}%
          </div>
        </div>
      </div>

      {/* ── 滾動 EV 穩定性 ────────────────────────────────────── */}
      {rollingEV.length >= 5 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            滾動 20 筆期望值（策略穩定性）
          </div>
          <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <svg viewBox={`0 0 ${CW} ${CH + 12}`} style={{ width: "100%", height: CH + 12 }}>
              {/* 零線 */}
              <line x1={CP} y1={CH / 2} x2={CW - CP} y2={CH / 2}
                stroke="var(--border)" strokeWidth={0.8} />
              {/* 填色面積 */}
              <defs>
                <linearGradient id="evGradPos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              {/* 折線 */}
              <polyline
                points={rollingEV.map((v, i) => `${evX(i)},${evY(v)}`).join(" ")}
                fill="none" stroke="#6366f1" strokeWidth={1.5} strokeLinejoin="round"
              />
              {/* 全期 EV 水平線 */}
              <line x1={CP} y1={evY(ev)} x2={CW - CP} y2={evY(ev)}
                stroke="#22c55e" strokeWidth={1} strokeDasharray="4,2" opacity={0.7} />
              <text x={CW - CP - 2} y={evY(ev) - 3} fontSize={7} textAnchor="end" fill="#22c55e" opacity={0.8}>
                全期 EV
              </text>
              <text x={CW / 2} y={CH + 10} fontSize={7} textAnchor="middle" fill="var(--text-tertiary)">
                ← 交易序號（每 20 筆滾動）→
              </text>
            </svg>
          </div>
          <div className="text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
            紫線 = 滾動 EV；綠虛線 = 全期平均 EV。EV 穩定接近綠線代表策略一致性高。
          </div>
        </div>
      )}

      {/* ── 勝率 × 盈虧比 敏感度矩陣 ─────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          EV 敏感度矩陣（勝率 × 盈虧比）
        </div>
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse" style={{ minWidth: 320 }}>
            <thead>
              <tr>
                <th className="px-2 py-1 text-right" style={{ color: "var(--text-tertiary)", minWidth: 50 }}>
                  勝率 ↓ / PF →
                </th>
                {pfValues.map(pf => (
                  <th key={pf} className="px-2 py-1 text-center" style={{ color: "var(--text-tertiary)", minWidth: 52 }}>
                    {pf.toFixed(1)}x
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wrValues.map((w, wi) => (
                <tr key={w}>
                  <td
                    className="px-2 py-1 text-right font-semibold"
                    style={{
                      color: wi === curWrIdx ? "var(--color-brand)" : "var(--text-secondary)",
                      fontWeight: wi === curWrIdx ? 700 : 400,
                    }}
                  >
                    {(w * 100).toFixed(0)}%{wi === curWrIdx ? " ←" : ""}
                  </td>
                  {pfValues.map((pf, pi) => {
                    const evVal = matrix[wi][pi];
                    const bg    = cellColor(evVal, ev);
                    const tc    = cellText(evVal, ev);
                    return (
                      <td key={pf} className="px-1 py-1 text-center"
                        style={{ background: bg, color: tc, borderRadius: 3 }}>
                        <span className="font-mono text-[9px]">
                          {evVal >= 0 ? "+" : ""}{(evVal * 100).toFixed(2)}%
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          ← 標示目前策略勝率；色塊相對於目前 EV（深綠 = 大幅改善，深紅 = 大幅惡化）
        </div>
      </div>
    </div>
  );
}
