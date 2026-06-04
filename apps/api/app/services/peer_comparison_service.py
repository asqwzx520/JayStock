"""
同業比較表服務

自動偵測邏輯：
  1. 台股 → 查 _TW_PEER_GROUPS 靜態對照表（主要個股覆蓋）
  2. 美股 → 嘗試 yf.Industry(industryKey).top_companies
  3. Fallback → 同 sector 前 5 大市值（yfinance Sector）

每支股票擷取指標：市值、PE、PB、ROE、毛利率、殖利率、1年漲跌%
批次並行：ThreadPoolExecutor(5)
快取 TTL：86400 秒
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

# ── 台股同業對照（涵蓋主要個股） ─────────────────────────────────────────────
_TW_PEERS: dict[str, list[str]] = {
    # 半導體 IC 設計 / 製造
    "2330": ["2454.TW", "2303.TW", "6770.TW", "3711.TW", "2408.TW"],
    "2454": ["2330.TW", "3711.TW", "2303.TW", "6770.TW", "2408.TW"],
    "2303": ["2330.TW", "2454.TW", "6770.TW", "3711.TW", "2408.TW"],
    "6770": ["2330.TW", "2303.TW", "2454.TW", "3711.TW"],
    "3711": ["2330.TW", "2303.TW", "2454.TW", "6770.TW", "3533.TW"],
    "2408": ["2330.TW", "2303.TW", "6770.TW", "2454.TW"],
    "3034": ["2454.TW", "2330.TW", "2303.TW", "3711.TW"],  # 聯詠
    "3008": ["2474.TW", "5269.TW", "3533.TW"],              # 大立光
    "2474": ["3008.TW", "5269.TW"],                          # 可成
    # 電子代工 / EMS
    "2317": ["2382.TW", "3231.TW", "2356.TW", "2308.TW"],
    "2382": ["2317.TW", "3231.TW", "2356.TW", "2308.TW"],
    "3231": ["2317.TW", "2382.TW", "2356.TW", "2308.TW"],
    "2356": ["2317.TW", "2382.TW", "3231.TW"],
    "2308": ["2317.TW", "2382.TW", "3231.TW", "2356.TW"],
    # 伺服器 / AI
    "2376": ["2301.TW", "3034.TW", "2397.TW", "3017.TW"],
    "2301": ["2376.TW", "3034.TW", "2397.TW"],
    "3017": ["2376.TW", "2301.TW", "3034.TW"],
    "2397": ["2376.TW", "2301.TW", "3017.TW"],
    # 面板
    "3481": ["2475.TW"],
    "2475": ["3481.TW"],
    # 通信服務
    "2412": ["4904.TW", "3045.TW"],
    "4904": ["2412.TW", "3045.TW"],
    "3045": ["2412.TW", "4904.TW"],
    # 金融
    "2882": ["2881.TW", "2883.TW", "2884.TW", "2885.TW", "2891.TW"],
    "2881": ["2882.TW", "2883.TW", "2884.TW", "2885.TW", "2891.TW"],
    "2883": ["2882.TW", "2881.TW", "2884.TW", "2885.TW"],
    "2884": ["2882.TW", "2881.TW", "2883.TW", "2885.TW"],
    "2885": ["2882.TW", "2881.TW", "2883.TW", "2884.TW"],
    "2891": ["2882.TW", "2881.TW", "2883.TW", "2884.TW"],
    "2886": ["2882.TW", "2881.TW", "2883.TW"],
    # 石化 / 塑膠
    "1301": ["1303.TW", "1326.TW", "1402.TW"],
    "1303": ["1301.TW", "1326.TW", "1402.TW"],
    "1326": ["1301.TW", "1303.TW", "1402.TW"],
    # 鋼鐵
    "2002": ["2006.TW", "2015.TW"],
    "2006": ["2002.TW", "2015.TW"],
    # 汽車零件
    "1537": ["2355.TW", "2227.TW"],
}

# ── US mega-cap peers ─────────────────────────────────────────────────────────
_US_PEERS: dict[str, list[str]] = {
    "AAPL":  ["MSFT", "GOOGL", "META", "AMZN"],
    "MSFT":  ["AAPL", "GOOGL", "AMZN", "META"],
    "GOOGL": ["MSFT", "AAPL", "META", "AMZN"],
    "GOOG":  ["MSFT", "AAPL", "META", "AMZN"],
    "META":  ["GOOGL", "AAPL", "MSFT", "SNAP"],
    "AMZN":  ["MSFT", "AAPL", "GOOGL", "WMT"],
    "NVDA":  ["AMD", "INTC", "QCOM", "AVGO"],
    "AMD":   ["NVDA", "INTC", "QCOM", "AVGO"],
    "INTC":  ["NVDA", "AMD", "QCOM", "AVGO"],
    "QCOM":  ["NVDA", "AMD", "INTC", "AVGO"],
    "AVGO":  ["NVDA", "QCOM", "AMD", "INTC"],
    "TSM":   ["INTC", "SAMSUNG", "AVGO"],  # TSM = TSMC on NYSE
    "TSLA":  ["F", "GM", "RIVN", "NIO"],
    "BABA":  ["JD", "PDD", "BIDU"],
    "JPM":   ["BAC", "WFC", "GS", "C"],
    "BAC":   ["JPM", "WFC", "GS", "C"],
    "WMT":   ["TGT", "COST", "AMZN"],
}


def _is_tw(symbol: str) -> bool:
    return symbol[:4].isdigit() if len(symbol) >= 4 else symbol.isdigit()


def _yf_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    return f"{s}.TW" if _is_tw(s) else s


def _safe(v: Any) -> float | None:
    try:
        f = float(v)
        return None if (f != f) else f
    except (TypeError, ValueError):
        return None


def _fmt_cap(cap: float | None) -> str:
    if cap is None:
        return "—"
    if cap >= 1e12:
        return f"{cap/1e12:.1f}T"
    if cap >= 1e9:
        return f"{cap/1e9:.1f}B"
    if cap >= 1e8:
        return f"{cap/1e8:.1f}億"
    return f"{cap/1e6:.0f}M"


def _fetch_one_info(yf_sym: str) -> dict[str, Any]:
    """Fetch one ticker's info and extract comparison metrics."""
    try:
        import yfinance as yf
        info = yf.Ticker(yf_sym).info or {}
        base = yf_sym.replace(".TW", "").replace(".TWO", "")
        cap = _safe(info.get("marketCap"))
        week52_high = _safe(info.get("fiftyTwoWeekHigh"))
        week52_low  = _safe(info.get("fiftyTwoWeekLow"))
        price       = _safe(info.get("currentPrice") or info.get("regularMarketPrice"))

        # 1-year return approximation using 52-week range midpoint vs current
        chg1y = None
        prev1y = _safe(info.get("52WeekChange"))          # Yahoo sometimes provides this
        if prev1y is not None:
            chg1y = round(prev1y * 100, 2)

        return {
            "symbol":        base,
            "yf_symbol":     yf_sym,
            "name":          info.get("longName") or info.get("shortName") or base,
            "price":         price,
            "change_1y_pct": chg1y,
            "market_cap":    cap,
            "market_cap_fmt": _fmt_cap(cap),
            "pe_trailing":   _safe(info.get("trailingPE")),
            "pb_ratio":      _safe(info.get("priceToBook")),
            "roe":           _safe(info.get("returnOnEquity")),
            "gross_margin":  _safe(info.get("grossMargins")),
            "profit_margin": _safe(info.get("profitMargins")),
            "revenue_growth":_safe(info.get("revenueGrowth")),
            "dividend_yield":_safe(info.get("dividendYield")),
            "week52_high":   week52_high,
            "week52_low":    week52_low,
            "sector":        info.get("sector"),
            "industry":      info.get("industry"),
            "industry_key":  info.get("industryKey", ""),
        }
    except Exception as exc:
        logger.debug("[peer] fetch_one %s: %s", yf_sym, exc)
        base = yf_sym.replace(".TW", "").replace(".TWO", "")
        return {"symbol": base, "yf_symbol": yf_sym, "name": base, "error": str(exc)}


def _detect_peers(symbol: str, target_info: dict) -> list[str]:
    """Return yf_symbol strings for up to 5 peers (not including target)."""
    import yfinance as yf

    yf_sym = _yf_symbol(symbol)
    base   = symbol.upper().strip()

    # 1. Static TW lookup
    if base in _TW_PEERS:
        return _TW_PEERS[base][:5]

    # 2. Static US lookup
    if base in _US_PEERS:
        return _US_PEERS[base][:5]

    # 3. Try yf.Industry
    industry_key = target_info.get("industry_key", "")
    if industry_key:
        try:
            ind = yf.Industry(industry_key)
            top = ind.top_companies
            if top is not None and not top.empty:
                peers = [s for s in top.index.tolist() if s != yf_sym][:5]
                if peers:
                    return peers
        except Exception as exc:
            logger.debug("[peer] yf.Industry failed for %s: %s", industry_key, exc)

    # 4. Try yf.Sector
    sector_key = (target_info.get("sector") or "").lower().replace(" ", "-")
    if sector_key:
        try:
            sec = yf.Sector(sector_key)
            top = sec.top_companies
            if top is not None and not top.empty:
                peers = [s for s in top.index.tolist() if s != yf_sym][:5]
                if peers:
                    return peers
        except Exception as exc:
            logger.debug("[peer] yf.Sector failed for %s: %s", sector_key, exc)

    return []


@ttl_cache(ttl=86_400)
def _fetch_sync(symbol: str, custom_peers_csv: str = "") -> dict[str, Any]:
    """
    Fetch peer comparison.
    custom_peers_csv: comma-separated raw symbols if user provided custom list.
    """
    import yfinance as yf

    target_yf = _yf_symbol(symbol)

    # Step 1: fetch target info first (needed for peer detection)
    target_info = _fetch_one_info(target_yf)

    # Step 2: determine peers
    if custom_peers_csv:
        raw = [s.strip().upper() for s in custom_peers_csv.split(",") if s.strip()]
        peer_syms = [_yf_symbol(s) for s in raw[:6]]
    else:
        peer_syms = _detect_peers(symbol, target_info)

    all_syms = [target_yf] + [s for s in peer_syms if s != target_yf]

    # Step 3: batch-fetch (skip target which is already fetched)
    results: dict[str, dict] = {target_yf: target_info}
    remaining = [s for s in all_syms if s != target_yf]

    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = {ex.submit(_fetch_one_info, sym): sym for sym in remaining}
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                results[sym] = fut.result()
            except Exception as exc:
                logger.debug("[peer] batch failed %s: %s", sym, exc)

    # Step 4: assemble ordered result list
    rows = [results.get(sym, {"symbol": sym.replace(".TW", ""), "yf_symbol": sym}) for sym in all_syms]

    return {
        "symbol":       symbol,
        "target_yf":    target_yf,
        "custom":       bool(custom_peers_csv),
        "rows":         rows,
    }


async def get_peer_comparison(symbol: str, custom_peers: str = "") -> dict[str, Any]:
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _fetch_sync, symbol.upper().strip(), custom_peers.upper().strip()
    )
