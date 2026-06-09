"""
Tier 1 多源新聞快取

15:45 跑：聚合 Yahoo + 鉅亨 + MoneyDJ + Google News → news_cache（以 link 去重）
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.core.supabase_client import get_supabase_admin
from app.core.tier1 import get_tier1_symbols
from app.services.news_aggregator import fetch_aggregated_news

logger = logging.getLogger(__name__)

CONCURRENCY = 5
PER_SYMBOL_LIMIT = 20


async def _fetch_one(symbol: str, sem: asyncio.Semaphore) -> tuple[str, list[dict]]:
    async with sem:
        try:
            items = await fetch_aggregated_news(symbol, limit=PER_SYMBOL_LIMIT)
            return symbol, items
        except Exception as e:
            logger.debug("[daily_news_tier1] %s failed: %s", symbol, e)
            return symbol, []


async def fetch_daily_news_tier1() -> None:
    db = get_supabase_admin()
    if db is None:
        logger.info("[daily_news_tier1] Supabase 未設定，跳過")
        return

    symbols = await get_tier1_symbols()
    if not symbols:
        return

    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = [_fetch_one(s, sem) for s in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_records = []
    total = 0
    for r in results:
        if isinstance(r, Exception):
            continue
        sym, items = r
        for it in items:
            link = it.get("link")
            if not link:
                continue
            pub_ts = it.get("published_at") or 0
            try:
                pub_iso = datetime.fromtimestamp(int(pub_ts), tz=timezone.utc).isoformat() if pub_ts else None
            except Exception:
                pub_iso = None
            if not pub_iso:
                continue
            all_records.append({
                "symbol":       sym,
                "title":        it.get("title", "")[:500],
                "publisher":    (it.get("publisher") or "")[:100],
                "link":         link[:1000],
                "published_at": pub_iso,
                "importance":   it.get("importance", "低"),
                "is_chinese":   bool(it.get("is_chinese")),
                "thumbnail":    it.get("thumbnail"),
                "source":       it.get("source", ""),
            })
        total += len(items)

    # 寫入，UNIQUE(link) 自動去重
    written = 0
    for i in range(0, len(all_records), 200):
        batch = all_records[i:i + 200]
        try:
            db.table("news_cache").upsert(batch, on_conflict="link").execute()
            written += len(batch)
        except Exception as e:
            logger.warning("[daily_news_tier1] batch %d failed: %s", i // 200, e)

    logger.info("[daily_news_tier1] fetched=%d written=%d (deduped by link)", total, written)
