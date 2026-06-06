"""
AI 技術分析解讀 API

GET  /api/v1/ai-analysis/{symbol}          — 完整技術分析段落（150-180 字）
GET  /api/v1/ai-analysis/{symbol}/verdict  — 一句話 AI 評價（30-50 字）
POST /api/v1/ai-analysis/compare           — 多股比較 AI 分析（按鈕觸發）

快取 TTL：15 分鐘（盤中多次點擊不重複消耗 API quota）
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
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


# ── Stock Verdict ─────────────────────────────────────────────────────────────

@ttl_cache(ttl=900)   # 15 minutes
def _generate_verdict_sync(symbol: str) -> dict[str, Any]:
    """
    一句話 AI 評價（30-50 字）：趨勢方向 + 關鍵訊號 + 短線建議
    比完整分析更快，適合放在 K 線圖旁快速瀏覽。
    """
    import yfinance as yf
    import pandas as pd

    from app.core.config import settings  # type: ignore

    yf_sym = _yf_symbol(symbol)
    df = yf.download(yf_sym, period="1mo", auto_adjust=True, progress=False, threads=False)
    if df.empty:
        raise ValueError(f"無法取得 {symbol} 資料")

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df.columns = [c.lower() for c in df.columns]

    close   = df["close"].dropna()
    price   = float(close.iloc[-1])
    prev_cl = float(close.iloc[-2]) if len(close) > 1 else price
    chg_pct = (price - prev_cl) / prev_cl * 100 if prev_cl > 0 else 0.0

    # 快速指標：MA5/MA10、RSI
    ma5  = float(close.rolling(5).mean().iloc[-1])  if len(close) >= 5  else None
    ma10 = float(close.rolling(10).mean().iloc[-1]) if len(close) >= 10 else None
    trend = (
        "多頭排列" if ma5 and ma10 and ma5 > ma10
        else "空頭排列" if ma5 and ma10 and ma5 < ma10
        else "盤整"
    )

    rsi_v: float | None = None
    try:
        import pandas_ta as ta  # noqa
        rsi_s = df.ta.rsi(length=14)
        if rsi_s is not None and not rsi_s.empty:
            rsi_v = float(rsi_s.iloc[-1])
    except Exception:
        pass

    # 規則式 fallback verdict
    if rsi_v and rsi_v > 70:
        signal = "RSI 進入超買，留意回撤風險"
    elif rsi_v and rsi_v < 30:
        signal = "RSI 超賣，可留意低接機會"
    elif chg_pct > 2:
        signal = "今日強力上漲，動能充足"
    elif chg_pct < -2:
        signal = "今日明顯下挫，注意支撐"
    else:
        signal = "盤面平穩，等待突破方向"

    fallback = (
        f"{symbol} 現價 {price:.0f} 元（{chg_pct:+.1f}%），"
        f"均線{trend}，{signal}。僅供參考。"
    )

    text: str = fallback
    if settings.gemini_api_key:
        try:
            import google.generativeai as genai  # type: ignore
            genai.configure(api_key=settings.gemini_api_key)
            model  = genai.GenerativeModel("gemini-1.5-flash")
            prompt = (
                f"你是台股技術分析師，請用繁體中文對以下股票給一句話評價（30-50 字），"
                f"包含：① 趨勢方向 ② 關鍵信號 ③ 短線操作建議。語氣直接，不需客套話。\n\n"
                f"股票：{symbol} | 現價 {price:.2f} 元 | 漲跌 {chg_pct:+.2f}%\n"
                f"均線：{trend} | RSI(14)：{f'{rsi_v:.1f}' if rsi_v else '無資料'}\n\n"
                f"直接輸出一句話（不加引號）："
            )
            resp = model.generate_content(prompt)
            t    = resp.text.strip()
            if t:
                text = t
        except Exception as exc:
            logger.warning("Gemini verdict failed for %s: %s", symbol, exc)

    return {
        "symbol":  symbol,
        "verdict": text,
        "meta": {
            "price":      round(price, 2),
            "change_pct": round(chg_pct, 2),
            "trend":      trend,
            "rsi14":      round(rsi_v, 1) if rsi_v is not None else None,
        },
    }


@router.get("/ai-analysis/{symbol}/verdict")
@limiter.limit("15/minute")
async def get_stock_verdict(request: Request, symbol: str):
    """
    個股 AI 一句話評價（30-50 字）
    GET /api/v1/ai-analysis/2330/verdict
    """
    sym  = validate_symbol(symbol)
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _generate_verdict_sync, sym)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"無法生成 AI 評價：{exc}")
    return data


# ── Compare Analysis ──────────────────────────────────────────────────────────

class CompareAnalysisRequest(BaseModel):
    symbols: list[str] = Field(..., min_length=2, max_length=4)
    period:  str        = Field(default="1y")


@ttl_cache(ttl=900)   # 15 minutes
def _generate_compare_analysis_sync(symbols_key: str, period: str) -> dict[str, Any]:
    """
    多股比較 AI 分析：比較各股在指定期間的報酬、波動、相關性，並給出結論。
    """
    import yfinance as yf
    import pandas as pd

    from app.core.config import settings  # type: ignore

    symbols   = [s.strip() for s in symbols_key.split(",")]
    period_map = {
        "1m": "1mo", "3m": "3mo", "6m": "6mo",
        "1y": "1y",  "3y": "3y",  "5y": "5y",
    }
    yf_period = period_map.get(period, "1y")

    summaries: list[str] = []
    for sym in symbols:
        yf_sym = _yf_symbol(sym)
        try:
            df = yf.download(yf_sym, period=yf_period, auto_adjust=True, progress=False, threads=False)
            if df.empty:
                continue
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df.columns = [c.lower() for c in df.columns]
            close = df["close"].dropna()
            if len(close) < 2:
                continue
            total_ret = (float(close.iloc[-1]) / float(close.iloc[0]) - 1) * 100
            volatility = float(close.pct_change().std() * (252 ** 0.5) * 100)
            summaries.append(
                f"{sym}：區間報酬 {total_ret:+.1f}%，年化波動 {volatility:.1f}%"
            )
        except Exception:
            continue

    if not summaries:
        raise ValueError("無法取得任何股票資料")

    data_str = "\n".join(summaries)
    period_label = {
        "1m": "1 個月", "3m": "3 個月", "6m": "6 個月",
        "1y": "1 年", "3y": "3 年", "5y": "5 年",
    }.get(period, period)

    fallback = (
        f"在 {period_label} 期間，{', '.join(symbols)} 的表現如下：\n{data_str}。\n"
        f"以上比較僅供參考，不構成投資建議。"
    )

    text: str = fallback
    if settings.gemini_api_key:
        try:
            import google.generativeai as genai  # type: ignore
            genai.configure(api_key=settings.gemini_api_key)
            model  = genai.GenerativeModel("gemini-1.5-flash")
            prompt = (
                f"你是專業的股票分析師，請用繁體中文（150-200 字）分析以下多支股票在 {period_label} 的表現比較，"
                f"涵蓋：① 報酬排名點評 ② 風險（波動）比較 ③ 各股主要驅動因素（若知道）④ 投資組合搭配建議。"
                f"語氣專業直接，結尾加「以上分析僅供參考，不構成投資建議。」\n\n"
                f"數據：\n{data_str}\n\n"
                f"直接輸出段落分析："
            )
            resp = model.generate_content(prompt)
            t    = resp.text.strip()
            if t:
                text = t
        except Exception as exc:
            logger.warning("Gemini compare analysis failed for %s: %s", symbols_key, exc)

    return {
        "symbols":  symbols,
        "period":   period,
        "analysis": text,
        "data":     summaries,
    }


@router.post("/ai-analysis/compare")
@limiter.limit("5/minute")
async def get_compare_analysis(request: Request, body: CompareAnalysisRequest):
    """
    多股比較 AI 分析（按鈕觸發，15 分鐘快取）
    POST /api/v1/ai-analysis/compare
    Body: {"symbols": ["2330", "2317", "AAPL"], "period": "1y"}
    """
    validated: list[str] = []
    for s in body.symbols[:4]:
        try:
            validated.append(validate_symbol(s.strip()))
        except Exception:
            pass
    if len(validated) < 2:
        raise HTTPException(status_code=400, detail="至少需要 2 支有效股票代號")

    if body.period not in ("1m", "3m", "6m", "1y", "3y", "5y"):
        period = "1y"
    else:
        period = body.period

    symbols_key = ",".join(validated)
    loop        = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(
            None, _generate_compare_analysis_sync, symbols_key, period
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"無法生成比較分析：{exc}")
    return data
