"use client";

import { useState, useEffect, useRef } from "react";
import type { IndicatorParams } from "@/lib/indicatorParams";

interface Props {
  indicator: keyof IndicatorParams;
  params:    IndicatorParams;
  anchorRef: React.RefObject<HTMLElement | null>;
  onChange:  (next: IndicatorParams) => void;
  onClose:   () => void;
}

// ── 各指標的欄位定義 ─────────────────────────────────────────────────────────
type Field = { key: string; label: string; min: number; max: number; step: number };

const FIELDS: Partial<Record<keyof IndicatorParams, Field[]>> = {
  MA: [
    { key: "0", label: "線1週期", min: 1, max: 500, step: 1 },
    { key: "1", label: "線2週期", min: 1, max: 500, step: 1 },
    { key: "2", label: "線3週期", min: 1, max: 500, step: 1 },
    { key: "3", label: "線4週期", min: 1, max: 500, step: 1 },
  ],
  EMA: [
    { key: "0", label: "線1週期", min: 1, max: 500, step: 1 },
    { key: "1", label: "線2週期", min: 1, max: 500, step: 1 },
  ],
  BOLL:  [
    { key: "period", label: "週期",  min: 2,   max: 200, step: 1 },
    { key: "std",    label: "標準差倍數", min: 0.5, max: 5,   step: 0.5 },
  ],
  MACD:  [
    { key: "fast",   label: "快線",   min: 2,  max: 200, step: 1 },
    { key: "slow",   label: "慢線",   min: 2,  max: 400, step: 1 },
    { key: "signal", label: "信號線", min: 1,  max: 100, step: 1 },
  ],
  RSI:       [{ key: "period", label: "週期", min: 2, max: 200, step: 1 }],
  KD:        [{ key: "period", label: "週期", min: 2, max: 100, step: 1 }],
  VWAP:      [{ key: "period", label: "滾動週期", min: 1, max: 200, step: 1 }],
  VWAP_BAND: [{ key: "period", label: "滾動週期", min: 1, max: 200, step: 1 }],
  WR:        [{ key: "period", label: "週期", min: 2, max: 200, step: 1 }],
  ATR:       [{ key: "period", label: "週期", min: 2, max: 200, step: 1 }],
  ADX:       [{ key: "period", label: "週期", min: 2, max: 200, step: 1 }],
  SRSI:      [{ key: "period", label: "週期", min: 2, max: 200, step: 1 }],
};

function getInitialValues(indicator: keyof IndicatorParams, params: IndicatorParams): Record<string, number> {
  const val = params[indicator];
  if (Array.isArray(val)) {
    const obj: Record<string, number> = {};
    (val as number[]).forEach((v, i) => { obj[String(i)] = v; });
    return obj;
  }
  return { ...(val as Record<string, number>) };
}

export default function IndicatorParamPopover({ indicator, params, anchorRef, onChange, onClose }: Props) {
  const fields = FIELDS[indicator];
  const [values, setValues] = useState<Record<string, number>>(() =>
    getInitialValues(indicator, params)
  );
  const popoverRef = useRef<HTMLDivElement>(null);

  // 點外部關閉
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current  && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose, anchorRef]);

  if (!fields) return null;

  function apply() {
    const next: IndicatorParams = { ...params };
    const cur = params[indicator];
    if (Array.isArray(cur)) {
      // MA / EMA
      (next[indicator] as number[]) = fields!.map((_, i) => values[String(i)] ?? (cur as number[])[i]);
    } else {
      (next[indicator] as Record<string, number>) = { ...(cur as Record<string, number>), ...values };
    }
    onChange(next);
    onClose();
  }

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 rounded-lg shadow-xl border p-3 flex flex-col gap-2"
      style={{
        top: "calc(100% + 4px)",
        left: 0,
        minWidth: "180px",
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
        fontSize: "12px",
      }}
    >
      <div className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
        {indicator} 參數
      </div>

      {fields.map((field) => (
        <div key={field.key} className="flex items-center justify-between gap-3">
          <span style={{ color: "var(--text-secondary)" }}>{field.label}</span>
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={values[field.key] ?? 0}
            onChange={(e) => setValues(prev => ({ ...prev, [field.key]: Number(e.target.value) }))}
            className="w-16 text-right rounded px-1.5 py-0.5 outline-none"
            style={{
              background: "var(--bg-base)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      ))}

      <div className="flex gap-2 mt-1 justify-end">
        <button
          onClick={onClose}
          className="px-2.5 py-1 rounded text-[11px]"
          style={{ background: "var(--bg-base)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >
          取消
        </button>
        <button
          onClick={apply}
          className="px-2.5 py-1 rounded text-[11px] font-semibold"
          style={{ background: "var(--color-brand)", color: "#fff" }}
        >
          套用
        </button>
      </div>
    </div>
  );
}
