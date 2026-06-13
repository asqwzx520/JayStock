"use client";

/**
 * P19-57: 交易頻率 / 週轉率分析
 * - 月度交易次數熱力圖
 * - 年化週轉率（資本週轉次數）
 * - 交易成本拖累分析
 */

import type { BacktestTrade, BacktestStats } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades:  BacktestTrade[];
  stats:   BacktestStats;
  initialCapital: number;
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function TurnoverPanel({ trades, stats, initialCapital }: Props) {
  const analysis = useMemo(() => {
    if (!trades || trades.length === 0) return null;

    // 月度交易次數
    const monthMap: Record<string, number> = {};
    trades.forEach(t => {
      const key = t.entry_date.slice(0, 7); // "YYYY-MM"
      monthMap[key] = (monthMap[key] ?? 0) + 1;
    });
    const months = Object.keys(monthMap).sort();
    const years  = [...new Set(months.map(m => m.slice(0, 4)))].sort();

    // 月度交易量熱力圖資料
    const heatData: Record<string, Record<number, number>> = {};
    months.forEach(m => {
      const [y, mo] = m.split("-").map(Number);
      if (!heatData[y]) heatData[y] = {};
      heatData[y][mo] = monthMap[m];
    });
    const maxTradesInMonth = Math.max(1, ...Object.values(monthMap));

    // 年度交易量
    const yearTrades: Record<string, number> = {};
    trades.forEach(t => {
      const y = t.entry_date.slice(0, 4);
      yearTrades[y] = (yearTrades[y] ?? 0) + 1;
    });

    // 週轉率：總交易金額 / 平均資本
    const totalVolume = trades.reduce((s, t) => s + Math.abs(t.shares ?? 0) * t.entry_price, 0);
    const avgCapital  = (initialCapital + stats.final_equity) / 2;
    const annualTurnover = avgCapital > 0 ? totalVolume / avgCapital : 0;

    // 月均交易次數
    const avgTradesPerMonth = trades.length / Math.max(1, months.length);

    // 交易成本估算（費用已在回測中計算，此處重新估算以顯示拖累）
    const totalFee = trades.reduce((s, t) => s + (t.fee ?? 0), 0);
    const feeAsReturnDrag = totalFee / initialCapital;

    // 空窗率：無部位的交易日比例（用 hold_days 近似）
    const totalHoldDays = trades.reduce((s, t) => s + Math.max(0, t.hold_days ?? 0), 0);

    // 最忙的月份 / 最閒的月份
    const sortedMonths = months.slice().sort((a, b) => (monthMap[b] ?? 0) - (monthMap[a] ?? 0));

    return {
      monthMap, months, years, heatData, maxTradesInMonth, yearTrades,
      annualTurnover, avgTradesPerMonth, totalFee, feeAsReturnDrag, totalHoldDays,
      busiestMonth: sortedMonths[0], quietestMonth: sortedMonths[sortedMonths.length - 1],
    };
  }, [trades, stats, initialCapital]);

  if (!analysis) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        無交易紀錄
      </div>
    );
  }

  const {
    months, years, heatData, maxTradesInMonth, yearTrades,
    annualTurnover, avgTradesPerMonth, totalFee, feeAsReturnDrag,
    busiestMonth, quietestMonth,
  } = analysis;

  function heatBg(n: number) {
    if (n === 0)  return "transparent";
    const ratio = n / maxTradesInMonth;
    if (ratio > 0.75) return "#1d4ed8";
    if (ratio > 0.50) return "#3b82f6";
    if (ratio > 0.25) return "#93c5fd";
    return "#dbeafe";
  }
  function heatText(n: number) {
    const ratio = n / maxTradesInMonth;
    return ratio > 0.5 ? "#fff" : "#1e3a8a";
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 摘要卡片 ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "月均交易次數",
            value: avgTradesPerMonth.toFixed(1),
            hint:  `共 ${months.length} 個月`,
            color: "var(--text-primary)",
          },
          {
            label: "年化週轉率",
            value: `${annualTurnover.toFixed(1)}x`,
            hint:  annualTurnover > 5 ? "高頻率，成本壓力大" : annualTurnover > 2 ? "中等頻率" : "低頻率，成本效率高",
            color: annualTurnover > 5 ? "#ef4444" : annualTurnover > 2 ? "#f59e0b" : "#22c55e",
          },
          {
            label: "累計手續費",
            value: `${(totalFee / 1000).toFixed(1)}K`,
            hint:  `佔初始資本 ${(feeAsReturnDrag * 100).toFixed(2)}%`,
            color: feeAsReturnDrag > 0.05 ? "#ef4444" : "#f59e0b",
          },
          {
            label: "最忙月份",
            value: busiestMonth,
            hint:  `${analysis.monthMap[busiestMonth] ?? 0} 筆交易`,
            color: "#6366f1",
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

      {/* ── 月度熱力圖 ──────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          月度交易次數熱力圖
        </div>
        <div className="overflow-x-auto rounded-lg p-2"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <table className="text-[9px] border-collapse">
            <thead>
              <tr>
                <th className="px-1 py-0.5 text-right" style={{ color: "var(--text-tertiary)", minWidth: 36 }}>年</th>
                {MONTH_SHORT.map(m => (
                  <th key={m} className="px-1 py-0.5 text-center"
                    style={{ color: "var(--text-tertiary)", minWidth: 28 }}>{m}</th>
                ))}
                <th className="px-1 py-0.5 text-center" style={{ color: "var(--text-tertiary)", minWidth: 28 }}>
                  全年
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => (
                <tr key={y}>
                  <td className="px-1 py-0.5 text-right font-semibold"
                    style={{ color: "var(--text-secondary)" }}>{y}</td>
                  {Array.from({ length: 12 }, (_, mi) => {
                    const n = heatData[y]?.[mi + 1] ?? 0;
                    return (
                      <td key={mi} className="px-0.5 py-0.5 text-center"
                        style={{
                          background: heatBg(n),
                          color: n > 0 ? heatText(n) : "var(--text-tertiary)",
                          borderRadius: 2,
                        }}>
                        {n > 0 ? n : "—"}
                      </td>
                    );
                  })}
                  <td className="px-1 py-0.5 text-center font-semibold"
                    style={{ color: "var(--text-primary)" }}>
                    {yearTrades[y] ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>少</span>
          {[0.15, 0.35, 0.60, 0.85].map((r, i) => (
            <div key={i} className="w-4 h-3 rounded-sm" style={{ background: heatBg(Math.round(r * maxTradesInMonth)) }} />
          ))}
          <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>多</span>
        </div>
      </div>

      {/* ── 年度交易量長條圖 ────────────────────────────── */}
      {years.length >= 2 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            各年交易次數
          </div>
          <div className="rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            {(() => {
              const maxY = Math.max(1, ...years.map(y => yearTrades[y] ?? 0));
              return (
                <div className="flex items-end gap-2" style={{ height: 60 }}>
                  {years.map(y => {
                    const n   = yearTrades[y] ?? 0;
                    const pct = n / maxY;
                    return (
                      <div key={y} className="flex-1 flex flex-col items-center gap-1">
                        <div className="text-[8px]" style={{ color: "#6366f1" }}>{n}</div>
                        <div className="w-full rounded-t"
                          style={{ height: Math.max(2, pct * 44), background: "#6366f1", opacity: 0.8 }} />
                        <div className="text-[8px]" style={{ color: "var(--text-tertiary)" }}>{y.slice(2)}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── 成本效率分析 ────────────────────────────────── */}
      <div className="rounded-lg p-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="text-[10px] font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          交易成本效率
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-[9px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>每筆平均費用</div>
            <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>
              {(totalFee / Math.max(1, trades.length)).toFixed(0)} 元
            </div>
          </div>
          <div className="text-center">
            <div className="text-[9px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>費用/年化報酬</div>
            <div className="text-sm font-bold"
              style={{ color: stats.cagr > 0 ? (feeAsReturnDrag / stats.cagr > 0.3 ? "#ef4444" : "#f59e0b") : "#ef4444" }}>
              {stats.cagr > 0
                ? `${((feeAsReturnDrag / stats.cagr) * 100).toFixed(1)}%`
                : "N/A"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[9px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>費用/毛利潤估計</div>
            <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>
              {(() => {
                const grossProfit = (stats.final_equity - initialCapital) + totalFee;
                return grossProfit > 0
                  ? `${((totalFee / grossProfit) * 100).toFixed(1)}%`
                  : "N/A";
              })()}
            </div>
          </div>
        </div>
        {feeAsReturnDrag / Math.max(0.001, stats.cagr) > 0.3 && (
          <div className="mt-2 text-[9px] px-2 py-1.5 rounded"
            style={{ background: "#fef9c3", border: "1px solid #fde68a", color: "#92400e" }}>
            ⚠ 交易成本佔年化報酬比例偏高，建議降低交易頻率或爭取手續費折扣。
          </div>
        )}
      </div>
    </div>
  );
}
