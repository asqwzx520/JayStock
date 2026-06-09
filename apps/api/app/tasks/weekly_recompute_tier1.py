"""
週日 02:00：用過去 5 個交易日的 daily_snapshot 重算 Top 250 → tier1_universe
"""
from __future__ import annotations

import logging

from app.core.tier1 import recompute_tier1
from app.core.cache import cache_clear_prefix

logger = logging.getLogger(__name__)


async def weekly_recompute_tier1() -> None:
    n = await recompute_tier1(days_lookback=5, target_size=250)
    # 清掉 tier1 cache 讓下次 get_tier1_symbols 重新讀 DB
    cleared = cache_clear_prefix("app.core.tier1")
    logger.info("[weekly_recompute_tier1] new universe size=%d, cache cleared=%d", n, cleared)
