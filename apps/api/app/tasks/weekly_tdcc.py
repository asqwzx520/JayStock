"""
週四 17:30：TDCC 集保結算所股權分散表 → tdcc_ownership
"""
from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.supabase_client import get_supabase_admin
from app.core.retry import log_failure
from app.services.tdcc_service import fetch_tdcc_ownership_all

logger = logging.getLogger(__name__)
_TZ_TAIPEI = ZoneInfo("Asia/Taipei")


async def fetch_weekly_tdcc() -> None:
    db = get_supabase_admin()
    if db is None:
        return

    try:
        data = await fetch_tdcc_ownership_all()
    except Exception as e:
        await log_failure("weekly_tdcc", error=str(e))
        logger.error("[weekly_tdcc] fetch failed: %s", e)
        return

    if not data:
        logger.warning("[weekly_tdcc] 無資料")
        return

    records = []
    for sym, rec in data.items():
        wd = rec.get("week_date")
        if not wd:
            continue
        # TDCC 日期格式：YYYYMMDD or YYYY/MM/DD
        try:
            wd_clean = wd.replace("/", "")
            week_date_iso = f"{wd_clean[:4]}-{wd_clean[4:6]}-{wd_clean[6:8]}"
        except Exception:
            continue
        records.append({
            "symbol":            sym,
            "week_date":         week_date_iso,
            "retail_pct":        rec.get("retail_pct"),
            "major_pct":         rec.get("major_pct"),
            "shareholder_count": rec.get("shareholder_count"),
            "major_count":       rec.get("major_count"),
        })

    written = 0
    for i in range(0, len(records), 500):
        try:
            db.table("tdcc_ownership").upsert(
                records[i:i + 500], on_conflict="symbol,week_date"
            ).execute()
            written += len(records[i:i + 500])
        except Exception as e:
            logger.warning("[weekly_tdcc] batch %d failed: %s", i // 500, e)

    logger.info("[weekly_tdcc] wrote %d ownership rows", written)
