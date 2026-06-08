"""
基本面快取服務 — 為 Screener 提供 24h TTL 批量基本面資料

欄位：
  pe              : 本益比（trailing P/E）
  dividend_yield  : 殖利率 (%)
  gross_margin    : 毛利率 (%)
  market_cap_b    : 市值（億台幣）
  roe             : 股東權益報酬率 (%)
  eps_growth      : EPS 年成長率 (%)
  revenue_growth  : 年營收成長率 (%)

快取策略：
  - in-memory dict，TTL 24h
  - 並行抓取（ThreadPoolExecutor × asyncio.Semaphore(5)）
  - 抓取失敗回傳 {} 不影響主流程
"""

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

logger = logging.getLogger(__name__)

# ── 快取狀態 ──────────────────────────────────────────────────────────────────
_fund_data:       dict[str, dict] = {}
_fund_updated_at: float           = 0.0
_FUND_TTL                         = 86400   # 24h
_fund_lock                        = asyncio.Lock()
_fund_refreshing: bool            = False

_EXECUTOR = ThreadPoolExecutor(max_workers=5, thread_name_prefix="fund-fetch")


# ── 輔助 ──────────────────────────────────────────────────────────────────────

def _is_tw(symbol: str) -> bool:
    """判斷是否為台股代碼（純數字 or 數字開頭）"""
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _safe_pct(val, digits: int = 1) -> Optional[float]:
    """將小數轉換為百分比（0.35 → 35.0）"""
    try:
        return round(float(val) * 100, digits) if val is not None else None
    except (TypeError, ValueError):
        return None


def _safe_float(val, digits: int = 1) -> Optional[float]:
    try:
        return round(float(val), digits) if val is not None else None
    except (TypeError, ValueError):
        return None


# ── 單股抓取（同步，在 executor 執行）────────────────────────────────────────

def _fetch_one_sync(symbol: str) -> dict:
    """使用 yfinance 抓取單股基本面，回傳精簡字典"""
    try:
        import yfinance as yf

        yf_sym = f"{symbol}.TW" if _is_tw(symbol) else symbol
        info   = yf.Ticker(yf_sym).info

        # 若主要欄位都是空的，代表代碼無效
        if not info or (
            info.get("trailingPE") is None
            and info.get("dividendYield") is None
            and info.get("marketCap") is None
        ):
            return {}

        market_cap_raw = info.get("marketCap")

        return {
            "pe":             _safe_float(info.get("trailingPE"), 1),
            "dividend_yield": _safe_pct(info.get("dividendYield"), 2),     # % (0.04 → 4.0)
            "gross_margin":   _safe_pct(info.get("grossMargins"), 1),      # % (0.35 → 35.0)
            "market_cap_b":   round(market_cap_raw / 1e8, 1) if market_cap_raw else None,  # 億
            "roe":            _safe_pct(info.get("returnOnEquity"), 1),    # %
            "eps_growth":     _safe_pct(info.get("earningsGrowth"), 1),    # %
            "revenue_growth": _safe_pct(info.get("revenueGrowth"), 1),     # %
        }
    except Exception as exc:
        logger.debug("fund fetch skip %s: %s", symbol, exc)
        return {}


# ── 非同步批量抓取 ────────────────────────────────────────────────────────────

async def _fetch_fund_one(symbol: str, sem: asyncio.Semaphore) -> tuple[str, dict]:
    async with sem:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(_EXECUTOR, _fetch_one_sync, symbol)
        return symbol, data


async def refresh_fund_cache(universe: list[str]) -> None:
    """批量刷新基本面快取（自動跳過未過期的）"""
    global _fund_data, _fund_updated_at, _fund_refreshing

    if _fund_refreshing:
        return
    if time.time() - _fund_updated_at < _FUND_TTL:
        return

    async with _fund_lock:
        # double-check after acquiring lock
        if time.time() - _fund_updated_at < _FUND_TTL:
            return
        if _fund_refreshing:
            return
        _fund_refreshing = True
        try:
            sem     = asyncio.Semaphore(5)
            results = await asyncio.gather(
                *[_fetch_fund_one(s, sem) for s in universe],
                return_exceptions=True,
            )
            new_data: dict[str, dict] = {}
            for item in results:
                if isinstance(item, Exception):
                    continue
                sym, data = item
                if data:
                    new_data[sym] = data

            _fund_data       = new_data
            _fund_updated_at = time.time()
            logger.info(
                "fund_cache refreshed: %d / %d stocks",
                len(new_data), len(universe),
            )
        finally:
            _fund_refreshing = False


def get_fund_data() -> dict[str, dict]:
    """回傳目前快取（可能為空，如尚未完成首次抓取）"""
    return _fund_data


def is_fund_stale() -> bool:
    return time.time() - _fund_updated_at > _FUND_TTL
