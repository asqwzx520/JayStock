"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
import type { KlineBar, IntradayBar, ChipsBar } from "@/lib/api";

/** K線圖類型 */
export type ChartType = "candle" | "hollow" | "heikin_ashi" | "line" | "area";

/** 繪圖工具 */
export type DrawingTool = "cursor" | "hline" | "trendline" | "erase";

interface Drawing {
  id: string;
  type: "hline" | "trendline";
  price1: number;
  time1?: Time;
  price2?: number;
  time2?: Time;
}

function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1; const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 統一 bar 型別：日K 用 KlineBar（有 date），分K 用 IntradayBar（有 time number） */
export type ChartBar = KlineBar | IntradayBar;

function barTime(d: ChartBar): Time {
  return ("time" in d ? d.time : d.date) as Time;
}
function barDate(d: ChartBar): string | undefined {
  return "date" in d ? d.date : undefined;
}
import { sma, ema, bollinger, macd, rsi, kd, vwap, wr, obv, type OHLCV } from "@/lib/indicators";

export type IndicatorType = "MA" | "EMA" | "BOLL" | "MACD" | "RSI" | "KD" | "CHIPS" | "VWAP" | "WR" | "OBV";

// ── Heikin-Ashi 計算 ──────────────────────────────────────────────────────────
function computeHeikinAshi(bars: ChartBar[]): CandlestickData<Time>[] {
  const result: CandlestickData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const haClose = (bar.open + bar.high + bar.low + bar.close) / 4;
    const haOpen = i === 0
      ? (bar.open + bar.close) / 2
      : (result[i - 1].open + result[i - 1].close) / 2;
    const haHigh = Math.max(bar.high, haOpen, haClose);
    const haLow  = Math.min(bar.low,  haOpen, haClose);
    result.push({ time: barTime(bar), open: haOpen, high: haHigh, low: haLow, close: haClose });
  }
  return result;
}

interface KLineChartProps {
  data: ChartBar[];
  indicators: IndicatorType[];
  chipsData?: ChipsBar[];
  chartType?: ChartType;
  activeTool?: DrawingTool;
  clearKey?: number;
}

const MA_PERIODS = [5, 10, 20, 60];
const MA_COLORS = ["#FBBF24", "#60A5FA", "#A78BFA", "#F87171"];

export default function KLineChart({ data, indicators, chipsData, chartType = "candle", activeTool = "cursor", clearKey }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<SeriesType>[]>([]);

  // ── Drawing canvas ────────────────────────────────────────────────────────
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const drawingsRef  = useRef<Drawing[]>([]);
  const pendingRef   = useRef<{ startX: number; startY: number } | null>(null);
  const redrawFnRef  = useRef<() => void>(() => {});
  const vpUnsubRef   = useRef<(() => void) | null>(null);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const main   = seriesRefs.current[0];
    if (!canvas || !chart || !main) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = canvas.width / dpr;
    for (const d of drawingsRef.current) {
      const y1 = main.priceToCoordinate(d.price1);
      if (y1 === null) continue;
      ctx.lineWidth = 1.5;
      if (d.type === "hline") {
        ctx.strokeStyle = "#F59E0B";
        ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(w, y1); ctx.stroke();
        // price label
        ctx.fillStyle = "#F59E0B";
        ctx.font = "10px JetBrains Mono, monospace";
        ctx.fillText(d.price1.toFixed(2), w - 52, y1 - 3);
      } else if (d.time1 !== undefined && d.time2 !== undefined && d.price2 !== undefined) {
        const x1 = chart.timeScale().timeToCoordinate(d.time1);
        const x2 = chart.timeScale().timeToCoordinate(d.time2);
        const y2 = main.priceToCoordinate(d.price2);
        if (x1 === null || x2 === null || y2 === null) continue;
        ctx.strokeStyle = "#60A5FA";
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        // endpoint dots
        ctx.fillStyle = "#60A5FA";
        ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }, []);

  // keep stable ref so buildChart can subscribe without stale closure
  useEffect(() => { redrawFnRef.current = redrawCanvas; }, [redrawCanvas]);

  const buildChart = useCallback(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRefs.current = [];
    }

    // 判斷是否為分K（first bar 的 time 是 number）
    const isIntraday = data.length > 0 && typeof barTime(data[0]) === "number";

    // line/area 不支援 CHIPS 疊圖（無 OHLC 空間）
    const isOHLC = chartType === "candle" || chartType === "hollow" || chartType === "heikin_ashi";

    // ── Chips overlay layout ──────────────────────────────────
    // When CHIPS active, carve bottom 48% for 3 institutional lanes
    const hasChipsOverlay =
      !isIntraday &&
      isOHLC &&
      indicators.includes("CHIPS") &&
      !!chipsData &&
      chipsData.length > 0;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94A3B8",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(42, 48, 69, 0.5)" },
        horzLines: { color: "rgba(42, 48, 69, 0.5)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "#2A3045",
        scaleMargins: {
          top: 0.05,
          bottom: hasChipsOverlay ? 0.50 : 0.25,
        },
      },
      timeScale: {
        borderColor:  "#2A3045",
        timeVisible:  isIntraday,   // 分K 顯示時間軸 HH:MM
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // ── 主 series（依 chartType 分流）────────────────────────
    if (chartType === "line") {
      // 折線圖：收盤價連線
      const lineData: LineData<Time>[] = data.map((d) => ({
        time: barTime(d), value: d.close,
      }));
      const series = chart.addSeries(LineSeries, {
        color: "#3B82F6",
        lineWidth: 2,
        priceLineVisible: false,
      });
      series.setData(lineData);
      seriesRefs.current.push(series);

    } else if (chartType === "area") {
      // 面積圖：收盤價填色
      const areaData: LineData<Time>[] = data.map((d) => ({
        time: barTime(d), value: d.close,
      }));
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#3B82F6",
        topColor: "rgba(59,130,246,0.25)",
        bottomColor: "rgba(59,130,246,0)",
        lineWidth: 2,
        priceLineVisible: false,
      });
      series.setData(areaData as Parameters<typeof series.setData>[0]);
      seriesRefs.current.push(series);

    } else if (chartType === "hollow") {
      // 空心K棒：收漲→空心紅框，收跌→實心綠
      const hollowData = data.map((d) => ({
        time:  barTime(d),
        open:  d.open, high: d.high, low: d.low, close: d.close,
        // 嚴格 > 讓 doji（close=open）顯示實心，而非透明消失
        color:       d.close > d.open ? "rgba(0,0,0,0)" : "#22C55E",
        borderColor: d.close > d.open ? "#EF4444"       : "#22C55E",
        wickColor:   d.close > d.open ? "#EF4444"       : "#22C55E",
      }));
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "rgba(0,0,0,0)", downColor: "#22C55E",
        borderUpColor: "#EF4444", borderDownColor: "#22C55E",
        wickUpColor: "#EF4444",   wickDownColor: "#22C55E",
      });
      series.setData(hollowData as CandlestickData<Time>[]);
      seriesRefs.current.push(series);

    } else if (chartType === "heikin_ashi") {
      // 平均K棒 (Heikin-Ashi)
      const haData = computeHeikinAshi(data);
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#EF4444", downColor: "#22C55E",
        borderUpColor: "#EF4444", borderDownColor: "#22C55E",
        wickUpColor: "#EF4444",   wickDownColor: "#22C55E",
      });
      series.setData(haData);
      seriesRefs.current.push(series);

    } else {
      // 標準蠟燭 (candle，預設)
      const candles: CandlestickData<Time>[] = data.map((d) => ({
        time: barTime(d), open: d.open, high: d.high, low: d.low, close: d.close,
      }));
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#EF4444",        downColor: "#22C55E",
        borderUpColor: "#EF4444", borderDownColor: "#22C55E",
        wickUpColor: "#EF4444",   wickDownColor: "#22C55E",
      });
      candleSeries.setData(candles);
      seriesRefs.current.push(candleSeries);
    }

    const volumeData: HistogramData<Time>[] = data.map((d) => ({
      time:  barTime(d),
      value: d.volume,
      color: d.close >= d.open
        ? "rgba(239, 68, 68, 0.3)"
        : "rgba(34, 197, 94, 0.3)",
    }));

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({
      // When chips overlay is active, squeeze volume into a mid-stripe
      scaleMargins: hasChipsOverlay
        ? { top: 0.53, bottom: 0.42 }
        : { top: 0.80, bottom: 0 },
    });
    volumeSeries.setData(volumeData);
    seriesRefs.current.push(volumeSeries);

    const closes = data.map((d) => d.close);
    const bars: OHLCV[] = data.map((d) => ({
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

    if (indicators.includes("MA")) {
      MA_PERIODS.forEach((period, idx) => {
        const values = sma(closes, period);
        const lineData: LineData<Time>[] = [];
        values.forEach((v, i) => {
          if (v !== null) {
            lineData.push({ time: barTime(data[i]), value: v });
          }
        });
        const series = chart.addSeries(LineSeries, {
          color: MA_COLORS[idx],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        series.setData(lineData);
        seriesRefs.current.push(series);
      });
    }

    if (indicators.includes("EMA")) {
      [12, 26].forEach((period, idx) => {
        const values = ema(closes, period);
        const lineData: LineData<Time>[] = [];
        values.forEach((v, i) => {
          if (v !== null) {
            lineData.push({ time: barTime(data[i]), value: v });
          }
        });
        const series = chart.addSeries(LineSeries, {
          color: idx === 0 ? "#F472B6" : "#34D399",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        series.setData(lineData);
        seriesRefs.current.push(series);
      });
    }

    if (indicators.includes("BOLL")) {
      const boll = bollinger(closes, 20, 2);
      const addBollLine = (values: (number | null)[], color: string, dash?: boolean) => {
        const lineData: LineData<Time>[] = [];
        values.forEach((v, i) => {
          if (v !== null) {
            lineData.push({ time: barTime(data[i]), value: v });
          }
        });
        const series = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: dash ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        series.setData(lineData);
        seriesRefs.current.push(series);
      };
      addBollLine(boll.upper, "#60A5FA", true);
      addBollLine(boll.middle, "#60A5FA");
      addBollLine(boll.lower, "#60A5FA", true);
    }

    if (indicators.includes("MACD")) {
      const m = macd(closes);
      const macdLineData: LineData<Time>[] = [];
      const signalLineData: LineData<Time>[] = [];
      const histData: HistogramData<Time>[] = [];

      m.macd.forEach((v, i) => {
        if (v !== null) {
          macdLineData.push({ time: barTime(data[i]), value: v });
        }
      });
      m.signal.forEach((v, i) => {
        if (v !== null) {
          signalLineData.push({ time: barTime(data[i]), value: v });
        }
      });
      m.histogram.forEach((v, i) => {
        if (v !== null) {
          histData.push({
            time:  barTime(data[i]),
            value: v,
            color: v >= 0 ? "rgba(239, 68, 68, 0.6)" : "rgba(34, 197, 94, 0.6)",
          });
        }
      });

      const macdHist = chart.addSeries(HistogramSeries, {
        priceScaleId: "macd",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      macdHist.priceScale().applyOptions({
        scaleMargins: { top: 0.7, bottom: 0.02 },
      });
      macdHist.setData(histData);

      const macdLine = chart.addSeries(LineSeries, {
        color: "#FBBF24",
        lineWidth: 1,
        priceScaleId: "macd",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      macdLine.setData(macdLineData);

      const signalLine = chart.addSeries(LineSeries, {
        color: "#60A5FA",
        lineWidth: 1,
        priceScaleId: "macd",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      signalLine.setData(signalLineData);

      seriesRefs.current.push(macdHist, macdLine, signalLine);
    }

    if (indicators.includes("RSI")) {
      const r = rsi(closes, 14);
      const lineData: LineData<Time>[] = [];
      r.values.forEach((v, i) => {
        if (v !== null) {
          lineData.push({ time: barTime(data[i]), value: v });
        }
      });
      const series = chart.addSeries(LineSeries, {
        color: "#A78BFA",
        lineWidth: 1,
        priceScaleId: "rsi",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.priceScale().applyOptions({
        scaleMargins: { top: 0.7, bottom: 0.02 },
      });
      series.setData(lineData);
      seriesRefs.current.push(series);
    }

    if (indicators.includes("KD")) {
      const result = kd(bars);
      const kData: LineData<Time>[] = [];
      const dData: LineData<Time>[] = [];
      result.k.forEach((v, i) => {
        if (v !== null) kData.push({ time: barTime(data[i]), value: v });
      });
      result.d.forEach((v, i) => {
        if (v !== null) dData.push({ time: barTime(data[i]), value: v });
      });

      const kLine = chart.addSeries(LineSeries, {
        color: "#FBBF24",
        lineWidth: 1,
        priceScaleId: "kd",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      kLine.priceScale().applyOptions({
        scaleMargins: { top: 0.7, bottom: 0.02 },
      });
      kLine.setData(kData);

      const dLine = chart.addSeries(LineSeries, {
        color: "#A78BFA",
        lineWidth: 1,
        priceScaleId: "kd",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      dLine.setData(dData);

      seriesRefs.current.push(kLine, dLine);
    }

    if (indicators.includes("VWAP")) {
      // VWAP：疊在主圖價格軸（分K 用累積模式，日K 用滾動 20 根）
      const vwapValues = vwap(bars, isIntraday ? 0 : 20);
      const vwapData: LineData<Time>[] = [];
      vwapValues.forEach((v, i) => {
        if (v !== null) vwapData.push({ time: barTime(data[i]), value: v });
      });
      const vwapLine = chart.addSeries(LineSeries, {
        color: "#E879F9",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "VWAP",
      });
      vwapLine.setData(vwapData);
      seriesRefs.current.push(vwapLine);
    }

    if (indicators.includes("WR")) {
      const wrResult = wr(bars, 14);
      const wrData: LineData<Time>[] = [];
      wrResult.values.forEach((v, i) => {
        if (v !== null) wrData.push({ time: barTime(data[i]), value: v });
      });
      const wrLine = chart.addSeries(LineSeries, {
        color: "#FB923C",
        lineWidth: 1,
        priceScaleId: "wr",
        priceLineVisible: false,
        lastValueVisible: false,
        title: "%R",
      });
      wrLine.priceScale().applyOptions({
        scaleMargins: { top: 0.7, bottom: 0.02 },
      });
      wrLine.setData(wrData);
      seriesRefs.current.push(wrLine);
    }

    if (indicators.includes("OBV")) {
      const obvResult = obv(bars);
      const obvData: LineData<Time>[] = obvResult.values.map((v, i) => ({
        time: barTime(data[i]), value: v,
      }));
      const obvLine = chart.addSeries(LineSeries, {
        color: "#22D3EE",
        lineWidth: 1,
        priceScaleId: "obv",
        priceLineVisible: false,
        lastValueVisible: false,
        title: "OBV",
      });
      obvLine.priceScale().applyOptions({
        scaleMargins: { top: 0.7, bottom: 0.02 },
      });
      obvLine.setData(obvData);
      seriesRefs.current.push(obvLine);
    }

    // ── 法人籌碼疊圖 ─────────────────────────────────────────
    if (hasChipsOverlay && chipsData) {
      const chipsMap = new Map(chipsData.map((c) => [c.date, c]));

      type ChipsSeries = { key: "foreign_net" | "trust_net" | "dealer_net"; upColor: string; id: string; top: number; bottom: number };
      const lanes: ChipsSeries[] = [
        { key: "foreign_net", upColor: "rgba(245,158,11,0.75)",  id: "chips_f", top: 0.62, bottom: 0.26 },
        { key: "trust_net",   upColor: "rgba(139,92,246,0.75)",  id: "chips_t", top: 0.76, bottom: 0.12 },
        { key: "dealer_net",  upColor: "rgba(6,182,212,0.75)",   id: "chips_d", top: 0.88, bottom: 0.02 },
      ];
      const DOWN_COLOR = "rgba(239,68,68,0.65)";

      for (const lane of lanes) {
        const series = chart.addSeries(HistogramSeries, {
          priceScaleId:     lane.id,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        series.priceScale().applyOptions({
          scaleMargins:  { top: lane.top, bottom: lane.bottom },
          borderVisible: false,
        });
        series.setData(
          data
            .filter((d) => { const dt = barDate(d); return !!dt && chipsMap.has(dt); })
            .map((d) => {
              const dt  = barDate(d)!;
              const c   = chipsMap.get(dt)!;
              const val = c[lane.key] as number;
              return {
                time:  barTime(d),
                value: val,
                color: val >= 0 ? lane.upColor : DOWN_COLOR,
              };
            })
        );
        seriesRefs.current.push(series);
      }
    }

    // ── Canvas: size to container ─────────────────────────────────────────
    const canvas = canvasRef.current;
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = container.clientWidth  * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width  = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
    }

    // ── Subscribe viewport changes → redraw drawings ──────────────────────
    vpUnsubRef.current?.();
    const vp = () => redrawFnRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(vp);
    vpUnsubRef.current = () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(vp);

    chart.timeScale().fitContent();
    // Draw after fit (viewport changes may not fire synchronously)
    setTimeout(() => redrawFnRef.current(), 0);
  }, [data, indicators, chipsData, chartType]);

  useEffect(() => {
    buildChart();
  }, [buildChart]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      if (chartRef.current) {
        chartRef.current.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
      const cv = canvasRef.current;
      if (cv) {
        const dpr = window.devicePixelRatio || 1;
        cv.width  = container.clientWidth  * dpr;
        cv.height = container.clientHeight * dpr;
        cv.style.width  = `${container.clientWidth}px`;
        cv.style.height = `${container.clientHeight}px`;
        redrawFnRef.current();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Disable chart pan/zoom while a drawing tool is active
  useEffect(() => {
    if (!chartRef.current) return;
    const drawing = activeTool !== "cursor";
    chartRef.current.applyOptions({ handleScroll: !drawing, handleScale: !drawing });
  }, [activeTool]);

  // Clear all drawings when clearKey changes
  useEffect(() => {
    if (clearKey === undefined) return;
    drawingsRef.current = [];
    redrawFnRef.current();
  }, [clearKey]);

  // ── Canvas mouse handlers ─────────────────────────────────────────────────
  const handleCanvasDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const chart = chartRef.current;
    const main  = seriesRefs.current[0];
    if (!chart || !main || activeTool === "cursor") return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === "hline") {
      const price = main.coordinateToPrice(y);
      if (price === null) return;
      drawingsRef.current = [...drawingsRef.current, { id: `h${Date.now()}`, type: "hline", price1: price }];
      redrawFnRef.current();

    } else if (activeTool === "trendline") {
      pendingRef.current = { startX: x, startY: y };

    } else if (activeTool === "erase") {
      const THR = 8;
      const idx = drawingsRef.current.findIndex((d) => {
        if (d.type === "hline") {
          const py = main.priceToCoordinate(d.price1);
          return py !== null && Math.abs(py - y) <= THR;
        }
        if (d.type === "trendline" && d.time1 && d.time2 && d.price2 !== undefined) {
          const x1 = chart.timeScale().timeToCoordinate(d.time1);
          const x2 = chart.timeScale().timeToCoordinate(d.time2);
          const y1 = main.priceToCoordinate(d.price1);
          const y2 = main.priceToCoordinate(d.price2);
          if (x1 === null || x2 === null || y1 === null || y2 === null) return false;
          return pointToSegmentDist(x, y, x1, y1, x2, y2) <= THR;
        }
        return false;
      });
      if (idx >= 0) {
        drawingsRef.current = drawingsRef.current.filter((_, i) => i !== idx);
        redrawFnRef.current();
      }
    }
  }, [activeTool]);

  const handleCanvasUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool !== "trendline" || !pendingRef.current) return;
    const chart = chartRef.current;
    const main  = seriesRefs.current[0];
    if (!chart || !main) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    const { startX, startY } = pendingRef.current;
    pendingRef.current = null;
    if (Math.abs(x2 - startX) < 5 && Math.abs(y2 - startY) < 5) return;
    const time1  = chart.timeScale().coordinateToTime(startX);
    const price1 = main.coordinateToPrice(startY);
    const time2  = chart.timeScale().coordinateToTime(x2);
    const price2 = main.coordinateToPrice(y2);
    if (time1 && time2 && price1 !== null && price2 !== null) {
      drawingsRef.current = [...drawingsRef.current, {
        id: `t${Date.now()}`, type: "trendline",
        price1, time1, price2, time2,
      }];
      redrawFnRef.current();
    }
  }, [activeTool]);

  const isDrawing = activeTool !== "cursor";

  return (
    <div ref={containerRef} className="w-full h-full min-h-0 relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        style={{
          pointerEvents: isDrawing ? "all" : "none",
          cursor: activeTool === "hline"     ? "crosshair"
                : activeTool === "trendline" ? "crosshair"
                : activeTool === "erase"     ? "cell"
                : "default",
        }}
        onMouseDown={handleCanvasDown}
        onMouseUp={handleCanvasUp}
      />
    </div>
  );
}
