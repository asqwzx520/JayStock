"use client";

/**
 * P13-38: 回撤分析面板
 * 從資金曲線計算並視覺化所有重大回撤期間（峰值→谷底→復原）。
 */

import type { BacktestEquityPoint } from "@/lib/api";

interface DrawdownPeriod {
  peakDate:     string;
  troughDate:   string;
  recoveryDate: string | null;  // null = 尚未復原
  depth:        number;         // 負數，如 -0.15 = -15%
  durationDays: number;         // 峰值到谷底天數
  recoveryDays: number | null;  // 谷底到復原天數
}

function parseDd(s: string): number {
  return new Date(s).getTime();
}

function daysDiff(a: string, b: string): number {
  return Math.round((parseDd(b) - parseDd(a)) / 86_400_000);
}

/** 從資金曲線找出所有回撤期間 */
function computeDrawdowns(curve: BacktestEquityPoint[]): DrawdownPeriod[] {
  if (curve.length < 4) return [];

  const periods: DrawdownPeriod[] = [];
  let peakIdx  = 0;
  let peakVal  = curve[0].value;

  for (let i = 1; i < curve.length; i++) {
    const v = curve[i].value;

    if (v >= peakVal) {
      // New peak → if we were in a drawdown, close it
      if (peakIdx !== i - 1) {
        // Find trough between peakIdx and i
        let troughIdx = peakIdx + 1;
        for (let j = peakIdx + 1; j < i; j++) {
          if (curve[j].value < curve[troughIdx].value) troughIdx = j;
        }
        const depth = (curve[troughIdx].value - peakVal) / peakVal;
        if (depth < -0.02) {  // only record >= 2% drawdowns
          periods.push({
            peakDate:     curve[peakIdx].time,
            troughDate:   curve[troughIdx].time,
            recoveryDate: curve[i].time,
            depth,
            durationDays: daysDiff(curve[peakIdx].time, curve[troughIdx].time),
            recoveryDays: daysDiff(curve[troughIdx].time, curve[i].time),
          });
        }
      }
      peakIdx = i;
      peakVal = v;
    }
  }

  // Handle open drawdown at end
  if (peakIdx < curve.length - 1) {
    let troughIdx = peakIdx + 1;
    for (let j = peakIdx + 1; j < curve.length; j++) {
      if (curve[j].value < curve[troughIdx].value) troughIdx = j;
    }
    const depth = (curve[troughIdx].value - peakVal) / peakVal;
    if (depth < -0.02) {
      periods.push({
        peakDate:     curve[peakIdx].time,
        troughDate:   curve[troughIdx].time,
        recoveryDate: null,
        depth,
        durationDays: daysDiff(curve[peakIdx].time, curve[troughIdx].time),
        recoveryDays: null,
      });
    }
  }

  // Sort by depth (worst first)
  return periods.sort((a, b) => a.depth - b.depth).slice(0, 10);
}

function pctFmt(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function depthColor(depth: number): string {
  const abs = Math.abs(depth);
  if (abs >= 0.3)  return "#ef4444";
  if (abs >= 0.15) return "#f97316";
  if (abs >= 0.07) return "#f59e0b";
  return "#10b981";
}

export default function DrawdownPanel({ equityCurve }: { equityCurve: BacktestEquityPoint[] }) {
  const periods = computeDrawdowns(equityCurve);

  // Summary stats
  const depths    = periods.map(p => p.depth);
  const durations = periods.map(p => p.durationDays);
  const recTimes  = periods.filter(p => p.recoveryDays != null).map(p => p.recoveryDays as number);
  const avgDepth  = depths.length  ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
  const avgDur    = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const avgRec    = recTimes.length  ? recTimes.reduce((a, b) => a + b, 0) / recTimes.length : null;

  // Underwater chart: daily drawdown from equity curve
  const maxAbs = Math.max(0.01, ...equityCurve.map(p => Math.abs(p.drawdown)));
  const chartH = 80;
  const chartW = 400;
  const step   = Math.max(1, Math.floor(equityCurve.length / chartW));
  const sampled = equityCurve.filter((_, i) => i % step === 0);

  if (periods.length === 0) {
    return (
      <div className="text-xs py-8 text-center" style={{ color: "var(--text-tertiary)" }}>
        沒有超過 2% 的回撤期間
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Underwater equity chart */}
      <div className="rounded-xl p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          水下曲線（Underwater Equity）
        </div>
        <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" preserveAspectRatio="none" style={{ height: chartH }}>
          {/* Zero line */}
          <line x1={0} y1={0} x2={chartW} y2={0} stroke="var(--border)" strokeWidth={1} />
          {/* Fill area */}
          <defs>
            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <polygon
            points={[
              "0,0",
              ...sampled.map((p, i) => {
                const x = (i / (sampled.length - 1)) * chartW;
                const y = (Math.abs(p.drawdown) / maxAbs) * chartH;
                return `${x},${y}`;
              }),
              `${chartW},0`,
            ].join(" ")}
            fill="url(#ddGrad)"
          />
          <polyline
            points={sampled.map((p, i) => {
              const x = (i / (sampled.length - 1)) * chartW;
              const y = (Math.abs(p.drawdown) / maxAbs) * chartH;
              return `${x},${y}`;
            }).join(" ")}
            fill="none"
            stroke="#ef4444"
            strokeWidth={1.5}
          />
        </svg>
        <div className="flex justify-between text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          <span>{equityCurve[0]?.time}</span>
          <span>↑ 越高越深</span>
          <span>{equityCurve[equityCurve.length - 1]?.time}</span>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "平均回撤深度", value: pctFmt(avgDepth), color: "#ef4444" },
          { label: "平均持續天數", value: `${avgDur.toFixed(0)} 天`, color: "var(--text-primary)" },
          { label: "平均復原天數", value: avgRec != null ? `${avgRec.toFixed(0)} 天` : "—", color: "var(--text-secondary)" },
        ].map(m => (
          <div key={m.label} className="rounded-xl p-3 text-center" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
            <div className="text-sm font-bold" style={{ color: m.color }}>{m.value}</div>
            <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Top drawdowns table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-4 py-2 text-xs font-semibold" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
          重大回撤期間（依深度排序）
        </div>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              {["峰值日", "谷底日", "深度", "持續", "復原", "狀態"].map(h => (
                <th key={h} className="px-3 py-1.5 text-left text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => {
              const color = depthColor(p.depth);
              return (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-3 py-2 text-[10px] font-mono" style={{ color: "var(--text-tertiary)" }}>{p.peakDate}</td>
                  <td className="px-3 py-2 text-[10px] font-mono" style={{ color: "var(--text-tertiary)" }}>{p.troughDate}</td>
                  <td className="px-3 py-2 text-xs font-bold" style={{ color }}>
                    {pctFmt(p.depth)}
                  </td>
                  <td className="px-3 py-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    {p.durationDays} 天
                  </td>
                  <td className="px-3 py-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    {p.recoveryDays != null ? `${p.recoveryDays} 天` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {p.recoveryDate ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>已復原</span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>未復原</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
