"""
台股股票清單 — 從 TWSE 開放資料取得上市公司清單
用於前端搜尋功能
"""
import httpx
import asyncio
from typing import Optional

TWSE_STOCK_LIST_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"

_cache: list[dict] = []
_cache_lock = asyncio.Lock()


async def get_stock_list() -> list[dict]:
    global _cache
    if _cache:
        return _cache

    async with _cache_lock:
        if _cache:
            return _cache
        _cache = await _fetch_stock_list()
        return _cache


async def _fetch_stock_list() -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(TWSE_STOCK_LIST_URL)
        resp.raise_for_status()
        data = resp.json()

    seen = set()
    result = []
    for item in data:
        code = item.get("Code", "")
        if not code or code in seen:
            continue
        seen.add(code)
        result.append({
            "symbol": code,
            "name": item.get("Name", ""),
        })
    return result


async def search_stocks(query: str, limit: int = 20) -> list[dict]:
    stocks = await get_stock_list()
    q = query.strip().upper()
    if not q:
        return []

    exact = []
    prefix = []
    contains = []

    for s in stocks:
        sym = s["symbol"].upper()
        name = s["name"]
        if sym == q or name == q:
            exact.append(s)
        elif sym.startswith(q) or name.startswith(q):
            prefix.append(s)
        elif q in sym or q in name:
            contains.append(s)

    return (exact + prefix + contains)[:limit]
