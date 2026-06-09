"""
台灣證券交易所（TWSE）開放資料統一封裝

四個主要 endpoint：
- T86         三大法人買賣超（全市場，bulk）
- STOCK_DAY_ALL 全市場每日收盤量價（bulk）
- BWIBBU_d   全市場本益比 / 殖利率 / 股價淨值比（bulk）
- MIS        即時報價（單檔，盤中用）

所有 endpoint 都是免費、無 quota、官方資料。
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)
_TZ_TAIPEI = ZoneInfo("Asia/Taipei")

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}


def _twse_int(s) -> int:
    """TWSE 數字常含逗號 / '--' / 全形字元，安全轉 int"""
    if s is None:
        return 0
    if isinstance(s, (int, float)):
        return int(s)
    s = str(s).strip().replace(",", "").replace("--", "0").replace("−", "-")
    if not s or s == "-":
        return 0
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return 0


def _twse_num(s) -> float | None:
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip().replace(",", "").replace("--", "")
    if not s or s == "-":
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _last_n_trading_days(n: int, ref: date | None = None) -> list[date]:
    """回傳最近 N 個非週末日期（不保證一定是交易日，碰假日上層自行 skip）"""
    ref = ref or datetime.now(_TZ_TAIPEI).date()
    out: list[date] = []
    d = ref
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return out


# ─────────────────────────────────────────────────────────────
# 1. T86：三大法人買賣超（全市場 bulk，1 call/day）
# ─────────────────────────────────────────────────────────────

T86_URL = "https://www.twse.com.tw/fund/T86"


async def fetch_t86_for_date(target: date) -> dict[str, dict[str, int]]:
    """
    取得指定日期全市場三大法人買賣超。
    回傳 {symbol: {foreign_net, trust_net, dealer_net}}
    碰非交易日 / 資料未更新 → 回傳空 dict
    """
    params = {
        "response": "json",
        "date": target.strftime("%Y%m%d"),
        "selectType": "ALL",
    }
    try:
        async with httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            follow_redirects=True,
            timeout=20,
        ) as client:
            resp = await client.get(T86_URL, params=params)
            if resp.status_code != 200:
                return {}
            data = resp.json()
    except Exception as e:
        logger.warning("[twse.t86] %s failed: %s", target, e)
        return {}

    if data.get("stat") != "OK":
        return {}

    fields: list[str] = data.get("fields", [])
    rows: list[list] = data.get("data", [])
    if not rows or not fields:
        return {}

    # T86 schema：[證券代號, 證券名稱, 外陸資買進股數, 外陸資賣出股數, 外陸資買賣超股數,
    #               外資自營買, 外資自營賣, 外資自營買賣超, 投信買, 投信賣, 投信買賣超,
    #               自營商買賣超, 自營商買, 自營商賣, 自營商買賣超(自行買賣),
    #               自營商買(避險), 自營商賣(避險), 自營商買賣超(避險), 三大法人買賣超股數]
    # 不同年份欄位數會變，所以我們用「名稱」對位最穩
    def _idx(name_contains: str) -> int | None:
        for i, name in enumerate(fields):
            if name_contains in name:
                return i
        return None

    idx_symbol  = 0
    idx_foreign = _idx("外陸資買賣超")
    idx_trust   = _idx("投信買賣超")
    idx_dealer  = _idx("自營商買賣超股數")  # 自營商總計
    if idx_dealer is None:
        # 較舊版 schema：用 "自營商買賣超" 第一個出現的
        idx_dealer = _idx("自營商買賣超")

    result: dict[str, dict[str, int]] = {}
    for row in rows:
        if not row or len(row) <= max(idx_foreign or 0, idx_trust or 0, idx_dealer or 0):
            continue
        sym = str(row[idx_symbol]).strip()
        if not sym:
            continue
        result[sym] = {
            "foreign_net": _twse_int(row[idx_foreign]) if idx_foreign is not None else 0,
            "trust_net":   _twse_int(row[idx_trust])   if idx_trust   is not None else 0,
            "dealer_net":  _twse_int(row[idx_dealer])  if idx_dealer  is not None else 0,
        }
    return result


@ttl_cache(ttl=600)
async def fetch_t86_latest() -> tuple[date | None, dict[str, dict[str, int]]]:
    """
    回傳「最近一個有資料」的 T86 全市場法人。
    最多往前找 6 個非週末日。
    """
    for d in _last_n_trading_days(6):
        data = await fetch_t86_for_date(d)
        if data:
            return d, data
    return None, {}


# ─────────────────────────────────────────────────────────────
# 2. STOCK_DAY_ALL：全市場每日收盤量價（bulk，1 call/day）
# ─────────────────────────────────────────────────────────────

STOCK_DAY_ALL_URL = "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL"


@ttl_cache(ttl=600)
async def fetch_stock_day_all() -> list[dict]:
    """
    全市場上市股票當日收盤 OHLCV。
    回傳：[{symbol, name, close, volume, change}]
    """
    try:
        async with httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            follow_redirects=True,
            timeout=25,
        ) as client:
            resp = await client.get(STOCK_DAY_ALL_URL)
            if resp.status_code != 200:
                return []
            data = resp.json()
    except Exception as e:
        logger.warning("[twse.stock_day_all] failed: %s", e)
        return []

    if data.get("stat") != "OK":
        return []

    out: list[dict] = []
    for row in data.get("data", []):
        if not row or len(row) < 9:
            continue
        sym = str(row[0]).strip()
        if not sym:
            continue
        out.append({
            "symbol": sym,
            "name":   row[1],
            "volume": _twse_int(row[2]),       # 成交股數
            "open":   _twse_num(row[4]),
            "high":   _twse_num(row[5]),
            "low":    _twse_num(row[6]),
            "close":  _twse_num(row[7]),
            "change": _twse_num(row[8]),
        })
    return out


# ─────────────────────────────────────────────────────────────
# 3. BWIBBU_d：全市場本益比 / 殖利率 / 股價淨值比（bulk，1 call/day）
# ─────────────────────────────────────────────────────────────

BWIBBU_URL = "https://www.twse.com.tw/exchangeReport/BWIBBU_d"


@ttl_cache(ttl=600)
async def fetch_bwibbu_all() -> dict[str, dict]:
    """
    全市場 P/E、殖利率、P/B。
    回傳 {symbol: {pe_ratio, dividend_yield, pb_ratio}}
    """
    try:
        async with httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            follow_redirects=True,
            timeout=20,
        ) as client:
            resp = await client.get(BWIBBU_URL, params={"response": "json"})
            if resp.status_code != 200:
                return {}
            data = resp.json()
    except Exception as e:
        logger.warning("[twse.bwibbu] failed: %s", e)
        return {}

    if data.get("stat") != "OK":
        return {}

    # 欄位順序：證券代號, 證券名稱, 殖利率, 股利年度, 本益比, 股價淨值比, ...
    out: dict[str, dict] = {}
    for row in data.get("data", []):
        if not row or len(row) < 6:
            continue
        sym = str(row[0]).strip()
        if not sym:
            continue
        out[sym] = {
            "dividend_yield": _twse_num(row[2]),
            "pe_ratio":       _twse_num(row[4]),
            "pb_ratio":       _twse_num(row[5]),
        }
    return out


# ─────────────────────────────────────────────────────────────
# 4. MIS：即時報價（盤中，單檔或多檔）
# ─────────────────────────────────────────────────────────────

MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"


@ttl_cache(ttl=15)
async def fetch_mis_quote(symbols: tuple[str, ...]) -> dict[str, dict]:
    """
    即時報價（盤中 15s TTL）。symbols 必須是 tuple 以利 cache key。
    回傳 {symbol: {price, change, volume, time}}
    """
    if not symbols:
        return {}
    ex_chs = "|".join(f"tse_{s}.tw" for s in symbols)
    try:
        async with httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            timeout=12,
        ) as client:
            resp = await client.get(MIS_URL, params={"ex_ch": ex_chs, "json": "1"})
            if resp.status_code != 200:
                return {}
            data = resp.json()
    except Exception as e:
        logger.warning("[twse.mis] %s failed: %s", symbols, e)
        return {}

    out: dict[str, dict] = {}
    for row in data.get("msgArray", []):
        sym = row.get("c") or ""
        if not sym:
            continue
        out[sym] = {
            "price":  _twse_num(row.get("z")) or _twse_num(row.get("y")),
            "open":   _twse_num(row.get("o")),
            "high":   _twse_num(row.get("h")),
            "low":    _twse_num(row.get("l")),
            "prev":   _twse_num(row.get("y")),
            "volume": _twse_int(row.get("v")),
            "time":   row.get("t"),
        }
    return out


# ─────────────────────────────────────────────────────────────
# 5. 加權指數即時（TAIEX，MIS endpoint）
# ─────────────────────────────────────────────────────────────

@ttl_cache(ttl=15)
async def fetch_taiex_quote() -> dict | None:
    """加權指數即時報價"""
    try:
        async with httpx.AsyncClient(headers=_BROWSER_HEADERS, timeout=10) as client:
            resp = await client.get(
                MIS_URL,
                params={"ex_ch": "tse_t00.tw", "json": "1"},
            )
            data = resp.json()
        rows = data.get("msgArray", [])
        if not rows:
            return None
        r = rows[0]
        price = _twse_num(r.get("z")) or _twse_num(r.get("y"))
        prev  = _twse_num(r.get("y"))
        if price is None or prev is None:
            return None
        return {
            "price":     price,
            "prev":      prev,
            "change":    round(price - prev, 2),
            "change_pct": round((price - prev) / prev * 100, 2) if prev else None,
        }
    except Exception as e:
        logger.warning("[twse.taiex] failed: %s", e)
        return None
