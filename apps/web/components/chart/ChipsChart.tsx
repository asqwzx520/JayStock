"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  HistogramSeries,
  type IChartApi,
  type HistogramData,
  type Time,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type { ChipsBar, ChipsCumulative } from "@/lib/api";

interface ChipsChartProps {
  data: ChipsBar[];
  cumulative: ChipsCumulative;
}

function formatShares(n: number): string {
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}億`;
  if (abs >= 10_000)      return `${sign}${(abs / 10_000).toFixed(0)}萬`;
  return `${sign}${abs.toLocaleString()}`;
}

const FOREIGN_COLOR = "#F59E0B";
const TRUST_COLOR   = "#8B5CF6";
const DEALER_COLOR  = "#06B6D4";
const NEG_COLOR     = "#374151";

export default function ChipsChart({ data, cumulative }: ChipsChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  const buildChart = useCallback(() => {
    if (!containerRef.current || data.length === 0) return;
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const el = containerRef.current;
    const chart = createChart(el, {
      width:  el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94A3B8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(42,48,69,0.5)" },
        horzLines: { color: "rgba(42,48,69,0.5)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        borderColor: "#2A3045",
        timeVisible: false,
      },
    });

    // ── 外資（上段 ~50%）───────────────────────────────────────
    const foreignSeries = chart.addSeries(HistogramSeries, {
      priceScaleId:    "foreign",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    foreignSeries.priceScale().applyOptions({
      scaleMargins:  { top: 0.02, bottom: 0.52 },
      borderVisible: false,
    });
    const toHist = (
      arr: ChipsBar[],
      key: "foreign_net" | "trust_net" | "dealer_net",
      pos: string
    ): HistogramData<Time>[] =>
      arr.map((d) => ({
        time:  d.date as Time,
        value: d[key],
        color: d[key] >= 0 ? pos : NEG_COLOR,
      }));

    foreignSeries.setData(toHist(data, "foreign_net", FOREIGN_COLOR));

    // ── 投信（中段 ~24%）──────────────────────────────────────
    const trustSeries = chart.addSeries(HistogramSeries, {
      priceScaleId:    "trust",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    trustSeries.priceScale().applyOptions({
      scaleMargins:  { top: 0.53, bottom: 0.25 },
      borderVisible: false,
    });
    trustSeries.setData(toHist(data, "trust_net", TRUST_COLOR));

    // ── 自營（下段 ~22%）──────────────────────────────────────
    const dealerSeries = chart.addSeries(HistogramSeries, {
      priceScaleId:    "dealer",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    dealerSeries.priceScale().applyOptions({
      scaleMargins:  { top: 0.77, bottom: 0.02 },
      borderVisible: false,
    });
    dealerSeries.setData(toHist(data, "dealer_net", DEALER_COLOR));

    chart.timeScale().fitContent();
    chartRef.current = chart;
  }, [data]);

  useEffect(() => {
    buildChart();
  }, [buildChart]);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      chartRef.current?.applyOptions({
        width:  el.clientWidth,
        height: el.clientHeight,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const latest = data[data.length - 1];

  return (
    <div className="flex flex-col h-full">
      {/* ── 統計列 ───────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center flex-wrap gap-x-6 gap-y-1 px-4 py-2 border-b text-xs"
        style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
      >
        {/* 外資 */}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: FOREIGN_COLOR }} />
          <span style={{ color: "var(--text-secondary)" }}>外資</span>
          {latest && (
            <span
              className="num font-semibold"
              style={{ color: latest.foreign_net >= 0 ? "var(--color-up)" : "var(--color-down)" }}
            >
              {formatShares(latest.foreign_net)}
            </span>
          )}
          <span className="num" style={{ color: "var(--text-tertiary)" }}>
            累{formatShares(cumulative.foreign)}
          </span>
        </div>

        {/* 投信 */}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: TRUST_COLOR }} />
          <span style={{ color: "var(--text-secondary)" }}>投信</span>
          {latest && (
            <span
              className="num font-semibold"
              style={{ color: latest.trust_net >= 0 ? "var(--color-up)" : "var(--color-down)" }}
            >
              {formatShares(latest.trust_net)}
            </span>
          )}
          <span className="num" style={{ color: "var(--text-tertiary)" }}>
            累{formatShares(cumulative.trust)}
          </span>
        </div>

        {/* 自營 */}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: DEALER_COLOR }} />
          <span style={{ color: "var(--text-secondary)" }}>自營</span>
          {latest && (
            <span
              className="num font-semibold"
              style={{ color: latest.dealer_net >= 0 ? "var(--color-up)" : "var(--color-down)" }}
            >
              {formatShares(latest.dealer_net)}
            </span>
          )}
          <span className="num" style={{ color: "var(--text-tertiary)" }}>
            累{formatShares(cumulative.dealer)}
          </span>
        </div>

        {/* 合計 */}
        <div className="ml-auto flex items-center gap-1.5">
          <span style={{ color: "var(--text-tertiary)" }}>合計</span>
          <span
            className="num font-semibold"
            style={{ color: cumulative.total >= 0 ? "var(--color-up)" : "var(--color-down)" }}
          >
            {formatShares(cumulative.total)}
          </span>
        </div>
      </div>

      {/* ── 圖表區 ──────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        {/* 分隔線 */}
        <div
          className="pointer-events-none absolute z-10 w-full"
          style={{ top: "51%", borderTop: "1px solid #2A3045" }}
        />
        <div
          className="pointer-events-none absolute z-10 w-full"
          style={{ top: "76%", borderTop: "1px solid #2A3045" }}
        />
        {/* 區段標籤 */}
        <div
          className="pointer-events-none absolute z-10 left-2 top-[3%] text-[10px] font-semibold"
          style={{ color: FOREIGN_COLOR }}
        >
          外資
        </div>
        <div
          className="pointer-events-none absolute z-10 left-2 text-[10px] font-semibold"
          style={{ top: "54%", color: TRUST_COLOR }}
        >
          投信
        </div>
        <div
          className="pointer-events-none absolute z-10 left-2 text-[10px] font-semibold"
          style={{ top: "78%", color: DEALER_COLOR }}
        >
          自營
        </div>
        {/* LW Charts 容器 */}
        <div ref={containerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
