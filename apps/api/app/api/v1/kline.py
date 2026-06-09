from fastapi import APIRouter, HTTPException, Query, Request
from datetime import date, datetime, timedelta, timezone
import asyncio
import logging
import time

import httpx

from app.services.finmind_service import (
    fetch_daily_kline as finmind_fetch_kline,
    fetch_intraday_kline,
)
from app.core.supabase_client import get_supabase, get_supabase_admin
from app.core.validators import validate_symbol
from app.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter()

_TZ_TAIPEI = timezone(timedelta(hours=8))
_YF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


def _is_tw_symbol(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


async def _fetch_kline_yf_direct(symbol: str, start: date, end: date) -> list[dict]:
    """
    直連 Yahoo Finance v8/chart API 取得台股日K（不走 yfinance 庫）。
    先試 .TW，失敗再試 .TWO（TPEX 股票）。
    """
    days = (end - start).days
    if days <= 30:    range_str = "1mo"
    elif days <= 90:  range_str = "3mo"
    elif days <= 180: range_str = "6mo"
    elif days <= 365: range_str = "1y"
    else:             range_str = "2y"

    for suffix in (".TW", ".TWO"):
        yf_sym = f"{symbol}{suffix}"
        url    = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}"
        params = {"interval": "1d", "range": range_str, "events": ""}
        try:
            async with httpx.AsyncClient(
                headers=_YF_HEADERS, timeout=14, follow_redirects=True
            ) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
            results = data.get("chart", {}).get("result") or []
            if not results:
                continue
            r          = results[0]
            timestamps = r.get("timestamp") or []
            quote      = (r.get("indicators", {}).get("quote") or [{}])[0]
            opens   = quote.get("open",   [])
            highs   = quote.get("high",   [])
            lows    = quote.get("low",    [])
            closes  = quote.get("close",  [])
            volumes = quote.get("volume", [])

            rows: list[dict] = []
            for i, ts in enumerate(timestamps):
                c = closes[i] if i < len(closes) else None
                if c is None:
                    continue
                d = datetime.fromtimestamp(ts, tz=_TZ_TAIPEI).date()
                if d < start or d > end:
                    continue
                rows.append({
                    "date":     d.isoformat(),
                    "open":     float(opens[i])   if i < len(opens)   and opens[i]   else float(c),
                    "high":     float(highs[i])   if i < len(highs)   and highs[i]   else float(c),
                    "low":      float(lows[i])    if i < len(lows)    and lows[i]    else float(c),
                    "close":    float(c),
                    "volume":   int(volumes[i])   if i < len(volumes) and volumes[i] else 0,
                    "turnover": 0,
                })
            if rows:
                logger.debug("[kline] YF direct OK: %s (%d bars)", yf_sym, len(rows))
                return rows
        except Exception as exc:
            logger.debug("[kline] YF direct %s failed: %s", yf_sym, exc)

    return []


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


async def _upsert_kline_cache(symbol: str, rows: list[dict]) -> None:
    """
    Fire-and-forget：將 FinMind 回傳的 K 線資料寫入 Supabase kline_daily。
    只寫 5 年以內的資料，避免快取表無限膨脹。
    使用 service_role client 繞過 RLS 寫入限制。
    """
    admin = get_supabase_admin()
    if admin is None:
        return

    cutoff = (date.today() - timedelta(days=365 * 5)).isoformat()
    to_write = [
        {
            "symbol":   symbol,
            "date":     r["date"],
            "open":     r["open"],
            "high":     r["high"],
            "low":      r["low"],
            "close":    r["close"],
            "volume":   r["volume"],
            "turnover": r.get("turnover", 0),
        }
        for r in rows
        if r.get("date", "") >= cutoff
    ]
    if not to_write:
        return

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: admin.table("kline_daily")
                         .upsert(to_write, on_conflict="symbol,date")
                         .execute(),
        )
        logger.debug("[kline] upserted %d rows to Supabase for %s", len(to_write), symbol)
    except Exception as exc:
        logger.warning("[kline] Supabase upsert 失敗（非致命）: %s", exc)


@router.get("/kline/{symbol}")
@limiter.limit("30/minute")
async def get_kline(
    request: Request,
    symbol: str,
    start: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end: date | None = Query(None, description="End date (YYYY-MM-DD)"),
    period: str = Query("daily", description="daily / weekly / monthly / quarterly / yearly"),
):
    sym = validate_symbol(symbol)
    if end is None:
        end = date.today()
    if start is None:
        # 各 period 預設拉取範圍
        if period in ("quarterly", "yearly"):
            start = end - timedelta(days=365 * 15)   # 季/年K：15 年
        elif period == "monthly":
            start = end - timedelta(days=365 * 10)   # 月K：10 年
        elif period == "weekly":
            start = end - timedelta(days=365 * 5)    # 週K：5 年
        else:
            start = end - timedelta(days=365 * 2)    # 日K：2 年

    # 1. 嘗試從 Supabase 快取讀取
    rows = await _kline_from_supabase(sym, start, end)

    # 2. Cache miss → 先試 Yahoo Finance 直連，再試 FinMind
    if rows is None:
        logger.debug("[kline] %s cache miss", sym)

        # 2a. YF direct httpx（台股優先，不耗 FinMind quota）
        if _is_tw_symbol(sym):
            rows = await _fetch_kline_yf_direct(sym, start, end) or None

        # 2b. FinMind fallback（美股 / YF 失敗時）
        if not rows:
            try:
                rows = await finmind_fetch_kline(sym, start, end)
            except Exception as e:
                if rows is None:
                    raise HTTPException(status_code=502, detail=f"K線資料暫時無法取得: {e}")

        # 寫穿快取（fire-and-forget，不阻塞 response）
        if rows:
            asyncio.create_task(_upsert_kline_cache(sym, rows))

    if not rows:
        raise HTTPException(status_code=404, detail=f"No kline data for {sym}")

    if period == "weekly":
        rows = _aggregate(rows, "W")
    elif period == "monthly":
        rows = _aggregate(rows, "M")
    elif period == "quarterly":
        rows = _aggregate(rows, "QE")   # pandas Quarter-End
    elif period == "yearly":
        rows = _aggregate(rows, "YE")   # pandas Year-End

    return {"symbol": sym, "period": period, "count": len(rows), "data": rows}


_VALID_INTRADAY = {"1m", "5m", "15m", "30m", "60m"}


@router.get("/kline/{symbol}/intraday")
@limiter.limit("30/minute")
async def get_intraday_kline(
    request: Request,
    symbol: str,
    period: str = Query("5m", description="1m / 5m / 15m / 30m / 60m"),
    date_str: str | None = Query(None, alias="date", description="YYYY-MM-DD (預設今日)"),
):
    """盤中分 K：從 FinMind TaiwanStockPriceMinute 拉 1m 資料後聚合"""
    sym = validate_symbol(symbol)
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
        rows = await fetch_intraday_kline(sym, target_date)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FinMind error: {e}")

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No intraday data for {sym} on {target_date} (非交易日或尚未開盤)",
        )

    minutes = int(period[:-1])   # "5m" → 5
    if minutes > 1:
        rows = _aggregate_intraday(rows, minutes)

    return {
        "symbol": sym,
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
        if freq == "QE":
            # Q1=1-3, Q2=4-6, Q3=7-9, Q4=10-12
            q = (dt.month - 1) // 3 + 1
            return f"{dt.year}-Q{q}"
        if freq == "YE":
            return str(dt.year)
        return d[:7]  # monthly

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


# ── 美股 K 線（yfinance）─────────────────────────────────────────────────────

_US_KLINE_CACHE: dict[str, dict] = {}
_US_KLINE_TTL = 3600  # 1 小時


def _yf_fetch_kline_sync(symbol: str, period_str: str) -> list[dict]:
    """同步呼叫 yfinance（在 executor 中執行）"""
    try:
        import yfinance as yf
        # period → yfinance interval / period 對應
        _PERIOD_MAP = {
            "daily":     ("1d", "2y"),
            "weekly":    ("1wk", "10y"),
            "monthly":   ("1mo", "20y"),
            "quarterly": ("3mo", "max"),
            "yearly":    ("3mo", "max"),   # 年K 自行聚合
        }
        iv, yf_period = _PERIOD_MAP.get(period_str, ("1d", "2y"))

        ticker = yf.Ticker(symbol)
        df = ticker.history(period=yf_period, interval=iv, auto_adjust=True)
        if df is None or df.empty:
            return []

        rows = []
        for ts, row in df.iterrows():
            rows.append({
                "date":     ts.strftime("%Y-%m-%d"),
                "open":     round(float(row["Open"]),  4),
                "high":     round(float(row["High"]),  4),
                "low":      round(float(row["Low"]),   4),
                "close":    round(float(row["Close"]), 4),
                "volume":   int(row["Volume"]),
                "turnover": 0,
            })
        return rows
    except Exception as exc:
        logger.warning("[kline/us] yfinance 失敗 %s: %s", symbol, exc)
        return []


@router.get("/kline/us/{symbol}")
@limiter.limit("20/minute")
async def get_us_kline(
    request: Request,
    symbol: str,
    period: str = Query("daily", description="daily / weekly / monthly / quarterly / yearly"),
):
    """
    美股日/週/月/季/年 K 線（yfinance，TTL 1h 後端快取）
    範例：GET /api/v1/kline/us/AAPL?period=daily
    """
    sym = validate_symbol(symbol)
    cache_key = f"{sym}:{period}"
    now = time.time()

    # TTL 快取
    cached = _US_KLINE_CACHE.get(cache_key)
    if cached and now - cached["ts"] < _US_KLINE_TTL:
        rows = cached["rows"]
        return {"symbol": sym, "period": period, "count": len(rows), "data": rows}

    # 在 thread executor 中呼叫 yfinance（避免 blocking event loop）
    loop = asyncio.get_running_loop()
    rows = await loop.run_in_executor(None, _yf_fetch_kline_sync, sym, period)

    # yfinance 在 Render IP 被擋時 fallback YF v8/chart 直連
    if not rows:
        try:
            from app.services.yf_direct import fetch_kline as yf_direct_fetch
            yf_period_days = {"daily": 730, "weekly": 3650, "monthly": 7300}.get(period, 730)
            end_d   = date.today()
            start_d = end_d - timedelta(days=yf_period_days)
            rows = await yf_direct_fetch(sym, start_d, end_d)
        except Exception as exc:
            logger.warning("[kline/us] yf_direct fallback failed %s: %s", sym, exc)

    if not rows:
        raise HTTPException(status_code=404, detail=f"No US kline data for {sym}")

    # 年K 需要再聚合（yfinance 3mo → 年）
    if period == "yearly":
        rows = _aggregate(rows, "YE")

    _US_KLINE_CACHE[cache_key] = {"rows": rows, "ts": now}
    return {"symbol": sym, "period": period, "count": len(rows), "data": rows}
