"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ChartBar, ChartType, DrawingTool, IndicatorType } from "@/components/chart/KLineChart";
import ChartWithPanels from "@/components/chart/ChartWithPanels";
import PeriodSelector   from "@/components/chart/PeriodSelector";
import ChartTypeSelector from "@/components/chart/ChartTypeSelector";
import DrawingToolbar   from "@/components/chart/DrawingToolbar";
import IndicatorSelector from "@/components/chart/IndicatorSelector";
import type { Period }   from "@/components/chart/PeriodSelector";
import type { ChipsBar, CandlePattern } from "@/lib/api";
import type { IndicatorParams } from "@/lib/indicatorParams";

interface FullscreenChartModalProps {
  data:              ChartBar[];
  indicators:        IndicatorType[];
  chipsData?:        ChipsBar[];
  chartType:         ChartType;
  activeTool:        DrawingTool;
  clearKey?:         number;
  symbol?:           string;
  patternMarkers?:   CandlePattern[];
  indicatorParams:   IndicatorParams;
  period:            Period;
  onClose:           () => void;
  onIndicatorsChange: (v: IndicatorType[]) => void;
  onChartTypeChange:  (v: ChartType) => void;
  onParamsChange:     (v: IndicatorParams) => void;
  onPeriodChange:     (v: Period) => void;
}

export default function FullscreenChartModal({
  data, indicators, chipsData, chartType, activeTool, clearKey,
  symbol, patternMarkers, indicatorParams, period,
  onClose, onIndicatorsChange, onChartTypeChange, onParamsChange, onPeriodChange,
}: FullscreenChartModalProps) {
  // 全螢幕內部的工具狀態（不影響主頁）
  const [localTool,   setLocalTool]   = useState<DrawingTool>(activeTool);
  const [localClear,  setLocalClear]  = useState(0);
  const [hoveredBar,  setHoveredBar]  = useState<ChartBar | null>(null);

  // Esc 關閉
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 防止背景滾動
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const formatBar = useCallback((b: ChartBar) => {
    const time = ("time" in b ? b.time : b.date) as string | number;
    return String(time);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9000] flex flex-col"
      style={{ background: "var(--bg-surface)" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ── 頂部工具列 ─────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center gap-2 px-3 py-2 border-b flex-wrap"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      >
        {/* 股票名稱 */}
        {symbol && (
          <span
            className="font-bold mr-2 shrink-0"
            style={{ color: "var(--text-primary)", fontSize: "15px" }}
          >
            {symbol}
          </span>
        )}

        {/* 週期選擇器 */}
        <PeriodSelector active={period} onChange={onPeriodChange} />

        {/* K線類型 */}
        <ChartTypeSelector active={chartType} onChange={onChartTypeChange} />

        {/* 分隔 */}
        <div className="w-px h-5 shrink-0" style={{ background: "var(--border)" }} />

        {/* 畫線工具 */}
        <DrawingToolbar
          active={localTool}
          onChange={setLocalTool}
          onClearAll={() => setLocalClear(c => c + 1)}
        />

        {/* 指標選擇器 */}
        <IndicatorSelector active={indicators} onChange={onIndicatorsChange} />

        {/* spacer */}
        <div className="flex-1" />

        {/* 關閉按鈕 */}
        <button
          onClick={onClose}
          title="關閉全螢幕（Esc）"
          className="shrink-0 flex items-center justify-center rounded transition-colors"
          style={{
            width:       "28px",
            height:      "28px",
            fontSize:    "16px",
            color:       "var(--text-secondary)",
            background:  "transparent",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-base)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          ✕
        </button>
      </div>

      {/* ── 主體區域（圖表 + 左側懸停 OHLCV）────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* 左側 OHLCV 懸停資訊欄 */}
        <aside
          className="shrink-0 border-r flex flex-col pt-3 px-2 gap-1.5"
          style={{
            width:      "140px",
            background: "var(--bg-surface)",
            borderColor:"var(--border)",
            fontSize:   "11.5px",
          }}
        >
          {hoveredBar ? (
            <>
              <div className="text-[9px] font-bold tracking-widest mb-1"
                   style={{ color: "var(--text-tertiary)", textTransform: "uppercase" }}>
                K線資料
              </div>
              {[
                { label: "日期", value: formatBar(hoveredBar) },
                { label: "開",   value: hoveredBar.open.toFixed(2),  color: hoveredBar.open  >= hoveredBar.close ? "var(--color-down)" : "var(--color-up)" },
                { label: "高",   value: hoveredBar.high.toFixed(2),  color: "var(--color-up)" },
                { label: "低",   value: hoveredBar.low.toFixed(2),   color: "var(--color-down)" },
                { label: "收",   value: hoveredBar.close.toFixed(2), color: hoveredBar.close >= hoveredBar.open  ? "var(--color-up)" : "var(--color-down)" },
                { label: "量",   value: hoveredBar.volume >= 1_000_000
                  ? `${(hoveredBar.volume / 1_000_000).toFixed(1)}M`
                  : hoveredBar.volume >= 1_000
                  ? `${(hoveredBar.volume / 1_000).toFixed(1)}K`
                  : String(hoveredBar.volume) },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between gap-1">
                  <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
                  <span className="num font-semibold" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
                </div>
              ))}
            </>
          ) : (
            <div className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>
              移動滑鼠到<br/>K線上查看
            </div>
          )}
        </aside>

        {/* 圖表 */}
        <div className="flex-1 min-w-0 min-h-0 relative">
          <ChartWithPanels
            data={data}
            indicators={indicators}
            chipsData={chipsData}
            chartType={chartType}
            activeTool={localTool}
            clearKey={(clearKey ?? 0) + localClear}
            symbol={symbol}
            patternMarkers={patternMarkers}
            indicatorParams={indicatorParams}
            onParamsChange={onParamsChange}
            onCrosshairMove={setHoveredBar}
          />
        </div>
      </div>
    </div>
  );
}
