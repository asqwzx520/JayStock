"""
每月 11 日 09:00：MOPS 月營收公告 → monthly_revenue（全市場）
"""
from __future__ import annotations

import logging

from app.core.supabase_client import get_supabase_admin
from app.core.retry import log_failure
from app.services.mops_service import fetch_latest_monthly_revenue

logger = logging.getLogger(__name__)


async def fetch_monthly_revenue_job() -> None:
    db = get_supabase_admin()
    if db is None:
        return

    try:
        year, month, data = await fetch_latest_monthly_revenue()
    except Exception as e:
        await log_failure("monthly_revenue", error=str(e))
        logger.error("[monthly_revenue] fetch failed: %s", e)
        return

    if not data or year == 0:
        logger.warning("[monthly_revenue] 找不到最新月營收資料")
        return

    records = [
        {
            "symbol":  sym,
            "year":    year,
            "month":   month,
            "revenue": rec.get("revenue"),
            "yoy_pct": rec.get("yoy_pct"),
            "mom_pct": rec.get("mom_pct"),
        }
        for sym, rec in data.items()
        if rec.get("revenue") is not None
    ]

    written = 0
    for i in range(0, len(records), 500):
        try:
            db.table("monthly_revenue").upsert(
                records[i:i + 500], on_conflict="symbol,year,month"
            ).execute()
            written += len(records[i:i + 500])
        except Exception as e:
            logger.warning("[monthly_revenue] batch %d failed: %s", i // 500, e)

    logger.info("[monthly_revenue] %s/%s wrote %d rows", year, month, written)
