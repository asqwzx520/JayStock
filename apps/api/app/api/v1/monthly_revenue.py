"""
月營收 API

GET /api/v1/monthly-revenue/{symbol}

回傳近 24 個月月營收，含 YoY%、累計 YoY%。
台股從 MOPS 取得；美股回傳 is_tw=false 說明。
快取 TTL：86400 秒
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.core.rate_limit import limiter
from app.services.monthly_revenue_service import get_monthly_revenue

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/monthly-revenue/{symbol}")
@limiter.limit("20/minute")
async def monthly_revenue_endpoint(request: Request, symbol: str):
    """
    取得個股月營收（近 24 個月）

    台股：GET /api/v1/monthly-revenue/2330
    美股：GET /api/v1/monthly-revenue/AAPL  →  is_tw: false
    """
    sym = symbol.upper().strip()
    data = await get_monthly_revenue(sym)
    if data is None:
        raise HTTPException(status_code=404, detail=f"無法取得 {sym} 月營收資料")
    return data
