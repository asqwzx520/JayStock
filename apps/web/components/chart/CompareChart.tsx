"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { IChartApi, ISeriesApi, LineSeriesOptions } from "lightweight-charts";
import { getCompare, getCompareAnalysis, type CompareResponse } from "@/lib/api";

// ── Colour palette ────────────────────────────────────────────────────────────
const COLORS = ["#3b82f6", "#f59e0b", "#22c55e", "#f43f5e"];

// ── Period selector ───────────────────────────────────────────────────────────
const PERIODS = [
  { id: "1m",  label: "1M" },
  { id: "3m",  label: "3M" },
  { id: "6m",  label: "6M" },
  { id: "1y",  label: "1Y" },
  { id: "3y",  label: "3Y" },
  { id: "5y",  label: "5Y" },
];

interface Props {
  /** 初始股票（來自外部選股，最多 1 支；使用者可在這裡自行新增） */
  initialSymbol?: string;
}

export default function CompareChart({ initialSymbol = "2330" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesMap    = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  const [symbols, setSymbols] = useState<string[]>([initialSymbol]);
  const [period,  setPeriod]  = useState("1y");
  const [input,   setInput]   = useState("");
  const [data,    setData]    = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // AI 比較分析
  const [aiText,      setAiText]      = useState<string | null>(null);
  const [aiLoading,   setAiLoading]   = useState(false);
  const [aiError,     setAiError]     = useState<string | null>(null);

  // Reset when initialSymbol changes
  useEffect(() => {
    setSymbols([initialSymbol]);
    setAiText(null);
    setAiError(null);
  }, [initialSymbol]);

  // AI 比較分析
  const fetchAiAnalysis = useCallback(async () => {
    if (symbols.length < 2 || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiText(null);
    try {
      const res = await getCompareAnalysis(symbols, period);
      setAiText(res.analysis);
    } catch {
      setAiError("AI 分析暫時無法使用，請稍後再試。");
    } finally {
      setAiLoading(false);
    }
  }, [symbols, period, aiLoading]);

  // ── Fetch data ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (syms: string[], per: string) => {
    if (!syms.length) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getCompare(syms, per);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(symbols, period);
  }, [symbols, period, fetchData]);

  // ── Build / update chart ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const initChart = async () => {
      const { createChart, LineSeries } = await import("lightweight-charts");

      if (!chartRef.current) {
        chartRef.current = createChart(containerRef.current!, {
          layout: {
            background:  { color: "transparent" },
            textColor:   "rgba(156,163,175,0.9)",
            fontFamily:  "'JetBrains Mono','Noto Sans TC',monospace",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.04)" },
          },
          rightPriceScale: {
            borderColor: "rgba(255,255,255,0.08)",
            mode: 0,
          },
          timeScale: {
            borderColor: "rgba(255,255,255,0.08)",
            timeVisible: false,
          },
          crosshair: { mode: 1 },
          handleScroll:    { mouseWheel: true, pressedMouseMove: true },
          handleScale:     { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        });
      }

      if (!data) return;
      const chart = chartRef.current;

      // Remove stale series
      const wanted = new Set(data.symbols);
      for (const [sym, series] of seriesMap.current.entries()) {
        if (!wanted.has(sym)) {
          chart.removeSeries(series);
          seriesMap.current.delete(sym);
        }
      }

      // Add / update series
      data.symbols.forEach((sym, idx) => {
        const color    = COLORS[idx % COLORS.length];
        const seriesData = (data.series[sym] ?? []).map(p => ({
          time:  p.time as import("lightweight-charts").Time,
          value: p.value,
        }));

        if (!seriesData.length) return;

        if (seriesMap.current.has(sym)) {
          seriesMap.current.get(sym)!.setData(seriesData);
        } else {
          const opts: Partial<LineSeriesOptions> = {
            color,
            lineWidth:    2,
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat:  { type: "custom", formatter: (v: number) => v.toFixed(1), minMove: 0.001 },
          };
          const s = chart.addSeries(LineSeries, opts);
          s.setData(seriesData);
          seriesMap.current.set(sym, s);
        }
      });

      chart.timeScale().fitContent();
    };

    initChart();
  }, [data]);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Cleanup on unmount（ref 的 current 要在 effect body 裡複製，cleanup function 才能安全存取）
  useEffect(() => {
    const seriesMapCopy = seriesMap.current;
    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
      seriesMapCopy.clear();
    };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const addSymbol = () => {
    const sym = input.trim().toUpperCase().replace(/\s/g, "");
    if (!sym || symbols.includes(sym) || symbols.length >= 4) return;
    setSymbols(prev => [...prev, sym]);
    setInput("");
  };

  const removeSymbol = (sym: string) => {
    setSymbols(prev => prev.filter(s => s !== sym));
  };

  const latestReturn = (sym: string): string => {
    const pts = data?.series[sym];
    if (!pts || pts.length < 2) return "—";
    const v = pts[pts.length - 1].value - 100;
    return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  };

  const latestColor = (sym: string): string => {
    const pts = data?.series[sym];
    if (!pts || pts.length < 2) return "var(--text-secondary)";
    const v = pts[pts.length - 1].value - 100;
    return v >= 0 ? "var(--color-up)" : "var(--color-down)";
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 p-4">
      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        {/* Symbol chips */}
        <div className="flex flex-wrap gap-1.5">
          {symbols.map((sym, idx) => (
            <span
              key={sym}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold"
              style={{ background: `${COLORS[idx % COLORS.length]}22`, border: `1px solid ${COLORS[idx % COLORS.length]}55`, color: COLORS[idx % COLORS.length] }}
            >
              {sym}
              {symbols.length > 1 && (
                <button
                  onClick={() => removeSymbol(sym)}
                  className="ml-0.5 opacity-60 hover:opacity-100 text-[10px]"
                  title={`移除 ${sym}`}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>

        {/* Add input */}
        {symbols.length < 4 && (
          <div className="flex items-center gap-1">
            <input
              className="rounded px-2 py-1 text-xs w-20"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              placeholder="+ 加入股票"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSymbol()}
            />
            <button
              onClick={addSymbol}
              disabled={!input.trim()}
              className="px-2 py-1 rounded text-xs font-medium"
              style={{ background: "var(--color-brand)", color: "#fff", opacity: input.trim() ? 1 : 0.4 }}
            >
              加入
            </button>
          </div>
        )}

        {/* Period selector */}
        <div className="flex items-center gap-0.5 ml-auto rounded p-0.5" style={{ background: "var(--bg-elevated)" }}>
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="px-2 py-0.5 rounded text-[11px] font-medium"
              style={{
                background: period === p.id ? "var(--color-brand)" : "transparent",
                color:      period === p.id ? "#fff" : "var(--text-secondary)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Legend (return summary) ───────────────────────────────────── */}
      {data && (
        <div className="shrink-0 flex flex-wrap gap-3">
          {data.symbols.map((sym, idx) => (
            <div key={sym} className="flex items-center gap-1.5 text-xs">
              <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: COLORS[idx % COLORS.length] }} />
              <span style={{ color: "var(--text-secondary)" }}>{sym}</span>
              <span className="num font-semibold" style={{ color: latestColor(sym) }}>
                {latestReturn(sym)}
              </span>
            </div>
          ))}
          <span className="text-[10px] ml-auto" style={{ color: "var(--text-tertiary)" }}>
            起始日 = 100（正規化報酬）
          </span>
        </div>
      )}

      {/* ── Chart area ───────────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: "var(--bg-surface)" }}>
            <span className="text-xs animate-pulse" style={{ color: "var(--text-tertiary)" }}>
              載入走勢資料中...
            </span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <span className="text-xs" style={{ color: "var(--color-down)" }}>無法載入：{error}</span>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" style={{ minHeight: 320 }} />
      </div>

      {/* ── Tip + AI 按鈕 ────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 flex-wrap">
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          最多同時比較 4 支股票｜台股輸入數字代號（如 2330），美股輸入英文（如 AAPL）
        </span>
        {symbols.length >= 2 && (
          <button
            onClick={fetchAiAnalysis}
            disabled={aiLoading}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
            style={{
              background: aiText ? "rgba(59,130,246,0.12)" : "var(--bg-elevated)",
              border:     `1px solid ${aiText ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
              color:      aiText ? "var(--color-brand)" : "var(--text-secondary)",
              opacity:    aiLoading ? 0.6 : 1,
            }}
          >
            {aiLoading ? <span className="animate-spin">⟳</span> : "🤖"}
            {" "}AI 比較分析
          </button>
        )}
      </div>

      {/* ── AI 分析結果 ──────────────────────────────────────────── */}
      {(aiText || aiError) && (
        <div
          className="shrink-0 rounded-xl p-3 text-[12px] leading-relaxed"
          style={{
            background:  aiError ? "rgba(239,68,68,0.06)" : "rgba(59,130,246,0.06)",
            border:      `1px solid ${aiError ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.2)"}`,
            color:       aiError ? "var(--color-down)" : "var(--text-primary)",
          }}
        >
          {!aiError && (
            <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold" style={{ color: "var(--color-brand)" }}>
              🤖 AI 比較分析
            </div>
          )}
          <p>{aiError ?? aiText}</p>
          <button
            onClick={() => { setAiText(null); setAiError(null); }}
            className="mt-2 text-[10px] opacity-40 hover:opacity-70"
            style={{ color: "var(--text-secondary)" }}
          >
            關閉
          </button>
        </div>
      )}
    </div>
  );
}
