"""
外資持股比例趨勢 API

GET /api/v1/foreign-holding/{symbol}

回傳近 12 個月外資持股比例時序 + 月收盤價（供雙軸圖）。
資料來源：TWSE MI_QIANW（免費公開）
快取 TTL：43200 秒（12 小時）
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.core.rate_limit import limiter
from app.core.validators import validate_symbol
from app.services.foreign_holding_service import get_foreign_holding

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/foreign-holding/{symbol}")
@limiter.limit("15/minute")
async def foreign_holding_endpoint(request: Request, symbol: str):
    """
    外資持股比例走勢

    台股：GET /api/v1/foreign-holding/2330
    美股：GET /api/v1/foreign-holding/AAPL  →  is_tw: false
    """
    sym = validate_symbol(symbol)
    data = await get_foreign_holding(sym)
    if data is None:
        raise HTTPException(status_code=404, detail=f"無法取得 {sym} 外資持股資料")
    return data
