"""
選股器服務 (v2)

股票池：台灣主要上市股 ~127 檔
快取 TTL：30 分鐘

資料來源（v2）
  法人籌碼：TWSE T86 批量端點
              https://www.twse.com.tw/fund/T86?response=json&date=YYYYMMDD&selectType=ALL
              一次 call 取得全市場當日三大法人，20 trading days = 20 次 API call
              （原本：127 stocks × fetch_institutional = 127 次 FinMind call）

  日 K 行情：Yahoo Finance Chart API v8 直連（純 httpx，不用 yfinance 庫）
              https://query1.finance.yahoo.com/v8/finance/chart/{sym}.TW?interval=1d&range=3mo
              瀏覽器 User-Agent，Render IP 不被識別為 yfinance bot
              （原本：127 stocks × fetch_daily_kline = 127 次 FinMind call）

  保底 fallback（每股最多 2 次 FinMind call，僅在上兩路都失敗時觸發）：
              fetch_daily_kline + fetch_institutional

換算：舊版最壞情況 254 FinMind calls/refresh → 新版 ~0–10 FinMind calls/refresh
"""

import asyncio
import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── 股票池（~127 檔） ─────────────────────────────────────────────────────────
_UNIVERSE: list[str] = [
    # 半導體 / IC 設計 / 晶圓代工（23）
    "2330", "2303", "2454", "2379", "3711", "3034",
    "2344", "2337", "6415", "2408", "3008",
    "2345", "8299", "5269", "3227", "5274", "3529",
    "6526", "3615", "4968", "3006", "4966", "3037",
    # 電子 / 科技 / 組裝（18）
    "2317", "2382", "2357", "2308", "2327", "4938",
    "6669", "2301", "2395", "3661", "2356", "2324",
    "2353", "2376", "2377", "3231", "2458", "3706",
    # 電信（3）
    "3045", "4904", "2412",
    # 金融 / 保險（17）
    "2881", "2882", "2891", "2886", "2884",
    "2885", "2887", "2892", "2880", "5880",
    "2888", "2890", "2883", "2823", "2834", "5876", "2809",
    # 化工 / 石化（4）
    "1301", "1303", "1326", "6505",
    # 鋼鐵 / 精密機械（4）
    "2002", "2049", "3017", "2354",
    # 消費 / 零售 / 食品（8）
    "1216", "2912", "2207", "5903", "1229", "1232", "1215", "1227",
    # 航運（3）
    "2603", "2609", "2615",
    # 光電 / 面板（2）
    "3481", "2409",
    # 傳產高殖利率 / 水泥 / 紡織（16）
    "1101", "1102", "1104", "1210", "2157", "2201",
    "1402", "5871", "2633", "2542", "9933", "9940",
    "9945", "9941", "2103", "6024",
    # 生技 / 醫療（5）
    "3476", "4152", "6446", "4137", "8341",
    # 傳產 / 其他（8）
    "2474", "2059", "8046", "3533", "2610", "2618", "2204", "2206",
    # 高股息 / 科技主題 ETF（12）
    "0050", "0056", "00878", "00713", "00919",
    "006208", "00881", "00891", "00929", "00940",
    "00900", "00830",
]

# ── 快取狀態 ──────────────────────────────────────────────────────────────────
_metrics:     dict[str, dict] = {}
_updated_at:  float           = 0.0
_CACHE_TTL                    = 1800   # 30 分鐘
_refresh_lock  = asyncio.Lock()
_is_refreshing = False

_TZ_TAIPEI = timezone(timedelta(hours=8))

# ── HTTP headers ──────────────────────────────────────────────────────────────
_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8",
}


def get_cache_info() -> dict:
    return {
        "updated_at":  _updated_at,
        "stock_count": len(_metrics),
        "is_stale":    _is_stale(),
    }


def _is_stale() -> bool:
    return time.time() - _updated_at > _CACHE_TTL


# ── 技術指標 ──────────────────────────────────────────────────────────────────

def _rsi(closes: list[float], period: int = 14) -> float:
    """Wilder's RSI（Exponential Moving Average 版本）"""
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains  = [max(d, 0.0) for d in deltas]
    losses = [abs(min(d, 0.0)) for d in deltas]
    ag = sum(gains[:period])  / period
    al = sum(losses[:period]) / period
    for i in range(period, len(deltas)):
        ag = (ag * (period - 1) + gains[i])  / period
        al = (al * (period - 1) + losses[i]) / period
    if al == 0:
        return 100.0
    return round(100.0 - 100.0 / (1.0 + ag / al), 2)


def _ma(closes: list[float], period: int) -> float:
    n = min(period, len(closes))
    return sum(closes[-n:]) / n if n > 0 else 0.0


def _vol_ratio(volumes: list[int], period: int = 20) -> float:
    """今日量 / 前 period 日均量（排除今日）"""
    if len(volumes) < 2:
        return 1.0
    hist = volumes[-(period + 1):-1]
    avg  = sum(hist) / len(hist) if hist else 0
    return round(volumes[-1] / avg, 2) if avg > 0 else 1.0


# ── 法人籌碼解析（FinMind fallback 用） ──────────────────────────────────────

_FOREIGN_NAMES = {"Foreign_Investor", "Foreign_Dealer_Self"}
_TRUST_NAMES   = {"Investment_Trust"}
_DEALER_NAMES  = {"Dealer_self", "Dealer_Hedging"}


def _parse_institutional(raw: list[dict]) -> dict[str, dict[str, int]]:
    """
    將 FinMind 逐筆法人資料聚合成：
      { date_str: { foreign: net, trust: net, dealer: net } }
    """
    by_date: dict[str, dict[str, int]] = {}
    for row in raw:
        d   = row.get("date", "")
        nm  = row.get("name", "")
        buy  = int(row.get("buy",  0))
        sell = int(row.get("sell", 0))
        if nm in _FOREIGN_NAMES:
            cat = "foreign"
        elif nm in _TRUST_NAMES:
            cat = "trust"
        elif nm in _DEALER_NAMES:
            cat = "dealer"
        else:
            continue
        if d not in by_date:
            by_date[d] = {"foreign": 0, "trust": 0, "dealer": 0}
        by_date[d][cat] += buy - sell
    return by_date


def _streak(by_date: dict[str, dict[str, int]], cat: str) -> dict:
    if not by_date:
        return {"days": 0, "direction": "flat"}
    sorted_dates = sorted(by_date.keys())
    net_series   = [by_date[d][cat] for d in sorted_dates]
    last = net_series[-1]
    if last == 0:
        return {"days": 0, "direction": "flat"}
    direction = "buy" if last > 0 else "sell"
    count = 0
    for val in reversed(net_series):
        if (direction == "buy"  and val > 0) or \
           (direction == "sell" and val < 0):
            count += 1
        else:
            break
    return {"days": count, "direction": direction}


# ── TWSE T86 批量法人資料 ─────────────────────────────────────────────────────

def _t86_int(s) -> int:
    """TWSE T86 欄位：移除千分位逗號後轉 int"""
    try:
        return int(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return 0


async def _fetch_t86_bulk(n_days: int = 20) -> dict[str, dict[str, dict[str, int]]]:
    """
    取得最近 n_days 個交易日的全市場三大法人資料。

    回傳：{ symbol → { date_str → { foreign, trust, dealer } } }

    TWSE T86 一次 call 回傳「全市場當日」所有股票，
    20 個交易日只需 20 次 HTTP call（vs 原本 127 次 FinMind per-stock call）。
    """
    # 生成候選日期（從昨天往回推 35 個日曆天，確保能涵蓋 20 個交易日）
    today = date.today()
    candidates: list[date] = []
    d = today
    while len(candidates) < 35:
        d -= timedelta(days=1)
        if d.weekday() < 5:   # 排除週六(5)、週日(6)
            candidates.append(d)

    sem = asyncio.Semaphore(5)   # TWSE 建議不超過 5 並行

    async def _fetch_one_day(
        trading_date: date,
        client: httpx.AsyncClient,
    ) -> tuple[str, dict[str, dict[str, int]]]:
        date_key = trading_date.isoformat()
        tw_date  = trading_date.strftime("%Y%m%d")
        url = (
            "https://www.twse.com.tw/fund/T86"
            f"?response=json&date={tw_date}&selectType=ALL"
        )
        async with sem:
            try:
                resp = await client.get(url, timeout=12)
                resp.raise_for_status()
                payload = resp.json()
                if payload.get("stat") != "OK" or not payload.get("data"):
                    return date_key, {}
                day: dict[str, dict[str, int]] = {}
                for row in payload["data"]:
                    sym = str(row[0]).strip()
                    # 只保留純數字代號（排除標頭列或特殊代碼）
                    if not sym or not all(c.isdigit() for c in sym):
                        continue
                    day[sym] = {
                        "foreign": _t86_int(row[4]),   # 外陸資買賣超股數
                        "trust":   _t86_int(row[7]),   # 投信買賣超股數
                        "dealer":  _t86_int(row[8]),   # 自營商買賣超股數
                    }
                return date_key, day
            except Exception as exc:
                logger.debug("[screener] T86 %s failed: %s", trading_date, exc)
                return date_key, {}

    by_symbol: dict[str, dict[str, dict[str, int]]] = {}
    successful = 0

    async with httpx.AsyncClient(
        headers={**_BROWSER_HEADERS, "Referer": "https://www.twse.com.tw/"},
        follow_redirects=True,
    ) as client:
        tasks = [_fetch_one_day(d, client) for d in candidates]
        fetched = await asyncio.gather(*tasks)

    # 只保留有資料的日期，且最多取 n_days 個交易日
    for date_key, day_data in sorted(fetched, key=lambda x: x[0], reverse=True):
        if not day_data:
            continue
        if successful >= n_days:
            break
        successful += 1
        for sym, nets in day_data.items():
            by_symbol.setdefault(sym, {})[date_key] = nets

    logger.info("[screener] T86 bulk: %d trading days, %d symbols", successful, len(by_symbol))
    return by_symbol


# ── Yahoo Finance Chart API v8 直連 ──────────────────────────────────────────

async def _fetch_yf_ohlcv_direct(
    yf_symbol: str,
    client: httpx.AsyncClient,
) -> list[dict]:
    """
    直連 Yahoo Finance v8/chart API（純 httpx，非 yfinance 庫）。
    瀏覽器 UA 大幅降低被 Render IP block 的機率。

    回傳：[{"date": "YYYY-MM-DD", "open": f, "high": f, "low": f, "close": f, "volume": i}, ...]
    """
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_symbol}"
    params = {"interval": "1d", "range": "3mo", "events": ""}
    headers = {**_BROWSER_HEADERS, "Accept": "application/json"}

    try:
        resp = await client.get(url, params=params, headers=headers, timeout=14)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("chart", {}).get("result") or []
        if not results:
            return []
        r         = results[0]
        timestamps = r.get("timestamp") or []
        quote      = (r.get("indicators", {}).get("quote") or [{}])[0]
        opens   = quote.get("open",   [])
        highs   = quote.get("high",   [])
        lows    = quote.get("low",    [])
        closes  = quote.get("close",  [])
        volumes = quote.get("volume", [])

        bars: list[dict] = []
        for i, ts in enumerate(timestamps):
            c = closes[i] if i < len(closes) else None
            if c is None:
                continue
            o = opens[i]   if i < len(opens)   and opens[i]   is not None else c
            h = highs[i]   if i < len(highs)   and highs[i]   is not None else c
            l = lows[i]    if i < len(lows)    and lows[i]    is not None else c
            v = volumes[i] if i < len(volumes) and volumes[i] is not None else 0
            bars.append({
                "date":   datetime.fromtimestamp(ts, tz=_TZ_TAIPEI).date().isoformat(),
                "open":   float(o),
                "high":   float(h),
                "low":    float(l),
                "close":  float(c),
                "volume": int(v),
            })
        return bars

    except Exception as exc:
        logger.debug("[screener] YF direct %s failed: %s", yf_symbol, exc)
        return []


# ── 單檔指標計算 ──────────────────────────────────────────────────────────────

def _compute_metrics(
    symbol: str,
    kline: list[dict],
    by_date: dict[str, dict[str, int]],
) -> Optional[dict]:
    """
    kline   : OHLCV list（已排序）
    by_date : { date_str → { foreign, trust, dealer } }  已解析的法人淨買超
    """
    if len(kline) < 5:
        return None

    closes  = [float(b["close"])  for b in kline]
    volumes = [int(b["volume"])   for b in kline]

    price      = closes[-1]
    prev_close = closes[-2]
    change_pct = round((price - prev_close) / prev_close * 100, 2) if prev_close else 0.0

    ma20_val  = _ma(closes,      20)
    ma20_prev = _ma(closes[:-1], 20)
    ma5_val   = _ma(closes,       5)

    rsi14 = _rsi(closes)
    vol_r = _vol_ratio(volumes)

    recent_20 = closes[-20:] if len(closes) >= 20 else closes
    high20 = max(recent_20)
    low20  = min(recent_20)

    sorted_dates = sorted(by_date.keys())
    f_streak = _streak(by_date, "foreign")
    t_streak = _streak(by_date, "trust")
    d_streak = _streak(by_date, "dealer")

    last_nets = by_date[sorted_dates[-1]] if sorted_dates else {"foreign": 0, "trust": 0, "dealer": 0}

    return {
        "symbol":            symbol,
        "name":              symbol,
        "price":             round(price, 2),
        "change_pct":        change_pct,
        "rsi14":             rsi14,
        "ma20":              round(ma20_val, 2),
        "ma5":               round(ma5_val,  2),
        "vol_ratio":         vol_r,
        "above_ma20":        price > ma20_val,
        "ma20_breakout":     price > ma20_val and closes[-2] <= ma20_prev,
        "near_high20":       price >= high20 * 0.97,
        "near_low20":        price <= low20  * 1.05,
        "foreign_streak":    f_streak,
        "trust_streak":      t_streak,
        "dealer_streak":     d_streak,
        "foreign_net_today": last_nets.get("foreign", 0),
        "trust_net_today":   last_nets.get("trust",   0),
    }


# ── 單檔 fetch（YF 直連 + T86 預載；FinMind 僅 fallback） ─────────────────────

async def _fetch_one(
    symbol: str,
    sem: asyncio.Semaphore,
    yf_client: httpx.AsyncClient,
    inst_by_date: dict[str, dict[str, int]],  # 已從 T86 取得的法人資料
) -> tuple[str, Optional[dict]]:
    async with sem:
        try:
            # ── 1. OHLCV：嘗試 .TW，失敗再試 .TWO，都失敗才用 FinMind ──
            kline = await _fetch_yf_ohlcv_direct(f"{symbol}.TW", yf_client)
            if len(kline) < 10:
                kline = await _fetch_yf_ohlcv_direct(f"{symbol}.TWO", yf_client)
            if len(kline) < 10:
                # FinMind fallback（消耗 1 quota）
                try:
                    from app.services.finmind_service import fetch_daily_kline
                    end   = date.today()
                    start = end - timedelta(days=90)
                    kline = await fetch_daily_kline(symbol, start=start, end=end)
                    logger.debug("[screener] YF fallback→FinMind kline: %s", symbol)
                except Exception as fe:
                    logger.warning("[screener] kline fallback failed %s: %s", symbol, fe)
                    kline = []

            # ── 2. 法人：使用 T86 預載資料；若完全沒有才 FinMind fallback ──
            by_date = inst_by_date
            if not by_date:
                try:
                    from app.services.finmind_service import fetch_institutional
                    end   = date.today()
                    start = end - timedelta(days=30)
                    raw   = await fetch_institutional(symbol, start=start, end=end)
                    by_date = _parse_institutional(raw)
                    logger.debug("[screener] T86 fallback→FinMind inst: %s", symbol)
                except Exception as fe:
                    logger.debug("[screener] inst fallback failed %s: %s", symbol, fe)
                    by_date = {}

            m = _compute_metrics(symbol, kline, by_date)
            return symbol, m

        except Exception as exc:
            logger.warning("[screener] skip %s — %s", symbol, exc)
            return symbol, None


# ── 快取刷新 ──────────────────────────────────────────────────────────────────

async def refresh_cache(universe: Optional[list[str]] = None) -> None:
    global _metrics, _updated_at, _is_refreshing
    if _is_refreshing:
        return
    async with _refresh_lock:
        if not _is_stale():
            return
        _is_refreshing = True
        try:
            pool = universe or _UNIVERSE

            # ── Step 1：TWSE T86 批量法人（約 20 次 HTTP，全市場） ───────────
            t86_data = await _fetch_t86_bulk(n_days=20)

            # ── Step 2：YF 直連 OHLCV（127 次 httpx，共用同一個 client） ────
            sem = asyncio.Semaphore(20)   # YF 較寬鬆，20 並行
            async with httpx.AsyncClient(
                headers=_BROWSER_HEADERS,
                follow_redirects=True,
                timeout=16,
            ) as yf_client:
                tasks = [
                    _fetch_one(s, sem, yf_client, t86_data.get(s, {}))
                    for s in pool
                ]
                results = await asyncio.gather(*tasks)

            # ── Step 3：補股票名稱（TWSE 一次 bulk，失敗不影響核心） ─────────
            names: dict[str, str] = {}
            try:
                from app.services.twse_fetcher import fetch_quotes
                quotes = await fetch_quotes(pool)
                names  = {s: q.get("name", s) for s, q in quotes.items()}
            except Exception as e:
                logger.warning("[screener] name fetch failed: %s", e)

            new_metrics: dict[str, dict] = {}
            for sym, m in results:
                if m is not None:
                    if sym in names:
                        m["name"] = names[sym]
                    new_metrics[sym] = m

            _metrics    = new_metrics
            _updated_at = time.time()
            logger.info(
                "[screener] cache refreshed: %d / %d stocks (T86: %d syms)",
                len(_metrics), len(pool), len(t86_data),
            )
        finally:
            _is_refreshing = False

        pool = universe or _UNIVERSE
        asyncio.create_task(_trigger_fund_refresh(pool))


async def _trigger_fund_refresh(pool: list[str]) -> None:
    """背景刷新基本面快取（失敗不影響主流程）"""
    try:
        from app.services.fundamental_cache_service import refresh_fund_cache
        await refresh_fund_cache(pool)
    except Exception as exc:
        logger.warning("[screener] fundamental cache refresh failed: %s", exc)


async def get_metrics() -> dict[str, dict]:
    """
    取得快取指標（技術面 + 基本面合併）；
    若技術面過期則同步刷新；基本面採非阻塞方式（缺資料回傳 None 欄位）
    """
    if not _metrics or _is_stale():
        await refresh_cache()

    try:
        from app.services.fundamental_cache_service import get_fund_data
        fund = get_fund_data()
    except Exception:
        fund = {}

    if not fund:
        return _metrics

    merged: dict[str, dict] = {}
    for sym, m in _metrics.items():
        fd = fund.get(sym, {})
        merged[sym] = {
            **m,
            "pe":             fd.get("pe"),
            "dividend_yield": fd.get("dividend_yield"),
            "gross_margin":   fd.get("gross_margin"),
            "market_cap_b":   fd.get("market_cap_b"),
            "roe":            fd.get("roe"),
            "eps_growth":     fd.get("eps_growth"),
            "revenue_growth": fd.get("revenue_growth"),
        }
    return merged
