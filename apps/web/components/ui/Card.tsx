import { type ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingStyles = {
  none: "",
  sm:   "p-3",
  md:   "p-4",
  lg:   "p-6",
};

export function Card({ children, className = "", padding = "md" }: CardProps) {
  return (
    <div
      className={`
        bg-[var(--bg-surface)] border border-[var(--border)]
        rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]
        ${paddingStyles[padding]}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between mb-3 ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`text-[var(--text-sm)] font-semibold text-[var(--text-primary)] ${className}`}>
      {children}
    </h3>
  );
}
