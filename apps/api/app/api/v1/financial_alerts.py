"""
財報異常警示 API

GET /api/v1/financial-alerts/{symbol}

自動偵測以下異常：
  1. 應收帳款/營收比 連續上升（應收帳款成長快於營收 → 可能客戶付款意願下降）
  2. 存貨/營收比 連續上升（存貨積壓 → 可能滯銷或需降價）
  3. 連續 3 季以上淨利衰退
  4. 自由現金流 < 淨利 × 0.5（連續 2 年，盈餘品質疑慮）
  5. 毛利率連續 3 年下降
  6. 營業現金流連續 2 年為負

每條警示包含：severity（warning / danger）、title、detail、data_points

快取 TTL：24 小時
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


def _safe_pct(numerator: float | None, denominator: float | None) -> float | None:
    """numerator / denominator，任一為 None 或 denominator ≈ 0 則回傳 None"""
    if numerator is None or denominator is None or abs(denominator) < 1e-6:
        return None
    return numerator / denominator


@ttl_cache(ttl=86400)   # 24 hours
def _compute_alerts_sync(symbol: str) -> dict[str, Any]:  # noqa: C901 (complexity ok)
    import yfinance as yf
    import pandas as pd

    yf_sym = _yf_symbol(symbol)
    ticker = yf.Ticker(yf_sym)

    alerts: list[dict] = []
    data_summary: dict[str, Any] = {}

    # ── Helper to get series from income statement / balance sheet ───────
    def _get_series(df: pd.DataFrame | None, *keys: str) -> list[tuple[int, float]]:
        """Returns [(year, value), ...] newest first, filtering None."""
        if df is None or df.empty:
            return []
        for k in keys:
            matching = [i for i in df.index if k.lower() in str(i).lower()]
            if matching:
                row = df.loc[matching[0]]
                out = []
                for col in row.index:
                    year = col.year if hasattr(col, "year") else int(str(col)[:4])
                    try:
                        v = float(row[col])
                        if not pd.isna(v):
                            out.append((year, v))
                    except Exception:
                        pass
                return sorted(out, key=lambda x: x[0], reverse=True)
        return []

    def _is_consecutive_rising(series: list[tuple[int, float]], n: int = 3) -> bool:
        """Check if latest n values form a strictly rising sequence (newest first → compare oldest to newest)."""
        if len(series) < n:
            return False
        # series is newest-first; check oldest→newest direction
        vals = [v for _, v in series[:n]][::-1]   # oldest first
        return all(vals[i] < vals[i + 1] for i in range(len(vals) - 1))

    def _is_consecutive_falling(series: list[tuple[int, float]], n: int = 3) -> bool:
        if len(series) < n:
            return False
        vals = [v for _, v in series[:n]][::-1]   # oldest first
        return all(vals[i] > vals[i + 1] for i in range(len(vals) - 1))

    try:
        inc = ticker.financials         # annual income statement (columns = dates)
        bal = ticker.balance_sheet      # annual balance sheet
        cf  = ticker.cashflow           # annual cash flow

        # ── Base series ───────────────────────────────────────────────────
        revenues   = _get_series(inc, "Total Revenue", "Revenue")
        net_incomes = _get_series(inc, "Net Income")
        gross_profits = _get_series(inc, "Gross Profit")
        op_cfs     = _get_series(cf,  "Operating Cash Flow", "Cash Flow From Operations",
                                        "Cash From Operating Activities")
        capex_raw  = _get_series(cf,  "Capital Expenditure", "Purchase Of Property")
        receivables = _get_series(bal, "Net Receivables", "Accounts Receivable")
        inventories = _get_series(bal, "Inventory", "Inventories")

        # FCF = OCF + CapEx (CapEx is often negative in yfinance)
        capex_map  = {yr: v for yr, v in capex_raw}
        fcf_series = []
        for yr, ocf in op_cfs:
            cx = capex_map.get(yr)
            if cx is not None:
                fcf_series.append((yr, ocf + cx))

        rev_map  = {yr: v for yr, v in revenues}
        ni_map   = {yr: v for yr, v in net_incomes}
        gp_map   = {yr: v for yr, v in gross_profits}

        # ── 1. 應收帳款/營收比 ────────────────────────────────────────────
        ar_ratios: list[tuple[int, float]] = []
        for yr, ar in receivables:
            rev = rev_map.get(yr)
            r = _safe_pct(ar, rev)
            if r is not None:
                ar_ratios.append((yr, r))
        ar_ratios.sort(key=lambda x: x[0], reverse=True)

        if _is_consecutive_rising(ar_ratios, n=3):
            recent = ar_ratios[:3]
            alerts.append({
                "id":       "ar_rising",
                "severity": "warning",
                "title":    "⚠️ 應收帳款/營收比 連續 3 年上升",
                "detail":   (
                    f"應收帳款佔營收比例持續擴大，可能意味客戶付款條件寬鬆或壞帳風險上升。"
                    f"近 3 年比率：{', '.join(f'{yr} {v*100:.1f}%' for yr, v in sorted(recent, key=lambda x: x[0]))}"
                ),
                "data": [{"year": yr, "value": round(v * 100, 2)} for yr, v in recent],
                "unit": "%",
                "label": "應收/營收",
            })
        data_summary["ar_ratios"] = [{"year": yr, "value": round(v * 100, 2)} for yr, v in ar_ratios[:5]]

        # ── 2. 存貨/營收比 ────────────────────────────────────────────────
        inv_ratios: list[tuple[int, float]] = []
        for yr, inv in inventories:
            rev = rev_map.get(yr)
            r = _safe_pct(inv, rev)
            if r is not None:
                inv_ratios.append((yr, r))
        inv_ratios.sort(key=lambda x: x[0], reverse=True)

        if _is_consecutive_rising(inv_ratios, n=3):
            recent = inv_ratios[:3]
            alerts.append({
                "id":       "inv_rising",
                "severity": "warning",
                "title":    "⚠️ 存貨/營收比 連續 3 年上升",
                "detail":   (
                    f"存貨佔營收比例持續上升，可能面臨滯銷或需降價去化庫存壓力。"
                    f"近 3 年比率：{', '.join(f'{yr} {v*100:.1f}%' for yr, v in sorted(recent, key=lambda x: x[0]))}"
                ),
                "data": [{"year": yr, "value": round(v * 100, 2)} for yr, v in recent],
                "unit": "%",
                "label": "存貨/營收",
            })
        data_summary["inv_ratios"] = [{"year": yr, "value": round(v * 100, 2)} for yr, v in inv_ratios[:5]]

        # ── 3. 連續 3 季以上淨利衰退（用季報） ────────────────────────────
        try:
            q_inc = ticker.quarterly_financials
            q_ni  = _get_series(q_inc, "Net Income")
            if _is_consecutive_falling(q_ni, n=3):
                recent_q = sorted(q_ni[:3], key=lambda x: x[0])
                alerts.append({
                    "id":       "ni_decline_q",
                    "severity": "danger",
                    "title":    "🔴 連續 3 季淨利衰退",
                    "detail":   (
                        f"最近 3 季淨利持續下滑，需留意獲利動能是否出現結構性轉弱。"
                        f"近 3 季淨利：{', '.join(f'Q{yr} {v/1e8:.1f}億' for yr, v in recent_q)}"
                        if all(abs(v) > 1e6 for _, v in recent_q)
                        else f"近 3 季均出現下滑趨勢"
                    ),
                    "data": [{"year": yr, "value": v} for yr, v in recent_q],
                    "unit": "原幣",
                    "label": "季度淨利",
                })
        except Exception:
            pass

        # ── 4. FCF < 淨利 × 0.5 連續 2 年（盈餘品質） ────────────────────
        fcf_quality_issues = []
        for yr, fcf in fcf_series[:4]:
            ni = ni_map.get(yr)
            if ni is not None and ni > 1e6 and fcf < ni * 0.5:
                fcf_quality_issues.append({"year": yr, "fcf": fcf, "ni": ni})

        if len(fcf_quality_issues) >= 2:
            alerts.append({
                "id":       "fcf_quality",
                "severity": "warning",
                "title":    "⚠️ 盈餘品質疑慮：FCF 持續遠低於淨利",
                "detail":   (
                    "自由現金流連續 2 年以上不到淨利的 50%，"
                    "可能代表盈餘難以轉化為現金，或大量資本支出侵蝕現金流。"
                ),
                "data": [
                    {"year": d["year"], "fcf_ratio": round(d["fcf"] / d["ni"] * 100, 1) if d["ni"] else None}
                    for d in fcf_quality_issues[:3]
                ],
                "unit": "FCF/NI %",
                "label": "FCF/淨利",
            })
        data_summary["fcf_series"] = [{"year": yr, "value": v} for yr, v in fcf_series[:5]]

        # ── 5. 毛利率 連續 3 年下降 ──────────────────────────────────────
        gm_series: list[tuple[int, float]] = []
        for yr, gp in gross_profits:
            rev = rev_map.get(yr)
            gm = _safe_pct(gp, rev)
            if gm is not None:
                gm_series.append((yr, gm))
        gm_series.sort(key=lambda x: x[0], reverse=True)

        if _is_consecutive_falling(gm_series, n=3):
            recent_gm = gm_series[:3]
            alerts.append({
                "id":       "gm_falling",
                "severity": "warning",
                "title":    "⚠️ 毛利率 連續 3 年下滑",
                "detail":   (
                    f"毛利率持續萎縮，可能面臨定價能力減弱或成本上漲壓力。"
                    f"近 3 年毛利率：{', '.join(f'{yr} {v*100:.1f}%' for yr, v in sorted(recent_gm, key=lambda x: x[0]))}"
                ),
                "data": [{"year": yr, "value": round(v * 100, 2)} for yr, v in recent_gm],
                "unit": "%",
                "label": "毛利率",
            })
        data_summary["gm_series"] = [{"year": yr, "value": round(v * 100, 2)} for yr, v in gm_series[:5]]

        # ── 6. 營業現金流 連續 2 年為負 ──────────────────────────────────
        neg_ocf_years = [(yr, v) for yr, v in op_cfs[:4] if v < 0]
        if len(neg_ocf_years) >= 2:
            alerts.append({
                "id":       "negative_ocf",
                "severity": "danger",
                "title":    "🔴 營業現金流 連續 2 年為負",
                "detail":   (
                    "核心業務持續燒錢，如無外部融資支撐，可能面臨流動性壓力。"
                ),
                "data": [{"year": yr, "value": round(v / 1e8, 2)} for yr, v in neg_ocf_years[:3]],
                "unit": "億",
                "label": "OCF",
            })

    except Exception as exc:
        logger.warning("financial_alerts: data fetch error for %s: %s", symbol, exc)

    return {
        "symbol":        symbol,
        "alerts":        alerts,
        "alert_count":   len(alerts),
        "has_danger":    any(a["severity"] == "danger"  for a in alerts),
        "has_warning":   any(a["severity"] == "warning" for a in alerts),
        "data_summary":  data_summary,
        "note":          "資料來源：Yahoo Finance 年度財報，部分欄位可能因資料庫缺漏而略過",
    }


@router.get("/financial-alerts/{symbol}")
@limiter.limit("20/minute")
async def get_financial_alerts(request: Request, symbol: str):
    """
    財報異常警示
    GET /api/v1/financial-alerts/2330
    GET /api/v1/financial-alerts/AAPL
    """
    sym  = validate_symbol(symbol)
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _compute_alerts_sync, sym)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"無法計算 {sym} 財報警示：{exc}")
    return data
