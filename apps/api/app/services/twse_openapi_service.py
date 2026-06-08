"""
台灣證交所 OpenAPI 服務
https://openapi.twse.com.tw/v1

特性：免費、無需 API Key、無明確限速、官方資料
用途：取代 FinMind 的逐支 PE/PB 呼叫，改為一次 bulk fetch 全市場資料

主要函式：
  fetch_all_per_pbr()     — BWIBBU_ALL：全市場 PE/PB/殖利率（TTL 4h）
  fetch_all_daily_quotes()— STOCK_DAY_ALL：全市場當日收盤 OHLCV（TTL 5min）

注意：openapi.twse.com.tw 為盤後資料，不可取代 mis.twse.com.tw 的即時報價。
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

_BASE = "https://openapi.twse.com.tw/v1"
_TIMEOUT = 20


def _safe_float(val: Any) -> float | None:
    """將字串/數字轉 float，失敗或 NaN 回傳 None"""
    if val is None or val == "--" or val == "":
        return None
    try:
        v = float(str(val).replace(",", ""))
        return None if v != v else round(v, 2)   # NaN guard
    except (TypeError, ValueError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# 全市場 PE / PB / 殖利率
# ─────────────────────────────────────────────────────────────────────────────

@ttl_cache(ttl=3600 * 4)   # 盤後資料每日更新，4 小時足夠
async def fetch_all_per_pbr() -> dict[str, dict]:
    """
    GET /v1/openAPI/BWIBBU_ALL
    一次 call 取得全上市股票（~1,700 支）的 本益比 / 股價淨值比 / 殖利率

    回傳格式：
        {
          "2330": {"pe": 30.9, "pb": 6.8,  "yield": 1.5},
          "2317": {"pe": 12.1, "pb": 1.9,  "yield": 4.2},
          ...
        }
    若某欄位無資料（如 ETF 無 PE）則該欄為 None。
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_BASE}/openAPI/BWIBBU_ALL")
            resp.raise_for_status()
            rows = resp.json()

        result: dict[str, dict] = {}
        for r in rows:
            sym = str(r.get("Code", "") or r.get("股票代號", "")).strip()
            if not sym:
                continue
            result[sym] = {
                "pe":    _safe_float(r.get("PEratio")    or r.get("本益比")),
                "pb":    _safe_float(r.get("PBratio")    or r.get("股價淨值比")),
                "yield": _safe_float(r.get("DividendYield") or r.get("殖利率(%)")),
            }

        logger.info("[TWSE OpenAPI] BWIBBU_ALL loaded: %d symbols", len(result))
        return result

    except Exception as exc:
        logger.warning("[TWSE OpenAPI] BWIBBU_ALL failed: %s", exc)
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# 全市場當日收盤行情
# ─────────────────────────────────────────────────────────────────────────────

@ttl_cache(ttl=300)   # 5 分鐘，盤後資料不需太頻繁
async def fetch_all_daily_quotes() -> dict[str, dict]:
    """
    GET /v1/exchangeReport/STOCK_DAY_ALL
    一次 call 取得全上市股票當日收盤資料

    回傳格式：
        {
          "2330": {"open": 920.0, "high": 935.0, "low": 918.0,
                   "close": 930.0, "volume": 25431000, "change": 10.0},
          ...
        }

    注意：此為盤後資料（今日收盤後才有今日資料），
         盤中即時報價請繼續使用 mis.twse.com.tw。
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_BASE}/exchangeReport/STOCK_DAY_ALL")
            resp.raise_for_status()
            rows = resp.json()

        result: dict[str, dict] = {}
        for r in rows:
            sym = str(r.get("Code", "") or r.get("股票代號", "")).strip()
            if not sym:
                continue

            vol_raw = r.get("TradeVolume") or r.get("成交股數")
            try:
                vol = int(float(str(vol_raw).replace(",", ""))) if vol_raw else None
            except (ValueError, TypeError):
                vol = None

            result[sym] = {
                "open":   _safe_float(r.get("OpeningPrice")  or r.get("開盤價")),
                "high":   _safe_float(r.get("HighestPrice")  or r.get("最高價")),
                "low":    _safe_float(r.get("LowestPrice")   or r.get("最低價")),
                "close":  _safe_float(r.get("ClosingPrice")  or r.get("收盤價")),
                "volume": vol,
                "change": _safe_float(r.get("Change")        or r.get("漲跌價差")),
            }

        logger.info("[TWSE OpenAPI] STOCK_DAY_ALL loaded: %d symbols", len(result))
        return result

    except Exception as exc:
        logger.warning("[TWSE OpenAPI] STOCK_DAY_ALL failed: %s", exc)
        return {}
