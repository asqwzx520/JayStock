"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type LineData,
  type HistogramData,
  type Time,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import { macd, rsi, kd, wr, obv, atr, adx, stochRsi, type OHLCV } from "@/lib/indicators";
import type { ChartBar } from "@/components/chart/KLineChart";
import type { IndicatorParams } from "@/lib/indicatorParams";

export type SubIndicatorType = "MACD" | "RSI" | "KD" | "WR" | "OBV" | "ATR" | "ADX" | "SRSI";

function barTime(d: ChartBar): Time {
  return (("time" in d ? d.time : d.date) as Time);
}

interface SubIndicatorPanelProps {
  indicator:      SubIndicatorType;
  data:            ChartBar[];
  params:          IndicatorParams;
  /** 可選；不傳則填滿父容器（建議用 flex 分配）*/
  height?:         number;
  showTimeAxis?:   boolean;          // 只有最下面一個面板顯示
  syncRange?:      { from: number; to: number } | null;
  onRangeChange?:  (range: { from: number; to: number }) => void;
}

export default function SubIndicatorPanel({
  indicator, data, params, height, showTimeAxis = false, syncRange, onRangeChange,
}: SubIndicatorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRefs   = useRef<ISeriesApi<SeriesType>[]>([]);
  const isSyncingRef = useRef(false);

  const buildChart = useCallback(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    chartRef.current?.remove();
    chartRef.current   = null;
    seriesRefs.current = [];

    const isIntraday = data.length > 0 && typeof barTime(data[0]) === "number";
    const closes: number[] = data.map((d) => d.close);
    const bars: OHLCV[]    = data.map((d) => ({ open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }));

    const chart = createChart(container, {
      width:  container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor:  "#94A3B8",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize:   10,
      },
      grid: {
        vertLines: { color: "rgba(42, 48, 69, 0.5)" },
        horzLines: { color: "rgba(42, 48, 69, 0.5)" },
      },
      crosshair:       { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2A3045", scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: {
        borderColor:    "#2A3045",
        visible:        showTimeAxis,
        timeVisible:    isIntraday,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale:  true,
    });
    chartRef.current = chart;

    // ── 根據指標建立 series ──────────────────────────────────────────────────
    if (indicator === "MACD") {
      const { fast, slow, signal } = params.MACD;
      const m = macd(closes, fast, slow, signal);
      const histData: HistogramData<Time>[] = [];
      const macdLine: LineData<Time>[]      = [];
      const sigLine:  LineData<Time>[]      = [];
      m.histogram.forEach((v, i) => {
        if (v !== null) histData.push({ time: barTime(data[i]), value: v, color: v >= 0 ? "rgba(239,68,68,0.6)" : "rgba(34,197,94,0.6)" });
      });
      m.macd.forEach((v, i)   => { if (v !== null) macdLine.push({ time: barTime(data[i]), value: v }); });
      m.signal.forEach((v, i) => { if (v !== null) sigLine.push({ time: barTime(data[i]), value: v }); });
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
      const ml   = chart.addSeries(LineSeries, { color: "#FBBF24", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "MACD" });
      const sl   = chart.addSeries(LineSeries, { color: "#60A5FA", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "Signal" });
      hist.setData(histData); ml.setData(macdLine); sl.setData(sigLine);
      seriesRefs.current.push(hist, ml, sl);
    }

    if (indicator === "RSI") {
      const r = rsi(closes, params.RSI.period);
      const lineData: LineData<Time>[] = [];
      r.values.forEach((v, i) => { if (v !== null) lineData.push({ time: barTime(data[i]), value: v }); });
      const s = chart.addSeries(LineSeries, { color: "#A78BFA", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: `RSI(${params.RSI.period})` });
      s.setData(lineData);
      seriesRefs.current.push(s);
    }

    if (indicator === "KD") {
      const result = kd(bars, params.KD.period);
      const kData: LineData<Time>[] = [], dData: LineData<Time>[] = [];
      result.k.forEach((v, i) => { if (v !== null) kData.push({ time: barTime(data[i]), value: v }); });
      result.d.forEach((v, i) => { if (v !== null) dData.push({ time: barTime(data[i]), value: v }); });
      const kL = chart.addSeries(LineSeries, { color: "#FBBF24", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "K" });
      const dL = chart.addSeries(LineSeries, { color: "#A78BFA", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "D" });
      kL.setData(kData); dL.setData(dData);
      seriesRefs.current.push(kL, dL);
    }

    if (indicator === "WR") {
      const result = wr(bars, params.WR.period);
      const lineData: LineData<Time>[] = [];
      result.values.forEach((v, i) => { if (v !== null) lineData.push({ time: barTime(data[i]), value: v }); });
      const s = chart.addSeries(LineSeries, { color: "#FB923C", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: `%R(${params.WR.period})` });
      s.setData(lineData);
      seriesRefs.current.push(s);
    }

    if (indicator === "OBV") {
      const result = obv(bars);
      const s = chart.addSeries(LineSeries, { color: "#22D3EE", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "OBV" });
      s.setData(result.values.map((v, i) => ({ time: barTime(data[i]), value: v })));
      seriesRefs.current.push(s);
    }

    if (indicator === "ATR") {
      const result = atr(bars, params.ATR.period);
      const lineData: LineData<Time>[] = [];
      result.values.forEach((v, i) => { if (v !== null) lineData.push({ time: barTime(data[i]), value: v }); });
      const s = chart.addSeries(LineSeries, { color: "#FB923C", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: `ATR(${params.ATR.period})` });
      s.setData(lineData);
      seriesRefs.current.push(s);
    }

    if (indicator === "ADX") {
      const result = adx(bars, params.ADX.period);
      const addL = (vals: (number | null)[], color: string, title: string) => {
        const ld: LineData<Time>[] = [];
        vals.forEach((v, i) => { if (v !== null) ld.push({ time: barTime(data[i]), value: v }); });
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title });
        s.setData(ld);
        seriesRefs.current.push(s);
      };
      addL(result.adx,     "#FBBF24", "ADX");
      addL(result.diPlus,  "#22C55E", "DI+");
      addL(result.diMinus, "#EF4444", "DI−");
    }

    if (indicator === "SRSI") {
      const result = stochRsi(closes, params.SRSI.period, params.SRSI.period, 3, 3);
      const kData: LineData<Time>[] = [], dData: LineData<Time>[] = [];
      result.k.forEach((v, i) => { if (v !== null) kData.push({ time: barTime(data[i]), value: v }); });
      result.d.forEach((v, i) => { if (v !== null) dData.push({ time: barTime(data[i]), value: v }); });
      const kL = chart.addSeries(LineSeries, { color: "#FBBF24", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "%K" });
      const dL = chart.addSeries(LineSeries, { color: "#A78BFA", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "%D" });
      kL.setData(kData); dL.setData(dData);
      seriesRefs.current.push(kL, dL);
    }

    // 時間軸同步：此面板變化時通知父元件
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (isSyncingRef.current || !range) return;
      onRangeChange?.({ from: range.from, to: range.to });
    });

    chart.timeScale().fitContent();
  }, [data, indicator, params, showTimeAxis, onRangeChange]);

  useEffect(() => { buildChart(); }, [buildChart]);

  // 接收外部同步範圍
  useEffect(() => {
    if (!syncRange || !chartRef.current) return;
    isSyncingRef.current = true;
    chartRef.current.timeScale().setVisibleLogicalRange(syncRange);
    // 短暫鎖定避免 loop
    setTimeout(() => { isSyncingRef.current = false; }, 50);
  }, [syncRange]);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      chartRef.current?.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const label = indicator === "MACD"
    ? `MACD(${params.MACD.fast},${params.MACD.slow},${params.MACD.signal})`
    : indicator;

  return (
    <div
      className="relative flex flex-col overflow-hidden h-full"
      style={height !== undefined ? { height: `${height}px` } : undefined}
    >
      {/* 指標名稱標籤 */}
      <div
        className="absolute top-1 left-2 z-10 text-[9px] font-semibold pointer-events-none"
        style={{ color: "var(--text-tertiary)", letterSpacing: "0.06em" }}
      >
        {label}
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
