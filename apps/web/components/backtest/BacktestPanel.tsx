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
} from "@/lib/api";
import type { KlineBar, SavedStrategy, SaveStrategyRequest } from "@/lib/api";
import DSLEditor, { type DSLStrategy } from "@/components/backtest/DSLEditor";
import OptimizePanel   from "./OptimizePanel";
import ComparePanel    from "./ComparePanel";
import ScanPanel       from "./ScanPanel";
import PortfolioPanel    from "./PortfolioPanel";
import WalkForwardPanel  from "./WalkForwardPanel";
import MonteCarloPanel   from "./MonteCarloPanel";

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

function EquityChart({
  equityCurve,
  benchmarkCurve,
  trades,
}: {
  equityCurve:    BacktestResult["equity_curve"];
  benchmarkCurve: BacktestResult["benchmark_curve"];
  trades:         BacktestTrade[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

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
  }, [equityCurve, benchmarkCurve, trades]);

  return <div ref={containerRef} className="w-full h-full" />;
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
  signal:        { label: "訊號",   color: "#94a3b8", bg: "rgba(148,163,184,0.15)" },
  stop_loss:     { label: "停損",   color: "#ef4444", bg: "rgba(239,68,68,0.15)"   },
  take_profit:   { label: "停利",   color: "#10b981", bg: "rgba(16,185,129,0.15)"  },
  end_of_period: { label: "期末強平", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
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

type ResultTab = "stats" | "chart" | "kline" | "trades" | "monthly" | "optimize" | "compare" | "scan" | "portfolio" | "walkforward" | "montecarlo";

interface Props {
  symbol: string;
}

export default function BacktestPanel({ symbol }: Props) {
  const [presets,   setPresets]   = useState<BacktestPreset[]>([]);
  const [result,    setResult]    = useState<BacktestResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("stats");

  // P0-4: 我的策略書
  const [lastReq,         setLastReq]         = useState<BacktestRequest | null>(null);
  const [saveModalOpen,   setSaveModalOpen]   = useState(false);
  const [drawerOpen,      setDrawerOpen]      = useState(false);
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);
  const [loadedStrategy,  setLoadedStrategy]  = useState<SavedStrategy | null>(null);

  // Load presets once
  useEffect(() => {
    getBacktestPresets()
      .then(r => setPresets(r.presets))
      .catch(() => setPresets([]));
  }, []);

  const handleSubmit = useCallback(async (req: BacktestRequest) => {
    setLoading(true);
    setError(null);
    setLastReq(req);
    try {
      const res = await runBacktest(req);
      setResult(res);
      setResultTab("stats");
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

  const RESULT_TABS: { id: ResultTab; label: string; alwaysEnabled?: boolean }[] = [
    { id: "stats",    label: "績效摘要" },
    { id: "chart",    label: "資金曲線" },
    { id: "kline",    label: "K線標記" },
    { id: "trades",   label: "交易明細" },
    { id: "monthly",  label: "月份報酬" },
    { id: "optimize",  label: "🔍 最佳化", alwaysEnabled: true },
    { id: "compare",   label: "⚖️ 比較",   alwaysEnabled: true },
    { id: "scan",        label: "🔭 掃描",      alwaysEnabled: true },
    { id: "portfolio",   label: "📦 組合",      alwaysEnabled: true },
    { id: "walkforward", label: "🔄 Walk-Fwd",   alwaysEnabled: true },
    { id: "montecarlo",  label: "🎲 Monte Carlo" },
  ];

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0 overflow-hidden">
      {/* ── Left: Config ── */}
      <div
        className="shrink-0 overflow-y-auto p-4"
        style={{
          width: "clamp(260px, 28%, 320px)",
          borderRight: "1px solid var(--border)",
          background:  "var(--bg-surface)",
        }}
      >
        <div className="text-sm font-bold mb-4" style={{ color: "var(--color-brand)" }}>
          📊 回測設定 — {symbol}
        </div>
        {presets.length > 0 ? (
          <StrategyConfig
            presets={presets}
            symbol={symbol}
            onSubmit={handleSubmit}
            loading={loading}
          />
        ) : (
          <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>載入策略中...</div>
        )}
      </div>

      {/* ── Right: Results ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Result tab bar + P0-4 toolbar */}
        <div className="shrink-0 flex items-center border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-1 min-w-0 overflow-x-auto">
            {RESULT_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setResultTab(t.id)}
                disabled={!result && !t.alwaysEnabled}
                className="px-4 py-2 text-xs font-medium transition-colors shrink-0"
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
          <div className="shrink-0 flex items-center gap-1 px-2">
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
              <OptimizePanel symbol={symbol} presets={presets} lastReq={lastReq} />
            </div>
          )}

          {/* Compare tab */}
          {resultTab === "compare" && (
            <div className="-m-4 h-[calc(100%+2rem)]">
              <ComparePanel symbol={symbol} presets={presets} lastReq={lastReq} />
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
              <PortfolioPanel presets={presets} symbol={symbol} />
            </div>
          )}

          {/* Walk-Forward tab */}
          {resultTab === "walkforward" && (
            <div className="-m-4 h-[calc(100%+2rem)] p-4 overflow-y-auto">
              <WalkForwardPanel presets={presets} symbol={symbol} />
            </div>
          )}

          {/* Monte Carlo tab */}
          {resultTab === "montecarlo" && result && (
            <MonteCarloPanel
              trades={result.trades}
              initialCapital={lastReq?.initial_capital ?? 1_000_000}
            />
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
                <StatsPanel stats={result.stats} symbol={symbol} />
              )}

              {resultTab === "chart" && (
                <div className="flex flex-col gap-3 h-full">
                  <div style={{ height: 300 }}>
                    <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>
                      — 策略淨值　— — 大盤基準　▲ 買入　▼ 賣出
                    </div>
                    <EquityChart
                      equityCurve={result.equity_curve}
                      benchmarkCurve={result.benchmark_curve}
                      trades={result.trades}
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
                        symbol={symbol}
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
                <TradeList trades={result.trades} />
              )}

              {resultTab === "monthly" && (
                <MonthlyHeatmap data={result.monthly_returns} />
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
