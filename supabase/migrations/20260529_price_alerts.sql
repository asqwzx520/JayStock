-- ============================================================
-- Supabase Migration: 價格提醒通知表
-- ============================================================

CREATE TABLE IF NOT EXISTS price_alert_notifications (
    id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id    TEXT        NOT NULL,
    symbol     TEXT        NOT NULL,
    alert_type TEXT        NOT NULL,   -- 'above' | 'below'
    threshold  NUMERIC     NOT NULL,   -- 設定的觸發價
    price      NUMERIC     NOT NULL,   -- 實際成交價
    read_at    TIMESTAMPTZ,            -- NULL = 未讀
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pan_user_unread
    ON price_alert_notifications (user_id, read_at)
    WHERE read_at IS NULL;

ALTER TABLE price_alert_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pan_service_all" ON price_alert_notifications FOR ALL
    USING     (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
