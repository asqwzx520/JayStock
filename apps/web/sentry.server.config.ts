export {};

/**
 * Sentry Server Configuration (Node.js runtime)
 *
 * 啟用方式：
 *   cd apps/web && pnpm add @sentry/nextjs
 *   設定 NEXT_PUBLIC_SENTRY_DSN 環境變數
 */

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  void import(/* webpackIgnore: true */ "@sentry/nextjs" as string)
    .then((Sentry: Record<string, unknown>) => {
      const init = Sentry["init"] as (opts: Record<string, unknown>) => void;
      if (typeof init === "function") {
        init({
          dsn: SENTRY_DSN,
          environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? "development",
          tracesSampleRate:
            process.env.NEXT_PUBLIC_SENTRY_ENV === "production" ? 0.05 : 1.0,
        });
      }
    })
    .catch(() => {
      // @sentry/nextjs 未安裝 — 靜默忽略
    });
}
