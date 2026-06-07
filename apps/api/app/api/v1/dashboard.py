"""
個人化首頁儀錶板 — 批次摘要 API

GET /api/v1/dashboard/summary?symbols=2330,2317,0050
Headers: X-User-ID (optional, 用於評估自訂警示規則)

對每支自選股，平行回傳：
  quote     : 現價、漲跌幅、量比
  signals   : 8 種預設信號 + 用戶自訂規則
  upcoming  : 7 日內除息日 / 財報公布日

預設 8 種信號：
  1. foreign_buying  外資連買 ≥ 3 日
  2. trust_buying    投信連買 ≥ 3 日
  3. ma20_breakout   突破 MA20
  4. rsi_oversold    RSI < 30
  5. rsi_overbought  RSI > 70
  6. high_volume     成交量 > 2x 均量
  7. exdiv_soon      7 日內除息
  8. earnings_soon   7 日內財報
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from app.core.rate_limit import limiter
from app.core.validators import validate_symbols, validate_symbol, require_user
from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── yfinance helper ─────────────────────────────────────────────────────────

def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    return f"{s}.TW" if s.isdigit() else s


# ─── 從 screener cache 拿到指標（有則用，否則用 yfinance 計算）─────────────────

def _get_metrics_from_cache(symbol: str) -> dict | None:
    """嘗試從 screener_service 快取讀取指標（不觸發刷新）"""
    try:
        from app.services.screener_service import _metrics
        return _metrics.get(symbol)
    except Exception:
        return None


@ttl_cache(ttl=900)   # 15 分鐘
def _compute_metrics_yf(symbol: str) -> dict | None:
    """對不在 screener 股票池的股票用 yfinance 即時計算技術指標"""
    try:
        import yfinance as yf

        yf_sym = _yf_symbol(symbol)
        hist = yf.Ticker(yf_sym).history(period="6mo")
        if hist is None or len(hist) < 5:
            return None

        closes  = hist["Close"].tolist()
        highs   = hist["High"].tolist()
        lows    = hist["Low"].tolist()
        volumes = hist["Volume"].tolist()

        # ── 基礎函式 ───────────────────────────────────────────────────────
        def _rsi(cls: list[float], period: int = 14) -> float:
            if len(cls) < period + 1:
                return 50.0
            deltas = [cls[i] - cls[i - 1] for i in range(1, len(cls))]
            gains  = [max(d, 0.0) for d in deltas]
            losses = [abs(min(d, 0.0)) for d in deltas]
            ag = sum(gains[:period]) / period
            al = sum(losses[:period]) / period
            for i in range(period, len(deltas)):
                ag = (ag * (period - 1) + gains[i]) / period
                al = (al * (period - 1) + losses[i]) / period
            return round(100.0 - 100.0 / (1.0 + ag / al), 2) if al else 100.0

        def _ma(cls: list[float], n: int) -> float | None:
            if len(cls) < n:
                return None
            return sum(cls[-n:]) / n

        def _ema(data: list[float], period: int) -> float:
            if not data:
                return 0.0
            k = 2.0 / (period + 1)
            ema = data[0]
            for p in data[1:]:
                ema = p * k + ema * (1 - k)
            return ema

        def _vol_ratio(vols: list, n: int = 20) -> float:
            if len(vols) < 2:
                return 1.0
            hist_v = vols[-(n + 1):-1]
            avg = sum(hist_v) / len(hist_v) if hist_v else 0
            return round(vols[-1] / avg, 2) if avg > 0 else 1.0

        price    = closes[-1]
        prev     = closes[-2] if len(closes) >= 2 else price

        # ── MA ────────────────────────────────────────────────────────────
        ma5  = _ma(closes, 5)
        ma20 = _ma(closes, 20)
        ma60 = _ma(closes, 60)

        ma20prev = _ma(closes[:-1], 20)
        above_ma20 = (price > ma20)     if ma20     else False
        above_ma5  = (price > ma5)      if ma5      else False
        above_ma60 = (price > ma60)     if ma60     else False
        ma20_breakout = (
            price > ma20 and prev <= ma20prev
            if (ma20 and ma20prev) else False
        )

        # ── Stochastic K（14 日）────────────────────────────────────────
        def _stoch_k(h: list, l: list, c: list, period: int = 14) -> float:
            if len(c) < period:
                return 50.0
            rh = max(h[-period:])
            rl = min(l[-period:])
            if rh == rl:
                return 50.0
            return round((c[-1] - rl) / (rh - rl) * 100, 2)

        stoch_k = _stoch_k(highs, lows, closes)

        # ── MACD 柱狀圖（12-26-9）────────────────────────────────────────
        def _macd_hist(cls: list[float]) -> float:
            if len(cls) < 35:
                return 0.0
            window = cls[-60:] if len(cls) >= 60 else cls
            ema12 = _ema(window, 12)
            ema26 = _ema(window, 26)
            macd_line = ema12 - ema26
            # 簡化 signal line = EMA9 of last 9 days' ema12-ema26
            recent_macd = [
                _ema(window[: max(1, len(window) - i)], 12) - _ema(window[: max(1, len(window) - i)], 26)
                for i in range(8, -1, -1)
            ]
            signal = _ema(recent_macd, 9)
            return round(macd_line - signal, 4)

        macd_hist = _macd_hist(closes)

        return {
            "symbol":        symbol,
            "price":         round(price, 2),
            "change_pct":    round((price - prev) / prev * 100, 2) if prev else 0.0,
            "rsi14":         _rsi(closes),
            "vol_ratio":     _vol_ratio(volumes),
            # MA 多空
            "above_ma20":    above_ma20,
            "ma20_breakout": ma20_breakout,
            "above_ma5":     above_ma5,
            "above_ma60":    above_ma60,
            # KD / MACD
            "stoch_k":       stoch_k,
            "macd_hist":     macd_hist,
            # 籌碼（非 screener 來源，預設 0）
            "foreign_streak": {"days": 0, "direction": "flat"},
            "trust_streak":   {"days": 0, "direction": "flat"},
        }
    except Exception as exc:
        logger.warning("dashboard: yf metrics fail %s: %s", symbol, exc)
        return None


def _get_metrics(symbol: str) -> dict | None:
    m = _get_metrics_from_cache(symbol)
    if m:
        return m
    return _compute_metrics_yf(symbol)


# ─── 即將到來的日期 ────────────────────────────────────────────────────────────

@ttl_cache(ttl=3600)   # 1 小時
def _fetch_upcoming_dates(symbol: str) -> list[dict]:
    """撈取 7 日內除息日 / 財報公布日"""
    events: list[dict] = []
    today = date.today()
    cutoff = today + timedelta(days=7)

    try:
        import yfinance as yf
        ticker = yf.Ticker(_yf_symbol(symbol))

        # ── 除息日 ─────────────────────────────────────────────────────────────
        try:
            divs = ticker.dividends
            if divs is not None and not divs.empty:
                for ts, amount in divs.items():
                    d = ts.date() if hasattr(ts, "date") else ts
                    if today <= d <= cutoff:
                        events.append({
                            "type":       "exdiv",
                            "label":      "除息日",
                            "date":       d.isoformat(),
                            "days_until": (d - today).days,
                            "value":      round(float(amount), 2),
                        })
        except Exception:
            pass

        # ── 財報公布日 ─────────────────────────────────────────────────────────
        try:
            ed = ticker.earnings_dates
            if ed is not None and not ed.empty:
                for ts in ed.index:
                    d = ts.date() if hasattr(ts, "date") else ts
                    if today <= d <= cutoff:
                        events.append({
                            "type":       "earnings",
                            "label":      "財報公布",
                            "date":       d.isoformat(),
                            "days_until": (d - today).days,
                        })
        except Exception:
            pass

    except Exception as exc:
        logger.warning("dashboard: upcoming dates fail %s: %s", symbol, exc)

    return events


# ─── 信號評估 ─────────────────────────────────────────────────────────────────

def _evaluate_preset_signals(metrics: dict, upcoming: list[dict]) -> list[dict]:
    """評估 8 種預設信號，回傳觸發的信號列表"""
    signals: list[dict] = []

    rsi       = metrics.get("rsi14", 50)
    vol_ratio = metrics.get("vol_ratio", 1.0)
    f_streak  = metrics.get("foreign_streak", {})
    t_streak  = metrics.get("trust_streak", {})

    # 1. 外資連買 ≥ 3
    if f_streak.get("direction") == "buy" and f_streak.get("days", 0) >= 3:
        signals.append({
            "id":       "foreign_buying",
            "label":    f"外資連買 {f_streak['days']} 日",
            "severity": "positive",
            "group":    "chips",
        })

    # 2. 投信連買 ≥ 3
    if t_streak.get("direction") == "buy" and t_streak.get("days", 0) >= 3:
        signals.append({
            "id":       "trust_buying",
            "label":    f"投信連買 {t_streak['days']} 日",
            "severity": "positive",
            "group":    "chips",
        })

    # 3. MA20 突破
    if metrics.get("ma20_breakout"):
        signals.append({
            "id":       "ma20_breakout",
            "label":    "突破 MA20",
            "severity": "positive",
            "group":    "technical",
        })

    # 4. RSI 超賣
    if rsi < 30:
        signals.append({
            "id":       "rsi_oversold",
            "label":    f"RSI {rsi:.1f} 超賣",
            "severity": "positive",
            "group":    "technical",
        })

    # 5. RSI 超買
    if rsi > 70:
        signals.append({
            "id":       "rsi_overbought",
            "label":    f"RSI {rsi:.1f} 超買",
            "severity": "warning",
            "group":    "technical",
        })

    # 6. 爆量
    if vol_ratio >= 2.0:
        signals.append({
            "id":       "high_volume",
            "label":    f"爆量 {vol_ratio:.1f}x",
            "severity": "info",
            "group":    "technical",
        })

    # 7 & 8. 來自 upcoming_dates
    for ev in upcoming:
        if ev["type"] == "exdiv":
            signals.append({
                "id":       "exdiv_soon",
                "label":    f"除息日 {ev['days_until']} 日後（${ev.get('value', '')}）",
                "severity": "info",
                "group":    "calendar",
                "date":     ev["date"],
            })
        elif ev["type"] == "earnings":
            signals.append({
                "id":       "earnings_soon",
                "label":    f"財報公布 {ev['days_until']} 日後",
                "severity": "info",
                "group":    "calendar",
                "date":     ev["date"],
            })

    return signals


def _evaluate_custom_rules(metrics: dict, rules: list[dict]) -> list[dict]:
    """評估用戶自訂警示規則，回傳觸發的規則列表"""
    triggered: list[dict] = []

    # 可用欄位對應
    def _field_value(field: str) -> float | None:
        # ── 基本技術 ──────────────────────────────────────────────────────
        if field == "rsi14":         return metrics.get("rsi14")
        if field == "vol_ratio":     return metrics.get("vol_ratio")
        if field == "change_pct":    return metrics.get("change_pct")
        if field == "ma20_breakout": return 1.0 if metrics.get("ma20_breakout") else 0.0
        if field == "above_ma20":    return 1.0 if metrics.get("above_ma20")    else 0.0
        # ── 移動平均 ──────────────────────────────────────────────────────
        if field == "above_ma5":     return 1.0 if metrics.get("above_ma5")     else 0.0
        if field == "above_ma60":    return 1.0 if metrics.get("above_ma60")    else 0.0
        # ── KD / MACD ─────────────────────────────────────────────────────
        if field == "stoch_k":       return metrics.get("stoch_k")
        if field == "macd_hist":     return metrics.get("macd_hist")
        # ── 籌碼連買 ──────────────────────────────────────────────────────
        if field == "foreign_streak_days":
            fs = metrics.get("foreign_streak", {})
            return float(fs.get("days", 0)) if fs.get("direction") == "buy" else 0.0
        if field == "trust_streak_days":
            ts = metrics.get("trust_streak", {})
            return float(ts.get("days", 0)) if ts.get("direction") == "buy" else 0.0
        # ── 籌碼連賣 ──────────────────────────────────────────────────────
        if field == "foreign_sell_days":
            fs = metrics.get("foreign_streak", {})
            return float(fs.get("days", 0)) if fs.get("direction") == "sell" else 0.0
        if field == "trust_sell_days":
            ts = metrics.get("trust_streak", {})
            return float(ts.get("days", 0)) if ts.get("direction") == "sell" else 0.0
        return None

    def _eval_cond(cond: dict) -> bool:
        v = _field_value(cond.get("field", ""))
        if v is None:
            return False
        thresh = float(cond.get("value", 0))
        op = cond.get("operator", ">")
        if op == ">":  return v > thresh
        if op == "<":  return v < thresh
        if op == ">=": return v >= thresh
        if op == "<=": return v <= thresh
        if op in ("=", "=="):  return abs(v - thresh) < 1e-9
        return False

    for rule in rules:
        if not rule.get("is_active", True):
            continue
        conditions = rule.get("conditions", [])
        if not conditions:
            continue
        logic = rule.get("logic", "AND").upper()
        results = [_eval_cond(c) for c in conditions]
        fired = all(results) if logic == "AND" else any(results)
        if fired:
            triggered.append({
                "id":       f"custom_{rule['id']}",
                "label":    rule.get("name", "自訂條件"),
                "severity": "custom",
                "group":    "custom",
            })

    return triggered


# ─── 單檔摘要 ─────────────────────────────────────────────────────────────────

def _summary_sync(symbol: str, user_rules: list[dict]) -> dict:
    metrics  = _get_metrics(symbol)
    upcoming = _fetch_upcoming_dates(symbol)
    signals  = []

    if metrics:
        signals += _evaluate_preset_signals(metrics, upcoming)
        if user_rules:
            signals += _evaluate_custom_rules(metrics, user_rules)

    quote_snapshot = {}
    if metrics:
        quote_snapshot = {
            "price":      metrics.get("price", 0),
            "change_pct": metrics.get("change_pct", 0),
            "vol_ratio":  metrics.get("vol_ratio", 1.0),
            "rsi14":      metrics.get("rsi14", 50),
            "name":       metrics.get("name", symbol),
        }

    return {
        "symbol":         symbol,
        "quote":          quote_snapshot,
        "signals":        signals,
        "signal_count":   len(signals),
        "upcoming_dates": upcoming,
        "has_alert":      len(signals) > 0,
    }


# ─── 端點 ─────────────────────────────────────────────────────────────────────

@router.get("/dashboard/summary")
@limiter.limit("30/minute")
async def get_dashboard_summary(
    request:    Request,
    symbols:    str,
    x_user_id: Optional[str] = Header(default=None),
):
    """
    批次取得自選股儀錶板摘要
    GET /api/v1/dashboard/summary?symbols=2330,2317,0050
    """
    raw = [s.strip() for s in symbols.split(",") if s.strip()]
    if not raw:
        raise HTTPException(400, "No symbols provided")
    if len(raw) > 30:
        raise HTTPException(400, "Max 30 symbols per request")

    symbol_list = validate_symbols(raw)

    # 取得用戶自訂規則
    user_rules: list[dict] = []
    if x_user_id:
        try:
            uid = require_user(x_user_id)
            from app.api.v1.alert_rules import _get_user_rules
            user_rules = _get_user_rules(uid)
        except Exception:
            pass   # 無效 user_id 或查詢失敗 → 跳過自訂規則

    loop = asyncio.get_event_loop()

    async def _fetch(sym: str) -> dict:
        return await loop.run_in_executor(None, _summary_sync, sym, user_rules)

    results = await asyncio.gather(*[_fetch(s) for s in symbol_list])

    data = {r["symbol"]: r for r in results}

    return {
        "symbols":    symbol_list,
        "data":       data,
        "updated_at": time.time(),
    }


# ─── AI 每日自選股摘要 ────────────────────────────────────────────────────────

class AiWatchlistSummaryRequest(BaseModel):
    symbols: list[str] = Field(..., min_length=1, max_length=30)


@ttl_cache(ttl=1800)   # 30 minutes
def _ai_watchlist_summary_sync(symbols_key: str) -> dict:
    """
    對自選股組合用 Gemini 生成整體市場洞察與操作建議。
    symbols_key：逗號分隔的股票代號（已排序，用於快取）
    """
    import yfinance as yf
    import pandas as pd
    from app.core.config import settings  # type: ignore

    symbols = [s.strip() for s in symbols_key.split(",")]

    stock_lines: list[str] = []
    for sym in symbols[:20]:   # 最多 20 支避免 token 過多
        yf_sym = f"{sym}.TW" if sym.isdigit() else sym
        try:
            df = yf.download(yf_sym, period="5d", auto_adjust=True, progress=False, threads=False)
            if df.empty:
                continue
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df.columns = [c.lower() for c in df.columns]
            close   = df["close"].dropna()
            if len(close) < 2:
                continue
            price   = float(close.iloc[-1])
            prev_p  = float(close.iloc[-2])
            chg_pct = (price - prev_p) / prev_p * 100 if prev_p > 0 else 0.0
            w_chg   = (price / float(close.iloc[0]) - 1) * 100 if float(close.iloc[0]) > 0 else 0.0
            stock_lines.append(
                f"{sym}：{price:.0f} 元 今日 {chg_pct:+.1f}% 週漲跌 {w_chg:+.1f}%"
            )
        except Exception:
            continue

    if not stock_lines:
        return {"summary": "無法取得自選股資料，請稍後再試。", "symbols": symbols}

    data_str = "\n".join(stock_lines)

    fallback = (
        f"您的自選股今日表現：\n{data_str}\n\n"
        "以上數據僅供參考，不構成投資建議。"
    )

    text: str = fallback
    if settings.gemini_api_key:
        try:
            import google.generativeai as genai  # type: ignore
            genai.configure(api_key=settings.gemini_api_key)
            model  = genai.GenerativeModel("gemini-1.5-flash")
            prompt = (
                f"你是專業的台股投資分析師，請根據以下用戶自選股今日表現，"
                f"用繁體中文（150-200 字）撰寫整體市場洞察，涵蓋：\n"
                f"① 整體漲跌氛圍（多頭/空頭/分歧）\n"
                f"② 值得關注的個股（表現最強/最弱）\n"
                f"③ 短線操作提示\n"
                f"語氣像是每日早報簡報，專業但易懂。"
                f"結尾加「以上分析僅供參考，不構成投資建議。」\n\n"
                f"自選股資料：\n{data_str}\n\n"
                f"直接輸出分析段落："
            )
            resp = model.generate_content(prompt)
            t    = resp.text.strip()
            if t:
                text = t
        except Exception as exc:
            logger.warning("Gemini watchlist summary failed: %s", exc)

    return {
        "summary":     text,
        "symbols":     symbols,
        "stock_data":  stock_lines,
    }


@router.post("/dashboard/ai-summary")
@limiter.limit("5/minute")
async def get_ai_watchlist_summary(
    request:   Request,
    body:      AiWatchlistSummaryRequest,
    x_user_id: Optional[str] = Header(default=None),
):
    """
    AI 每日自選股整體摘要（按鈕觸發，30 分鐘快取）
    POST /api/v1/dashboard/ai-summary
    Body: {"symbols": ["2330", "2317", "0050"]}
    """
    validated: list[str] = []
    for s in body.symbols[:20]:
        try:
            validated.append(validate_symbol(s.strip()))
        except Exception:
            pass

    if not validated:
        raise HTTPException(status_code=400, detail="沒有有效的股票代號")

    symbols_key = ",".join(sorted(set(validated)))   # 排序去重，穩定快取 key
    loop        = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _ai_watchlist_summary_sync, symbols_key)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"無法生成 AI 摘要：{exc}")
    return data
