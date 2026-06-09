"""
統一的多源 priority chain 工廠

每個 fetch_* 函數會自動跑「主力 → 備援 → 保底」三層，直到取到資料或全部失敗。
詳細順序見 docs/TIER-CACHE-REFACTOR.md。

對 API endpoint 來說只需呼叫這裡的函數，不需要關心後面挑哪個來源。
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from app.core.supabase_client import get_supabase

logger = logging.getLogger(__name__)


def _is_tw_symbol(s: str) -> bool:
    return s[:4].isdigit() if len(s) >= 4 else s.isdigit()


# ─────────────────────────────────────────────────────────────
# 日 K 線：Supabase → YF直連 → TWSE → FinMind
# ─────────────────────────────────────────────────────────────

async def fetch_kline(symbol: str, start: date, end: date) -> list[dict]:
    """日 K 線，回傳 [{date, open, high, low, close, volume}]"""
    # 1. Supabase Tier1
    db = get_supabase()
    if db is not None:
        try:
            resp = (
                db.table("kline_daily")
                .select("date, open, high, low, close, volume")
                .eq("symbol", symbol)
                .gte("date", start.isoformat())
                .lte("date", end.isoformat())
                .order("date", desc=False)
                .execute()
            )
            rows = resp.data or []
            if rows:
                return [
                    {
                        "date":   r["date"],
                        "open":   float(r["open"])  if r.get("open")  is not None else None,
                        "high":   float(r["high"])  if r.get("high")  is not None else None,
                        "low":    float(r["low"])   if r.get("low")   is not None else None,
                        "close":  float(r["close"]) if r.get("close") is not None else None,
                        "volume": int(r["volume"] or 0),
                    }
                    for r in rows
                ]
        except Exception as e:
            logger.warning("[sources.kline] supabase %s failed: %s", symbol, e)

    # 2. YF 直連 httpx
    try:
        from app.services.yf_direct import fetch_kline as yf_fetch
        rows = await yf_fetch(symbol, start, end)
        if rows:
            return rows
    except Exception as e:
        logger.debug("[sources.kline] yf_direct %s failed: %s", symbol, e)

    # 3. FinMind（最終保底，台股 only）
    if _is_tw_symbol(symbol):
        try:
            from app.services.finmind_service import fetch_daily_kline as fm_fetch
            rows = await fm_fetch(symbol, start=start, end=end)
            if rows:
                return rows
        except Exception as e:
            logger.debug("[sources.kline] finmind %s failed: %s", symbol, e)

    return []


# ─────────────────────────────────────────────────────────────
# 籌碼：Supabase → T86 bulk → FinMind
# ─────────────────────────────────────────────────────────────

async def fetch_chips(symbol: str, days: int = 60) -> list[dict]:
    """
    三大法人 N 天資料。
    回傳 [{date, foreign_buy/sell, trust_buy/sell, dealer_buy/sell}]
    （注意 T86 給的是淨額，無 buy/sell 分開；為相容性我們把 net 放 buy、0 放 sell）
    """
    end = date.today()
    start = end - timedelta(days=days)

    # 1. Supabase
    db = get_supabase()
    if db is not None:
        try:
            resp = (
                db.table("chips_daily")
                .select("date, foreign_buy, foreign_sell, trust_buy, trust_sell, dealer_buy, dealer_sell")
                .eq("symbol", symbol)
                .gte("date", start.isoformat())
                .lte("date", end.isoformat())
                .order("date", desc=False)
                .execute()
            )
            rows = resp.data or []
            if rows:
                return rows
        except Exception as e:
            logger.warning("[sources.chips] supabase %s failed: %s", symbol, e)

    # 2. T86 逐日（最近 N 個交易日）→ 較重，只回 ~10 天
    if _is_tw_symbol(symbol):
        try:
            from app.services.twse_service import fetch_t86_for_date
            out: list[dict] = []
            d = end
            collected = 0
            limit_days = min(days, 10)  # T86 逐日成本高，限 10 天
            while collected < limit_days and d > start:
                if d.weekday() < 5:
                    daily = await fetch_t86_for_date(d)
                    rec = daily.get(symbol)
                    if rec:
                        out.append({
                            "date":         d.isoformat(),
                            "foreign_buy":  max(rec["foreign_net"], 0),
                            "foreign_sell": max(-rec["foreign_net"], 0),
                            "trust_buy":    max(rec["trust_net"], 0),
                            "trust_sell":   max(-rec["trust_net"], 0),
                            "dealer_buy":   max(rec["dealer_net"], 0),
                            "dealer_sell":  max(-rec["dealer_net"], 0),
                        })
                        collected += 1
                d -= timedelta(days=1)
            if out:
                out.sort(key=lambda x: x["date"])
                return out
        except Exception as e:
            logger.debug("[sources.chips] t86 %s failed: %s", symbol, e)

    # 3. FinMind
    if _is_tw_symbol(symbol):
        try:
            from app.services.finmind_service import fetch_institutional
            from app.api.v1.chips import _aggregate_finmind_chips  # 重用既有 aggregator
            raw = await fetch_institutional(symbol, start=start, end=end)
            if raw:
                by_date = _aggregate_finmind_chips(raw)
                return [
                    {"date": d, **v} for d, v in sorted(by_date.items())
                ]
        except Exception as e:
            logger.debug("[sources.chips] finmind %s failed: %s", symbol, e)

    return []


# ─────────────────────────────────────────────────────────────
# 指數：TWSE MIS（TWII only）→ YF直連 → yfinance lib
# ─────────────────────────────────────────────────────────────

async def fetch_index(ticker: str) -> dict | None:
    """指數即時報價"""
    # TWII：TWSE MIS 最即時
    if ticker in ("^TWII", "TWII", "tse_t00.tw"):
        try:
            from app.services.twse_service import fetch_taiex_quote
            q = await fetch_taiex_quote()
            if q:
                return q
        except Exception as e:
            logger.debug("[sources.index] taiex failed: %s", e)

    # YF 直連
    try:
        from app.services.yf_direct import fetch_index_quote
        q = await fetch_index_quote(ticker)
        if q:
            return q
    except Exception as e:
        logger.debug("[sources.index] yf_direct %s failed: %s", ticker, e)

    # yfinance lib（最終保底）
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.fast_info
        price = info.get("last_price") if hasattr(info, "get") else getattr(info, "last_price", None)
        prev  = info.get("previous_close") if hasattr(info, "get") else getattr(info, "previous_close", None)
        if price is not None and prev is not None:
            return {
                "price":      float(price),
                "prev":       float(prev),
                "change":     round(float(price) - float(prev), 2),
                "change_pct": round((float(price) - float(prev)) / float(prev) * 100, 2) if prev else None,
            }
    except Exception as e:
        logger.debug("[sources.index] yfinance %s failed: %s", ticker, e)

    return None
