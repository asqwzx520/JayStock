-- ============================================================
-- Supabase Migration: K 線 & 籌碼每日快取表
-- 執行位置：Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── 日 K 線快取 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kline_daily (
    symbol   TEXT        NOT NULL,
    date     DATE        NOT NULL,
    open     NUMERIC(12,2),
    high     NUMERIC(12,2),
    low      NUMERIC(12,2),
    close    NUMERIC(12,2),
    volume   BIGINT      DEFAULT 0,
    turnover BIGINT      DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, date)
);

-- 常用查詢：by symbol + date range
CREATE INDEX IF NOT EXISTS idx_kline_daily_symbol_date
    ON kline_daily (symbol, date DESC);

-- ── 三大法人籌碼快取 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS chips_daily (
    symbol       TEXT   NOT NULL,
    date         DATE   NOT NULL,
    foreign_buy  BIGINT DEFAULT 0,
    foreign_sell BIGINT DEFAULT 0,
    trust_buy    BIGINT DEFAULT 0,
    trust_sell   BIGINT DEFAULT 0,
    dealer_buy   BIGINT DEFAULT 0,
    dealer_sell  BIGINT DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_chips_daily_symbol_date
    ON chips_daily (symbol, date DESC);

-- ── Row Level Security（建議開啟讀取允許，寫入限後端 service key）
ALTER TABLE kline_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chips_daily  ENABLE ROW LEVEL SECURITY;

-- 允許任何人 SELECT（前端也可直接查，若有需要）
CREATE POLICY "kline_daily_read_all"
    ON kline_daily FOR SELECT USING (true);

CREATE POLICY "chips_daily_read_all"
    ON chips_daily FOR SELECT USING (true);

-- 只允許 service_role（後端 SUPABASE_KEY）寫入
CREATE POLICY "kline_daily_service_write"
    ON kline_daily FOR ALL
    USING     (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "chips_daily_service_write"
    ON chips_daily FOR ALL
    USING     (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ── 自動更新 updated_at（optional trigger）─────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER kline_daily_updated_at
    BEFORE UPDATE ON kline_daily
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER chips_daily_updated_at
    BEFORE UPDATE ON chips_daily
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
