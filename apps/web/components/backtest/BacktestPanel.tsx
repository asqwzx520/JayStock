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
import { runBacktest, getBacktestPresets } from "@/lib/api";

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

function TradeList({ trades }: { trades: BacktestTrade[] }) {
  const [sortKey, setSortKey] = useState<keyof BacktestTrade>("entry_date");
  const [sortAsc, setSortAsc] = useState(true);

  function toggleSort(key: keyof BacktestTrade) {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const sorted = [...trades].sort((a, b) => {
    const av = a[sortKey] as number | string;
    const bv = b[sortKey] as number | string;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  const wins   = trades.filter(t => t.pnl > 0).length;
  const losses = trades.length - wins;
  const avgPnl = trades.length ? trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length : 0;

  return (
    <div>
      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-3 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span>共 {trades.length} 筆交易</span>
        <span style={{ color: "var(--color-up)" }}>獲利 {wins} 筆</span>
        <span style={{ color: "var(--color-down)" }}>虧損 {losses} 筆</span>
        <span>平均損益 <span className="num" style={{ color: avgPnl >= 0 ? "var(--color-up)" : "var(--color-down)" }}>{pct(avgPnl)}</span></span>
      </div>

      <div className="overflow-auto max-h-72 rounded" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs" style={{ minWidth: 560 }}>
          <thead style={{ background: "var(--bg-elevated)", position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <TradeTableHeader label="進場日"  k="entry_date"  sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="出場日"  k="exit_date"   sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="進場價"  k="entry_price" sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="出場價"  k="exit_price"  sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="損益"    k="pnl"         sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="損益%"   k="pnl_pct"     sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
              <TradeTableHeader label="持倉天"  k="hold_days"   sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => (
              <tr
                key={i}
                style={{
                  background: t.pnl > 0 ? "var(--color-up-subtle)" : t.pnl < 0 ? "var(--color-down-subtle)" : "transparent",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <td className="px-2 py-1.5 num" style={{ color: "var(--text-secondary)" }}>{t.entry_date}</td>
                <td className="px-2 py-1.5 num" style={{ color: "var(--text-secondary)" }}>{t.exit_date}</td>
                <td className="px-2 py-1.5 num">{t.entry_price.toLocaleString()}</td>
                <td className="px-2 py-1.5 num">{t.exit_price.toLocaleString()}</td>
                <td className="px-2 py-1.5 num" style={{ color: t.pnl >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                  {t.pnl >= 0 ? "+" : ""}{t.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="px-2 py-1.5 num font-medium" style={{ color: t.pnl_pct >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                  {pct(t.pnl_pct)}
                </td>
                <td className="px-2 py-1.5 num">{t.hold_days}</td>
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

function StrategyConfig({ presets, symbol, onSubmit, loading }: ConfigProps) {
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? "ma_cross");
  const [params, setParams]         = useState<Record<string, number>>({});
  const [rangeYears, setRangeYears] = useState(5);
  const [capital, setCapital]       = useState("1000000");
  const [stopLoss, setStopLoss]     = useState("");
  const [takeProfit, setTakeProfit] = useState("");

  const preset = presets.find(p => p.id === selectedId) ?? presets[0];

  // Reset params when preset changes
  useEffect(() => {
    if (!preset) return;
    const defaults: Record<string, number> = {};
    for (const p of preset.params) defaults[p.key] = p.default;
    setParams(defaults);
  }, [selectedId]);   // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit() {
    if (!preset) return;
    const strategy: BacktestStrategyConfig = {
      ...preset.default,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v])),
    };
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

      {/* Dynamic params */}
      {preset && preset.params.length > 0 && (
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

// ── Main BacktestPanel ────────────────────────────────────────────────────────

type ResultTab = "stats" | "chart" | "trades" | "monthly";

interface Props {
  symbol: string;
}

export default function BacktestPanel({ symbol }: Props) {
  const [presets,   setPresets]   = useState<BacktestPreset[]>([]);
  const [result,    setResult]    = useState<BacktestResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("stats");

  // Load presets once
  useEffect(() => {
    getBacktestPresets()
      .then(r => setPresets(r.presets))
      .catch(() => setPresets([]));
  }, []);

  const handleSubmit = useCallback(async (req: BacktestRequest) => {
    setLoading(true);
    setError(null);
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

  const RESULT_TABS: { id: ResultTab; label: string }[] = [
    { id: "stats",   label: "績效摘要" },
    { id: "chart",   label: "資金曲線" },
    { id: "trades",  label: "交易明細" },
    { id: "monthly", label: "月份報酬" },
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
        {/* Result tab bar */}
        <div className="shrink-0 flex border-b" style={{ borderColor: "var(--border)" }}>
          {RESULT_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setResultTab(t.id)}
              disabled={!result}
              className="px-4 py-2 text-xs font-medium transition-colors shrink-0"
              style={{
                color:        resultTab === t.id ? "var(--color-brand)" : "var(--text-tertiary)",
                borderBottom: resultTab === t.id ? "2px solid var(--color-brand)" : "2px solid transparent",
                opacity:      result ? 1 : 0.4,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {/* Initial state */}
          {!result && !loading && !error && (
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
          {loading && (
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
          {error && !loading && (
            <div className="rounded-lg p-4" style={{ background: "var(--color-down-subtle)", border: "1px solid var(--color-down)" }}>
              <div className="text-sm font-medium mb-1" style={{ color: "var(--color-down)" }}>回測失敗</div>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{error}</div>
            </div>
          )}

          {/* Results */}
          {result && !loading && (
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
    </div>
  );
}
