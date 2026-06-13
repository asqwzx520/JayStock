"use client";

/**
 * P19-56: 報酬分佈品質分析
 * 日報酬直方圖 + 常態曲線疊加；偏度、峰度、VaR、CVaR。
 */

import type { BacktestEquityPoint, BacktestBenchmarkPoint } from "@/lib/api";
import { useMemo } from "react";

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

function stats(arr: number[]) {
  const n   = arr.length;
  if (n < 4) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mean   = arr.reduce((s, v) => s + v, 0) / n;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const std    = Math.sqrt(variance);
  // skewness
  const m3 = arr.reduce((s, v) => s + ((v - mean) / std) ** 3, 0) / n;
  // excess kurtosis
  const m4 = arr.reduce((s, v) => s + ((v - mean) / std) ** 4, 0) / n - 3;
  // VaR 95/99
  const var95  = sorted[Math.floor(n * 0.05)];
  const var99  = sorted[Math.floor(n * 0.01)];
  // CVaR 95
  const tail95 = sorted.slice(0, Math.floor(n * 0.05));
  const cvar95 = tail95.length ? tail95.reduce((s, v) => s + v, 0) / tail95.length : var95;
  // positive days
  const posDays = arr.filter(v => v > 0).length;
  return { n, mean, std, m3, m4, var95, var99, cvar95, posDays };
}

function normalPdf(x: number, mean: number, std: number): number {
  return Math.exp(-((x - mean) ** 2) / (2 * std ** 2)) / (std * Math.sqrt(2 * Math.PI));
}

export default function ReturnQualityPanel({ equityCurve, benchmarkCurve }: Props) {
  const analysis = useMemo(() => {
    if (!equityCurve || equityCurve.length < 30) return null;
    const rets  = dailyRets(equityCurve.map(p => ({ time: p.time, value: p.value })));
    const bRets = benchmarkCurve?.length > 10
      ? dailyRets(benchmarkCurve.map(p => ({ time: p.time, value: p.value })))
      : null;
    const s = stats(rets);
    const b = bRets ? stats(bRets) : null;
    if (!s) return null;

    // 直方圖（25 bins，±5%）
    const BINS = 25;
    const RANGE = 0.05;
    const binW = (RANGE * 2) / BINS;
    const counts = new Array<number>(BINS).fill(0);
    let outliers = 0;
    rets.forEach(v => {
      const idx = Math.floor((v + RANGE) / binW);
      if (idx < 0 || idx >= BINS) { outliers++; return; }
      counts[idx]++;
    });
    const maxCount = Math.max(1, ...counts);

    // 常態曲線採樣（100 points 在 ±4σ）
    const normPts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 100; i++) {
      const x = s.mean - 4 * s.std + (8 * s.std * i) / 100;
      normPts.push({ x, y: normalPdf(x, s.mean, s.std) * binW * s.n });
    }

    return { rets, s, b, counts, maxCount, binW, BINS, RANGE, normPts, outliers };
  }, [equityCurve, benchmarkCurve]);

  if (!analysis) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        資料不足（需至少 30 個交易日）
      </div>
    );
  }

  const { s, b, counts, maxCount, binW, BINS, RANGE, normPts, outliers } = analysis;

  // SVG 直方圖
  const CW = 440, CH = 120, CP = 12;
  const barW   = (CW - CP * 2) / BINS;
  const barX   = (i: number) => CP + i * barW;
  const barY   = (c: number) => CP + (1 - c / maxCount) * (CH - CP * 2);
  const barH   = (c: number) => (c / maxCount) * (CH - CP * 2);

  // 常態曲線座標映射
  const normMax = Math.max(...normPts.map(p => p.y));
  const nX = (x: number) => CP + ((x + RANGE) / (RANGE * 2)) * (CW - CP * 2);
  const nY = (y: number) => CP + (1 - y / normMax) * (CH - CP * 2);

  // 指標解讀
  function skewLabel(s3: number) {
    if (s3 > 0.5)  return { text: "正偏（右尾長，有大獲利機會）", color: "#22c55e" };
    if (s3 < -0.5) return { text: "負偏（左尾長，存在大虧損風險）", color: "#ef4444" };
    return { text: "接近對稱", color: "#f59e0b" };
  }
  function kurtLabel(k: number) {
    if (k > 1)  return { text: "厚尾（肥尾，極端事件多於常態）", color: "#f97316" };
    if (k < -1) return { text: "薄尾（極端事件少於常態）", color: "#22c55e" };
    return { text: "接近常態", color: "#f59e0b" };
  }

  const sk = skewLabel(s.m3);
  const ku = kurtLabel(s.m4);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 核心統計卡片 ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "日報酬均值（年化）",
            value: `${s.mean >= 0 ? "+" : ""}${(s.mean * 252 * 100).toFixed(1)}%`,
            hint:  `日均 ${(s.mean * 100).toFixed(4)}%`,
            color: s.mean >= 0 ? "#22c55e" : "#ef4444",
          },
          {
            label: "日報酬標準差",
            value: `${(s.std * 100).toFixed(3)}%`,
            hint:  `年化 ${(s.std * Math.sqrt(252) * 100).toFixed(1)}%`,
            color: "var(--text-primary)",
          },
          {
            label: "VaR 95%（單日）",
            value: `${(s.var95 * 100).toFixed(2)}%`,
            hint:  `VaR 99% = ${(s.var99 * 100).toFixed(2)}%`,
            color: "#ef4444",
          },
          {
            label: "CVaR 95%（預期虧損）",
            value: `${(s.cvar95 * 100).toFixed(2)}%`,
            hint:  "最壞 5% 情境的平均日損失",
            color: "#dc2626",
          },
        ].map(c => (
          <div key={c.label} className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>{c.label}</div>
            <div className="text-sm font-bold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{c.hint}</div>
          </div>
        ))}
      </div>

      {/* ── 偏度 / 峰度 ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "偏度（Skewness）", val: s.m3.toFixed(3), ...sk },
          { label: "超額峰度（Excess Kurtosis）", val: s.m4.toFixed(3), ...ku },
        ].map(c => (
          <div key={c.label} className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between">
              <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{c.label}</div>
              <div className="text-sm font-bold font-mono" style={{ color: c.color }}>{c.val}</div>
            </div>
            <div className="text-[9px] mt-1" style={{ color: c.color }}>{c.text}</div>
          </div>
        ))}
      </div>

      {/* ── 日報酬直方圖 + 常態曲線 ─────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          日報酬分佈（±5% 範圍，{outliers > 0 ? `${outliers} 筆極端值未顯示` : "無極端值"}）
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <svg viewBox={`0 0 ${CW} ${CH + 20}`} style={{ width: "100%", height: CH + 20 }}>
            {/* 零線 */}
            <line x1={nX(0)} y1={CP} x2={nX(0)} y2={CH - CP}
              stroke="var(--border)" strokeWidth={0.8} strokeDasharray="3,2" />

            {/* 直方圖（依正負塗色） */}
            {counts.map((c, i) => {
              const x  = barX(i);
              const bv = -RANGE + i * binW + binW / 2;
              const isPos = bv >= 0;
              return (
                <rect key={i} x={x} y={barY(c)} width={Math.max(0, barW - 0.5)} height={barH(c)}
                  fill={isPos ? "#22c55e" : "#ef4444"} opacity={0.55} rx={0.5} />
              );
            })}

            {/* 常態曲線 */}
            <polyline
              points={normPts
                .filter(p => p.x >= -RANGE && p.x <= RANGE)
                .map(p => `${nX(p.x)},${nY(p.y * (maxCount / normPts.reduce((m, q) => Math.max(m, q.y), 0)))}`)
                .join(" ")}
              fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeLinejoin="round" opacity={0.85}
            />

            {/* VaR 線 */}
            {s.var95 >= -RANGE && s.var95 <= RANGE && (
              <>
                <line x1={nX(s.var95)} y1={CP} x2={nX(s.var95)} y2={CH - CP}
                  stroke="#ef4444" strokeWidth={1} strokeDasharray="3,2" opacity={0.8} />
                <text x={nX(s.var95) - 2} y={CP + 8} fontSize={7} textAnchor="end" fill="#ef4444" opacity={0.9}>
                  VaR95
                </text>
              </>
            )}

            {/* 平均線 */}
            {s.mean >= -RANGE && s.mean <= RANGE && (
              <line x1={nX(s.mean)} y1={CP} x2={nX(s.mean)} y2={CH - CP}
                stroke="#6366f1" strokeWidth={1} strokeDasharray="2,2" opacity={0.8} />
            )}

            {/* X 軸標籤 */}
            {[-0.04, -0.02, 0, 0.02, 0.04].map(v => (
              <text key={v} x={nX(v)} y={CH + 10} fontSize={7} textAnchor="middle" fill="var(--text-tertiary)">
                {v >= 0 ? "+" : ""}{(v * 100).toFixed(0)}%
              </text>
            ))}

            {/* 圖例 */}
            <rect x={CW - 80} y={CP} width={8} height={6} fill="#22c55e" opacity={0.6} />
            <text x={CW - 70} y={CP + 6} fontSize={7} fill="var(--text-tertiary)">正報酬</text>
            <rect x={CW - 80} y={CP + 10} width={8} height={6} fill="#ef4444" opacity={0.6} />
            <text x={CW - 70} y={CP + 16} fontSize={7} fill="var(--text-tertiary)">負報酬</text>
            <line x1={CW - 80} y1={CP + 23} x2={CW - 72} y2={CP + 23} stroke="#f59e0b" strokeWidth={1.5} />
            <text x={CW - 70} y={CP + 26} fontSize={7} fill="var(--text-tertiary)">常態分佈</text>
          </svg>
        </div>
      </div>

      {/* ── 策略 vs 基準對比 ──────────────────────────────── */}
      {b && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            策略 vs 基準分佈比較
          </div>
          <div className="overflow-x-auto">
            <table className="text-[10px] border-collapse w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["指標","策略","基準","策略較佳?"].map(h => (
                    <th key={h} className="px-3 py-1 text-center"
                      style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "偏度",     sv: s.m3,   bv: b.m3,   better: (sv: number, bv: number) => sv > bv },
                  { label: "超額峰度", sv: s.m4,   bv: b.m4,   better: (sv: number, bv: number) => sv < bv },
                  { label: "VaR 95%",  sv: s.var95, bv: b.var95, better: (sv: number, bv: number) => sv > bv },
                  { label: "CVaR 95%", sv: s.cvar95, bv: b.cvar95, better: (sv: number, bv: number) => sv > bv },
                ].map(r => {
                  const isBetter = r.better(r.sv, r.bv);
                  return (
                    <tr key={r.label} style={{ borderBottom: "1px solid var(--border)22" }}>
                      <td className="px-3 py-1 text-center" style={{ color: "var(--text-secondary)" }}>{r.label}</td>
                      <td className="px-3 py-1 text-center font-mono" style={{ color: isBetter ? "#22c55e" : "var(--text-primary)" }}>
                        {r.sv.toFixed(3)}
                      </td>
                      <td className="px-3 py-1 text-center font-mono" style={{ color: "var(--text-secondary)" }}>
                        {r.bv.toFixed(3)}
                      </td>
                      <td className="px-3 py-1 text-center">
                        <span style={{ color: isBetter ? "#22c55e" : "#ef4444" }}>
                          {isBetter ? "✓ 是" : "✗ 否"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
