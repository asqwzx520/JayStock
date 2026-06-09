"""
個股股利歷史

GET /api/v1/dividends/{symbol}

資料來源：yfinance Ticker.dividends（配息明細）+ Ticker.history（計算殖利率）
台股：自動附加 .TW 後綴
美股：直接使用 ticker

快取 TTL：3600 秒 — 配息資料每年變動少
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from app.core.rate_limit import limiter
from app.core.cache import ttl_cache
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()


def _is_tw(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _yf_sym(symbol: str) -> str:
    return f"{symbol}.TW" if _is_tw(symbol) else symbol


def _safe(val, digits: int = 2):
    try:
        v = float(val)
        return None if (v != v) else round(v, digits)  # NaN check
    except (TypeError, ValueError):
        return None


@ttl_cache(ttl=3600)
def _fetch_dividends_sync(symbol: str) -> dict:
    try:
        import yfinance as yf
        import pandas as pd

        ticker = yf.Ticker(_yf_sym(symbol))
        divs = ticker.dividends  # pandas Series, DatetimeIndex → float

        # Fallback: some TW tickers work without .TW suffix
        if (divs is None or len(divs) == 0) and _is_tw(symbol):
            ticker = yf.Ticker(symbol)
            divs = ticker.dividends

        info = ticker.info or {}
        currency = info.get("currency", "TWD" if _is_tw(symbol) else "USD")

        # ── Year-end prices for yield calculation ──────────────────────────
        hist = ticker.history(period="10y", interval="1mo", auto_adjust=True)
        year_end_prices: dict[int, float] = {}
        if hist is not None and not hist.empty:
            px = hist.copy()
            px.index = pd.to_datetime(px.index)
            if px.index.tz is not None:
                px.index = px.index.tz_localize(None)
            px["_year"] = px.index.year
            for yr, grp in px.groupby("_year"):
                year_end_prices[int(yr)] = float(grp["Close"].iloc[-1])

        # ── Group dividends by year ────────────────────────────────────────
        annual: list[dict] = []
        current_year = datetime.now().year
        cutoff_year = current_year - 10

        if divs is not None and len(divs) > 0:
            df = divs.reset_index()
            df.columns = ["date", "dividend"]
            df["date"] = pd.to_datetime(df["date"])
            if df["date"].dt.tz is not None:
                df["date"] = df["date"].dt.tz_localize(None)
            df["year"] = df["date"].dt.year
            df = df[df["year"] >= cutoff_year]

            for yr, grp in df.groupby("year"):
                yr = int(yr)
                total = _safe(grp["dividend"].sum())
                yep = year_end_prices.get(yr)
                yield_pct = round(total / yep * 100, 2) if (total and yep and yep > 0) else None
                dates = sorted(grp["date"].dt.strftime("%Y-%m-%d").tolist())
                annual.append({
                    "year": yr,
                    "total_dividend": total,
                    "yield_pct": yield_pct,
                    "payments": len(grp),
                    "dates": dates,
                })

            annual.sort(key=lambda x: x["year"])

        # ── Consecutive dividend years (backwards from last full year) ─────
        years_with_div = {r["year"] for r in annual if (r["total_dividend"] or 0) > 0}
        last_full = current_year - 1
        consecutive = 0
        for y in range(last_full, last_full - 20, -1):
            if y in years_with_div:
                consecutive += 1
            else:
                break

        # ── Next ex-dividend date from calendar ───────────────────────────
        next_ex_date: str | None = None
        try:
            cal = ticker.calendar
            if isinstance(cal, dict):
                ex_dt = cal.get("Ex-Dividend Date") or cal.get("exDividendDate")
                if ex_dt is not None:
                    next_ex_date = (
                        ex_dt.strftime("%Y-%m-%d") if hasattr(ex_dt, "strftime") else str(ex_dt)
                    )
        except Exception:
            pass

        # ── Summary figures from info ──────────────────────────────────────
        dy = info.get("dividendYield")
        latest_yield = _safe(dy * 100) if dy else None
        next_dividend = _safe(info.get("dividendRate"))

        return {
            "symbol": symbol,
            "is_tw": _is_tw(symbol),
            "currency": currency,
            "annual": annual,
            "consecutive_years": consecutive,
            "latest_yield": latest_yield,
            "next_ex_date": next_ex_date,
            "next_dividend": next_dividend,
        }

    except Exception as exc:
        logger.warning("[dividends] %s failed: %s", symbol, exc)
        return {}


@router.get("/dividends/{symbol}")
@limiter.limit("20/minute")
async def get_dividends(request: Request, symbol: str):
    """
    取得個股股利歷史（近 10 年）
    台股：GET /api/v1/dividends/2330
    美股：GET /api/v1/dividends/AAPL
    """
    sym = validate_symbol(symbol)
    loop = asyncio.get_running_loop()
    data = await loop.run_in_executor(None, _fetch_dividends_sync, sym)
    if not data:
        # 台股在 Render 上 yfinance 可能被擋，回傳空列表而非 404
        return {"symbol": sym, "dividends": [], "summary": {}, "source": "unavailable"}
    return data
