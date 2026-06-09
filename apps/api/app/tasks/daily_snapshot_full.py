"""
全市場每日 snapshot（Tier 2 淺層）

14:35 跑：
- TWSE STOCK_DAY_ALL（全市場收盤量價）
- TWSE BWIBBU_d（P/E / 殖利率 / P/B）

合併後寫 daily_snapshot。2 個 API call、~10 秒完成。
"""
from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.supabase_client import get_supabase_admin
from app.core.retry import log_failure
from app.services.twse_service import fetch_stock_day_all, fetch_bwibbu_all

logger = logging.getLogger(__name__)
_TZ_TAIPEI = ZoneInfo("Asia/Taipei")


async def fetch_daily_snapshot_full() -> None:
    db = get_supabase_admin()
    if db is None:
        logger.info("[daily_snapshot_full] Supabase 未設定，跳過")
        return

    today = datetime.now(_TZ_TAIPEI).date()

    try:
        ohlcv = await fetch_stock_day_all()
    except Exception as e:
        logger.error("[daily_snapshot_full] STOCK_DAY_ALL failed: %s", e)
        await log_failure("daily_snapshot_full", target_date=today, error=f"stock_day_all: {e}")
        return

    try:
        valuation = await fetch_bwibbu_all()
    except Exception as e:
        logger.warning("[daily_snapshot_full] BWIBBU_d failed (continuing): %s", e)
        valuation = {}

    if not ohlcv:
        logger.warning("[daily_snapshot_full] STOCK_DAY_ALL 空，可能是非交易日")
        return

    records = []
    for row in ohlcv:
        sym = row["symbol"]
        val = valuation.get(sym, {})
        records.append({
            "date":           today.isoformat(),
            "symbol":         sym,
            "close":          row.get("close"),
            "volume":         int(row.get("volume") or 0),
            "pe_ratio":       val.get("pe_ratio"),
            "pb_ratio":       val.get("pb_ratio"),
            "dividend_yield": val.get("dividend_yield"),
        })

    written = 0
    for i in range(0, len(records), 500):
        batch = records[i:i + 500]
        try:
            db.table("daily_snapshot").upsert(batch, on_conflict="date,symbol").execute()
            written += len(batch)
        except Exception as e:
            logger.error("[daily_snapshot_full] batch %d failed: %s", i // 500, e)
            await log_failure("daily_snapshot_full", target_date=today, error=str(e))

    logger.info("[daily_snapshot_full] wrote %d rows for %s (valuation cover %d)",
                written, today, len(valuation))
