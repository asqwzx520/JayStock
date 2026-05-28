-- ============================================================
-- Supabase Migration: Watchlist 持久化表
-- 執行位置：Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS watchlist_groups (
    id         TEXT        NOT NULL PRIMARY KEY,
    user_id    TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    sort_order INTEGER     DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wg_user ON watchlist_groups (user_id, sort_order);

CREATE TABLE IF NOT EXISTS watchlist_items (
    id                 TEXT    NOT NULL PRIMARY KEY,
    user_id            TEXT    NOT NULL,
    group_id           TEXT    NOT NULL,
    symbol             TEXT    NOT NULL,
    note               TEXT    DEFAULT '',
    tags               JSONB   DEFAULT '[]',
    sort_order         INTEGER DEFAULT 0,
    price_alert_above  NUMERIC,
    price_alert_below  NUMERIC,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wi_user  ON watchlist_items (user_id);
CREATE INDEX IF NOT EXISTS idx_wi_group ON watchlist_items (group_id);

-- RLS
ALTER TABLE watchlist_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wg_service_all" ON watchlist_groups FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "wi_service_all" ON watchlist_items FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
