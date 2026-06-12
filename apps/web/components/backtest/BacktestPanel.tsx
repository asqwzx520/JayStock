"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  BacktestPreset,
  BacktestPresetParam,
  BacktestRequest,
  BacktestResult,
  BacktestStats,
  BacktestTrade,
  BacktestStrategyConfig,
  BacktestMonthlyReturn,
} from "@/lib/api";
import {
  runBacktest, getBacktestPresets, getKline,
  listSavedStrategies, saveStrategy, deleteSavedStrategy,
  getLiveSignal, getStopRecommendation,
} from "@/lib/api";
import type { KlineBar, SavedStrategy, SaveStrategyRequest, LiveSignalResult, StopRecommendResult } from "@/lib/api";
import DSLEditor, { type DSLStrategy } from "@/components/backtest/DSLEditor";
import OptimizePanel   from "./OptimizePanel";
import ComparePanel    from "./ComparePanel";
import ScanPanel       from "./ScanPanel";
import PortfolioPanel    from "./PortfolioPanel";
import WalkForwardPanel  from "./WalkForwardPanel";
import MonteCarloPanel   from "./MonteCarloPanel";
import TradeDistPanel    from "./TradeDistPanel";
import RollingPanel      from "./RollingPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | undefined, digits = 2) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}
function fmt(v: number | undefined, digits = 2) {
  if (v == null) return "—";
  return v.toFixed(digits);
}
function fmtMoney(v: number | undefined) {
  if (v == null) return "—";
  return v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(2)}M`
    : v >= 1_000
    ? `${(v / 1_000).toFixed(1)}K`
    : v.toFixed(0);
}

// ── Equity Curve (lightweight-charts) ────────────────────────────────────────

// ── OLS regression helpers (P6-22) ───────────────────────────────────────────

function calcOLS(values: number[]): { yHat: number[]; sigma: number; r2: number } {
  const n = values.length;
  if (n < 4) return { yHat: values, sigma: 0, r2: 0 };
  const sumX  = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY  = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((a, v, i) => a + i * v, 0);
  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const yHat   = values.map((_, i) => intercept + slope * i);
  const ssTot  = values.reduce((a, v) => a + (v - sumY / n) ** 2, 0);
  const ssRes  = values.reduce((a, v, i) => a + (v - yHat[i]) ** 2, 0);
  const sigma  = Math.sqrt(ssRes / Math.max(n - 2, 1));
  const r2     = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { yHat, sigma, r2 };
}

function EquityChart({
  equityCurve,
  benchmarkCurve,
  trades,
  showTrend,
}: {
  equityCurve:    BacktestResult["equity_curve"];
  benchmarkCurve: BacktestResult["benchmark_curve"];
  trades:         BacktestTrade[];
  showTrend?:     boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [r2Display, setR2Display] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || !equityCurve.length) return;
    let chart: ReturnType<typeof import("lightweight-charts")["createChart"]> | null = null;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle, AreaSeries, LineSeries, createSeriesMarkers }) => {
      if (!containerRef.current) return;
      const el = containerRef.current;
      chart = createChart(el, {
        width:  el.clientWidth,
        height: el.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "var(--text-secondary)",
        },
        grid: {
          vertLines: { color: "var(--border)", style: LineStyle.Dotted },
          horzLines: { color: "var(--border)", style: LineStyle.Dotted },
        },
        crosshair: { mode: 1 },
        timeScale: { borderColor: "var(--border)", timeVisible: true },
        rightPriceScale: { borderColor: "var(--border)" },
      });

      // ── Equity area series ──
      const eqSeries = chart.addSeries(AreaSeries, {
        lineColor:       "#3B82F6",
        topColor:        "rgba(59,130,246,0.25)",
        bottomColor:     "rgba(59,130,246,0.02)",
        lineWidth:       2,
        priceFormat:     { type: "custom", formatter: (v: number) => fmtMoney(v) },
      });
      eqSeries.setData(equityCurve.map(p => ({ time: p.time as import("lightweight-charts").Time, value: p.value })));

      // ── Benchmark dashed line ──
      if (benchmarkCurve.length) {
        const bmSeries = chart.addSeries(LineSeries, {
          color:       "rgba(156,163,175,0.6)",
          lineWidth:   1,
          lineStyle:   LineStyle.Dashed,
          priceFormat: { type: "custom", formatter: (v: number) => fmtMoney(v) },
        });
        bmSeries.setData(benchmarkCurve.map(p => ({ time: p.time as import("lightweight-charts").Time, value: p.value })));
      }

      // ── OLS Trend + σ bands (P6-22) ──
      if (showTrend && equityCurve.length >= 4) {
        const vals = equityCurve.map(p => p.value);
        const { yHat, sigma, r2 } = calcOLS(vals);
        setR2Display(r2);
        type Time = import("lightweight-charts").Time;
        const times = equityCurve.map(p => p.time as Time);
        const fmtP = { type: "custom" as const, formatter: (v: number) => fmtMoney(v) };

        chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 2, lineStyle: LineStyle.Dashed, priceFormat: fmtP })
          .setData(times.map((t, i) => ({ time: t, value: yHat[i] })));
        chart.addSeries(LineSeries, { color: "rgba(245,158,11,0.35)", lineWidth: 1, lineStyle: LineStyle.Solid, priceFormat: fmtP })
          .setData(times.map((t, i) => ({ time: t, value: yHat[i] + sigma })));
        chart.addSeries(LineSeries, { color: "rgba(245,158,11,0.35)", lineWidth: 1, lineStyle: LineStyle.Solid, priceFormat: fmtP })
          .setData(times.map((t, i) => ({ time: t, value: yHat[i] - sigma })));
        chart.addSeries(LineSeries, { color: "rgba(245,158,11,0.15)", lineWidth: 1, lineStyle: LineStyle.Dotted, priceFormat: fmtP })
          .setData(times.map((t, i) => ({ time: t, value: yHat[i] + 2 * sigma })));
        chart.addSeries(LineSeries, { color: "rgba(245,158,11,0.15)", lineWidth: 1, lineStyle: LineStyle.Dotted, priceFormat: fmtP })
          .setData(times.map((t, i) => ({ time: t, value: yHat[i] - 2 * sigma })));
      } else {
        setR2Display(null);
      }

      // ── Trade markers ──
      type Marker = import("lightweight-charts").SeriesMarker<import("lightweight-charts").Time>;
      const buyMarkers: Marker[] = trades.map(t => ({
        time:     t.entry_date as import("lightweight-charts").Time,
        position: "belowBar" as const,
        color:    "#EF4444",
        shape:    "arrowUp" as const,
        text:     "B",
        size:     1,
      }));
      const sellMarkers: Marker[] = trades.map(t => ({
        time:     t.exit_date as import("lightweight-charts").Time,
        position: "aboveBar" as const,
        color:    "#22C55E",
        shape:    "arrowDown" as const,
        text:     "S",
        size:     1,
      }));
      const markers = [...buyMarkers, ...sellMarkers].sort((a, b) =>
        (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
      );
      createSeriesMarkers(eqSeries, markers);

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chart) {
          chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        }
      });
      ro.observe(el);
      return () => { ro.disconnect(); };
    });

    return () => { chart?.remove(); };
  }, [equityCurve, benchmarkCurve, trades, showTrend]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {showTrend && r2Display !== null && (
        <div className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-mono"
          style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
          R² = {r2Display.toFixed(4)}
        </div>
      )}
    </div>
  );
}

// ── Drawdown Chart ────────────────────────────────────────────────────────────

function DrawdownChart({ equityCurve }: { equityCurve: BacktestResult["equity_curve"] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !equityCurve.length) return;
    let chart: ReturnType<typeof import("lightweight-charts")["createChart"]> | null = null;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle, HistogramSeries }) => {
      if (!containerRef.current) return;
      const el = containerRef.current;
      chart = createChart(el, {
        width:  el.clientWidth,
        height: el.clientHeight,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "var(--text-secondary)" },
        grid: {
          vertLines: { color: "var(--border)", style: LineStyle.Dotted },
          horzLines: { color: "var(--border)", style: LineStyle.Dotted },
        },
        timeScale: { borderColor: "var(--border)" },
        rightPriceScale: { borderColor: "var(--border)" },
      });

      const ddSeries = chart.addSeries(HistogramSeries, {
        color:       "rgba(239,68,68,0.6)",
        priceFormat: { type: "percent", precision: 2 },
      });
      ddSeries.setData(equityCurve.map(p => ({
        time:  p.time as import("lightweight-charts").Time,
        value: p.drawdown * 100,
        color: p.drawdown < -0.1 ? "rgba(239,68,68,0.8)" : "rgba(239,68,68,0.4)",
      })));

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chart) {
          chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        }
      });
      ro.observe(el);
      return () => { ro.disconnect(); };
    });

    return () => { chart?.remove(); };
  }, [equityCurve]);

  return <div ref={containerRef} className="w-full h-full" />;
}

// ── K 線圖 + 買賣標記（P0-2）─────────────────────────────────────────────────

function TradesKlineChart({
  symbol,
  trades,
  startDate,
  endDate,
}: {
  symbol:    string;
  trades:    BacktestTrade[];
  startDate: string;   // YYYY-MM-DD
  endDate:   string;   // YYYY-MM-DD
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bars,    setBars]    = useState<KlineBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Fetch K 線資料
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getKline(symbol, "daily")
      .then(r => {
        if (cancelled) return;
        // 篩選回測日期範圍
        const filtered = (r.data ?? []).filter(b => b.date >= startDate && b.date <= endDate);
        setBars(filtered);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "K線資料載入失敗");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, startDate, endDate]);

  // 繪圖
  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;
    let chart: ReturnType<typeof import("lightweight-charts")["createChart"]> | null = null;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle, CandlestickSeries, createSeriesMarkers }) => {
      if (!containerRef.current) return;
      const el = containerRef.current;
      chart = createChart(el, {
        width:  el.clientWidth,
        height: el.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor:  "var(--text-secondary)",
        },
        grid: {
          vertLines: { color: "var(--border)", style: LineStyle.Dotted },
          horzLines: { color: "var(--border)", style: LineStyle.Dotted },
        },
        crosshair: { mode: 1 },
        timeScale: { borderColor: "var(--border)", timeVisible: false },
        rightPriceScale: { borderColor: "var(--border)" },
      });

      // 台股慣例：紅漲綠跌
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor:        "#EF4444",
        downColor:      "#22C55E",
        borderUpColor:  "#EF4444",
        borderDownColor:"#22C55E",
        wickUpColor:    "#EF4444",
        wickDownColor:  "#22C55E",
      });

      candleSeries.setData(bars.map(b => ({
        time:  b.date as import("lightweight-charts").Time,
        open:  b.open,
        high:  b.high,
        low:   b.low,
        close: b.close,
      })));

      // ── 買賣標記 ──
      type Marker = import("lightweight-charts").SeriesMarker<import("lightweight-charts").Time>;
      const buyMarkers: Marker[] = trades.map((t, i) => ({
        time:     t.entry_date as import("lightweight-charts").Time,
        position: "belowBar" as const,
        color:    "#3B82F6",
        shape:    "arrowUp" as const,
        text:     `B${i + 1}`,
        size:     1.2,
      }));
      const sellMarkers: Marker[] = trades.map((t, i) => {
        const winColor = t.pnl_pct >= 0 ? "#22C55E" : "#EF4444";
        return {
          time:     t.exit_date as import("lightweight-charts").Time,
          position: "aboveBar" as const,
          color:    winColor,
          shape:    "arrowDown" as const,
          text:     `S${i + 1} ${(t.pnl_pct * 100).toFixed(1)}%`,
          size:     1.2,
        };
      });
      const markers = [...buyMarkers, ...sellMarkers].sort((a, b) =>
        a.time < b.time ? -1 : a.time > b.time ? 1 : 0
      );
      createSeriesMarkers(candleSeries, markers);

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chart) {
          chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        }
      });
      ro.observe(el);
      return () => { ro.disconnect(); };
    });

    return () => { chart?.remove(); };
  }, [bars, trades]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-xs" style={{ color: "var(--text-tertiary)" }}>
        載入 K 線資料中...
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-xs" style={{ color: "var(--color-down)" }}>
        ⚠ {error}
      </div>
    );
  }
  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs" style={{ color: "var(--text-tertiary)" }}>
        無 K 線資料
      </div>
    );
  }
  return <div ref={containerRef} className="w-full h-full" />;
}

// ── 交易明細列表（簡易版本，配合 K 線圖一起顯示）──────────────────────────────

function TradesMiniList({ trades }: { trades: BacktestTrade[] }) {
  if (trades.length === 0) {
    return <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>無交易</div>;
  }
  return (
    <div className="overflow-auto rounded" style={{ border: "1px solid var(--border)", maxHeight: 160 }}>
      <table className="w-full text-[11px]">
        <thead style={{ background: "var(--bg-elevated)", position: "sticky", top: 0, zIndex: 1 }}>
          <tr style={{ color: "var(--text-tertiary)" }}>
            <th className="px-2 py-1 text-left">#</th>
            <th className="px-2 py-1 text-left">進場日</th>
            <th className="px-2 py-1 num text-right">進場價</th>
            <th className="px-2 py-1 text-left">出場日</th>
            <th className="px-2 py-1 num text-right">出場價</th>
            <th className="px-2 py-1 num text-right">報酬</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
              <td className="px-2 py-1" style={{ color: "var(--text-tertiary)" }}>{i + 1}</td>
              <td className="px-2 py-1 num whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{t.entry_date}</td>
              <td className="px-2 py-1 num text-right">{t.entry_price.toLocaleString()}</td>
              <td className="px-2 py-1 num whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{t.exit_date}</td>
              <td className="px-2 py-1 num text-right">{t.exit_price.toLocaleString()}</td>
              <td className="px-2 py-1 num text-right font-medium"
                  style={{ color: t.pnl_pct >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                {pct(t.pnl_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── P7-23: Annual Returns Bar Chart ──────────────────────────────────────────

function AnnualReturnsChart({
  monthlyReturns,
  benchmarkCurve,
}: {
  monthlyReturns:  BacktestMonthlyReturn[];
  benchmarkCurve:  BacktestResult["benchmark_curve"];
}) {
  // Compound monthly returns into yearly
  const yearMap: Record<number, number> = {};
  for (const d of monthlyReturns) {
    yearMap[d.year] = yearMap[d.year] == null
      ? (1 + d.return_pct)
      : yearMap[d.year] * (1 + d.return_pct);
  }
  const stratYears = Object.keys(yearMap).map(Number).sort();
  const stratRets  = stratYears.map(y => yearMap[y] - 1);

  // Benchmark annual return from equity curve (year-over-year)
  const bmYearEnd: Record<number, number> = {};
  for (const pt of benchmarkCurve) {
    const yr = Number(pt.time.slice(0, 4));
    bmYearEnd[yr] = pt.value;
  }
  const bmYearStart: Record<number, number> = {};
  for (const pt of benchmarkCurve) {
    const yr = Number(pt.time.slice(0, 4));
    if (bmYearStart[yr] == null) bmYearStart[yr] = pt.value;
  }
  const bmRets: Record<number, number> = {};
  for (const yr of stratYears) {
    const s = bmYearStart[yr], e = bmYearEnd[yr];
    if (s && e && s !== 0) bmRets[yr] = (e - s) / s;
  }

  if (!stratYears.length) {
    return <div className="text-xs text-center py-8" style={{ color: "var(--text-tertiary)" }}>無月報酬資料</div>;
  }

  const maxAbs = Math.max(0.01, ...stratRets.map(Math.abs), ...Object.values(bmRets).map(Math.abs));
  const BAR_W = Math.max(28, Math.min(60, Math.floor(500 / stratYears.length) - 6));
  const CHART_H = 180;
  const ZERO_Y = CHART_H * 0.55;   // zero line at 55% from top (more space for gains)
  const SCALE = (CHART_H * 0.45) / maxAbs;

  const avgRet = stratRets.reduce((a, b) => a + b, 0) / stratRets.length;
  const posYears = stratRets.filter(r => r > 0).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Summary row */}
      <div className="flex gap-4 text-xs flex-wrap">
        {[
          { label: "年均報酬", value: `${avgRet >= 0 ? "+" : ""}${(avgRet * 100).toFixed(1)}%`, color: avgRet >= 0 ? "#22c55e" : "#ef4444" },
          { label: "正報酬年數", value: `${posYears} / ${stratYears.length}`, color: "var(--text-primary)" },
          { label: "最佳年份", value: `+${(Math.max(...stratRets) * 100).toFixed(1)}%`, color: "#22c55e" },
          { label: "最差年份", value: `${(Math.min(...stratRets) * 100).toFixed(1)}%`, color: "#ef4444" },
        ].map(d => (
          <div key={d.label} className="flex flex-col">
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{d.label}</span>
            <span className="font-bold" style={{ color: d.color }}>{d.value}</span>
          </div>
        ))}
      </div>

      {/* SVG bar chart */}
      <div style={{ overflowX: "auto" }}>
        <svg
          width={stratYears.length * (BAR_W + 6) + 48}
          height={CHART_H + 36}
          style={{ display: "block", minWidth: 200 }}
        >
          {/* Zero line */}
          <line x1={24} y1={ZERO_Y} x2={stratYears.length * (BAR_W + 6) + 24} y2={ZERO_Y}
            stroke="var(--border)" strokeWidth={1} />

          {/* Average return dashed line */}
          {(() => {
            const avgY = ZERO_Y - avgRet * SCALE;
            return (
              <line x1={24} y1={avgY} x2={stratYears.length * (BAR_W + 6) + 24} y2={avgY}
                stroke="rgba(147,112,219,0.6)" strokeWidth={1} strokeDasharray="4 3" />
            );
          })()}

          {stratYears.map((yr, i) => {
            const ret  = stratRets[i];
            const x    = 24 + i * (BAR_W + 6);
            const barH = Math.abs(ret) * SCALE;
            const barY = ret >= 0 ? ZERO_Y - barH : ZERO_Y;
            const color = ret >= 0 ? "#22c55e" : "#ef4444";
            const bmRet = bmRets[yr];

            return (
              <g key={yr}>
                {/* Strategy bar */}
                <rect x={x} y={barY} width={BAR_W} height={Math.max(barH, 1)} rx={2} fill={color} fillOpacity={0.85} />
                {/* Benchmark marker */}
                {bmRet != null && (
                  <line
                    x1={x + 2} y1={ZERO_Y - bmRet * SCALE}
                    x2={x + BAR_W - 2} y2={ZERO_Y - bmRet * SCALE}
                    stroke="rgba(156,163,175,0.9)" strokeWidth={2}
                  />
                )}
                {/* Value label */}
                <text
                  x={x + BAR_W / 2}
                  y={ret >= 0 ? barY - 3 : barY + barH + 9}
                  textAnchor="middle"
                  fontSize={9}
                  fill={color}
                >
                  {ret >= 0 ? "+" : ""}{(ret * 100).toFixed(0)}%
                </text>
                {/* Year label */}
                <text x={x + BAR_W / 2} y={CHART_H + 14} textAnchor="middle" fontSize={9} fill="var(--text-tertiary)">
                  {yr}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        ■ 策略年報酬 &nbsp; — 基準年報酬（灰線）&nbsp; - - 策略平均（紫虛線）
      </div>
    </div>
  );
}

// ── P7-24: Trade Timing Analysis ─────────────────────────────────────────────

const WEEKDAY_LABELS = ["週一", "週二", "週三", "週四", "週五"];
const MONTH_LABELS_TW = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

interface TimingBucket { count: number; wins: number; totalPnl: number }

function BucketBar({
  items, labels,
}: {
  items:  Record<number, TimingBucket>;
  labels: string[];
}) {
  const keys = labels.map((_, i) => i).filter(k => items[k]?.count > 0);
  if (!keys.length) return null;
  const maxWr = Math.max(...keys.map(k => items[k].wins / items[k].count));
  return (
    <div className="flex flex-col gap-1">
      {labels.map((label, k) => {
        const b = items[k];
        if (!b || b.count === 0) return null;
        const wr  = b.wins / b.count;
        const avg = b.totalPnl / b.count;
        const w   = maxWr > 0 ? wr / maxWr : 0;
        return (
          <div key={k} className="flex items-center gap-2">
            <div className="text-[10px] text-right shrink-0" style={{ width: 28, color: "var(--text-tertiary)" }}>{label}</div>
            <div className="flex-1 h-3 rounded overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded" style={{ width: `${w * 100}%`, background: avg >= 0 ? "#22c55e" : "#ef4444", opacity: 0.8 }} />
            </div>
            <div className="text-[10px] font-mono shrink-0" style={{ width: 36, color: wr >= 0.5 ? "#22c55e" : "#ef4444" }}>
              {(wr * 100).toFixed(0)}%
            </div>
            <div className="text-[9px] shrink-0" style={{ color: "var(--text-tertiary)", width: 40 }}>
              ({b.count}筆)
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TradeTimingPanel({ trades }: { trades: BacktestTrade[] }) {
  const [open, setOpen] = useState(false);

  if (trades.length < 10) return null;

  const byDay:   Record<number, TimingBucket> = {};
  const byMonth: Record<number, TimingBucket> = {};

  for (const t of trades) {
    const d = new Date(t.entry_date);
    const dow   = d.getDay() === 0 ? 4 : d.getDay() - 1;
    const month = d.getMonth() + 1;
    const win   = t.pnl_pct > 0 ? 1 : 0;

    if (!byDay[dow])     byDay[dow]     = { count: 0, wins: 0, totalPnl: 0 };
    if (!byMonth[month]) byMonth[month] = { count: 0, wins: 0, totalPnl: 0 };

    byDay[dow].count++;   byDay[dow].wins   += win; byDay[dow].totalPnl   += t.pnl_pct;
    byMonth[month].count++; byMonth[month].wins += win; byMonth[month].totalPnl += t.pnl_pct;
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold"
        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
      >
        <span>🕐 交易時機分析（進場勝率）</span>
        <span style={{ color: "var(--text-tertiary)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="p-4 flex flex-col gap-4" style={{ background: "var(--bg-surface)" }}>
          <div>
            <div className="text-[10px] font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>按星期幾</div>
            <BucketBar items={byDay} labels={WEEKDAY_LABELS} />
          </div>
          <div>
            <div className="text-[10px] font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>按月份</div>
            <BucketBar items={byMonth} labels={MONTH_LABELS_TW} />
          </div>
          <div className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>
            條形長度代表相對勝率；綠色平均盈利、紅色平均虧損
          </div>
        </div>
      )}
    </div>
  );
}

// ── P7-25: Strategy Decay Detection ──────────────────────────────────────────

function DecayDetectionPanel({
  equityCurve,
  trades,
}: {
  equityCurve: BacktestResult["equity_curve"];
  trades:      BacktestTrade[];
}) {
  if (equityCurve.length < 20) return null;

  const mid    = Math.floor(equityCurve.length / 2);
  const first  = equityCurve.slice(0, mid + 1);
  const second = equityCurve.slice(mid);

  function halfStats(curve: typeof equityCurve, allTrades: BacktestTrade[], dateRange: [string, string]) {
    const [start, end] = dateRange;
    const ret   = curve.length > 1 ? (curve[curve.length - 1].value - curve[0].value) / curve[0].value : 0;
    // Annualised return
    const days  = Math.max(1, (new Date(curve[curve.length - 1].time).getTime() - new Date(curve[0].time).getTime()) / 86400_000);
    const cagr  = Math.pow(1 + ret, 365 / days) - 1;
    // Max drawdown
    let peak = curve[0].value, mdd = 0;
    for (const pt of curve) {
      if (pt.value > peak) peak = pt.value;
      const dd = (pt.value - peak) / peak;
      if (dd < mdd) mdd = dd;
    }
    // Sharpe from daily returns
    const dailyRets: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const p = curve[i - 1].value;
      if (p !== 0) dailyRets.push((curve[i].value - p) / p);
    }
    let sharpe = null;
    if (dailyRets.length >= 5) {
      const mean = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
      const std  = Math.sqrt(dailyRets.reduce((a, v) => a + (v - mean) ** 2, 0) / (dailyRets.length - 1));
      sharpe = std === 0 ? null : (mean / std) * Math.sqrt(252);
    }
    // Win rate from trades in this period
    const periodTrades = allTrades.filter(t => t.entry_date >= start && t.entry_date <= end);
    const wr = periodTrades.length ? periodTrades.filter(t => t.pnl_pct > 0).length / periodTrades.length : null;
    return { ret, cagr, mdd, sharpe, wr, tradeCount: periodTrades.length };
  }

  const h1 = halfStats(first,  trades, [first[0].time,  first[first.length - 1].time]);
  const h2 = halfStats(second, trades, [second[0].time, second[second.length - 1].time]);

  // Decay check: second-half Sharpe < first-half Sharpe × 0.6
  const isDecay = h1.sharpe != null && h2.sharpe != null && h2.sharpe < h1.sharpe * 0.6;
  const isImprove = h1.sharpe != null && h2.sharpe != null && h2.sharpe > h1.sharpe * 1.2;

  function fmtPct(v: number | null) { return v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`; }
  function fmtF(v: number | null, d = 2) { return v == null ? "—" : v.toFixed(d); }

  const rows: { label: string; v1: string; v2: string; better: "h1" | "h2" | "eq" }[] = [
    { label: "總報酬",   v1: fmtPct(h1.ret),    v2: fmtPct(h2.ret),    better: h2.ret > h1.ret ? "h2" : "h1" },
    { label: "年化報酬", v1: fmtPct(h1.cagr),   v2: fmtPct(h2.cagr),   better: h2.cagr > h1.cagr ? "h2" : "h1" },
    { label: "Sharpe",  v1: fmtF(h1.sharpe),   v2: fmtF(h2.sharpe),   better: (h2.sharpe ?? -99) > (h1.sharpe ?? -99) ? "h2" : "h1" },
    { label: "最大回撤", v1: fmtPct(h1.mdd),    v2: fmtPct(h2.mdd),    better: h2.mdd > h1.mdd ? "h1" : "h2" },
    { label: "勝率",    v1: fmtPct(h1.wr),     v2: fmtPct(h2.wr),     better: (h2.wr ?? 0) > (h1.wr ?? 0) ? "h2" : "h1" },
    { label: "交易筆數", v1: String(h1.tradeCount), v2: String(h2.tradeCount), better: "eq" },
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `2px solid ${isDecay ? "rgba(239,68,68,0.4)" : isImprove ? "rgba(34,197,94,0.4)" : "var(--border)"}` }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ background: isDecay ? "rgba(239,68,68,0.08)" : isImprove ? "rgba(34,197,94,0.06)" : "var(--bg-elevated)" }}>
        <div>
          <div className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            {isDecay ? "⚠️ 策略退化警告" : isImprove ? "✅ 策略持續進步" : "📊 前後段績效對比"}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            前段：{first[0].time} ~ {first[first.length - 1].time} &nbsp;｜&nbsp;
            後段：{second[0].time} ~ {second[second.length - 1].time}
          </div>
        </div>
        {isDecay && (
          <div className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
            後段 Sharpe &lt; 前段 × 0.6
          </div>
        )}
      </div>
      {/* Table */}
      <div className="p-4" style={{ background: "var(--bg-surface)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th className="py-1.5 text-left text-[10px]" style={{ color: "var(--text-tertiary)", width: 70 }}>指標</th>
              <th className="py-1.5 text-right text-[10px]" style={{ color: "var(--color-brand)" }}>前半段</th>
              <th className="py-1.5 text-right text-[10px]" style={{ color: "var(--text-secondary)" }}>後半段</th>
              <th className="py-1.5 text-right text-[10px] w-12" style={{ color: "var(--text-tertiary)" }}>變化</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const h2Better = r.better === "h2";
              return (
                <tr key={r.label} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="py-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>{r.label}</td>
                  <td className="py-1.5 text-right font-mono text-[11px]" style={{ color: "var(--text-primary)", fontWeight: r.better === "h1" ? 700 : 400 }}>{r.v1}</td>
                  <td className="py-1.5 text-right font-mono text-[11px]" style={{ color: isDecay && r.label === "Sharpe" ? "#ef4444" : "var(--text-primary)", fontWeight: h2Better ? 700 : 400 }}>{r.v2}</td>
                  <td className="py-1.5 text-right text-[10px]">
                    {r.better === "eq" ? "" : h2Better ? <span style={{ color: "#22c55e" }}>▲</span> : <span style={{ color: "#ef4444" }}>▼</span>}
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

// ── Monthly Returns Heatmap ───────────────────────────────────────────────────

const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function MonthlyHeatmap({ data }: { data: BacktestMonthlyReturn[] }) {
  // Build year × month map
  const map: Record<number, Record<number, number>> = {};
  for (const d of data) {
    if (!map[d.year]) map[d.year] = {};
    map[d.year][d.month] = d.return_pct;
  }
  const years = Object.keys(map).map(Number).sort();

  function cellColor(v: number | undefined): string {
    if (v == null) return "var(--bg-elevated)";
    const abs = Math.abs(v);
    if (abs < 0.005) return "rgba(107,114,128,0.3)";
    if (v > 0) {
      const intensity = Math.min(abs / 0.08, 1);
      return `rgba(239,68,68,${0.15 + intensity * 0.65})`;
    } else {
      const intensity = Math.min(abs / 0.08, 1);
      return `rgba(34,197,94,${0.15 + intensity * 0.65})`;
    }
  }

  function yearTotal(yr: number): number {
    const months = map[yr] ?? {};
    return Object.values(months).reduce((s, v) => s + v, 0);
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] border-collapse" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th className="px-2 py-1 text-left" style={{ color: "var(--text-tertiary)" }}>年份</th>
            {MONTH_LABELS.map((m, i) => (
              <th key={i} className="px-1 py-1 text-center w-10" style={{ color: "var(--text-tertiary)" }}>{m}</th>
            ))}
            <th className="px-2 py-1 text-center" style={{ color: "var(--text-tertiary)" }}>全年</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const total = yearTotal(yr);
            return (
              <tr key={yr}>
                <td className="px-2 py-0.5 num font-medium" style={{ color: "var(--text-secondary)" }}>{yr}</td>
                {MONTHS.map((_, mi) => {
                  const v = map[yr]?.[mi + 1];
                  return (
                    <td
                      key={mi}
                      className="px-1 py-0.5 text-center rounded num"
                      style={{
                        background: cellColor(v),
                        color:      "var(--text-primary)",
                        minWidth:   36,
                      }}
                      title={v != null ? `${yr}/${mi+1}: ${pct(v)}` : "無資料"}
                    >
                      {v != null ? `${(v * 100).toFixed(1)}` : ""}
                    </td>
                  );
                })}
                <td
                  className="px-2 py-0.5 text-center num font-semibold"
                  style={{ color: total >= 0 ? "var(--color-up)" : "var(--color-down)" }}
                >
                  {pct(total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-3 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        <span>顏色說明：</span>
        <span style={{ background: "rgba(239,68,68,0.7)", padding: "1px 6px", borderRadius: 2 }}>漲</span>
        <span style={{ background: "rgba(34,197,94,0.7)",  padding: "1px 6px", borderRadius: 2 }}>跌</span>
        <span style={{ background: "rgba(107,114,128,0.3)", padding: "1px 6px", borderRadius: 2 }}>持平</span>
      </div>
    </div>
  );
}

// ── Stats Card ────────────────────────────────────────────────────────────────

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="text-xs num font-medium" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function LiveSignalCard({
  symbol,
  lastReq,
}: {
  symbol:  string;
  lastReq: BacktestRequest | null;
}) {
  const [result,  setResult]  = useState<LiveSignalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleCheck = useCallback(async () => {
    if (!lastReq) return;
    setLoading(true);
    setError(null);
    try {
      const r = await getLiveSignal(symbol, lastReq.strategy);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "查詢失敗");
    } finally {
      setLoading(false);
    }
  }, [symbol, lastReq]);

  const SIGNAL_CONFIG = {
    buy:     { emoji: "🟢", label: "進場訊號",   color: "#22c55e", bg: "#166534" },
    sell:    { emoji: "🔴", label: "出場訊號",   color: "#ef4444", bg: "#7f1d1d" },
    holding: { emoji: "🟡", label: "持倉中",     color: "#f59e0b", bg: "#78350f" },
    none:    { emoji: "⚪", label: "無訊號",     color: "#888",    bg: "#374151" },
  };

  return (
    <div className="rounded-lg p-4 space-y-3 mt-3" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
          📡 即時訊號偵測
        </div>
        <button
          onClick={handleCheck}
          disabled={loading || !lastReq}
          className="text-[11px] px-3 py-1 rounded-full font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--color-brand)", color: "#fff" }}
        >
          {loading ? "偵測中…" : "🔍 偵測訊號"}
        </button>
      </div>

      {!lastReq && (
        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          請先執行一次回測後，再使用即時訊號偵測。
        </p>
      )}

      {error && (
        <p className="text-[11px] rounded px-2 py-1" style={{ background: "var(--color-down-subtle)", color: "var(--color-down)" }}>
          {error}
        </p>
      )}

      {result && !loading && (() => {
        const cfg = SIGNAL_CONFIG[result.signal];
        return (
          <div className="space-y-2">
            {/* Signal badge */}
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                 style={{ background: cfg.bg + "44", border: `1px solid ${cfg.color}55` }}>
              <span className="text-2xl">{cfg.emoji}</span>
              <div>
                <p className="text-sm font-bold" style={{ color: cfg.color }}>{cfg.label}</p>
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{result.reason}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>收盤價</p>
                <p className="text-sm font-mono font-semibold" style={{ color: "var(--text-primary)" }}>
                  {result.latest_close.toLocaleString()}
                </p>
                <p className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>{result.latest_date}</p>
              </div>
            </div>
            {/* Key indicators */}
            {Object.keys(result.indicators).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.indicators).map(([k, v]) => (
                  <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              ⚠️ 訊號僅供參考，基於歷史資料計算，不構成投資建議。
            </p>
          </div>
        );
      })()}
    </div>
  );
}

// ── Strategy Scorecard (P6-20) ────────────────────────────────────────────────

interface ScoreDim {
  label:  string;
  score:  number;
  max:    number;
  note:   string;
}

function calcScorecard(s: BacktestStats): { dims: ScoreDim[]; total: number; grade: string; gradeColor: string } {
  const cagr = s.cagr ?? 0;
  const cagrScore =
    cagr >= 0.30 ? 25 : cagr >= 0.20 ? 20 : cagr >= 0.15 ? 15 : cagr >= 0.10 ? 10 : cagr >= 0.05 ? 5 : 0;

  const sharpe = s.sharpe ?? 0;
  const sharpeScore =
    sharpe >= 2.0 ? 25 : sharpe >= 1.5 ? 20 : sharpe >= 1.0 ? 15 : sharpe >= 0.5 ? 10 : sharpe >= 0 ? 5 : 0;

  const mdd = Math.abs(s.max_drawdown ?? 0);
  const mddScore =
    mdd <= 0.05 ? 25 : mdd <= 0.10 ? 20 : mdd <= 0.20 ? 15 : mdd <= 0.30 ? 10 : mdd <= 0.40 ? 5 : 0;

  const wr = s.win_rate ?? 0;
  const wrScore =
    wr >= 0.70 ? 15 : wr >= 0.60 ? 12 : wr >= 0.55 ? 9 : wr >= 0.50 ? 6 : wr >= 0.40 ? 3 : 0;

  const pf = s.profit_factor ?? 0;
  const pfScore =
    pf >= 3.0 ? 10 : pf >= 2.0 ? 8 : pf >= 1.5 ? 6 : pf >= 1.2 ? 4 : pf >= 1.0 ? 2 : 0;

  const total = cagrScore + sharpeScore + mddScore + wrScore + pfScore;
  const grade      = total >= 80 ? "A" : total >= 65 ? "B" : total >= 50 ? "C" : total >= 35 ? "D" : "F";
  const gradeColor = total >= 80 ? "#16a34a" : total >= 65 ? "#2563eb" : total >= 50 ? "#d97706" : total >= 35 ? "#dc2626" : "#7f1d1d";

  return {
    total,
    grade,
    gradeColor,
    dims: [
      { label: "年化報酬", score: cagrScore,  max: 25, note: `CAGR ${(cagr * 100).toFixed(1)}%` },
      { label: "Sharpe",   score: sharpeScore, max: 25, note: `${sharpe.toFixed(2)}` },
      { label: "最大回撤", score: mddScore,    max: 25, note: `${(mdd * 100).toFixed(1)}%` },
      { label: "勝率",     score: wrScore,     max: 15, note: `${(wr * 100).toFixed(1)}%` },
      { label: "盈虧比",   score: pfScore,     max: 10, note: `${pf.toFixed(2)}` },
    ],
  };
}

function ScorecardPanel({ stats }: { stats: BacktestStats }) {
  const { dims, total, grade, gradeColor } = calcScorecard(stats);

  return (
    <div className="rounded-xl p-4" style={{ border: `2px solid ${gradeColor}40`, background: "var(--bg-surface)" }}>
      <div className="flex items-center gap-4 mb-4">
        {/* Grade circle */}
        <div className="shrink-0 flex items-center justify-center rounded-full font-black text-2xl"
          style={{ width: 64, height: 64, background: `${gradeColor}18`, color: gradeColor, border: `2px solid ${gradeColor}60` }}>
          {grade}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black" style={{ color: gradeColor }}>{total}</span>
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>/ 100</span>
          </div>
          <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--text-secondary)" }}>
            策略綜合評分
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {grade === "A" ? "優秀 · 各維度均衡出色" :
             grade === "B" ? "良好 · 多數指標達標" :
             grade === "C" ? "普通 · 仍有改善空間" :
             grade === "D" ? "偏弱 · 風險或報酬不足" :
                             "危險 · 建議重新調整策略"}
          </div>
        </div>
        {/* Mini score bar (total out of 100) */}
        <div className="shrink-0 w-2 h-14 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div className="w-full rounded-full transition-all" style={{ height: `${total}%`, background: gradeColor }} />
        </div>
      </div>

      {/* Dimension bars */}
      <div className="flex flex-col gap-2">
        {dims.map(d => (
          <div key={d.label} className="flex items-center gap-2">
            <div className="text-[10px] shrink-0 text-right" style={{ width: 52, color: "var(--text-tertiary)" }}>{d.label}</div>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${(d.score / d.max) * 100}%`, background: gradeColor }} />
            </div>
            <div className="text-[10px] font-mono shrink-0" style={{ width: 36, color: "var(--text-secondary)" }}>
              {d.score}/{d.max}
            </div>
            <div className="text-[10px] shrink-0" style={{ width: 52, color: "var(--text-tertiary)" }}>{d.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── P8-26: Kelly Criterion ────────────────────────────────────────────────────

function KellyCriterionCard({
  stats,
  initialCapital,
}: {
  stats:          BacktestStats;
  initialCapital: number;
}) {
  const W  = stats.win_rate      ?? 0;
  const PF = stats.profit_factor ?? 0;
  if (W <= 0 || PF <= 0) return null;

  const kelly = Math.max(0, W - (1 - W) / PF);
  const half    = kelly / 2;
  const quarter = kelly / 4;
  const isAggressive = kelly > 0.5;

  const rows = [
    { label: "Full Kelly",    pct: kelly,   note: isAggressive ? "⚠️ 過激" : "理論最大化",  color: isAggressive ? "#ef4444" : "#3b82f6" },
    { label: "Half Kelly",    pct: half,    note: "✅ 推薦（平衡風報）",                     color: "#22c55e" },
    { label: "Quarter Kelly", pct: quarter, note: "🛡️ 保守（低波動優先）",                  color: "#a78bfa" },
  ];

  return (
    <div className="rounded-xl p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
        🎲 Kelly Criterion 最佳持倉比例
      </div>
      <div className="text-[10px] mb-3" style={{ color: "var(--text-tertiary)" }}>
        f* = W − (1−W)/PF = {(kelly * 100).toFixed(1)}%&nbsp;
        （勝率 {(W * 100).toFixed(1)}%，盈虧比 {PF.toFixed(2)}）
      </div>
      <div className="flex flex-col gap-2">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-3">
            <div className="text-[10px] shrink-0" style={{ width: 88, color: "var(--text-secondary)" }}>{r.label}</div>
            <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded" style={{ width: `${Math.min(r.pct, 1) * 100}%`, background: r.color, opacity: 0.8 }} />
            </div>
            <div className="font-bold font-mono text-xs shrink-0" style={{ width: 40, color: r.color }}>
              {(r.pct * 100).toFixed(1)}%
            </div>
            <div className="text-[10px] shrink-0" style={{ color: "var(--text-tertiary)", width: 140 }}>
              ≈ ${(initialCapital * r.pct).toLocaleString(undefined, { maximumFractionDigits: 0 })} &nbsp;{r.note}
            </div>
          </div>
        ))}
      </div>
      {kelly === 0 && (
        <div className="mt-2 text-[10px]" style={{ color: "#ef4444" }}>
          Kelly ≤ 0：當前策略期望值為負，不建議下注。
        </div>
      )}
    </div>
  );
}

// ── P8-27: Capital Utilization ────────────────────────────────────────────────

function CapitalUtilizationCard({
  trades,
  equityCurve,
}: {
  trades:      BacktestTrade[];
  equityCurve: BacktestResult["equity_curve"];
}) {
  if (!equityCurve.length || !trades.length) return null;

  const startMs = new Date(equityCurve[0].time).getTime();
  const endMs   = new Date(equityCurve[equityCurve.length - 1].time).getTime();
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400_000));

  const holdingDays = trades.reduce((a, t) => a + (t.hold_days ?? 0), 0);
  const holdingRate = Math.min(1, holdingDays / totalDays);
  const idleDays    = Math.max(0, totalDays - holdingDays);
  const turnover    = trades.length / (totalDays / 252);   // trades per year
  const avgHold     = trades.length ? holdingDays / trades.length : 0;

  const stats2 = [
    { label: "持倉率",         value: `${(holdingRate * 100).toFixed(1)}%`,  note: holdingRate < 0.3 ? "低——資金閒置多" : holdingRate > 0.8 ? "高——持續在場" : "適中" },
    { label: "閒置天數",       value: `${idleDays}天`,                        note: `共 ${totalDays} 天回測` },
    { label: "年化換手次數",   value: `${turnover.toFixed(1)}次/年`,          note: "" },
    { label: "平均持倉天數",   value: `${avgHold.toFixed(1)}天/筆`,           note: "" },
  ];

  return (
    <div className="rounded-xl p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
        💰 資金使用率分析
      </div>

      {/* Utilization bar */}
      <div className="flex items-center gap-2 mb-3 mt-2">
        <div className="text-[10px] shrink-0" style={{ color: "var(--text-tertiary)", width: 36 }}>持倉</div>
        <div className="flex-1 h-4 rounded overflow-hidden flex" style={{ background: "var(--border)" }}>
          <div className="h-full" style={{ width: `${holdingRate * 100}%`, background: "#3b82f6", opacity: 0.8 }} />
          <div className="h-full" style={{ width: `${(1 - holdingRate) * 100}%`, background: "var(--border)" }} />
        </div>
        <div className="text-[10px] shrink-0" style={{ color: "var(--text-tertiary)", width: 36 }}>閒置</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {stats2.map(s => (
          <div key={s.label} className="rounded-lg px-3 py-2" style={{ background: "var(--bg-elevated)" }}>
            <div className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{s.value}</div>
            {s.note && <div className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>{s.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── P8-28: Backtest History (localStorage) ────────────────────────────────────

// ── P11-34: 兩層式 Tab 導航 ────────────────────────────────────────────────────

interface TabDef { id: ResultTab; label: string; alwaysEnabled?: boolean }

const TAB_GROUPS: { id: string; label: string; tabs: TabDef[] }[] = [
  {
    id: "perf", label: "📊 績效",
    tabs: [
      { id: "stats",   label: "績效摘要" },
      { id: "monthly", label: "月份報酬" },
      { id: "annual",  label: "年度報酬" },
    ],
  },
  {
    id: "charts", label: "📈 圖表",
    tabs: [
      { id: "chart",   label: "資金曲線" },
      { id: "kline",   label: "K線標記" },
      { id: "rolling", label: "滾動績效" },
    ],
  },
  {
    id: "tradesGrp", label: "📋 交易",
    tabs: [
      { id: "trades",    label: "交易明細" },
      { id: "tradedist", label: "交易分佈" },
    ],
  },
  {
    id: "validate", label: "🧪 驗證",
    tabs: [
      { id: "walkforward", label: "Walk-Forward", alwaysEnabled: true },
      { id: "montecarlo",  label: "Monte Carlo" },
    ],
  },
  {
    id: "tools", label: "🛠 工具",
    tabs: [
      { id: "optimize",  label: "最佳化", alwaysEnabled: true },
      { id: "compare",   label: "比較",   alwaysEnabled: true },
      { id: "scan",      label: "掃描",   alwaysEnabled: true },
      { id: "portfolio", label: "組合",   alwaysEnabled: true },
    ],
  },
];

const HISTORY_KEY = "backtest_history_v1";

interface BacktestSnapshot {
  id:           string;
  timestamp:    string;
  symbol:       string;
  strategyType: string;
  total_return: number;
  sharpe:       number;
  max_drawdown: number;
  win_rate:     number;
  total_trades: number;
  engine_version?: number;   // P9-31：無此欄 = v1（同日收盤成交）
}

function loadHistory(): BacktestSnapshot[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as BacktestSnapshot[]) : [];
  } catch { return []; }
}

function saveHistory(snap: BacktestSnapshot) {
  const list = loadHistory();
  const updated = [snap, ...list].slice(0, 20);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
}

function HistoryPanel({
  current: _current,
  history,
  onSelectCompare,
  compareId,
}: {
  current:         BacktestStats;
  history:         BacktestSnapshot[];
  onSelectCompare: (id: string | null) => void;
  compareId:       string | null;
}) {
  if (!history.length) {
    return (
      <div className="text-xs text-center py-4" style={{ color: "var(--text-tertiary)" }}>
        尚無歷史記錄，執行回測後自動存檔（最多 20 筆）
      </div>
    );
  }

  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  return (
    <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
      {history.map(s => {
        const isCompare = s.id === compareId;
        return (
          <div
            key={s.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-xs"
            style={{
              background: isCompare ? "rgba(59,130,246,0.1)" : "var(--bg-elevated)",
              border:     `1px solid ${isCompare ? "var(--color-brand)" : "var(--border)"}`,
            }}
            onClick={() => onSelectCompare(isCompare ? null : s.id)}
          >
            <div className="shrink-0 text-[10px]" style={{ color: "var(--text-tertiary)", width: 90 }}>
              {s.timestamp.slice(0, 16).replace("T", " ")}
            </div>
            <div className="font-semibold shrink-0" style={{ width: 44 }}>{s.symbol}</div>
            <div className="shrink-0 text-[10px]" style={{ color: "var(--text-tertiary)", width: 72 }}>
              {s.strategyType.replace(/_/g, " ")}
            </div>
            <div className="flex-1 flex gap-3 justify-end font-mono text-[10px]">
              <span style={{ color: s.total_return >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(s.total_return)}</span>
              <span style={{ color: "var(--text-secondary)" }}>SR {s.sharpe.toFixed(2)}</span>
              <span style={{ color: "#ef4444" }}>{fmtPct(s.max_drawdown)}</span>
            </div>
            {isCompare && (
              <div className="shrink-0 text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-brand)", color: "#fff" }}>比較中</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CompareRow({
  label,
  current,
  prev,
  isPct,
  lowerBetter,
}: {
  label:       string;
  current:     number;
  prev:        number;
  isPct?:      boolean;
  lowerBetter?: boolean;
}) {
  const diff = current - prev;
  const improved = lowerBetter ? diff < 0 : diff > 0;
  const fmt = (v: number) => isPct ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%` : v.toFixed(3);
  const fmtDiff = (d: number) => isPct ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)}%` : `${d >= 0 ? "+" : ""}${d.toFixed(3)}`;
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td className="py-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>{label}</td>
      <td className="py-1.5 text-right font-mono text-[11px]" style={{ color: "var(--text-primary)" }}>{fmt(current)}</td>
      <td className="py-1.5 text-right font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>{fmt(prev)}</td>
      <td className="py-1.5 text-right font-mono text-[10px]" style={{ color: improved ? "#22c55e" : "#ef4444" }}>
        {fmtDiff(diff)} {improved ? "▲" : "▼"}
      </td>
    </tr>
  );
}

// ── Stop Recommendation Card (P6-21) ─────────────────────────────────────────

function StopRecommendCard({ trades }: { trades: BacktestTrade[] }) {
  const [data,    setData]    = useState<StopRecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleFetch() {
    setLoading(true);
    setError(null);
    try {
      const res = await getStopRecommendation(trades);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "計算失敗");
    } finally {
      setLoading(false);
    }
  }

  const pct = (v: number | null | undefined) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  return (
    <div className="rounded-xl p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            🎯 停損 / 停利推薦
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            基於 {trades.length} 筆歷史交易的報酬分佈，估算最優截斷點
          </div>
        </div>
        {!data && (
          <button
            onClick={handleFetch}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity"
            style={{ background: "var(--color-brand)", color: "#fff", opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "⏳ 計算中..." : "🔍 分析推薦"}
          </button>
        )}
        {data && (
          <button
            onClick={() => setData(null)}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{ color: "var(--text-tertiary)", border: "1px solid var(--border)" }}
          >
            重設
          </button>
        )}
      </div>

      {error && (
        <div className="text-xs rounded px-3 py-2" style={{ background: "var(--color-down-subtle)", color: "var(--color-down)" }}>
          {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-3">
          {/* Recommendation badges */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3 text-center" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
              <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>建議停損</div>
              <div className="text-xl font-black" style={{ color: "#ef4444" }}>
                {data.recommended_stop_loss != null ? `-${(data.recommended_stop_loss * 100).toFixed(0)}%` : "不建議"}
              </div>
              {data.recommended_stop_loss && (
                <div className="text-[10px] mt-1" style={{ color: "#ef4444" }}>
                  預估改善 {data.sl_improvement_pct > 0 ? "+" : ""}{data.sl_improvement_pct.toFixed(1)}%
                </div>
              )}
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>建議停利</div>
              <div className="text-xl font-black" style={{ color: "#22c55e" }}>
                {data.recommended_take_profit != null ? `+${(data.recommended_take_profit * 100).toFixed(0)}%` : "不建議"}
              </div>
              {data.recommended_take_profit && (
                <div className="text-[10px] mt-1" style={{ color: "#22c55e" }}>
                  預估改善 {data.tp_improvement_pct > 0 ? "+" : ""}{data.tp_improvement_pct.toFixed(1)}%
                </div>
              )}
            </div>
          </div>

          {/* Distribution summary */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: "平均虧損", value: pct(data.avg_loss),  color: "#ef4444" },
              { label: "P5 最差",  value: pct(data.p5_loss),   color: "#ef4444" },
              { label: "平均獲利", value: pct(data.avg_gain),  color: "#22c55e" },
              { label: "P95 最佳", value: pct(data.p95_gain),  color: "#22c55e" },
            ].map(d => (
              <div key={d.label} className="rounded-lg py-2" style={{ background: "var(--bg-elevated)" }}>
                <div className="text-[9px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>{d.label}</div>
                <div className="text-xs font-bold font-mono" style={{ color: d.color }}>{d.value}</div>
              </div>
            ))}
          </div>

          <div className="text-[9px] text-center" style={{ color: "var(--text-tertiary)" }}>
            * 基於歷史 pnl_pct 分佈線性模擬；實際回測需重新執行以驗證
          </div>
        </div>
      )}
    </div>
  );
}

// ── Export Report (P5-19) ─────────────────────────────────────────────────────

function ExportReportButton({
  result,
  symbol,
  lastReq,
}: {
  result:   BacktestResult;
  symbol:   string;
  lastReq:  BacktestRequest | null;
}) {
  const s = result.stats;

  function handleExport() {
    const strategyLabel = lastReq?.strategy?.type
      ? lastReq.strategy.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      : "自訂策略";
    const dateRange = lastReq ? `${lastReq.start_date} ~ ${lastReq.end_date}` : "—";
    const capital   = lastReq?.initial_capital?.toLocaleString() ?? "—";
    const generated = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" });

    const p = (v: number | undefined, d = 2) =>
      v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
    const f = (v: number | undefined, d = 2) =>
      v == null ? "—" : v.toFixed(d);

    const rows = [
      ["總報酬率",     p(s.total_return)],
      ["年化報酬（CAGR）", p(s.cagr)],
      ["Sharpe Ratio",  f(s.sharpe)],
      ["Sortino Ratio", f(s.sortino)],
      ["最大回撤",      p(s.max_drawdown)],
      ["勝率",          p(s.win_rate, 1)],
      ["盈虧比",        f(s.profit_factor)],
      ["平均持倉天數",  s.avg_hold_days != null ? `${s.avg_hold_days.toFixed(1)} 天` : "—"],
      ["總交易筆數",    String(s.total_trades ?? "—")],
      ["Alpha（超額報酬）", p(s.alpha)],
      ["基準年化報酬",  p(s.benchmark_cagr)],
    ];

    const tradeRows = result.trades.slice(0, 30).map(t => `
      <tr>
        <td>${t.entry_date}</td>
        <td>${t.exit_date}</td>
        <td>${t.side === "long" ? "買入" : "放空"}</td>
        <td style="text-align:right">${Number(t.entry_price).toFixed(2)}</td>
        <td style="text-align:right">${Number(t.exit_price).toFixed(2)}</td>
        <td style="text-align:right">${t.shares}</td>
        <td style="text-align:right; color:${t.pnl >= 0 ? "#16a34a" : "#dc2626"}">${t.pnl >= 0 ? "+" : ""}${Number(t.pnl).toFixed(0)}</td>
        <td style="text-align:right; color:${t.pnl_pct >= 0 ? "#16a34a" : "#dc2626"}">${t.pnl_pct >= 0 ? "+" : ""}${(Number(t.pnl_pct) * 100).toFixed(2)}%</td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>回測報告 ${symbol} ${strategyLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 12px; color: #1f2937; padding: 32px; max-width: 860px; margin: auto; }
  h1 { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .meta { color: #6b7280; font-size: 11px; margin-bottom: 24px; }
  .section-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 2px solid #e5e7eb; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #f3f4f6; text-align: left; padding: 6px 10px; font-size: 11px; color: #6b7280; }
  td { padding: 5px 10px; border-bottom: 1px solid #f3f4f6; font-size: 11px; }
  .kpi-table td:first-child { color: #6b7280; width: 160px; }
  .kpi-table td:last-child { font-weight: 600; font-family: monospace; }
  .footer { margin-top: 32px; font-size: 10px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
<h1>📊 回測報告</h1>
<div class="meta">
  股票代號：<strong>${symbol}</strong> &nbsp;｜&nbsp;
  策略：<strong>${strategyLabel}</strong> &nbsp;｜&nbsp;
  期間：${dateRange} &nbsp;｜&nbsp;
  起始資金：$${capital} &nbsp;｜&nbsp;
  產生日期：${generated}
</div>

<div class="section-title">績效摘要</div>
<table class="kpi-table">
  ${rows.map(([label, val]) => `<tr><td>${label}</td><td>${val}</td></tr>`).join("")}
</table>

<div class="section-title">交易明細（前 ${Math.min(result.trades.length, 30)} 筆，共 ${result.trades.length} 筆）</div>
<table>
  <thead>
    <tr>
      <th>進場日</th><th>出場日</th><th>方向</th>
      <th style="text-align:right">進場價</th><th style="text-align:right">出場價</th>
      <th style="text-align:right">股數</th>
      <th style="text-align:right">損益</th><th style="text-align:right">報酬%</th>
    </tr>
  </thead>
  <tbody>${tradeRows}</tbody>
</table>

<div class="footer">由 JayStock / StockPulse 回測引擎產生 · 僅供參考，不構成投資建議</div>
<script>window.onload = () => { window.print(); };<\/script>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) { alert("請允許彈出視窗以匯出報告"); return; }
    w.document.write(html);
    w.document.close();
  }

  return (
    <button
      onClick={handleExport}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors mt-2"
      style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
    >
      📄 匯出回測報告
    </button>
  );
}

function RegimeStatsPanel({
  regime,
}: {
  regime: NonNullable<import("@/lib/api").BacktestResult["regime_stats"]>;
}) {
  const REGIMES = [
    { key: "bull"     as const, label: "📈 多頭", color: "#22c55e", desc: "close > MA50 > MA200" },
    { key: "sideways" as const, label: "↔️ 盤整", color: "#a78bfa", desc: "趨勢不明" },
    { key: "bear"     as const, label: "📉 空頭", color: "#ef4444", desc: "close < MA50 < MA200" },
  ];
  const total = Object.values(regime).reduce((s, v) => s + (v?.trade_count ?? 0), 0);
  if (!total) return null;

  return (
    <div className="rounded-lg p-4 space-y-3 mt-3" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
        🌐 市場環境績效分析
      </div>
      <div className="grid grid-cols-3 gap-2">
        {REGIMES.map(({ key, label, color, desc }) => {
          const d = regime[key];
          if (!d) return (
            <div key={key} className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <p className="text-[11px] font-semibold" style={{ color }}>{label}</p>
              <p className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>無交易</p>
            </div>
          );
          const pct = total ? Math.round(d.trade_count / total * 100) : 0;
          const wr  = d.win_rate != null ? `${(d.win_rate * 100).toFixed(0)}%` : "—";
          const avg = d.avg_pnl_pct != null ? `${d.avg_pnl_pct >= 0 ? "+" : ""}${(d.avg_pnl_pct * 100).toFixed(1)}%` : "—";
          return (
            <div key={key} className="rounded-lg p-3 space-y-2" style={{ background: "var(--bg-elevated)", border: `1px solid ${color}44` }}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold" style={{ color }}>{label}</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: color + "22", color }}>
                  {pct}%
                </span>
              </div>
              <p className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <div>
                  <p style={{ color: "var(--text-tertiary)" }}>交易</p>
                  <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{d.trade_count}筆</p>
                </div>
                <div>
                  <p style={{ color: "var(--text-tertiary)" }}>勝率</p>
                  <p className="font-semibold" style={{ color: d.win_rate && d.win_rate >= 0.5 ? "#22c55e" : "#ef4444" }}>{wr}</p>
                </div>
                <div>
                  <p style={{ color: "var(--text-tertiary)" }}>平均報酬</p>
                  <p className="font-semibold font-mono" style={{ color: d.avg_pnl_pct && d.avg_pnl_pct >= 0 ? "#22c55e" : "#ef4444" }}>{avg}</p>
                </div>
                <div>
                  <p style={{ color: "var(--text-tertiary)" }}>淨損益</p>
                  <p className="font-semibold font-mono text-[9px]" style={{ color: d.total_pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {d.total_pnl >= 0 ? "+" : ""}{(d.total_pnl / 1000).toFixed(0)}K
                  </p>
                </div>
              </div>
              {/* Win-rate mini bar */}
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                <div className="h-full rounded-full" style={{ width: wr, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] rounded px-2 py-1.5" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
        依進場日期判斷市場環境。多頭環境勝率高但空頭也能獲利 → 策略抗跌性強；空頭勝率大幅下滑 → 建議加入趨勢過濾器。
      </div>
    </div>
  );
}

function StatsPanel({ stats, symbol }: { stats: BacktestStats; symbol: string }) {
  const isUS = !/^\d+$/.test(symbol.toUpperCase()) && !symbol.toUpperCase().endsWith(".TW");
  const bench = isUS ? "SPY" : "0050";

  return (
    <div className="space-y-4">
      {/* Hero metrics */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "總報酬率", value: pct(stats.total_return), color: stats.total_return >= 0 ? "var(--color-up)" : "var(--color-down)" },
          { label: "最大回撤", value: pct(stats.max_drawdown), color: "var(--color-down)" },
          { label: "Sharpe Ratio", value: fmt(stats.sharpe), color: stats.sharpe >= 1 ? "var(--color-up)" : stats.sharpe >= 0 ? "var(--text-primary)" : "var(--color-down)" },
        ].map(m => (
          <div key={m.label} className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>{m.label}</div>
            <div className="text-xl font-bold num" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Full metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>報酬</div>
          <StatRow label="年化報酬 (CAGR)"    value={pct(stats.cagr)}    color={stats.cagr >= 0 ? "var(--color-up)" : "var(--color-down)"} />
          <StatRow label="Sortino Ratio"      value={fmt(stats.sortino)} color={stats.sortino >= 1 ? "var(--color-up)" : "var(--text-primary)"} />
          <StatRow label="Calmar Ratio"       value={fmt(stats.calmar)}  color={stats.calmar >= 1 ? "var(--color-up)" : "var(--text-primary)"} />
          <StatRow label={`對比 ${bench} 超額報酬`} value={pct(stats.alpha)} color={stats.alpha >= 0 ? "var(--color-up)" : "var(--color-down)"} />
          <StatRow label={`${bench} CAGR`}    value={pct(stats.benchmark_cagr)} />
          <StatRow label="最終淨值"           value={`$${stats.final_equity?.toLocaleString()}`} />
        </div>
        <div>
          <div className="text-xs font-semibold mb-1 mt-3 sm:mt-0" style={{ color: "var(--text-tertiary)" }}>風險 & 交易</div>
          <StatRow label="最大回撤持續天數" value={`${stats.max_dd_days} 天`} />
          <StatRow label="勝率"             value={pct(stats.win_rate)}  color={stats.win_rate >= 0.5 ? "var(--color-up)" : "var(--color-down)"} />
          <StatRow label="盈虧比"           value={fmt(stats.profit_factor)} color={stats.profit_factor >= 1.5 ? "var(--color-up)" : "var(--text-primary)"} />
          <StatRow label="交易次數"         value={`${stats.total_trades} 次`} />
          <StatRow label="平均持倉天數"     value={`${fmt(stats.avg_hold_days, 1)} 天`} />
          <StatRow label="最佳單次交易"     value={pct(stats.best_trade)}  color="var(--color-up)" />
          <StatRow label="最差單次交易"     value={pct(stats.worst_trade)} color="var(--color-down)" />
        </div>
      </div>
    </div>
  );
}

// ── Trade List ────────────────────────────────────────────────────────────────

function TradeTableHeader({
  label, k, sortKey, sortAsc, onSort,
}: {
  label:   string;
  k:       keyof BacktestTrade;
  sortKey: keyof BacktestTrade;
  sortAsc: boolean;
  onSort:  (k: keyof BacktestTrade) => void;
}) {
  return (
    <th
      className="px-2 py-1.5 text-left text-[10px] cursor-pointer select-none"
      style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}
      onClick={() => onSort(k)}
    >
      {label} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
    </th>
  );
}

const EXIT_REASON_META: Record<string, { label: string; color: string; bg: string }> = {
  signal:            { label: "訊號",     color: "#94a3b8", bg: "rgba(148,163,184,0.15)" },
  stop_loss:         { label: "停損",     color: "#ef4444", bg: "rgba(239,68,68,0.15)"   },
  stop_loss_gap:     { label: "跳空停損", color: "#dc2626", bg: "rgba(220,38,38,0.2)"    },
  take_profit:       { label: "停利",     color: "#10b981", bg: "rgba(16,185,129,0.15)"  },
  trailing_stop:     { label: "移動停損", color: "#f97316", bg: "rgba(249,115,22,0.15)"  },
  trailing_stop_gap: { label: "跳空移停", color: "#ea580c", bg: "rgba(234,88,12,0.2)"    },
  time_stop:         { label: "時間停損", color: "#8b5cf6", bg: "rgba(139,92,246,0.15)"  },
  end_of_period:     { label: "期末強平", color: "#f59e0b", bg: "rgba(245,158,11,0.15)"  },
};

function ExitReasonBadge({ reason }: { reason?: string }) {
  const meta = EXIT_REASON_META[reason ?? "signal"] ?? EXIT_REASON_META.signal;
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap"
      style={{ color: meta.color, background: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

function exportTradesCsv(trades: BacktestTrade[]) {
  const header = ["進場日", "出場日", "進場價", "出場價", "股數", "持倉天數", "損益(元)", "損益%", "手續費(元)", "出場原因"];
  const rows = trades.map(t => [
    t.entry_date,
    t.exit_date,
    t.entry_price,
    t.exit_price,
    t.shares,
    t.hold_days,
    t.pnl,
    (t.pnl_pct * 100).toFixed(4),
    t.fee ?? "",
    EXIT_REASON_META[t.exit_reason ?? "signal"]?.label ?? "",
  ]);
  const csv = [header, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `backtest_trades_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function TradeList({ trades }: { trades: BacktestTrade[] }) {
  const [sortKey, setSortKey] = useState<keyof BacktestTrade>("entry_date");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterReason, setFilterReason] = useState<string>("all");

  function toggleSort(key: keyof BacktestTrade) {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const filtered = filterReason === "all"
    ? trades
    : trades.filter(t => (t.exit_reason ?? "signal") === filterReason);

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] as number | string;
    const bv = b[sortKey] as number | string;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  const wins      = trades.filter(t => t.pnl > 0).length;
  const losses    = trades.length - wins;
  const avgPnl    = trades.length ? trades.reduce((s, t) => s + t.pnl_pct,  0) / trades.length : 0;
  const totalFee  = trades.reduce((s, t) => s + (t.fee ?? 0), 0);
  const avgHold   = trades.length ? trades.reduce((s, t) => s + t.hold_days, 0) / trades.length : 0;
  const bestPnl   = trades.length ? Math.max(...trades.map(t => t.pnl_pct)) : 0;
  const worstPnl  = trades.length ? Math.min(...trades.map(t => t.pnl_pct)) : 0;

  // 出場原因分佈統計
  const reasonCounts: Record<string, number> = {};
  for (const t of trades) {
    const r = t.exit_reason ?? "signal";
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }

  const FILTER_TABS: { id: string; label: string }[] = [
    { id: "all", label: `全部 (${trades.length})` },
    ...Object.entries(reasonCounts).map(([id, n]) => ({
      id,
      label: `${EXIT_REASON_META[id]?.label ?? id} (${n})`,
    })),
  ];

  return (
    <div>
      {/* Summary bar (2 rows) */}
      <div className="grid gap-2 mb-3 text-xs" style={{ color: "var(--text-secondary)" }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>共 <span className="num font-medium" style={{ color: "var(--text-primary)" }}>{trades.length}</span> 筆</span>
          <span style={{ color: "var(--color-up)" }}>獲利 {wins}</span>
          <span style={{ color: "var(--color-down)" }}>虧損 {losses}</span>
          <span>勝率 <span className="num font-medium" style={{ color: "var(--text-primary)" }}>{trades.length ? ((wins / trades.length) * 100).toFixed(1) : "0"}%</span></span>
          <span>平均損益 <span className="num" style={{ color: avgPnl >= 0 ? "var(--color-up)" : "var(--color-down)" }}>{pct(avgPnl)}</span></span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>平均持倉 <span className="num font-medium" style={{ color: "var(--text-primary)" }}>{avgHold.toFixed(1)} 天</span></span>
          <span>總手續費 <span className="num font-medium" style={{ color: "var(--text-primary)" }}>${totalFee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
          <span>最佳 <span className="num" style={{ color: "var(--color-up)" }}>{pct(bestPnl)}</span></span>
          <span>最差 <span className="num" style={{ color: "var(--color-down)" }}>{pct(worstPnl)}</span></span>
          <button
            onClick={() => exportTradesCsv(trades)}
            disabled={trades.length === 0}
            className="ml-auto px-2 py-0.5 rounded text-[11px] transition-colors disabled:opacity-40"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            title="匯出交易明細為 CSV"
          >
            ⬇ 匯出 CSV
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilterReason(tab.id)}
            className="px-2 py-0.5 rounded text-[11px] transition-colors"
            style={{
              background: filterReason === tab.id ? "var(--accent)" : "var(--bg-elevated)",
              color:      filterReason === tab.id ? "white"        : "var(--text-secondary)",
              border:     "1px solid var(--border)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-auto max-h-80 rounded" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs" style={{ minWidth: 760 }}>
          <thead style={{ background: "var(--bg-elevated)", position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <TradeTableHeader label="進場日"   k="entry_date"  sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="出場日"   k="exit_date"   sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="進場價"   k="entry_price" sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="出場價"   k="exit_price"  sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="持倉天"   k="hold_days"   sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="損益"     k="pnl"         sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="損益%"    k="pnl_pct"     sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="手續費"   k="fee"         sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <th className="px-2 py-1.5 text-left text-[10px]" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>
                出場原因
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2 py-6 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
                  此分類無交易
                </td>
              </tr>
            ) : sorted.map((t, i) => (
              <tr
                key={i}
                style={{
                  background: t.pnl > 0 ? "var(--color-up-subtle)" : t.pnl < 0 ? "var(--color-down-subtle)" : "transparent",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <td className="px-2 py-1.5 num whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{t.entry_date}</td>
                <td className="px-2 py-1.5 num whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{t.exit_date}</td>
                <td className="px-2 py-1.5 num">{t.entry_price.toLocaleString()}</td>
                <td className="px-2 py-1.5 num">{t.exit_price.toLocaleString()}</td>
                <td className="px-2 py-1.5 num">{t.hold_days}</td>
                <td className="px-2 py-1.5 num" style={{ color: t.pnl >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                  {t.pnl >= 0 ? "+" : ""}{t.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="px-2 py-1.5 num font-medium" style={{ color: t.pnl_pct >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                  {pct(t.pnl_pct)}
                </td>
                <td className="px-2 py-1.5 num" style={{ color: "var(--text-tertiary)" }}>
                  {t.fee != null ? t.fee.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                </td>
                <td className="px-2 py-1.5">
                  <ExitReasonBadge reason={t.exit_reason} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Strategy Config Panel ─────────────────────────────────────────────────────

interface ConfigProps {
  presets:    BacktestPreset[];
  symbol:     string;
  onSubmit:   (req: BacktestRequest) => void;
  loading:    boolean;
}

const RANGE_OPTIONS = [
  { label: "1 年", years: 1 },
  { label: "3 年", years: 3 },
  { label: "5 年", years: 5 },
  { label: "10 年", years: 10 },
];

function dateOffset(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// ── P0-3: 自訂策略條件編輯器 ──────────────────────────────────────────────────

type Cond = { field: string; op: string; value: string };

interface FieldOption { value: string; label: string }
interface FieldGroup  { group: string; options: FieldOption[] }

const FIELD_GROUPS: FieldGroup[] = [
  {
    group: "價量",
    options: [
      { value: "close",  label: "收盤價" },
      { value: "open",   label: "開盤價" },
      { value: "high",   label: "最高價" },
      { value: "low",    label: "最低價" },
      { value: "volume", label: "成交量" },
    ],
  },
  {
    group: "均線",
    options: [
      { value: "ma5",   label: "MA5" },
      { value: "ma10",  label: "MA10" },
      { value: "ma20",  label: "MA20" },
      { value: "ma60",  label: "MA60" },
      { value: "ema12", label: "EMA12" },
      { value: "ema26", label: "EMA26" },
    ],
  },
  {
    group: "動能",
    options: [
      { value: "rsi14",       label: "RSI(14)" },
      { value: "k",           label: "KD-K" },
      { value: "d",           label: "KD-D" },
      { value: "macd",        label: "MACD" },
      { value: "macd_signal", label: "MACD 訊號" },
    ],
  },
  {
    group: "通道",
    options: [
      { value: "bb_upper",  label: "布林上軌" },
      { value: "bb_middle", label: "布林中軌" },
      { value: "bb_lower",  label: "布林下軌" },
    ],
  },
  {
    group: "EPS（公布日 +45 天才生效）",
    options: [
      { value: "eps_ttm",           label: "TTM EPS（過去 4 季）" },
      { value: "eps_quarterly",     label: "最近季 EPS" },
      { value: "eps_quarterly_yoy", label: "季 EPS YoY%" },
      { value: "eps_quarterly_qoq", label: "季 EPS QoQ%" },
    ],
  },
  {
    group: "營收（月公布 +10 天 / 年 TTM）",
    options: [
      { value: "revenue",            label: "月營收（千元）" },
      { value: "revenue_yoy",        label: "月營收 YoY%" },
      { value: "revenue_mom",        label: "月營收 MoM%" },
      { value: "revenue_annual",     label: "年營收 TTM（千元）" },
      { value: "revenue_annual_yoy", label: "年累計 YoY%" },
    ],
  },
  {
    group: "跨日量價（P2-7）",
    options: [
      { value: "vol_ratio",      label: "量比（今/昨量）" },
      { value: "consec_up",      label: "連續上漲天數" },
      { value: "consec_down",    label: "連續下跌天數" },
      { value: "body_pct",       label: "K棒實體%（正=紅K）" },
      { value: "upper_wick_pct", label: "上影線%（相對開盤）" },
      { value: "lower_wick_pct", label: "下影線%（相對開盤）" },
      { value: "is_52w_high",    label: "52週新高（0/1）" },
      { value: "consec_52w_hi",  label: "連續52週新高天數" },
    ],
  },
  {
    group: "K棒形態（0=否/1=是）（P2-7）",
    options: [
      { value: "hammer",       label: "錘頭線（下影≥2倍實體）" },
      { value: "shooting_star",label: "射擊之星（上影≥2倍實體）" },
      { value: "doji",         label: "十字星（實體≤8%振幅）" },
      { value: "bull_engulf",  label: "多頭吞噬" },
      { value: "bear_engulf",  label: "空頭吞噬" },
    ],
  },
];

const OP_OPTIONS: { value: string; label: string }[] = [
  { value: ">",            label: ">  大於" },
  { value: "<",            label: "<  小於" },
  { value: ">=",           label: ">= 大於等於" },
  { value: "<=",           label: "<= 小於等於" },
  { value: "==",           label: "=  等於" },
  { value: "cross_above",  label: "↗ 向上突破" },
  { value: "cross_below",  label: "↘ 向下跌破" },
];

const ALL_FIELD_VALUES = new Set(FIELD_GROUPS.flatMap(g => g.options.map(o => o.value)));

function FieldSelect({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-[11px] px-1.5 py-1 rounded outline-none flex-1 min-w-0"
      style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
    >
      {FIELD_GROUPS.map(g => (
        <optgroup key={g.group} label={g.group}>
          {g.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ConditionsEditor({
  title,
  conds,
  setConds,
  logic,
  setLogic,
  maxConds = 10,
}: {
  title:    string;
  conds:    Cond[];
  setConds: (c: Cond[]) => void;
  logic:    "AND" | "OR";
  setLogic: (l: "AND" | "OR") => void;
  maxConds?: number;
}) {
  const canAdd = conds.length < maxConds;

  function addCond() {
    setConds([...conds, { field: "close", op: ">", value: "ma20" }]);
  }
  function removeCond(idx: number) {
    setConds(conds.filter((_, i) => i !== idx));
  }
  function updateCond(idx: number, patch: Partial<Cond>) {
    setConds(conds.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }

  return (
    <div className="rounded border p-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{title}</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>邏輯</span>
          <button
            onClick={() => setLogic("AND")}
            className="px-1.5 py-0.5 rounded text-[10px]"
            style={{
              background: logic === "AND" ? "var(--color-brand)" : "var(--bg-elevated)",
              color:      logic === "AND" ? "#fff" : "var(--text-secondary)",
              border:     "1px solid var(--border)",
            }}
          >AND</button>
          <button
            onClick={() => setLogic("OR")}
            className="px-1.5 py-0.5 rounded text-[10px]"
            style={{
              background: logic === "OR" ? "var(--color-brand)" : "var(--bg-elevated)",
              color:      logic === "OR" ? "#fff" : "var(--text-secondary)",
              border:     "1px solid var(--border)",
            }}
          >OR</button>
        </div>
      </div>

      {conds.length === 0 ? (
        <div className="text-[10px] py-2 text-center" style={{ color: "var(--text-tertiary)" }}>
          尚無條件，點下方「+ 加條件」開始
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {conds.map((c, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <span className="text-[9px] w-4 text-center" style={{ color: "var(--text-tertiary)" }}>{idx + 1}</span>
              <FieldSelect value={c.field} onChange={(v) => updateCond(idx, { field: v })} />
              <select
                value={c.op}
                onChange={(e) => updateCond(idx, { op: e.target.value })}
                className="text-[11px] px-1.5 py-1 rounded outline-none"
                style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)", width: 90 }}
              >
                {OP_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={c.value}
                onChange={(e) => updateCond(idx, { value: e.target.value })}
                placeholder="數字或欄位名"
                className="text-[11px] px-1.5 py-1 rounded outline-none flex-1 min-w-0"
                style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              />
              <button
                onClick={() => removeCond(idx)}
                className="text-[14px] px-1 leading-none"
                style={{ color: "var(--color-down)" }}
                title="刪除"
              >×</button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={addCond}
          disabled={!canAdd}
          className="text-[11px] px-2 py-1 rounded disabled:opacity-40"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >+ 加條件</button>
        <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>
          {conds.length}/{maxConds}　值可填數字（如 30）或欄位（如 ma20）
        </span>
      </div>
    </div>
  );
}

function StrategyConfig({ presets, symbol, onSubmit, loading }: ConfigProps) {
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? "ma_cross");
  const [params, setParams]         = useState<Record<string, number>>({});
  const [rangeYears, setRangeYears] = useState(5);
  const [capital, setCapital]       = useState("1000000");
  const [stopLoss, setStopLoss]     = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  // P9-29 / P10-32 / P10-33
  const [slippage,     setSlippage]     = useState("0.1");
  const [trailingStop, setTrailingStop] = useState("");
  const [maxHoldDays,  setMaxHoldDays]  = useState("");

  // P0-3 自訂策略 state
  const [entryConds, setEntryConds] = useState<Cond[]>([
    { field: "close", op: "cross_above", value: "ma20" },
    { field: "rsi14", op: "<",           value: "70"   },
  ]);
  const [exitConds, setExitConds] = useState<Cond[]>([
    { field: "close", op: "cross_below", value: "ma20" },
  ]);
  const [entryLogic, setEntryLogic] = useState<"AND" | "OR">("AND");
  const [exitLogic,  setExitLogic]  = useState<"AND" | "OR">("OR");

  // P2-8: DSL strategy state
  const [dslStrategy, setDslStrategy] = useState<DSLStrategy>({
    type: "dsl",
    entry_dsl: "cross_above(ma(5), ma(20))",
    exit_dsl:  "cross_below(ma(5), ma(20))",
  });

  const preset   = presets.find(p => p.id === selectedId) ?? presets[0];
  const isCustom = selectedId === "custom";
  const isDSL    = selectedId === "dsl";

  // Reset params when preset changes
  useEffect(() => {
    if (!preset) return;
    const defaults: Record<string, number> = {};
    for (const p of preset.params) defaults[p.key] = p.default;
    setParams(defaults);
  }, [selectedId]);   // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit() {
    if (!preset) return;
    let strategy: BacktestStrategyConfig = {
      ...preset.default,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v])),
    };

    if (isCustom) {
      // value: 若是已知欄位名 → 字串；否則嘗試數字
      const normVal = (v: string): string | number => {
        const t = v.trim();
        if (ALL_FIELD_VALUES.has(t)) return t;
        const n = parseFloat(t);
        return isNaN(n) ? t : n;
      };
      const validConds = (arr: Cond[]) =>
        arr
          .filter(c => c.field && c.op && c.value.trim() !== "")
          .map(c => ({ field: c.field, op: c.op, value: normVal(c.value) }));

      strategy = {
        ...strategy,
        type:             "custom",
        entry_logic:      entryLogic,
        exit_logic:       exitLogic,
        entry_conditions: validConds(entryConds),
        exit_conditions:  validConds(exitConds),
      };
    }

    if (isDSL) {
      strategy = {
        type:      "dsl",
        entry_dsl: dslStrategy.entry_dsl.trim(),
        exit_dsl:  dslStrategy.exit_dsl.trim(),
      };
    }

    const endDate   = new Date().toISOString().slice(0, 10);
    const startDate = dateOffset(rangeYears);
    onSubmit({
      symbol,
      strategy,
      start_date:      startDate,
      end_date:        endDate,
      initial_capital: parseFloat(capital) || 1_000_000,
      stop_loss_pct:   stopLoss   ? parseFloat(stopLoss)   / 100 : undefined,
      take_profit_pct: takeProfit ? parseFloat(takeProfit) / 100 : undefined,
      slippage_pct:      slippage !== "" && !isNaN(parseFloat(slippage)) ? parseFloat(slippage) / 100 : 0.001,
      trailing_stop_pct: trailingStop ? parseFloat(trailingStop) / 100 : undefined,
      max_hold_days:     maxHoldDays  ? parseInt(maxHoldDays, 10)      : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Strategy cards */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>選擇策略</div>
        <div className="grid grid-cols-2 gap-1.5">
          {presets.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className="text-left p-2 rounded-md text-xs transition-colors"
              style={{
                background:  selectedId === p.id ? "var(--color-brand)" : "var(--bg-elevated)",
                color:       selectedId === p.id ? "#fff" : "var(--text-primary)",
                border:      `1px solid ${selectedId === p.id ? "var(--color-brand)" : "var(--border)"}`,
              }}
            >
              <div className="font-medium">{p.icon} {p.name}</div>
            </button>
          ))}
        </div>
        {preset && (
          <p className="text-[10px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>{preset.desc}</p>
        )}
      </div>

      {/* P0-3: 自訂策略條件編輯器（積木式） */}
      {isCustom && (
        <div className="flex flex-col gap-2">
          <ConditionsEditor
            title="📥 進場條件"
            conds={entryConds}
            setConds={setEntryConds}
            logic={entryLogic}
            setLogic={setEntryLogic}
          />
          <ConditionsEditor
            title="📤 出場條件"
            conds={exitConds}
            setConds={setExitConds}
            logic={exitLogic}
            setLogic={setExitLogic}
          />
          <div className="text-[10px] px-2 py-1 rounded"
               style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
            💡 基本面欄位（EPS / 營收）自動延後公布日生效（季 +45 天 / 月 +10 天），避免未來函數
          </div>
        </div>
      )}

      {/* P2-8: DSL 自由式條件編輯器 */}
      {isDSL && (
        <DSLEditor
          value={dslStrategy}
          onChange={setDslStrategy}
        />
      )}

      {/* Dynamic params */}
      {!isCustom && !isDSL && preset && preset.params.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>策略參數</div>
          <div className="grid grid-cols-2 gap-2">
            {preset.params.map((p: BacktestPresetParam) => (
              <label key={p.key} className="flex flex-col gap-0.5">
                <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{p.label}</span>
                <input
                  type="number"
                  min={p.min}
                  max={p.max}
                  step={p.type === "float" ? 0.1 : 1}
                  value={params[p.key] ?? p.default}
                  onChange={(e) => setParams(prev => ({ ...prev, [p.key]: parseFloat(e.target.value) || p.default }))}
                  className="text-xs px-2 py-1 rounded outline-none"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Date range */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>回測期間</div>
        <div className="flex gap-1.5">
          {RANGE_OPTIONS.map(r => (
            <button
              key={r.years}
              onClick={() => setRangeYears(r.years)}
              className="flex-1 text-xs py-1 rounded"
              style={{
                background: rangeYears === r.years ? "var(--color-brand)" : "var(--bg-elevated)",
                color:      rangeYears === r.years ? "#fff" : "var(--text-secondary)",
                border:     `1px solid ${rangeYears === r.years ? "var(--color-brand)" : "var(--border)"}`,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          {dateOffset(rangeYears)} ～ {new Date().toISOString().slice(0, 10)}
        </p>
      </div>

      {/* Capital & risk */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>資金 & 風控</div>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-0.5 col-span-1">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>起始資金 ($)</span>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              className="text-xs px-2 py-1 rounded outline-none"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>停損 (%)</span>
            <input
              type="number"
              placeholder="如 10"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              min={1} max={50}
              className="text-xs px-2 py-1 rounded outline-none"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>停利 (%)</span>
            <input
              type="number"
              placeholder="如 30"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              min={1} max={500}
              className="text-xs px-2 py-1 rounded outline-none"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>移動停損 (%)</span>
            <input
              type="number"
              placeholder="峰值回落"
              value={trailingStop}
              onChange={(e) => setTrailingStop(e.target.value)}
              min={1} max={50}
              className="text-xs px-2 py-1 rounded outline-none"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>最長持倉 (天)</span>
            <input
              type="number"
              placeholder="不限"
              value={maxHoldDays}
              onChange={(e) => setMaxHoldDays(e.target.value)}
              min={1} max={365}
              className="text-xs px-2 py-1 rounded outline-none"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>滑價 (%)</span>
            <input
              type="number"
              step="0.05"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              min={0} max={0.5}
              className="text-xs px-2 py-1 rounded outline-none"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
          </label>
        </div>
        <div className="text-[9px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          引擎 v2：訊號隔日開盤成交；停損/停利以盤中價觸發，跳空以開盤價成交
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-2 rounded-lg text-sm font-semibold transition-opacity"
        style={{ background: "var(--color-brand)", color: "#fff", opacity: loading ? 0.6 : 1 }}
      >
        {loading ? "計算中..." : "▶ 執行回測"}
      </button>
    </div>
  );
}

// ── P0-4: 儲存策略 Modal ──────────────────────────────────────────────────────

function SaveStrategyModal({
  open, onClose, onSave, defaultName,
}: {
  open:         boolean;
  onClose:      () => void;
  onSave:       (name: string, note: string) => Promise<void>;
  defaultName:  string;
}) {
  const [name, setName] = useState(defaultName);
  const [note, setNote] = useState("");
  const [saving, setSaving]   = useState(false);
  const [errMsg, setErrMsg]   = useState<string | null>(null);

  useEffect(() => { setName(defaultName); }, [defaultName, open]);

  if (!open) return null;

  async function handleSave() {
    if (!name.trim()) { setErrMsg("請輸入策略名稱"); return; }
    setSaving(true);
    setErrMsg(null);
    try {
      await onSave(name.trim(), note.trim());
      onClose();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="rounded-lg p-5 w-full max-w-md"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold" style={{ color: "var(--color-brand)" }}>💾 儲存策略</h3>
          <button onClick={onClose} className="text-lg" style={{ color: "var(--text-tertiary)" }}>✕</button>
        </div>

        <label className="flex flex-col gap-1 mb-3">
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>策略名稱 <span style={{ color: "var(--color-down)" }}>*</span></span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
            placeholder="例：2330 RSI 抄底 v2"
            className="text-sm px-3 py-2 rounded outline-none"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          />
        </label>

        <label className="flex flex-col gap-1 mb-3">
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>備註（選填）</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="例：測試後發現勝率太低，再調整 RSI 門檻"
            className="text-sm px-3 py-2 rounded outline-none resize-none"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          />
        </label>

        {errMsg && (
          <div className="text-xs mb-3 px-2 py-1 rounded" style={{ color: "var(--color-down)", background: "var(--color-down-subtle)" }}>
            {errMsg}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-2 rounded text-sm transition-opacity"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >取消</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 rounded text-sm font-semibold transition-opacity"
            style={{ background: "var(--color-brand)", color: "#fff", opacity: saving ? 0.6 : 1 }}
          >{saving ? "儲存中..." : "儲存"}</button>
        </div>
      </div>
    </div>
  );
}

// ── P0-4: 我的策略列表 Drawer ────────────────────────────────────────────────

function MyStrategiesDrawer({
  open, onClose, onLoad, refreshKey,
}: {
  open:       boolean;
  onClose:    () => void;
  onLoad:     (s: SavedStrategy) => void;
  refreshKey: number;
}) {
  const [items, setItems]   = useState<SavedStrategy[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listSavedStrategies()
      .then(r => setItems(r.strategies))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, refreshKey]);

  async function handleDelete(id: string) {
    if (!confirm("確定刪除這筆策略？此動作無法復原。")) return;
    try {
      await deleteSavedStrategy(id);
      setItems(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "刪除失敗");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="ml-auto h-full w-full max-w-md flex flex-col"
        style={{ background: "var(--bg-surface)", borderLeft: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-base font-bold" style={{ color: "var(--color-brand)" }}>📁 我的策略</h3>
          <button onClick={onClose} className="text-lg" style={{ color: "var(--text-tertiary)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-center text-xs py-6" style={{ color: "var(--text-tertiary)" }}>載入中...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs py-6" style={{ color: "var(--text-tertiary)" }}>
              尚無已儲存的策略<br />
              <span className="text-[10px]">回測完成後可按右上「💾 儲存策略」</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map(s => (
                <div
                  key={s.id}
                  className="rounded p-3"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{s.name}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                        {s.symbol} · {s.strategy_json.type} · {s.start_date} → {s.end_date}
                      </div>
                    </div>
                    <span className="text-[10px] whitespace-nowrap" style={{ color: "var(--text-tertiary)" }}>
                      {s.created_at.slice(0, 10)}
                    </span>
                  </div>
                  {s.note && (
                    <div className="text-[11px] mt-1.5 mb-1" style={{ color: "var(--text-secondary)" }}>
                      📝 {s.note}
                    </div>
                  )}
                  <div className="flex gap-1.5 mt-2">
                    <button
                      onClick={() => { onLoad(s); onClose(); }}
                      className="flex-1 py-1 rounded text-xs font-medium"
                      style={{ background: "var(--color-brand)", color: "#fff" }}
                    >▶ 重新執行</button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="px-2 py-1 rounded text-xs"
                      style={{ background: "var(--bg-surface)", color: "var(--color-down)", border: "1px solid var(--border)" }}
                      title="刪除"
                    >🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main BacktestPanel ────────────────────────────────────────────────────────

type ResultTab = "stats" | "chart" | "kline" | "trades" | "monthly" | "annual" | "optimize" | "compare" | "scan" | "portfolio" | "walkforward" | "montecarlo" | "tradedist" | "rolling";

interface Props {
  symbol: string;
}

export default function BacktestPanel({ symbol }: Props) {
  const [presets,   setPresets]   = useState<BacktestPreset[]>([]);
  const [result,    setResult]    = useState<BacktestResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("stats");
  const [showTrend, setShowTrend] = useState(false);

  // 本地可編輯的股票代號（預設跟隨 K 線，但使用者可自行輸入）
  const [localSymbol,      setLocalSymbol]      = useState(symbol);
  const [symbolInputValue, setSymbolInputValue] = useState(symbol);

  // 當 K 線切換股票時同步（只在沒有進行中回測時更新）
  useEffect(() => {
    if (!loading) {
      setLocalSymbol(symbol);
      setSymbolInputValue(symbol);
    }
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // P11-36: 手機版設定欄收折（<1024px 預設收起）
  const [configOpen, setConfigOpen] = useState(true);
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) setConfigOpen(false);
  }, []);

  // P8-28: 歷史記錄
  const [history,        setHistory]        = useState<BacktestSnapshot[]>([]);
  const [showHistory,    setShowHistory]    = useState(false);
  const [compareId,      setCompareId]      = useState<string | null>(null);
  const compareSnap = history.find(h => h.id === compareId) ?? null;

  // P0-4: 我的策略書
  const [lastReq,         setLastReq]         = useState<BacktestRequest | null>(null);
  const [saveModalOpen,   setSaveModalOpen]   = useState(false);
  const [drawerOpen,      setDrawerOpen]      = useState(false);
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);
  const [loadedStrategy,  setLoadedStrategy]  = useState<SavedStrategy | null>(null);

  // Load presets + history once
  useEffect(() => {
    getBacktestPresets()
      .then(r => setPresets(r.presets))
      .catch(() => setPresets([]));
    setHistory(loadHistory());
  }, []);

  const handleSubmit = useCallback(async (req: BacktestRequest) => {
    setLoading(true);
    setError(null);
    setLastReq(req);
    try {
      const res = await runBacktest(req);
      setResult(res);
      setResultTab("stats");
      // P8-28: auto-save snapshot
      const snap: BacktestSnapshot = {
        id:           `${Date.now()}`,
        timestamp:    new Date().toISOString(),
        symbol:       req.symbol,
        strategyType: req.strategy.type,
        total_return: res.stats.total_return,
        sharpe:       res.stats.sharpe,
        max_drawdown: res.stats.max_drawdown,
        win_rate:     res.stats.win_rate,
        total_trades: res.stats.total_trades,
        engine_version: res.engine_version ?? 2,
      };
      saveHistory(snap);
      setHistory(loadHistory());
      // P11-36: 手機上跑完自動收起設定欄，讓結果全寬
      if (typeof window !== "undefined" && window.innerWidth < 1024) setConfigOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "回測執行失敗";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // P0-4: 點「重新執行」 → 載入舊策略並自動跑
  const handleLoadStrategy = useCallback((s: SavedStrategy) => {
    setLoadedStrategy(s);
    handleSubmit({
      symbol:          s.symbol,
      strategy:        s.strategy_json,
      start_date:      s.start_date,
      end_date:        s.end_date,
      initial_capital: s.initial_capital,
      stop_loss_pct:   s.stop_loss_pct ?? undefined,
      take_profit_pct: s.take_profit_pct ?? undefined,
    });
  }, [handleSubmit]);

  // P0-4: 儲存策略
  const handleSaveStrategy = useCallback(async (name: string, note: string) => {
    if (!lastReq) throw new Error("尚無回測結果可儲存");
    const payload: SaveStrategyRequest = {
      name,
      note,
      strategy:        lastReq.strategy,
      symbol:          lastReq.symbol,
      start_date:      lastReq.start_date,
      end_date:        lastReq.end_date,
      initial_capital: lastReq.initial_capital ?? 1_000_000,
      stop_loss_pct:   lastReq.stop_loss_pct   ?? undefined,
      take_profit_pct: lastReq.take_profit_pct ?? undefined,
    };
    await saveStrategy(payload);
    setSavedRefreshKey(k => k + 1);
  }, [lastReq]);

  const defaultSaveName = lastReq
    ? `${lastReq.symbol} · ${lastReq.strategy.type} · ${new Date().toISOString().slice(5, 10)}`
    : "";

  const activeGroup = TAB_GROUPS.find(g => g.tabs.some(t => t.id === resultTab)) ?? TAB_GROUPS[0];

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0 overflow-hidden">
      {/* ── Left: Config（P11-36：<lg 可收折） ── */}
      <div
        className={`${configOpen ? "" : "hidden"} lg:block shrink-0 overflow-y-auto p-4`}
        style={{
          width: "clamp(260px, 28%, 320px)",
          borderRight: "1px solid var(--border)",
          background:  "var(--bg-surface)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>📊 回測設定</div>
          <button
            onClick={() => setShowHistory(v => !v)}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{
              background: showHistory ? "rgba(139,92,246,0.15)" : "var(--bg-elevated)",
              color:      showHistory ? "#8b5cf6" : "var(--text-tertiary)",
              border:     `1px solid ${showHistory ? "rgba(139,92,246,0.4)" : "var(--border)"}`,
            }}
          >
            📜 歷史{history.length > 0 ? ` (${history.length})` : ""}
          </button>
        </div>

        {/* 股票代號輸入 */}
        <div className="flex items-center gap-2 mb-4">
          <label className="text-[11px] shrink-0" style={{ color: "var(--text-tertiary)" }}>股票代號</label>
          <input
            value={symbolInputValue}
            onChange={e => setSymbolInputValue(e.target.value.toUpperCase())}
            onBlur={() => setLocalSymbol(symbolInputValue.trim() || symbol)}
            onKeyDown={e => { if (e.key === "Enter") setLocalSymbol(symbolInputValue.trim() || symbol); }}
            placeholder={symbol}
            className="flex-1 text-xs px-2 py-1 rounded outline-none font-mono"
            style={{
              background: "var(--bg-elevated)",
              border:     "1px solid var(--border)",
              color:      "var(--text-primary)",
            }}
          />
        </div>

        {showHistory && (
          <div className="mb-4 rounded-xl p-3" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
            <HistoryPanel
              current={result?.stats ?? ({} as BacktestStats)}
              history={history}
              onSelectCompare={id => setCompareId(id)}
              compareId={compareId}
            />
          </div>
        )}
        {presets.length > 0 ? (
          <StrategyConfig
            presets={presets}
            symbol={localSymbol}
            onSubmit={handleSubmit}
            loading={loading}
          />
        ) : (
          <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>載入策略中...</div>
        )}
      </div>

      {/* ── Right: Results ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* P11-34: 兩層式 Tab 導航 + P0-4 toolbar */}
        <div className="shrink-0 border-b" style={{ borderColor: "var(--border)" }}>
          {/* 第一層：分組 */}
          <div className="flex items-center">
            <div className="flex flex-1 min-w-0 overflow-x-auto">
              {TAB_GROUPS.map(g => {
                const groupEnabled = !!result || g.tabs.some(t => t.alwaysEnabled);
                const isActive     = g.id === activeGroup.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => {
                      const first = g.tabs.find(t => result || t.alwaysEnabled) ?? g.tabs[0];
                      setResultTab(first.id);
                    }}
                    disabled={!groupEnabled}
                    className="px-4 py-2 text-xs font-semibold transition-colors shrink-0"
                    style={{
                      color:        isActive ? "var(--color-brand)" : "var(--text-tertiary)",
                      borderBottom: isActive ? "2px solid var(--color-brand)" : "2px solid transparent",
                      opacity:      groupEnabled ? 1 : 0.4,
                    }}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
            <div className="shrink-0 flex items-center gap-1 px-2">
              <button
                onClick={() => setConfigOpen(v => !v)}
                className="lg:hidden text-[11px] px-2 py-1 rounded transition-colors"
                style={{
                  background: configOpen ? "rgba(59,130,246,0.15)" : "var(--bg-elevated)",
                  color:      configOpen ? "var(--color-brand)" : "var(--text-secondary)",
                  border:     "1px solid var(--border)",
                }}
                title="顯示/隱藏回測設定"
              >⚙ 設定</button>
              <button
                onClick={() => setSaveModalOpen(true)}
                disabled={!result || !lastReq}
                className="text-[11px] px-2 py-1 rounded transition-colors disabled:opacity-40"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                title="儲存目前策略設定"
              >💾 儲存</button>
              <button
                onClick={() => setDrawerOpen(true)}
                className="text-[11px] px-2 py-1 rounded transition-colors"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                title="開啟我的策略列表"
              >📁 我的策略</button>
            </div>
          </div>
          {/* 第二層：組內 tab */}
          <div className="flex overflow-x-auto px-2" style={{ background: "var(--bg-elevated)" }}>
            {activeGroup.tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setResultTab(t.id)}
                disabled={!result && !t.alwaysEnabled}
                className="px-3 py-1.5 text-[11px] font-medium transition-colors shrink-0"
                style={{
                  color:        resultTab === t.id ? "var(--color-brand)" : "var(--text-tertiary)",
                  borderBottom: resultTab === t.id ? "2px solid var(--color-brand)" : "2px solid transparent",
                  opacity:      (result || t.alwaysEnabled) ? 1 : 0.4,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loadedStrategy && (
          <div className="shrink-0 px-3 py-1.5 text-[11px] flex items-center justify-between"
               style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
            <span>📂 已載入策略：<b style={{ color: "var(--color-brand)" }}>{loadedStrategy.name}</b></span>
            <button onClick={() => setLoadedStrategy(null)} className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>清除</button>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {/* Optimize tab */}
          {resultTab === "optimize" && (
            <div className="-m-4 h-[calc(100%+2rem)]">
              <OptimizePanel symbol={localSymbol} presets={presets} lastReq={lastReq} />
            </div>
          )}

          {/* Compare tab */}
          {resultTab === "compare" && (
            <div className="-m-4 h-[calc(100%+2rem)]">
              <ComparePanel symbol={localSymbol} presets={presets} lastReq={lastReq} />
            </div>
          )}

          {/* Scan tab */}
          {resultTab === "scan" && (
            <div className="-m-4 h-[calc(100%+2rem)] p-4 overflow-y-auto">
              <ScanPanel
                presets={presets}
                onSelectSymbol={sym => {
                  /* Jump user to kline tab with the selected symbol */
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("backtest:selectSymbol", { detail: sym }));
                  }
                }}
              />
            </div>
          )}

          {/* Portfolio tab */}
          {resultTab === "portfolio" && (
            <div className="-m-4 h-[calc(100%+2rem)] p-4 overflow-y-auto">
              <PortfolioPanel presets={presets} symbol={localSymbol} />
            </div>
          )}

          {/* Walk-Forward tab */}
          {resultTab === "walkforward" && (
            <div className="-m-4 h-[calc(100%+2rem)] p-4 overflow-y-auto">
              <WalkForwardPanel presets={presets} symbol={localSymbol} />
            </div>
          )}

          {/* Monte Carlo tab */}
          {resultTab === "montecarlo" && result && (
            <MonteCarloPanel
              trades={result.trades}
              initialCapital={lastReq?.initial_capital ?? 1_000_000}
            />
          )}

          {/* Trade Distribution tab */}
          {resultTab === "tradedist" && result && (
            <TradeDistPanel
              trades={result.trades}
              monthlyReturns={result.monthly_returns}
            />
          )}

          {/* Rolling Performance tab */}
          {resultTab === "rolling" && result && (
            <RollingPanel equityCurve={result.equity_curve} />
          )}

          {/* Initial state */}
          {resultTab !== "optimize" && resultTab !== "scan" && resultTab !== "portfolio" && resultTab !== "walkforward" && !result && !loading && !error && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center" style={{ color: "var(--text-tertiary)" }}>
              <span className="text-5xl">📈</span>
              <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                選擇策略並設定參數，點擊「執行回測」
              </div>
              <div className="text-xs max-w-xs">
                支援台股（如 2330）與美股（如 AAPL），資料最長 20 年。
                自動計算 Sharpe、Sortino、最大回撤等 11 項指標，並對比大盤表現。
              </div>
            </div>
          )}

          {/* Loading */}
          {resultTab !== "optimize" && loading && (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <div className="animate-spin text-4xl">⏳</div>
              <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                正在下載歷史資料並執行回測...
              </div>
              <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                首次查詢需從 Yahoo Finance 下載資料（約 3-10 秒）
              </div>
            </div>
          )}

          {/* Error */}
          {resultTab !== "optimize" && error && !loading && (
            <div className="rounded-lg p-4" style={{ background: "var(--color-down-subtle)", border: "1px solid var(--color-down)" }}>
              <div className="text-sm font-medium mb-1" style={{ color: "var(--color-down)" }}>回測失敗</div>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{error}</div>
            </div>
          )}

          {/* Results */}
          {resultTab !== "optimize" && result && !loading && (
            <>
              {resultTab === "stats" && (
                <>
                  <ScorecardPanel stats={result.stats} />
                  <DecayDetectionPanel equityCurve={result.equity_curve} trades={result.trades} />
                  <StatsPanel stats={result.stats} symbol={lastReq?.symbol ?? localSymbol} />
                  <KellyCriterionCard
                    stats={result.stats}
                    initialCapital={lastReq?.initial_capital ?? 100000}
                  />
                  <CapitalUtilizationCard
                    trades={result.trades}
                    equityCurve={result.equity_curve}
                  />
                  {/* P8-28: 對比前次 */}
                  {compareSnap && (
                    <div className="rounded-xl p-4" style={{ border: "1px solid rgba(139,92,246,0.4)", background: "rgba(139,92,246,0.05)" }}>
                      <div className="text-xs font-semibold mb-2" style={{ color: "#8b5cf6" }}>
                        🔄 對比前次：{compareSnap.symbol} {compareSnap.timestamp.slice(0, 16).replace("T", " ")}
                      </div>
                      {(compareSnap.engine_version ?? 1) !== (result.engine_version ?? 2) && (
                        <div className="text-[10px] mb-2 px-2 py-1 rounded" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}>
                          ⚠️ 成交模型版本不同（v{compareSnap.engine_version ?? 1} vs v{result.engine_version ?? 2}），數字不可直接比較
                        </div>
                      )}
                      <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th className="text-[10px] pb-1.5" style={{ color: "var(--text-tertiary)", width: 100 }}>指標</th>
                            <th className="text-[10px] pb-1.5 text-right" style={{ color: "var(--text-tertiary)" }}>本次</th>
                            <th className="text-[10px] pb-1.5 text-right" style={{ color: "var(--text-tertiary)" }}>前次</th>
                            <th className="text-[10px] pb-1.5 text-right" style={{ color: "var(--text-tertiary)" }}>差異</th>
                          </tr>
                        </thead>
                        <tbody>
                          <CompareRow label="總報酬"     current={result.stats.total_return} prev={compareSnap.total_return} isPct lowerBetter={false} />
                          <CompareRow label="Sharpe"    current={result.stats.sharpe}       prev={compareSnap.sharpe}       lowerBetter={false} />
                          <CompareRow label="最大回撤"   current={result.stats.max_drawdown} prev={compareSnap.max_drawdown} isPct lowerBetter />
                          <CompareRow label="勝率"       current={result.stats.win_rate}     prev={compareSnap.win_rate}     isPct lowerBetter={false} />
                        </tbody>
                      </table>
                    </div>
                  )}
                  {result.regime_stats && (
                    <RegimeStatsPanel regime={result.regime_stats} />
                  )}
                  <LiveSignalCard symbol={lastReq?.symbol ?? localSymbol} lastReq={lastReq} />
                  <StopRecommendCard trades={result.trades} />
                  <div className="flex justify-end px-1 pb-2">
                    <ExportReportButton result={result} symbol={lastReq?.symbol ?? localSymbol} lastReq={lastReq} />
                  </div>
                </>
              )}

              {resultTab === "chart" && (
                <div className="flex flex-col gap-3 h-full">
                  <div style={{ height: 300 }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                        — 策略淨值　— — 大盤基準　▲ 買入　▼ 賣出
                      </div>
                      <button
                        onClick={() => setShowTrend(v => !v)}
                        className="text-[10px] px-2 py-0.5 rounded transition-colors"
                        style={{
                          background: showTrend ? "rgba(245,158,11,0.15)" : "var(--bg-elevated)",
                          color:      showTrend ? "#f59e0b" : "var(--text-tertiary)",
                          border:     `1px solid ${showTrend ? "rgba(245,158,11,0.4)" : "var(--border)"}`,
                        }}
                      >
                        📐 趨勢線
                      </button>
                    </div>
                    <EquityChart
                      equityCurve={result.equity_curve}
                      benchmarkCurve={result.benchmark_curve}
                      trades={result.trades}
                      showTrend={showTrend}
                    />
                  </div>
                  <div style={{ height: 120 }}>
                    <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>回撤 (%)</div>
                    <DrawdownChart equityCurve={result.equity_curve} />
                  </div>
                </div>
              )}

              {resultTab === "kline" && (() => {
                const ec  = result.equity_curve;
                const sd  = ec[0]?.time              ?? "";
                const ed  = ec[ec.length - 1]?.time  ?? "";
                return (
                  <div className="flex flex-col gap-3 h-full">
                    <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      <span style={{ color: "#3B82F6" }}>▲ 藍 = 買入 (B#)</span>
                      <span className="mx-2">|</span>
                      <span style={{ color: "var(--color-up)" }}>▼ 綠 = 獲利出場</span>
                      <span className="mx-2">|</span>
                      <span style={{ color: "var(--color-down)" }}>▼ 紅 = 虧損出場</span>
                      <span className="ml-3" style={{ color: "var(--text-tertiary)" }}>
                        台股：紅K = 上漲、綠K = 下跌
                      </span>
                    </div>
                    <div style={{ height: 360 }}>
                      <TradesKlineChart
                        symbol={lastReq?.symbol ?? localSymbol}
                        trades={result.trades}
                        startDate={sd}
                        endDate={ed}
                      />
                    </div>
                    <div>
                      <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>
                        進出場對照表（編號與 K 線標記對應）
                      </div>
                      <TradesMiniList trades={result.trades} />
                    </div>
                  </div>
                );
              })()}

              {resultTab === "trades" && (
                <div className="flex flex-col gap-4">
                  <TradeList trades={result.trades} />
                  <TradeTimingPanel trades={result.trades} />
                </div>
              )}

              {resultTab === "monthly" && (
                <MonthlyHeatmap data={result.monthly_returns} />
              )}

              {resultTab === "annual" && (
                <div className="p-1">
                  <AnnualReturnsChart
                    monthlyReturns={result.monthly_returns}
                    benchmarkCurve={result.benchmark_curve}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* P0-4: 儲存策略 Modal + 我的策略 Drawer */}
      <SaveStrategyModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSave={handleSaveStrategy}
        defaultName={defaultSaveName}
      />
      <MyStrategiesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLoad={handleLoadStrategy}
        refreshKey={savedRefreshKey}
      />
    </div>
  );
}
