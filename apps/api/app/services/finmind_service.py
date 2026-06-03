"""
FinMind API 客戶端 — 台股歷史 K 線 + 三大法人
https://finmindtrade.com/

TTL 快取說明：
  fetch_daily_kline       — 5 分鐘（日K盤後靜態）
  fetch_intraday_kline    — 30 秒（盤中 1m K，頻繁更新）
  fetch_institutional     — 5 分鐘（法人盤後）
  fetch_market_chips_all  — 5 分鐘
  fetch_margin            — 5 分鐘
"""
import httpx
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from app.core.config import settings
from app.core.cache import ttl_cache

_TZ_TAIPEI = ZoneInfo("Asia/Taipei")

FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"


@ttl_cache(ttl=300)
async def fetch_daily_kline(
    symbol: str,
    start: date | None = None,
    end: date | None = None,
) -> list[dict]:
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=365)

    params = {
        "dataset": "TaiwanStockPrice",
        "data_id": symbol,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "token": settings.finmind_token,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(FINMIND_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    rows = data.get("data", [])
    return [
        {
            "date": r["date"],
            "open": float(r["open"]),
            "high": float(r["max"]),
            "low": float(r["min"]),
            "close": float(r["close"]),
            "volume": int(r["Trading_Volume"]),
            "turnover": int(r.get("Trading_money", 0)),
        }
        for r in rows
    ]


@ttl_cache(ttl=30)
async def fetch_intraday_kline(
    symbol: str,
    target_date: date | None = None,
) -> list[dict]:
    """
    1 分鐘 K 線 — TaiwanStockPriceMinute
    回傳每根 bar 的 time 為 Unix timestamp（秒，台北時區轉換）。
    """
    if target_date is None:
        target_date = date.today()

    params = {
        "dataset":    "TaiwanStockPriceMinute",
        "data_id":    symbol,
        "start_date": target_date.isoformat(),
        "end_date":   target_date.isoformat(),
        "token":      settings.finmind_token,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(FINMIND_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    rows = data.get("data", [])
    result = []
    for r in rows:
        # FinMind 格式：date = "2024-01-02 09:01:00"
        raw_dt = r.get("date", "")
        try:
            dt = datetime.strptime(raw_dt, "%Y-%m-%d %H:%M:%S")
            dt = dt.replace(tzinfo=_TZ_TAIPEI)
            ts = int(dt.timestamp())
        except ValueError:
            continue
        result.append({
            "time":   ts,
            "open":   float(r["open"]),
            "high":   float(r["max"]),
            "low":    float(r["min"]),
            "close":  float(r["close"]),
            "volume": int(r.get("volume", 0)),
        })
    return result


@ttl_cache(ttl=300)
async def fetch_institutional(
    symbol: str,
    start: date | None = None,
    end: date | None = None,
) -> list[dict]:
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=90)

    params = {
        "dataset": "TaiwanStockInstitutionalInvestorsBuySell",
        "data_id": symbol,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "token": settings.finmind_token,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(FINMIND_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    return data.get("data", [])


@ttl_cache(ttl=300)
async def fetch_market_chips_all(target_date: date) -> list[dict]:
    """當日全市場三大法人買賣超 — 不指定 data_id 取全部"""
    params = {
        "dataset":    "TaiwanStockInstitutionalInvestorsBuySell",
        "start_date": target_date.isoformat(),
        "end_date":   target_date.isoformat(),
        "token":      settings.finmind_token,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(FINMIND_URL, params=params)
        resp.raise_for_status()
        data = resp.json()
    return data.get("data", [])


@ttl_cache(ttl=300)
async def fetch_margin(
    symbol: str,
    start: date | None = None,
    end: date | None = None,
) -> list[dict]:
    """融資融券餘額 — TaiwanStockMarginPurchaseShortSale"""
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=120)

    params = {
        "dataset": "TaiwanStockMarginPurchaseShortSale",
        "data_id": symbol,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "token": settings.finmind_token,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(FINMIND_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    return data.get("data", [])
