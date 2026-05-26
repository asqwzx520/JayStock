import { type ReactNode } from "react";

type BadgeVariant = "up" | "down" | "flat" | "brand" | "foreign" | "trust" | "dealer" | "neutral";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  up:      "bg-[var(--color-up-subtle)] text-[var(--color-up)] border-[var(--color-up)]/20",
  down:    "bg-[var(--color-down-subtle)] text-[var(--color-down)] border-[var(--color-down)]/20",
  flat:    "bg-[var(--bg-elevated)] text-[var(--color-flat)] border-[var(--border)]",
  brand:   "bg-[var(--color-brand)]/15 text-[var(--color-brand)] border-[var(--color-brand)]/20",
  foreign: "bg-[var(--color-foreign)]/15 text-[var(--color-foreign)] border-[var(--color-foreign)]/20",
  trust:   "bg-[var(--color-trust)]/15 text-[var(--color-trust)] border-[var(--color-trust)]/20",
  dealer:  "bg-[var(--color-dealer)]/15 text-[var(--color-dealer)] border-[var(--color-dealer)]/20",
  neutral: "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]",
};

export function Badge({ variant = "neutral", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium leading-none rounded border num ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
