"""
每日全市場三大法人快取（取代舊 daily_chip.py）

14:10 跑：TWSE T86 bulk → 全市場 ~1700 檔當日法人 → 寫 chips_daily
1 個 API call、約 5 秒完成。
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.supabase_client import get_supabase_admin
from app.core.retry import log_failure
from app.services.twse_service import fetch_t86_for_date

logger = logging.getLogger(__name__)
_TZ_TAIPEI = ZoneInfo("Asia/Taipei")


async def fetch_daily_chips_full() -> None:
    """主入口：抓取最近一個交易日的全市場三大法人，寫進 Supabase"""
    db = get_supabase_admin()
    if db is None:
        logger.info("[daily_chips_full] Supabase 未設定，跳過")
        return

    today = datetime.now(_TZ_TAIPEI).date()

    # 嘗試最近 5 個交易日
    target_date: date | None = None
    data: dict[str, dict[str, int]] = {}
    for offset in range(0, 6):
        d = today - timedelta(days=offset)
        if d.weekday() >= 5:
            continue
        try:
            data = await fetch_t86_for_date(d)
        except Exception as e:
            logger.warning("[daily_chips_full] %s fetch failed: %s", d, e)
            data = {}
        if data:
            target_date = d
            break

    if not data or target_date is None:
        logger.warning("[daily_chips_full] 6 天內找不到 T86 資料")
        await log_failure("daily_chips_full", error="no data in last 6 days")
        return

    # 轉換為 chips_daily schema（net → buy/sell）
    records = []
    for sym, rec in data.items():
        records.append({
            "symbol":       sym,
            "date":         target_date.isoformat(),
            "foreign_buy":  max(rec["foreign_net"], 0),
            "foreign_sell": max(-rec["foreign_net"], 0),
            "trust_buy":    max(rec["trust_net"], 0),
            "trust_sell":   max(-rec["trust_net"], 0),
            "dealer_buy":   max(rec["dealer_net"], 0),
            "dealer_sell":  max(-rec["dealer_net"], 0),
            "source":       "twse_t86",
        })

    # 批次寫入（每批 500）
    written = 0
    for i in range(0, len(records), 500):
        batch = records[i:i + 500]
        try:
            db.table("chips_daily").upsert(batch, on_conflict="symbol,date").execute()
            written += len(batch)
        except Exception as e:
            logger.error("[daily_chips_full] batch %d failed: %s", i // 500, e)
            await log_failure("daily_chips_full", target_date=target_date, error=str(e))

    logger.info("[daily_chips_full] wrote %d rows for %s", written, target_date)
