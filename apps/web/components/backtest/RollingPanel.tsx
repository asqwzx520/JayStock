"use client";

import { useState, useEffect, useRef } from "react";
import type { BacktestEquityPoint } from "@/lib/api";

interface RollingMetric {
  time: string;
  ret:     number | null;   // rolling return %
  mdd:     number | null;   // rolling max drawdown (negative, %)
  sharpe:  number | null;   // rolling annualised Sharpe
}

function calcRollingMetrics(curve: BacktestEquityPoint[], window: number): RollingMetric[] {
  const result: RollingMetric[] = [];
  for (let i = 0; i < curve.length; i++) {
    if (i < window - 1) {
      result.push({ time: curve[i].time, ret: null, mdd: null, sharpe: null });
      continue;
    }
    const slice = curve.slice(i - window + 1, i + 1);
    const start = slice[0].value;
    const end   = slice[slice.length - 1].value;

    // Rolling return
    const ret = start === 0 ? null : (end - start) / start;

    // Rolling max drawdown (from peak within window)
    let peak = slice[0].value;
    let maxDd = 0;
    for (const pt of slice) {
      if (pt.value > peak) peak = pt.value;
      const dd = peak === 0 ? 0 : (pt.value - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }

    // Rolling Sharpe (daily returns → annualised)
    let sharpe: number | null = null;
    if (slice.length >= 10) {
      const dailyRets: number[] = [];
      for (let j = 1; j < slice.length; j++) {
        const prev = slice[j - 1].value;
        if (prev !== 0) dailyRets.push((slice[j].value - prev) / prev);
      }
      if (dailyRets.length >= 2) {
        const mean = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
        const variance = dailyRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyRets.length - 1);
        const std = Math.sqrt(variance);
        sharpe = std === 0 ? null : (mean / std) * Math.sqrt(252);
      }
    }

    result.push({ time: curve[i].time, ret, mdd: maxDd, sharpe });
  }
  return result;
}

// ── Mini chart: 3 stacked lightweight-charts instances ───────────────────────

function RollingLineChart({
  data,
  field,
  label,
  color,
  formatY,
}: {
  data:    RollingMetric[];
  field:   "ret" | "mdd" | "sharpe";
  label:   string;
  color:   string;
  formatY: (v: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let chart: ReturnType<typeof import("lightweight-charts")["createChart"]> | null = null;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle, LineSeries }) => {
      if (!containerRef.current) return;
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
        timeScale: { borderColor: "var(--border)", timeVisible: false },
        rightPriceScale: { borderColor: "var(--border)" },
      });

      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceFormat: { type: "custom", formatter: formatY, minMove: 0.0001 },
      });

      const points = data
        .filter(d => d[field] !== null)
        .map(d => ({ time: d.time as import("lightweight-charts").Time, value: d[field] as number }));

      series.setData(points);

      // Zero baseline
      if (field !== "mdd") {
        chart.addSeries(LineSeries, {
          color: "var(--text-tertiary)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
        }).setData(points.map(p => ({ time: p.time, value: 0 })));
      }

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        chart?.resize(el.clientWidth, el.clientHeight);
      });
      ro.observe(el);
      return () => ro.disconnect();
    });

    return () => { chart?.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, field, color]);

  return (
    <div className="flex flex-col" style={{ minHeight: 0 }}>
      <div className="text-xs font-medium px-1 mb-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>
      <div ref={containerRef} style={{ height: 140, width: "100%" }} />
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

const WINDOWS = [20, 30, 60, 90] as const;
type WindowSize = typeof WINDOWS[number];

export default function RollingPanel({ equityCurve }: { equityCurve: BacktestEquityPoint[] }) {
  const [winSize, setWinSize] = useState<WindowSize>(30);

  if (!equityCurve.length) {
    return (
      <div className="h-full flex items-center justify-center text-sm" style={{ color: "var(--text-tertiary)" }}>
        無資金曲線資料
      </div>
    );
  }

  const metrics = calcRollingMetrics(equityCurve, winSize);
  const valid = metrics.filter(m => m.ret !== null);
  const lastRet    = valid.length ? valid[valid.length - 1].ret    : null;
  const lastMdd    = valid.length ? valid[valid.length - 1].mdd    : null;
  const lastSharpe = valid.length ? valid[valid.length - 1].sharpe : null;

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto px-1 py-2">
      {/* Header + window selector */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            滾動績效視窗
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            每個時間點顯示前 N 天的績效快照，揭露策略的時間穩定性
          </div>
        </div>
        <div className="flex gap-1">
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setWinSize(w)}
              className="px-3 py-1 text-xs rounded transition-colors"
              style={{
                background:  winSize === w ? "var(--color-brand)" : "var(--bg-tertiary)",
                color:       winSize === w ? "#fff" : "var(--text-secondary)",
                border:      "1px solid var(--border)",
              }}
            >
              {w}天
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label={`最新 ${winSize}天 報酬`}
          value={lastRet !== null ? `${(lastRet * 100).toFixed(2)}%` : "—"}
          positive={lastRet !== null ? lastRet >= 0 : undefined}
        />
        <SummaryCard
          label={`最新 ${winSize}天 最大回撤`}
          value={lastMdd !== null ? `${(lastMdd * 100).toFixed(2)}%` : "—"}
          positive={false}
        />
        <SummaryCard
          label={`最新 ${winSize}天 Sharpe`}
          value={lastSharpe !== null ? lastSharpe.toFixed(2) : "—"}
          positive={lastSharpe !== null ? lastSharpe >= 1 : undefined}
        />
      </div>

      {/* Charts */}
      {valid.length < winSize ? (
        <div className="text-xs text-center py-8" style={{ color: "var(--text-tertiary)" }}>
          資料筆數不足（需 ≥{winSize} 根），請縮小視窗或延長回測期間
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <RollingLineChart
            data={metrics}
            field="ret"
            label={`滾動 ${winSize}天 報酬率 (%)`}
            color="var(--color-brand)"
            formatY={v => `${(v * 100).toFixed(1)}%`}
          />
          <RollingLineChart
            data={metrics}
            field="mdd"
            label={`滾動 ${winSize}天 最大回撤 (%)`}
            color="#ef4444"
            formatY={v => `${(v * 100).toFixed(1)}%`}
          />
          <RollingLineChart
            data={metrics}
            field="sharpe"
            label={`滾動 ${winSize}天 Sharpe（年化）`}
            color="#22c55e"
            formatY={v => v.toFixed(2)}
          />
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  const color =
    positive === true  ? "#22c55e" :
    positive === false ? "#ef4444" :
    "var(--text-primary)";
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1"
      style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
    >
      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{label}</div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  );
}
