"use client";

/**
 * P18-54: 月份季節性分析
 * 跨年度彙總每個月（1-12月）的平均報酬與勝率，
 * 不同於 CalendarHeatmapPanel 的年×月矩陣。
 */

import { useMemo } from "react";

interface MonthlyReturn {
  year:  number;
  month: number;
  ret:   number;
}

interface RawMonthlyReturn {
  year:       number;
  month:      number;
  return_pct: number;
}

interface Props {
  monthly_returns?: RawMonthlyReturn[];
}

const MONTH_NAMES = ["一月","二月","三月","四月","五月","六月",
                     "七月","八月","九月","十月","十一月","十二月"];

export default function SeasonalityPanel({ monthly_returns }: Props) {
  const stats = useMemo(() => {
    if (!monthly_returns || monthly_returns.length === 0) return null;

    const byMonth: MonthlyReturn[] = monthly_returns.map(d => ({
      year:  d.year,
      month: d.month,
      ret:   d.return_pct,
    }));

    if (byMonth.length < 3) return null;

    // 按 1-12 月彙總
    const groups: number[][] = Array.from({ length: 12 }, () => []);
    byMonth.forEach(d => {
      const idx = d.month - 1;
      if (idx >= 0 && idx < 12) groups[idx].push(d.ret);
    });

    const monthStats = groups.map((arr, idx) => {
      if (arr.length === 0) return { month: idx + 1, avgRet: null, winRate: null, count: 0, medRet: null };
      const sorted  = [...arr].sort((a, b) => a - b);
      const med     = sorted[Math.floor(sorted.length / 2)];
      const avg     = arr.reduce((s, v) => s + v, 0) / arr.length;
      const winRate = arr.filter(v => v > 0).length / arr.length;
      return { month: idx + 1, avgRet: avg, winRate, count: arr.length, medRet: med };
    });

    // 年度涵蓋
    const years = [...new Set(byMonth.map(d => d.year))].sort();

    // 最佳/最差月份
    const validMonths = monthStats.filter(m => m.avgRet !== null);
    const bestMonth  = validMonths.reduce((a, b) => (a.avgRet! > b.avgRet! ? a : b), validMonths[0]);
    const worstMonth = validMonths.reduce((a, b) => (a.avgRet! < b.avgRet! ? a : b), validMonths[0]);

    // 逐年 × 月資料（Heat strip）
    const heatData = byMonth.reduce<Record<string, Record<number, number>>>((acc, d) => {
      if (!acc[d.year]) acc[d.year] = {};
      acc[d.year][d.month] = d.ret;
      return acc;
    }, {});

    return { monthStats, years, bestMonth, worstMonth, heatData };
  }, [monthly_returns]);

  if (!stats) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        月度資料不足
      </div>
    );
  }

  const { monthStats, years, bestMonth, worstMonth, heatData } = stats;

  // 柱狀圖
  const maxAbs  = Math.max(0.001, ...monthStats.filter(m => m.avgRet !== null).map(m => Math.abs(m.avgRet!)));
  const BH = 80, BW = 400, BP = 8, colW = (BW - BP * 2) / 12;

  function barColor(r: number) {
    if (r > 0.04)  return "#15803d";
    if (r > 0.02)  return "#22c55e";
    if (r > 0)     return "#86efac";
    if (r > -0.02) return "#fca5a5";
    if (r > -0.04) return "#ef4444";
    return "#991b1b";
  }

  function heatBg(r: number) {
    if (r > 0.04)  return "#15803d";
    if (r > 0.02)  return "#22c55e";
    if (r > 0)     return "#bbf7d0";
    if (r > -0.02) return "#fee2e2";
    if (r > -0.04) return "#ef4444";
    return "#991b1b";
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 月份概覽 ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            月份季節性分析
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
            跨 {years.length} 年（{years[0]}–{years[years.length - 1]}）各月彙總績效
          </div>
        </div>
        <div className="flex gap-2">
          {[
            { label: `最強月份：${MONTH_NAMES[bestMonth.month - 1]}`,  color: "#22c55e",
              hint: `平均 ${((bestMonth.avgRet ?? 0) * 100).toFixed(2)}%` },
            { label: `最弱月份：${MONTH_NAMES[worstMonth.month - 1]}`, color: "#ef4444",
              hint: `平均 ${((worstMonth.avgRet ?? 0) * 100).toFixed(2)}%` },
          ].map(b => (
            <div key={b.label} className="rounded-lg px-3 py-2 text-center"
              style={{ background: "var(--bg-elevated)", border: `1px solid ${b.color}44` }}>
              <div className="text-[10px] font-bold" style={{ color: b.color }}>{b.label}</div>
              <div className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>{b.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 柱狀圖：平均月報酬 ─────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          各月平均報酬（跨年度彙總）
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <svg viewBox={`0 0 ${BW} ${BH + 26}`} style={{ width: "100%", height: BH + 26 }}>
            {/* 零線 */}
            <line x1={BP} y1={BH / 2} x2={BW - BP} y2={BH / 2}
              stroke="var(--border)" strokeWidth={0.8} />
            {monthStats.map((m, i) => {
              if (m.avgRet === null) return null;
              const x = BP + i * colW + colW * 0.1;
              const w = colW * 0.8;
              const barH = Math.abs(m.avgRet) / maxAbs * (BH / 2 - BP - 2);
              const y = m.avgRet >= 0 ? BH / 2 - barH : BH / 2;
              return (
                <g key={i}>
                  <rect x={x} y={y} width={w} height={Math.max(1, barH)}
                    fill={barColor(m.avgRet)} rx={1} opacity={0.9} />
                  <text x={x + w / 2} y={BH + 10} fontSize={7} textAnchor="middle" fill="var(--text-tertiary)">
                    {i + 1}
                  </text>
                  {/* 數字標籤（僅顯示絕對值 > 1%） */}
                  {Math.abs(m.avgRet) > 0.01 && (
                    <text
                      x={x + w / 2}
                      y={m.avgRet >= 0 ? y - 2 : y + barH + 8}
                      fontSize={6} textAnchor="middle"
                      fill={m.avgRet >= 0 ? "#22c55e" : "#ef4444"}
                    >
                      {m.avgRet >= 0 ? "+" : ""}{(m.avgRet * 100).toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}
            <text x={BW / 2} y={BH + 22} fontSize={7} textAnchor="middle" fill="var(--text-tertiary)">
              月份（1–12 月）
            </text>
          </svg>
        </div>
      </div>

      {/* ── 詳細表格：12 個月 ──────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          各月統計
        </div>
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse w-full" style={{ minWidth: 520 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["月份","平均報酬","中位數報酬","勝率","樣本數"].map(h => (
                  <th key={h} className="px-2 py-1 text-center" style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthStats.map((m, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)22" }}>
                  <td className="px-2 py-1 text-center font-semibold" style={{ color: "var(--text-primary)" }}>
                    {MONTH_NAMES[i]}
                  </td>
                  <td className="px-2 py-1 text-center font-mono"
                    style={{ color: m.avgRet === null ? "var(--text-tertiary)" : m.avgRet >= 0 ? "#22c55e" : "#ef4444" }}>
                    {m.avgRet !== null ? `${m.avgRet >= 0 ? "+" : ""}${(m.avgRet * 100).toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-2 py-1 text-center font-mono"
                    style={{ color: m.medRet === null ? "var(--text-tertiary)" : m.medRet! >= 0 ? "#22c55e" : "#ef4444" }}>
                    {m.medRet !== null ? `${m.medRet! >= 0 ? "+" : ""}${(m.medRet! * 100).toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-2 py-1 text-center font-mono"
                    style={{ color: m.winRate === null ? "var(--text-tertiary)" : m.winRate! >= 0.6 ? "#22c55e" : m.winRate! >= 0.4 ? "#f59e0b" : "#ef4444" }}>
                    {m.winRate !== null ? `${(m.winRate! * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-2 py-1 text-center" style={{ color: "var(--text-secondary)" }}>
                    {m.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 年度 × 月份 熱力帶 ─────────────────────────── */}
      {years.length >= 2 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            逐年月度表現
          </div>
          <div className="overflow-x-auto rounded-lg p-2"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <table className="text-[9px] border-collapse">
              <thead>
                <tr>
                  <th className="px-1 py-0.5 text-right" style={{ color: "var(--text-tertiary)", minWidth: 36 }}>年</th>
                  {MONTH_NAMES.map(n => (
                    <th key={n} className="px-1 py-0.5 text-center" style={{ color: "var(--text-tertiary)", minWidth: 28 }}>
                      {n.replace("月", "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map(y => (
                  <tr key={y}>
                    <td className="px-1 py-0.5 text-right font-semibold" style={{ color: "var(--text-secondary)" }}>
                      {y}
                    </td>
                    {Array.from({ length: 12 }, (_, mi) => {
                      const r = heatData[y]?.[mi + 1];
                      return (
                        <td key={mi} className="px-0.5 py-0.5 text-center"
                          style={{
                            background: r !== undefined ? heatBg(r) : "transparent",
                            color:      r !== undefined ? (Math.abs(r) > 0.02 ? "#fff" : "#1f2937") : "var(--text-tertiary)",
                            borderRadius: 2,
                            fontFamily: "monospace",
                          }}>
                          {r !== undefined ? `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
            深綠 ≥+4%，淺綠 0%–4%，淺紅 0%–-4%，深紅 ≤-4%
          </div>
        </div>
      )}
    </div>
  );
}
