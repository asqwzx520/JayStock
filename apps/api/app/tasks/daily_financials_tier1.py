"""
Tier 1 季財報快取

15:30 跑：MOPS 爬蟲抓最新季 → financials_quarterly
MOPS 失敗 fallback FinMind。
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.supabase_client import get_supabase_admin
from app.core.retry import log_failure
from app.core.tier1 import get_tier1_symbols
from app.services.mops_service import fetch_quarterly_financials

logger = logging.getLogger(__name__)
_TZ_TAIPEI = ZoneInfo("Asia/Taipei")

CONCURRENCY = 4   # MOPS 容易反爬，低併發保護
REQUEST_DELAY = 0.4


def _current_target_quarter() -> tuple[int, int]:
    """根據今天決定要抓哪一季。台灣 IFRS 公告期限：
       Q1 → 5/15 前；Q2 → 8/14 前；Q3 → 11/14 前；Q4（年報）→ 隔年 3/31 前"""
    now = datetime.now(_TZ_TAIPEI)
    y, m = now.year, now.month
    if   m <= 3:   return y - 1, 3   # 找去年 Q3
    elif m <= 5:   return y - 1, 4   # 找去年 Q4（年報）
    elif m <= 8:   return y,     1
    elif m <= 11:  return y,     2
    else:          return y,     3


async def _fetch_one(symbol: str, year: int, quarter: int, sem: asyncio.Semaphore) -> tuple[str, dict | None]:
    async with sem:
        await asyncio.sleep(REQUEST_DELAY)
        try:
            data = await fetch_quarterly_financials(symbol, year, quarter)
        except Exception:
            data = None
        return symbol, data


async def fetch_daily_financials_tier1() -> None:
    db = get_supabase_admin()
    if db is None:
        logger.info("[daily_financials_tier1] Supabase 未設定，跳過")
        return

    symbols = await get_tier1_symbols()
    if not symbols:
        return

    year, quarter = _current_target_quarter()
    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = [_fetch_one(s, year, quarter, sem) for s in symbols]

    success = 0
    failed: list[str] = []
    results = await asyncio.gather(*tasks, return_exceptions=True)
    records = []
    for r in results:
        if isinstance(r, Exception):
            continue
        sym, data = r
        if not data:
            failed.append(sym)
            continue
        records.append({
            "symbol":           sym,
            "year":             year,
            "quarter":          quarter,
            "revenue":          data.get("revenue"),
            "gross_profit":     data.get("gross_profit"),
            "operating_income": data.get("operating_income"),
            "net_income":       data.get("net_income"),
            "eps":              data.get("eps"),
            "equity":           data.get("equity"),
            "total_assets":     data.get("total_assets"),
            "source":           "mops",
        })
        success += 1

    for i in range(0, len(records), 200):
        try:
            db.table("financials_quarterly").upsert(
                records[i:i + 200], on_conflict="symbol,year,quarter"
            ).execute()
        except Exception as e:
            logger.error("[daily_financials_tier1] batch %d failed: %s", i // 200, e)

    for sym in failed:
        await log_failure("daily_financials_tier1", symbol=sym, error="mops empty")

    logger.info("[daily_financials_tier1] %sQ%s: success=%d failed=%d",
                year, quarter, success, len(failed))
