"""
月營收 endpoint（MOPS 自結公告）

GET /api/v1/revenue/{symbol}
回傳近 N 個月的營收 + YoY/MoM%
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.rate_limit import limiter
from app.core.supabase_client import get_supabase
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/revenue/{symbol}")
@limiter.limit("20/minute")
async def get_revenue(
    request: Request,
    symbol: str,
    months: int = Query(24, ge=1, le=60),
):
    sym = validate_symbol(symbol)
    db = get_supabase()
    if db is None:
        raise HTTPException(status_code=503, detail="DB unavailable")

    try:
        resp = (
            db.table("monthly_revenue")
            .select("year, month, revenue, yoy_pct, mom_pct")
            .eq("symbol", sym)
            .order("year", desc=True)
            .order("month", desc=True)
            .limit(months)
            .execute()
        )
        rows = resp.data or []
    except Exception as e:
        logger.warning("[revenue] %s query failed: %s", sym, e)
        raise HTTPException(status_code=503, detail=f"Query failed: {e}")

    if not rows:
        return {"symbol": sym, "count": 0, "data": [], "status": "no_data"}

    # 由舊到新排序
    rows.sort(key=lambda r: (r["year"], r["month"]))
    return {
        "symbol": sym,
        "count":  len(rows),
        "data":   rows,
    }
