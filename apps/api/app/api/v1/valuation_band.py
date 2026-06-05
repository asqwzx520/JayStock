"""
PE / PB 歷史估值帶 API

GET /api/v1/valuation-band/{symbol}

回傳近 5 年週線 PE / PB 歷史 + mean ± 1σ / ±2σ + 當前分位數。
快取 TTL：86400 秒
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.core.rate_limit import limiter
from app.core.validators import validate_symbol
from app.services.valuation_band_service import get_valuation_band

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/valuation-band/{symbol}")
@limiter.limit("20/minute")
async def valuation_band_endpoint(request: Request, symbol: str):
    """
    取得個股 PE / PB 歷史估值帶

    台股：GET /api/v1/valuation-band/2330
    美股：GET /api/v1/valuation-band/AAPL
    """
    sym = validate_symbol(symbol)
    data = await get_valuation_band(sym)
    if data is None:
        raise HTTPException(status_code=404, detail=f"無法取得 {sym} 估值帶資料")
    return data
