-- ============================================================
-- Supabase Migration: Tier 雙層快取架構（9-bug 修復計畫）
-- 執行位置：Supabase Dashboard → SQL Editor → Run
-- 詳見：docs/TIER-CACHE-REFACTOR.md
-- ============================================================

-- ── 1. 全市場每日 snapshot（Tier 2 淺層）─────────────────────
CREATE TABLE IF NOT EXISTS daily_snapshot (
    date            DATE      NOT NULL,
    symbol          TEXT      NOT NULL,
    close           NUMERIC(12,2),
    volume          BIGINT    DEFAULT 0,
    pe_ratio        NUMERIC(10,2),
    pb_ratio        NUMERIC(10,2),
    dividend_yield  NUMERIC(6,2),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, symbol)
);
CREATE INDEX IF NOT EXISTS idx_daily_snapshot_symbol_date
    ON daily_snapshot (symbol, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_snapshot_date_volume
    ON daily_snapshot (date DESC, volume DESC);

-- ── 2. 季財報（Tier 1 深層）─────────────────────────────────
CREATE TABLE IF NOT EXISTS financials_quarterly (
    symbol           TEXT NOT NULL,
    year             INT  NOT NULL,
    quarter          INT  NOT NULL,
    revenue          NUMERIC(20,0),
    gross_profit     NUMERIC(20,0),
    operating_income NUMERIC(20,0),
    net_income       NUMERIC(20,0),
    eps              NUMERIC(10,2),
    equity           NUMERIC(20,0),
    total_assets     NUMERIC(20,0),
    source           TEXT,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, year, quarter)
);

-- ── 3. 月營收（MOPS 自結公告）───────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_revenue (
    symbol     TEXT NOT NULL,
    year       INT  NOT NULL,
    month      INT  NOT NULL,
    revenue    NUMERIC(20,0),
    yoy_pct    NUMERIC(8,2),
    mom_pct    NUMERIC(8,2),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, year, month)
);

-- ── 4. 新聞快取（多源去重）──────────────────────────────────
CREATE TABLE IF NOT EXISTS news_cache (
    id            BIGSERIAL PRIMARY KEY,
    symbol        TEXT,
    title         TEXT NOT NULL,
    publisher     TEXT,
    link          TEXT UNIQUE NOT NULL,
    published_at  TIMESTAMPTZ NOT NULL,
    importance    TEXT,
    is_chinese    BOOLEAN DEFAULT FALSE,
    thumbnail     TEXT,
    source        TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_news_cache_symbol_published
    ON news_cache (symbol, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_cache_published
    ON news_cache (published_at DESC);

-- ── 5. TDCC 股權分散（週度）─────────────────────────────────
CREATE TABLE IF NOT EXISTS tdcc_ownership (
    symbol            TEXT NOT NULL,
    week_date         DATE NOT NULL,
    retail_pct        NUMERIC(6,2),
    major_pct         NUMERIC(6,2),
    shareholder_count INT,
    major_count       INT,
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, week_date)
);
CREATE INDEX IF NOT EXISTS idx_tdcc_ownership_symbol_date
    ON tdcc_ownership (symbol, week_date DESC);

-- ── 6. Tier 1 universe（Top 250 by volume）──────────────────
CREATE TABLE IF NOT EXISTS tier1_universe (
    symbol         TEXT PRIMARY KEY,
    rank           INT,
    avg_volume_5d  BIGINT,
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tier1_universe_rank
    ON tier1_universe (rank);

-- ── 7. Cache 失敗記錄（自動 retry 用）──────────────────────
CREATE TABLE IF NOT EXISTS cache_failures (
    id             BIGSERIAL PRIMARY KEY,
    job_name       TEXT NOT NULL,
    target_symbol  TEXT,
    target_date    DATE,
    error_msg      TEXT,
    retry_count    INT DEFAULT 0,
    resolved       BOOLEAN DEFAULT FALSE,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cache_failures_pending
    ON cache_failures (resolved, created_at)
    WHERE resolved = FALSE;

-- ── 擴充既有表：標註資料來源 ────────────────────────────────
ALTER TABLE chips_daily
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'twse_t86';
ALTER TABLE kline_daily
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'yf_direct';

-- ── RLS（公開讀，service_role 寫）──────────────────────────
ALTER TABLE daily_snapshot       ENABLE ROW LEVEL SECURITY;
ALTER TABLE financials_quarterly ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_revenue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_cache           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdcc_ownership       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier1_universe       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_failures       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'daily_snapshot', 'financials_quarterly', 'monthly_revenue',
        'news_cache', 'tdcc_ownership', 'tier1_universe', 'cache_failures'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS "%s_read_all" ON %I', t, t);
        EXECUTE format('CREATE POLICY "%s_read_all" ON %I FOR SELECT USING (true)', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "%s_service_write" ON %I', t, t);
        EXECUTE format('CREATE POLICY "%s_service_write" ON %I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
    END LOOP;
END $$;
