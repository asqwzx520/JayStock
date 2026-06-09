"""
盤中每 5 分鐘刷新大盤指數快取（in-process TTL）

不寫 Supabase（高頻短週期，沒必要持久化）；只是觸發 TTL cache 預熱，
讓 /api/v1/market/indices 永遠拿到熱資料。
"""
from __future__ import annotations

import asyncio
import logging

from app.core.sources import fetch_index

logger = logging.getLogger(__name__)

# 監控的指數清單
TRACKED_INDICES = [
    "^TWII",   # 台股加權
    "^GSPC",   # S&P 500
    "^IXIC",   # NASDAQ
    "^DJI",    # 道瓊
    "^SOX",   # 費城半導體
    "^N225",   # 日經
    "^HSI",    # 恆生
    "ES=F",    # S&P 期貨
    "NQ=F",    # NASDAQ 期貨
]


async def warm_indices() -> None:
    """並行預熱所有指數 cache。失敗單檔不影響整體。"""
    tasks = [fetch_index(t) for t in TRACKED_INDICES]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    ok = sum(1 for r in results if isinstance(r, dict))
    logger.debug("[intraday_indices] warmed %d/%d", ok, len(TRACKED_INDICES))
