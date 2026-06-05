"""
Earnings Surprise 追蹤 API

GET /api/v1/earnings/{symbol}

回傳：
- quarterly_surprise：近 12 季 EPS 實際值 vs 分析師預估 + 驚喜百分比
- annual_earnings：近 10 年年度營收 / 淨利
- has_estimates：是否有分析師估計數據

資料來源：yfinance ticker.earnings_dates
快取 TTL：24 小時（財報季才更新）
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from app.core.rate_limit import limiter
from app.core.cache import ttl_cache
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()


def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    if s.isdigit():
        return f"{s}.TW"
    return s


@ttl_cache(ttl=86400)   # 24 hours
def _fetch_earnings_sync(symbol: str) -> dict[str, Any]:
    import yfinance as yf
    import pandas as pd

    yf_sym  = _yf_symbol(symbol)
    ticker  = yf.Ticker(yf_sym)
    is_tw   = yf_sym.endswith(".TW")
    currency = "TWD" if is_tw else "USD"

    result: dict[str, Any] = {
        "symbol":             symbol,
        "currency":           currency,
        "quarterly_surprise": [],
        "annual_earnings":    [],
        "has_estimates":      False,
        "message":            None,
    }

    # ── Quarterly Earnings Dates（含分析師預估） ─────────────────────────
    try:
        ed = ticker.earnings_dates
        if ed is not None and not ed.empty:
            ed = ed.reset_index()
            # 正規化欄名
            ed.columns = [
                c.lower()
                 .replace(" ", "_")
                 .replace("(%)", "pct")
                 .replace("(", "")
                 .replace(")", "")
                for c in ed.columns
            ]

            surprises = []
            date_col = next((c for c in ed.columns if "date" in c or "earnings" in c.lower()), ed.columns[0])

            for _, row in ed.head(12).iterrows():
                raw_date = row.get(date_col, "")
                date_str = str(raw_date)[:10] if raw_date else ""

                est_col  = next((c for c in ed.columns if "estimate" in c), None)
                rep_col  = next((c for c in ed.columns if "reported" in c), None)
                surp_col = next((c for c in ed.columns if "surprise" in c and "pct" in c), None)

                est  = row.get(est_col)  if est_col  else None
                rep  = row.get(rep_col)  if rep_col  else None
                surp = row.get(surp_col) if surp_col else None

                def _safe(v: Any) -> float | None:
                    try:
                        f = float(v)
                        return None if pd.isna(f) else f
                    except Exception:
                        return None

                est_f  = _safe(est)
                rep_f  = _safe(rep)
                surp_f = _safe(surp)

                if est_f is None and rep_f is None:
                    continue

                # 自算 surprise % 若欄位缺失
                if surp_f is None and est_f and rep_f and abs(est_f) > 0.001:
                    surp_f = round((rep_f - est_f) / abs(est_f) * 100, 2)

                surprises.append({
                    "date":         date_str,
                    "eps_estimate": round(est_f, 3) if est_f is not None else None,
                    "eps_actual":   round(rep_f, 3) if rep_f is not None else None,
                    "surprise_pct": round(surp_f, 2) if surp_f is not None else None,
                })

            result["quarterly_surprise"] = surprises
            result["has_estimates"] = any(s["eps_estimate"] is not None for s in surprises)

    except Exception as exc:
        logger.debug("earnings_dates failed for %s: %s", symbol, exc)

    # ── Annual Earnings（income statement） ──────────────────────────────
    try:
        fin = ticker.financials   # columns = dates, index = line items
        if fin is not None and not fin.empty:
            annual: list[dict] = []
            rev_idx = next((i for i in fin.index if "revenue" in str(i).lower()), None)
            ni_idx  = next((i for i in fin.index if "net income" in str(i).lower()), None)

            for col in list(fin.columns)[:10]:
                year = col.year if hasattr(col, "year") else int(str(col)[:4])

                def _get(row_label: str | None) -> float | None:
                    if row_label is None:
                        return None
                    try:
                        v = fin.at[row_label, col]
                        return float(v) if not pd.isna(v) else None
                    except Exception:
                        return None

                annual.append({
                    "year":       year,
                    "revenue":    _get(rev_idx),
                    "net_income": _get(ni_idx),
                })

            result["annual_earnings"] = annual

    except Exception as exc:
        logger.debug("annual earnings failed for %s: %s", symbol, exc)

    # ── 台股特殊說明 ─────────────────────────────────────────────────────
    if is_tw and not result["has_estimates"]:
        result["message"] = (
            "台股分析師 EPS 預估資料在 Yahoo Finance 較稀少，"
            "Earnings Surprise 欄位可能為空白，僅顯示實際 EPS 紀錄。"
        )

    return result


@router.get("/earnings/{symbol}")
@limiter.limit("20/minute")
async def get_earnings(request: Request, symbol: str):
    """
    Earnings Surprise 追蹤
    GET /api/v1/earnings/AAPL    ← 美股有完整預估
    GET /api/v1/earnings/2330    ← 台股可能無預估值
    """
    sym  = validate_symbol(symbol)
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _fetch_earnings_sync, sym)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"無法取得 {sym} 盈餘資料：{exc}")
    return data
