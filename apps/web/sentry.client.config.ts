// Make this file a module (prevents TS "duplicate variable" error across config files)
export {};

/**
 * Sentry Client Configuration
 *
 * 啟用方式：
 *   cd apps/web && pnpm add @sentry/nextjs
 *   在 .env.local 中設定 NEXT_PUBLIC_SENTRY_DSN=https://...
 *
 * 未安裝套件時此檔案不作任何操作（graceful fallback）。
 */

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  // Dynamic import — Sentry SDK 不一定安裝，避免 build-time 錯誤
  void import(
    /* webpackIgnore: true */ "@sentry/nextjs" as string
  )
    .then((Sentry: Record<string, unknown>) => {
      const init = Sentry["init"] as (opts: Record<string, unknown>) => void;
      const replayIntegration = Sentry["replayIntegration"] as (
        opts?: Record<string, unknown>
      ) => unknown;
      if (typeof init !== "function") return;

      init({
        dsn: SENTRY_DSN,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? "development",
        replaysSessionSampleRate: 0.05,
        replaysOnErrorSampleRate: 1.0,
        tracesSampleRate:
          process.env.NEXT_PUBLIC_SENTRY_ENV === "production" ? 0.01 : 1.0,
        integrations:
          typeof replayIntegration === "function"
            ? [
                replayIntegration({
                  maskAllText:   false,
                  blockAllMedia: false,
                }),
              ]
            : [],
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "ResizeObserver loop completed with undelivered notifications",
          "ChunkLoadError",
          /Loading chunk \d+ failed/,
          "Network request failed",
        ],
        beforeSend(event: Record<string, unknown>) {
          if (
            typeof window !== "undefined" &&
            window.location.hostname === "localhost"
          ) {
            return null;
          }
          return event;
        },
      });
    })
    .catch(() => {
      // @sentry/nextjs 未安裝 — 靜默忽略
    });
}
