import { type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-hover)] border-transparent",
  ghost:   "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] border-transparent",
  outline: "bg-transparent text-[var(--text-primary)] border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]",
  danger:  "bg-[var(--color-up)]/10 text-[var(--color-up)] border-[var(--color-up)]/20 hover:bg-[var(--color-up)]/20",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-[12px] gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-6 text-[14px] gap-2.5",
};

export function Button({
  variant = "outline",
  size = "md",
  children,
  loading = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-medium rounded-[var(--radius-md)]
        border transition-colors duration-[var(--transition-fast)]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
    >
      {loading && (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
}
