"""
個股基本面資料端點

GET /api/v1/fundamental/{symbol}

資料來源：yfinance Ticker.info
台股：自動附加 .TW 後綴（2330 → 2330.TW）
美股：直接使用 ticker（AAPL）

快取 TTL：3600 秒（1 小時）— 基本面資料每日變動少
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from app.core.rate_limit import limiter
from app.core.cache import ttl_cache
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()


def _is_tw_symbol(symbol: str) -> bool:
    """判斷是否為台股代碼（純數字 or 數字開頭）"""
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _fmt_market_cap(cap: Optional[float]) -> Optional[str]:
    """市值格式化：億元（台股）或 B/T（美股）"""
    if cap is None:
        return None
    if cap >= 1e12:
        return f"{cap / 1e12:.2f} 兆"
    if cap >= 1e8:
        return f"{cap / 1e8:.1f} 億"
    return f"{cap / 1e6:.0f} 百萬"


def _safe_float(val, digits: int = 2) -> Optional[float]:
    try:
        return round(float(val), digits) if val is not None else None
    except (TypeError, ValueError):
        return None


@ttl_cache(ttl=3600)
def _fetch_fundamental_sync(symbol: str) -> dict:
    """同步拉取 yfinance info（在 executor 中執行）"""
    try:
        import yfinance as yf

        yf_sym = f"{symbol}.TW" if _is_tw_symbol(symbol) else symbol
        ticker = yf.Ticker(yf_sym)
        info = ticker.info

        if not info or info.get("trailingPE") is None and info.get("currentPrice") is None:
            # 可能是無效代碼，嘗試不帶後綴
            if _is_tw_symbol(symbol):
                ticker = yf.Ticker(symbol)
                info = ticker.info

        currency = info.get("currency", "TWD" if _is_tw_symbol(symbol) else "USD")
        market_cap_raw = info.get("marketCap")

        # 殖利率：yfinance 回傳小數（0.035 = 3.5%），乘以 100
        div_yield = info.get("dividendYield")
        div_yield_pct = _safe_float(div_yield * 100, 2) if div_yield else None

        return {
            "symbol":          symbol,
            "name":            info.get("shortName") or info.get("longName"),
            "currency":        currency,
            "market_cap":      market_cap_raw,
            "market_cap_fmt":  _fmt_market_cap(market_cap_raw),
            "pe_trailing":     _safe_float(info.get("trailingPE")),
            "pe_forward":      _safe_float(info.get("forwardPE")),
            "eps_trailing":    _safe_float(info.get("trailingEps")),
            "eps_forward":     _safe_float(info.get("forwardEps")),
            "dividend_yield":  div_yield_pct,
            "dividend_rate":   _safe_float(info.get("dividendRate")),
            "week52_high":     _safe_float(info.get("fiftyTwoWeekHigh")),
            "week52_low":      _safe_float(info.get("fiftyTwoWeekLow")),
            "beta":            _safe_float(info.get("beta")),
            "avg_volume":      info.get("averageVolume"),
            "sector":          info.get("sector"),
            "industry":        info.get("industry"),
            "employees":       info.get("fullTimeEmployees"),
        }

    except Exception as exc:
        logger.warning("fundamental fetch failed for %s: %s", symbol, exc)
        return {}


@router.get("/fundamental/{symbol}")
@limiter.limit("30/minute")
async def get_fundamental(request: Request, symbol: str):
    """
    取得個股基本面資料
    台股範例：GET /api/v1/fundamental/2330
    美股範例：GET /api/v1/fundamental/AAPL
    """
    sym = validate_symbol(symbol)
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _fetch_fundamental_sync, sym)

    if not data:
        raise HTTPException(status_code=404, detail=f"Fundamental data not found for {sym}")

    return data
