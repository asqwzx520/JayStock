"use client";

const PERIODS = [
  { key: "daily", label: "日K" },
  { key: "weekly", label: "週K" },
  { key: "monthly", label: "月K" },
] as const;

export type Period = (typeof PERIODS)[number]["key"];

interface PeriodSelectorProps {
  active: Period;
  onChange: (period: Period) => void;
}

export default function PeriodSelector({
  active,
  onChange,
}: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-1">
      {PERIODS.map((p) => {
        const isActive = p.key === active;
        return (
          <button
            key={p.key}
            onClick={() => onChange(p.key)}
            className="px-2.5 py-0.5 text-xs rounded transition-colors"
            style={{
              background: isActive ? "var(--bg-elevated)" : "transparent",
              color: isActive ? "var(--text-primary)" : "var(--text-tertiary)",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
