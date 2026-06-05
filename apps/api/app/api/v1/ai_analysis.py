"""
AI 技術分析解讀 API

GET /api/v1/ai-analysis/{symbol}

結合 RSI / MACD / MA 排列 / 成交量 / 法人籌碼，
呼叫 Gemini 生成 150-180 字繁體中文技術分析段落。
快取 TTL：15 分鐘（盤中多次點擊不重複消耗 API quota）
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


@ttl_cache(ttl=900)   # 15 minutes
def _generate_analysis_sync(symbol: str) -> dict[str, Any]:
    """
    1. 從 yfinance 取近 3 個月日 K，計算 RSI / MACD / MA / 量比
    2. 嘗試從 screener 快取取法人籌碼
    3. 呼叫 Gemini 生成分析；Gemini 失敗時回退規則文字
    """
    import yfinance as yf
    import pandas as pd

    try:
        import pandas_ta as ta  # noqa
        _has_ta = True
    except ImportError:
        _has_ta = False

    from app.core.config import settings  # type: ignore

    yf_sym = _yf_symbol(symbol)
    df = yf.download(yf_sym, period="3mo", auto_adjust=True, progress=False, threads=False)
    if df.empty:
        raise ValueError(f"無法取得 {symbol} 資料")

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df.columns = [c.lower() for c in df.columns]
    df = df[["open", "high", "low", "close", "volume"]].dropna()

    close     = df["close"]
    vol       = df["volume"]
    price     = float(close.iloc[-1])
    prev_cl   = float(close.iloc[-2]) if len(close) > 1 else price
    chg_pct   = (price - prev_cl) / prev_cl * 100 if prev_cl > 0 else 0.0

    # ── RSI ──────────────────────────────────────────────────────────────
    rsi_v: float | None = None
    if _has_ta and len(close) >= 15:
        rsi_s = df.ta.rsi(length=14)
        if rsi_s is not None and not rsi_s.empty:
            rsi_v = float(rsi_s.iloc[-1])

    # ── MACD ─────────────────────────────────────────────────────────────
    macd_desc: str = "MACD 資料不足"
    if _has_ta and len(close) >= 30:
        mdf = df.ta.macd(fast=12, slow=26, signal=9)
        if mdf is not None and not mdf.empty:
            mv   = float(mdf.iloc[-1, 0])
            sv   = float(mdf.iloc[-1, 2])
            hist = float(mdf.iloc[-1, 1])
            pmv  = float(mdf.iloc[-2, 0]) if len(mdf) > 1 else mv
            psv  = float(mdf.iloc[-2, 2]) if len(mdf) > 1 else sv
            if mv > sv and pmv <= psv:
                macd_desc = "剛出現黃金交叉（多頭訊號）"
            elif mv < sv and pmv >= psv:
                macd_desc = "剛出現死亡交叉（空頭訊號）"
            elif mv > sv:
                macd_desc = f"站在訊號線之上（柱狀體 {hist:+.3f}，多頭）"
            else:
                macd_desc = f"跌破訊號線（柱狀體 {hist:+.3f}，空頭）"

    # ── MA ───────────────────────────────────────────────────────────────
    ma20 = float(close.rolling(20).mean().iloc[-1]) if len(close) >= 20 else None
    ma60 = float(close.rolling(60).mean().iloc[-1]) if len(close) >= 60 else None
    above_mas = []
    if ma20 and price >= ma20: above_mas.append("MA20")
    if ma60 and price >= ma60: above_mas.append("MA60")
    ma_desc = f"站在 {'/'.join(above_mas)} 之上" if above_mas else "位於均線之下"

    # ── 量比 ─────────────────────────────────────────────────────────────
    today_vol = float(vol.iloc[-1])
    avg20_vol = float(vol.tail(20).mean())
    vol_ratio = round(today_vol / avg20_vol, 1) if avg20_vol > 0 else 1.0
    vol_desc  = "放量" if vol_ratio >= 1.5 else "縮量" if vol_ratio < 0.7 else "正常量"

    rsi_str  = f"RSI(14) = {rsi_v:.1f}" if rsi_v is not None else "RSI 資料不足"
    rsi_zone = (
        "（超買區）" if rsi_v and rsi_v > 70
        else "（超賣區，留意反彈）" if rsi_v and rsi_v < 30
        else "（強勢區）" if rsi_v and rsi_v >= 50
        else "（弱勢區）" if rsi_v else ""
    )

    # ── 法人籌碼（從 screener 快取，不強制） ─────────────────────────────
    chips_desc = ""
    try:
        from app.services import screener_service  # type: ignore
        m = screener_service._metrics.get(symbol, {})  # type: ignore[attr-defined]
        fs = m.get("foreign_streak", {})
        ts = m.get("trust_streak",   {})
        parts = []
        if fs.get("direction") == "buy"  and fs.get("days", 0) >= 1:
            parts.append(f"外資連買 {fs['days']} 日")
        elif fs.get("direction") == "sell" and fs.get("days", 0) >= 1:
            parts.append(f"外資連賣 {fs['days']} 日")
        if ts.get("direction") == "buy"  and ts.get("days", 0) >= 1:
            parts.append(f"投信連買 {ts['days']} 日")
        elif ts.get("direction") == "sell" and ts.get("days", 0) >= 1:
            parts.append(f"投信連賣 {ts['days']} 日")
        chips_desc = "，".join(parts) if parts else "無明顯法人動向"
    except Exception:
        chips_desc = "籌碼資料暫無"

    # ── Gemini 呼叫 ──────────────────────────────────────────────────────
    prompt = (
        f"你是一位專業的台股技術分析師，請根據以下量化數據，"
        f"用繁體中文撰寫 150-180 字的技術分析段落，語氣簡潔專業，"
        f"依序涵蓋：① 現況描述（價格/漲跌）② RSI 信號解讀 ③ MACD 趨勢 ④ 均線多空 ⑤ 量能觀察 ⑥ 籌碼面 ⑦ 短線操作方向。\n\n"
        f"股票代號：{symbol}\n"
        f"現價：{price:.2f} 元，今日漲跌：{chg_pct:+.2f}%\n"
        f"技術指標：{rsi_str}{rsi_zone}；MACD {macd_desc}；{ma_desc}\n"
        f"量能：成交量比 {vol_ratio}x（{vol_desc}）\n"
        f"籌碼：{chips_desc}\n\n"
        f"請直接輸出段落，不需標題，不需條列。結尾加上：「以上分析僅供參考，不構成投資建議。」"
    )

    text: str | None = None
    if settings.gemini_api_key:
        try:
            import google.generativeai as genai  # type: ignore
            genai.configure(api_key=settings.gemini_api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            resp  = model.generate_content(prompt)
            text  = resp.text.strip()
        except Exception as exc:
            logger.warning("Gemini AI analysis failed for %s: %s", symbol, exc)

    if not text:
        # 規則式回退
        text = (
            f"{symbol} 現價 {price:.2f} 元，今日 {chg_pct:+.2f}%。"
            f"技術面：{rsi_str}{rsi_zone}，MACD {macd_desc}，{ma_desc}。"
            f"量能 {vol_desc}（量比 {vol_ratio}x）。"
            f"籌碼面：{chips_desc}。"
            "以上分析僅供參考，不構成投資建議。"
        )

    return {
        "symbol": symbol,
        "analysis": text,
        "meta": {
            "price":      round(price, 2),
            "change_pct": round(chg_pct, 2),
            "rsi14":      round(rsi_v, 1) if rsi_v is not None else None,
            "macd":       macd_desc,
            "ma_above":   above_mas,
            "vol_ratio":  vol_ratio,
            "chips":      chips_desc,
        },
    }


@router.get("/ai-analysis/{symbol}")
@limiter.limit("10/minute")
async def get_ai_analysis(request: Request, symbol: str):
    """
    AI 技術分析解讀（Gemini + 技術指標）
    GET /api/v1/ai-analysis/2330
    GET /api/v1/ai-analysis/AAPL
    """
    sym  = validate_symbol(symbol)
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _generate_analysis_sync, sym)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"無法生成 AI 分析：{exc}")
    return data
