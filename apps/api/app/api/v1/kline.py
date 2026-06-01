from fastapi import APIRouter, HTTPException, Query
from datetime import date, timedelta
import logging

from app.services.finmind_service import (
    fetch_daily_kline as finmind_fetch_kline,
    fetch_intraday_kline,
)
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


_VALID_INTRADAY = {"1m", "5m", "15m", "30m", "60m"}


@router.get("/kline/{symbol}/intraday")
async def get_intraday_kline(
    symbol: str,
    period: str = Query("5m", description="1m / 5m / 15m / 30m / 60m"),
    date_str: str | None = Query(None, alias="date", description="YYYY-MM-DD (預設今日)"),
):
    """盤中分 K：從 FinMind TaiwanStockPriceMinute 拉 1m 資料後聚合"""
    if period not in _VALID_INTRADAY:
        raise HTTPException(status_code=400, detail=f"period 必須是 {_VALID_INTRADAY}")

    target_date: date
    if date_str:
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="date 格式需為 YYYY-MM-DD")
    else:
        target_date = date.today()

    try:
        rows = await fetch_intraday_kline(symbol, target_date)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FinMind error: {e}")

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No intraday data for {symbol} on {target_date} (非交易日或尚未開盤)",
        )

    minutes = int(period[:-1])   # "5m" → 5
    if minutes > 1:
        rows = _aggregate_intraday(rows, minutes)

    return {
        "symbol": symbol,
        "period": period,
        "date":   target_date.isoformat(),
        "count":  len(rows),
        "data":   rows,
    }


def _aggregate_intraday(rows: list[dict], minutes: int) -> list[dict]:
    """將 1m bars（unix timestamp）聚合為 N 分 K"""
    if not rows:
        return []
    interval = minutes * 60
    groups: dict[int, list[dict]] = {}
    for r in rows:
        bucket = (r["time"] // interval) * interval
        groups.setdefault(bucket, []).append(r)

    result = []
    for bucket in sorted(groups):
        items = groups[bucket]
        result.append({
            "time":   bucket,
            "open":   items[0]["open"],
            "high":   max(i["high"] for i in items),
            "low":    min(i["low"]  for i in items),
            "close":  items[-1]["close"],
            "volume": sum(i["volume"] for i in items),
        })
    return result


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
