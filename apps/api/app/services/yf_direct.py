"""
Yahoo Finance v8/chart API 直連（純 httpx，繞過 yfinance Python library 在雲端 IP 被擋的問題）

統一處理：
- 日 K 線（含台股 .TW / .TWO 自動 fallback）
- 即時報價
- 指數（^GSPC, ^IXIC, ^DJI, ^TWII 等）
- 股利歷史
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import httpx

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
}

YF_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
YF_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"


def _is_tw_symbol(s: str) -> bool:
    return s[:4].isdigit() if len(s) >= 4 else s.isdigit()


def _tw_candidates(symbol: str) -> list[str]:
    """台股嘗試 .TW（上市）然後 .TWO（上櫃）"""
    if _is_tw_symbol(symbol):
        return [f"{symbol}.TW", f"{symbol}.TWO"]
    return [symbol]


def _parse_chart_response(data: dict) -> list[dict] | None:
    """解析 YF v8/chart 回應 → OHLCV list"""
    chart = data.get("chart") or {}
    result = chart.get("result")
    if not result:
        return None
    res = result[0]
    timestamps = res.get("timestamp") or []
    indicators = res.get("indicators") or {}
    quotes = (indicators.get("quote") or [{}])[0]
    opens   = quotes.get("open")   or []
    highs   = quotes.get("high")   or []
    lows    = quotes.get("low")    or []
    closes  = quotes.get("close")  or []
    volumes = quotes.get("volume") or []
    if not timestamps:
        return None

    rows: list[dict] = []
    for i, ts in enumerate(timestamps):
        try:
            o = opens[i]; h = highs[i]; l = lows[i]; c = closes[i]; v = volumes[i]
        except IndexError:
            continue
        if c is None:
            continue
        d_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        rows.append({
            "date":   d_str,
            "open":   float(o) if o is not None else float(c),
            "high":   float(h) if h is not None else float(c),
            "low":    float(l) if l is not None else float(c),
            "close":  float(c),
            "volume": int(v) if v is not None else 0,
        })
    return rows


async def _fetch_chart_one(yf_symbol: str, params: dict, client: httpx.AsyncClient) -> list[dict] | None:
    try:
        resp = await client.get(YF_CHART_URL.format(symbol=yf_symbol), params=params)
        if resp.status_code != 200:
            return None
        return _parse_chart_response(resp.json())
    except Exception as e:
        logger.debug("[yf_direct] %s failed: %s", yf_symbol, e)
        return None


@ttl_cache(ttl=300)
async def fetch_kline(
    symbol: str,
    start: date | None = None,
    end: date | None = None,
    interval: str = "1d",
) -> list[dict]:
    """
    日 K 線。台股自動 .TW / .TWO fallback。
    """
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=120)

    params = {
        "period1": int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp()),
        "period2": int(datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=timezone.utc).timestamp()),
        "interval": interval,
        "includePrePost": "false",
        "events": "div,split",
    }
    async with httpx.AsyncClient(
        headers=_BROWSER_HEADERS,
        follow_redirects=True,
        timeout=15,
    ) as client:
        for cand in _tw_candidates(symbol):
            rows = await _fetch_chart_one(cand, params, client)
            if rows:
                return rows
    return []


@ttl_cache(ttl=30)
async def fetch_index_quote(ticker: str) -> dict | None:
    """
    指數即時報價：^GSPC / ^IXIC / ^DJI / ^TWII / ^TNX 等。
    回傳 {price, prev, change, change_pct}
    """
    params = {"interval": "1d", "range": "5d"}
    try:
        async with httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            follow_redirects=True,
            timeout=12,
        ) as client:
            resp = await client.get(YF_CHART_URL.format(symbol=ticker), params=params)
            if resp.status_code != 200:
                return None
            data = resp.json()
    except Exception as e:
        logger.debug("[yf_direct.index] %s failed: %s", ticker, e)
        return None

    chart = data.get("chart") or {}
    result = chart.get("result")
    if not result:
        return None
    meta = result[0].get("meta") or {}
    price = meta.get("regularMarketPrice")
    prev  = meta.get("chartPreviousClose") or meta.get("previousClose")
    if price is None or prev is None:
        return None
    return {
        "price":      float(price),
        "prev":       float(prev),
        "change":     round(float(price) - float(prev), 2),
        "change_pct": round((float(price) - float(prev)) / float(prev) * 100, 2) if prev else None,
    }


@ttl_cache(ttl=3600)
async def fetch_dividends(symbol: str) -> list[dict]:
    """
    配息歷史（從 v8/chart events 取）。
    回傳 [{date, amount}]
    """
    end   = int(datetime.now(tz=timezone.utc).timestamp())
    start = int((datetime.now(tz=timezone.utc) - timedelta(days=365 * 10)).timestamp())
    params = {
        "period1": start, "period2": end,
        "interval": "1d", "events": "div",
    }
    async with httpx.AsyncClient(
        headers=_BROWSER_HEADERS,
        follow_redirects=True,
        timeout=15,
    ) as client:
        for cand in _tw_candidates(symbol):
            try:
                resp = await client.get(YF_CHART_URL.format(symbol=cand), params=params)
                if resp.status_code != 200:
                    continue
                data = resp.json()
            except Exception:
                continue
            chart = data.get("chart") or {}
            result = chart.get("result")
            if not result:
                continue
            events = (result[0].get("events") or {}).get("dividends") or {}
            if not events:
                continue
            out: list[dict] = []
            for _, ev in events.items():
                ts = ev.get("date")
                amt = ev.get("amount")
                if ts is None or amt is None:
                    continue
                out.append({
                    "date": datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d"),
                    "amount": float(amt),
                })
            out.sort(key=lambda x: x["date"])
            return out
    return []
