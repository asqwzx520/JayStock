from fastapi import APIRouter, HTTPException, Query
from datetime import date, timedelta
import logging

from app.services.finmind_service import fetch_daily_kline as finmind_fetch_kline
from app.core.supabase_client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()


async def _kline_from_supabase(
    symbol: str, start: date, end: date
) -> list[dict] | None:
    """從 Supabase 讀取快取；未設定或無資料回傳 None"""
    try:
        supabase = get_supabase()
        if supabase is None:
            return None
        resp = (
            supabase.table("kline_daily")
            .select("date,open,high,low,close,volume,turnover")
            .eq("symbol", symbol)
            .gte("date", start.isoformat())
            .lte("date", end.isoformat())
            .order("date")
            .execute()
        )
        rows = resp.data
        if not rows:
            return None
        return rows
    except Exception as e:
        logger.warning(f"[kline] Supabase 讀取失敗，fallback to FinMind: {e}")
        return None


@router.get("/kline/{symbol}")
async def get_kline(
    symbol: str,
    start: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end: date | None = Query(None, description="End date (YYYY-MM-DD)"),
    period: str = Query("daily", description="daily / weekly / monthly"),
):
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=365)

    # 1. 嘗試從 Supabase 快取讀取
    rows = await _kline_from_supabase(symbol, start, end)

    # 2. Cache miss → 直接打 FinMind
    if rows is None:
        logger.debug(f"[kline] {symbol} cache miss，呼叫 FinMind")
        try:
            rows = await finmind_fetch_kline(symbol, start, end)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"FinMind error: {e}")

    if not rows:
        raise HTTPException(status_code=404, detail=f"No kline data for {symbol}")

    if period == "weekly":
        rows = _aggregate(rows, "W")
    elif period == "monthly":
        rows = _aggregate(rows, "M")

    return {"symbol": symbol, "period": period, "count": len(rows), "data": rows}


def _aggregate(rows: list[dict], freq: str) -> list[dict]:
    if not rows:
        return []

    def group_key(d: str) -> str:
        dt = date.fromisoformat(d)
        if freq == "W":
            monday = dt - timedelta(days=dt.weekday())
            return monday.isoformat()
        return d[:7]

    groups: dict[str, list[dict]] = {}
    for r in rows:
        k = group_key(r["date"])
        groups.setdefault(k, []).append(r)

    result = []
    for key, items in groups.items():
        result.append({
            "date":     items[0]["date"],
            "open":     items[0]["open"],
            "high":     max(i["high"] for i in items),
            "low":      min(i["low"]  for i in items),
            "close":    items[-1]["close"],
            "volume":   sum(i["volume"]   for i in items),
            "turnover": sum(i["turnover"] for i in items),
        })
    return result
