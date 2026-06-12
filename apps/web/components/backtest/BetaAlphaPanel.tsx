"use client";

/**
 * P17-49: 市場相關性分析（Beta / Alpha 面板）
 * 計算策略與基準的關係：Beta、Jensen's Alpha、R²、Tracking Error、Information Ratio。
 * 純前端，從 equity_curve + benchmark_curve 計算日報酬序列後做 OLS 回歸。
 */

import type { BacktestEquityPoint, BacktestBenchmarkPoint } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  equityCurve:    BacktestEquityPoint[];
  benchmarkCurve: BacktestBenchmarkPoint[];
}

/** OLS 線性回歸：y = alpha + beta * x，回傳 { alpha, beta, r2 } */
function ols(x: number[], y: number[]): { alpha: number; beta: number; r2: number } {
  const n = x.length;
  if (n < 4) return { alpha: 0, beta: 1, r2: 0 };
  const xMean = x.reduce((s, v) => s + v, 0) / n;
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let ssXY = 0, ssXX = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (x[i] - xMean) * (y[i] - yMean);
    ssXX += (x[i] - xMean) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  const beta  = ssXX !== 0 ? ssXY / ssXX : 0;
  const alpha = yMean - beta * xMean;
  const ssRes = y.reduce((s, yi, i) => s + (yi - (alpha + beta * x[i])) ** 2, 0);
  const r2    = ssTot !== 0 ? 1 - ssRes / ssTot : 0;
  return { alpha, beta, r2 };
}

/** 對齊兩個時間序列，只保留共有的日期 */
function alignSeries(a: { time: string; value: number }[], b: { time: string; value: number }[]) {
  const bMap = new Map(b.map(p => [p.time, p.value]));
  const pairs: { time: string; a: number; b: number }[] = [];
  for (const p of a) {
    const bv = bMap.get(p.time);
    if (bv !== undefined) pairs.push({ time: p.time, a: p.value, b: bv });
  }
  return pairs;
}

/** 計算日報酬序列 */
function dailyReturns(pairs: { a: number; b: number }[]) {
  const ra: number[] = [], rb: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i - 1].a > 0) ra.push((pairs[i].a - pairs[i - 1].a) / pairs[i - 1].a);
    if (pairs[i - 1].b > 0) rb.push((pairs[i].b - pairs[i - 1].b) / pairs[i - 1].b);
  }
  return { ra, rb };
}

/** 滾動相關係數（window 天） */
function rollingCorr(ra: number[], rb: number[], win = 30): { idx: number; corr: number }[] {
  const result: { idx: number; corr: number }[] = [];
  for (let i = win; i <= ra.length; i++) {
    const xa = ra.slice(i - win, i);
    const xb = rb.slice(i - win, i);
    const { r2 } = ols(xb, xa);
    const corr = Math.sign(ols(xb, xa).beta) * Math.sqrt(Math.max(0, r2));
    result.push({ idx: i, corr });
  }
  return result;
}

export default function BetaAlphaPanel({ equityCurve, benchmarkCurve }: Props) {
  const { reg, ir, te, rollCorr, scatter } = useMemo(() => {
    if (!equityCurve?.length || !benchmarkCurve?.length) return { reg: null, ir: 0, te: 0, rollCorr: [], scatter: [] };

    const pairs = alignSeries(
      equityCurve.map(p => ({ time: p.time, value: p.value })),
      benchmarkCurve
    );
    if (pairs.length < 20) return { reg: null, ir: 0, te: 0, rollCorr: [], scatter: [] };

    const { ra, rb } = dailyReturns(pairs);
    const n = Math.min(ra.length, rb.length);
    const raT = ra.slice(0, n), rbT = rb.slice(0, n);

    const reg = ols(rbT, raT);  // strategy = alpha + beta * benchmark

    // Tracking Error = std of active returns (daily)
    const active = raT.map((r, i) => r - rbT[i]);
    const actMean = active.reduce((s, v) => s + v, 0) / active.length;
    const te = Math.sqrt(active.reduce((s, v) => s + (v - actMean) ** 2, 0) / active.length) * Math.sqrt(252);

    // Information Ratio = annualised active return / TE
    const ir = te > 0 ? (actMean * 252) / te : 0;

    // Rolling 30-day correlation
    const rollCorr = rollingCorr(raT, rbT, 30);

    // Scatter (subsample up to 200 points)
    const step = Math.max(1, Math.floor(n / 200));
    const scatter = raT
      .filter((_, i) => i % step === 0)
      .map((r, i) => ({ x: rbT[i * step] ?? 0, y: r }))
      .filter(p => Math.abs(p.x) < 0.12 && Math.abs(p.y) < 0.12);

    return { reg, ir, te, rollCorr, scatter };
  }, [equityCurve, benchmarkCurve]);

  if (!reg) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        資料不足（需至少 20 個共有交易日）
      </div>
    );
  }

  const betaColor = reg.beta < 0.5 ? "#22c55e" : reg.beta < 1.2 ? "#f59e0b" : "#ef4444";
  const alphaAnn  = reg.alpha * 252;
  const alphaColor = alphaAnn >= 0 ? "#22c55e" : "#ef4444";
  const irColor    = ir >= 0.5 ? "#22c55e" : ir >= 0 ? "#f59e0b" : "#ef4444";

  // Scatter 座標映射
  const SW = 280, SH = 200, SP = 30;
  const xMin = -0.05, xMax = 0.05, yMin = -0.06, yMax = 0.06;
  const sx = (v: number) => SP + ((v - xMin) / (xMax - xMin)) * (SW - SP * 2);
  const sy = (v: number) => SH - SP - ((v - yMin) / (yMax - yMin)) * (SH - SP * 2);
  // 回歸線端點
  const regY1 = reg.alpha + reg.beta * xMin;
  const regY2 = reg.alpha + reg.beta * xMax;

  // Rolling corr chart
  const RW = 400, RH = 80;
  const maxIdx = rollCorr.length;
  const rcX = (i: number) => (i / maxIdx) * RW;
  const rcY = (c: number) => RH / 2 - c * (RH / 2 - 4);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 關鍵指標 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "Beta（市場敏感度）",
            value: reg.beta.toFixed(3),
            color: betaColor,
            hint:  reg.beta < 0.5 ? "低相關，策略獨立性強" : reg.beta < 1.2 ? "中度市場相關" : "高 Beta，隨市場大幅波動",
          },
          {
            label: "Jensen's Alpha（年化）",
            value: `${alphaAnn >= 0 ? "+" : ""}${(alphaAnn * 100).toFixed(2)}%`,
            color: alphaColor,
            hint:  alphaAnn >= 0 ? "策略產生正超額報酬" : "策略未能超越基準調整後報酬",
          },
          {
            label: "R²（解釋力）",
            value: `${(reg.r2 * 100).toFixed(1)}%`,
            color: reg.r2 < 0.3 ? "#22c55e" : reg.r2 < 0.7 ? "#f59e0b" : "#ef4444",
            hint:  `基準走勢可解釋策略 ${(reg.r2 * 100).toFixed(0)}% 的波動`,
          },
          {
            label: "Information Ratio",
            value: ir.toFixed(3),
            color: irColor,
            hint:  ir >= 0.5 ? "主動管理效率佳（>0.5）" : ir >= 0 ? "輕微正超額" : "主動管理未增值",
          },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          >
            <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{s.hint}</div>
          </div>
        ))}
      </div>

      {/* Tracking Error + IR 補充 */}
      <div className="flex gap-3">
        <div className="rounded-lg p-3 flex-1" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>Tracking Error（年化）</div>
          <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{(te * 100).toFixed(2)}%</div>
          <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>主動報酬的年化標準差，越低代表策略越貼近基準</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* ── 日報酬散佈圖 ──────────────────────────────────── */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            日報酬散佈圖（策略 vs 基準）
          </div>
          <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <svg viewBox={`0 0 ${SW} ${SH}`} style={{ width: "100%", height: SH }}>
              {/* 零線 */}
              <line x1={sx(0)} y1={SP} x2={sx(0)} y2={SH - SP} stroke="var(--border)" strokeWidth={0.8} />
              <line x1={SP} y1={sy(0)} x2={SW - SP} y2={sy(0)} stroke="var(--border)" strokeWidth={0.8} />
              {/* 回歸線 */}
              <line
                x1={sx(xMin)} y1={Math.max(SP, Math.min(SH - SP, sy(regY1)))}
                x2={sx(xMax)} y2={Math.max(SP, Math.min(SH - SP, sy(regY2)))}
                stroke="#6366f1" strokeWidth={1.5} opacity={0.8}
              />
              {/* 散佈點 */}
              {scatter.map((p, i) => (
                <circle
                  key={i}
                  cx={sx(p.x)} cy={sy(p.y)}
                  r={2.5}
                  fill={p.y >= 0 ? "#22c55e" : "#ef4444"}
                  opacity={0.5}
                />
              ))}
              {/* 軸標籤 */}
              <text x={SW / 2} y={SH - 2} fontSize={8} textAnchor="middle" fill="var(--text-tertiary)">基準日報酬 →</text>
              <text x={8} y={SH / 2} fontSize={8} textAnchor="middle" fill="var(--text-tertiary)"
                transform={`rotate(-90, 8, ${SH / 2})`}>策略日報酬 ↑</text>
            </svg>
            <div className="text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
              紫線 = 回歸線（斜率 = Beta）；R² = {(reg.r2 * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* ── 滾動相關係數 ──────────────────────────────────── */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            滾動 30 日相關係數
          </div>
          <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            {rollCorr.length < 5 ? (
              <div className="text-[10px] p-4" style={{ color: "var(--text-tertiary)" }}>資料不足</div>
            ) : (
              <svg viewBox={`0 0 ${RW} ${RH + 20}`} style={{ width: "100%", height: RH + 20 }}>
                {/* 零線 */}
                <line x1={0} y1={RH / 2} x2={RW} y2={RH / 2} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3,2" />
                {/* ±0.5 參考線 */}
                <line x1={0} y1={rcY(0.5)} x2={RW} y2={rcY(0.5)} stroke="#22c55e" strokeWidth={0.5} opacity={0.4} />
                <line x1={0} y1={rcY(-0.5)} x2={RW} y2={rcY(-0.5)} stroke="#ef4444" strokeWidth={0.5} opacity={0.4} />
                {/* 折線 */}
                <polyline
                  points={rollCorr.map(r => `${rcX(r.idx)},${rcY(r.corr)}`).join(" ")}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
                {/* 標籤 */}
                <text x={2} y={rcY(0.5) - 2} fontSize={7} fill="#22c55e" opacity={0.7}>+0.5</text>
                <text x={2} y={rcY(-0.5) + 8} fontSize={7} fill="#ef4444" opacity={0.7}>-0.5</text>
                <text x={RW / 2} y={RH + 16} fontSize={8} textAnchor="middle" fill="var(--text-tertiary)">回測期間 →</text>
              </svg>
            )}
            <div className="text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
              相關係數接近 0 的時期 = 策略最獨立；接近 ±1 = 高度跟隨基準
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
