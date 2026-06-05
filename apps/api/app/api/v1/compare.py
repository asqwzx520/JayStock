"""
多股比較走勢 API

GET /api/v1/compare?symbols=2330,2317,AAPL&period=1y

回傳各股票以「起始日收盤價 = 100」正規化的報酬走勢，
供前端多股疊加折線圖使用。

快取 TTL：5 分鐘
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from app.core.rate_limit import limiter
from app.core.cache import ttl_cache
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()


def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    if s.isdigit():
        return f"{s}.TW"
    return s


@ttl_cache(ttl=300)   # 5 minutes
def _fetch_compare_sync(symbols_key: str, period: str) -> dict[str, Any]:
    import yfinance as yf
    import pandas as pd

    symbols  = [s.strip() for s in symbols_key.split(",") if s.strip()]
    yf_syms  = [_yf_symbol(s) for s in symbols]

    period_map = {
        "1m": "1mo", "3m": "3mo", "6m": "6mo",
        "1y": "1y",  "3y": "3y",  "5y": "5y",
    }
    yf_period = period_map.get(period, "1y")

    loaded: list[str] = []
    series: dict[str, list[dict]] = {}
    names:  dict[str, str] = {}

    for orig, yf_sym in zip(symbols, yf_syms):
        try:
            df = yf.download(
                yf_sym, period=yf_period,
                auto_adjust=True, progress=False, threads=False,
            )
            if df.empty:
                logger.warning("compare: no data for %s", yf_sym)
                continue

            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df.columns = [c.lower() for c in df.columns]

            close = df["close"].dropna()
            if len(close) < 2:
                continue

            base = float(close.iloc[0])
            if base == 0:
                continue

            normalized = (close / base * 100).round(3)

            loaded.append(orig)
            series[orig] = [
                {"time": str(idx.date()), "value": float(v)}
                for idx, v in zip(close.index, normalized)
            ]

            # 嘗試取名稱
            try:
                info = yf.Ticker(yf_sym).fast_info
                names[orig] = getattr(info, "symbol", orig)
            except Exception:
                names[orig] = orig

        except Exception as exc:
            logger.warning("compare: error fetching %s: %s", yf_sym, exc)
            continue

    return {
        "symbols": loaded,
        "names":   names,
        "period":  period,
        "series":  series,
    }


@router.get("/compare")
@limiter.limit("20/minute")
async def get_compare(
    request: Request,
    symbols: str = Query(..., description="逗號分隔，最多 4 支，例：2330,2317,AAPL"),
    period:  str = Query("1y", description="1m / 3m / 6m / 1y / 3y / 5y"),
):
    """
    多股比較走勢（正規化報酬，起始日 = 100）
    GET /api/v1/compare?symbols=2330,2317&period=1y
    """
    parts = [s.strip() for s in symbols.split(",") if s.strip()]
    if not parts:
        raise HTTPException(status_code=400, detail="symbols 不可為空")

    parts = parts[:4]   # 最多 4 支

    validated: list[str] = []
    for p in parts:
        try:
            validated.append(validate_symbol(p))
        except Exception:
            pass

    if not validated:
        raise HTTPException(status_code=400, detail="沒有有效的股票代號")

    if period not in ("1m", "3m", "6m", "1y", "3y", "5y"):
        period = "1y"

    symbols_key = ",".join(validated)
    loop        = asyncio.get_event_loop()
    data        = await loop.run_in_executor(None, _fetch_compare_sync, symbols_key, period)

    if not data["symbols"]:
        raise HTTPException(status_code=404, detail="無法取得任何股票資料")

    return data
