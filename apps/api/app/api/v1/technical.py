"""
技術指標摘要 API

GET /api/v1/technical/{symbol}

計算最新技術指標值與信號，用於「分析」tab 的技術面摘要。
資料來源：yfinance 歷史日K，pandas_ta 計算指標。
快取 TTL：5 分鐘
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import date
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


def _is_tw(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


@ttl_cache(ttl=300)
def _compute_technical_sync(symbol: str) -> dict[str, Any]:
    import pandas as pd
    import pandas_ta as ta  # noqa

    # ── 資料來源：台股用 FinMind（避免 Render 被 Yahoo 封 IP）；美股用 yfinance ──
    if _is_tw(symbol):
        from app.services.finmind_service import fetch_daily_kline_sync
        from datetime import timedelta
        end_d = date.today()
        start_d = end_d - timedelta(days=365 * 2)
        rows = fetch_daily_kline_sync(symbol, start_d, end_d)
        if not rows:
            return {}
        df = pd.DataFrame(rows)
        df = df[["open", "high", "low", "close", "volume"]].apply(
            pd.to_numeric, errors="coerce"
        ).dropna().reset_index(drop=True)
    else:
        import yfinance as yf
        yf_sym = _yf_symbol(symbol)
        df = yf.download(yf_sym, period="2y", auto_adjust=True, progress=False, threads=False)
        if df.empty:
            return {}
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.columns = [c.lower() for c in df.columns]
        df = df[["open", "high", "low", "close", "volume"]].dropna()

    close = df["close"]
    vol   = df["volume"]
    price = float(close.iloc[-1])

    # ── RSI ──────────────────────────────────────────────────────────────────
    rsi_s = df.ta.rsi(length=14)
    rsi_v = float(rsi_s.iloc[-1]) if rsi_s is not None and not rsi_s.empty else None
    rsi_signal = (
        "overbought" if rsi_v and rsi_v > 70
        else "oversold"  if rsi_v and rsi_v < 30
        else "strong"    if rsi_v and rsi_v >= 50
        else "weak"      if rsi_v
        else None
    )

    # ── MACD ─────────────────────────────────────────────────────────────────
    macd_df = df.ta.macd(fast=12, slow=26, signal=9)
    macd_v = sig_v = hist_v = None
    macd_signal = None
    if macd_df is not None and not macd_df.empty:
        macd_v = float(macd_df.iloc[-1, 0])
        sig_v  = float(macd_df.iloc[-1, 2])
        hist_v = float(macd_df.iloc[-1, 1])
        prev_macd = float(macd_df.iloc[-2, 0]) if len(macd_df) > 1 else macd_v
        prev_sig  = float(macd_df.iloc[-2, 2]) if len(macd_df) > 1 else sig_v
        if macd_v > sig_v and prev_macd <= prev_sig:
            macd_signal = "golden_cross"
        elif macd_v < sig_v and prev_macd >= prev_sig:
            macd_signal = "death_cross"
        elif macd_v > sig_v:
            macd_signal = "bullish"
        else:
            macd_signal = "bearish"

    # ── KD (Stochastic) ───────────────────────────────────────────────────────
    stoch = df.ta.stoch(k=9, d=3)
    k_v = d_v = None
    kd_signal = None
    if stoch is not None and not stoch.empty:
        k_v = float(stoch.iloc[-1, 0])
        d_v = float(stoch.iloc[-1, 1])
        pk  = float(stoch.iloc[-2, 0]) if len(stoch) > 1 else k_v
        pd_ = float(stoch.iloc[-2, 1]) if len(stoch) > 1 else d_v
        if k_v > d_v and pk <= pd_:
            kd_signal = "golden_cross"
        elif k_v < d_v and pk >= pd_:
            kd_signal = "death_cross"
        elif k_v > d_v:
            kd_signal = "bullish"
        else:
            kd_signal = "bearish"

    # ── Moving Averages ───────────────────────────────────────────────────────
    ma_vals: dict[str, float | None] = {}
    for p in [5, 10, 20, 60, 120, 240]:
        if len(close) >= p:
            ma_vals[f"ma{p}"] = round(float(close.rolling(p).mean().iloc[-1]), 2)
        else:
            ma_vals[f"ma{p}"] = None

    above = [p for p in [5, 10, 20, 60, 120, 240] if ma_vals.get(f"ma{p}") and price >= ma_vals[f"ma{p}"]]  # type: ignore[operator]
    below = [p for p in [5, 10, 20, 60, 120, 240] if ma_vals.get(f"ma{p}") and price <  ma_vals[f"ma{p}"]]  # type: ignore[operator]
    if not below:
        ma_alignment = "strong_bull"   # 所有 MA 之上
    elif not above:
        ma_alignment = "strong_bear"   # 所有 MA 之下
    elif len(above) >= 4:
        ma_alignment = "bull"
    elif len(below) >= 4:
        ma_alignment = "bear"
    else:
        ma_alignment = "neutral"

    # ── Bollinger Bands ───────────────────────────────────────────────────────
    bb = df.ta.bbands(length=20, std=2)
    bb_upper = bb_lower = bb_mid = bb_pct = None
    if bb is not None and not bb.empty:
        bb_upper = round(float(bb.iloc[-1, 2]), 2)
        bb_lower = round(float(bb.iloc[-1, 0]), 2)
        bb_mid   = round(float(bb.iloc[-1, 1]), 2)
        rng = bb_upper - bb_lower
        bb_pct = round((price - bb_lower) / rng, 3) if rng > 0 else 0.5

    # ── Volume ────────────────────────────────────────────────────────────────
    today_vol  = float(vol.iloc[-1])
    avg20_vol  = float(vol.tail(20).mean())
    vol_ratio  = round(today_vol / avg20_vol, 2) if avg20_vol > 0 else 1.0
    vol_signal = "high" if vol_ratio >= 2 else "above_avg" if vol_ratio >= 1.3 else "normal" if vol_ratio >= 0.7 else "low"

    # ── 52-Week Position ──────────────────────────────────────────────────────
    w52 = close.tail(252)
    w52_high = round(float(w52.max()), 2)
    w52_low  = round(float(w52.min()), 2)
    w52_pct  = round((price - w52_low) / (w52_high - w52_low), 3) if w52_high > w52_low else 0.5

    # ── Price Performance ─────────────────────────────────────────────────────
    def _perf(n: int) -> float | None:
        if len(close) < n + 1:
            return None
        ref = float(close.iloc[-(n + 1)])
        return round((price - ref) / ref, 4) if ref > 0 else None

    perf = {
        "1w":  _perf(5),
        "1m":  _perf(21),
        "3m":  _perf(63),
        "6m":  _perf(126),
        "1y":  _perf(252),
    }

    # ── Support / Resistance (recent swing highs/lows) ────────────────────────
    highs = df["high"].tail(60)
    lows  = df["low"].tail(60)
    support    = round(float(lows.min()), 2)
    resistance = round(float(highs.max()), 2)
    # Recent local extremes (rolling 5-day)
    local_hi = highs.rolling(5, center=True).max()
    local_lo = lows.rolling(5, center=True).min()
    res_levels = sorted(set(round(float(v), 0) for v in local_hi.dropna().tail(3)))
    sup_levels = sorted(set(round(float(v), 0) for v in local_lo.dropna().tail(3)))

    return {
        "price": round(price, 2),
        "rsi": {
            "value":  round(rsi_v, 1) if rsi_v else None,
            "signal": rsi_signal,
        },
        "macd": {
            "macd":      round(macd_v, 3) if macd_v is not None else None,
            "signal_line": round(sig_v, 3) if sig_v is not None else None,
            "histogram": round(hist_v, 3) if hist_v is not None else None,
            "signal":    macd_signal,
        },
        "kd": {
            "k":      round(k_v, 1) if k_v is not None else None,
            "d":      round(d_v, 1) if d_v is not None else None,
            "signal": kd_signal,
        },
        "ma": {
            **ma_vals,
            "alignment": ma_alignment,
            "above_count": len(above),
            "below_count": len(below),
        },
        "bollinger": {
            "upper": bb_upper,
            "lower": bb_lower,
            "mid":   bb_mid,
            "pct_b": bb_pct,
        },
        "volume": {
            "today":    int(today_vol),
            "avg20":    int(avg20_vol),
            "ratio":    vol_ratio,
            "signal":   vol_signal,
        },
        "week52": {
            "high":     w52_high,
            "low":      w52_low,
            "position": w52_pct,
        },
        "performance": perf,
        "support_resistance": {
            "support":          support,
            "resistance":       resistance,
            "support_levels":   sup_levels[-3:],
            "resistance_levels": res_levels[-3:],
        },
    }


@router.get("/technical/{symbol}")
@limiter.limit("20/minute")
async def get_technical(request: Request, symbol: str):
    """
    取得個股技術指標摘要
    台股：GET /api/v1/technical/2330
    美股：GET /api/v1/technical/AAPL
    """
    sym = validate_symbol(symbol)
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _compute_technical_sync, sym)
    if not data:
        raise HTTPException(status_code=404, detail=f"無法取得 {sym} 技術指標資料")
    return data
