from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query, Request
from app.services.finmind_service import fetch_margin
from app.core.validators import validate_symbol
from app.core.rate_limit import limiter

router = APIRouter()


@router.get("/margin/{symbol}")
@limiter.limit("30/minute")
async def get_margin(
    request: Request,
    symbol: str,
    days: int = Query(60, ge=5, le=240, description="Trading days"),
):
    sym   = validate_symbol(symbol)
    end   = date.today()
    start = end - timedelta(days=int(days * 1.8))

    try:
        raw = await fetch_margin(sym, start=start, end=end)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FinMind error: {e}")

    if not raw:
        raise HTTPException(status_code=404, detail=f"No margin data for {sym}")

    data = []
    for r in sorted(raw, key=lambda x: x["date"]):
        mb = int(r.get("MarginPurchaseTodayBalance", 0))
        mp = int(r.get("MarginPurchaseYesterdayBalance", 0))
        sb = int(r.get("ShortSaleTodayBalance", 0))
        sp = int(r.get("ShortSaleYesterdayBalance", 0))
        ratio = round(mb / sb, 2) if sb > 0 else None
        data.append({
            "date":           r["date"],
            "margin_balance": mb,
            "margin_change":  mb - mp,
            "short_balance":  sb,
            "short_change":   sb - sp,
            "ratio":          ratio,       # 資券比（融資/融券）
        })

    # 取最近 days 筆
    data = data[-days:]

    return {
        "symbol": sym,
        "days":   days,
        "data":   data,
        "latest": data[-1] if data else None,
    }
