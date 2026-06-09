"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  LineSeries,
  type IChartApi,
  type Time,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type { MarginBar, MarginResponse } from "@/lib/api";

interface MarginChartProps {
  data: MarginBar[];
  latest: MarginResponse["latest"];
}

const MARGIN_COLOR = "#F59E0B"; // amber — 融資
const SHORT_COLOR  = "#EF4444"; // red   — 融券

function formatK(n: number): string {
  const abs = Math.abs(n);
  const sign = n >= 0 ? "" : "-";
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}萬`;
  return `${sign}${abs.toLocaleString()}`;
}

export default function MarginChart({ data, latest }: MarginChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  const buildChart = useCallback(() => {
    if (!containerRef.current || data.length === 0) return;
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const el    = containerRef.current;
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
      timeScale: { borderColor: "#2A3045", timeVisible: false },
    });

    // ── 融資餘額（上段）────────────────────────────────────────
    const marginSeries = chart.addSeries(LineSeries, {
      priceScaleId:     "margin",
      color:            MARGIN_COLOR,
      lineWidth:        2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    marginSeries.priceScale().applyOptions({
      scaleMargins:  { top: 0.05, bottom: 0.52 },
      borderVisible: false,
    });
    marginSeries.setData(
      data.map((d) => ({ time: d.date as Time, value: d.margin_balance }))
    );

    // ── 融券餘額（下段）────────────────────────────────────────
    const shortSeries = chart.addSeries(LineSeries, {
      priceScaleId:     "short",
      color:            SHORT_COLOR,
      lineWidth:        2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    shortSeries.priceScale().applyOptions({
      scaleMargins:  { top: 0.55, bottom: 0.05 },
      borderVisible: false,
    });
    shortSeries.setData(
      data.map((d) => ({ time: d.date as Time, value: d.short_balance }))
    );

    chart.timeScale().fitContent();
    chartRef.current = chart;
  }, [data]);

  useEffect(() => { buildChart(); }, [buildChart]);

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

  const mb = latest?.margin_balance ?? 0;
  const mc = latest?.margin_change  ?? 0;
  const sb = latest?.short_balance  ?? 0;
  const sc = latest?.short_change   ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* ── 統計列 ──────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center flex-wrap gap-x-6 gap-y-1 px-4 py-2 border-b text-xs"
        style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
      >
        {/* 融資 */}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: MARGIN_COLOR }} />
          <span style={{ color: "var(--text-secondary)" }}>融資</span>
          <span className="num font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatK(mb)}
          </span>
          <span
            className="num"
            style={{ color: mc >= 0 ? "var(--color-up)" : "var(--color-down)" }}
          >
            {mc >= 0 ? "+" : ""}{formatK(mc)}
          </span>
        </div>

        {/* 融券 */}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: SHORT_COLOR }} />
          <span style={{ color: "var(--text-secondary)" }}>融券</span>
          <span className="num font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatK(sb)}
          </span>
          <span
            className="num"
            style={{ color: sc >= 0 ? "var(--color-up)" : "var(--color-down)" }}
          >
            {sc >= 0 ? "+" : ""}{formatK(sc)}
          </span>
        </div>

        {/* 資券比 */}
        {latest?.ratio != null && (
          <div className="ml-auto flex items-center gap-1.5">
            <span style={{ color: "var(--text-tertiary)" }}>資券比</span>
            <span className="num font-semibold" style={{ color: "var(--text-primary)" }}>
              {latest.ratio.toFixed(1)}x
            </span>
          </div>
        )}
      </div>

      {/* ── 圖表區 ──────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        {/* 分隔線 */}
        <div
          className="pointer-events-none absolute z-10 w-full"
          style={{ top: "51%", borderTop: "1px solid #2A3045" }}
        />
        {/* 標籤 */}
        <div
          className="pointer-events-none absolute z-10 left-2 top-[3%] text-[10px] font-semibold"
          style={{ color: MARGIN_COLOR }}
        >
          融資餘額
        </div>
        <div
          className="pointer-events-none absolute z-10 left-2 text-[10px] font-semibold"
          style={{ top: "54%", color: SHORT_COLOR }}
        >
          融券餘額
        </div>
        <div ref={containerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
