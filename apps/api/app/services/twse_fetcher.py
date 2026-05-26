"""
TWSE 非官方即時報價 Endpoint
mis.twse.com.tw — 盤中每 5-10 秒更新，社群廣泛使用
"""
import httpx
import asyncio
from typing import Optional

TWSE_QUOTE_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://mis.twse.com.tw/",
}


async def fetch_quotes(symbols: list[str]) -> dict:
    """
    批次查詢多檔股票即時報價。
    symbols: ["2330", "2317", ...]
    回傳格式：{ "2330": { price, change, change_pct, volume, ... } }
    """
    ex_ch = "|".join(f"tse_{s}.tw" for s in symbols)
    async with httpx.AsyncClient(timeout=8) as client:
        resp = await client.get(TWSE_QUOTE_URL, params={"ex_ch": ex_ch}, headers=HEADERS)
        resp.raise_for_status()
        data = resp.json()

    result = {}
    for item in data.get("msgArray", []):
        symbol = item.get("c", "")
        if not symbol:
            continue
        try:
            price = float(item.get("z", item.get("y", 0)))   # z=現價, y=昨收（無成交時）
            prev  = float(item.get("y", price))
            change     = round(price - prev, 2)
            change_pct = round((change / prev) * 100, 2) if prev else 0.0
            result[symbol] = {
                "symbol":     symbol,
                "name":       item.get("n", ""),
                "price":      price,
                "open":       _safe_float(item.get("o")),
                "high":       _safe_float(item.get("h")),
                "low":        _safe_float(item.get("l")),
                "prev_close": prev,
                "change":     change,
                "change_pct": change_pct,
                "volume":     _safe_int(item.get("v")),
                "bid":        _safe_float(item.get("b", "").split("_")[0]),
                "ask":        _safe_float(item.get("a", "").split("_")[0]),
                "time":       item.get("t", ""),
            }
        except (ValueError, TypeError):
            continue
    return result


def _safe_float(val: Optional[str]) -> float:
    try:
        return float(val) if val and val != "-" else 0.0
    except (ValueError, TypeError):
        return 0.0


def _safe_int(val: Optional[str]) -> int:
    try:
        return int(val) if val and val != "-" else 0
    except (ValueError, TypeError):
        return 0
