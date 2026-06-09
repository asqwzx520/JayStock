"""
Tier 1（Top 250）日 K 線快取（取代舊 daily_kline.py）

15:00 跑：YF v8/chart 直連 httpx 並行抓 250 檔 90 天 K 線 → kline_daily
主力 YF 直連；失敗 fallback FinMind。
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import httpx

from app.core.supabase_client import get_supabase_admin
from app.core.retry import log_failure, process_pending_failures
from app.core.tier1 import get_tier1_symbols
from app.services.yf_direct import fetch_kline as yf_fetch_kline
from app.services.finmind_service import fetch_daily_kline as fm_fetch_kline

logger = logging.getLogger(__name__)
_TZ_TAIPEI = ZoneInfo("Asia/Taipei")

CONCURRENCY = 15
LOOKBACK_DAYS = 90


async def _fetch_one(symbol: str, start: date, end: date, sem: asyncio.Semaphore) -> tuple[str, list[dict]]:
    async with sem:
        # 1. YF 直連
        try:
            rows = await yf_fetch_kline(symbol, start, end)
            if rows:
                return symbol, rows
        except Exception:
            pass
        # 2. FinMind 保底
        try:
            rows = await fm_fetch_kline(symbol, start=start, end=end)
            if rows:
                return symbol, rows
        except Exception:
            pass
        return symbol, []


async def fetch_daily_kline_tier1() -> None:
    db = get_supabase_admin()
    if db is None:
        logger.info("[daily_kline_tier1] Supabase 未設定，跳過")
        return

    # 先處理上輪失敗
    async def _retry_one(sym, _):
        if not sym:
            return False
        rows = await yf_fetch_kline(sym, date.today() - timedelta(days=LOOKBACK_DAYS), date.today())
        if not rows:
            return False
        _write_rows(db, sym, rows)
        return True

    try:
        resolved = await process_pending_failures("daily_kline_tier1", _retry_one)
        if resolved > 0:
            logger.info("[daily_kline_tier1] resolved %d pending failures", resolved)
    except Exception as e:
        logger.warning("[daily_kline_tier1] process_pending failed: %s", e)

    symbols = await get_tier1_symbols()
    if not symbols:
        logger.warning("[daily_kline_tier1] tier1 universe 空，略過")
        return

    end   = date.today()
    start = end - timedelta(days=LOOKBACK_DAYS)
    sem   = asyncio.Semaphore(CONCURRENCY)
    tasks = [_fetch_one(s, start, end, sem) for s in symbols]

    success = 0
    failed: list[str] = []
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            continue
        sym, rows = r
        if not rows:
            failed.append(sym)
            await log_failure("daily_kline_tier1", symbol=sym, error="all sources empty")
            continue
        _write_rows(db, sym, rows)
        success += 1

    logger.info("[daily_kline_tier1] success=%d failed=%d total=%d",
                success, len(failed), len(symbols))


def _write_rows(db, symbol: str, rows: list[dict]) -> None:
    if not rows:
        return
    records = [
        {
            "symbol":   symbol,
            "date":     r["date"],
            "open":     r.get("open"),
            "high":     r.get("high"),
            "low":      r.get("low"),
            "close":    r.get("close"),
            "volume":   int(r.get("volume") or 0),
            "turnover": 0,
            "source":   "yf_direct",
        }
        for r in rows
        if r.get("close") is not None
    ]
    try:
        for i in range(0, len(records), 500):
            db.table("kline_daily").upsert(records[i:i + 500], on_conflict="symbol,date").execute()
    except Exception as e:
        logger.warning("[daily_kline_tier1.write] %s failed: %s", symbol, e)
