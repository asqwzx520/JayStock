"use client";

import { useState, useCallback, useMemo } from "react";
import type {
  BacktestRequest,
  OptimizeRequest,
  OptimizeResponse,
  OptimizeResultItem,
  OptimizeHeatmap,
  OptimizeSortBy,
  BacktestPreset,
} from "@/lib/api";
import { runOptimize } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | undefined, digits = 1) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}
function fmt2(v: number | undefined) {
  if (v == null) return "—";
  return v.toFixed(2);
}
function colorStat(v: number | undefined) {
  if (v == null) return "var(--text-secondary)";
  return v >= 0 ? "var(--color-up)" : "var(--color-down)";
}

const SORT_OPTIONS: { value: OptimizeSortBy; label: string }[] = [
  { value: "sharpe",       label: "Sharpe 比率" },
  { value: "total_return", label: "總報酬率" },
  { value: "win_rate",     label: "勝率" },
  { value: "max_drawdown", label: "最小回撤" },
];

const STRATEGY_LABELS: Record<string, string> = {
  ma_cross:     "均線黃金交叉",
  rsi_mean_rev: "RSI 超賣反彈",
  macd_signal:  "MACD 訊號線",
  kd_cross:     "KD 黃金交叉",
  boll_bounce:  "布林通道均值回歸",
};

// ── Heatmap ───────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

const _OPT_DEFAULT_START = new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10);
const _OPT_DEFAULT_END   = new Date().toISOString().slice(0, 10);

const PRESET_GRIDS: Record<string, Record<string, number[]>> = {
  ma_cross:     { fast: [3,5,8,10,15,20],  slow: [15,20,30,40,50,60,80] },
  rsi_mean_rev: { period: [10,14,20,25], oversold: [20,25,30,35], overbought: [65,70,75,80] },
  macd_signal:  { fast: [8,10,12,15], slow: [20,24,26,30], signal: [7,9,11] },
  kd_cross:     { k_period: [5,9,14], d_period: [3,5], buy_zone: [20,25,30], sell_zone: [70,75,80] },
  boll_bounce:  { period: [10,15,20,25,30], std: [1.5,2.0,2.5,3.0] },
};

function metricColor(val: number, min: number, max: number): string {
  if (max === min) return "hsl(210,60%,50%)";
  const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
  // red(0%) → yellow(50%) → green(100%)
  const h = lerp(0, 120, t);
  const s = 70;
  const l = lerp(40, 50, Math.abs(t - 0.5) * 2);
  return `hsl(${h},${s}%,${l}%)`;
}

function HeatmapChart({ heatmap }: { heatmap: OptimizeHeatmap }) {
  const { param_x, param_y, x_values, y_values, matrix, metric_label } = heatmap;
  const allVals = matrix.flat().filter((v): v is number => v !== null);
  const minVal = allVals.length ? Math.min(...allVals) : 0;
  const maxVal = allVals.length ? Math.max(...allVals) : 1;

  const CELL = 40;
  const LABEL_X = 52;
  const LABEL_Y = 28;
  const svgW = LABEL_X + y_values.length * CELL + 8;
  const svgH = LABEL_Y + x_values.length * CELL + 8;

  return (
    <div>
      <div className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
        熱力圖 — {metric_label}
        <span className="ml-2 font-normal" style={{ color: "var(--text-tertiary)" }}>
          （X: {param_y}，Y: {param_x}）
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg width={svgW} height={svgH} style={{ display: "block", fontFamily: "monospace" }}>
          {/* Y-axis labels (param_x values) */}
          {x_values.map((xv, xi) => (
            <text
              key={xi}
              x={LABEL_X - 6}
              y={LABEL_Y + xi * CELL + CELL / 2 + 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--text-tertiary)"
            >{xv}</text>
          ))}
          {/* X-axis labels (param_y values) */}
          {y_values.map((yv, yi) => (
            <text
              key={yi}
              x={LABEL_X + yi * CELL + CELL / 2}
              y={LABEL_Y - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-tertiary)"
            >{yv}</text>
          ))}
          {/* Cells */}
          {x_values.map((_, xi) =>
            y_values.map((_, yi) => {
              const val = matrix[xi]?.[yi];
              const bg  = val !== null ? metricColor(val, minVal, maxVal) : "#333";
              const display = val !== null ? val.toFixed(2) : "—";
              return (
                <g key={`${xi}-${yi}`}>
                  <rect
                    x={LABEL_X + yi * CELL}
                    y={LABEL_Y + xi * CELL}
                    width={CELL - 2}
                    height={CELL - 2}
                    fill={bg}
                    rx={3}
                  />
                  <text
                    x={LABEL_X + yi * CELL + CELL / 2 - 1}
                    y={LABEL_Y + xi * CELL + CELL / 2 + 4}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#fff"
                    style={{ fontWeight: 600 }}
                  >{display}</text>
                </g>
              );
            })
          )}
          {/* Axis labels */}
          <text
            x={LABEL_X + y_values.length * CELL / 2}
            y={svgH - 2}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-tertiary)"
          >{param_y}</text>
          <text
            x={8}
            y={LABEL_Y + x_values.length * CELL / 2}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-tertiary)"
            transform={`rotate(-90, 8, ${LABEL_Y + x_values.length * CELL / 2})`}
          >{param_x}</text>
        </svg>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>低</span>
        <div style={{
          width: 80, height: 8, borderRadius: 4,
          background: "linear-gradient(to right, hsl(0,70%,45%), hsl(60,70%,47%), hsl(120,70%,45%))",
        }} />
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>高</span>
      </div>
    </div>
  );
}

// ── Robustness Analysis ───────────────────────────────────────────────────────

function RobustnessAnalysis({
  results,
  sortBy,
}: {
  results:  OptimizeResponse["results"];
  sortBy:   OptimizeSortBy;
}) {
  const { score, robustRatio, heatParams, heatData } = useMemo(() => {
    if (!results.length) return { score: 0, robustRatio: 0, heatParams: null, heatData: null };

    // Get best metric value
    const getMetric = (r: OptimizeResultItem): number => {
      const v = r.stats[sortBy as keyof typeof r.stats];
      return typeof v === "number" ? v : -Infinity;
    };
    const sorted    = [...results].sort((a, b) => getMetric(b) - getMetric(a));
    const bestVal   = getMetric(sorted[0]);
    if (!bestVal || bestVal <= 0) return { score: 0, robustRatio: 0, heatParams: null, heatData: null };

    // Compute ratio = combo_metric / best_metric for each result
    const ratios = results.map(r => ({
      ...r,
      ratio: Math.max(0, getMetric(r) / bestVal),
    }));

    // Robustness score = % of combos with ratio >= 0.8
    const robustCount = ratios.filter(r => r.ratio >= 0.8).length;
    const robustRatio = robustCount / ratios.length;
    const score       = Math.round(robustRatio * 100);

    // Build robustness heatmap for 2-param strategies
    const paramKeys = Object.keys(results[0].params);
    if (paramKeys.length < 2) {
      // 1-param: show bar chart data
      const sortedByParam = [...ratios].sort((a, b) => a.params[paramKeys[0]] - b.params[paramKeys[0]]);
      return {
        score, robustRatio,
        heatParams: null,
        heatData: {
          type: "bar" as const,
          paramKey: paramKeys[0],
          bars: sortedByParam.map(r => ({ x: r.params[paramKeys[0]], ratio: r.ratio })),
        },
      };
    }

    // 2+ params: show robustness heatmap (param_x vs param_y)
    const px = paramKeys[0], py = paramKeys[1];
    const xVals = [...new Set(results.map(r => r.params[px]))].sort((a, b) => a - b);
    const yVals = [...new Set(results.map(r => r.params[py]))].sort((a, b) => a - b);
    const matrix: (number | null)[][] = xVals.map(xv =>
      yVals.map(yv => {
        const match = ratios.find(r => r.params[px] === xv && r.params[py] === yv);
        return match ? match.ratio : null;
      })
    );
    return {
      score, robustRatio,
      heatParams: { px, py, xVals, yVals, matrix },
      heatData: null,
    };
  }, [results, sortBy]);

  if (!results.length) return null;

  const badge = score >= 60
    ? { label: "✅ 穩健", color: "#22c55e", bg: "#166534" }
    : score >= 35
    ? { label: "⚠️ 尚可", color: "#f59e0b", bg: "#78350f" }
    : { label: "❌ 脆弱", color: "#ef4444", bg: "#7f1d1d" };

  // Color: green for ratio ≥ 0.9, yellow 0.7–0.9, red < 0.7
  function ratioColor(r: number): string {
    if (r >= 0.9) return "hsl(120,60%,40%)";
    if (r >= 0.7) return "hsl(45,85%,45%)";
    return "hsl(0,65%,42%)";
  }

  const CELL = 38;
  const LABEL_X = 50, LABEL_Y = 26;

  return (
    <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
          🔬 參數穩健性分析
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            {Math.round(robustRatio * 100)}% 組合 ratio≥0.8
          </span>
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: badge.bg + "55", color: badge.color, border: `1px solid ${badge.color}55` }}
          >
            {badge.label}（{score}分）
          </span>
        </div>
      </div>

      {/* Score bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[9px]" style={{ color: "var(--text-tertiary)" }}>
          <span>脆弱</span><span>穩健</span>
        </div>
        <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width:      `${score}%`,
              background: score >= 60 ? "#22c55e" : score >= 35 ? "#f59e0b" : "#ef4444",
            }}
          />
          {/* Threshold markers */}
          <div className="absolute top-0 h-full w-px" style={{ left: "35%", background: "#f59e0b88" }} />
          <div className="absolute top-0 h-full w-px" style={{ left: "60%", background: "#22c55e88" }} />
        </div>
      </div>

      {/* Heatmap (2-param) */}
      {heatParams && (
        <div style={{ overflowX: "auto" }}>
          <div className="text-[10px] mb-1.5" style={{ color: "var(--text-tertiary)" }}>
            穩健性熱圖（顏色 = 相對最佳值比率，綠 ≥ 90% · 黃 70–90% · 紅 &lt; 70%）
          </div>
          <svg
            width={LABEL_X + heatParams.yVals.length * CELL + 8}
            height={LABEL_Y + heatParams.xVals.length * CELL + 8}
            style={{ display: "block", fontFamily: "monospace" }}
          >
            {heatParams.xVals.map((xv, xi) => (
              <text key={xi} x={LABEL_X - 4} y={LABEL_Y + xi * CELL + CELL / 2 + 4}
                textAnchor="end" fontSize={9} fill="var(--text-tertiary)">{xv}</text>
            ))}
            {heatParams.yVals.map((yv, yi) => (
              <text key={yi} x={LABEL_X + yi * CELL + CELL / 2} y={LABEL_Y - 8}
                textAnchor="middle" fontSize={9} fill="var(--text-tertiary)">{yv}</text>
            ))}
            {heatParams.xVals.map((_, xi) =>
              heatParams.yVals.map((_, yi) => {
                const ratio = heatParams.matrix[xi]?.[yi];
                const bg    = ratio !== null ? ratioColor(ratio) : "#2a2a2a";
                const label = ratio !== null ? `${Math.round(ratio * 100)}%` : "—";
                return (
                  <g key={`${xi}-${yi}`}>
                    <rect x={LABEL_X + yi * CELL} y={LABEL_Y + xi * CELL}
                      width={CELL - 2} height={CELL - 2} fill={bg} rx={3} />
                    <text x={LABEL_X + yi * CELL + CELL / 2} y={LABEL_Y + xi * CELL + CELL / 2 + 4}
                      textAnchor="middle" fontSize={9} fill="#fff" fontWeight={600}>{label}</text>
                  </g>
                );
              })
            )}
            <text x={LABEL_X + heatParams.yVals.length * CELL / 2}
              y={LABEL_Y + heatParams.xVals.length * CELL + 6}
              textAnchor="middle" fontSize={9} fill="var(--text-tertiary)">{heatParams.py}</text>
            <text x={8} y={LABEL_Y + heatParams.xVals.length * CELL / 2}
              textAnchor="middle" fontSize={9} fill="var(--text-tertiary)"
              transform={`rotate(-90, 8, ${LABEL_Y + heatParams.xVals.length * CELL / 2})`}
            >{heatParams.px}</text>
          </svg>
        </div>
      )}

      {/* 1-param bar */}
      {heatData?.type === "bar" && (
        <div>
          <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>
            參數 {heatData.paramKey} 穩健性（各值相對最佳比率）
          </div>
          <div className="flex items-end gap-0.5 h-16">
            {heatData.bars.map(b => (
              <div key={b.x} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height:     `${b.ratio * 100}%`,
                    background: ratioColor(b.ratio),
                    minHeight:  "2px",
                  }}
                  title={`${heatData.paramKey}=${b.x}: ${Math.round(b.ratio * 100)}%`}
                />
                <span className="text-[8px]" style={{ color: "var(--text-tertiary)" }}>{b.x}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interpretation guide */}
      <div className="text-[10px] rounded px-2 py-1.5 space-y-0.5" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
        <p>• 穩健性 ≥ 60% → 廣域高原：參數稍微偏移仍有效，可信度較高</p>
        <p>• 穩健性 &lt; 35% → 尖銳孤峰：高度依賴精確參數，可能是曲線擬合</p>
        <p>• 建議搭配 Walk-Forward 驗證，兩者皆通過才算真正穩健</p>
      </div>
    </div>
  );
}

// ── Top-N Table ───────────────────────────────────────────────────────────────

function Top30Table({
  results,
  paramKeys,
  sortBy,
}: {
  results: OptimizeResponse["results"];
  paramKeys: string[];
  sortBy: OptimizeSortBy;
}) {
  if (!results.length) return (
    <div className="text-xs text-center py-6" style={{ color: "var(--text-tertiary)" }}>
      無有效結果（可能是參數範圍內資料不足）
    </div>
  );

  const sortLabel = SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? sortBy;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="w-full text-[11px]" style={{ borderCollapse: "collapse", minWidth: 480 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th className="py-1.5 pr-2 text-right" style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>#</th>
            {paramKeys.map(k => (
              <th key={k} className="py-1.5 px-2 text-right" style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>
                {k}
              </th>
            ))}
            <th className="py-1.5 px-2 text-right" style={{ color: "var(--color-brand)", fontWeight: 600 }}>
              ★ {sortLabel}
            </th>
            <th className="py-1.5 px-2 text-right" style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>總報酬</th>
            <th className="py-1.5 px-2 text-right" style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>Sharpe</th>
            <th className="py-1.5 px-2 text-right" style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>勝率</th>
            <th className="py-1.5 px-2 text-right" style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>MaxDD</th>
            <th className="py-1.5 px-2 text-right" style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>交易數</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const s = r.stats;
            const isTop3 = i < 3;
            return (
              <tr
                key={i}
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: isTop3 ? "var(--bg-elevated)" : "transparent",
                }}
              >
                <td className="py-1.5 pr-2 text-right font-mono" style={{ color: isTop3 ? "var(--color-brand)" : "var(--text-tertiary)" }}>
                  {i < 3 ? ["🥇","🥈","🥉"][i] : r.rank}
                </td>
                {paramKeys.map(k => (
                  <td key={k} className="py-1.5 px-2 text-right font-mono" style={{ color: "var(--text-primary)" }}>
                    {r.params[k]}
                  </td>
                ))}
                {/* Highlighted sort-by column */}
                <td className="py-1.5 px-2 text-right font-mono font-semibold" style={{ color: "var(--color-brand)" }}>
                  {sortBy === "sharpe"       ? fmt2(s.sharpe)
                   : sortBy === "total_return" ? pct(s.total_return)
                   : sortBy === "win_rate"     ? pct(s.win_rate)
                   : pct(s.max_drawdown)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono" style={{ color: colorStat(s.total_return) }}>
                  {pct(s.total_return)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono" style={{ color: (s.sharpe ?? 0) >= 1 ? "var(--color-up)" : "var(--text-secondary)" }}>
                  {fmt2(s.sharpe)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono" style={{ color: (s.win_rate ?? 0) >= 0.5 ? "var(--color-up)" : "var(--color-down)" }}>
                  {pct(s.win_rate, 0)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono" style={{ color: "var(--color-down)" }}>
                  {pct(s.max_drawdown)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono" style={{ color: "var(--text-secondary)" }}>
                  {s.total_trades ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── ParamGridEditor ───────────────────────────────────────────────────────────

function ParamGridEditor({
  paramKeys,
  values,
  onChange,
  readonly,
}: {
  paramKeys: string[];
  values:    Record<string, string>;   // comma-separated strings
  onChange:  (key: string, val: string) => void;
  readonly:  boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {paramKeys.map(k => (
        <label key={k} className="flex items-center gap-2">
          <span className="text-[11px] font-mono w-24 shrink-0" style={{ color: "var(--text-secondary)" }}>{k}</span>
          <input
            type="text"
            value={values[k] ?? ""}
            onChange={e => onChange(k, e.target.value)}
            readOnly={readonly}
            placeholder="逗號分隔，如 5,10,20"
            className="flex-1 text-xs px-2 py-1 rounded outline-none font-mono"
            style={{
              background: readonly ? "var(--bg-elevated)" : "var(--bg-surface)",
              color:      "var(--text-primary)",
              border:     `1px solid var(--border)`,
              opacity:    readonly ? 0.7 : 1,
            }}
          />
          {!readonly && (
            <span className="text-[10px] shrink-0" style={{ color: "var(--text-tertiary)" }}>
              {(values[k] ?? "").split(",").filter(Boolean).length} 個
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

// ── OptimizePanel (main export) ───────────────────────────────────────────────

export interface OptimizePanelProps {
  symbol:    string;
  presets:   BacktestPreset[];
  lastReq?:  BacktestRequest | null;
}

export default function OptimizePanel({ symbol, presets: _presets, lastReq }: OptimizePanelProps) {
  // Config state
  const [mode,         setMode]        = useState<"preset" | "custom">("preset");
  const [stratType,    setStratType]   = useState<string>(
    lastReq?.strategy?.type && lastReq.strategy.type !== "custom" ? lastReq.strategy.type : "ma_cross"
  );
  const [sortBy,       setSortBy]      = useState<OptimizeSortBy>("sharpe");

  // Custom grid state (comma-separated strings per param)
  const defaultCustomValues = (type: string): Record<string, string> => {
    const grid = PRESET_GRIDS[type] ?? {};
    return Object.fromEntries(Object.entries(grid).map(([k, vs]) => [k, vs.join(",")]));
  };
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => defaultCustomValues(stratType));

  const handleStratChange = (t: string) => {
    setStratType(t);
    setCustomValues(defaultCustomValues(t));
  };

  // Derive param keys for current strategy
  const currentGrid = useMemo(() => PRESET_GRIDS[stratType] ?? {}, [stratType]);
  const paramKeys   = useMemo(() => Object.keys(currentGrid), [currentGrid]);

  // Count combos
  const countCombos = useCallback(() => {
    const ranges = mode === "preset"
      ? currentGrid
      : Object.fromEntries(
          paramKeys.map(k => [k, (customValues[k] ?? "").split(",").map(v => parseFloat(v.trim())).filter(n => !isNaN(n))])
        );
    return Object.values(ranges).reduce((acc, vs) => acc * (vs.length || 1), 1);
  }, [mode, currentGrid, paramKeys, customValues]);

  // Date range from lastReq or default
  const defaultStart = lastReq?.start_date ?? _OPT_DEFAULT_START;
  const defaultEnd   = lastReq?.end_date   ?? _OPT_DEFAULT_END;
  const defaultCap   = lastReq?.initial_capital ?? 1_000_000;

  // Run optimize
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [response, setResponse] = useState<OptimizeResponse | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      let param_ranges: Record<string, number[]> | undefined;
      if (mode === "custom") {
        param_ranges = Object.fromEntries(
          paramKeys.map(k => [
            k,
            (customValues[k] ?? "").split(",").map(v => parseFloat(v.trim())).filter(n => !isNaN(n)),
          ])
        );
        const empty = paramKeys.find(k => !param_ranges![k]?.length);
        if (empty) throw new Error(`參數 ${empty} 未填任何值`);
      }

      const req: OptimizeRequest = {
        symbol,
        strategy_type:   stratType,
        use_preset:      mode === "preset",
        param_ranges,
        start_date:      defaultStart,
        end_date:        defaultEnd,
        initial_capital: defaultCap,
        stop_loss_pct:   lastReq?.stop_loss_pct   ?? undefined,
        take_profit_pct: lastReq?.take_profit_pct ?? undefined,
        sort_by:         sortBy,
        top_n:           30,
      };
      const res = await runOptimize(req);
      setResponse(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "最佳化失敗");
    } finally {
      setLoading(false);
    }
  }

  const combos = countCombos();

  return (
    <div className="flex flex-col gap-5 p-4 h-full overflow-y-auto">

      {/* ── Config section ── */}
      <div className="rounded-lg p-4 flex flex-col gap-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-sm font-bold" style={{ color: "var(--color-brand)" }}>🔍 參數最佳化設定</div>

        {/* Strategy type */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>策略類型</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(STRATEGY_LABELS).map(([type, label]) => (
              <button
                key={type}
                onClick={() => handleStratChange(type)}
                className="text-xs px-2.5 py-1 rounded-full transition-colors"
                style={{
                  background: stratType === type ? "var(--color-brand)" : "var(--bg-elevated)",
                  color:      stratType === type ? "#fff" : "var(--text-secondary)",
                  border:     `1px solid ${stratType === type ? "var(--color-brand)" : "var(--border)"}`,
                }}
              >{label}</button>
            ))}
          </div>
        </div>

        {/* Mode */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>掃描模式</div>
          <div className="flex gap-2">
            {[
              { id: "preset" as const, label: "B 一鍵最佳化", desc: "預設掃描範圍" },
              { id: "custom" as const, label: "A 自訂 Grid",  desc: "自訂候選值" },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className="flex-1 rounded-lg py-2 text-xs transition-colors text-left px-3"
                style={{
                  background: mode === m.id ? "var(--color-brand)" : "var(--bg-elevated)",
                  color:      mode === m.id ? "#fff" : "var(--text-secondary)",
                  border:     `1px solid ${mode === m.id ? "var(--color-brand)" : "var(--border)"}`,
                }}
              >
                <div className="font-semibold">{m.label}</div>
                <div className="text-[10px] opacity-80">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Param grid preview / editor */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold" style={{ color: "var(--text-tertiary)" }}>
              參數範圍
            </div>
            <div className="text-[10px]" style={{ color: combos > 200 ? "var(--color-down)" : "var(--text-tertiary)" }}>
              {combos} 組合{combos > 300 ? "（超過上限 300，請縮小範圍）" : ""}
            </div>
          </div>
          <ParamGridEditor
            paramKeys={paramKeys}
            values={mode === "preset"
              ? Object.fromEntries(paramKeys.map(k => [k, (currentGrid[k] ?? []).join(", ")]))
              : customValues}
            onChange={(k, v) => setCustomValues(prev => ({ ...prev, [k]: v }))}
            readonly={mode === "preset"}
          />
        </div>

        {/* Sort by */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>排序依據</div>
          <div className="flex flex-wrap gap-1.5">
            {SORT_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setSortBy(o.value)}
                className="text-xs px-2.5 py-1 rounded-full transition-colors"
                style={{
                  background: sortBy === o.value ? "var(--color-brand)" : "var(--bg-elevated)",
                  color:      sortBy === o.value ? "#fff" : "var(--text-secondary)",
                  border:     `1px solid ${sortBy === o.value ? "var(--color-brand)" : "var(--border)"}`,
                }}
              >{o.label}</button>
            ))}
          </div>
        </div>

        {/* Date/capital info line */}
        <div className="text-[10px] rounded px-2 py-1.5" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          📅 {defaultStart} ～ {defaultEnd}
          &nbsp;·&nbsp;💰 ${(defaultCap / 10000).toFixed(0)}萬
          {lastReq?.stop_loss_pct   ? `  · 停損 ${(lastReq.stop_loss_pct * 100).toFixed(0)}%` : ""}
          {lastReq?.take_profit_pct ? `  · 停利 ${(lastReq.take_profit_pct * 100).toFixed(0)}%` : ""}
          {!lastReq && <span className="ml-1">（先執行回測後可繼承設定）</span>}
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={loading || combos > 300}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity"
          style={{
            background: "var(--color-brand)",
            color: "#fff",
            opacity: (loading || combos > 300) ? 0.5 : 1,
          }}
        >
          {loading ? `⏳ 掃描 ${combos} 組合中...` : `▶ 執行最佳化（${combos} 組合）`}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--color-down-subtle)", color: "var(--color-down)", border: "1px solid var(--color-down)" }}>
          {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-8" style={{ color: "var(--text-tertiary)" }}>
          <div className="text-3xl animate-spin">⚙️</div>
          <div className="text-sm">正在掃描 {combos} 個參數組合...</div>
          <div className="text-xs">每組合約 0.1–0.5 秒，請稍候</div>
        </div>
      )}

      {/* ── Results ── */}
      {response && !loading && (
        <div className="flex flex-col gap-4">
          {/* Summary bar */}
          <div className="flex items-center gap-4 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
            <span>✅ 完成</span>
            <span>有效組合 <b style={{ color: "var(--text-primary)" }}>{response.valid_combos}</b> / {response.total_combos}</span>
            <span>排序：<b style={{ color: "var(--color-brand)" }}>{SORT_OPTIONS.find(o => o.value === response.sort_by)?.label}</b></span>
            {response.heatmap && <span>📊 熱力圖已就緒</span>}
          </div>

          {/* Heatmap */}
          {response.heatmap && (
            <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
              <HeatmapChart heatmap={response.heatmap} />
            </div>
          )}

          {/* Robustness Analysis */}
          <RobustnessAnalysis results={response.results} sortBy={response.sort_by} />

          {/* Top 30 table */}
          <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
            <div className="text-xs font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
              Top {response.results.length} 參數組合排行
            </div>
            <Top30Table
              results={response.results}
              paramKeys={paramKeys}
              sortBy={response.sort_by}
            />
          </div>
        </div>
      )}
    </div>
  );
}
