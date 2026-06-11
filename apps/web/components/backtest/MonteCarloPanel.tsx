"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  createChart, LineSeries, HistogramSeries, LineStyle,
  type IChartApi,
} from "lightweight-charts";
import type { BacktestTrade } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PercentileCurve {
  label: string;
  color: string;
  lineStyle?: LineStyle;
  lineWidth?: number;
  data: Array<{ time: string; value: number }>;
}

interface MCResult {
  percentiles: PercentileCurve[];
  maxDrawdowns: number[];     // distribution of max drawdowns across simulations
  finalReturns: number[];     // distribution of final returns across simulations
  p5Return:     number;
  p50Return:    number;
  p95Return:    number;
  p5MaxDD:      number;
  p50MaxDD:     number;
  p95MaxDD:     number;
  nSims:        number;
  nTrades:      number;
}

// ── Monte Carlo Engine (pure TS) ─────────────────────────────────────────────

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mulberry32 seeded PRNG for reproducibility
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function calcEquityCurve(returns: number[], initial: number): number[] {
  const eq: number[] = [initial];
  let cur = initial;
  for (const r of returns) {
    cur *= 1 + r;
    eq.push(cur);
  }
  return eq;
}

function calcMaxDrawdown(equity: number[]): number {
  let peak = equity[0];
  let maxDD = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function runMonteCarlo(
  trades: BacktestTrade[],
  initialCapital: number,
  nSims: number,
): MCResult {
  // Extract per-trade returns from trades list
  const returns: number[] = trades.map(t => {
    const entry = t.entry_price;
    const exit  = t.exit_price;
    const dir   = t.side === "short" ? -1 : 1;
    return dir * (exit - entry) / entry;
  }).filter(r => isFinite(r));

  const nTrades = returns.length;
  if (nTrades === 0) {
    return {
      percentiles: [],
      maxDrawdowns: [],
      finalReturns: [],
      p5Return: 0, p50Return: 0, p95Return: 0,
      p5MaxDD: 0, p50MaxDD: 0, p95MaxDD: 0,
      nSims, nTrades: 0,
    };
  }

  // Run simulations
  const allEquities: number[][] = [];
  const maxDDs: number[] = [];
  const finalReturns: number[] = [];
  const rng = mulberry32(42);

  for (let i = 0; i < nSims; i++) {
    const shuffled = shuffle(returns, rng);
    const eq = calcEquityCurve(shuffled, initialCapital);
    allEquities.push(eq);
    maxDDs.push(calcMaxDrawdown(eq));
    finalReturns.push((eq[eq.length - 1] - initialCapital) / initialCapital);
  }

  // Sort for percentile extraction
  const sortedFR  = [...finalReturns].sort((a, b) => a - b);
  const sortedDDs = [...maxDDs].sort((a, b) => a - b);
  const p = (arr: number[], pct: number) => arr[Math.floor(pct * (arr.length - 1))];

  // Build time axis: trade sequence 0..N
  const timeLabels: string[] = Array.from({ length: nTrades + 1 }, (_, i) => {
    // Use fake date labels so lightweight-charts accepts them
    const d = new Date(2000, 0, 1 + i);
    return d.toISOString().slice(0, 10);
  });

  // Extract percentile equity curves
  const PCTS = [
    { label: "P5",  pct: 0.05, color: "#ef4444", style: LineStyle.Dashed,  w: 1 },
    { label: "P25", pct: 0.25, color: "#f97316", style: LineStyle.Dashed,  w: 1 },
    { label: "P50", pct: 0.50, color: "#3b82f6", style: LineStyle.Solid,   w: 2 },
    { label: "P75", pct: 0.75, color: "#22c55e", style: LineStyle.Dashed,  w: 1 },
    { label: "P95", pct: 0.95, color: "#16a34a", style: LineStyle.Dotted,  w: 1 },
  ];

  const percentiles: PercentileCurve[] = PCTS.map(({ label, pct, color, style, w }) => {
    const idx = Math.floor(pct * (nSims - 1));
    // Get the sorted-by-final-return simulation index
    const simIdx = sortedFR.indexOf(sortedFR[idx]);
    const eq = allEquities[simIdx] ?? allEquities[0];
    return {
      label,
      color,
      lineStyle: style,
      lineWidth: w,
      data: timeLabels.map((time, i) => ({
        time,
        value: Math.round(((eq[i] ?? eq[eq.length - 1]) / initialCapital) * 1000) / 10,
      })),
    };
  });

  return {
    percentiles,
    maxDrawdowns: sortedDDs,
    finalReturns: sortedFR,
    p5Return:  p(sortedFR,  0.05),
    p50Return: p(sortedFR,  0.50),
    p95Return: p(sortedFR,  0.95),
    p5MaxDD:   p(sortedDDs, 0.05),
    p50MaxDD:  p(sortedDDs, 0.50),
    p95MaxDD:  p(sortedDDs, 0.95),
    nSims,
    nTrades,
  };
}

// ── Equity Percentile Chart ───────────────────────────────────────────────────

function EquityPercChart({ curves }: { curves: PercentileCurve[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !curves.length) return;
    const chart = createChart(ref.current, {
      layout:    { background: { color: "transparent" }, textColor: "#888" },
      grid:      { vertLines: { visible: false }, horzLines: { color: "#333", style: LineStyle.Dotted } },
      timeScale: { visible: false },
      rightPriceScale: { borderColor: "transparent" },
    });
    for (const c of curves) {
      const s = chart.addSeries(LineSeries, {
        color:     c.color,
        lineWidth: (c.lineWidth ?? 1) as 1 | 2 | 3 | 4,
        lineStyle: c.lineStyle ?? LineStyle.Solid,
        title:     c.label,
      });
      s.setData(c.data.map(p => ({
        time:  p.time as import("lightweight-charts").Time,
        value: p.value,
      })));
    }
    // Baseline at 100
    const base = chart.addSeries(LineSeries, {
      color: "#555", lineWidth: 1, lineStyle: LineStyle.Dashed,
    });
    if (curves[0]?.data.length) {
      base.setData([
        { time: curves[0].data[0].time as import("lightweight-charts").Time,   value: 100 },
        { time: curves[0].data.at(-1)!.time as import("lightweight-charts").Time, value: 100 },
      ]);
    }
    chart.timeScale().fitContent();
    const obs = new ResizeObserver(() => {
      if (ref.current) chart.resize(ref.current.clientWidth, ref.current.clientHeight);
    });
    obs.observe(ref.current);
    return () => { obs.disconnect(); chart.remove(); };
  }, [curves]);
  return <div ref={ref} className="w-full h-52" />;
}

// ── Histogram Chart ───────────────────────────────────────────────────────────

function HistChart({
  values, label, fmtX, color,
}: {
  values: number[];
  label:  string;
  fmtX:   (v: number) => string;
  color:  string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !values.length) return;

    // Build histogram bins (20 bins)
    const min = values[0];
    const max = values[values.length - 1];
    const bins = 20;
    const step = (max - min) / bins || 0.01;
    const counts: number[] = Array(bins).fill(0);
    for (const v of values) {
      const b = Math.min(bins - 1, Math.floor((v - min) / step));
      counts[b]++;
    }

    // Fake time axis (string dates)
    const histData = counts.map((count, i) => ({
      time:  new Date(2000, 0, 1 + i).toISOString().slice(0, 10) as import("lightweight-charts").Time,
      value: count,
      color: color,
    }));

    const chart = createChart(ref.current, {
      layout:    { background: { color: "transparent" }, textColor: "#888" },
      grid:      { vertLines: { visible: false }, horzLines: { color: "#333", style: LineStyle.Dotted } },
      timeScale: { visible: false },
      rightPriceScale: { borderColor: "transparent" },
    });
    const s = chart.addSeries(HistogramSeries, { color, priceFormat: { type: "volume" } });
    s.setData(histData);
    chart.timeScale().fitContent();
    const obs = new ResizeObserver(() => {
      if (ref.current) chart.resize(ref.current.clientWidth, ref.current.clientHeight);
    });
    obs.observe(ref.current);
    return () => { obs.disconnect(); chart.remove(); };
  }, [values, color]);

  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-1 text-center">{label}</p>
      <div ref={ref} className="w-full h-36" />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  trades:         BacktestTrade[];
  initialCapital: number;
}

export default function MonteCarloPanel({ trades, initialCapital }: Props) {
  const [nSims,   setNSims]   = useState(1000);
  const [result,  setResult]  = useState<MCResult | null>(null);
  const [running, setRunning] = useState(false);

  const handleRun = useCallback(() => {
    if (!trades.length) return;
    setRunning(true);
    // Defer to next tick so UI can update
    setTimeout(() => {
      const r = runMonteCarlo(trades, initialCapital, nSims);
      setResult(r);
      setRunning(false);
    }, 0);
  }, [trades, initialCapital, nSims]);

  // Auto-run when component mounts with trades
  useEffect(() => {
    if (trades.length > 0) handleRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!trades.length) {
    return (
      <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
        請先執行一次回測以取得交易記錄
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">模擬次數</span>
          <select
            value={nSims}
            onChange={e => setNSims(+e.target.value)}
            className="px-2 py-1 rounded border border-border bg-background"
          >
            {[500, 1000, 2000, 5000].map(n => (
              <option key={n} value={n}>{n.toLocaleString()} 次</option>
            ))}
          </select>
        </label>
        <button
          onClick={handleRun}
          disabled={running}
          className="px-3 py-1 rounded text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? "計算中…" : "🎲 重新模擬"}
        </button>
        {result && (
          <span className="text-muted-foreground">
            {result.nTrades} 筆交易 × {result.nSims.toLocaleString()} 次隨機重排
          </span>
        )}
      </div>

      {running && (
        <div className="text-center text-sm text-muted-foreground py-8">
          蒙地卡羅模擬中…
        </div>
      )}

      {result && !running && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { label: "P5 最終報酬",  val: `${(result.p5Return  * 100).toFixed(1)}%`, cls: "text-red-500"   },
              { label: "P50 最終報酬", val: `${(result.p50Return * 100).toFixed(1)}%`, cls: "text-blue-500"  },
              { label: "P95 最終報酬", val: `${(result.p95Return * 100).toFixed(1)}%`, cls: "text-green-500" },
              { label: "P5 最大回撤",  val: `${(result.p5MaxDD   * 100).toFixed(1)}%`, cls: "text-green-500" },
              { label: "P50 最大回撤", val: `${(result.p50MaxDD  * 100).toFixed(1)}%`, cls: "text-yellow-500"},
              { label: "P95 最大回撤", val: `${(result.p95MaxDD  * 100).toFixed(1)}%`, cls: "text-red-500"   },
            ].map(s => (
              <div key={s.label} className="rounded border border-border p-2 text-center">
                <p className="text-muted-foreground mb-0.5">{s.label}</p>
                <p className={`font-semibold font-mono ${s.cls}`}>{s.val}</p>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-[10px]">
            {result.percentiles.map(c => (
              <span key={c.label} className="flex items-center gap-1">
                <span className="inline-block w-5 h-0.5 rounded" style={{ background: c.color }} />
                {c.label}
              </span>
            ))}
          </div>

          {/* Equity percentile chart */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">資金曲線百分位（base 100）</p>
            <EquityPercChart curves={result.percentiles} />
          </div>

          {/* Distribution histograms */}
          <div className="grid grid-cols-2 gap-4">
            <HistChart
              values={result.finalReturns}
              label="最終報酬率分佈"
              fmtX={v => `${(v*100).toFixed(0)}%`}
              color="#3b82f6"
            />
            <HistChart
              values={result.maxDrawdowns}
              label="最大回撤分佈"
              fmtX={v => `${(v*100).toFixed(0)}%`}
              color="#ef4444"
            />
          </div>

          <div className="text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 space-y-0.5">
            <p className="font-semibold text-xs text-foreground/70 mb-1">如何解讀</p>
            <p>• P50（中位數）曲線代表「最典型」的結果，不是保證</p>
            <p>• P5 曲線代表最壞 5% 情境——這才是你真正需要能承受的損失</p>
            <p>• P95 最大回撤 {`${(result.p95MaxDD*100).toFixed(1)}%`} 代表 95% 的隨機排列情境下回撤不超過此值</p>
            <p>• 本模擬假設每筆交易彼此獨立，不考慮流動性與衝擊成本</p>
          </div>
        </>
      )}
    </div>
  );
}
