"""
Tier 1 universe 管理（讀寫 Top 250 by volume 清單）

來源：daily_snapshot 表
重算時機：週日 02:00（weekly_recompute_tier1 job）
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from app.core.cache import ttl_cache
from app.core.supabase_client import get_supabase, get_supabase_admin

logger = logging.getLogger(__name__)

DEFAULT_TIER1_SIZE = 250


# Fallback：當 tier1_universe 表還沒有資料時用的硬編清單
# （與 apps/api/app/tasks/daily_kline.py 的 POPULAR_SYMBOLS 對齊，避免冷啟動空白）
_HARDCODED_FALLBACK = [
    "2330", "2303", "2454", "3034", "2308", "2382",
    "3711", "2395", "2357", "2356", "2379", "3008",
    "2301", "2344", "2376", "2385", "6770", "3037",
    "2882", "2881", "2886", "2891", "2884", "2885",
    "2880", "2892", "5880", "2883",
    "1301", "1303", "1326", "6505", "2002",
    "2603", "2609", "2615",
    "2412", "3045",
    "2317", "4938", "2354",
    "0050", "0056", "00878", "00880", "006208",
]


@ttl_cache(ttl=600)
async def get_tier1_symbols(limit: int = DEFAULT_TIER1_SIZE) -> list[str]:
    """
    回傳 Tier 1 清單（按 rank 排序）。
    Supabase 未設定 / 表空 → 用硬編 fallback。
    """
    db = get_supabase()
    if db is None:
        return list(_HARDCODED_FALLBACK)
    try:
        resp = (
            db.table("tier1_universe")
            .select("symbol")
            .order("rank", desc=False)
            .limit(limit)
            .execute()
        )
        rows = resp.data or []
        symbols = [r["symbol"] for r in rows if r.get("symbol")]
        if symbols:
            return symbols
    except Exception as e:
        logger.warning("[tier1.get_symbols] query failed: %s", e)
    return list(_HARDCODED_FALLBACK)


async def is_tier1(symbol: str) -> bool:
    """便利函數：檢查某股是否在 Tier 1"""
    syms = await get_tier1_symbols()
    return symbol in syms


async def recompute_tier1(
    days_lookback: int = 5,
    target_size: int = DEFAULT_TIER1_SIZE,
) -> int:
    """
    用過去 N 個交易日成交量平均重算 Top {target_size}。
    寫入 tier1_universe。回傳實際寫入筆數。
    """
    db = get_supabase_admin()
    if db is None:
        logger.warning("[tier1.recompute] supabase_admin not set; skip")
        return 0

    # 取最近 days_lookback × 1.5 個日曆日的 snapshot（含週末），實際只會有 days_lookback 個交易日
    today = date.today()
    cutoff = today - timedelta(days=int(days_lookback * 1.6) + 3)

    try:
        resp = (
            db.table("daily_snapshot")
            .select("symbol, volume")
            .gte("date", cutoff.isoformat())
            .execute()
        )
        rows = resp.data or []
    except Exception as e:
        logger.error("[tier1.recompute] query failed: %s", e)
        return 0

    # 聚合：symbol → avg volume
    from collections import defaultdict
    vol_sum: dict[str, int]   = defaultdict(int)
    vol_count: dict[str, int] = defaultdict(int)
    for r in rows:
        sym = r.get("symbol")
        if not sym:
            continue
        v = int(r.get("volume") or 0)
        if v <= 0:
            continue
        vol_sum[sym]   += v
        vol_count[sym] += 1

    # 取至少有 N/2 天數據的
    min_days = max(1, days_lookback // 2)
    candidates = [
        (sym, vol_sum[sym] // vol_count[sym])
        for sym in vol_sum
        if vol_count[sym] >= min_days
    ]
    candidates.sort(key=lambda x: x[1], reverse=True)
    top = candidates[:target_size]
    if not top:
        return 0

    # 清空舊資料 + 寫新資料
    try:
        # 用 upsert 避免 RLS / DELETE 權限問題
        db.table("tier1_universe").delete().neq("symbol", "__none__").execute()
        records = [
            {"symbol": sym, "rank": i + 1, "avg_volume_5d": int(vol)}
            for i, (sym, vol) in enumerate(top)
        ]
        # Supabase 批次插入限制：每批最多 1000
        for i in range(0, len(records), 500):
            db.table("tier1_universe").upsert(records[i:i + 500]).execute()
    except Exception as e:
        logger.error("[tier1.recompute] write failed: %s", e)
        return 0

    logger.info("[tier1.recompute] wrote %d symbols (top vol=%d, bottom vol=%d)",
                len(top), top[0][1], top[-1][1])
    return len(top)
