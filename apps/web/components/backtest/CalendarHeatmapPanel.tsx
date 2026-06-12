"use client";

/**
 * P16-48: 月報酬日曆熱力圖
 * year × month 色塊矩陣，比數字表格更直覺地展示季節性與年度趨勢。
 */

import type { BacktestMonthlyReturn } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  monthlyReturns: BacktestMonthlyReturn[];
}

const MONTH_LABELS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

function heatColor(r: number): string {
  // 強綠 ≥10%  淡綠 ≥3%  白 ~0%  淡紅 ≥-3%  強紅 ≥-10%
  if (r >=  0.10) return "#15803d";
  if (r >=  0.05) return "#22c55e";
  if (r >=  0.02) return "#86efac";
  if (r >=  0.00) return "#d1fae5";
  if (r >= -0.02) return "#fee2e2";
  if (r >= -0.05) return "#fca5a5";
  if (r >= -0.10) return "#ef4444";
  return "#991b1b";
}

function textColor(r: number): string {
  return Math.abs(r) >= 0.05 ? "#fff" : "var(--text-primary)";
}

export default function CalendarHeatmapPanel({ monthlyReturns }: Props) {
  const { years, grid, yearStats, bestMonth, worstMonth } = useMemo(() => {
    if (!monthlyReturns || monthlyReturns.length === 0) {
      return { years: [], grid: new Map(), yearStats: new Map(), bestMonth: null, worstMonth: null };
    }

    const yrs = Array.from(new Set(monthlyReturns.map(r => r.year))).sort();
    const g   = new Map<string, number>();
    for (const r of monthlyReturns) g.set(`${r.year}-${r.month}`, r.return_pct / 100);

    // 每年統計（複利）
    const yStat = new Map<number, { annual: number; best: number; worst: number; positive: number }>();
    for (const y of yrs) {
      const months = monthlyReturns.filter(r => r.year === y);
      const annual = months.reduce((acc, r) => acc * (1 + r.return_pct / 100), 1) - 1;
      const rets   = months.map(r => r.return_pct / 100);
      yStat.set(y, {
        annual,
        best:     Math.max(...rets),
        worst:    Math.min(...rets),
        positive: rets.filter(r => r > 0).length,
      });
    }

    // 全期最佳/最差月份
    const best  = monthlyReturns.reduce((a, b) => b.return_pct > a.return_pct ? b : a);
    const worst = monthlyReturns.reduce((a, b) => b.return_pct < a.return_pct ? b : a);

    return { years: yrs, grid: g, yearStats: yStat, bestMonth: best, worstMonth: worst };
  }, [monthlyReturns]);

  if (years.length === 0) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        無月報酬資料
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 最佳/最差月 ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {bestMonth && (
          <div className="rounded-lg p-3" style={{ background: "#d1fae5", border: "1px solid #22c55e44" }}>
            <div className="text-[10px] mb-0.5" style={{ color: "#166534" }}>最佳月份</div>
            <div className="text-sm font-bold" style={{ color: "#15803d" }}>
              {bestMonth.year} 年 {bestMonth.month} 月
            </div>
            <div className="text-xs font-bold" style={{ color: "#15803d" }}>
              +{bestMonth.return_pct.toFixed(2)}%
            </div>
          </div>
        )}
        {worstMonth && (
          <div className="rounded-lg p-3" style={{ background: "#fee2e2", border: "1px solid #ef444444" }}>
            <div className="text-[10px] mb-0.5" style={{ color: "#991b1b" }}>最差月份</div>
            <div className="text-sm font-bold" style={{ color: "#991b1b" }}>
              {worstMonth.year} 年 {worstMonth.month} 月
            </div>
            <div className="text-xs font-bold" style={{ color: "#991b1b" }}>
              {worstMonth.return_pct.toFixed(2)}%
            </div>
          </div>
        )}
      </div>

      {/* ── 熱力圖 ────────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          月報酬熱力圖
        </div>
        <div className="overflow-x-auto">
          <table className="border-collapse" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th className="text-[10px] px-2 py-1 text-left w-14" style={{ color: "var(--text-tertiary)" }}>年份</th>
                {MONTH_LABELS.map(m => (
                  <th key={m} className="text-[10px] px-1 py-1 text-center w-10" style={{ color: "var(--text-tertiary)" }}>
                    {m}
                  </th>
                ))}
                <th className="text-[10px] px-2 py-1 text-right" style={{ color: "var(--text-tertiary)" }}>年報酬</th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => {
                const stat = yearStats.get(y);
                return (
                  <tr key={y}>
                    <td className="text-[10px] px-2 py-0.5 font-semibold" style={{ color: "var(--text-primary)" }}>
                      {y}
                    </td>
                    {Array.from({ length: 12 }, (_, i) => {
                      const r = grid.get(`${y}-${i + 1}`);
                      return (
                        <td key={i} className="px-0.5 py-0.5">
                          {r !== undefined ? (
                            <div
                              className="w-9 h-7 rounded text-center flex items-center justify-center text-[9px] font-mono cursor-default"
                              style={{ background: heatColor(r), color: textColor(r) }}
                              title={`${y}/${i + 1}: ${(r * 100).toFixed(2)}%`}
                            >
                              {r >= 0 ? "+" : ""}{(r * 100).toFixed(1)}
                            </div>
                          ) : (
                            <div className="w-9 h-7 rounded" style={{ background: "var(--border)", opacity: 0.3 }} />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-0.5 text-right">
                      {stat && (
                        <span
                          className="text-[11px] font-bold font-mono"
                          style={{ color: stat.annual >= 0 ? "#22c55e" : "#ef4444" }}
                        >
                          {stat.annual >= 0 ? "+" : ""}{(stat.annual * 100).toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 色階說明 ──────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[9px] mr-1" style={{ color: "var(--text-tertiary)" }}>色階：</span>
        {[
          { bg: "#991b1b", label: "<-10%" },
          { bg: "#ef4444", label: "-10~-5%" },
          { bg: "#fca5a5", label: "-5~-2%" },
          { bg: "#fee2e2", label: "-2~0%" },
          { bg: "#d1fae5", label: "0~+2%" },
          { bg: "#86efac", label: "+2~+5%" },
          { bg: "#22c55e", label: "+5~+10%" },
          { bg: "#15803d", label: ">+10%" },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-0.5">
            <div className="w-4 h-3 rounded-sm" style={{ background: s.bg }} />
            <span className="text-[8px]" style={{ color: "var(--text-tertiary)" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── 年度匯總 ──────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>年度績效匯總</div>
        <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr style={{ background: "var(--bg-elevated)" }}>
                {["年份", "年報酬", "最佳月", "最差月", "正報酬月數"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "var(--text-secondary)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((y, i) => {
                const s = yearStats.get(y);
                if (!s) return null;
                return (
                  <tr
                    key={y}
                    style={{ borderTop: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}
                  >
                    <td className="px-3 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>{y}</td>
                    <td className="px-3 py-2 font-mono" style={{ color: s.annual >= 0 ? "#22c55e" : "#ef4444" }}>
                      {s.annual >= 0 ? "+" : ""}{(s.annual * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: "#22c55e" }}>
                      +{(s.best * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: "#ef4444" }}>
                      {(s.worst * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                      {s.positive} / 12 個月
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
