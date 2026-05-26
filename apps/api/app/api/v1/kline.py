from fastapi import APIRouter, HTTPException, Query
from datetime import date, timedelta
from app.services.finmind_service import fetch_daily_kline

router = APIRouter()


@router.get("/kline/{symbol}")
async def get_kline(
    symbol: str,
    start: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end: date | None = Query(None, description="End date (YYYY-MM-DD)"),
    period: str = Query("daily", description="daily / weekly / monthly"),
):
    try:
        rows = await fetch_daily_kline(symbol, start, end)
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
            "date": items[0]["date"],
            "open": items[0]["open"],
            "high": max(i["high"] for i in items),
            "low": min(i["low"] for i in items),
            "close": items[-1]["close"],
            "volume": sum(i["volume"] for i in items),
            "turnover": sum(i["turnover"] for i in items),
        })
    return result
