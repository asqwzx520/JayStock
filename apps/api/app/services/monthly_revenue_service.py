"""
月營收服務

台股：從 MOPS（公開資訊觀測站）IFRS 月營收 API 取得（完全免費）
美股：不提供（月營收為台灣上市公司特有揭露義務）

資料格式：
  年度=民國年（需 +1911 轉西元）、金額單位=千元
  返回近 24 個月：含 YoY%、累計 YoY%

快取 TTL：86400 秒（每日更新，10 日公告當月數字）
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

_MOPS_URL = "https://mops.twse.com.tw/mops/web/ajax_t05st10_ifrs"
_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0 (compatible; StockPulse/1.0)",
    "Referer": "https://mops.twse.com.tw/mops/web/t05st10_ifrs",
}


def _is_tw(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _clean_num(val: Any) -> float | None:
    if val is None:
        return None
    try:
        s = str(val).replace(",", "").replace(" ", "").strip()
        if s in ("--", "-", "N/A", "nan", ""):
            return None
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_mops_df(df: Any) -> list[dict]:
    """
    Parse MOPS DataFrame（pandas.read_html 結果）
    支援各種欄位名稱變體，帶 positional fallback。
    """
    import pandas as pd

    # ── Flatten MultiIndex columns ───────────────────────────────────────────
    flat: list[str] = []
    for c in df.columns:
        if isinstance(c, tuple):
            flat.append(" ".join(str(x) for x in c if str(x).lower() != "nan").strip())
        else:
            flat.append(str(c).strip())
    df = df.copy()
    df.columns = flat

    # ── Map column names ──────────────────────────────────────────────────────
    year_col = month_col = rev_col = last_rev_col = None
    yoy_col  = cum_col  = last_cum_col = cum_yoy_col = None

    for c in flat:
        if "年度" in c and year_col is None:
            year_col = c
        elif "月份" in c and month_col is None:
            month_col = c
        elif "當月營收" in c and "累計" not in c and rev_col is None:
            rev_col = c
        elif "去年當月" in c and last_rev_col is None:
            last_rev_col = c
        elif "去年同月" in c and "比較" in c and yoy_col is None:
            yoy_col = c
        elif "當月累計" in c and "營收" in c and cum_col is None:
            cum_col = c
        elif "去年累計" in c and last_cum_col is None:
            last_cum_col = c
        elif "前期比較" in c and cum_yoy_col is None:
            cum_yoy_col = c

    # Positional fallback (MOPS table is typically 10 columns)
    if year_col is None and len(flat) >= 2:
        year_col, month_col = flat[0], flat[1]
        if len(flat) >= 3:  rev_col          = flat[2]
        if len(flat) >= 5:  last_rev_col     = flat[4]
        if len(flat) >= 7:  yoy_col          = flat[6]
        if len(flat) >= 8:  cum_col          = flat[7]
        if len(flat) >= 9:  last_cum_col     = flat[8]
        if len(flat) >= 10: cum_yoy_col      = flat[9]

    result: list[dict] = []
    for _, row in df.iterrows():
        try:
            roc_year = _clean_num(row.get(year_col))
            month    = _clean_num(row.get(month_col))
            if roc_year is None or month is None:
                continue
            if not (1 <= int(month) <= 12):
                continue

            western_year = int(roc_year) + 1911
            result.append({
                "year":                   western_year,
                "month":                  int(month),
                "revenue":                _clean_num(row.get(rev_col))       if rev_col       else None,
                "last_year_revenue":      _clean_num(row.get(last_rev_col))  if last_rev_col  else None,
                "yoy_pct":                _clean_num(row.get(yoy_col))       if yoy_col       else None,
                "cumulative":             _clean_num(row.get(cum_col))       if cum_col       else None,
                "last_year_cumulative":   _clean_num(row.get(last_cum_col))  if last_cum_col  else None,
                "cumulative_yoy_pct":     _clean_num(row.get(cum_yoy_col))   if cum_yoy_col   else None,
            })
        except Exception:
            continue

    result.sort(key=lambda r: (r["year"], r["month"]))
    return result


def _fetch_mops(co_id: str, typek: str) -> list[dict]:
    """POST to MOPS, parse response HTML table with pandas."""
    import httpx
    import pandas as pd

    payload = {
        "encodeURIComponent": "1",
        "step": "1",
        "firstin": "1",
        "off": "1",
        "co_id": co_id,
        "TYPEK": typek,
    }
    resp = httpx.post(_MOPS_URL, data=payload, headers=_HEADERS, timeout=25)
    resp.raise_for_status()

    text = resp.text
    if "查無資料" in text or len(text) < 500:
        return []

    try:
        tables = pd.read_html(text, thousands=",")
    except Exception as exc:
        logger.warning("[monthly_revenue] pd.read_html failed (%s %s): %s", co_id, typek, exc)
        return []

    # Find the table that contains 年度 / 月份 columns
    for t in tables:
        cols_str = " ".join(
            str(c[-1] if isinstance(c, tuple) else c)
            for c in t.columns
        )
        if "年度" in cols_str and "月份" in cols_str:
            return _parse_mops_df(t)

    # Fallback: try largest table
    if tables:
        biggest = max(tables, key=lambda t: len(t))
        if len(biggest) > 0:
            parsed = _parse_mops_df(biggest)
            if parsed:
                return parsed

    return []


@ttl_cache(ttl=86_400)
def _fetch_sync(symbol: str) -> dict[str, Any]:
    if not _is_tw(symbol):
        return {
            "symbol":  symbol,
            "is_tw":   False,
            "data":    [],
            "unit":    "千元",
            "message": "月營收為台灣上市公司特有揭露指標，美股不適用",
        }

    # Try TWSE → OTC → emerging market
    for typek in ("sii", "otc", "rotc"):
        try:
            data = _fetch_mops(symbol, typek)
            if data:
                logger.info("[monthly_revenue] %s (%s): %d records", symbol, typek, len(data))
                # Return last 24 months
                return {
                    "symbol": symbol,
                    "is_tw":  True,
                    "data":   data[-24:],
                    "unit":   "千元",
                }
        except Exception as exc:
            logger.debug("[monthly_revenue] %s typek=%s: %s", symbol, typek, exc)

    logger.warning("[monthly_revenue] %s: all typek failed", symbol)
    return {
        "symbol":  symbol,
        "is_tw":   True,
        "data":    [],
        "unit":    "千元",
        "message": "MOPS 暫無資料，可能為非台股上市公司",
    }


async def get_monthly_revenue(symbol: str) -> dict[str, Any]:
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_sync, symbol.upper().strip())
