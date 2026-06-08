"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChartBar, ChartType, DrawingTool, IndicatorType } from "@/components/chart/KLineChart";
import KLineChart, { SUB_PANEL_INDICATORS } from "@/components/chart/KLineChart";
import SubIndicatorPanel, { type SubIndicatorType } from "@/components/chart/SubIndicatorPanel";
import ResizeDivider from "@/components/chart/ResizeDivider";
import type { ChipsBar, CandlePattern } from "@/lib/api";
import type { IndicatorParams } from "@/lib/indicatorParams";

// ── localStorage 高度比例 ─────────────────────────────────────────────────────
const LS_KEY = "stockpulse_chart_heights_v1";

interface HeightMap { main: number; [key: string]: number }

function loadHeights(): HeightMap {
  if (typeof window === "undefined") return { main: 100 };
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : { main: 100 };
  } catch { return { main: 100 }; }
}

function saveHeights(h: HeightMap) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(h)); } catch {}
}

// ── Props ────────────────────────────────────────────────────────────────────
interface ChartWithPanelsProps {
  data:              ChartBar[];
  indicators:        IndicatorType[];
  chipsData?:        ChipsBar[];
  chartType?:        ChartType;
  activeTool?:       DrawingTool;
  clearKey?:         number;
  symbol?:           string;
  patternMarkers?:   CandlePattern[];
  indicatorParams:   IndicatorParams;
  onParamsChange:    (p: IndicatorParams) => void;
  onCrosshairMove?:  (bar: ChartBar | null) => void;
}

export default function ChartWithPanels({
  data, indicators, chipsData, chartType, activeTool, clearKey,
  symbol, patternMarkers, indicatorParams, onParamsChange, onCrosshairMove,
}: ChartWithPanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 目前活躍的子指標（保持順序）
  const subIndicators = indicators.filter(
    (ind): ind is SubIndicatorType => (SUB_PANEL_INDICATORS as IndicatorType[]).includes(ind)
  );

  // 高度比例 Map（百分比，各值加總 ≈ 100）
  const [heights, setHeights] = useState<HeightMap>(() => {
    const saved = loadHeights();
    return saved;
  });

  // 時間軸同步範圍
  const [syncRange, setSyncRange] = useState<{ from: number; to: number } | null>(null);

  // 當子指標增減時，重新分配高度
  useEffect(() => {
    setHeights(prev => {
      const total = 100;
      const MIN_MAIN = 30;
      const MIN_SUB  = 5;

      // 移除已不在列表中的 sub 高度
      const cleaned: HeightMap = { main: prev.main };
      subIndicators.forEach(k => { cleaned[k] = prev[k] ?? 0; });

      // 若有新加的 sub（高度為 0 或不存在），分配預設高度
      const newSubs = subIndicators.filter(k => !prev[k]);
      if (newSubs.length === 0) {
        saveHeights(cleaned);
        return cleaned;
      }

      // 每個新 sub 分配 15%，從主圖壓縮
      let mainH = cleaned.main;
      newSubs.forEach(k => {
        const give = Math.min(15, mainH - MIN_MAIN);
        mainH -= give;
        cleaned[k] = give;
      });
      cleaned.main = Math.max(MIN_MAIN, mainH);

      // 確保加總等於 100
      const sum = cleaned.main + subIndicators.reduce((s, k) => s + (cleaned[k] ?? 0), 0);
      if (Math.abs(sum - total) > 0.5) {
        const scale = total / sum;
        cleaned.main = Math.max(MIN_MAIN, cleaned.main * scale);
        subIndicators.forEach(k => { cleaned[k] = Math.max(MIN_SUB, (cleaned[k] ?? 0) * scale); });
      }

      saveHeights(cleaned);
      return cleaned;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subIndicators.join(",")]);

  // 計算容器高度 → 各面板 px
  const [containerH, setContainerH] = useState(600);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerH(el.clientHeight));
    ro.observe(el);
    setContainerH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // 拖動分界線 i（i=0 → 主圖 ↔ sub[0]，i=1 → sub[0] ↔ sub[1]…）
  const handleDrag = useCallback((dividerIdx: number, deltaY: number) => {
    setHeights(prev => {
      const next = { ...prev };
      const MIN_MAIN = 30;
      const MIN_SUB  = 5;
      const pctDelta = (deltaY / containerH) * 100;

      const keys = ["main", ...subIndicators];
      const upper = keys[dividerIdx];
      const lower = keys[dividerIdx + 1];

      const minUpper = upper === "main" ? MIN_MAIN : MIN_SUB;
      next[upper] = Math.max(minUpper, (next[upper] ?? 0) + pctDelta);
      next[lower] = Math.max(MIN_SUB,  (next[lower] ?? 0) - pctDelta);

      saveHeights(next);
      return next;
    });
  }, [containerH, subIndicators, setHeights]);

  // 主圖指標（不含 sub-panel 類型）
  const mainIndicators = indicators.filter(ind => !(SUB_PANEL_INDICATORS as IndicatorType[]).includes(ind));

  const mainPx = Math.round((heights.main / 100) * containerH);

  return (
    <div ref={containerRef} className="flex flex-col w-full h-full min-h-0">
      {/* ── 主圖 ───────────────────────────────────────────────────────── */}
      <div style={{ height: `${mainPx}px`, flexShrink: 0, minHeight: 0 }}>
        <KLineChart
          data={data}
          indicators={mainIndicators}
          chipsData={chipsData}
          chartType={chartType}
          activeTool={activeTool}
          clearKey={clearKey}
          symbol={symbol}
          patternMarkers={patternMarkers}
          indicatorParams={indicatorParams}
          onParamsChange={onParamsChange}
          onCrosshairMove={onCrosshairMove}
        />
      </div>

      {/* ── 子指標面板（各自獨立，可拖分界線）──────────────────────────── */}
      {subIndicators.map((ind, i) => {
        const pct = heights[ind] ?? 5;
        const px  = Math.max(Math.round((pct / 100) * containerH), 40);
        const isLast = i === subIndicators.length - 1;
        return (
          <div key={ind} className="flex flex-col min-h-0" style={{ flexShrink: 0 }}>
            <ResizeDivider onDrag={(delta) => handleDrag(i, delta)} />
            <SubIndicatorPanel
              indicator={ind}
              data={data}
              params={indicatorParams}
              height={px}
              showTimeAxis={isLast}
              syncRange={syncRange}
              onRangeChange={setSyncRange}
            />
          </div>
        );
      })}
    </div>
  );
}
