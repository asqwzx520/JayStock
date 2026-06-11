"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { BacktestPreset, BacktestStrategyConfig } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScanResult {
  symbol:        string;
  score:         number;
  total_return:  number;
  cagr:          number;
  sharpe:        number;
  max_drawdown:  number;
  win_rate:      number;
  profit_factor: number;
  total_trades:  number;
  avg_hold_days: number;
}

interface ScanJobResponse {
  job_id:   string;
  status:   "pending" | "running" | "done" | "failed";
  progress: number;
  total:    number;
  results:  ScanResult[];
  error:    string | null;
}

// ── Column defs ───────────────────────────────────────────────────────────────

type SortKey = keyof Pick<ScanResult,
  "score" | "total_return" | "cagr" | "sharpe" | "max_drawdown" | "win_rate" | "profit_factor" | "total_trades"
>;

const COLS: { key: SortKey; label: string; fmt: (v: number) => string; good?: "high" | "low" }[] = [
  { key: "score",         label: "綜合得分", fmt: v => v.toFixed(3),         good: "high"  },
  { key: "total_return",  label: "總報酬",   fmt: v => `${(v*100).toFixed(1)}%`, good: "high"  },
  { key: "cagr",          label: "年化",     fmt: v => `${(v*100).toFixed(1)}%`, good: "high"  },
  { key: "sharpe",        label: "Sharpe",   fmt: v => v.toFixed(2),         good: "high"  },
  { key: "max_drawdown",  label: "MaxDD",    fmt: v => `${(v*100).toFixed(1)}%`, good: "low"   },
  { key: "win_rate",      label: "勝率",     fmt: v => `${v.toFixed(1)}%`,   good: "high"  },
  { key: "profit_factor", label: "盈虧比",   fmt: v => v.toFixed(2),         good: "high"  },
  { key: "total_trades",  label: "交易次數", fmt: v => String(Math.round(v))              },
];

// ── Score tooltip ─────────────────────────────────────────────────────────────

const SCORE_FORMULA = "綜合得分 = Sharpe×0.4 + 勝率×0.3 + (1−MaxDD)×0.3";

// ── Props ─────────────────────────────────────────────────────────────────────

interface ScanPanelProps {
  presets:    BacktestPreset[];
  onSelectSymbol?: (symbol: string) => void;
}

export default function ScanPanel({ presets, onSelectSymbol }: ScanPanelProps) {
  // ── Strategy config ──────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? "ma_cross");
  const [params,     setParams]     = useState<Record<string, number>>({});
  const [startDate,  setStartDate]  = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 3); return d.toISOString().slice(0, 10);
  });
  const [endDate,    setEndDate]    = useState(() => new Date().toISOString().slice(0, 10));
  const [capital,    setCapital]    = useState("1000000");
  const [extraInput, setExtraInput] = useState("");

  // ── Job state ────────────────────────────────────────────────────────────
  const [, setJobId]       = useState<string | null>(null);
  const [jobState, setJobState] = useState<ScanJobResponse | null>(null);
  const [loading,  setLoading]  = useState(false);
  const pollRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFnRef  = useRef<((jid: string) => Promise<void>) | null>(null);

  // ── Result display ───────────────────────────────────────────────────────
  const [sortKey,  setSortKey]  = useState<SortKey>("score");
  const [sortAsc,  setSortAsc]  = useState(false);
  const [filterSharpe,  setFilterSharpe]  = useState("");
  const [filterWinRate, setFilterWinRate] = useState("");
  const [filterMaxDD,   setFilterMaxDD]   = useState("");

  // Sync preset params
  useEffect(() => {
    const p = presets.find(x => x.id === selectedId);
    if (!p) return;
    const d: Record<string, number> = {};
    for (const pm of p.params) d[pm.key] = pm.default;
    setParams(d);
  }, [selectedId, presets]);

  // Build strategy from selected preset
  const buildStrategy = (): BacktestStrategyConfig => {
    const preset = presets.find(p => p.id === selectedId);
    if (!preset) return { type: selectedId };
    return {
      ...preset.default,
      ...params,
    };
  };

  // ── Poll job ─────────────────────────────────────────────────────────────
  const poll = useCallback(async (jid: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/backtest/scan/${jid}`);
      if (!res.ok) return;
      const data: ScanJobResponse = await res.json();
      setJobState(data);
      if (data.status === "running" || data.status === "pending") {
        pollRef.current = setTimeout(() => pollFnRef.current?.(jid), 3000);
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => { pollFnRef.current = poll; }, [poll]);
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // ── Start scan ───────────────────────────────────────────────────────────
  async function handleScan() {
    setLoading(true);
    setJobId(null);
    setJobState(null);
    const extra = extraInput.split(/[\s,，]+/).map(s => s.trim()).filter(Boolean);
    try {
      const res = await fetch(`${API_BASE}/api/v1/backtest/scan`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          strategy:        buildStrategy(),
          start_date:      startDate,
          end_date:        endDate,
          initial_capital: parseFloat(capital) || 1_000_000,
          extra_symbols:   extra,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`掃描啟動失敗：${err.detail ?? res.status}`);
        setLoading(false);
        return;
      }
      const { job_id } = await res.json();
      setJobId(job_id);
      poll(job_id);
    } catch (e) {
      alert(`網路錯誤：${e}`);
      setLoading(false);
    }
  }

  // ── Filtered + sorted results ────────────────────────────────────────────
  const results: ScanResult[] = (jobState?.results ?? []).filter(r => {
    if (filterSharpe  && r.sharpe      < parseFloat(filterSharpe))  return false;
    if (filterWinRate && r.win_rate    < parseFloat(filterWinRate))  return false;
    if (filterMaxDD   && Math.abs(r.max_drawdown) > parseFloat(filterMaxDD) / 100) return false;
    return true;
  }).sort((a, b) => {
    const av = a[sortKey] as number;
    const bv = b[sortKey] as number;
    return sortAsc ? av - bv : bv - av;
  });

  const preset = presets.find(p => p.id === selectedId);
  const progress = jobState ? (jobState.total > 0 ? jobState.progress / jobState.total : 0) : 0;

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      {/* ── Strategy picker ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">掃描策略</p>
        <div className="grid grid-cols-3 gap-1.5">
          {presets.filter(p => p.id !== "dsl").map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`text-left p-2 rounded-md text-xs border transition-colors ${
                selectedId === p.id
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-muted/30 hover:border-primary/60"
              }`}
            >
              {p.icon} {p.name}
            </button>
          ))}
        </div>

        {/* Preset params */}
        {preset && preset.params.length > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-1">
            {preset.params.map(pm => (
              <label key={pm.key} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">{pm.label}</span>
                <input
                  type="number" min={pm.min} max={pm.max}
                  step={pm.type === "float" ? 0.1 : 1}
                  value={params[pm.key] ?? pm.default}
                  onChange={e => setParams(prev => ({ ...prev, [pm.key]: parseFloat(e.target.value) || pm.default }))}
                  className="text-xs px-2 py-1 rounded border border-border bg-background"
                />
              </label>
            ))}
          </div>
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
          <span className="text-muted-foreground">初始資金</span>
          <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
            className="px-2 py-1 rounded border border-border bg-background" />
        </label>
      </div>

      {/* ── Extra symbols ── */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          自訂加入股票（逗號分隔，加入預設 {"{"}池大小{"}"} 以外的股票）
        </label>
        <input
          type="text"
          value={extraInput}
          onChange={e => setExtraInput(e.target.value)}
          placeholder="例：3008, 6669, 2395"
          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background"
        />
      </div>

      {/* ── Run button ── */}
      <button
        onClick={handleScan}
        disabled={loading}
        className="w-full py-2 rounded-md text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? "掃描中…" : "🔭 開始掃描全台股池"}
      </button>

      {/* ── Progress ── */}
      {jobState && (jobState.status === "running" || jobState.status === "pending") && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>已完成 {jobState.progress} / {jobState.total} 支</span>
            <span>{(progress * 100).toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 rounded-full"
              style={{ width: `${(progress * 100).toFixed(1)}%` }}
            />
          </div>
        </div>
      )}

      {jobState?.status === "failed" && (
        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-md p-2">
          ⚠ 掃描失敗：{jobState.error}
        </div>
      )}

      {/* ── Results ── */}
      {jobState?.status === "done" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">
              找到 <span className="text-primary">{results.length}</span> 支 / {jobState.results.length} 支有效結果
            </p>
            <span className="text-[10px] text-muted-foreground" title={SCORE_FORMULA}>ⓘ {SCORE_FORMULA}</span>
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2 text-xs items-center">
            <span className="text-muted-foreground">篩選：</span>
            <label className="flex items-center gap-1">
              <span className="text-muted-foreground">Sharpe ≥</span>
              <input type="number" step="0.1" value={filterSharpe}
                onChange={e => setFilterSharpe(e.target.value)}
                placeholder="不限"
                className="w-16 px-1.5 py-0.5 rounded border border-border bg-background text-xs" />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-muted-foreground">勝率 ≥</span>
              <input type="number" step="1" value={filterWinRate}
                onChange={e => setFilterWinRate(e.target.value)}
                placeholder="不限"
                className="w-16 px-1.5 py-0.5 rounded border border-border bg-background text-xs" />
              <span className="text-muted-foreground">%</span>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-muted-foreground">MaxDD ≤</span>
              <input type="number" step="1" value={filterMaxDD}
                onChange={e => setFilterMaxDD(e.target.value)}
                placeholder="不限"
                className="w-16 px-1.5 py-0.5 rounded border border-border bg-background text-xs" />
              <span className="text-muted-foreground">%</span>
            </label>
            {(filterSharpe || filterWinRate || filterMaxDD) && (
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => { setFilterSharpe(""); setFilterWinRate(""); setFilterMaxDD(""); }}
              >✕ 清除</button>
            )}
          </div>

          {/* Result table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">股票</th>
                  {COLS.map(col => (
                    <th
                      key={col.key}
                      className="text-right py-1.5 px-2 text-muted-foreground font-medium cursor-pointer hover:text-foreground select-none"
                      onClick={() => {
                        if (sortKey === col.key) setSortAsc(v => !v);
                        else { setSortKey(col.key); setSortAsc(false); }
                      }}
                    >
                      {col.label}
                      {sortKey === col.key && (
                        <span className="ml-0.5">{sortAsc ? "↑" : "↓"}</span>
                      )}
                    </th>
                  ))}
                  <th className="py-1.5 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={r.symbol}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-1.5 px-2 font-mono font-medium">
                      {i < 3 && <span className="mr-1">{["🥇","🥈","🥉"][i]}</span>}
                      {r.symbol}
                    </td>
                    {COLS.map(col => {
                      const v = r[col.key] as number;
                      return (
                        <td
                          key={col.key}
                          className={`text-right py-1.5 px-2 font-mono tabular-nums ${
                            sortKey === col.key ? "font-semibold" : ""
                          } ${
                            col.good === "high" && v > 0 ? "text-green-600 dark:text-green-400"
                            : col.good === "low" && Math.abs(v) > 0.2 ? "text-red-500"
                            : ""
                          }`}
                        >
                          {col.fmt(v)}
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-2">
                      {onSelectSymbol && (
                        <button
                          onClick={() => onSelectSymbol(r.symbol)}
                          className="text-primary hover:underline whitespace-nowrap"
                        >
                          → 回測
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr>
                    <td colSpan={COLS.length + 2} className="text-center py-6 text-muted-foreground">
                      無符合條件的結果，請調整篩選條件
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
