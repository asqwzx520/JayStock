"""
外資持股比例趨勢服務

資料來源：
  台股 → TWSE 公開 API MI_QIANW（免費，無需 token）
          每月快照：外資及陸資持股比例(%)
  美股 → 不適用（回傳 is_tw: false）

並行抓取最近 13 個月資料 → 建立 12+ 月時序
同時抓取月底收盤價（yfinance）供雙軸疊圖使用

TTL 快取：43200 秒（12 小時，月資料每月更新，但避免過期太久）
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from typing import Any

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

_TWSE_URL = "https://www.twse.com.tw/fund/MI_QIANW"
_HEADERS  = {
    "User-Agent": "Mozilla/5.0 (compatible; StockPulse/1.0)",
    "Referer":    "https://www.twse.com.tw/",
    "Accept":     "application/json",
}


def _is_tw(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    return f"{s}.TW" if _is_tw(s) else s


# ── TWSE MI_QIANW helpers ─────────────────────────────────────────────────────

def _fetch_twse_day(year: int, month: int, day: int = 15) -> dict | None:
    """
    Fetch TWSE MI_QIANW for a specific date.
    Returns raw JSON dict or None on failure.
    """
    import httpx
    date_str = f"{year}{month:02d}{day:02d}"
    try:
        resp = httpx.get(
            _TWSE_URL,
            params={"response": "json", "date": date_str},
            headers=_HEADERS,
            timeout=15,
            follow_redirects=True,
        )
        if resp.status_code != 200:
            return None
        payload = resp.json()
        if payload.get("stat") == "OK" and payload.get("data"):
            return payload
    except Exception as exc:
        logger.debug("[foreign] TWSE fetch %s: %s", date_str, exc)
    return None


def _fetch_twse_month(year: int, month: int) -> dict | None:
    """Try several days within a month to find valid TWSE data."""
    for day in (15, 20, 10, 25, 28):
        result = _fetch_twse_day(year, month, day)
        if result:
            return result
        time.sleep(0.05)   # polite delay
    return None


def _parse_holding_pct(payload: dict, symbol: str) -> float | None:
    """
    Extract foreign holding % for `symbol` from a MI_QIANW response.
    Returns float (e.g. 75.23) or None.
    """
    fields = payload.get("fields", [])
    data   = payload.get("data",   [])
    if not fields or not data:
        return None

    # Find column indices
    code_col = next(
        (i for i, f in enumerate(fields) if "代號" in f or "代碼" in f), 0
    )
    pct_col  = next(
        (i for i, f in enumerate(fields)
         if "比例" in f and "限額" not in f), -1
    )
    # Fallback: last numeric column
    if pct_col < 0:
        pct_col = len(fields) - 1

    target = symbol.upper().strip()
    for row in data:
        if len(row) <= max(code_col, pct_col):
            continue
        code = str(row[code_col]).strip()
        if code != target:
            continue
        try:
            val = float(str(row[pct_col]).replace(",", "").replace("%", "").strip())
            if 0 <= val <= 100:
                return round(val, 2)
        except (ValueError, TypeError):
            pass
    return None


# ── Monthly price (yfinance) ──────────────────────────────────────────────────

def _fetch_monthly_prices(yf_sym: str, months: int = 14) -> dict[str, float]:
    """
    Return {YYYY-MM: close_price} for the last `months` months.
    Uses yfinance monthly OHLCV.
    """
    try:
        import yfinance as yf
        import pandas as pd

        hist = yf.Ticker(yf_sym).history(period=f"{months}mo", interval="1mo")
        if hist.empty:
            return {}

        result: dict[str, float] = {}
        for idx, row in hist.iterrows():
            # idx is a Timestamp
            key = f"{idx.year}-{idx.month:02d}"
            result[key] = round(float(row["Close"]), 2)
        return result
    except Exception as exc:
        logger.debug("[foreign] price fetch %s: %s", yf_sym, exc)
        return {}


# ── Main fetch ────────────────────────────────────────────────────────────────

def _months_back(n: int) -> list[tuple[int, int]]:
    """Return list of (year, month) for the last n months (newest first)."""
    today = date.today()
    result = []
    y, m = today.year, today.month
    for _ in range(n):
        result.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return result


@ttl_cache(ttl=43_200)
def _fetch_sync(symbol: str) -> dict[str, Any]:
    if not _is_tw(symbol):
        return {
            "symbol":  symbol,
            "is_tw":   False,
            "data":    [],
            "message": "外資持股比例為台灣上市公司指標，美股不適用。",
        }

    yf_sym  = _yf_symbol(symbol)
    targets = _months_back(13)   # 13 months to ensure we get 12

    # Parallel-fetch TWSE monthly data
    raw: dict[tuple[int, int], float | None] = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {
            ex.submit(_fetch_twse_month, yr, mo): (yr, mo)
            for yr, mo in targets
        }
        for fut in as_completed(futures):
            ym = futures[fut]
            try:
                payload = fut.result()
                if payload:
                    pct = _parse_holding_pct(payload, symbol)
                    raw[ym] = pct
            except Exception as exc:
                logger.debug("[foreign] month %s: %s", ym, exc)

    # Fetch monthly prices for overlay
    prices = _fetch_monthly_prices(yf_sym)

    # Assemble sorted time series (ascending)
    series = []
    for yr, mo in reversed(targets):
        pct = raw.get((yr, mo))
        if pct is None:
            continue
        key   = f"{yr}-{mo:02d}"
        price = prices.get(key)
        series.append({
            "year":        yr,
            "month":       mo,
            "date":        key,
            "holding_pct": pct,
            "price":       price,
        })

    if not series:
        return {
            "symbol": symbol,
            "is_tw":  True,
            "data":   [],
            "message": "TWSE 暫無資料",
        }

    latest      = series[-1]["holding_pct"]
    oldest      = series[0]["holding_pct"]
    change_1y   = round(latest - oldest, 2) if (latest is not None and oldest is not None) else None

    # Max / min over period
    pcts = [d["holding_pct"] for d in series]
    return {
        "symbol":      symbol,
        "is_tw":       True,
        "data":        series[-13:],      # at most 13 months
        "latest_pct":  latest,
        "change_1y":   change_1y,          # percentage-point change
        "max_pct":     round(max(pcts), 2),
        "min_pct":     round(min(pcts), 2),
        "message":     None,
    }


async def get_foreign_holding(symbol: str) -> dict[str, Any]:
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_sync, symbol.upper().strip())
