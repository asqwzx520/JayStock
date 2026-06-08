"""
市場資料服務 — M5


提供：
  1. 大盤指數（yfinance：TWII、SPX、DJI、NASDAQ、費半 SOX、那指期貨）
  2. 市場廣度（TWSE afterTrading/MI_INDEX：漲跌家數 / 漲跌停家數）
  3. 產業板塊熱力圖（基於 screener 快取 + 產業分類映射）
  4. 美股單檔報價（yfinance）

快取 TTL：
  indices  — 60 秒（盤中動態）
  breadth  — 5 分鐘（盤後靜態，每日更新一次）
  sectors  — 5 分鐘（同步 screener 快取）
  us_quote — 60 秒
"""

import asyncio
import logging
import re
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── 快取 ────────────────────────────────────────────────────────────────────
_indices_cache: dict = {}
_breadth_cache: dict = {}
_sectors_cache: dict = {}
_us_quote_cache: dict = {}

_INDICES_TTL  = 60
_BREADTH_TTL  = 300
_SECTORS_TTL  = 300
_US_QUOTE_TTL = 60

# ── 指數 metadata ─────────────────────────────────────────────────────────
_INDEX_META: list[dict] = [
    {"id": "TWII",   "ticker": "^TWII",  "name": "台股加權",  "flag": "🇹🇼"},
    {"id": "SP500",  "ticker": "^GSPC",  "name": "S&P 500",   "flag": "🇺🇸"},
    {"id": "DJI",    "ticker": "^DJI",   "name": "道瓊",       "flag": "🇺🇸"},
    {"id": "NASDAQ", "ticker": "^IXIC",  "name": "那斯達克",   "flag": "🇺🇸"},
    {"id": "SOX",    "ticker": "^SOX",   "name": "費半",       "flag": "🔬"},
    {"id": "NQ_F",   "ticker": "NQ=F",   "name": "那指期貨",   "flag": "📈"},
]

# ── 台股產業分類（對應 screener 的 70 股票池）─────────────────────────────
_SECTOR_MAP: dict[str, list[str]] = {
    "半導體":   ["2330","2303","2454","2379","3711","3034","2344","2337","6415","2408","3008"],
    "電子/科技": ["2317","2382","2357","2308","2327","4938","6669","2301","2395","3661","2356","2324"],
    "電信":     ["3045","4904","2412"],
    "金融":     ["2881","2882","2891","2886","2884","2885","2887","2892","2880","5880"],
    "化工/石化": ["1301","1303","1326","6505"],
    "鋼鐵/機械": ["2002","2049","3017"],
    "消費/零售": ["1216","2912","2207"],
    "航運":     ["2603","2609","2615"],
    "光電/面板": ["3481","2409"],
    "傳產/其他": ["2474","2059","8046","3533","2610","2618"],
    "ETF":      ["0050","0056"],
}


# ── yfinance 同步輔助 ─────────────────────────────────────────────────────

def _yf_quote_sync(ticker_sym: str) -> dict:
    """同步取得 yfinance 報價（在 executor 中執行）"""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker_sym)
        fi = t.fast_info
        price      = getattr(fi, "last_price",     None)
        prev_close = getattr(fi, "previous_close", None)
        if price is None or prev_close is None or prev_close == 0:
            return {}
        change     = float(price) - float(prev_close)
        change_pct = change / float(prev_close) * 100
        return {
            "price":      round(float(price),      2),
            "prev_close": round(float(prev_close), 2),
            "change":     round(change,             2),
            "change_pct": round(change_pct,         2),
        }
    except Exception as exc:
        logger.debug("yfinance %s: %s", ticker_sym, exc)
        return {}


# ── 大盤指數 ─────────────────────────────────────────────────────────────────

async def fetch_indices() -> list[dict]:
    """取得各大盤指數（帶 TTL 快取）"""
    now = time.time()
    if _indices_cache.get("data") and now - _indices_cache.get("ts", 0) < _INDICES_TTL:
        return _indices_cache["data"]

    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, _yf_quote_sync, meta["ticker"])
        for meta in _INDEX_META
    ]
    quotes = await asyncio.gather(*tasks, return_exceptions=True)

    results: list[dict] = []
    for meta, q in zip(_INDEX_META, quotes):
        if isinstance(q, Exception) or not q:
            q = {}
        results.append({
            "id":         meta["id"],
            "name":       meta["name"],
            "flag":       meta["flag"],
            "ticker":     meta["ticker"],
            "price":      q.get("price"),
            "change":     q.get("change"),
            "change_pct": q.get("change_pct"),
        })

    _indices_cache["data"] = results
    _indices_cache["ts"]   = now
    return results


# ── 市場廣度 ─────────────────────────────────────────────────────────────────

_TWSE_MI_URL = (
    "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json"
)
_TWSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.twse.com.tw/",
    "Accept-Language": "zh-TW,zh;q=0.9",
}


def _parse_count_paren(s: str) -> tuple[int, int]:
    """
    解析 TWSE 廣度格式 "6,838(528)" → (6838, 528)
    若無括號則返回 (count, 0)
    """
    s = str(s).strip()
    m = re.match(r"^([\d,]+)\(?([\d,]*)\)?", s)
    if not m:
        return 0, 0
    main  = int(m.group(1).replace(",", ""))
    inner = int(m.group(2).replace(",", "")) if m.group(2) else 0
    return main, inner


def _extract_breadth(raw: dict) -> dict:
    """
    從 TWSE afterTrading/MI_INDEX JSON 解析漲跌家數。

    實際格式（2026 年確認）：
      tables[7].data = [
        ['上漲(含漲停)', '6,838(528)', '333(25)'],   # row0: advances
        ['下跌(含跌停)', '6,987(91)',  '672(8)'],    # row1: declines
        ['持平',         '634',         '68'],        # row2: unchanged
        ['上市合計',     '14,390',      '1'],
        ['無成交',       '2,524',       '3'],
      ]
    欄位格式："總家數(漲停/跌停家數)"
    """
    tables = raw.get("tables", [])
    date   = raw.get("date", "")

    # ── 方法 A：試用 table[7]（已知位置）──────────────────────────
    if len(tables) > 7:
        rows = tables[7].get("data", [])
        if len(rows) >= 3:
            try:
                up_main,   lu = _parse_count_paren(rows[0][1])
                dn_main,   ld = _parse_count_paren(rows[1][1])
                flat_main, _  = _parse_count_paren(rows[2][1])
                if up_main > 0 or dn_main > 0:
                    return {
                        "advances":   up_main,
                        "declines":   dn_main,
                        "unchanged":  flat_main,
                        "limit_up":   lu,
                        "limit_down": ld,
                        "total":      up_main + dn_main + flat_main,
                        "date":       date,
                    }
            except (IndexError, ValueError):
                pass

    # ── 方法 B：遍歷所有 table，找 3+ 行且每行有括號的格式 ───────
    for tbl in tables:
        rows = tbl.get("data", [])
        if len(rows) < 3:
            continue
        try:
            up_main,   lu = _parse_count_paren(rows[0][1])
            dn_main,   ld = _parse_count_paren(rows[1][1])
            flat_main, _  = _parse_count_paren(rows[2][1])
            if up_main > 100 and dn_main > 100:  # 合理性檢查
                return {
                    "advances":   up_main,
                    "declines":   dn_main,
                    "unchanged":  flat_main,
                    "limit_up":   lu,
                    "limit_down": ld,
                    "total":      up_main + dn_main + flat_main,
                    "date":       date,
                }
        except (IndexError, ValueError):
            continue

    return {}


async def fetch_market_breadth() -> dict:
    """取得市場廣度（漲跌家數 / 漲跌停家數）"""
    now = time.time()
    if _breadth_cache.get("data") and now - _breadth_cache.get("ts", 0) < _BREADTH_TTL:
        return _breadth_cache["data"]

    breadth: dict = {}
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(_TWSE_MI_URL, headers=_TWSE_HEADERS)
            resp.raise_for_status()
            raw = resp.json()
            breadth = _extract_breadth(raw)
    except Exception as exc:
        logger.warning("market breadth TWSE fetch failed: %s", exc)

    # ── Fallback：從 screener 快取近似計算 ──────────────────────────
    if not breadth:
        breadth = await _breadth_from_screener()

    if breadth:
        _breadth_cache["data"] = breadth
        _breadth_cache["ts"]   = now

    return breadth


async def _breadth_from_screener() -> dict:
    """
    fallback：從 screener 快取計算近似廣度。
    只使用 _metrics（已快取），不觸發新的 refresh（避免長等待）。
    """
    try:
        # 直接存取模組層級的 _metrics，不呼叫 get_metrics()
        from app.services import screener_service  # type: ignore
        metrics: dict = screener_service._metrics  # type: ignore[attr-defined]
        if not metrics:
            return {}
        up   = sum(1 for m in metrics.values() if m.get("change_pct", 0) > 0)
        dn   = sum(1 for m in metrics.values() if m.get("change_pct", 0) < 0)
        flat = sum(1 for m in metrics.values() if m.get("change_pct", 0) == 0)
        lu   = sum(1 for m in metrics.values() if m.get("change_pct", 0) >= 9.5)
        ld   = sum(1 for m in metrics.values() if m.get("change_pct", 0) <= -9.5)
        return {
            "advances":   up,
            "declines":   dn,
            "unchanged":  flat,
            "limit_up":   lu,
            "limit_down": ld,
            "total":      up + dn + flat,
            "date":       "",
            "source":     "screener_approx",  # 標示為近似值
        }
    except Exception as exc:
        logger.warning("breadth fallback failed: %s", exc)
        return {}


# ── 產業板塊熱力圖 ───────────────────────────────────────────────────────────

async def fetch_sector_heatmap() -> list[dict]:
    """計算各產業板塊平均漲跌幅（使用 screener 快取）"""
    now = time.time()
    if _sectors_cache.get("data") and now - _sectors_cache.get("ts", 0) < _SECTORS_TTL:
        return _sectors_cache["data"]

    try:
        # 直接讀取已快取的 _metrics，不觸發刷新
        from app.services import screener_service  # type: ignore
        metrics: dict = screener_service._metrics  # type: ignore[attr-defined]
    except Exception as exc:
        logger.warning("sector heatmap: screener metrics unavailable — %s", exc)
        metrics = {}

    sectors: list[dict] = []
    for sector_name, syms in _SECTOR_MAP.items():
        changes: list[float] = []
        stocks_info: list[dict] = []

        for sym in syms:
            m = metrics.get(sym)
            if not m:
                continue
            pct = float(m.get("change_pct", 0.0))
            changes.append(pct)
            stocks_info.append({
                "symbol":     sym,
                "name":       m.get("name", sym),
                "change_pct": pct,
                "price":      m.get("price", 0),
                "vol_ratio":  m.get("vol_ratio", 1.0),
            })

        if not changes:
            sectors.append({
                "name":       sector_name,
                "avg_change": 0.0,
                "advances":   0,
                "declines":   0,
                "unchanged":  0,
                "total":      0,
                "stocks":     [],
            })
            continue

        avg = sum(changes) / len(changes)
        sectors.append({
            "name":       sector_name,
            "avg_change": round(avg, 2),
            "advances":   sum(1 for c in changes if c > 0),
            "declines":   sum(1 for c in changes if c < 0),
            "unchanged":  sum(1 for c in changes if c == 0),
            "total":      len(changes),
            "stocks":     sorted(stocks_info, key=lambda x: x["change_pct"], reverse=True),
        })

    sectors.sort(key=lambda x: x["avg_change"], reverse=True)

    if sectors:
        _sectors_cache["data"] = sectors
        _sectors_cache["ts"]   = now

    return sectors


# ── 熱門排行 ─────────────────────────────────────────────────────────────────

_ranking_cache: dict = {}
_RANKING_TTL = 180  # 3 分鐘快取

# 排行股票池（市值前 150，覆蓋 90%+ 市場成交量）
_RANKING_POOL: list[str] = [
    "2330","2317","2454","2881","2882","2891","2886","2308","3711","2303",
    "2412","1301","1303","2002","2207","2382","4938","6505","0050","2603",
    "2884","2885","2880","5880","2890","2892","3008","2379","2357","2395",
    "3034","2344","2337","6415","2408","3661","2356","2324","3045","4904",
    "1216","2912","3481","2409","2474","2059","8046","3533","2610","2618",
    "2049","3017","2609","2615","1326","6669","2301","2327","0056","5871",
    "2376","2385","6278","3231","2353","2360","2377","3006","2369","3702",
    "4919","3044","2441","6116","2429","5904","1590","2345","4958","8299",
    "3037","4966","6763","2347","3443","2383","6510","5483","6270","3706",
    "2388","3004","2393","6770","3596","3443","2360","2377","6669","3008",
    "2347","6415","2344","3034","2337","4938","3661","2356","2324","2395",
    "4904","3045","2891","2886","2884","2885","2887","2892","5880","1326",
    "2612","5876","2801","2820","2867","5876","2823","2824","2834","2836",
    "2838","2845","2847","2849","2851","2855","2856","2858","2867","2880",
]

_MIS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://mis.twse.com.tw/",
}
_MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"


async def _fetch_batch_quotes(symbols: list[str]) -> dict[str, dict]:
    """批次從 mis.twse 抓取即時報價，每批最多 50 檔"""
    result: dict[str, dict] = {}
    BATCH = 50
    async with httpx.AsyncClient(timeout=10) as client:
        for i in range(0, len(symbols), BATCH):
            batch = symbols[i:i + BATCH]
            ex_ch = "|".join(f"tse_{s}.tw" for s in batch)
            try:
                resp = await client.get(
                    _MIS_URL, params={"ex_ch": ex_ch}, headers=_MIS_HEADERS
                )
                resp.raise_for_status()
                data = resp.json()
                for item in data.get("msgArray", []):
                    sym = item.get("c", "")
                    if not sym:
                        continue
                    try:
                        z = item.get("z", "-")
                        y = item.get("y", "0")
                        price    = float(z) if z and z != "-" else float(y)
                        prev     = float(y) if y and y != "-" else price
                        chg      = round(price - prev, 2)
                        chg_pct  = round(chg / prev * 100, 2) if prev else 0.0
                        vol      = int(item.get("v", 0) or 0)
                        result[sym] = {
                            "symbol":     sym,
                            "name":       item.get("n", sym),
                            "price":      price,
                            "change":     chg,
                            "change_pct": chg_pct,
                            "volume":     vol,
                        }
                    except (ValueError, TypeError):
                        continue
            except Exception as exc:
                logger.debug("ranking batch fetch error: %s", exc)
    return result


async def fetch_market_ranking() -> dict:
    """
    取得熱門排行：漲幅 Top 20 / 跌幅 Top 20 / 爆量 Top 20
    快取 3 分鐘，使用 screener 快取 + mis.twse 雙來源
    """
    now = time.time()
    if _ranking_cache.get("data") and now - _ranking_cache.get("ts", 0) < _RANKING_TTL:
        return _ranking_cache["data"]

    # ── 1. 先嘗試從 screener _metrics 取得（有 vol_ratio）────────────────
    merged: dict[str, dict] = {}
    try:
        from app.services import screener_service  # type: ignore
        metrics: dict = screener_service._metrics  # type: ignore[attr-defined]
        for sym, m in metrics.items():
            merged[sym] = {
                "symbol":     sym,
                "name":       m.get("name", sym),
                "price":      m.get("price", 0.0),
                "change":     0.0,
                "change_pct": m.get("change_pct", 0.0),
                "volume":     m.get("volume", 0),
                "vol_ratio":  m.get("vol_ratio", 1.0),
            }
    except Exception as exc:
        logger.debug("ranking: screener metrics unavailable — %s", exc)

    # ── 2. 補全排行池（mis.twse 批次）────────────────────────────────────
    missing = [s for s in _RANKING_POOL if s not in merged]
    if missing:
        try:
            batch_quotes = await _fetch_batch_quotes(missing)
            for sym, q in batch_quotes.items():
                if sym not in merged:
                    merged[sym] = {**q, "vol_ratio": 1.0}
        except Exception as exc:
            logger.debug("ranking: batch fetch failed — %s", exc)

    if not merged:
        return {}

    all_stocks = list(merged.values())

    def _top(items: list[dict], key: str, reverse: bool, n: int = 20) -> list[dict]:
        valid = [s for s in items if s.get(key) is not None]
        return sorted(valid, key=lambda x: x[key], reverse=reverse)[:n]

    result = {
        "gainers":    _top(all_stocks, "change_pct", True),
        "losers":     _top(all_stocks, "change_pct", False),
        "volume":     _top(all_stocks, "vol_ratio",  True),
        "updated_at": time.strftime("%H:%M:%S", time.localtime(now)),
    }

    _ranking_cache["data"] = result
    _ranking_cache["ts"]   = now
    return result


# ── 美股報價（單檔）─────────────────────────────────────────────────────────

async def fetch_us_quote(symbol: str) -> Optional[dict]:
    """使用 yfinance 取得美股個股報價"""
    sym_upper = symbol.upper()
    now = time.time()

    cached = _us_quote_cache.get(sym_upper)
    if cached and now - cached.get("ts", 0) < _US_QUOTE_TTL:
        return cached["data"]

    loop = asyncio.get_event_loop()
    q = await loop.run_in_executor(None, _yf_quote_sync, sym_upper)
    if not q:
        return None

    # 嘗試取得額外 metadata（公司名稱、市值）
    def _get_meta(sym: str) -> dict:
        try:
            import yfinance as yf
            t = yf.Ticker(sym)
            fi = t.fast_info
            return {
                "short_name": getattr(fi, "exchange",      ""),
                "currency":   getattr(fi, "currency",      "USD"),
                "market_cap": getattr(fi, "market_cap",    None),
                "volume":     getattr(fi, "last_volume",   None),
            }
        except Exception:
            return {}

    meta = await loop.run_in_executor(None, _get_meta, sym_upper)

    result = {
        "symbol":     sym_upper,
        "price":      q["price"],
        "change":     q["change"],
        "change_pct": q["change_pct"],
        "prev_close": q["prev_close"],
        **meta,
    }

    _us_quote_cache[sym_upper] = {"data": result, "ts": now}
    return result


# ── 個股新聞 ─────────────────────────────────────────────────────────────────

_news_cache: dict = {}
_NEWS_TTL = 600  # 10 分鐘快取

# ── 新聞重要度評分 ────────────────────────────────────────────────────────────
_NEWS_HIGH_KEYWORDS = [
    # 個股財務直接事件
    "法說", "財報", "eps", "除息", "除權", "配息", "股利",
    "漲停", "跌停", "停牌", "下市", "重大訊息", "盈餘", "虧損",
    # 國際總經衝擊
    "非農", "gdp", "cpi", "pce", "fed", "聯準會",
    "升息", "降息", "利率決策", "貨幣政策",
    "標普", "道瓊", "那斯達克", "大跌", "暴跌", "崩盤", "熊市",
    "nvidia", "輝達", "apple", "蘋果", "tesla", "特斯拉",
    "巴菲特", "破產", "倒閉", "收購", "併購",
]
_NEWS_MID_KEYWORDS = [
    "半導體", "晶圓", "ai", "人工智慧",
    "法人", "買超", "賣超", "外資", "投信", "自營商",
    "產業", "供應鏈", "景氣", "出口", "製造業",
]

import re as _re_news

def _is_chinese(text: str) -> bool:
    """判斷字串是否含中文字元。"""
    return bool(_re_news.search(r'[一-鿿]', text))

def _score_importance(title: str, publisher: str) -> str:
    """根據標題與來源評估新聞重要度：高 / 中 / 低。"""
    combined = (title + " " + publisher).lower()
    if any(k.lower() in combined for k in _NEWS_HIGH_KEYWORDS):
        return "高"
    if any(k.lower() in combined for k in _NEWS_MID_KEYWORDS):
        return "中"
    return "低"


def _parse_news_item(item: dict) -> dict:
    """
    相容新舊 yfinance 新聞格式：
    - 舊版（<0.2.37）：flat  {title, publisher, link, providerPublishTime, thumbnail}
    - 新版（>=0.2.37）：巢狀 {content: {title, pubDate, provider, canonicalUrl, thumbnail}}
    """
    content = item.get("content") or {}
    if content:
        # ── 新格式 ───────────────────────────────────────────────
        thumb = None
        thumb_data = content.get("thumbnail") or {}
        if thumb_data:
            resolutions = thumb_data.get("resolutions", [])
            if resolutions:
                thumb = resolutions[-1].get("url")
            elif thumb_data.get("originalUrl"):
                thumb = thumb_data["originalUrl"]

        published_at = 0
        pub_str = content.get("pubDate", "")
        if pub_str:
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
                published_at = int(dt.timestamp())
            except Exception:
                pass

        provider   = content.get("provider") or {}
        canonical  = content.get("canonicalUrl") or {}
        clickthrough = content.get("clickThroughUrl") or {}
        title_val     = content.get("title", "") or item.get("title", "")
        publisher_val = provider.get("displayName", "") or item.get("publisher", "")
        return {
            "title":        title_val,
            "publisher":    publisher_val,
            "link":         canonical.get("url", "") or clickthrough.get("url", "") or item.get("link", ""),
            "published_at": published_at or item.get("providerPublishTime", 0),
            "thumbnail":    thumb,
            "type":         item.get("type", "STORY"),
            "importance":   _score_importance(title_val, publisher_val),
            "is_chinese":   _is_chinese(title_val),
        }
    else:
        # ── 舊格式 ───────────────────────────────────────────────
        thumb = None
        if item.get("thumbnail"):
            resolutions = item["thumbnail"].get("resolutions", [])
            if resolutions:
                thumb = resolutions[-1].get("url")
        title_val     = item.get("title", "")
        publisher_val = item.get("publisher", "")
        return {
            "title":        title_val,
            "publisher":    publisher_val,
            "link":         item.get("link", ""),
            "published_at": item.get("providerPublishTime", 0),
            "thumbnail":    thumb,
            "type":         item.get("type", "STORY"),
            "importance":   _score_importance(title_val, publisher_val),
            "is_chinese":   _is_chinese(title_val),
        }


def _fetch_news_sync(ticker_sym: str) -> list[dict]:
    """
    同步從 yfinance 抓個股新聞（在 executor 執行）。
    yfinance 1.x 新增 get_news()；舊版用 .news 屬性。
    兩者都嘗試，取非空的那個。
    """
    try:
        import yfinance as yf
        t = yf.Ticker(ticker_sym)

        raw: list = []

        # ① 優先用新 API（yfinance >=0.2.x / 1.x）
        try:
            result = t.get_news(count=20)
            if isinstance(result, list) and result:
                raw = result
        except Exception:
            pass

        # ② fallback：舊版 .news 屬性
        if not raw:
            try:
                legacy = t.news
                if isinstance(legacy, list) and legacy:
                    raw = legacy
            except Exception:
                pass

        logger.debug("news fetch %s: got %d items", ticker_sym, len(raw))
        return [_parse_news_item(item) for item in raw[:20]]
    except Exception as exc:
        logger.debug("news fetch %s error: %s", ticker_sym, exc)
        return []


async def fetch_stock_news(symbol: str) -> list[dict]:
    """
    取得個股新聞（yfinance）
    台股加 .TW 後綴；美股直接用原代碼。
    快取 TTL：10 分鐘
    """
    key = symbol.upper()
    now = time.time()
    cached = _news_cache.get(key)
    if cached and now - cached.get("ts", 0) < _NEWS_TTL:
        return cached["data"]

    # 台股代碼：4~6 位數字（可帶 1 個英文後綴），如 2330、0050、00878、00631L
    import re as _re
    ticker_sym = f"{symbol}.TW" if _re.match(r"^\d{4,6}[A-Za-z]?$", symbol) else symbol.upper()
    loop = asyncio.get_event_loop()
    news = await loop.run_in_executor(None, _fetch_news_sync, ticker_sym)

    _news_cache[key] = {"data": news, "ts": now}
    return news
