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
from datetime import datetime, date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from app.core.rate_limit import limiter
from app.core.cache import ttl_cache
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()


def _is_tw(s: str) -> bool:
    return s[:4].isdigit() if len(s) >= 4 else s.isdigit()


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


async def _fetch_financials_tw_finmind(symbol: str) -> dict[str, Any]:
    """
    台股財報：FinMind TaiwanStockFinancialStatements + TaiwanStockCashFlowsStatement
    FinMind 台股財報為累計 YTD，每季末結算。取各年最後一季（Q4/Dec）作為年度數字。
    """
    from app.services.finmind_service import fetch_financial_statements, fetch_cash_flow_statement

    start = date.today() - timedelta(days=365 * 6)
    stmt_rows, cf_rows = await asyncio.gather(
        fetch_financial_statements(symbol, start),
        fetch_cash_flow_statement(symbol, start),
        return_exceptions=True,
    )
    if isinstance(stmt_rows, Exception):
        stmt_rows = []
    if isinstance(cf_rows, Exception):
        cf_rows = []

    if not stmt_rows:
        return {}

    # ── Pivot：{date -> {type -> value}} ────────────────────────────────────────
    def _pivot(rows: list[dict]) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        for r in rows:
            d, t, v = r.get("date",""), r.get("type",""), r.get("value")
            if d and t and v is not None:
                try:
                    out.setdefault(d, {})[t] = float(v)
                except (TypeError, ValueError):
                    pass
        return out

    stmt = _pivot(stmt_rows)
    cf   = _pivot(cf_rows)

    # FinMind type 名稱對應（多個備用名）
    def _find(pivot: dict[str, float], *keys) -> float | None:
        for k in keys:
            v = pivot.get(k)
            if v is not None:
                return v
        return None

    # ── 組成季度記錄 ─────────────────────────────────────────────────────────────
    quarters = []
    for d_str in sorted(stmt.keys()):
        try:
            dt = datetime.strptime(d_str, "%Y-%m-%d")
        except ValueError:
            continue
        p  = stmt[d_str]
        cp = cf.get(d_str, {})

        rev = _find(p, "Revenue", "TotalRevenue", "OperatingRevenue",
                       "SalesRevenue", "NetSales")
        gp  = _find(p, "GrossProfit", "GrossProfitLoss")
        oi  = _find(p, "OperatingIncome", "OperatingProfit",
                       "ProfitFromOperations", "IncomeFromOperations")
        ni  = _find(p, "NetIncome",
                       "NetIncomeAttributableToOwnersOfParent",
                       "ProfitAttributableToOwnersOfParent",
                       "ProfitForThePeriod",
                       "ProfitLossAttributableToOwnersOfParent",
                       "ContinuingOperationsProfit",
                       "NetProfitAfterTax",
                       "AfterTaxProfit")
        eps = _find(p, "EPS", "BasicEPS", "BasicEarningsPerShare",
                       "EarningsPerShare", "BasicEarningsLossPerShare")
        ocf = _find(cp, "CashFlowsFromOperatingActivities",
                        "NetCashFromOperatingActivities",
                        "NetCashProvidedByUsedInOperatingActivities",
                        "CashGeneratedFromOperations",
                        "NetCashProvidedByOperatingActivities")
        capex = _find(cp, "PurchasesOfPropertyPlantAndEquipment",
                          "AcquisitionOfPropertyPlantAndEquipment",
                          "PaymentsForPropertyPlantAndEquipment",
                          "PurchaseOfPropertyPlantAndEquipment",
                          "AcquisitionOfFixedAssets",
                          "PaymentsToAcquirePropertyPlantAndEquipment")

        quarters.append({
            "date": d_str, "year": dt.year, "month": dt.month,
            "revenue": rev, "gross_profit": gp, "operating_income": oi,
            "net_income": ni, "eps": eps, "operating_cf": ocf, "capex": capex,
        })

    if not quarters:
        return {}

    # ── 年度資料：每年取最後一季（台股 YTD 累計，最後一季 = 全年）────────────────
    annual_by_year: dict[int, dict] = {}
    for q in quarters:
        yr = q["year"]
        if yr not in annual_by_year or q["month"] > annual_by_year[yr]["month"]:
            annual_by_year[yr] = q

    def _s(v, d=2):
        try:
            return round(float(v), d) if v is not None else None
        except (TypeError, ValueError):
            return None

    annual = []
    for yr in sorted(annual_by_year):
        q   = annual_by_year[yr]
        rev = _s(q["revenue"])
        gp  = _s(q["gross_profit"])
        oi  = _s(q["operating_income"])
        ni  = _s(q["net_income"])
        eps = _s(q["eps"])
        ocf = _s(q["operating_cf"])
        cap = _s(q["capex"])
        annual.append({
            "year": yr,
            "revenue":          rev,
            "net_income":       ni,
            "gross_profit":     gp,
            "operating_income": oi,
            "eps":              eps,
            "gross_margin":     round(gp / rev, 4) if rev and gp and rev > 0 else None,
            "net_margin":       round(ni / rev, 4) if rev and ni and rev > 0 else None,
            "operating_margin": round(oi / rev, 4) if rev and oi and rev > 0 else None,
            "operating_cf":     ocf,
            "capex":            cap,
            "free_cf":          round(ocf + cap, 2) if ocf is not None and cap is not None else ocf,
        })

    # ── 季度 EPS ─────────────────────────────────────────────────────────────────
    quarterly_eps = [
        {"year": q["year"], "month": q["month"],
         "eps": _s(q["eps"]), "net_income": _s(q["net_income"])}
        for q in sorted(quarters, key=lambda x: (x["year"], x["month"]))
        if q["eps"] is not None or q["net_income"] is not None
    ]

    return {
        "symbol":        symbol,
        "currency":      "TWD",
        "unit":          "億",
        "divisor":       1e8,
        "annual":        annual[-10:],
        "quarterly_eps": quarterly_eps[-8:],
    }


@router.get("/financials/{symbol}")
@limiter.limit("20/minute")
async def get_financials(request: Request, symbol: str):
    """
    取得個股財務報表趨勢（5年年度 + 8季EPS）
    台股：FinMind（公開資訊觀測站，比 yfinance 更準確）
    美股：yfinance
    """
    sym = validate_symbol(symbol)

    if _is_tw(sym):
        # 台股：FinMind
        data = await _fetch_financials_tw_finmind(sym)
        if not data:
            raise HTTPException(status_code=404, detail=f"無法取得 {sym} 財務資料（FinMind 無資料）")
        return data
    else:
        # 美股：yfinance
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, _fetch_financials_sync, sym)
        if not data:
            raise HTTPException(status_code=404, detail=f"無法取得 {sym} 財務資料")
        return data
