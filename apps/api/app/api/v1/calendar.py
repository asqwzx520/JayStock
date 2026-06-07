"""
自選股事件月曆 API

GET /api/v1/calendar?symbols=2330,2317,0050

回傳未來 30 天內的事件：
  - exdiv   : 除息/除權日
  - earnings : 財報公布日
  - agm      : 股東常會（如有資料）

每支股票平行查詢，快取 TTL = 6 小時（避免過度呼叫 yfinance）
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta, datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from app.core.rate_limit import limiter
from app.core.cache import ttl_cache
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()

WINDOW_DAYS = 30   # 顯示未來多少天內的事件


def _is_tw(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _yf_sym(symbol: str) -> str:
    return f"{symbol}.TW" if _is_tw(symbol) else symbol


def _to_date(v) -> Optional[date]:
    """把各種日期格式轉成 date 物件"""
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, (int, float)):
        # Unix timestamp
        try:
            return datetime.utcfromtimestamp(int(v)).date()
        except Exception:
            return None
    if isinstance(v, str):
        for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(v[:10], fmt).date()
            except ValueError:
                continue
    return None


@ttl_cache(ttl=21600)   # 6 小時
def _fetch_events_sync(symbol: str) -> list[dict]:
    """回傳該股票未來 30 天的事件清單"""
    events: list[dict] = []
    today  = date.today()
    cutoff = today + timedelta(days=WINDOW_DAYS)

    try:
        import yfinance as yf
        import pandas as pd

        ticker = yf.Ticker(_yf_sym(symbol))
        info   = {}
        try:
            info = ticker.info or {}
        except Exception:
            pass

        name = info.get("longName") or info.get("shortName") or symbol

        # ── 1. 除息日（ex-dividend date） ────────────────────────────────────
        # 方法 A：ticker.info['exDividendDate'] — Unix timestamp
        ex_date: Optional[date] = _to_date(info.get("exDividendDate"))
        if ex_date and today <= ex_date <= cutoff:
            events.append({
                "symbol":    symbol,
                "name":      name,
                "type":      "exdiv",
                "label":     "除息日",
                "date":      ex_date.isoformat(),
                "value":     round(float(info.get("dividendRate") or 0), 2) or None,
            })

        # 方法 B：ticker.calendar Ex-Dividend Date
        if not ex_date:
            try:
                cal = ticker.calendar
                if isinstance(cal, dict):
                    raw = cal.get("Ex-Dividend Date") or cal.get("exDividendDate")
                    ex_date = _to_date(raw)
                    if ex_date and today <= ex_date <= cutoff:
                        events.append({
                            "symbol":    symbol,
                            "name":      name,
                            "type":      "exdiv",
                            "label":     "除息日",
                            "date":      ex_date.isoformat(),
                            "value":     None,
                        })
            except Exception:
                pass

        # ── 2. 財報公布日（earnings date） ───────────────────────────────────
        # 方法 A：ticker.info['earningsTimestamp'] / 'earningsDate'
        try:
            raw_ts = (
                info.get("earningsTimestamp")
                or info.get("earningsDate")
            )
            earnings_date = _to_date(raw_ts)
            if earnings_date and today <= earnings_date <= cutoff:
                events.append({
                    "symbol": symbol,
                    "name":   name,
                    "type":   "earnings",
                    "label":  "財報公布",
                    "date":   earnings_date.isoformat(),
                    "value":  None,
                })
        except Exception:
            pass

        # 方法 B：ticker.earnings_dates（第一筆未來日期）
        try:
            ed = ticker.earnings_dates
            if ed is not None and not ed.empty:
                for ts in ed.index:
                    d = _to_date(ts)
                    if d and today <= d <= cutoff:
                        # 避免重複
                        if not any(e["type"] == "earnings" and e["date"] == d.isoformat() for e in events):
                            events.append({
                                "symbol": symbol,
                                "name":   name,
                                "type":   "earnings",
                                "label":  "財報公布",
                                "date":   d.isoformat(),
                                "value":  None,
                            })
        except Exception:
            pass

        # ── 3. 股東常會（AGM） ───────────────────────────────────────────────
        try:
            cal = ticker.calendar
            if isinstance(cal, dict):
                agm_raw = (
                    cal.get("Annual Shareholders Meeting")
                    or cal.get("annualMeeting")
                    or cal.get("Shareholder Meeting")
                )
                agm_date = _to_date(agm_raw)
                if agm_date and today <= agm_date <= cutoff:
                    events.append({
                        "symbol": symbol,
                        "name":   name,
                        "type":   "agm",
                        "label":  "股東常會",
                        "date":   agm_date.isoformat(),
                        "value":  None,
                    })
        except Exception:
            pass

    except Exception as exc:
        logger.warning("[calendar] %s fetch failed: %s", symbol, exc)

    return events


@router.get("/calendar")
@limiter.limit("30/minute")
async def get_calendar(request: Request, symbols: str):
    """
    取得自選股未來 30 天事件月曆

    GET /api/v1/calendar?symbols=2330,2317,0050
    """
    raw_syms = [s.strip() for s in symbols.split(",") if s.strip()]
    if not raw_syms:
        raise HTTPException(400, "No symbols provided")
    if len(raw_syms) > 50:
        raise HTTPException(400, "Too many symbols (max 50)")

    validated = []
    for s in raw_syms:
        try:
            validated.append(validate_symbol(s))
        except Exception:
            pass

    if not validated:
        raise HTTPException(400, "No valid symbols")

    loop = asyncio.get_event_loop()

    tasks = [
        loop.run_in_executor(None, _fetch_events_sync, sym)
        for sym in validated
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    events: list[dict] = []
    for res in results:
        if isinstance(res, list):
            events.extend(res)

    # 依日期排序
    events.sort(key=lambda e: e["date"])

    return {
        "window_days": WINDOW_DAYS,
        "from_date":   date.today().isoformat(),
        "to_date":     (date.today() + timedelta(days=WINDOW_DAYS - 1)).isoformat(),
        "count":       len(events),
        "events":      events,
    }
