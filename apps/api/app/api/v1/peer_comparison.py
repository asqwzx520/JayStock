"""
同業比較表 API

GET /api/v1/peer-comparison/{symbol}
GET /api/v1/peer-comparison/{symbol}?peers=2454,2303,6770

自動偵測同業（台股靜態對照 → yf.Industry → yf.Sector）
或接受自訂 peers 參數（最多 6 支）
快取 TTL：86400 秒
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.rate_limit import limiter
from app.core.validators import validate_symbol, validate_symbols
from app.services.peer_comparison_service import get_peer_comparison

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/peer-comparison/{symbol}")
@limiter.limit("15/minute")
async def peer_comparison_endpoint(
    request: Request,
    symbol: str,
    peers: str = Query(default="", description="自訂對比標的，逗號分隔，最多 6 支"),
):
    """
    同業比較表

    台股：GET /api/v1/peer-comparison/2330
    美股：GET /api/v1/peer-comparison/AAPL
    自訂：GET /api/v1/peer-comparison/2330?peers=2454,2303,6770
    """
    sym = validate_symbol(symbol)
    # Validate each custom peer symbol individually (max 6)
    peer_list = [p.strip() for p in peers.split(",") if p.strip()][:6]
    validated_peers = validate_symbols(peer_list) if peer_list else []
    clean_peers = ",".join(validated_peers)

    data = await get_peer_comparison(sym, clean_peers)
    if not data:
        raise HTTPException(status_code=404, detail=f"無法取得 {sym} 同業資料")
    return data
