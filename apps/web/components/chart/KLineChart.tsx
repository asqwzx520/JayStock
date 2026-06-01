"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
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

/** 統一 bar 型別：日K 用 KlineBar（有 date），分K 用 IntradayBar（有 time number） */
export type ChartBar = KlineBar | IntradayBar;

function barTime(d: ChartBar): Time {
  return ("time" in d ? d.time : d.date) as Time;
}
function barDate(d: ChartBar): string | undefined {
  return "date" in d ? d.date : undefined;
}
import { sma, ema, bollinger, macd, rsi, kd, type OHLCV } from "@/lib/indicators";

export type IndicatorType = "MA" | "EMA" | "BOLL" | "MACD" | "RSI" | "KD" | "CHIPS";

interface KLineChartProps {
  data: ChartBar[];
  indicators: IndicatorType[];
  chipsData?: ChipsBar[];
}

const MA_PERIODS = [5, 10, 20, 60];
const MA_COLORS = ["#FBBF24", "#60A5FA", "#A78BFA", "#F87171"];

export default function KLineChart({ data, indicators, chipsData }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<SeriesType>[]>([]);

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

    // ── Chips overlay layout ──────────────────────────────────
    // When CHIPS active, carve bottom 48% for 3 institutional lanes
    const hasChipsOverlay =
      !isIntraday &&
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

    const candles: CandlestickData<Time>[] = data.map((d) => ({
      time:  barTime(d),
      open:  d.open,
      high:  d.high,
      low:   d.low,
      close: d.close,
    }));

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#EF4444",
      downColor: "#22C55E",
      borderUpColor: "#EF4444",
      borderDownColor: "#22C55E",
      wickUpColor: "#EF4444",
      wickDownColor: "#22C55E",
    });
    candleSeries.setData(candles);
    seriesRefs.current.push(candleSeries);

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

    chart.timeScale().fitContent();
  }, [data, indicators, chipsData]);

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
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  return <div ref={containerRef} className="w-full h-full min-h-0" />;
}
