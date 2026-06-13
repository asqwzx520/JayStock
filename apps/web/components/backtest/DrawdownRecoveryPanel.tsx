"use client";

/**
 * P19-55: 逐次回撤明細分析
 * 從資金曲線提取每一段回撤，顯示深度、開始/谷底/恢復日期、水下天數。
 */

import type { BacktestEquityPoint } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  equityCurve: BacktestEquityPoint[];
}

interface DDPeriod {
  peakDate:     string;
  troughDate:   string;
  recoveryDate: string | null;
  peakValue:    number;
  troughValue:  number;
  depth:        number;  // 0..1, positive
  daysToTrough: number;
  daysToRecover: number | null;
  totalDays:    number | null;
  stillUnderwater: boolean;
}

function extractDrawdowns(curve: BacktestEquityPoint[]): DDPeriod[] {
  if (curve.length < 3) return [];

  const periods: DDPeriod[] = [];
  let peakIdx = 0;
  let peakVal = curve[0].value;
  let inDD     = false;
  let troughIdx = 0;
  let troughVal = curve[0].value;

  for (let i = 1; i < curve.length; i++) {
    const v = curve[i].value;

    if (!inDD) {
      if (v > peakVal) {
        peakIdx  = i;
        peakVal  = v;
      } else if (v < peakVal * 0.99) {
        // 進入回撤（> 1% 才計入，過濾雜訊）
        inDD      = true;
        troughIdx = i;
        troughVal = v;
      }
    } else {
      if (v < troughVal) {
        troughIdx = i;
        troughVal = v;
      }
      if (v >= peakVal) {
        // 回撤結束（恢復新高）
        const depth = (peakVal - troughVal) / peakVal;
        periods.push({
          peakDate:     curve[peakIdx].time,
          troughDate:   curve[troughIdx].time,
          recoveryDate: curve[i].time,
          peakValue:    peakVal,
          troughValue:  troughVal,
          depth,
          daysToTrough: troughIdx - peakIdx,
          daysToRecover: i - troughIdx,
          totalDays:    i - peakIdx,
          stillUnderwater: false,
        });
        inDD      = false;
        peakIdx   = i;
        peakVal   = v;
        troughIdx = i;
        troughVal = v;
      }
    }
  }

  // 若仍在回撤中
  if (inDD) {
    const depth = (peakVal - troughVal) / peakVal;
    periods.push({
      peakDate:     curve[peakIdx].time,
      troughDate:   curve[troughIdx].time,
      recoveryDate: null,
      peakValue:    peakVal,
      troughValue:  troughVal,
      depth,
      daysToTrough: troughIdx - peakIdx,
      daysToRecover: null,
      totalDays:    null,
      stillUnderwater: true,
    });
  }

  // 按深度排序，最深的在前
  return periods.sort((a, b) => b.depth - a.depth);
}

function depthColor(d: number) {
  if (d > 0.30) return "#ef4444";
  if (d > 0.15) return "#f97316";
  if (d > 0.08) return "#f59e0b";
  return "#22c55e";
}

export default function DrawdownRecoveryPanel({ equityCurve }: Props) {
  const periods = useMemo(() => extractDrawdowns(equityCurve), [equityCurve]);

  if (periods.length === 0) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        無明顯回撤期間（深度 ≥ 1%）
      </div>
    );
  }

  // 統計
  const maxDD   = periods[0];
  const avgDepth = periods.reduce((s, p) => s + p.depth, 0) / periods.length;
  const recovered = periods.filter(p => !p.stillUnderwater);
  const avgRecover = recovered.length
    ? recovered.reduce((s, p) => s + (p.daysToRecover ?? 0), 0) / recovered.length
    : null;
  const longest = periods.reduce((a, b) =>
    (b.totalDays ?? b.daysToTrough) > (a.totalDays ?? a.daysToTrough) ? b : a, periods[0]);

  // 深度分佈
  const bins = [0.01, 0.05, 0.10, 0.20, 0.30, 1.0];
  const binLabels = ["1-5%","5-10%","10-20%","20-30%",">30%"];
  const binCounts = binLabels.map((_, i) =>
    periods.filter(p => p.depth >= bins[i] && p.depth < bins[i + 1]).length
  );
  const maxBin = Math.max(1, ...binCounts);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 統計摘要 ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "回撤次數",
            value: `${periods.length} 次`,
            color: "var(--text-primary)",
            hint:  `其中 ${periods.filter(p => p.stillUnderwater).length} 次尚未恢復`,
          },
          {
            label: "最大回撤深度",
            value: `-${(maxDD.depth * 100).toFixed(1)}%`,
            color: depthColor(maxDD.depth),
            hint:  `${maxDD.peakDate} → ${maxDD.troughDate}`,
          },
          {
            label: "平均回撤深度",
            value: `-${(avgDepth * 100).toFixed(1)}%`,
            color: depthColor(avgDepth),
            hint:  "所有回撤的均值",
          },
          {
            label: "平均恢復時間",
            value: avgRecover !== null ? `${avgRecover.toFixed(0)} 日` : "尚未恢復",
            color: avgRecover !== null && avgRecover < 30 ? "#22c55e" : "#f59e0b",
            hint:  `最長水下 ${(longest.totalDays ?? longest.daysToTrough)} 日`,
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

      {/* ── 深度分佈長條圖 ────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          回撤深度分佈
        </div>
        <div className="rounded-lg p-3 flex items-end gap-3"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", height: 80 }}>
          {binLabels.map((label, i) => {
            const pct = binCounts[i] / maxBin;
            const colors = ["#22c55e","#86efac","#f59e0b","#f97316","#ef4444"];
            return (
              <div key={label} className="flex flex-col items-center gap-1 flex-1">
                <div className="text-[9px] font-semibold" style={{ color: colors[i] }}>
                  {binCounts[i] > 0 ? binCounts[i] : ""}
                </div>
                <div className="w-full rounded-t transition-all"
                  style={{ height: Math.max(2, pct * 44), background: colors[i], opacity: 0.85 }} />
                <div className="text-[8px]" style={{ color: "var(--text-tertiary)" }}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 回撤明細表格 ─────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          各次回撤明細（按深度排序，前 20 名）
        </div>
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse w-full" style={{ minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["#","高峰日","谷底日","恢復日","深度","至谷底","至恢復","水下總日","狀態"].map(h => (
                  <th key={h} className="px-1.5 py-1 text-center"
                    style={{ color: "var(--text-tertiary)", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.slice(0, 20).map((p, i) => (
                <tr key={i}
                  style={{
                    borderBottom: "1px solid var(--border)22",
                    background: i % 2 === 0 ? "transparent" : "var(--bg-elevated)44",
                  }}>
                  <td className="px-1.5 py-1 text-center" style={{ color: "var(--text-tertiary)" }}>{i + 1}</td>
                  <td className="px-1.5 py-1 text-center font-mono text-[9px]" style={{ color: "var(--text-secondary)" }}>
                    {p.peakDate}
                  </td>
                  <td className="px-1.5 py-1 text-center font-mono text-[9px]" style={{ color: "#ef4444" }}>
                    {p.troughDate}
                  </td>
                  <td className="px-1.5 py-1 text-center font-mono text-[9px]"
                    style={{ color: p.recoveryDate ? "#22c55e" : "var(--text-tertiary)" }}>
                    {p.recoveryDate ?? "—"}
                  </td>
                  <td className="px-1.5 py-1 text-center font-bold" style={{ color: depthColor(p.depth) }}>
                    -{(p.depth * 100).toFixed(1)}%
                  </td>
                  <td className="px-1.5 py-1 text-center" style={{ color: "var(--text-secondary)" }}>
                    {p.daysToTrough}d
                  </td>
                  <td className="px-1.5 py-1 text-center" style={{ color: "var(--text-secondary)" }}>
                    {p.daysToRecover !== null ? `${p.daysToRecover}d` : "—"}
                  </td>
                  <td className="px-1.5 py-1 text-center" style={{ color: "var(--text-secondary)" }}>
                    {p.totalDays !== null ? `${p.totalDays}d` : `${p.daysToTrough}d+`}
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    {p.stillUnderwater ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: "#fee2e2", color: "#ef4444" }}>水下</span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: "#d1fae5", color: "#15803d" }}>恢復</span>
                    )}
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
