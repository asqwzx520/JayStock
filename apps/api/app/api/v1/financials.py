"""
財務報表趨勢 API

GET /api/v1/financials/{symbol}

回傳 5 年年度：營收、淨利、EPS、營業現金流、自由現金流。
資料來源：yfinance Ticker.financials / cashflow（免費）
快取 TTL：3600 秒（1 小時）
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from app.core.rate_limit import limiter
from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)
router = APIRouter()


def _is_tw(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    return f"{s}.TW" if _is_tw(s) else s


def _safe(val) -> float | None:
    try:
        v = float(val)
        return None if (v != v) else round(v, 2)   # NaN check
    except (TypeError, ValueError):
        return None


@ttl_cache(ttl=3600)
def _fetch_financials_sync(symbol: str) -> dict[str, Any]:
    try:
        import yfinance as yf
        import pandas as pd

        yf_sym = _yf_symbol(symbol)
        ticker = yf.Ticker(yf_sym)

        # ── Income Statement ──────────────────────────────────────────────────
        income = ticker.financials       # columns = dates (annual)
        if income is None or income.empty:
            income = ticker.income_stmt

        cashflow = ticker.cashflow
        if cashflow is None or cashflow.empty:
            cashflow = ticker.cash_flow

        shares_info = ticker.info or {}
        shares_outstanding = shares_info.get("sharesOutstanding") or shares_info.get("impliedSharesOutstanding")

        annual: list[dict] = []
        if income is not None and not income.empty:
            for col in income.columns[:10]:   # 最近 10 年
                year = col.year if hasattr(col, "year") else int(str(col)[:4])
                row: dict[str, Any] = {"year": year}

                rev = _safe(income.get("Total Revenue", {}).get(col) if hasattr(income, "get") else
                            income.loc["Total Revenue", col] if "Total Revenue" in income.index else None)
                ni  = _safe(income.get("Net Income", {}).get(col) if hasattr(income, "get") else
                            income.loc["Net Income", col] if "Net Income" in income.index else None)
                gross = _safe(income.loc["Gross Profit", col] if "Gross Profit" in income.index else None)
                op_inc = _safe(income.loc["Operating Income", col] if "Operating Income" in income.index else None)

                row["revenue"]          = rev
                row["net_income"]       = ni
                row["gross_profit"]     = gross
                row["operating_income"] = op_inc

                # EPS = Net Income / Shares Outstanding
                if ni is not None and shares_outstanding:
                    row["eps"] = round(ni / shares_outstanding, 2)
                else:
                    row["eps"] = None

                # Margins
                if rev and rev > 0:
                    row["gross_margin"]     = round(gross / rev, 4)     if gross is not None else None
                    row["net_margin"]       = round(ni    / rev, 4)     if ni    is not None else None
                    row["operating_margin"] = round(op_inc / rev, 4)    if op_inc is not None else None
                else:
                    row["gross_margin"] = row["net_margin"] = row["operating_margin"] = None

                # Cash flow
                if cashflow is not None and not cashflow.empty and col in cashflow.columns:
                    ocf_key  = "Operating Cash Flow"
                    capex_key = "Capital Expenditure"
                    ocf  = _safe(cashflow.loc[ocf_key,   col] if ocf_key   in cashflow.index else None)
                    capex = _safe(cashflow.loc[capex_key, col] if capex_key in cashflow.index else None)
                    row["operating_cf"] = ocf
                    row["capex"]        = capex
                    row["free_cf"]      = round(ocf + capex, 2) if (ocf is not None and capex is not None) else ocf
                else:
                    row["operating_cf"] = row["capex"] = row["free_cf"] = None

                annual.append(row)

        # Sort ascending by year
        annual.sort(key=lambda r: r["year"])

        # ── Quarterly EPS ─────────────────────────────────────────────────────
        q_income = ticker.quarterly_financials
        if q_income is None or q_income.empty:
            q_income = ticker.quarterly_income_stmt

        quarterly_eps: list[dict] = []
        if q_income is not None and not q_income.empty:
            for col in q_income.columns[:8]:   # 最近 8 季
                year  = col.year  if hasattr(col, "year")  else int(str(col)[:4])
                month = col.month if hasattr(col, "month") else 1
                ni = _safe(q_income.loc["Net Income", col] if "Net Income" in q_income.index else None)
                eps = round(ni / shares_outstanding, 2) if (ni is not None and shares_outstanding) else None
                quarterly_eps.append({"year": year, "month": month, "eps": eps, "net_income": ni})
            quarterly_eps.sort(key=lambda r: (r["year"], r["month"]))

        # Currency
        currency = shares_info.get("currency", "TWD" if _is_tw(symbol) else "USD")
        unit = "億" if _is_tw(symbol) else "M"
        divisor = 1e8 if _is_tw(symbol) else 1e6

        return {
            "symbol":        symbol,
            "currency":      currency,
            "unit":          unit,
            "divisor":       divisor,
            "annual":        annual,
            "quarterly_eps": quarterly_eps,
        }

    except Exception as exc:
        logger.warning("[financials] %s failed: %s", symbol, exc)
        return {}


@router.get("/financials/{symbol}")
@limiter.limit("20/minute")
async def get_financials(request: Request, symbol: str):
    """
    取得個股財務報表趨勢（5年年度 + 8季EPS）
    台股：GET /api/v1/financials/2330
    美股：GET /api/v1/financials/AAPL
    """
    sym = symbol.upper().strip()
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _fetch_financials_sync, sym)
    if not data:
        raise HTTPException(status_code=404, detail=f"無法取得 {sym} 財務資料")
    return data
