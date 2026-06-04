"""
PE / PB 歷史估值帶服務

計算方式：
  1. 取 5 年週線收盤價（yfinance）
  2. 取季度 Net Income + Shares → 滾動 TTM EPS → 歷史 PE
  3. 取季度 Stockholders Equity + Shares → BVPS → 歷史 PB
  4. 計算 mean ± 1σ / ±2σ 帶狀範圍、當前分位數

快取 TTL：86400 秒（每日更新）
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

_EQ_KEYS = [
    "Stockholders Equity",
    "Total Stockholders Equity",
    "Common Stock Equity",
    "Total Equity Gross Minority Interest",
    "Ordinary Shares Number",  # last-resort key lookup
]


def _is_tw(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    return f"{s}.TW" if _is_tw(s) else s


def _tz_strip(idx: Any) -> Any:
    """Remove timezone from DatetimeIndex regardless of form."""
    try:
        return idx.tz_localize(None)
    except TypeError:
        try:
            return idx.tz_convert(None)
        except Exception:
            return idx


def _band_stats(values_list: list[dict]) -> dict | None:
    """Compute mean / std / bands / percentile from [{time,value}]."""
    if len(values_list) < 52:   # need at least 1 year of weekly data
        return None
    try:
        import numpy as np
        vals = np.array([d["value"] for d in values_list], dtype=float)
        mean = float(np.nanmean(vals))
        std  = float(np.nanstd(vals))
        current = float(values_list[-1]["value"])
        pct  = float(np.nanmean(vals <= current) * 100)
        return {
            "current":         round(current, 2),
            "mean":            round(mean, 2),
            "std":             round(std,  2),
            "band_1std_low":   round(mean - std,     2),
            "band_1std_high":  round(mean + std,     2),
            "band_2std_low":   round(mean - 2 * std, 2),
            "band_2std_high":  round(mean + 2 * std, 2),
            "percentile":      round(pct, 1),
            "history":         values_list[-260:],   # ~5 years weekly
        }
    except Exception as exc:
        logger.debug("[valuation_band] band_stats: %s", exc)
        return None


@ttl_cache(ttl=86_400)
def _fetch_sync(symbol: str) -> dict[str, Any]:
    try:
        import yfinance as yf
        import pandas as pd
        import numpy as np

        yf_sym = _yf_symbol(symbol)
        ticker = yf.Ticker(yf_sym)

        # ── 5-year weekly price ───────────────────────────────────────────────
        price_raw = ticker.history(period="5y", interval="1wk")
        if price_raw is None or price_raw.empty:
            return {"symbol": symbol, "pe": None, "pb": None}

        price: pd.Series = price_raw["Close"].copy()
        price.index = _tz_strip(pd.DatetimeIndex(price.index))
        price = price.dropna().sort_index()
        if len(price) < 52:
            return {"symbol": symbol, "pe": None, "pb": None}

        info = ticker.info or {}
        shares = (
            info.get("sharesOutstanding")
            or info.get("impliedSharesOutstanding")
            or 0
        )

        # ── PE history ────────────────────────────────────────────────────────
        pe_pts: list[dict] = []
        try:
            q_inc = ticker.quarterly_income_stmt
            if q_inc is None or q_inc.empty:
                q_inc = ticker.quarterly_financials

            if q_inc is not None and not q_inc.empty and shares > 0:
                ni_key = next(
                    (k for k in ["Net Income", "NetIncome", "Net Income Common Stockholders"]
                     if k in q_inc.index), None
                )
                if ni_key:
                    ni_series: pd.Series = q_inc.loc[ni_key].copy()
                    ni_series.index = _tz_strip(pd.DatetimeIndex(ni_series.index))
                    ni_series = ni_series.sort_index().dropna().astype(float)

                    eps_q = ni_series / shares
                    # TTM = rolling 4-quarter sum
                    eps_ttm = eps_q.rolling(4, min_periods=4).sum()

                    # Forward-fill quarterly EPS onto weekly price dates
                    eps_aligned = eps_ttm.reindex(
                        price.index.union(eps_ttm.index)
                    ).ffill().reindex(price.index)

                    pe_raw = price / eps_aligned
                    # Keep only sensible positive values
                    pe_clean = pe_raw[(pe_raw > 0) & (pe_raw < 500)].dropna()

                    pe_pts = [
                        {"time": t.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
                        for t, v in pe_clean.items()
                    ]
        except Exception as exc:
            logger.debug("[valuation_band] PE calc %s: %s", symbol, exc)

        # ── PB history ────────────────────────────────────────────────────────
        pb_pts: list[dict] = []
        try:
            q_bs = ticker.quarterly_balance_sheet
            if q_bs is None or q_bs.empty:
                q_bs = ticker.quarterly_financials  # last resort (won't have equity)

            if q_bs is not None and not q_bs.empty and shares > 0:
                eq_key = next(
                    (k for k in _EQ_KEYS if k in q_bs.index), None
                )
                if eq_key:
                    eq_series: pd.Series = q_bs.loc[eq_key].copy()
                    eq_series.index = _tz_strip(pd.DatetimeIndex(eq_series.index))
                    eq_series = eq_series.sort_index().dropna().astype(float)

                    bvps = eq_series / shares
                    bvps_aligned = bvps.reindex(
                        price.index.union(bvps.index)
                    ).ffill().reindex(price.index)

                    pb_raw = price / bvps_aligned
                    pb_clean = pb_raw[(pb_raw > 0) & (pb_raw < 100)].dropna()

                    pb_pts = [
                        {"time": t.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
                        for t, v in pb_clean.items()
                    ]
        except Exception as exc:
            logger.debug("[valuation_band] PB calc %s: %s", symbol, exc)

        return {
            "symbol": symbol,
            "pe":     _band_stats(pe_pts),
            "pb":     _band_stats(pb_pts),
        }

    except Exception as exc:
        logger.warning("[valuation_band] %s failed: %s", symbol, exc)
        return {"symbol": symbol, "pe": None, "pb": None}


async def get_valuation_band(symbol: str) -> dict[str, Any]:
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_sync, symbol.upper().strip())
