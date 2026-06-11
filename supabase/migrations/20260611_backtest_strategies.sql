-- ============================================================
-- Supabase Migration: 回測策略書（P0-4：儲存/重跑/刪除）
-- 執行位置：Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS backtest_strategies (
    id              TEXT        NOT NULL PRIMARY KEY,
    user_id         TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    note            TEXT        DEFAULT '',
    strategy_json   JSONB       NOT NULL,
    symbol          TEXT        NOT NULL,
    start_date      TEXT        NOT NULL,
    end_date        TEXT        NOT NULL,
    initial_capital DOUBLE PRECISION NOT NULL DEFAULT 1000000,
    stop_loss_pct   DOUBLE PRECISION,
    take_profit_pct DOUBLE PRECISION,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bs_user_created
    ON backtest_strategies (user_id, created_at DESC);
