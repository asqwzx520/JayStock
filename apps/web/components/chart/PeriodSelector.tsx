"use client";

const INTRADAY_PERIODS = [
  { key: "1m",  label: "1分" },
  { key: "5m",  label: "5分" },
  { key: "15m", label: "15分" },
  { key: "30m", label: "30分" },
  { key: "60m", label: "60分" },
] as const;

const DAILY_PERIODS = [
  { key: "daily",   label: "日K" },
  { key: "weekly",  label: "週K" },
  { key: "monthly", label: "月K" },
] as const;

export type IntradayPeriod = (typeof INTRADAY_PERIODS)[number]["key"];
export type DailyPeriod    = (typeof DAILY_PERIODS)[number]["key"];
export type Period         = IntradayPeriod | DailyPeriod;

export const INTRADAY_PERIOD_KEYS = new Set<string>(
  INTRADAY_PERIODS.map((p) => p.key),
);

interface PeriodSelectorProps {
  active: Period;
  onChange: (period: Period) => void;
}

export default function PeriodSelector({ active, onChange }: PeriodSelectorProps) {
  const btn = (key: Period, label: string) => {
    const isActive = key === active;
    return (
      <button
        key={key}
        onClick={() => onChange(key)}
        className="px-2.5 py-0.5 text-xs rounded transition-colors"
        style={{
          background: isActive ? "var(--bg-elevated)" : "transparent",
          color:      isActive ? "var(--text-primary)" : "var(--text-tertiary)",
          fontWeight: isActive ? 600 : 400,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1">
      {/* 分K */}
      <div className="flex items-center gap-0.5">
        {INTRADAY_PERIODS.map((p) => btn(p.key, p.label))}
      </div>

      {/* 分隔線 */}
      <div
        className="w-px h-3 mx-1 shrink-0"
        style={{ background: "var(--border)" }}
      />

      {/* 日/週/月 K */}
      <div className="flex items-center gap-0.5">
        {DAILY_PERIODS.map((p) => btn(p.key, p.label))}
      </div>
    </div>
  );
}
