"use client";

import { useState, useRef, useEffect } from "react";
import type {
  BacktestRequest,
  BacktestPreset,
  CompareSlotRequest,
  CompareResponse,
  CompareStrategyResult,
} from "@/lib/api";
import { runCompare } from "@/lib/api";

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444"];

const _DEFAULT_START = new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10);
const _DEFAULT_END   = new Date().toISOString().slice(0, 10);

const STRATEGY_DEFS: Record<string, { label: string; params: { key: string; label: string; default: number }[] }> = {
  ma_cross:     { label: "均線黃金交叉",      params: [{ key: "fast", label: "快線", default: 5 }, { key: "slow", label: "慢線", default: 20 }] },
  rsi_mean_rev: { label: "RSI 超賣反彈",      params: [{ key: "period", label: "週期", default: 14 }, { key: "oversold", label: "超賣線", default: 30 }, { key: "overbought", label: "超買線", default: 70 }] },
  macd_signal:  { label: "MACD 訊號線",       params: [{ key: "fast", label: "快線", default: 12 }, { key: "slow", label: "慢線", default: 26 }, { key: "signal", label: "訊號", default: 9 }] },
  kd_cross:     { label: "KD 黃金交叉",       params: [{ key: "k_period", label: "K週期", default: 9 }, { key: "d_period", label: "D週期", default: 3 }, { key: "buy_zone", label: "進場<", default: 25 }, { key: "sell_zone", label: "出場>", default: 75 }] },
  boll_bounce:  { label: "布林通道均值回歸",  params: [{ key: "period", label: "週期", default: 20 }, { key: "std", label: "標準差", default: 2 }] },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined, digits = 1) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}
function fmt(v: number | null | undefined, digits = 2) {
  if (v == null) return "—";
  return v.toFixed(digits);
}

function winner(results: CompareStrategyResult[], metric: keyof NonNullable<CompareStrategyResult["stats"]>): number {
  let bestIdx = -1;
  let bestVal = -Infinity;
  results.forEach((r, i) => {
    if (!r.stats) return;
    const raw = r.stats[metric] as number;
    const val = metric === "max_drawdown" ? -raw : raw;
    if (val > bestVal) { bestVal = val; bestIdx = i; }
  });
  return bestIdx;
}

// ── Overlaid Equity Chart ─────────────────────────────────────────────────────

function OverlaidChart({ strategies }: { strategies: CompareStrategyResult[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const valid = strategies.filter(s => s.equity_curve_norm.length > 0);
    if (!valid.length) return;

    let chart: ReturnType<typeof import("lightweight-charts")["createChart"]> | null = null;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle, LineSeries }) => {
      if (!ref.current) return;
      chart = createChart(ref.current, {
        width:  ref.current.clientWidth,
        height: ref.current.clientHeight,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "var(--text-secondary)" },
        grid:   { vertLines: { color: "var(--border)", style: LineStyle.Dotted }, horzLines: { color: "var(--border)", style: LineStyle.Dotted } },
        crosshair: { mode: 1 },
        timeScale: { borderColor: "var(--border)", timeVisible: false },
        rightPriceScale: { borderColor: "var(--border)" },
      });

      valid.forEach(s => {
        const series = chart!.addSeries(LineSeries, {
          color:     s.color,
          lineWidth: 2,
          title:     s.name,
          priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}` },
        });
        series.setData(s.equity_curve_norm.map(p => ({
          time:  p.time as import("lightweight-charts").Time,
          value: p.value,
        })));
      });

      // Baseline 100
      const bmSeries = chart.addSeries(LineSeries, {
        color:     "rgba(156,163,175,0.5)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title:     "基準 100",
        priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}` },
      });
      const allTimes = valid[0].equity_curve_norm.map(p => p.time);
      bmSeries.setData(allTimes.map(t => ({ time: t as import("lightweight-charts").Time, value: 100 })));

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (ref.current && chart) chart.applyOptions({ width: ref.current.clientWidth });
      });
      ro.observe(ref.current);
      return () => ro.disconnect();
    });

    return () => { chart?.remove(); };
  }, [strategies]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}

// ── Performance Cards ─────────────────────────────────────────────────────────

const STAT_ROWS: { key: keyof NonNullable<CompareStrategyResult["stats"]>; label: string; format: (v: number) => string }[] = [
  { key: "total_return",  label: "總報酬",     format: v => pct(v) },
  { key: "cagr",          label: "年化報酬",   format: v => pct(v) },
  { key: "sharpe",        label: "Sharpe",     format: v => fmt(v) },
  { key: "sortino",       label: "Sortino",    format: v => fmt(v) },
  { key: "max_drawdown",  label: "最大回撤",   format: v => pct(v) },
  { key: "win_rate",      label: "勝率",       format: v => pct(v, 0) },
  { key: "profit_factor", label: "盈虧比",     format: v => fmt(v) },
  { key: "avg_hold_days", label: "平均持倉天", format: v => `${v.toFixed(1)}d` },
  { key: "total_trades",  label: "交易筆數",   format: v => `${v}` },
  { key: "alpha",         label: "超額報酬",   format: v => pct(v) },
];

function StatsCards({ results }: { results: CompareStrategyResult[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="w-full text-xs" style={{ borderCollapse: "collapse", minWidth: 360 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th className="py-2 pr-3 text-left text-[11px]" style={{ color: "var(--text-tertiary)", fontWeight: 500, width: 90 }}>指標</th>
            {results.map((r, i) => (
              <th key={i} className="py-2 px-3 text-right text-[11px]" style={{ color: r.color, fontWeight: 700 }}>
                <div>{r.name}</div>
                <div className="font-normal text-[10px]" style={{ color: "var(--text-tertiary)" }}>{r.symbol}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAT_ROWS.map(row => {
            const winIdx = winner(results, row.key);
            return (
              <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="py-1.5 pr-3 text-[11px]" style={{ color: "var(--text-tertiary)" }}>{row.label}</td>
                {results.map((r, i) => {
                  const val = r.stats?.[row.key] as number | undefined;
                  const isWin = i === winIdx && val != null;
                  const colorStyle = (row.key === "total_return" || row.key === "cagr" || row.key === "alpha")
                    ? { color: (val ?? 0) >= 0 ? "var(--color-up)" : "var(--color-down)" }
                    : row.key === "max_drawdown"
                    ? { color: "var(--color-down)" }
                    : {};
                  return (
                    <td key={i} className="py-1.5 px-3 text-right font-mono text-[11px]"
                        style={{ ...colorStyle, fontWeight: isWin ? 700 : 400, background: isWin ? "rgba(59,130,246,0.06)" : "transparent" }}>
                      {val != null ? row.format(val) : r.error ? "錯誤" : "—"}
                      {isWin && <span className="ml-1 text-[9px]" style={{ color: "var(--color-brand)" }}>★</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Significance ──────────────────────────────────────────────────────────────

function SignificanceSection({ significance }: { significance: CompareResponse["significance"] }) {
  const [open, setOpen] = useState(false);
  const pairs = significance.pairs;
  if (!pairs.length) return null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold"
        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
      >
        <span>📐 C. 統計顯著性（Welch t-test）</span>
        <span style={{ color: "var(--text-tertiary)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="p-4 flex flex-col gap-3" style={{ background: "var(--bg-surface)" }}>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            對各策略的每筆交易報酬率做 Welch t-test，判斷兩策略的交易績效是否有顯著差異。p &lt; 0.05 視為顯著。
          </p>
          {pairs.map((p, i) => (
            <div key={i} className="rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: `1px solid ${p.significant ? "var(--color-up)" : "var(--border)"}` }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {p.a} vs {p.b}
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: p.significant ? "var(--color-up-subtle)" : "var(--bg-surface)", color: p.significant ? "var(--color-up)" : "var(--text-tertiary)" }}>
                  {p.significant ? "顯著" : "不顯著"}
                </span>
              </div>
              <div className="flex gap-4 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {p.t_stat != null && <span>t = <b style={{ color: "var(--text-primary)" }}>{p.t_stat}</b></span>}
                {p.p_value != null && <span>p = <b style={{ color: p.significant ? "var(--color-up)" : "var(--text-primary)" }}>{p.p_value}</b></span>}
                <span style={{ color: "var(--text-tertiary)" }}>{p.note}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Correlation Matrix (P5-18) ────────────────────────────────────────────────

function _monthlyRets(curve: import("@/lib/api").CompareEquityPoint[]): Record<string, number> {
  const grouped = new Map<string, number>();
  for (const pt of curve) {
    grouped.set(pt.time.slice(0, 7), pt.value);
  }
  const months = [...grouped.keys()].sort();
  const result: Record<string, number> = {};
  for (let i = 1; i < months.length; i++) {
    const prev = grouped.get(months[i - 1])!;
    const curr = grouped.get(months[i])!;
    result[months[i]] = prev === 0 ? 0 : (curr - prev) / prev;
  }
  return result;
}

function _pearson(xs: number[], ys: number[]): number {
  if (xs.length < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const dx  = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
  const dy  = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  return dx === 0 || dy === 0 ? NaN : num / (dx * dy);
}

function _corrColor(r: number): string {
  if (isNaN(r)) return "var(--bg-elevated)";
  if (r >= 0) return `rgba(239,68,68,${r.toFixed(2)})`;
  return `rgba(59,130,246,${Math.abs(r).toFixed(2)})`;
}

function CorrelationSection({ strategies }: { strategies: CompareStrategyResult[] }) {
  const valid = strategies.filter(s => s.equity_curve_norm.length > 0);
  if (valid.length < 2) return null;

  const allMonthly = valid.map(s => _monthlyRets(s.equity_curve_norm));
  const n = valid.length;

  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 1;
      const months = Object.keys(allMonthly[i]).filter(m => m in allMonthly[j]);
      if (months.length < 3) return NaN;
      return _pearson(months.map(m => allMonthly[i][m]), months.map(m => allMonthly[j][m]));
    })
  );

  const CELL = 56;
  const LABEL = 72;
  const svgW = LABEL + n * CELL + 4;
  const svgH = LABEL + n * CELL + 4;

  return (
    <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
        D. 策略相關性矩陣（月報酬 Pearson r）
      </div>
      <div className="text-[10px] mb-3" style={{ color: "var(--text-tertiary)" }}>
        深紅 r≈+1（高度相關，多加此策略無法分散風險）；深藍 r≈-1（負相關，有對沖效果）；資料不足時顯示 —
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-2 mb-3 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        <div style={{ background: "rgba(59,130,246,0.9)", width: 16, height: 10, borderRadius: 2 }} />
        <span>負相關</span>
        <div style={{ background: "var(--bg-elevated)", width: 16, height: 10, borderRadius: 2, border: "1px solid var(--border)" }} />
        <span>無相關</span>
        <div style={{ background: "rgba(239,68,68,0.9)", width: 16, height: 10, borderRadius: 2 }} />
        <span>正相關</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <svg width={svgW} height={svgH} style={{ display: "block", minWidth: svgW }}>
          {valid.map((s, j) => (
            <text key={`col-${j}`}
              x={LABEL + j * CELL + CELL / 2} y={LABEL - 6}
              textAnchor="middle" fontSize={9} fill={s.color}
            >
              {s.name.length > 6 ? s.name.slice(0, 5) + "…" : s.name}
            </text>
          ))}
          {valid.map((s, i) => (
            <text key={`row-${i}`}
              x={LABEL - 6} y={LABEL + i * CELL + CELL / 2}
              textAnchor="end" dominantBaseline="middle" fontSize={9} fill={s.color}
            >
              {s.name.length > 6 ? s.name.slice(0, 5) + "…" : s.name}
            </text>
          ))}
          {matrix.map((row, i) =>
            row.map((r, j) => (
              <g key={`c-${i}-${j}`}>
                <rect
                  x={LABEL + j * CELL} y={LABEL + i * CELL}
                  width={CELL - 2} height={CELL - 2} rx={4}
                  fill={_corrColor(r)}
                />
                <text
                  x={LABEL + j * CELL + (CELL - 2) / 2}
                  y={LABEL + i * CELL + (CELL - 2) / 2}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={10} fontWeight={i === j ? 700 : 400}
                  fill={!isNaN(r) && Math.abs(r) > 0.5 ? "#fff" : "var(--text-primary)"}
                >
                  {isNaN(r) ? "—" : r.toFixed(2)}
                </text>
              </g>
            ))
          )}
        </svg>
      </div>
    </div>
  );
}

// ── Slot Editor ───────────────────────────────────────────────────────────────

interface SlotState {
  name:          string;
  symbol:        string;
  strategyType:  string;
  params:        Record<string, string>;
}

function defaultParams(type: string): Record<string, string> {
  return Object.fromEntries(
    (STRATEGY_DEFS[type]?.params ?? []).map(p => [p.key, String(p.default)])
  );
}

function SlotEditor({
  slot, idx, color, onUpdate, onRemove, canRemove,
}: {
  slot: SlotState; idx: number; color: string;
  onUpdate: (s: SlotState) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const def = STRATEGY_DEFS[slot.strategyType];

  function handleTypeChange(t: string) {
    onUpdate({ ...slot, strategyType: t, params: defaultParams(t) });
  }

  return (
    <div className="rounded-lg p-3 flex flex-col gap-2.5" style={{ border: `1px solid ${color}40`, background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
          <input
            type="text"
            value={slot.name}
            onChange={e => onUpdate({ ...slot, name: e.target.value })}
            maxLength={40}
            placeholder={`策略 ${idx + 1}`}
            className="text-xs font-semibold px-2 py-1 rounded outline-none"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)", width: 120 }}
          />
        </div>
        {canRemove && (
          <button onClick={onRemove} className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: "var(--text-tertiary)", border: "1px solid var(--border)" }}>✕</button>
        )}
      </div>

      {/* Symbol */}
      <label className="flex items-center gap-2">
        <span className="text-[10px] shrink-0 w-12" style={{ color: "var(--text-tertiary)" }}>股票代號</span>
        <input
          type="text"
          value={slot.symbol}
          onChange={e => onUpdate({ ...slot, symbol: e.target.value.toUpperCase() })}
          placeholder="如 2330"
          maxLength={10}
          className="text-xs px-2 py-1 rounded outline-none font-mono flex-1"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
        />
      </label>

      {/* Strategy type */}
      <label className="flex items-center gap-2">
        <span className="text-[10px] shrink-0 w-12" style={{ color: "var(--text-tertiary)" }}>策略類型</span>
        <select
          value={slot.strategyType}
          onChange={e => handleTypeChange(e.target.value)}
          className="text-xs px-2 py-1 rounded outline-none flex-1"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
        >
          {Object.entries(STRATEGY_DEFS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </label>

      {/* Params */}
      {def && def.params.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {def.params.map(p => (
            <label key={p.key} className="flex flex-col gap-0.5">
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{p.label}</span>
              <input
                type="number"
                value={slot.params[p.key] ?? p.default}
                onChange={e => onUpdate({ ...slot, params: { ...slot.params, [p.key]: e.target.value } })}
                className="text-xs px-2 py-1 rounded outline-none font-mono"
                style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ComparePanel (main export) ────────────────────────────────────────────────

export interface ComparePanelProps {
  symbol:  string;
  presets: BacktestPreset[];
  lastReq: BacktestRequest | null;
}

function makeDefaultSlot(idx: number, symbol: string, lastReq: BacktestRequest | null): SlotState {
  const TYPES = ["ma_cross", "rsi_mean_rev", "macd_signal", "kd_cross"];
  const type = idx === 0 && lastReq?.strategy?.type && lastReq.strategy.type !== "custom"
    ? lastReq.strategy.type
    : TYPES[idx % TYPES.length];

  const params = defaultParams(type);
  // Inherit params from lastReq for slot 0
  if (idx === 0 && lastReq?.strategy) {
    const s = lastReq.strategy as unknown as Record<string, unknown>;
    (STRATEGY_DEFS[type]?.params ?? []).forEach(p => {
      if (s[p.key] != null) params[p.key] = String(s[p.key]);
    });
  }

  return {
    name:         `策略 ${idx + 1}`,
    symbol:       symbol,
    strategyType: type,
    params,
  };
}

export default function ComparePanel({ symbol, presets: _presets, lastReq }: ComparePanelProps) {
  const defaultStart = lastReq?.start_date ?? _DEFAULT_START;
  const defaultEnd   = lastReq?.end_date   ?? _DEFAULT_END;
  const defaultCap   = lastReq?.initial_capital ?? 1_000_000;

  const [slots,     setSlots]    = useState<SlotState[]>(() => [
    makeDefaultSlot(0, symbol, lastReq),
    makeDefaultSlot(1, symbol, null),
  ]);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate,   setEndDate]   = useState(defaultEnd);
  const [capital,   setCapital]   = useState(String(defaultCap));

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [response, setResponse] = useState<CompareResponse | null>(null);

  function addSlot() {
    if (slots.length >= 4) return;
    setSlots(prev => [...prev, makeDefaultSlot(prev.length, symbol, null)]);
  }
  function removeSlot(idx: number) {
    setSlots(prev => prev.filter((_, i) => i !== idx));
  }
  function updateSlot(idx: number, s: SlotState) {
    setSlots(prev => prev.map((old, i) => i === idx ? s : old));
  }

  async function handleRun() {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const cap = parseFloat(capital) || 1_000_000;
      const slotReqs: CompareSlotRequest[] = slots.map(s => {
        const def = STRATEGY_DEFS[s.strategyType];
        const params: Record<string, number> = {};
        (def?.params ?? []).forEach(p => {
          const v = parseFloat(s.params[p.key] ?? String(p.default));
          if (!isNaN(v)) params[p.key] = v;
        });
        return {
          name:            s.name || `策略`,
          symbol:          s.symbol || symbol,
          strategy:        { type: s.strategyType, ...params },
          start_date:      startDate,
          end_date:        endDate,
          initial_capital: cap,
          stop_loss_pct:   lastReq?.stop_loss_pct   ?? undefined,
          take_profit_pct: lastReq?.take_profit_pct ?? undefined,
        };
      });
      const res = await runCompare({ slots: slotReqs });
      setResponse(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "策略比較失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">

      {/* ── Config ── */}
      <div className="rounded-lg p-4 flex flex-col gap-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-sm font-bold" style={{ color: "var(--color-brand)" }}>⚖️ 策略比較設定</div>

        {/* Slot editors */}
        <div className="flex flex-col gap-3">
          {slots.map((s, i) => (
            <SlotEditor
              key={i}
              slot={s}
              idx={i}
              color={COLORS[i % COLORS.length]}
              onUpdate={s => updateSlot(i, s)}
              onRemove={() => removeSlot(i)}
              canRemove={slots.length > 2}
            />
          ))}
        </div>

        {slots.length < 4 && (
          <button
            onClick={addSlot}
            className="text-xs py-1.5 rounded-lg transition-colors"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px dashed var(--border)" }}
          >
            ＋ 新增策略（最多 4 個）
          </button>
        )}

        {/* Shared date/capital */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>共用回測設定</div>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>開始日期</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="text-xs px-2 py-1 rounded outline-none"
                style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>結束日期</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="text-xs px-2 py-1 rounded outline-none"
                style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>起始資金 ($)</span>
              <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
                className="text-xs px-2 py-1 rounded outline-none font-mono"
                style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
            </label>
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={loading}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity"
          style={{ background: "var(--color-brand)", color: "#fff", opacity: loading ? 0.5 : 1 }}
        >
          {loading ? "⏳ 比較中..." : `▶ 執行比較（${slots.length} 個策略）`}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--color-down-subtle)", color: "var(--color-down)", border: "1px solid var(--color-down)" }}>
          {error}
        </div>
      )}

      {/* ── Results ── */}
      {response && !loading && (() => {
        const valid = response.strategies.filter(s => s.stats !== null);
        return (
          <div className="flex flex-col gap-4">
            {/* Legend */}
            <div className="flex flex-wrap gap-3 px-1">
              {response.strategies.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ background: s.color }} />
                  <span style={{ color: "var(--text-secondary)" }}>{s.name}</span>
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>{s.symbol}</span>
                  {s.error && <span className="text-[10px]" style={{ color: "var(--color-down)" }}>({s.error})</span>}
                </div>
              ))}
            </div>

            {/* B: Overlaid equity curves */}
            {valid.length >= 2 && (
              <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
                  B. 疊加資金曲線（正規化 = 100 起始）
                </div>
                <div style={{ height: 280 }}>
                  <OverlaidChart strategies={response.strategies} />
                </div>
                <div className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                  灰色虛線 = 基準 100；各曲線從 100 出發，終點即總報酬倍數
                </div>
              </div>
            )}

            {/* A: Stats cards */}
            <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
              <div className="text-xs font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
                A. 並排績效指標（★ = 該指標最佳）
              </div>
              <StatsCards results={response.strategies} />
            </div>

            {/* C: Significance */}
            <SignificanceSection significance={response.significance} />

            {/* D: Correlation Matrix */}
            {valid.length >= 2 && (
              <CorrelationSection strategies={response.strategies} />
            )}
          </div>
        );
      })()}
    </div>
  );
}
