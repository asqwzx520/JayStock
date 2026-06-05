"""
Volume Profile API

GET /api/v1/volume-profile/{symbol}?period=3m

將指定期間的 OHLCV 日 K 按價位分桶（50 個），
計算每個價格區間的成交量，並標出：
  - POC（Point of Control）= 成交量最大的價位
  - Value Area（成交量佔 70% 的上下邊界）
  - 當前收盤價位置

算法：對每根 K 棒，按 [low, high] 範圍均勻分配成交量至對應桶位。

快取 TTL：15 分鐘
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from app.core.rate_limit import limiter
from app.core.cache import ttl_cache
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()

N_BINS = 50          # 價格桶數
VALUE_AREA_PCT = 0.7  # 價值區間 = 70% 成交量


def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    if s.isdigit():
        return f"{s}.TW"
    return s


@ttl_cache(ttl=900)   # 15 minutes
def _compute_volume_profile_sync(symbol: str, period: str) -> dict[str, Any]:
    import yfinance as yf
    import pandas as pd
    import numpy as np

    period_map = {
        "1m": "1mo", "3m": "3mo", "6m": "6mo",
        "1y": "1y",  "2y": "2y",
    }
    yf_period = period_map.get(period, "3mo")
    yf_sym    = _yf_symbol(symbol)

    df = yf.download(yf_sym, period=yf_period, auto_adjust=True, progress=False, threads=False)
    if df.empty:
        raise ValueError(f"無法取得 {symbol} 資料")

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df.columns = [c.lower() for c in df.columns]
    df = df[["open", "high", "low", "close", "volume"]].dropna()

    price_min = float(df["low"].min())
    price_max = float(df["high"].max())
    if price_max <= price_min:
        price_max = price_min + 1.0

    bin_size = (price_max - price_min) / N_BINS
    bins_vol = np.zeros(N_BINS, dtype=float)

    for _, row in df.iterrows():
        lo     = float(row["low"])
        hi     = float(row["high"])
        vol    = float(row["volume"])
        spread = hi - lo

        if spread < 1e-9:
            # 當沖/停板：全部量算在收盤桶
            b = min(int((float(row["close"]) - price_min) / bin_size), N_BINS - 1)
            bins_vol[max(0, b)] += vol
            continue

        # 計算 lo/hi 跨的桶範圍
        b_lo = int((lo - price_min) / bin_size)
        b_hi = int((hi - price_min) / bin_size)
        b_lo = max(0, b_lo)
        b_hi = min(N_BINS - 1, b_hi)

        for b in range(b_lo, b_hi + 1):
            bucket_lo = price_min + b * bin_size
            bucket_hi = bucket_lo + bin_size
            overlap   = min(hi, bucket_hi) - max(lo, bucket_lo)
            if overlap > 0:
                bins_vol[b] += vol * (overlap / spread)

    total_vol = bins_vol.sum()

    # ── POC ─────────────────────────────────────────────────────────────
    poc_idx = int(np.argmax(bins_vol))
    poc_price = round(price_min + (poc_idx + 0.5) * bin_size, 2)

    # ── Value Area（從 POC 向外擴展直到累計 70%）──────────────────────
    va_target = total_vol * VALUE_AREA_PCT
    va_lo_idx = poc_idx
    va_hi_idx = poc_idx
    va_vol    = bins_vol[poc_idx]

    while va_vol < va_target:
        expand_down = va_lo_idx > 0
        expand_up   = va_hi_idx < N_BINS - 1

        if not expand_down and not expand_up:
            break

        gain_down = bins_vol[va_lo_idx - 1] if expand_down else -1
        gain_up   = bins_vol[va_hi_idx + 1] if expand_up   else -1

        if gain_down >= gain_up and expand_down:
            va_lo_idx -= 1
            va_vol    += bins_vol[va_lo_idx]
        elif expand_up:
            va_hi_idx += 1
            va_vol    += bins_vol[va_hi_idx]
        else:
            va_lo_idx -= 1
            va_vol    += bins_vol[va_lo_idx]

    vah = round(price_min + (va_hi_idx + 1) * bin_size, 2)   # Value Area High
    val = round(price_min + va_lo_idx * bin_size, 2)           # Value Area Low

    current_price = round(float(df["close"].iloc[-1]), 2)
    max_vol = float(bins_vol.max()) if bins_vol.max() > 0 else 1.0

    bins_out = []
    for i in range(N_BINS):
        price_mid = round(price_min + (i + 0.5) * bin_size, 2)
        v = float(bins_vol[i])
        bins_out.append({
            "price":      price_mid,
            "price_low":  round(price_min + i * bin_size, 2),
            "price_high": round(price_min + (i + 1) * bin_size, 2),
            "volume":     round(v),
            "volume_pct": round(v / max_vol, 4),   # 0–1 relative to max bin
            "is_poc":     i == poc_idx,
            "in_va":      va_lo_idx <= i <= va_hi_idx,
        })

    return {
        "symbol":        symbol,
        "period":        period,
        "current_price": current_price,
        "poc":           poc_price,
        "vah":           vah,   # Value Area High
        "val":           val,   # Value Area Low
        "total_volume":  round(total_vol),
        "n_bars":        len(df),
        "price_min":     round(price_min, 2),
        "price_max":     round(price_max, 2),
        "bins":          bins_out,
    }


@router.get("/volume-profile/{symbol}")
@limiter.limit("20/minute")
async def get_volume_profile(
    request: Request,
    symbol:  str,
    period:  str = Query("3m", description="1m / 3m / 6m / 1y / 2y"),
):
    """
    Volume Profile（價位成交量分佈）
    GET /api/v1/volume-profile/2330?period=3m
    """
    sym = validate_symbol(symbol)
    if period not in ("1m", "3m", "6m", "1y", "2y"):
        period = "3m"

    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _compute_volume_profile_sync, sym, period)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"無法計算 {sym} Volume Profile：{exc}")
    return data
