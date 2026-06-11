"use client";

import { useState, useEffect, useRef } from "react";
import {
  createChart, LineSeries, LineStyle,
  type IChartApi,
} from "lightweight-charts";
import type { BacktestPreset, OptimizeRequest } from "@/lib/api";
import { getOptimizePresets } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WFWindow {
  window:      number;
  is_start:    string;
  is_end:      string;
  oos_start:   string;
  oos_end:     string;
  best_params: Record<string, number> | null;
  is_stats:    Record<string, number | null> | null;
  oos_stats:   Record<string, number | null> | null;
  oos_equity:  Array<{ time: string; value: number }>;
  efficiency:  number | null;
}

interface WFResult {
  windows:           WFWindow[];
  n_windows_valid:   number;
  avg_is_sharpe:     number | null;
  avg_oos_sharpe:    number | null;
  avg_is_return:     number | null;
  avg_oos_return:    number | null;
  avg_efficiency:    number | null;
  interpretation:    string;
  oos_equity_curve:  Array<{ time: string; value: number }>;
  sort_by:           string;
}

// ── OOS equity chart ──────────────────────────────────────────────────────────

function OOSChart({ curve }: { curve: Array<{ time: string; value: number }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !curve.length) return;
    const chart = createChart(ref.current, {
      layout:    { background: { color: "transparent" }, textColor: "var(--text-secondary, #888)" },
      grid:      { vertLines: { visible: false }, horzLines: { color: "#333", style: LineStyle.Dotted } },
      timeScale: { borderColor: "transparent" },
      rightPriceScale: { borderColor: "transparent" },
      handleScroll: true,
      handleScale: true,
    });
    const s = chart.addSeries(LineSeries, {
      color: "#3b82f6", lineWidth: 2, title: "OOS拼接曲線",
    });
    // Baseline at 100
    const base = chart.addSeries(LineSeries, {
      color: "#666", lineWidth: 1, lineStyle: LineStyle.Dashed,
    });
    s.setData(curve.map(p => ({ time: p.time as import("lightweight-charts").Time, value: p.value })));
    base.setData([
      { time: curve[0].time as import("lightweight-charts").Time, value: 100 },
      { time: curve[curve.length - 1].time as import("lightweight-charts").Time, value: 100 },
    ]);
    chart.timeScale().fitContent();
    const obs = new ResizeObserver(() => {
      if (ref.current) chart.resize(ref.current.clientWidth, ref.current.clientHeight);
    });
    obs.observe(ref.current);
    return () => { obs.disconnect(); chart.remove(); };
  }, [curve]);
  return <div ref={ref} className="w-full h-52" />;
}

// ── Efficiency badge ──────────────────────────────────────────────────────────

function EffBadge({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const cls = v >= 0.7 ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
    : v >= 0.5 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"
    : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400";
  return <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${cls}`}>{v.toFixed(2)}</span>;
}

// ── Param Range Editor ────────────────────────────────────────────────────────

function ParamRangeEditor({
  label, paramKey, value, onChange,
}: {
  label: string;
  paramKey: string;
  value: string;
  onChange: (k: string, v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="text-muted-foreground">{label} <span className="text-[10px]">(逗號分隔)</span></span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(paramKey, e.target.value)}
        placeholder="如：5, 10, 15, 20"
        className="px-2 py-1 rounded border border-border bg-background font-mono"
      />
    </label>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  symbol:  string;
  presets: BacktestPreset[];
}

const PRESET_GRIDS_LOCAL: Record<string, Record<string, number[]>> = {
  ma_cross:      { fast:   [3, 5, 8, 10],     slow:   [15, 20, 30, 50]    },
  rsi_threshold: { period: [7, 10, 14, 21],   oversold: [20, 25, 30, 35]  },
  macd:          { fast:   [8, 10, 12, 15],   slow:   [20, 24, 26, 30], signal: [7, 9, 11] },
  kd:            { k_period: [5, 7, 9, 12],   buy_zone: [15, 20, 25, 30]  },
  boll_bounce:   { period: [10, 15, 20, 25],  std:    [1.5, 2.0, 2.5]     },
};

const SORT_OPTIONS = [
  { value: "sharpe",       label: "Sharpe Ratio" },
  { value: "total_return", label: "總報酬" },
  { value: "calmar",       label: "Calmar Ratio" },
  { value: "win_rate",     label: "勝率" },
];

const STAT_KEYS: { key: string; label: string; fmt: (v: number) => string }[] = [
  { key: "total_return", label: "總報酬",   fmt: v => `${(v*100).toFixed(1)}%` },
  { key: "sharpe",       label: "Sharpe",   fmt: v => v.toFixed(2) },
  { key: "max_drawdown", label: "MaxDD",    fmt: v => `${(v*100).toFixed(1)}%` },
  { key: "win_rate",     label: "勝率",     fmt: v => `${v.toFixed(1)}%`       },
  { key: "total_trades", label: "交易次數", fmt: v => String(Math.round(v))    },
];

export default function WalkForwardPanel({ symbol, presets }: Props) {
  const [selectedPreset, setSelectedPreset] = useState(presets[0]?.id ?? "ma_cross");
  const [paramRanges,    setParamRanges]    = useState<Record<string, string>>({});
  const [sortBy,         setSortBy]         = useState("sharpe");
  const [nWindows,       setNWindows]       = useState(5);
  const [isPct,          setIsPct]          = useState(0.67);
  const [startDate,      setStartDate]      = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 5); return d.toISOString().slice(0, 10);
  });
  const [endDate,        setEndDate]        = useState(() => new Date().toISOString().slice(0, 10));
  const [capital,        setCapital]        = useState("1000000");
  const [loading,        setLoading]        = useState(false);
  const [result,         setResult]         = useState<WFResult | null>(null);
  const [error,          setError]          = useState<string | null>(null);
  const [expanded,       setExpanded]       = useState<number | null>(null);

  // Load default param ranges when preset changes
  useEffect(() => {
    const defaults = PRESET_GRIDS_LOCAL[selectedPreset] ?? {};
    setParamRanges(
      Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v.join(", ")]))
    );
  }, [selectedPreset]);

  function parseRanges(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(paramRanges)) {
      const nums = v.split(/[\s,，]+/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      if (nums.length > 0) out[k] = nums;
    }
    return out;
  }

  async function handleRun() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/backtest/walk-forward`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          symbol:          symbol.toUpperCase(),
          strategy_type:   selectedPreset,
          param_ranges:    parseRanges(),
          sort_by:         sortBy,
          start_date:      startDate,
          end_date:        endDate,
          n_windows:       nWindows,
          is_pct:          isPct,
          initial_capital: parseFloat(capital) || 1_000_000,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? `HTTP ${res.status}`);
      setResult(data as WFResult);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const preset = presets.find(p => p.id === selectedPreset);
  const defaultGrid = PRESET_GRIDS_LOCAL[selectedPreset] ?? {};

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {/* ── Config ── */}
      <div className="space-y-3 text-xs">
        <p className="font-semibold uppercase tracking-wide text-muted-foreground">Walk-Forward 設定</p>

        {/* Strategy */}
        <div>
          <p className="text-muted-foreground mb-1">策略</p>
          <div className="flex flex-wrap gap-1">
            {presets.filter(p => !["custom","dsl"].includes(p.id)).map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPreset(p.id)}
                className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                  selectedPreset === p.id
                    ? "border-primary bg-primary text-white"
                    : "border-border hover:border-primary/60"
                }`}
              >
                {p.icon} {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Param ranges */}
        <div className="space-y-2">
          <p className="text-muted-foreground">參數掃描範圍</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(defaultGrid).map(([k]) => {
              const pmLabel = preset?.params.find(p => p.key === k)?.label ?? k;
              return (
                <ParamRangeEditor
                  key={k}
                  label={pmLabel}
                  paramKey={k}
                  value={paramRanges[k] ?? ""}
                  onChange={(pk, v) => setParamRanges(prev => ({ ...prev, [pk]: v }))}
                />
              );
            })}
          </div>
        </div>

        {/* Walk-forward settings */}
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">窗口數</span>
            <select value={nWindows} onChange={e => setNWindows(+e.target.value)}
              className="px-2 py-1 rounded border border-border bg-background">
              {[3, 5, 8, 10].map(n => <option key={n} value={n}>{n} 個</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">IS 比例</span>
            <select value={isPct} onChange={e => setIsPct(+e.target.value)}
              className="px-2 py-1 rounded border border-border bg-background">
              {[0.5, 0.67, 0.75].map(v => <option key={v} value={v}>{Math.round(v*100)}%</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">排序指標</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="px-2 py-1 rounded border border-border bg-background">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-3 gap-2">
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
            <span className="text-muted-foreground">資金</span>
            <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
              className="px-2 py-1 rounded border border-border bg-background" />
          </label>
        </div>
      </div>

      <button
        onClick={handleRun}
        disabled={loading}
        className="w-full py-2 rounded-md text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "分析中（各窗口最佳化中…）" : "🔄 執行 Walk-Forward 分析"}
      </button>

      {error && (
        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-md p-2">⚠ {error}</div>
      )}

      {/* ── Results ── */}
      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-md border border-border p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <p className="font-semibold">整體評估</p>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                result.interpretation.startsWith("✅") ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : result.interpretation.startsWith("⚠") ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
              }`}>{result.interpretation}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "平均效率比",   value: <EffBadge v={result.avg_efficiency} /> },
                { label: "IS 平均 Sharpe", value: result.avg_is_sharpe?.toFixed(2) ?? "—" },
                { label: "OOS 平均 Sharpe",value: result.avg_oos_sharpe?.toFixed(2) ?? "—" },
                { label: "IS 平均報酬",  value: result.avg_is_return  != null ? `${(result.avg_is_return*100).toFixed(1)}%`  : "—" },
                { label: "OOS 平均報酬", value: result.avg_oos_return != null ? `${(result.avg_oos_return*100).toFixed(1)}%` : "—" },
                { label: "有效窗口",     value: `${result.n_windows_valid} / ${result.windows.length}` },
              ].map(s => (
                <div key={s.label} className="rounded border border-border p-1.5">
                  <p className="text-muted-foreground mb-0.5">{s.label}</p>
                  <p className="font-semibold">{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* OOS equity chart */}
          {result.oos_equity_curve.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">OOS 拼接資金曲線（base 100）</p>
              <OOSChart curve={result.oos_equity_curve} />
            </div>
          )}

          {/* Window breakdown */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">各窗口詳情</p>
            <div className="space-y-1">
              {result.windows.map(w => (
                <div key={w.window} className="rounded-md border border-border overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-muted/30"
                    onClick={() => setExpanded(prev => prev === w.window ? null : w.window)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium">窗口 {w.window}</span>
                      <span className="text-muted-foreground">
                        IS: {w.is_start} → {w.is_end} &nbsp;|&nbsp; OOS: {w.oos_start} → {w.oos_end}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {w.efficiency != null && (
                        <span className="text-[10px] text-muted-foreground">效率</span>
                      )}
                      <EffBadge v={w.efficiency} />
                      <span className="text-muted-foreground">{expanded === w.window ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {expanded === w.window && (
                    <div className="px-3 pb-3 pt-0 text-xs space-y-2 border-t border-border">
                      {/* Best params */}
                      {w.best_params && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-muted-foreground">最佳參數：</span>
                          {Object.entries(w.best_params).map(([k, v]) => (
                            <code key={k} className="bg-muted px-1.5 rounded font-mono">{k}={v}</code>
                          ))}
                        </div>
                      )}

                      {/* IS vs OOS stats table */}
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left py-1">指標</th>
                            <th className="text-right py-1">IS</th>
                            <th className="text-right py-1">OOS</th>
                            <th className="text-right py-1">OOS/IS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {STAT_KEYS.map(sk => {
                            const iv = w.is_stats?.[sk.key];
                            const ov = w.oos_stats?.[sk.key];
                            const ratio = iv != null && ov != null && iv !== 0
                              ? (ov / iv).toFixed(2) : "—";
                            return (
                              <tr key={sk.key} className="border-t border-border/40">
                                <td className="py-1 text-muted-foreground">{sk.label}</td>
                                <td className="text-right py-1 tabular-nums font-mono">
                                  {iv != null ? sk.fmt(iv) : "—"}
                                </td>
                                <td className={`text-right py-1 tabular-nums font-mono ${
                                  ov != null && iv != null && ov >= iv ? "text-green-600 dark:text-green-400" : ""
                                }`}>
                                  {ov != null ? sk.fmt(ov) : "—"}
                                </td>
                                <td className="text-right py-1 tabular-nums text-muted-foreground">{ratio}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Explanation */}
          <div className="text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 space-y-0.5">
            <p className="font-semibold text-xs text-foreground/70 mb-1">如何解讀效率比</p>
            <p>🟢 ≥ 0.70：策略在樣本外表現良好，過擬合風險低</p>
            <p>🟡 0.50–0.70：可接受，建議擴大歷史區間再確認</p>
            <p>🔴 &lt; 0.50：樣本外嚴重衰減，可能是過擬合或市場環境改變</p>
          </div>
        </div>
      )}
    </div>
  );
}
