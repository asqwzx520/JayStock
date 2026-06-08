-- ============================================================
-- Sprint 3 Phase 2 + Phase 3 Migration
-- 執行位置：Supabase Dashboard → SQL Editor → Run
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PHASE 2 — Schema / 索引優化
-- ════════════════════════════════════════════════════════════

-- ── Covering Index（取代舊的普通索引，讓查詢能 Index Only Scan）──

-- kline_daily：查詢時不需回 heap 讀取 OHLCV，直接從 index 拿資料
DROP INDEX IF EXISTS idx_kline_daily_symbol_date;
CREATE INDEX IF NOT EXISTS idx_kline_covering
    ON kline_daily (symbol, date DESC)
    INCLUDE (open, high, low, close, volume, turnover);

-- chips_daily：三大法人主要欄位加入 INCLUDE
DROP INDEX IF EXISTS idx_chips_daily_symbol_date;
CREATE INDEX IF NOT EXISTS idx_chips_covering
    ON chips_daily (symbol, date DESC)
    INCLUDE (foreign_buy, foreign_sell, trust_buy, trust_sell, dealer_buy, dealer_sell);

-- ── 5 年清理函式（手動執行或搭配 pg_cron 每月跑一次）────────────
CREATE OR REPLACE FUNCTION cleanup_old_cache()
RETURNS TABLE(kline_deleted bigint, chips_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_kline  bigint;
    v_chips  bigint;
    v_cutoff date := CURRENT_DATE - INTERVAL '5 years';
BEGIN
    DELETE FROM kline_daily WHERE date < v_cutoff;
    GET DIAGNOSTICS v_kline = ROW_COUNT;

    DELETE FROM chips_daily WHERE date < v_cutoff;
    GET DIAGNOSTICS v_chips = ROW_COUNT;

    RETURN QUERY SELECT v_kline, v_chips;
END;
$$;

-- 使用方式：SELECT * FROM cleanup_old_cache();


-- ════════════════════════════════════════════════════════════
-- PHASE 3 — 可選擴充：基本面 & 新聞快取表
-- ════════════════════════════════════════════════════════════

-- ── 基本面快取（PE / EPS / 殖利率 / 市值 …）TTL 7 天 ──────────
CREATE TABLE IF NOT EXISTS fundamental_cache (
    symbol     TEXT        PRIMARY KEY,
    data       JSONB       NOT NULL,
    cached_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fundamental_cache_cached_at
    ON fundamental_cache (cached_at DESC);

-- ── 個股新聞快取（yfinance 結果）TTL 4 小時 ───────────────────
CREATE TABLE IF NOT EXISTS news_cache (
    symbol     TEXT        PRIMARY KEY,
    items      JSONB       NOT NULL,   -- array of news item objects
    cached_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_cache_cached_at
    ON news_cache (cached_at DESC);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE fundamental_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_cache        ENABLE ROW LEVEL SECURITY;

-- 允許任何人 SELECT（先 DROP 確保冪等）
DROP POLICY IF EXISTS "fundamental_cache_read_all"     ON fundamental_cache;
DROP POLICY IF EXISTS "fundamental_cache_service_write" ON fundamental_cache;
DROP POLICY IF EXISTS "news_cache_read_all"            ON news_cache;
DROP POLICY IF EXISTS "news_cache_service_write"       ON news_cache;

CREATE POLICY "fundamental_cache_read_all"
    ON fundamental_cache FOR SELECT USING (true);

CREATE POLICY "news_cache_read_all"
    ON news_cache FOR SELECT USING (true);

-- 只允許 service_role 寫入
CREATE POLICY "fundamental_cache_service_write"
    ON fundamental_cache FOR ALL
    USING     (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "news_cache_service_write"
    ON news_cache FOR ALL
    USING     (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- !! 重要：service_role 繞過 RLS 但仍需 table-level GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fundamental_cache TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.news_cache         TO service_role;

-- ── updated_at 觸發器（可選）──────────────────────────────────
-- set_updated_at() 函式在 20260529 migration 已建立，此處直接使用
-- （若尚未建立請先執行 20260529_kline_chips_cache.sql）
