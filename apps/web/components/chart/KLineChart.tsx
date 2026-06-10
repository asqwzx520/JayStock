"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type CandlestickData,
  type LineData,
  type Time,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
import type { KlineBar, IntradayBar, ChipsBar, CandlePattern } from "@/lib/api";

/** K線圖類型 */
export type ChartType = "candle" | "hollow" | "heikin_ashi" | "line" | "area";

/** 繪圖工具 */
export type DrawingTool =
  | "cursor"
  | "hline"
  | "trendline"
  | "erase"
  | "fibonacci"
  | "rectangle"
  | "text"
  | "channel";

interface Drawing {
  id: string;
  type: "hline" | "trendline" | "fibonacci" | "rectangle" | "text" | "channel";
  price1: number;
  time1?: Time;
  price2?: number;
  time2?: Time;
  /** channel: price of the offset (parallel) line at time1 */
  price3?: number;
  /** text label content */
  text?: string;
}

// ── Fibonacci retracement levels ──────────────────────────────────────────────
const FIB_LEVELS: { ratio: number; label: string; color: string }[] = [
  { ratio: 0,     label: "0.000", color: "#94A3B8" },
  { ratio: 0.236, label: "0.236", color: "#FBBF24" },
  { ratio: 0.382, label: "0.382", color: "#F87171" },
  { ratio: 0.5,   label: "0.500", color: "#4ADE80" },
  { ratio: 0.618, label: "0.618", color: "#F87171" },
  { ratio: 0.786, label: "0.786", color: "#FBBF24" },
  { ratio: 1.0,   label: "1.000", color: "#94A3B8" },
];

// ── Geometry helpers ──────────────────────────────────────────────────────────
function pointToSegmentDist(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1; const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitTestDrawing(
  d: Drawing,
  x: number, y: number,
  chart: IChartApi,
  main: ISeriesApi<SeriesType>,
): boolean {
  const THR = 8;

  if (d.type === "hline") {
    const py = main.priceToCoordinate(d.price1);
    return py !== null && Math.abs(py - y) <= THR;
  }

  if (d.type === "trendline" && d.time1 !== undefined && d.time2 !== undefined && d.price2 !== undefined) {
    const x1 = chart.timeScale().timeToCoordinate(d.time1);
    const x2 = chart.timeScale().timeToCoordinate(d.time2);
    const y1 = main.priceToCoordinate(d.price1);
    const y2 = main.priceToCoordinate(d.price2);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return false;
    return pointToSegmentDist(x, y, x1, y1, x2, y2) <= THR;
  }

  if (d.type === "fibonacci" && d.price2 !== undefined) {
    const high = Math.max(d.price1, d.price2);
    const low  = Math.min(d.price1, d.price2);
    return FIB_LEVELS.some(({ ratio }) => {
      const price = high - ratio * (high - low);
      const py = main.priceToCoordinate(price);
      return py !== null && Math.abs(py - y) <= THR;
    });
  }

  if (d.type === "rectangle" && d.time1 !== undefined && d.time2 !== undefined && d.price2 !== undefined) {
    const x1 = chart.timeScale().timeToCoordinate(d.time1);
    const x2 = chart.timeScale().timeToCoordinate(d.time2);
    const y1 = main.priceToCoordinate(d.price1);
    const y2 = main.priceToCoordinate(d.price2);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return false;
    const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
    const nearV = (xv: number) => Math.abs(x - xv) <= THR && y >= ry - THR && y <= ry + rh + THR;
    const nearH = (yh: number) => Math.abs(y - yh) <= THR && x >= rx - THR && x <= rx + rw + THR;
    return nearV(rx) || nearV(rx + rw) || nearH(ry) || nearH(ry + rh);
  }

  if (d.type === "text" && d.time1 !== undefined) {
    const tx = chart.timeScale().timeToCoordinate(d.time1);
    const ty = main.priceToCoordinate(d.price1);
    if (tx === null || ty === null) return false;
    return Math.hypot(x - tx, y - ty) <= 20;
  }

  if (d.type === "channel" && d.time1 !== undefined && d.time2 !== undefined && d.price2 !== undefined && d.price3 !== undefined) {
    const x1 = chart.timeScale().timeToCoordinate(d.time1);
    const x2 = chart.timeScale().timeToCoordinate(d.time2);
    const y1 = main.priceToCoordinate(d.price1);
    const y2 = main.priceToCoordinate(d.price2);
    const yBase3 = main.priceToCoordinate(d.price3);
    if (x1 === null || x2 === null || y1 === null || y2 === null || yBase3 === null) return false;
    const yOff = yBase3 - y1;
    return (
      pointToSegmentDist(x, y, x1, y1, x2, y2) <= THR ||
      pointToSegmentDist(x, y, x1, y1 + yOff, x2, y2 + yOff) <= THR
    );
  }

  return false;
}

// ── localStorage helpers ──────────────────────────────────────────────────────
const LS_PREFIX = "stockpulse_drawings_";
function lsLoad(symbol: string): Drawing[] {
  if (!symbol || typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(`${LS_PREFIX}${symbol}`) ?? "[]"); } catch { return []; }
}
function lsSave(symbol: string, drawings: Drawing[]) {
  if (!symbol || typeof window === "undefined") return;
  try { localStorage.setItem(`${LS_PREFIX}${symbol}`, JSON.stringify(drawings)); } catch {}
}
function lsClear(symbol: string) {
  if (!symbol || typeof window === "undefined") return;
  try { localStorage.removeItem(`${LS_PREFIX}${symbol}`); } catch {}
}

/** 統一 bar 型別：日K 用 KlineBar（有 date），分K 用 IntradayBar（有 time number） */
export type ChartBar = KlineBar | IntradayBar;

function barTime(d: ChartBar): Time {
  return ("time" in d ? d.time : d.date) as Time;
}
function barDate(d: ChartBar): string | undefined {
  return "date" in d ? d.date : undefined;
}
/**
 * LW Charts v5 回傳的 param.time 對日K 是 BusinessDay 物件 {year,month,day}，
 * 對分K 是 number (UTCTimestamp)，對字串型別則直接返回字串。
 * 統一轉換為可比較的字串/數字字串，避免 String(BusinessDay) → "[object Object]"。
 */
function timeToKey(t: Time): string {
  if (typeof t === "number") return String(t);
  if (typeof t === "string") return t;
  // BusinessDay {year, month, day}
  const bd = t as { year: number; month: number; day: number };
  return `${bd.year}-${String(bd.month).padStart(2, "0")}-${String(bd.day).padStart(2, "0")}`;
}
import { sma, ema, bollinger, vwap, vwapBand, ichimoku, type OHLCV } from "@/lib/indicators";
import { type IndicatorParams, DEFAULT_PARAMS } from "@/lib/indicatorParams";
import IndicatorParamPopover from "@/components/chart/IndicatorParamPopover";

export type IndicatorType = "MA" | "EMA" | "BOLL" | "MACD" | "RSI" | "KD" | "CHIPS" | "VWAP" | "VWAP_BAND" | "WR" | "OBV" | "ATR" | "ADX" | "SRSI" | "ICHI";

/** Sub-panel 指標（由 ChartWithPanels 渲染，不在主圖）*/
export const SUB_PANEL_INDICATORS: IndicatorType[] = ["MACD", "RSI", "KD", "WR", "OBV", "ATR", "ADX", "SRSI"];

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
  data:              ChartBar[];
  indicators:        IndicatorType[];
  chipsData?:        ChipsBar[];
  chartType?:        ChartType;
  activeTool?:       DrawingTool;
  clearKey?:         number;
  symbol?:           string;
  patternMarkers?:   CandlePattern[];
  /** 指標參數（含 MA 週期、BOLL 標準差等）*/
  indicatorParams?:  IndicatorParams;
  /** 參數變更回呼（供父元件儲存到 localStorage）*/
  onParamsChange?:   (p: IndicatorParams) => void;
  /** 十字線移動時回呼對應 bar；滑鼠離開時傳 null */
  onCrosshairMove?:  (bar: ChartBar | null) => void;
  /** 全螢幕按鈕；不提供則隱藏 */
  onFullscreen?:     () => void;
  /** ESC 等事件通知父層切換繪圖工具 */
  onToolChange?:     (tool: DrawingTool) => void;
}

const MA_COLORS = ["#FBBF24", "#60A5FA", "#A78BFA", "#F87171"];

const ZOOM_BTN_STYLE: React.CSSProperties = {
  width:      22,
  height:     22,
  fontSize:   13,
  fontWeight: 600,
  background: "rgba(15,23,42,0.75)",
  border:     "1px solid rgba(148,163,184,0.35)",
  color:      "#E2E8F0",
  opacity:    0.65,
  lineHeight: 1,
  cursor:     "pointer",
};

// ── Pattern marker helpers ────────────────────────────────────────────────────

const PATTERN_COLORS = {
  bullish: "#22C55E",
  bearish: "#EF4444",
  neutral: "#94A3B8",
} as const;

function buildSeriesMarkers(patterns: CandlePattern[]): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = patterns.map((p) => ({
    time:     p.date as Time,
    position: p.direction === "bullish" ? "belowBar" : p.direction === "bearish" ? "aboveBar" : "inBar",
    color:    PATTERN_COLORS[p.direction],
    shape:    p.direction === "bullish" ? "arrowUp" : p.direction === "bearish" ? "arrowDown" : "circle",
    text:     "",
    size:     0.6,
  }));
  // lightweight-charts requires markers sorted by time
  return markers.sort((a, b) => (a.time as string).localeCompare(b.time as string));
}

export default function KLineChart({
  data,
  indicators,
  chipsData,
  chartType = "candle",
  activeTool = "cursor",
  clearKey,
  symbol = "",
  patternMarkers,
  indicatorParams: paramsProp,
  onParamsChange,
  onCrosshairMove,
  onFullscreen,
  onToolChange,
}: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRefs   = useRef<ISeriesApi<SeriesType>[]>([]);
  // Pattern markers plugin ref — created after main series is ready
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // ── 指標參數（外部控制或內部 fallback）────────────────────────────────────
  const params = paramsProp ?? DEFAULT_PARAMS;

  // ── 參數 Popover 狀態 ──────────────────────────────────────────────────────
  const [paramPopover, setParamPopover] = useState<keyof IndicatorParams | null>(null);
  // 儲存各 legend 按鈕的 DOM 元素，使用 callback ref 寫入（不在 render 階段讀取）
  const legendBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // ── 十字線懸停的 bar（只用 setter，值透過 onCrosshairMove 傳給父層）─────
  const [, setHoveredBar] = useState<ChartBar | null>(null);

  // stable ref for onToolChange so ESC handler doesn't need it in deps
  const onToolChangeRef = useRef(onToolChange);
  useEffect(() => { onToolChangeRef.current = onToolChange; }, [onToolChange]);

  // ── Drawing canvas ────────────────────────────────────────────────────────
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const drawingsRef    = useRef<Drawing[]>([]);
  const undoStackRef   = useRef<Drawing[][]>([]);   // Ctrl+Z 快照堆疊
  const pendingRef     = useRef<{ startX: number; startY: number } | null>(null);
  const previewRef     = useRef<{ x: number; y: number } | null>(null);
  const redrawFnRef    = useRef<() => void>(() => {});
  const vpUnsubRef     = useRef<(() => void) | null>(null);
  const symbolRef      = useRef(symbol);
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);

  // Tool ref (so redrawCanvas can read it without deps)
  const activeToolRef  = useRef<DrawingTool>(activeTool);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // Channel drawing state machine (0=idle, 1=drawing baseline, 2=set offset)
  const channelPhaseRef = useRef<0 | 1 | 2>(0);
  // Mirrors channelPhaseRef for render (refs cannot be read during JSX render)
  const [channelPhase2, setChannelPhase2] = useState(false);
  const channelDraftRef = useRef<{ time1: Time; price1: number; time2: Time; price2: number } | null>(null);

  // Text-label overlay (HTML input)
  const [textOverlay, setTextOverlay] = useState<{
    canvasX: number; canvasY: number; time: Time; price: number;
  } | null>(null);
  const [textDraft, setTextDraft] = useState("");

  // ── Commit text label ─────────────────────────────────────────────────────
  const commitText = useCallback((overlay: typeof textOverlay, draft: string) => {
    if (!overlay || !draft.trim()) return;
    undoStackRef.current.push([...drawingsRef.current]);   // Undo 快照
    const next: Drawing[] = [
      ...drawingsRef.current,
      { id: `tx${Date.now()}`, type: "text", price1: overlay.price, time1: overlay.time, text: draft.trim() },
    ];
    drawingsRef.current = next;
    lsSave(symbolRef.current, next);
    redrawFnRef.current();
    setTextOverlay(null);
    setTextDraft("");
  }, []);

  // ── Canvas render ─────────────────────────────────────────────────────────
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const main   = seriesRefs.current[0];
    if (!canvas || !chart || !main) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx  = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = canvas.width / dpr;

    // ── Render saved drawings ───────────────────────────────────────────────
    for (const d of drawingsRef.current) {
      ctx.lineWidth = 1.5;

      // ── Horizontal line ─────────────────────────────────────────────────
      if (d.type === "hline") {
        const y1 = main.priceToCoordinate(d.price1);
        if (y1 === null) continue;
        ctx.strokeStyle = "#F59E0B";
        ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(w, y1); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#F59E0B";
        ctx.font = "10px JetBrains Mono, monospace";
        ctx.fillText(d.price1.toFixed(2), w - 52, y1 - 3);

      // ── Trend line ──────────────────────────────────────────────────────
      } else if (d.type === "trendline" && d.time1 !== undefined && d.time2 !== undefined && d.price2 !== undefined) {
        const x1 = chart.timeScale().timeToCoordinate(d.time1);
        const x2 = chart.timeScale().timeToCoordinate(d.time2);
        const y1 = main.priceToCoordinate(d.price1);
        const y2 = main.priceToCoordinate(d.price2);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        ctx.strokeStyle = "#60A5FA";
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.fillStyle = "#60A5FA";
        ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();

      // ── Fibonacci retracement ───────────────────────────────────────────
      } else if (d.type === "fibonacci" && d.time1 !== undefined && d.time2 !== undefined && d.price2 !== undefined) {
        const high = Math.max(d.price1, d.price2);
        const low  = Math.min(d.price1, d.price2);
        const x1c  = chart.timeScale().timeToCoordinate(d.time1);
        const x2c  = chart.timeScale().timeToCoordinate(d.time2);
        if (x1c === null || x2c === null) continue;

        // Golden zone shading (38.2% – 61.8%)
        const y382 = main.priceToCoordinate(high - 0.382 * (high - low));
        const y618 = main.priceToCoordinate(high - 0.618 * (high - low));
        if (y382 !== null && y618 !== null) {
          ctx.fillStyle = "rgba(74, 222, 128, 0.06)";
          ctx.fillRect(0, Math.min(y382, y618), w, Math.abs(y618 - y382));
        }

        // Vertical span
        const yTop = main.priceToCoordinate(high);
        const yBot = main.priceToCoordinate(low);
        if (yTop !== null && yBot !== null) {
          ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          for (const xv of [x1c, x2c]) {
            ctx.beginPath(); ctx.moveTo(xv, yTop); ctx.lineTo(xv, yBot); ctx.stroke();
          }
        }

        // Fib level lines + labels
        ctx.font = "10px JetBrains Mono, monospace";
        for (const { ratio, label, color } of FIB_LEVELS) {
          const price = high - ratio * (high - low);
          const fy    = main.priceToCoordinate(price);
          if (fy === null) continue;
          ctx.strokeStyle = color;
          ctx.lineWidth   = ratio === 0.618 || ratio === 0.382 ? 1.5 : 1;
          ctx.setLineDash([5, 3]);
          ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(w, fy); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.fillText(`${label}  ${price.toFixed(2)}`, w - 92, fy - 3);
        }

      // ── Rectangle ───────────────────────────────────────────────────────
      } else if (d.type === "rectangle" && d.time1 !== undefined && d.time2 !== undefined && d.price2 !== undefined) {
        const x1c = chart.timeScale().timeToCoordinate(d.time1);
        const x2c = chart.timeScale().timeToCoordinate(d.time2);
        const y1c = main.priceToCoordinate(d.price1);
        const y2c = main.priceToCoordinate(d.price2);
        if (x1c === null || x2c === null || y1c === null || y2c === null) continue;
        const rx = Math.min(x1c, x2c), ry = Math.min(y1c, y2c);
        const rw = Math.abs(x2c - x1c), rh = Math.abs(y2c - y1c);
        ctx.fillStyle   = "rgba(59, 130, 246, 0.07)";
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = "#3B82F6";
        ctx.setLineDash([]);
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(rx, ry, rw, rh);

      // ── Text label ──────────────────────────────────────────────────────
      } else if (d.type === "text" && d.time1 !== undefined && d.text) {
        const tx = chart.timeScale().timeToCoordinate(d.time1);
        const ty = main.priceToCoordinate(d.price1);
        if (tx === null || ty === null) continue;
        ctx.font = "11px JetBrains Mono, monospace";
        const tw = ctx.measureText(d.text).width;
        // background chip
        ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
        ctx.fillRect(tx - 2, ty - 15, tw + 10, 19);
        ctx.strokeStyle = "rgba(100, 116, 139, 0.55)";
        ctx.lineWidth   = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(tx - 2, ty - 15, tw + 10, 19);
        ctx.fillStyle = "#F1F5F9";
        ctx.fillText(d.text, tx + 3, ty);
        // anchor dot
        ctx.fillStyle = "#64748B";
        ctx.beginPath(); ctx.arc(tx, ty + 4, 2, 0, Math.PI * 2); ctx.fill();

      // ── Parallel channel ────────────────────────────────────────────────
      } else if (d.type === "channel" && d.time1 !== undefined && d.time2 !== undefined && d.price2 !== undefined && d.price3 !== undefined) {
        const x1c    = chart.timeScale().timeToCoordinate(d.time1);
        const x2c    = chart.timeScale().timeToCoordinate(d.time2);
        const y1c    = main.priceToCoordinate(d.price1);
        const y2c    = main.priceToCoordinate(d.price2);
        const yBase3 = main.priceToCoordinate(d.price3);
        if (x1c === null || x2c === null || y1c === null || y2c === null || yBase3 === null) continue;
        const yOff = yBase3 - y1c;

        // Fill between lines
        ctx.fillStyle = "rgba(34, 211, 238, 0.07)";
        ctx.beginPath();
        ctx.moveTo(x1c, y1c); ctx.lineTo(x2c, y2c);
        ctx.lineTo(x2c, y2c + yOff); ctx.lineTo(x1c, y1c + yOff);
        ctx.closePath(); ctx.fill();

        // Two lines
        ctx.strokeStyle = "#22D3EE";
        ctx.setLineDash([]);
        ctx.lineWidth   = 1.5;
        ctx.beginPath(); ctx.moveTo(x1c, y1c); ctx.lineTo(x2c, y2c); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1c, y1c + yOff); ctx.lineTo(x2c, y2c + yOff); ctx.stroke();

        // Endpoint dots
        ctx.fillStyle = "#22D3EE";
        for (const [xv, yv] of [[x1c, y1c], [x2c, y2c], [x1c, y1c + yOff], [x2c, y2c + yOff]] as [number, number][]) {
          ctx.beginPath(); ctx.arc(xv, yv, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // ── Previews (while dragging) ─────────────────────────────────────────
    const tool = activeToolRef.current;

    if (pendingRef.current && previewRef.current) {
      const { startX, startY } = pendingRef.current;
      const { x: cx, y: cy }  = previewRef.current;

      if (tool === "trendline" || (tool === "channel" && channelPhaseRef.current === 1)) {
        ctx.strokeStyle = "rgba(96,165,250,0.55)";
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(cx, cy); ctx.stroke();

      } else if (tool === "fibonacci") {
        const p1 = main.coordinateToPrice(startY);
        const p2 = main.coordinateToPrice(cy);
        if (p1 !== null && p2 !== null) {
          const high = Math.max(p1, p2), low = Math.min(p1, p2);
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 1;
          ctx.font = "10px JetBrains Mono, monospace";
          for (const { ratio, label, color } of FIB_LEVELS) {
            const fy = main.priceToCoordinate(high - ratio * (high - low));
            if (fy === null) continue;
            ctx.strokeStyle = color;
            ctx.setLineDash([5, 3]);
            ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(w, fy); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.fillText(label, w - 48, fy - 3);
          }
          ctx.globalAlpha = 1;
        }

      } else if (tool === "rectangle") {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle   = "rgba(59, 130, 246, 0.08)";
        ctx.fillRect(Math.min(startX, cx), Math.min(startY, cy), Math.abs(cx - startX), Math.abs(cy - startY));
        ctx.strokeStyle = "#3B82F6";
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(Math.min(startX, cx), Math.min(startY, cy), Math.abs(cx - startX), Math.abs(cy - startY));
        ctx.globalAlpha = 1;
      }
    }

    // Channel phase-2: baseline is set, mouse hover defines offset line
    if (tool === "channel" && channelPhaseRef.current === 2 && channelDraftRef.current && previewRef.current) {
      const draft = channelDraftRef.current;
      const bx1   = chart.timeScale().timeToCoordinate(draft.time1);
      const bx2   = chart.timeScale().timeToCoordinate(draft.time2);
      const by1   = main.priceToCoordinate(draft.price1);
      const by2   = main.priceToCoordinate(draft.price2);
      if (bx1 !== null && bx2 !== null && by1 !== null && by2 !== null) {
        const { x: mx, y: my } = previewRef.current;
        const baseYAtMx = Math.abs(bx2 - bx1) > 0.001
          ? by1 + (by2 - by1) * (mx - bx1) / (bx2 - bx1)
          : by1;
        const yOff = my - baseYAtMx;

        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = "#22D3EE";
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(bx1, by1); ctx.lineTo(bx2, by2); ctx.stroke();
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(bx1, by1 + yOff); ctx.lineTo(bx2, by2 + yOff); ctx.stroke();
        ctx.fillStyle = "rgba(34, 211, 238, 0.06)";
        ctx.beginPath();
        ctx.moveTo(bx1, by1); ctx.lineTo(bx2, by2);
        ctx.lineTo(bx2, by2 + yOff); ctx.lineTo(bx1, by1 + yOff);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
  }, []);

  // Keep stable ref so buildChart can subscribe without stale closure
  useEffect(() => { redrawFnRef.current = redrawCanvas; }, [redrawCanvas]);

  // Load saved drawings when symbol changes（同時清空 undo stack）
  useEffect(() => {
    if (!symbol) return;
    drawingsRef.current  = lsLoad(symbol);
    undoStackRef.current = [];
    pendingRef.current   = null;
    previewRef.current   = null;
    setTimeout(() => redrawFnRef.current(), 50);
  }, [symbol]);

  // Reset channel / pending when tool changes
  useEffect(() => {
    if (activeTool !== "channel") {
      channelPhaseRef.current = 0; setChannelPhase2(false);
      channelDraftRef.current = null;
    }
    if (!["trendline", "fibonacci", "rectangle", "channel"].includes(activeTool)) {
      pendingRef.current = null;
      previewRef.current = null;
      redrawFnRef.current();
    }
  }, [activeTool]);

  // Escape / Ctrl+Z keydown
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Z（或 Cmd+Z）：畫線 Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const prev = undoStackRef.current.pop();
        if (prev !== undefined) {
          drawingsRef.current = prev;
          lsSave(symbolRef.current, prev);
          redrawFnRef.current();
        }
        return;
      }
      if (e.key !== "Escape") return;
      if (channelPhaseRef.current > 0) {
        channelPhaseRef.current = 0; setChannelPhase2(false);
        channelDraftRef.current = null;
        pendingRef.current      = null;
        previewRef.current      = null;
        redrawFnRef.current();
      }
      setTextOverlay(null);
      setTextDraft("");
      onToolChangeRef.current?.("cursor");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const buildChart = useCallback(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current   = null;
      seriesRefs.current = [];
      markersPluginRef.current = null;
    }

    const isIntraday = data.length > 0 && typeof barTime(data[0]) === "number";
    const isOHLC     = chartType === "candle" || chartType === "hollow" || chartType === "heikin_ashi";
    const hasChipsOverlay =
      !isIntraday && isOHLC && indicators.includes("CHIPS") && !!chipsData && chipsData.length > 0;

    const chart = createChart(container, {
      width:  container.clientWidth,
      height: container.clientHeight,
      layout: {
        background:  { type: ColorType.Solid, color: "transparent" },
        textColor:   "#94A3B8",
        fontFamily:  "'JetBrains Mono', monospace",
        fontSize:    11,
      },
      grid: {
        vertLines: { color: "rgba(42, 48, 69, 0.5)" },
        horzLines: { color: "rgba(42, 48, 69, 0.5)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor:  "#2A3045",
        scaleMargins: { top: 0.05, bottom: hasChipsOverlay ? 0.50 : 0.25 },
      },
      timeScale: {
        borderColor:    "#2A3045",
        timeVisible:    isIntraday,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel:         true,
        pressedMouseMove:   true,
        horzTouchDrag:      true,
        vertTouchDrag:      true,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel:           true,
        pinch:                true,
      },
      kineticScroll: { touch: true, mouse: false },
    });

    chartRef.current = chart;

    // ── Main price series ─────────────────────────────────────────────────
    if (chartType === "line") {
      const s = chart.addSeries(LineSeries, { color: "#3B82F6", lineWidth: 2, priceLineVisible: false });
      s.setData(data.map((d) => ({ time: barTime(d), value: d.close })));
      seriesRefs.current.push(s);
    } else if (chartType === "area") {
      const s = chart.addSeries(AreaSeries, {
        lineColor: "#3B82F6", topColor: "rgba(59,130,246,0.25)", bottomColor: "rgba(59,130,246,0)",
        lineWidth: 2, priceLineVisible: false,
      });
      s.setData(data.map((d) => ({ time: barTime(d), value: d.close })) as Parameters<typeof s.setData>[0]);
      seriesRefs.current.push(s);
    } else if (chartType === "hollow") {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: "rgba(0,0,0,0)", downColor: "#22C55E",
        borderUpColor: "#EF4444", borderDownColor: "#22C55E",
        wickUpColor:   "#EF4444", wickDownColor:   "#22C55E",
      });
      s.setData(data.map((d) => ({
        time: barTime(d), open: d.open, high: d.high, low: d.low, close: d.close,
        color:       d.close > d.open ? "rgba(0,0,0,0)" : "#22C55E",
        borderColor: d.close > d.open ? "#EF4444"        : "#22C55E",
        wickColor:   d.close > d.open ? "#EF4444"        : "#22C55E",
      })) as CandlestickData<Time>[]);
      seriesRefs.current.push(s);
    } else if (chartType === "heikin_ashi") {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: "#EF4444", downColor: "#22C55E",
        borderUpColor: "#EF4444", borderDownColor: "#22C55E",
        wickUpColor:   "#EF4444", wickDownColor:   "#22C55E",
      });
      s.setData(computeHeikinAshi(data));
      seriesRefs.current.push(s);
    } else {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: "#EF4444", downColor: "#22C55E",
        borderUpColor: "#EF4444", borderDownColor: "#22C55E",
        wickUpColor:   "#EF4444", wickDownColor:   "#22C55E",
      });
      s.setData(data.map((d) => ({ time: barTime(d), open: d.open, high: d.high, low: d.low, close: d.close })));
      seriesRefs.current.push(s);
    }

    // ── Pattern markers (attached to main price series) ───────────────────
    const mainSeries = seriesRefs.current[0];
    if (mainSeries && patternMarkers && patternMarkers.length > 0) {
      markersPluginRef.current = createSeriesMarkers(mainSeries, buildSeriesMarkers(patternMarkers));
    }

    // ── Volume ────────────────────────────────────────────────────────────
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: hasChipsOverlay ? { top: 0.53, bottom: 0.42 } : { top: 0.80, bottom: 0 },
    });
    volSeries.setData(data.map((d) => ({
      time: barTime(d),
      value: d.volume,
      color: d.close >= d.open ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)",
    })));
    seriesRefs.current.push(volSeries);

    const closes = data.map((d) => d.close);
    const bars: OHLCV[] = data.map((d) => ({
      open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
    }));

    // ── Overlay indicators（主圖疊加，sub-panel 指標移至 ChartWithPanels）────
    if (indicators.includes("MA")) {
      params.MA.forEach((period, idx) => {
        const vals     = sma(closes, period);
        const lineData: LineData<Time>[] = [];
        vals.forEach((v, i) => { if (v !== null) lineData.push({ time: barTime(data[i]), value: v }); });
        const s = chart.addSeries(LineSeries, { color: MA_COLORS[idx % MA_COLORS.length], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        s.setData(lineData);
        seriesRefs.current.push(s);
      });
    }

    if (indicators.includes("EMA")) {
      const emaColors = ["#F472B6", "#34D399"];
      params.EMA.forEach((period, idx) => {
        const vals     = ema(closes, period);
        const lineData: LineData<Time>[] = [];
        vals.forEach((v, i) => { if (v !== null) lineData.push({ time: barTime(data[i]), value: v }); });
        const s = chart.addSeries(LineSeries, { color: emaColors[idx % emaColors.length], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        s.setData(lineData);
        seriesRefs.current.push(s);
      });
    }

    if (indicators.includes("BOLL")) {
      const boll = bollinger(closes, params.BOLL.period, params.BOLL.std);
      const addLine = (vals: (number | null)[], color: string, dash?: boolean) => {
        const lineData: LineData<Time>[] = [];
        vals.forEach((v, i) => { if (v !== null) lineData.push({ time: barTime(data[i]), value: v }); });
        const s = chart.addSeries(LineSeries, {
          color, lineWidth: 1,
          lineStyle: dash ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false, lastValueVisible: false,
        });
        s.setData(lineData);
        seriesRefs.current.push(s);
      };
      addLine(boll.upper, "#60A5FA", true);
      addLine(boll.middle, "#60A5FA");
      addLine(boll.lower, "#60A5FA", true);
    }

    if (indicators.includes("VWAP")) {
      const vals = vwap(bars, isIntraday ? 0 : params.VWAP.period);
      const lineData: LineData<Time>[] = [];
      vals.forEach((v, i) => { if (v !== null) lineData.push({ time: barTime(data[i]), value: v }); });
      const s = chart.addSeries(LineSeries, { color: "#E879F9", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true, title: "VWAP" });
      s.setData(lineData);
      seriesRefs.current.push(s);
    }

    if (indicators.includes("VWAP_BAND")) {
      const band = vwapBand(bars, params.VWAP_BAND.period);
      const vwapLine: LineData<Time>[] = [], upperLine: LineData<Time>[] = [], lowerLine: LineData<Time>[] = [];
      band.vwap.forEach((v, i) => { if (v !== null) vwapLine.push({ time: barTime(data[i]), value: v }); });
      band.upper.forEach((v, i) => { if (v !== null) upperLine.push({ time: barTime(data[i]), value: v }); });
      band.lower.forEach((v, i) => { if (v !== null) lowerLine.push({ time: barTime(data[i]), value: v }); });
      const vwapS  = chart.addSeries(LineSeries, { color: "#C084FC", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true,  title: "VWAP" });
      const upperS = chart.addSeries(LineSeries, { color: "#E879F9", lineWidth: 1, lineStyle: LineStyle.Solid,  priceLineVisible: false, lastValueVisible: false, title: "+1σ" });
      const lowerS = chart.addSeries(LineSeries, { color: "#E879F9", lineWidth: 1, lineStyle: LineStyle.Solid,  priceLineVisible: false, lastValueVisible: false, title: "-1σ" });
      vwapS.setData(vwapLine); upperS.setData(upperLine); lowerS.setData(lowerLine);
      seriesRefs.current.push(vwapS, upperS, lowerS);
    }

    // ── CrosshairMove → 回呼父元件 + 更新 Legend ──────────────────────────
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) {
        onCrosshairMove?.(null);
        setHoveredBar(null);
        return;
      }
      const key = timeToKey(param.time);
      const bar = data.find((d) => timeToKey(barTime(d)) === key) ?? null;
      onCrosshairMove?.(bar);
      setHoveredBar(bar);
    });

    if (indicators.includes("ICHI") && !isIntraday) {
      const ichiResult = ichimoku(bars);
      const SHIFT = 26;
      const addIchiLine = (vals: (number | null)[], shift: number, color: string, title: string, lw: 1 | 2 = 1) => {
        const lineData: LineData<Time>[] = [];
        vals.forEach((v, i) => {
          if (v === null) return;
          const ti = i + shift;
          if (ti < 0 || ti >= data.length) return;
          lineData.push({ time: barTime(data[ti]), value: v });
        });
        const s = chart.addSeries(LineSeries, { color, lineWidth: lw, priceLineVisible: false, lastValueVisible: false, title });
        s.setData(lineData);
        seriesRefs.current.push(s);
      };
      addIchiLine(ichiResult.tenkan,  0,      "#EF4444", "転換", 1);
      addIchiLine(ichiResult.kijun,   0,      "#3B82F6", "基準", 2);
      addIchiLine(ichiResult.senkouA, SHIFT,  "#22C55E", "先A",  1);
      addIchiLine(ichiResult.senkouB, SHIFT,  "#F59E0B", "先B",  1);
      addIchiLine(ichiResult.chikou,  -SHIFT, "#A78BFA", "遲行", 1);
    }

    // ── 法人籌碼疊圖 ─────────────────────────────────────────────────────
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
        const s = chart.addSeries(HistogramSeries, { priceScaleId: lane.id, priceLineVisible: false, lastValueVisible: false });
        s.priceScale().applyOptions({ scaleMargins: { top: lane.top, bottom: lane.bottom }, borderVisible: false });
        s.setData(
          data
            .filter((d) => { const dt = barDate(d); return !!dt && chipsMap.has(dt); })
            .map((d) => {
              const dt = barDate(d)!;
              const c  = chipsMap.get(dt)!;
              const val = c[lane.key] as number;
              return { time: barTime(d), value: val, color: val >= 0 ? lane.upColor : DOWN_COLOR };
            }),
        );
        seriesRefs.current.push(s);
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

    // Subscribe viewport changes → redraw drawings
    vpUnsubRef.current?.();
    const vp = () => redrawFnRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(vp);
    vpUnsubRef.current = () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(vp);

    chart.timeScale().fitContent();
    setTimeout(() => redrawFnRef.current(), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, indicators, chipsData, chartType, params]);

  useEffect(() => { buildChart(); }, [buildChart]);

  // ── Sync pattern markers when prop changes (without rebuilding chart) ─────
  useEffect(() => {
    const mainSeries = seriesRefs.current[0];
    if (!mainSeries) return;

    if (!patternMarkers || patternMarkers.length === 0) {
      // Clear existing markers
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers([]);
      }
      return;
    }

    const markers = buildSeriesMarkers(patternMarkers);
    if (markersPluginRef.current) {
      markersPluginRef.current.setMarkers(markers);
    } else {
      markersPluginRef.current = createSeriesMarkers(mainSeries, markers);
    }
  }, [patternMarkers]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (chartRef.current) chartRef.current.applyOptions({ width: container.clientWidth, height: container.clientHeight });
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
    const enabled = activeTool === "cursor";
    chartRef.current.applyOptions({
      handleScroll: enabled
        ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }
        : false,
      handleScale: enabled
        ? { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true }
        : false,
    });
  }, [activeTool]);

  // Clear all drawings when clearKey changes
  useEffect(() => {
    if (clearKey === undefined) return;
    drawingsRef.current    = [];
    channelPhaseRef.current = 0; setChannelPhase2(false);
    channelDraftRef.current = null;
    pendingRef.current      = null;
    previewRef.current      = null;
    lsClear(symbolRef.current);
    redrawFnRef.current();
  }, [clearKey]);

  // ── Shared drawing action logic ───────────────────────────────────────────
  const handleDrawDown = useCallback((x: number, y: number) => {
    const chart = chartRef.current;
    const main  = seriesRefs.current[0];
    if (!chart || !main || activeTool === "cursor") return;

    if (activeTool === "hline") {
      const price = main.coordinateToPrice(y);
      if (price === null) return;
      undoStackRef.current.push([...drawingsRef.current]);   // Undo 快照
      const next = [...drawingsRef.current, { id: `h${Date.now()}`, type: "hline" as const, price1: price }];
      drawingsRef.current = next;
      lsSave(symbolRef.current, next);
      redrawFnRef.current();

    } else if (activeTool === "trendline" || activeTool === "fibonacci" || activeTool === "rectangle") {
      pendingRef.current = { startX: x, startY: y };
      previewRef.current = { x, y };

    } else if (activeTool === "text") {
      const price = main.coordinateToPrice(y);
      const time  = chart.timeScale().coordinateToTime(x);
      if (price !== null && time !== null) {
        setTextOverlay({ canvasX: x, canvasY: y, time, price });
        setTextDraft("");
      }

    } else if (activeTool === "channel") {
      if (channelPhaseRef.current === 0) {
        pendingRef.current      = { startX: x, startY: y };
        previewRef.current      = { x, y };
        channelPhaseRef.current = 1;

      } else if (channelPhaseRef.current === 2) {
        const draft = channelDraftRef.current;
        if (!draft) { channelPhaseRef.current = 0; setChannelPhase2(false); return; }

        const bx1 = chart.timeScale().timeToCoordinate(draft.time1);
        const bx2 = chart.timeScale().timeToCoordinate(draft.time2);
        const by1 = main.priceToCoordinate(draft.price1);
        const by2 = main.priceToCoordinate(draft.price2);
        if (bx1 === null || bx2 === null || by1 === null || by2 === null) {
          channelPhaseRef.current = 0; setChannelPhase2(false); channelDraftRef.current = null; return;
        }

        const baseYAtX = Math.abs(bx2 - bx1) > 0.001
          ? by1 + (by2 - by1) * (x - bx1) / (bx2 - bx1)
          : by1;
        const price3 = main.coordinateToPrice(by1 + (y - baseYAtX));
        if (price3 === null) return;

        undoStackRef.current.push([...drawingsRef.current]);   // Undo 快照
        const next: Drawing[] = [...drawingsRef.current, {
          id: `ch${Date.now()}`, type: "channel",
          price1: draft.price1, time1: draft.time1,
          price2: draft.price2, time2: draft.time2,
          price3,
        }];
        drawingsRef.current     = next;
        lsSave(symbolRef.current, next);
        channelDraftRef.current = null;
        channelPhaseRef.current = 0; setChannelPhase2(false);
        previewRef.current      = null;
        redrawFnRef.current();
      }

    } else if (activeTool === "erase") {
      const idx = drawingsRef.current.findIndex((d) => hitTestDrawing(d, x, y, chart, main));
      if (idx >= 0) {
        const next = drawingsRef.current.filter((_, i) => i !== idx);
        drawingsRef.current = next;
        lsSave(symbolRef.current, next);
        redrawFnRef.current();
      }
    }
  }, [activeTool]);

  const handleDrawMove = useCallback((x: number, y: number) => {
    if (activeTool === "channel" && channelPhaseRef.current === 2) {
      previewRef.current = { x, y };
      redrawFnRef.current();
      return;
    }
    if (!pendingRef.current) return;
    if (["trendline", "fibonacci", "rectangle", "channel"].includes(activeTool)) {
      previewRef.current = { x, y };
      redrawFnRef.current();
    }
  }, [activeTool]);

  const handleDrawUp = useCallback((x: number, y: number) => {
    const chart = chartRef.current;
    const main  = seriesRefs.current[0];

    // Helper: save 2-point drawing from pending drag
    const saveDrag = (type: "trendline" | "fibonacci" | "rectangle", idPrefix: string) => {
      if (!pendingRef.current || !chart || !main) { pendingRef.current = null; previewRef.current = null; return; }
      const { startX, startY } = pendingRef.current;
      pendingRef.current = null; previewRef.current = null;
      if (Math.abs(x - startX) < 5 && Math.abs(y - startY) < 5) { redrawFnRef.current(); return; }
      const time1  = chart.timeScale().coordinateToTime(startX);
      const price1 = main.coordinateToPrice(startY);
      const time2  = chart.timeScale().coordinateToTime(x);
      const price2 = main.coordinateToPrice(y);
      if (time1 && time2 && price1 !== null && price2 !== null) {
        undoStackRef.current.push([...drawingsRef.current]);   // Undo 快照
        const next = [...drawingsRef.current, { id: `${idPrefix}${Date.now()}`, type, price1, time1, price2, time2 }];
        drawingsRef.current = next;
        lsSave(symbolRef.current, next);
      }
      redrawFnRef.current();
    };

    if (activeTool === "trendline")  saveDrag("trendline",  "t");
    else if (activeTool === "fibonacci")  saveDrag("fibonacci",  "f");
    else if (activeTool === "rectangle") saveDrag("rectangle", "r");
    else if (activeTool === "channel" && channelPhaseRef.current === 1 && pendingRef.current) {
      if (!chart || !main) { pendingRef.current = null; channelPhaseRef.current = 0; setChannelPhase2(false); return; }
      const { startX, startY } = pendingRef.current;
      pendingRef.current = null;
      if (Math.abs(x - startX) < 5 && Math.abs(y - startY) < 5) {
        channelPhaseRef.current = 0; setChannelPhase2(false); previewRef.current = null; redrawFnRef.current(); return;
      }
      const time1  = chart.timeScale().coordinateToTime(startX);
      const price1 = main.coordinateToPrice(startY);
      const time2  = chart.timeScale().coordinateToTime(x);
      const price2 = main.coordinateToPrice(y);
      if (time1 && time2 && price1 !== null && price2 !== null) {
        channelDraftRef.current = { time1, price1, time2, price2 };
        channelPhaseRef.current = 2; setChannelPhase2(true);
        previewRef.current      = { x, y };
      } else {
        channelPhaseRef.current = 0; setChannelPhase2(false);
        previewRef.current      = null;
      }
      redrawFnRef.current();
    }
  }, [activeTool]);

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const getXY = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const getTouchXY = (t: React.Touch, el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    return [t.clientX - r.left, t.clientY - r.top] as const;
  };

  const handleCanvasDown  = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => { const [x,y]=getXY(e); handleDrawDown(x,y);  }, [handleDrawDown]);
  const handleCanvasMove  = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => { const [x,y]=getXY(e); handleDrawMove(x,y);  }, [handleDrawMove]);
  const handleCanvasUp    = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => { const [x,y]=getXY(e); handleDrawUp(x,y);    }, [handleDrawUp]);
  const handleTouchStart  = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); const t=e.touches[0]??e.changedTouches[0]; if(t){const[x,y]=getTouchXY(t,e.currentTarget);handleDrawDown(x,y);} }, [handleDrawDown]);
  const handleTouchMove   = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); const t=e.touches[0]; if(t){const[x,y]=getTouchXY(t,e.currentTarget);handleDrawMove(x,y);} }, [handleDrawMove]);
  const handleTouchEnd    = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); const t=e.changedTouches[0]; if(t){const[x,y]=getTouchXY(t,e.currentTarget);handleDrawUp(x,y);} }, [handleDrawUp]);

  // ── Legend 項目（依開啟的指標動態產生）────────────────────────────────────
  const legendItems = useMemo(() => {
    const items: { key: string; paramKey: keyof IndicatorParams; label: string; color: string }[] = [];
    if (indicators.includes("MA")) {
      params.MA.forEach((p, i) => {
        items.push({ key: `MA${p}`, paramKey: "MA", label: `MA${p}`, color: MA_COLORS[i % MA_COLORS.length] });
      });
    }
    if (indicators.includes("EMA")) {
      const emaColors = ["#F472B6", "#34D399"];
      params.EMA.forEach((p, i) => {
        items.push({ key: `EMA${p}`, paramKey: "EMA", label: `EMA${p}`, color: emaColors[i % emaColors.length] });
      });
    }
    if (indicators.includes("BOLL")) {
      items.push({ key: "BOLL", paramKey: "BOLL", label: `BOLL(${params.BOLL.period},${params.BOLL.std})`, color: "#60A5FA" });
    }
    if (indicators.includes("VWAP")) {
      items.push({ key: "VWAP", paramKey: "VWAP", label: `VWAP(${params.VWAP.period})`, color: "#E879F9" });
    }
    if (indicators.includes("VWAP_BAND")) {
      items.push({ key: "VWAP_BAND", paramKey: "VWAP_BAND", label: `VWAP帶(${params.VWAP_BAND.period})`, color: "#C084FC" });
    }
    return items;
  }, [indicators, params]);


  const isDrawing = activeTool !== "cursor";
  const canvasCursor =
    activeTool === "erase"     ? "cell"
    : activeTool === "text"    ? "text"
    : isDrawing                ? "crosshair"
    : "default";

  // ── 縮放按鈕邏輯：以目前可視範圍為中心進行放大/縮小 ──────────────────────
  const handleZoom = useCallback((factor: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const center = (range.from + range.to) / 2;
    const halfSpan = (range.to - range.from) / 2;
    const newHalf = Math.max(halfSpan * factor, 2);
    ts.setVisibleLogicalRange({
      from: center - newHalf,
      to:   center + newHalf,
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full min-h-0 relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        style={{ pointerEvents: isDrawing ? "all" : "none", cursor: canvasCursor }}
        onMouseDown={handleCanvasDown}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* Text-label floating input */}
      {textOverlay && (
        <input
          autoFocus
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter")  { commitText(textOverlay, textDraft); }
            if (e.key === "Escape") { setTextOverlay(null); setTextDraft(""); }
          }}
          onBlur={() => { if (textDraft.trim()) commitText(textOverlay, textDraft); else { setTextOverlay(null); setTextDraft(""); } }}
          placeholder="輸入文字，Enter 確認"
          className="absolute z-20 text-xs outline-none"
          style={{
            left:       textOverlay.canvasX + 4,
            top:        textOverlay.canvasY - 22,
            background: "rgba(15,23,42,0.92)",
            border:     "1px solid var(--color-brand, #3B82F6)",
            color:      "#F1F5F9",
            padding:    "2px 8px",
            borderRadius: 4,
            minWidth:   120,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        />
      )}

      {/* Channel phase-2 hint */}
      {activeTool === "channel" && channelPhase2 && (
        <div
          className="absolute z-20 text-xs pointer-events-none"
          style={{
            bottom: 8, left: "50%", transform: "translateX(-50%)",
            background: "rgba(15,23,42,0.8)",
            border:     "1px solid rgba(34,211,238,0.4)",
            color:      "#22D3EE",
            padding:    "2px 10px",
            borderRadius: 4,
          }}
        >
          點擊設定通道寬度　Esc 取消
        </div>
      )}

      {/* ── 縮放控制（右下角，價格軸左側）──────────────────────────────── */}
      <div
        className="absolute z-20 flex flex-col gap-0.5"
        style={{ right: 72, bottom: 30 }}
      >
        <button
          onClick={() => handleZoom(0.7)}
          title="放大可視範圍"
          className="flex items-center justify-center rounded transition-all hover:opacity-100"
          style={ZOOM_BTN_STYLE}
        >
          +
        </button>
        <button
          onClick={() => handleZoom(1.4)}
          title="縮小可視範圍"
          className="flex items-center justify-center rounded transition-all hover:opacity-100"
          style={ZOOM_BTN_STYLE}
        >
          −
        </button>
        <button
          onClick={() => handleResetZoom()}
          title="顯示全部 (Fit)"
          className="flex items-center justify-center rounded transition-all hover:opacity-100"
          style={ZOOM_BTN_STYLE}
        >
          ⇔
        </button>
        {onFullscreen && (
          <button
            onClick={onFullscreen}
            title="全螢幕"
            className="flex items-center justify-center rounded transition-all hover:opacity-100"
            style={ZOOM_BTN_STYLE}
          >
            ⛶
          </button>
        )}
      </div>

      {/* ── 指標 Legend（左上角，可點擊編輯參數）────────────────────────── */}
      {legendItems.length > 0 && (
        <div className="absolute top-1 left-1 z-20 flex flex-wrap gap-1 pointer-events-none">
          {legendItems.map((item) => (
            <div key={item.key} className="relative pointer-events-auto">
              <button
                ref={(el) => { legendBtnRefs.current[item.key] = el; }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-opacity hover:opacity-100 opacity-80"
                style={{
                  background: "rgba(0,0,0,0.55)",
                  color:       item.color,
                  border:      `1px solid ${item.color}44`,
                }}
                onClick={() => setParamPopover(prev => prev === item.paramKey ? null : item.paramKey)}
                title={`點擊編輯 ${item.paramKey} 參數`}
              >
                {item.label}
                <span style={{ opacity: 0.5, fontSize: "8px" }}>✎</span>
              </button>

              {/* Popover：同一 paramKey 只開一個 */}
              {paramPopover === item.paramKey && (
                <IndicatorParamPopover
                  indicator={item.paramKey}
                  params={params}
                  getAnchorEl={() => legendBtnRefs.current[item.key] ?? null}
                  onChange={(next) => {
                    onParamsChange?.(next);
                    setParamPopover(null);
                  }}
                  onClose={() => setParamPopover(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
