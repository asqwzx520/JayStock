"use client";

/**
 * P18-52: 波動率分析
 * - 滾動 20/60 日歷史波動率（HV）
 * - 高波動 vs 低波動期間績效比較
 * - 策略年化波動率 vs 基準波動率
 */

import type { BacktestEquityPoint, BacktestBenchmarkPoint } from "@/lib/api";
import { useMemo, useState } from "react";

interface Props {
  equityCurve:    BacktestEquityPoint[];
  benchmarkCurve: BacktestBenchmarkPoint[];
}

function dailyRets(curve: { time: string; value: number }[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].value;
    if (prev > 0) r.push((curve[i].value - prev) / prev);
  }
  return r;
}

function rollingVol(rets: number[], win: number): number[] {
  const result: number[] = [];
  for (let i = win; i <= rets.length; i++) {
    const slice = rets.slice(i - win, i);
    const mean  = slice.reduce((s, v) => s + v, 0) / win;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (win - 1);
    result.push(Math.sqrt(variance * 252));  // 年化
  }
  return result;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

export default function VolatilityPanel({ equityCurve, benchmarkCurve }: Props) {
  const [win, setWin] = useState<20 | 60>(20);

  const { rv20, rv60, highVolPerf, lowVolPerf, stratVol, benchVol, volRatio, times } = useMemo(() => {
    if (!equityCurve || equityCurve.length < 30) {
      return { rv20: [], rv60: [], highVolPerf: null, lowVolPerf: null, stratVol: 0, benchVol: 0, volRatio: 1, times: [] };
    }

    const rets  = dailyRets(equityCurve.map(p => ({ time: p.time, value: p.value })));
    const times = equityCurve.slice(1).map(p => p.time);
    const rv20  = rollingVol(rets, 20);
    const rv60  = rollingVol(rets, Math.min(60, Math.floor(rets.length / 2)));

    const stratVol = stdDev(rets) * Math.sqrt(252);

    let benchVol = 0;
    if (benchmarkCurve && benchmarkCurve.length > 10) {
      const bRets = dailyRets(benchmarkCurve);
      benchVol = stdDev(bRets) * Math.sqrt(252);
    }

    // 高/低波動區間分割（使用 rv20 中位數）
    const rv20Aligned = rv20.slice(0, rets.length - 20);  // 對齊到後段 rets
    if (rv20Aligned.length > 10) {
      const sorted   = [...rv20Aligned].sort((a, b) => a - b);
      const median   = sorted[Math.floor(sorted.length / 2)];
      const hiRets: number[] = [], loRets: number[] = [];
      rv20Aligned.forEach((v, i) => {
        const r = rets[i + 20];
        if (r !== undefined) {
          if (v >= median) hiRets.push(r);
          else loRets.push(r);
        }
      });
      const perfStats = (arr: number[]) => {
        if (arr.length === 0) return null;
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
        const wins = arr.filter(v => v > 0).length;
        return { annRet: mean * 252, winRate: wins / arr.length, count: arr.length };
      };
      return { rv20, rv60, highVolPerf: perfStats(hiRets), lowVolPerf: perfStats(loRets), stratVol, benchVol, volRatio: benchVol > 0 ? stratVol / benchVol : 1, times };
    }

    return { rv20, rv60, highVolPerf: null, lowVolPerf: null, stratVol, benchVol, volRatio: benchVol > 0 ? stratVol / benchVol : 1, times };
  }, [equityCurve, benchmarkCurve]);

  if (rv20.length === 0) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        資料不足（需至少 30 個交易日）
      </div>
    );
  }

  // Chart
  const RW = 460, RH = 100, RP = 8;
  const curVol = win === 20 ? rv20 : rv60;
  const maxVol = Math.max(0.01, ...curVol);
  const minVol = Math.min(...curVol);
  const volX = (i: number) => RP + (i / (curVol.length - 1)) * (RW - RP * 2);
  const volY = (v: number) => RP + (1 - (v - minVol) / (maxVol - minVol)) * (RH - RP * 2);

  const volColor = (v: number) => {
    const ratio = (v - minVol) / (maxVol - minVol);
    if (ratio > 0.7) return "#ef4444";
    if (ratio > 0.4) return "#f59e0b";
    return "#22c55e";
  };

  const latestVol = curVol[curVol.length - 1] ?? 0;
  const volRatioColor = volRatio < 0.8 ? "#22c55e" : volRatio < 1.2 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 關鍵指標 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "策略年化波動率",
            value: `${(stratVol * 100).toFixed(1)}%`,
            color: stratVol > 0.30 ? "#ef4444" : stratVol > 0.20 ? "#f59e0b" : "#22c55e",
            hint:  "全期日報酬的年化標準差",
          },
          {
            label: "基準年化波動率",
            value: benchVol > 0 ? `${(benchVol * 100).toFixed(1)}%` : "N/A",
            color: "var(--text-primary)",
            hint:  "基準指數波動率",
          },
          {
            label: "波動率比（策略/基準）",
            value: benchVol > 0 ? volRatio.toFixed(2) : "N/A",
            color: volRatioColor,
            hint:  volRatio < 1 ? "策略波動率低於基準 ✓" : "策略波動率高於基準",
          },
          {
            label: `目前 ${win}日 HV`,
            value: `${(latestVol * 100).toFixed(1)}%`,
            color: volColor(latestVol),
            hint:  "最近滾動窗口的歷史波動率",
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

      {/* ── 滾動 HV 折線圖 ────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            滾動歷史波動率（HV）
          </div>
          <div className="flex gap-1">
            {([20, 60] as const).map(w => (
              <button
                key={w}
                onClick={() => setWin(w)}
                className="px-2 py-0.5 text-[10px] rounded transition-colors"
                style={{
                  background: win === w ? "var(--color-brand)" : "var(--bg-elevated)",
                  color:      win === w ? "#fff" : "var(--text-secondary)",
                  border:     "1px solid var(--border)",
                }}
              >
                {w}日
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <svg viewBox={`0 0 ${RW} ${RH + 16}`} style={{ width: "100%", height: RH + 16 }}>
            {/* 高波動警戒線（中位數 * 1.5） */}
            {(() => {
              const sorted = [...curVol].sort((a, b) => a - b);
              const med    = sorted[Math.floor(sorted.length / 2)] ?? 0;
              const warnY  = volY(med * 1.5);
              return warnY > RP && warnY < RH - RP ? (
                <>
                  <line x1={RP} y1={warnY} x2={RW - RP} y2={warnY}
                    stroke="#ef4444" strokeWidth={0.6} strokeDasharray="3,2" opacity={0.5} />
                  <text x={RW - RP - 2} y={warnY - 2} fontSize={7} textAnchor="end" fill="#ef4444" opacity={0.7}>
                    高波動警戒
                  </text>
                </>
              ) : null;
            })()}

            {/* 填充面積 */}
            <defs>
              <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <polygon
              points={[
                `${RP},${RH - RP}`,
                ...curVol.map((v, i) => `${volX(i)},${volY(v)}`),
                `${RW - RP},${RH - RP}`,
              ].join(" ")}
              fill="url(#volGrad)"
            />

            {/* 折線 */}
            <polyline
              points={curVol.map((v, i) => `${volX(i)},${volY(v)}`).join(" ")}
              fill="none" stroke="#6366f1" strokeWidth={1.5} strokeLinejoin="round"
            />

            {/* 軸標籤 */}
            <text x={RP} y={RH + 12} fontSize={7} fill="var(--text-tertiary)">{times[20]?.slice(0, 7)}</text>
            <text x={RW - RP} y={RH + 12} fontSize={7} textAnchor="end" fill="var(--text-tertiary)">
              {times[times.length - 1]?.slice(0, 7)}
            </text>
            <text x={RP} y={RP + 6} fontSize={7} fill="var(--text-tertiary)">
              {(maxVol * 100).toFixed(0)}%
            </text>
            <text x={RP} y={RH - RP - 2} fontSize={7} fill="var(--text-tertiary)">
              {(minVol * 100).toFixed(0)}%
            </text>
          </svg>
        </div>
      </div>

      {/* ── 高低波動期間績效比較 ───────────────────────────────── */}
      {highVolPerf && lowVolPerf && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            高波動 vs 低波動期間績效
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "低波動期間", data: lowVolPerf, color: "#22c55e" },
              { label: "高波動期間", data: highVolPerf, color: "#ef4444" },
            ].map(({ label, data, color }) => (
              <div key={label} className="rounded-lg p-3"
                style={{ background: "var(--bg-elevated)", border: `1px solid ${color}33` }}>
                <div className="text-[10px] font-semibold mb-2" style={{ color }}>
                  {label}（{data.count} 個交易日）
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px]">
                    <span style={{ color: "var(--text-secondary)" }}>年化報酬</span>
                    <span style={{ color: data.annRet >= 0 ? "#22c55e" : "#ef4444" }} className="font-mono">
                      {data.annRet >= 0 ? "+" : ""}{(data.annRet * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span style={{ color: "var(--text-secondary)" }}>日勝率</span>
                    <span style={{ color: data.winRate >= 0.5 ? "#22c55e" : "#ef4444" }} className="font-mono">
                      {(data.winRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[9px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>
            以滾動 20 日 HV 中位數為分界；低波動期間表現更佳代表策略屬「防禦型」，反之為「攻擊型」。
          </div>
        </div>
      )}
    </div>
  );
}
