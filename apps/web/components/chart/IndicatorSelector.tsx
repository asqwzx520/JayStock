"use client";

import type { IndicatorType } from "./KLineChart";

const INDICATORS: { key: IndicatorType; label: string; desc: string; special?: boolean }[] = [
  { key: "MA",    label: "MA",   desc: "移動平均線 MA(5/10/20/60)" },
  { key: "EMA",   label: "EMA",  desc: "指數移動平均 EMA(12/26)" },
  { key: "BOLL",  label: "BOLL", desc: "布林通道 (20,2)" },
  { key: "MACD",  label: "MACD", desc: "指數平滑異同移動平均" },
  { key: "RSI",   label: "RSI",  desc: "相對強弱指標 (14)" },
  { key: "KD",    label: "KD",   desc: "隨機指標 KD(9)" },
  { key: "VWAP",  label: "VWAP", desc: "成交量加權均價（分K累積 / 日K滾動20）", special: false },
  { key: "WR",    label: "%R",   desc: "Williams %R 超買超賣 (14)" },
  { key: "OBV",   label: "OBV",  desc: "能量潮 On Balance Volume" },
  { key: "CHIPS", label: "法人", desc: "三大法人疊圖", special: true },
];

interface IndicatorSelectorProps {
  active: IndicatorType[];
  onChange: (indicators: IndicatorType[]) => void;
}

export default function IndicatorSelector({
  active,
  onChange,
}: IndicatorSelectorProps) {
  function toggle(key: IndicatorType) {
    if (active.includes(key)) {
      onChange(active.filter((k) => k !== key));
    } else {
      onChange([...active, key]);
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {INDICATORS.map((ind, idx) => {
        const isActive = active.includes(ind.key);
        // Divider before the "法人" special indicator
        const prev = INDICATORS[idx - 1];
        const showDivider = ind.special && prev && !prev.special;
        return (
          <span key={ind.key} className="flex items-center gap-1.5">
            {showDivider && (
              <span
                className="w-px h-4 shrink-0"
                style={{ background: "var(--border)" }}
              />
            )}
            <button
              onClick={() => toggle(ind.key)}
              title={ind.desc}
              className="px-2 py-0.5 text-xs rounded transition-colors"
              style={{
                background: isActive
                  ? ind.special ? "rgba(245,158,11,0.25)" : "var(--color-brand)"
                  : "var(--bg-elevated)",
                color: isActive
                  ? ind.special ? "#F59E0B" : "#fff"
                  : "var(--text-secondary)",
                border: `1px solid ${
                  isActive
                    ? ind.special ? "#F59E0B" : "var(--color-brand)"
                    : "var(--border)"
                }`,
              }}
            >
              {ind.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}
