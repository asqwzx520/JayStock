"use client";

import type { ChartType } from "./KLineChart";

const CHART_TYPES: { key: ChartType; label: string; desc: string }[] = [
  { key: "candle",      label: "蠟燭",  desc: "標準K棒" },
  { key: "hollow",      label: "空心",  desc: "空心K棒（收漲空心紅框，收跌實心綠）" },
  { key: "heikin_ashi", label: "HA",    desc: "平均K棒 Heikin-Ashi" },
  { key: "line",        label: "折線",  desc: "收盤價折線圖" },
  { key: "area",        label: "面積",  desc: "收盤價面積圖" },
];

interface ChartTypeSelectorProps {
  active: ChartType;
  onChange: (type: ChartType) => void;
}

export default function ChartTypeSelector({ active, onChange }: ChartTypeSelectorProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="K線圖類型">
      {CHART_TYPES.map((ct) => {
        const isActive = active === ct.key;
        return (
          <button
            key={ct.key}
            onClick={() => onChange(ct.key)}
            title={ct.desc}
            aria-pressed={isActive}
            className="px-2 py-0.5 text-xs rounded transition-colors"
            style={{
              background: isActive ? "var(--color-brand)" : "var(--bg-elevated)",
              color:      isActive ? "#fff"               : "var(--text-secondary)",
              border:     `1px solid ${isActive ? "var(--color-brand)" : "var(--border)"}`,
            }}
          >
            {ct.label}
          </button>
        );
      })}
    </div>
  );
}
