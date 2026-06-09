"""
Finnhub.io 美股資料來源（備援用）

免費方案：60 req/min，不限日總量。
主要用於美股新聞、報價、財報補強。

Key 預設空白；未設定時所有函數靜默回傳空，不影響其他流程。
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import httpx

from app.core.cache import ttl_cache
from app.core.config import settings

logger = logging.getLogger(__name__)

FINNHUB_BASE = "https://finnhub.io/api/v1"


def _has_key() -> bool:
    return bool(settings.finnhub_api_key)


@ttl_cache(ttl=300)
async def fetch_company_news(symbol: str, days: int = 7) -> list[dict]:
    """
    美股公司新聞。台股不支援。
    回傳 [{title, publisher, link, published_at, thumbnail}]
    """
    if not _has_key():
        return []
    # Finnhub 不支援台股 4 位數代號
    if symbol.isdigit() and len(symbol) == 4:
        return []

    today = date.today()
    start = today - timedelta(days=days)
    params = {
        "symbol": symbol,
        "from":   start.isoformat(),
        "to":     today.isoformat(),
        "token":  settings.finnhub_api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{FINNHUB_BASE}/company-news", params=params)
            if resp.status_code != 200:
                return []
            data = resp.json()
    except Exception as e:
        logger.debug("[finnhub.news] %s failed: %s", symbol, e)
        return []

    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for r in data:
        if not isinstance(r, dict):
            continue
        title = r.get("headline") or ""
        link  = r.get("url") or ""
        if not title or not link:
            continue
        out.append({
            "title":        title,
            "publisher":    r.get("source") or "Finnhub",
            "link":         link,
            "published_at": r.get("datetime") or 0,
            "thumbnail":    r.get("image") or None,
            "source":       "finnhub",
        })
    return out


@ttl_cache(ttl=30)
async def fetch_quote(symbol: str) -> dict | None:
    """
    美股即時報價。
    回傳 {price, prev, change, change_pct}
    """
    if not _has_key():
        return None
    if symbol.isdigit() and len(symbol) == 4:
        return None

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{FINNHUB_BASE}/quote",
                params={"symbol": symbol, "token": settings.finnhub_api_key},
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
    except Exception as e:
        logger.debug("[finnhub.quote] %s failed: %s", symbol, e)
        return None

    if not isinstance(data, dict):
        return None
    price = data.get("c")
    prev  = data.get("pc")
    if price is None or prev is None:
        return None
    try:
        price = float(price); prev = float(prev)
    except (ValueError, TypeError):
        return None
    return {
        "price":      price,
        "prev":       prev,
        "change":     round(price - prev, 2),
        "change_pct": round((price - prev) / prev * 100, 2) if prev else None,
    }
