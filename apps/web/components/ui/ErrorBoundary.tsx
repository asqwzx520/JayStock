"use client";

/**
 * ErrorBoundary — 全局錯誤邊界
 *
 * 使用方式（在 layout 或特定 panel 外包裝）：
 *   <ErrorBoundary>
 *     <SomeHeavyComponent />
 *   </ErrorBoundary>
 *
 * 捕獲到的錯誤會：
 *   1. 顯示使用者友善的錯誤 UI
 *   2. 透過 Sentry.captureException 上報（若 DSN 已設定）
 */

import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error:    Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    // 動態 import Sentry（套件可選；未安裝時靜默忽略）
    import(/* webpackIgnore: true */ "@sentry/nextjs" as string)
      .then((s: Record<string, unknown>) => {
        const captureException = s["captureException"] as
          | ((e: unknown) => void)
          | undefined;
        captureException?.(error);
      })
      .catch(() => {});
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center"
          style={{ color: "var(--text-secondary)" }}
        >
          <span className="text-4xl">⚠️</span>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            元件載入失敗
          </p>
          <p className="text-sm max-w-xs">
            {this.state.error?.message ?? "發生未知錯誤"}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-sm rounded font-medium"
            style={{
              background: "var(--color-brand)",
              color: "#fff",
            }}
          >
            重試
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
