"""
選股器服務

股票池：台灣主要上市股 ~127 檔
  半導體 / IC / 電子 / 電信 / 金融 / 傳產 / 高殖利率 / 生技 / ETF
快取 TTL：30 分鐘（技術面）/ 24h（基本面）
並行策略：asyncio.Semaphore(10) — 保護 FinMind API，避免 rate-limit

技術指標
  rsi14        : Wilder RSI-14
  ma20         : 20 日均線（算術）
  ma5          : 5 日均線
  vol_ratio    : 今日量 / 前 20 日均量
  above_ma20   : 收盤 > MA20
  ma20_breakout: 今日突破 MA20（昨收 <= MA20 且今收 > MA20）
  near_high20  : 收盤在 20 日高點 97% 以上
  near_low20   : 收盤在 20 日低點 105% 以下
  foreign_streak / trust_streak / dealer_streak : 連續買超/賣超天數
  foreign_net_today / trust_net_today : 最新一日法人淨買量

基本面指標（yfinance，24h TTL）
  pe             : 本益比（trailing P/E）
  dividend_yield : 殖利率 %
  gross_margin   : 毛利率 %
  market_cap_b   : 市值（億台幣）
  roe            : ROE %
  eps_growth     : EPS 年成長率 %
  revenue_growth : 年營收成長率 %
"""

import asyncio
import logging
import time
from datetime import date, timedelta
from typing import Optional

from app.services.finmind_service import fetch_daily_kline, fetch_institutional

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
_metrics:     dict[str, dict] = {}   # symbol → 已計算指標
_updated_at:  float           = 0.0  # epoch seconds
_CACHE_TTL                    = 1800  # 30 分鐘
_refresh_lock = asyncio.Lock()
_is_refreshing = False


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


# ── 法人籌碼解析 ──────────────────────────────────────────────────────────────

_FOREIGN_NAMES = {"Foreign_Investor", "Foreign_Dealer_Self"}
_TRUST_NAMES   = {"Investment_Trust"}
_DEALER_NAMES  = {"Dealer_self", "Dealer_Hedging"}


def _parse_institutional(raw: list[dict]) -> dict:
    """
    將 FinMind 逐筆法人資料聚合成：
      { date: { foreign: net, trust: net, dealer: net } }
    再返回：{ date_list, nets_by_cat }
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


# ── 單檔指標計算 ──────────────────────────────────────────────────────────────

def _compute_metrics(symbol: str, kline: list[dict], inst_raw: list[dict]) -> Optional[dict]:
    if len(kline) < 5:
        return None

    closes  = [float(b["close"])  for b in kline]
    volumes = [int(b["volume"])   for b in kline]

    price      = closes[-1]
    prev_close = closes[-2]
    change_pct = round((price - prev_close) / prev_close * 100, 2) if prev_close else 0.0

    ma20_val  = _ma(closes,      20)
    ma20_prev = _ma(closes[:-1], 20)   # 昨日 MA20
    ma5_val   = _ma(closes,       5)

    rsi14   = _rsi(closes)
    vol_r   = _vol_ratio(volumes)

    recent_20 = closes[-20:] if len(closes) >= 20 else closes
    high20    = max(recent_20)
    low20     = min(recent_20)

    by_date = _parse_institutional(inst_raw)
    sorted_dates = sorted(by_date.keys())

    f_streak = _streak(by_date, "foreign")
    t_streak = _streak(by_date, "trust")
    d_streak = _streak(by_date, "dealer")

    if sorted_dates:
        last_nets = by_date[sorted_dates[-1]]
    else:
        last_nets = {"foreign": 0, "trust": 0, "dealer": 0}

    return {
        "symbol":            symbol,
        "name":              symbol,            # 由 refresh_cache 覆寫
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


# ── 快取刷新 ──────────────────────────────────────────────────────────────────

async def _fetch_one(symbol: str, sem: asyncio.Semaphore) -> tuple[str, Optional[dict]]:
    async with sem:
        try:
            end   = date.today()
            start = end - timedelta(days=60)
            kline, inst = await asyncio.gather(
                fetch_daily_kline(symbol,    start=start, end=end),
                fetch_institutional(symbol,  start=start, end=end),
            )
            m = _compute_metrics(symbol, kline, inst)
            return symbol, m
        except Exception as exc:
            logger.warning("screener: skip %s — %s", symbol, exc)
            return symbol, None


async def refresh_cache(universe: Optional[list[str]] = None) -> None:
    global _metrics, _updated_at, _is_refreshing
    if _is_refreshing:
        return
    async with _refresh_lock:
        if not _is_stale():          # double-check after acquiring lock
            return
        _is_refreshing = True
        try:
            pool = universe or _UNIVERSE
            sem  = asyncio.Semaphore(10)
            tasks   = [_fetch_one(s, sem) for s in pool]
            results = await asyncio.gather(*tasks)

            # 嘗試從 TWSE 取得股票名稱（失敗不影響核心功能）
            names: dict[str, str] = {}
            try:
                from app.services.twse_fetcher import fetch_quotes
                quotes = await fetch_quotes(pool)
                names  = {s: q.get("name", s) for s, q in quotes.items()}
            except Exception as e:
                logger.warning("screener: name fetch failed — %s", e)

            new_metrics: dict[str, dict] = {}
            for sym, m in results:
                if m is not None:
                    if sym in names:
                        m["name"] = names[sym]
                    new_metrics[sym] = m

            _metrics    = new_metrics
            _updated_at = time.time()
            logger.info("screener cache refreshed: %d / %d stocks", len(_metrics), len(pool))
        finally:
            _is_refreshing = False

        # 技術面快取刷新後，在背景觸發基本面刷新（不阻塞）
        pool = universe or _UNIVERSE
        asyncio.create_task(_trigger_fund_refresh(pool))


async def _trigger_fund_refresh(pool: list[str]) -> None:
    """背景刷新基本面快取（失敗不影響主流程）"""
    try:
        from app.services.fundamental_cache_service import refresh_fund_cache
        await refresh_fund_cache(pool)
    except Exception as exc:
        logger.warning("fundamental cache refresh failed: %s", exc)


async def get_metrics() -> dict[str, dict]:
    """
    取得快取指標（技術面 + 基本面合併）；
    若技術面過期則同步刷新；基本面採非阻塞方式（缺資料回傳 None 欄位）
    """
    if not _metrics or _is_stale():
        await refresh_cache()

    # 嘗試合併基本面資料（快取未就緒則靜默跳過）
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
