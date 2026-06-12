"use client";

/**
 * P15-45: 持倉長度最佳化分析
 * 將交易按持倉天數分群，找出報酬率最高的持倉區間。
 * 幫助用戶判斷：「應該設幾天的時間停損最有利？」
 */

import type { BacktestTrade } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades: BacktestTrade[];
}

const BUCKETS = [
  { label: "1 天",   min: 1,  max: 1 },
  { label: "2-3 天", min: 2,  max: 3 },
  { label: "4-5 天", min: 4,  max: 5 },
  { label: "6-10 天",min: 6,  max: 10 },
  { label: "11-20 天",min: 11, max: 20 },
  { label: "21-40 天",min: 21, max: 40 },
  { label: "41+ 天", min: 41, max: Infinity },
];

function barColor(ret: number): string {
  if (ret >= 0.05) return "#22c55e";
  if (ret >= 0.02) return "#86efac";
  if (ret >= 0)    return "#d1fae5";
  if (ret >= -0.02)return "#fca5a5";
  return "#ef4444";
}

export default function HoldingPeriodPanel({ trades }: Props) {
  const { buckets, best, worst, overall } = useMemo(() => {
    if (!trades || trades.length < 3) return { buckets: [], best: null, worst: null, overall: null };

    const result = BUCKETS.map(b => {
      const ts = trades.filter(t => t.hold_days >= b.min && t.hold_days <= b.max);
      if (ts.length === 0) return { ...b, count: 0, winRate: 0, avgRet: 0, totalPnl: 0, medianRet: 0 };
      const wins   = ts.filter(t => t.pnl > 0).length;
      const rets   = ts.map(t => t.pnl_pct ?? 0).sort((a, b) => a - b);
      const median = rets[Math.floor(rets.length / 2)];
      return {
        ...b,
        count:    ts.length,
        winRate:  wins / ts.length,
        avgRet:   rets.reduce((s, r) => s + r, 0) / rets.length,
        totalPnl: ts.reduce((s, t) => s + t.pnl, 0),
        medianRet: median,
      };
    }).filter(b => b.count > 0);

    const withData = result.filter(b => b.count >= 2);
    const best_  = withData.length ? withData.reduce((a, b) => b.avgRet > a.avgRet ? b : a) : null;
    const worst_ = withData.length ? withData.reduce((a, b) => b.avgRet < a.avgRet ? b : a) : null;

    const allRets = trades.map(t => t.pnl_pct ?? 0);
    const overall_ = {
      avgRet:  allRets.reduce((s, r) => s + r, 0) / allRets.length,
      winRate: trades.filter(t => t.pnl > 0).length / trades.length,
    };

    return { buckets: result, best: best_, worst: worst_, overall: overall_ };
  }, [trades]);

  if (buckets.length === 0) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        交易筆數不足，無法進行持倉長度分析
      </div>
    );
  }

  const maxAbsAvg = Math.max(0.01, ...buckets.map(b => Math.abs(b.avgRet)));

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 建議摘要 ────────────────────────────────────────────── */}
      {best && (
        <div
          className="rounded-lg p-3 flex gap-3 items-start"
          style={{ background: "var(--bg-elevated)", border: "1px solid #22c55e33" }}
        >
          <span className="text-lg">💡</span>
          <div>
            <div className="text-xs font-semibold mb-0.5" style={{ color: "#22c55e" }}>
              最佳持倉區間：{best.label}（{best.count} 筆）
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
              平均報酬 {best.avgRet >= 0 ? "+" : ""}{(best.avgRet * 100).toFixed(2)}%，
              勝率 {(best.winRate * 100).toFixed(1)}%。
              {worst && (
                <> 表現最差的區間為 {worst.label}（平均 {(worst.avgRet * 100).toFixed(2)}%）。</>
              )}
            </div>
            {overall && best.avgRet > overall.avgRet * 1.3 && (
              <div className="text-[10px] mt-1" style={{ color: "#f59e0b" }}>
                ⚠ 建議將「最長持倉天數」設為 {best.max === Infinity ? "無限制" : `${best.max} 天`} 以鎖定此區間優勢
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 條形圖 ──────────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
          各持倉區間平均報酬率
        </div>
        <div className="flex flex-col gap-2">
          {buckets.map(b => {
            const barW = Math.abs(b.avgRet) / maxAbsAvg * 60;
            const isPos = b.avgRet >= 0;
            return (
              <div key={b.label} className="flex items-center gap-2">
                <div className="text-[10px] text-right shrink-0 w-20" style={{ color: "var(--text-secondary)" }}>
                  {b.label}
                </div>
                <div className="flex-1 flex items-center gap-1">
                  <div className="relative h-5 flex items-center" style={{ width: "70%" }}>
                    <div
                      className="absolute right-1/2 h-full rounded-l"
                      style={{
                        width: isPos ? 0 : `${barW}%`,
                        background: "#ef4444",
                        opacity: 0.75,
                      }}
                    />
                    <div className="absolute left-1/2 w-px h-full" style={{ background: "var(--border)" }} />
                    <div
                      className="absolute left-1/2 h-full rounded-r"
                      style={{
                        width: isPos ? `${barW}%` : 0,
                        background: barColor(b.avgRet),
                      }}
                    />
                  </div>
                  <div className="text-[10px] font-mono w-16" style={{ color: barColor(b.avgRet) }}>
                    {isPos ? "+" : ""}{(b.avgRet * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="text-[9px] shrink-0 w-20" style={{ color: "var(--text-tertiary)" }}>
                  勝率 {(b.winRate * 100).toFixed(0)}%（{b.count} 筆）
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 明細表格 ─────────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          各區間詳細統計
        </div>
        <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr style={{ background: "var(--bg-elevated)" }}>
                {["持倉區間", "筆數", "勝率", "平均報酬", "中位數報酬", "累計損益"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "var(--text-secondary)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((b, i) => (
                <tr
                  key={b.label}
                  style={{ borderTop: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}
                >
                  <td className="px-3 py-2 font-medium" style={{ color: "var(--text-primary)" }}>{b.label}</td>
                  <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{b.count}</td>
                  <td className="px-3 py-2" style={{ color: b.winRate >= 0.5 ? "#22c55e" : "#ef4444" }}>
                    {(b.winRate * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: b.avgRet >= 0 ? "#22c55e" : "#ef4444" }}>
                    {b.avgRet >= 0 ? "+" : ""}{(b.avgRet * 100).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: b.medianRet >= 0 ? "#22c55e" : "#ef4444" }}>
                    {b.medianRet >= 0 ? "+" : ""}{(b.medianRet * 100).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: b.totalPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {b.totalPnl >= 0 ? "+" : ""}{b.totalPnl.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
