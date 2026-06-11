"use client";

import { useState, useCallback } from "react";
import {
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { BacktestPreset, BacktestStrategyConfig } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// ── Colors ────────────────────────────────────────────────────────────────────

const SLOT_COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#84cc16"];

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlotConfig {
  id:       number;
  symbol:   string;
  presetId: string;
  params:   Record<string, number>;
  weight:   number;   // raw weight (will be normalised)
}

interface SlotResult {
  symbol:           string;
  weight:           number;
  contribution_pct: number;
  stats: {
    total_return:  number;
    cagr:          number;
    sharpe:        number;
    max_drawdown:  number;
    win_rate:      number;
    profit_factor: number;
    total_trades:  number;
  };
}

interface PortfolioStats {
  total_return: number;
  cagr:         number;
  max_drawdown: number;
  final_equity: number;
  slot_count:   number;
}

interface PortfolioResult {
  stats:            PortfolioStats;
  equity_curve:     Array<{ time: string; value: number; drawdown: number }>;
  slot_results:     SlotResult[];
  initial_capital:  number;
  per_symbol_curve: Record<string, Array<{ time: string; value: number }>>;
}

// ── Overlaid equity chart ─────────────────────────────────────────────────────

function PortfolioChart({ result }: { result: PortfolioResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout:     { background: { color: "transparent" }, textColor: "var(--text-secondary, #888)" },
      grid:       { vertLines: { visible: false }, horzLines: { color: "#333", style: LineStyle.Dotted } },
      timeScale:  { borderColor: "transparent" },
      rightPriceScale: { borderColor: "transparent" },
      handleScroll: true,
      handleScale:  true,
    });
    chartRef.current = chart;

    // Portfolio equity line (thick, blue)
    const portSeries = chart.addSeries(LineSeries, {
      color:     "#3b82f6",
      lineWidth: 2,
      title:     "組合",
    });
    portSeries.setData(
      result.equity_curve.map(p => ({ time: p.time as import("lightweight-charts").Time, value: p.value }))
    );

    // Per-symbol lines (thin, color-coded)
    Object.entries(result.per_symbol_curve).forEach(([sym, curve], i) => {
      const s = chart.addSeries(LineSeries, {
        color:     SLOT_COLORS[(i + 1) % SLOT_COLORS.length],
        lineWidth: 1,
        title:     sym,
      });
      s.setData(curve.map(p => ({ time: p.time as import("lightweight-charts").Time, value: p.value })));
    });

    chart.timeScale().fitContent();

    const obs = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    });
    if (containerRef.current) obs.observe(containerRef.current);

    return () => { obs.disconnect(); chart.remove(); };
  }, [result]);

  return <div ref={containerRef} className="w-full h-64" />;
}

// ── Slot editor row ───────────────────────────────────────────────────────────

function SlotRow({
  slot, presets, totalWeight,
  onChange, onRemove, color,
}: {
  slot:        SlotConfig;
  presets:     BacktestPreset[];
  totalWeight: number;
  onChange:    (updated: SlotConfig) => void;
  onRemove:    () => void;
  color:       string;
}) {
  const preset = presets.find(p => p.id === slot.presetId) ?? presets[0];
  const pct    = totalWeight > 0 ? ((slot.weight / totalWeight) * 100).toFixed(1) : "—";

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-xs" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
      <div className="flex items-center gap-2">
        {/* Symbol */}
        <input
          type="text"
          value={slot.symbol}
          onChange={e => onChange({ ...slot, symbol: e.target.value.toUpperCase() })}
          placeholder="股票代號"
          className="w-20 px-2 py-1 rounded border border-border bg-background font-mono uppercase"
        />

        {/* Strategy */}
        <select
          value={slot.presetId}
          onChange={e => onChange({ ...slot, presetId: e.target.value, params: {} })}
          className="flex-1 px-2 py-1 rounded border border-border bg-background"
        >
          {presets.filter(p => p.id !== "dsl").map(p => (
            <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
          ))}
        </select>

        {/* Weight */}
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="range" min={1} max={10} step={0.5}
            value={slot.weight}
            onChange={e => onChange({ ...slot, weight: parseFloat(e.target.value) })}
            className="w-20"
          />
          <span className="w-12 text-right tabular-nums text-muted-foreground">
            {pct}%
          </span>
        </div>

        <button onClick={onRemove} className="text-muted-foreground hover:text-red-500 shrink-0">✕</button>
      </div>

      {/* Preset params (compact) */}
      {preset && preset.params.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-1">
          {preset.params.map(pm => (
            <label key={pm.key} className="flex items-center gap-1">
              <span className="text-muted-foreground">{pm.label}</span>
              <input
                type="number" min={pm.min} max={pm.max}
                step={pm.type === "float" ? 0.1 : 1}
                value={slot.params[pm.key] ?? pm.default}
                onChange={e => onChange({ ...slot, params: { ...slot.params, [pm.key]: parseFloat(e.target.value) || pm.default }})}
                className="w-16 px-1.5 py-0.5 rounded border border-border bg-background"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stats row helper ──────────────────────────────────────────────────────────

const STAT_ROWS: { key: string; label: string; fmt: (v: number | undefined) => string }[] = [
  { key: "total_return",  label: "總報酬",   fmt: v => v == null ? "—" : `${(v*100).toFixed(1)}%` },
  { key: "cagr",          label: "年化報酬", fmt: v => v == null ? "—" : `${(v*100).toFixed(1)}%` },
  { key: "sharpe",        label: "Sharpe",   fmt: v => v == null ? "—" : (v as number).toFixed(2) },
  { key: "max_drawdown",  label: "MaxDD",    fmt: v => v == null ? "—" : `${(v*100).toFixed(1)}%` },
  { key: "win_rate",      label: "勝率",     fmt: v => v == null ? "—" : `${(v as number).toFixed(1)}%` },
  { key: "profit_factor", label: "盈虧比",   fmt: v => v == null ? "—" : (v as number).toFixed(2) },
  { key: "total_trades",  label: "交易次數", fmt: v => v == null ? "—" : String(Math.round(v as number)) },
];

// ── Main PortfolioPanel ───────────────────────────────────────────────────────

interface PortfolioPanelProps {
  presets: BacktestPreset[];
  symbol?: string;
}

let _nextId = 1;

export default function PortfolioPanel({ presets, symbol }: PortfolioPanelProps) {
  const [slots, setSlots] = useState<SlotConfig[]>(() => [
    { id: _nextId++, symbol: symbol ?? "2330", presetId: presets[0]?.id ?? "ma_cross", params: {}, weight: 1 },
    { id: _nextId++, symbol: "0050",            presetId: presets[0]?.id ?? "ma_cross", params: {}, weight: 1 },
  ]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 3); return d.toISOString().slice(0, 10);
  });
  const [endDate,   setEndDate]   = useState(() => new Date().toISOString().slice(0, 10));
  const [capital,   setCapital]   = useState("1000000");
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState<PortfolioResult | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const totalWeight = slots.reduce((s, sl) => s + sl.weight, 0);

  const addSlot = useCallback(() => {
    if (slots.length >= 8) return;
    setSlots(prev => [...prev, {
      id: _nextId++,
      symbol:   "",
      presetId: presets[0]?.id ?? "ma_cross",
      params:   {},
      weight:   1,
    }]);
  }, [slots.length, presets]);

  const removeSlot = useCallback((id: number) => {
    setSlots(prev => prev.filter(s => s.id !== id));
  }, []);

  const updateSlot = useCallback((updated: SlotConfig) => {
    setSlots(prev => prev.map(s => s.id === updated.id ? updated : s));
  }, []);

  function buildRequest() {
    return {
      slots: slots.map(sl => {
        const preset = presets.find(p => p.id === sl.presetId);
        const strategy: BacktestStrategyConfig = {
          ...(preset?.default ?? { type: sl.presetId }),
          ...sl.params,
        };
        return {
          symbol:          sl.symbol.trim().toUpperCase(),
          strategy,
          start_date:      startDate,
          end_date:        endDate,
          weight:          sl.weight,
          initial_capital: parseFloat(capital) || 1_000_000,
        };
      }).filter(s => s.symbol),
    };
  }

  async function handleRun() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/backtest/portfolio`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(buildRequest()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? `HTTP ${res.status}`);
      setResult(data as PortfolioResult);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {/* ── Slot editors ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">持倉設定</p>
        {slots.map((sl, i) => (
          <SlotRow
            key={sl.id}
            slot={sl}
            presets={presets}
            totalWeight={totalWeight}
            onChange={updateSlot}
            onRemove={() => removeSlot(sl.id)}
            color={SLOT_COLORS[i % SLOT_COLORS.length]}
          />
        ))}
        {slots.length < 8 && (
          <button
            onClick={addSlot}
            className="w-full py-1.5 text-xs rounded-md border border-dashed border-border hover:border-primary hover:text-primary transition-colors"
          >
            + 新增持倉槽（{slots.length}/8）
          </button>
        )}
      </div>

      {/* ── Date + capital ── */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">開始日</span>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="px-2 py-1 rounded border border-border bg-background" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">結束日</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="px-2 py-1 rounded border border-border bg-background" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">總資金</span>
          <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
            className="px-2 py-1 rounded border border-border bg-background" />
        </label>
      </div>

      {/* ── Weight preview ── */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">資金分配（拖動上方滑桿調整）</p>
        <div className="flex rounded-full overflow-hidden h-3">
          {slots.map((sl, i) => (
            <div
              key={sl.id}
              style={{
                width:      `${(sl.weight / totalWeight * 100).toFixed(1)}%`,
                background: SLOT_COLORS[i % SLOT_COLORS.length],
              }}
              title={`${sl.symbol || "?"} ${(sl.weight / totalWeight * 100).toFixed(1)}%`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
          {slots.map((sl, i) => (
            <span key={sl.id} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: SLOT_COLORS[i % SLOT_COLORS.length] }} />
              {sl.symbol || "?"} {(sl.weight / totalWeight * 100).toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      {/* ── Run button ── */}
      <button
        onClick={handleRun}
        disabled={loading || slots.every(s => !s.symbol.trim())}
        className="w-full py-2 rounded-md text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "計算中…" : "📊 執行組合回測"}
      </button>

      {error && (
        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-md p-2">⚠ {error}</div>
      )}

      {/* ── Results ── */}
      {result && (
        <div className="space-y-4">
          {/* Portfolio summary */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { label: "總報酬",   value: `${(result.stats.total_return * 100).toFixed(2)}%` },
              { label: "年化報酬", value: `${(result.stats.cagr * 100).toFixed(2)}%` },
              { label: "MaxDD",    value: `${(result.stats.max_drawdown * 100).toFixed(2)}%` },
            ].map(s => (
              <div key={s.label} className="rounded-md border border-border p-2 text-center">
                <p className="text-muted-foreground">{s.label}</p>
                <p className="font-semibold text-sm">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Equity chart */}
          <PortfolioChart result={result} />

          {/* Per-slot table */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">各股貢獻</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 px-2">股票</th>
                    <th className="text-right py-1.5 px-2">權重</th>
                    <th className="text-right py-1.5 px-2">貢獻</th>
                    {STAT_ROWS.slice(0, 4).map(r => (
                      <th key={r.key} className="text-right py-1.5 px-2">{r.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.slot_results.map((sr, i) => (
                    <tr key={sr.symbol + i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 px-2 flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SLOT_COLORS[i % SLOT_COLORS.length] }} />
                        <span className="font-mono">{sr.symbol}</span>
                      </td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{(sr.weight * 100).toFixed(1)}%</td>
                      <td className={`text-right py-1.5 px-2 tabular-nums font-medium ${sr.contribution_pct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                        {sr.contribution_pct >= 0 ? "+" : ""}{sr.contribution_pct.toFixed(2)}%
                      </td>
                      {STAT_ROWS.slice(0, 4).map(r => {
                        const v = (sr.stats as Record<string, number | undefined>)[r.key];
                        return (
                          <td key={r.key} className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">
                            {r.fmt(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
