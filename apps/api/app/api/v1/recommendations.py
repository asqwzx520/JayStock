"""
AI 今日精選推薦端點

GET /api/v1/recommendations
  - 從 screener 快取取 Top5 得分股票
  - 呼叫 Gemini 生成每檔 60 字選股理由
  - 快取 15 分鐘（同一時段不重複呼叫 Gemini）
  - 快取空時先跑一次 screener refresh
"""

import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, Request
from app.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter()

# ── 15 分鐘記憶體快取 ──────────────────────────────────────────────────────────
_cache: Optional[dict] = None
_cache_ts: float = 0
_CACHE_TTL = 900  # 15 分鐘


def _get_cached_metrics() -> dict:
    try:
        from app.services import screener_service
        return screener_service._metrics
    except Exception as exc:
        logger.warning("recommendations: cannot read screener cache — %s", exc)
        return {}


def _pick_top5(metrics: dict) -> list[dict]:
    scored = []
    for sym, m in metrics.items():
        score = 0
        fs = m.get("foreign_streak", {})
        ts = m.get("trust_streak", {})
        if fs.get("direction") == "buy" and fs.get("days", 0) >= 3:
            score += 30
        if ts.get("direction") == "buy" and ts.get("days", 0) >= 3:
            score += 20
        if m.get("above_ma20"):
            score += 20
        rsi = m.get("rsi14", 50)
        if rsi < 60:
            score += 15
        if m.get("vol_ratio", 1.0) > 1.5:
            score += 15
        if score >= 20:
            scored.append({
                "symbol":         sym,
                "name":           m.get("name", sym),
                "price":          m.get("price", 0),
                "change_pct":     m.get("change_pct", 0.0),
                "rsi14":          rsi,
                "foreign_streak": fs,
                "trust_streak":   ts,
                "above_ma20":     m.get("above_ma20", False),
                "vol_ratio":      m.get("vol_ratio", 1.0),
                "score":          score,
            })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:5]


async def _generate_reason(stock: dict) -> str:
    from app.core.config import settings
    if not settings.gemini_api_key:
        return _fallback_reason(stock)
    prompt = (
        f"以下是一檔台股的量化數據，請用繁體中文撰寫60字以內的選股理由，"
        f"著重籌碼與技術面優勢，語氣簡潔專業：\n"
        f"股票：{stock['symbol']} {stock['name']}\n"
        f"現價：{stock['price']} 元，漲跌：{stock['change_pct']:+.2f}%\n"
        f"RSI(14)：{stock['rsi14']:.1f}\n"
        f"外資：{'連買' + str(stock['foreign_streak'].get('days',0)) + '日' if stock['foreign_streak'].get('direction')=='buy' else '無明顯買超'}\n"
        f"投信：{'連買' + str(stock['trust_streak'].get('days',0)) + '日' if stock['trust_streak'].get('direction')=='buy' else '無明顯買超'}\n"
        f"突破均線：{'是' if stock['above_ma20'] else '否'}，量比：{stock['vol_ratio']:.1f}\n"
        f"請以「{stock['name']}」開頭直接描述理由，不要加任何前綴或標號。"
    )
    try:
        import google.generativeai as genai
        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(None, lambda: model.generate_content(prompt))
        text = resp.text.strip()
        return text[:100] if len(text) > 100 else text
    except Exception as exc:
        logger.warning("Gemini reason failed: %s", exc)
        return _fallback_reason(stock)


def _fallback_reason(stock: dict) -> str:
    parts = []
    if stock["foreign_streak"].get("direction") == "buy":
        parts.append(f"外資連買 {stock['foreign_streak'].get('days',0)} 日")
    if stock["trust_streak"].get("direction") == "buy":
        parts.append(f"投信連買 {stock['trust_streak'].get('days',0)} 日")
    if stock["above_ma20"]:
        parts.append("站上月線")
    if stock["vol_ratio"] > 1.5:
        parts.append(f"量比 {stock['vol_ratio']:.1f} 倍")
    if stock["rsi14"] < 60:
        parts.append(f"RSI {stock['rsi14']:.0f}")
    reason = "，".join(parts) or "具多項技術面優勢"
    return f"{stock['name']}：{reason}，籌碼持續改善值得關注。"


@router.get("/recommendations")
@limiter.limit("10/minute")
async def get_recommendations(request: Request):
    global _cache, _cache_ts

    # 快取命中
    if _cache and (time.time() - _cache_ts) < _CACHE_TTL:
        return _cache

    # 取 screener 快取
    metrics = _get_cached_metrics()
    if not metrics:
        logger.info("recommendations: screener cache empty — running refresh")
        try:
            from app.services.screener_service import refresh_cache
            await refresh_cache()
            metrics = _get_cached_metrics()
        except Exception as exc:
            logger.warning("screener refresh failed: %s", exc)

    picks = _pick_top5(metrics)
    if not picks:
        return {"picks": [], "message": "目前無符合條件的精選個股，請稍後再試。"}

    # 並行生成 AI 理由
    reasons = await asyncio.gather(
        *[_generate_reason(s) for s in picks],
        return_exceptions=True,
    )
    for s, r in zip(picks, reasons):
        s["reason"] = r if isinstance(r, str) else _fallback_reason(s)

    result = {
        "picks": [
            {
                "symbol":     s["symbol"],
                "name":       s["name"],
                "price":      s["price"],
                "change_pct": s["change_pct"],
                "score":      s["score"],
                "reason":     s["reason"],
                "foreign_streak": s["foreign_streak"],
                "trust_streak":   s["trust_streak"],
                "above_ma20": s["above_ma20"],
                "vol_ratio":  s["vol_ratio"],
            }
            for s in picks
        ],
        "message": None,
    }

    _cache = result
    _cache_ts = time.time()
    return result
