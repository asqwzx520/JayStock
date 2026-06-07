"""
K 線型態辨識 API

GET /api/v1/patterns/{symbol}?limit=90

純手寫辨識，不依賴 ta-lib，輕量部署（Render 免費方案友善）。

辨識型態：
  1.  Doji              十字星       — 實體 < 10% 振幅
  2.  Hammer            錘頭         — 下影長，多頭底部反轉
  3.  Hanging Man       上吊線       — 錘頭形但出現在上升趨勢，空頭警告
  4.  Inverted Hammer   倒錘頭       — 上影長，多頭底部反轉
  5.  Shooting Star     流星         — 上影長，空頭頂部反轉
  6.  Bullish Engulfing 看漲吞噬     — 陽線實體完全吞噬前一陰線
  7.  Bearish Engulfing 看跌吞噬     — 陰線實體完全吞噬前一陽線
  8.  Morning Star      啟明星       — 三K多頭反轉（大陰→小體→大陽）
  9.  Evening Star      黃昏之星     — 三K空頭反轉（大陽→小體→大陰）
  10. Three White Soldiers 三白兵    — 三連陽，多頭強勢
  11. Three Black Crows   三黑鴉     — 三連陰，空頭強勢
  12. Gap Up             向上跳空    — 開盤高於前K最高
  13. Gap Down           向下跳空    — 開盤低於前K最低

快取 TTL：300 秒（5 分鐘）
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

# ── helpers ───────────────────────────────────────────────────────────────────

def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    if s.isdigit():
        return f"{s}.TW"
    return s


def _is_uptrend(closes: list[float], n: int = 5) -> bool:
    """簡易趨勢判斷：近 n 日收盤呈上升"""
    if len(closes) < n:
        return False
    seg = closes[-n:]
    return seg[-1] > seg[0]


def _is_downtrend(closes: list[float], n: int = 5) -> bool:
    if len(closes) < n:
        return False
    seg = closes[-n:]
    return seg[-1] < seg[0]


def _body(o: float, c: float) -> float:
    return abs(c - o)


def _range(h: float, l: float) -> float:
    return h - l


# ── 型態辨識函數 ───────────────────────────────────────────────────────────────

def _detect(bars: list[dict]) -> list[dict]:
    """
    bars: list of { date, open, high, low, close }，已按日期升序
    回傳 [ { date, name, label, direction, description } ]
    """
    patterns: list[dict] = []

    n = len(bars)
    closes = [b["close"] for b in bars]

    for i in range(2, n):   # 需要至少 3 根 K 線（i-2, i-1, i）
        b0 = bars[i - 2]    # day -2
        b1 = bars[i - 1]    # day -1
        b  = bars[i]        # day 0（今天）

        o, h, l, c = b["open"], b["high"], b["low"], b["close"]
        o1, h1, l1, c1 = b1["open"], b1["high"], b1["low"], b1["close"]
        o0, h0, l0, c0 = b0["open"], b0["high"], b0["low"], b0["close"]

        body  = _body(o, c)
        rng   = _range(h, l)
        up_w  = h - max(o, c)    # 上影線
        dn_w  = min(o, c) - l    # 下影線
        bull  = c > o
        bear  = c < o

        body1 = _body(o1, c1)
        rng1  = _range(h1, l1)
        bull1 = c1 > o1
        bear1 = c1 < o1

        body0 = _body(o0, c0)
        bull0 = c0 > o0
        bear0 = c0 < o0

        hist_closes = closes[:i]   # 今天以前的收盤

        date = b["date"]

        # ── 1. Doji（十字星） ─────────────────────────────────────────────────
        if rng > 0 and body < 0.08 * rng:
            patterns.append({
                "date":        date,
                "name":        "doji",
                "label":       "十字星",
                "direction":   "neutral",
                "description": "開盤與收盤幾乎相同，市場猶豫不決，可能出現反轉",
            })
            continue   # 同一天不再疊加其他單 K 型態

        if rng == 0:
            continue

        # ── 2/3. Hammer（錘頭）/ Hanging Man（上吊線） ────────────────────────
        # 形態：實體小 + 下影 ≥ 2×實體 + 上影 ≤ 0.5×實體
        if (body > 0
                and body < 0.35 * rng
                and dn_w >= 2.0 * body
                and up_w <= 0.5 * body):

            if _is_downtrend(hist_closes):
                patterns.append({
                    "date":        date,
                    "name":        "hammer",
                    "label":       "錘頭",
                    "direction":   "bullish",
                    "description": "下影線長，實體小，出現在下降趨勢末端，看漲反轉信號",
                })
            elif _is_uptrend(hist_closes):
                patterns.append({
                    "date":        date,
                    "name":        "hanging_man",
                    "label":       "上吊線",
                    "direction":   "bearish",
                    "description": "與錘頭形態相同，但出現在上升趨勢中，看跌警告信號",
                })
            continue

        # ── 4/5. Inverted Hammer（倒錘頭）/ Shooting Star（流星） ─────────────
        # 形態：實體小 + 上影 ≥ 2×實體 + 下影 ≤ 0.5×實體
        if (body > 0
                and body < 0.35 * rng
                and up_w >= 2.0 * body
                and dn_w <= 0.5 * body):

            if _is_downtrend(hist_closes):
                patterns.append({
                    "date":        date,
                    "name":        "inverted_hammer",
                    "label":       "倒錘頭",
                    "direction":   "bullish",
                    "description": "上影線長，出現在下降趨勢末端，看漲反轉信號",
                })
            elif _is_uptrend(hist_closes):
                patterns.append({
                    "date":        date,
                    "name":        "shooting_star",
                    "label":       "流星",
                    "direction":   "bearish",
                    "description": "上影線長，出現在上升趨勢頂端，看跌反轉信號",
                })
            continue

        # ── 6/7. Engulfing（吞噬） ────────────────────────────────────────────
        if body1 > 0 and body > 0:

            # 看漲吞噬
            if (bear1
                    and bull
                    and o <= c1        # 今日開 ≤ 昨日收（陰）
                    and c >= o1        # 今日收 ≥ 昨日開（陰）
                    and body > body1):
                patterns.append({
                    "date":        date,
                    "name":        "bullish_engulfing",
                    "label":       "看漲吞噬",
                    "direction":   "bullish",
                    "description": "陽線實體完全吞噬前一陰線，強力看漲反轉信號",
                })
                continue

            # 看跌吞噬
            if (bull1
                    and bear
                    and o >= c1        # 今日開 ≥ 昨日收（陽）
                    and c <= o1        # 今日收 ≤ 昨日開（陽）
                    and body > body1):
                patterns.append({
                    "date":        date,
                    "name":        "bearish_engulfing",
                    "label":       "看跌吞噬",
                    "direction":   "bearish",
                    "description": "陰線實體完全吞噬前一陽線，強力看跌反轉信號",
                })
                continue

        # ── 8. Morning Star（啟明星）── 三K，當天是第三K ─────────────────────
        if i >= 3:
            b_2 = bars[i - 2]
            b_3 = bars[i - 3]
            o3, h3, l3, c3 = b_3["open"], b_3["high"], b_3["low"], b_3["close"]
            o2, h2, l2, c2 = b_2["open"], b_2["high"], b_2["low"], b_2["close"]
            body3 = _body(o3, c3)
            body2 = _body(o2, c2)

            if (c3 < o3                         # day -3: 陰線（大）
                    and body3 > 0
                    and body2 < 0.5 * body3     # day -2: 小實體（星）
                    and bull                     # day -1 (today): 陽線
                    and c > (o3 + c3) / 2       # 收盤收復 day -3 一半以上
                    and body > 0.5 * body3):
                patterns.append({
                    "date":        date,
                    "name":        "morning_star",
                    "label":       "啟明星",
                    "direction":   "bullish",
                    "description": "三K底部反轉型態（大陰→小體→大陽），強力看漲信號",
                })
                continue

        # ── 9. Evening Star（黃昏之星） ──────────────────────────────────────
        if i >= 3:
            b_2 = bars[i - 2]
            b_3 = bars[i - 3]
            o3, h3, l3, c3 = b_3["open"], b_3["high"], b_3["low"], b_3["close"]
            o2, h2, l2, c2 = b_2["open"], b_2["high"], b_2["low"], b_2["close"]
            body3 = _body(o3, c3)
            body2 = _body(o2, c2)

            if (c3 > o3                          # day -3: 陽線（大）
                    and body3 > 0
                    and body2 < 0.5 * body3      # day -2: 小實體（星）
                    and bear                      # today: 陰線
                    and c < (o3 + c3) / 2        # 收盤跌破 day -3 一半
                    and body > 0.5 * body3):
                patterns.append({
                    "date":        date,
                    "name":        "evening_star",
                    "label":       "黃昏之星",
                    "direction":   "bearish",
                    "description": "三K頂部反轉型態（大陽→小體→大陰），強力看跌信號",
                })
                continue

        # ── 10. Three White Soldiers（三白兵） ───────────────────────────────
        if (bull and bull1 and bull0
                and o > o1 and o1 > o0           # 每根開盤漸高
                and c > c1 and c1 > c0           # 每根收盤漸高
                and body > 0 and body1 > 0 and body0 > 0
                and (h - c) < 0.25 * body        # 今日上影短（近最高收盤）
                and (h1 - c1) < 0.25 * body1
                and (h0 - c0) < 0.25 * body0):
            patterns.append({
                "date":        date,
                "name":        "three_white_soldiers",
                "label":       "三白兵",
                "direction":   "bullish",
                "description": "三根連續陽線，每根開盤於前K實體內、收盤創新高，強勢多頭信號",
            })
            continue

        # ── 11. Three Black Crows（三黑鴉） ─────────────────────────────────
        if (bear and bear1 and bear0
                and o < o1 and o1 < o0           # 每根開盤漸低
                and c < c1 and c1 < c0           # 每根收盤漸低
                and body > 0 and body1 > 0 and body0 > 0
                and (c - l) < 0.25 * body        # 今日下影短（近最低收盤）
                and (c1 - l1) < 0.25 * body1
                and (c0 - l0) < 0.25 * body0):
            patterns.append({
                "date":        date,
                "name":        "three_black_crows",
                "label":       "三黑鴉",
                "direction":   "bearish",
                "description": "三根連續陰線，每根開盤於前K實體內、收盤創新低，強勢空頭信號",
            })
            continue

        # ── 12/13. Gap（跳空缺口） ────────────────────────────────────────────
        if o > h1:   # 向上跳空
            patterns.append({
                "date":        date,
                "name":        "gap_up",
                "label":       "向上跳空",
                "direction":   "bullish",
                "description": f"開盤 {o:.1f} 高於昨高 {h1:.1f}，缺口 {o - h1:.1f} 點，動能強勁",
            })
        elif o < l1:  # 向下跳空
            patterns.append({
                "date":        date,
                "name":        "gap_down",
                "label":       "向下跳空",
                "direction":   "bearish",
                "description": f"開盤 {o:.1f} 低於昨低 {l1:.1f}，缺口 {l1 - o:.1f} 點，拋壓沉重",
            })

    return patterns


# ── 主要抓取函數 ───────────────────────────────────────────────────────────────

@ttl_cache(ttl=300)
def _compute_patterns_sync(symbol: str, limit: int) -> dict[str, Any]:
    try:
        import yfinance as yf
        import pandas as pd

        yf_sym = _yf_symbol(symbol)
        # 多抓一些以確保最後 limit 天有足夠的前置 K 線
        extra   = limit + 30
        df = yf.download(yf_sym, period="2y", auto_adjust=True, progress=False, threads=False)

        if df.empty:
            return {"symbol": symbol, "patterns": []}

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.columns = [c.lower() for c in df.columns]
        df = df[["open", "high", "low", "close"]].dropna()

        # 取最後 extra 根
        df = df.tail(extra).reset_index()
        bars: list[dict] = []
        for _, row in df.iterrows():
            dt = row["Date"] if "Date" in row else row.index
            dt_str = pd.to_datetime(dt).strftime("%Y-%m-%d") if not isinstance(dt, str) else dt
            bars.append({
                "date":  dt_str,
                "open":  float(row["open"]),
                "high":  float(row["high"]),
                "low":   float(row["low"]),
                "close": float(row["close"]),
            })

        all_patterns = _detect(bars)

        # 只回傳最後 limit 天範圍內的型態
        if bars:
            cutoff = bars[-limit]["date"] if len(bars) >= limit else bars[0]["date"]
            filtered = [p for p in all_patterns if p["date"] >= cutoff]
        else:
            filtered = all_patterns

        return {
            "symbol":   symbol,
            "patterns": filtered,
        }

    except Exception as exc:
        logger.warning("[patterns] %s failed: %s", symbol, exc)
        return {"symbol": symbol, "patterns": []}


# ── 端點 ─────────────────────────────────────────────────────────────────────

@router.get("/patterns/{symbol}")
@limiter.limit("20/minute")
async def get_patterns(
    request: Request,
    symbol:  str,
    limit:   int = Query(default=90, ge=20, le=250),
):
    """
    K 線型態辨識
    GET /api/v1/patterns/2330        ← 台股
    GET /api/v1/patterns/AAPL        ← 美股
    GET /api/v1/patterns/2330?limit=60
    """
    sym  = validate_symbol(symbol)
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _compute_patterns_sync, sym, limit)
    return data
