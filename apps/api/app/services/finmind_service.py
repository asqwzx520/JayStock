"""
FinMind API 客戶端 — 台股歷史 K 線 + 三大法人
https://finmindtrade.com/
"""
import httpx
from datetime import date, timedelta
from app.core.config import settings

FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"


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
