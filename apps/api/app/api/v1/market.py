import time
import asyncio
import logging
from datetime import date, timedelta
from fastapi import APIRouter, Query, HTTPException, Request
import httpx
from app.services.stock_list import search_stocks, get_stock_list
from app.services.finmind_service import fetch_institutional
from app.services.market_service import (
    fetch_indices,
    fetch_market_breadth,
    fetch_sector_heatmap,
    fetch_market_ranking,
)
from app.core.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# ── simple in-memory cache (5 min TTL) ───────────────────────────────────────
_chips_cache: dict = {}
_CACHE_TTL = 300

# ── Curated major Taiwan stocks (TAIEX top 30 + popular ETFs) ────────────────
_MAJOR_STOCKS = [
    "2330", "2317", "2454", "2881", "2882", "2891", "2886",
    "2308", "3711", "2303", "2412", "1301", "1303", "2002",
    "2207", "2382", "4938", "6505", "0050", "2603",
    "2884", "2885", "2880", "5871", "2890", "2892",
    "3008", "2379", "2357", "2395",
]

@router.get("/market/indices")
@limiter.limit("30/minute")
async def get_market_indices(request: Request):
    """
    取得大盤指數（台股加權 + 美股三大指數 + 那指期貨 + 費半）
    資料來源：Yahoo Finance（yfinance）
    """
    data = await fetch_indices()
    return {"indices": data}


@router.get("/market/breadth")
@limiter.limit("30/minute")
async def get_market_breadth(request: Request):
    """
    取得市場廣度統計：漲跌家數、漲停/跌停家數
    資料來源：TWSE afterTrading/MI_INDEX（盤後），fallback 為 screener 近似值
    """
    data = await fetch_market_breadth()
    if not data:
        raise HTTPException(status_code=503, detail="Market breadth data temporarily unavailable")
    return data


@router.get("/market/sectors")
@limiter.limit("30/minute")
async def get_sector_heatmap(request: Request):
    """
    取得各產業板塊熱力圖資料（平均漲跌幅 + 漲跌家數）
    基於 screener 快取的 70 檔股票，分 11 個產業計算
    """
    data = await fetch_sector_heatmap()
    return {"sectors": data}


@router.get("/market/search")
@limiter.limit("60/minute")
async def stock_search(
    request: Request,
    q: str = Query(..., min_length=1, description="Search query (symbol or name)"),
    limit: int = Query(20, ge=1, le=50),
):
    results = await search_stocks(q, limit)
    return {"query": q, "count": len(results), "data": results}


_FOREIGN = {"Foreign_Investor", "Foreign_Dealer_Self"}
_TRUST   = {"Investment_Trust"}
_DEALER  = {"Dealer_self", "Dealer_Hedging"}


def _classify_finmind(name: str) -> str:
    if name in _FOREIGN: return "foreign"
    if name in _TRUST:   return "trust"
    if name in _DEALER:  return "dealer"
    return "unknown"


async def _fetch_one_finmind(sym: str, start: date, end: date) -> tuple[str, list]:
    try:
        rows = await fetch_institutional(sym, start=start, end=end)
        return sym, rows
    except Exception:
        return sym, []


def _top_movers(by_symbol: dict, key: str, n: int = 10):
    rows = [
        {"symbol": sym, "name": v.get("name", sym), "net": v[key]}
        for sym, v in by_symbol.items()
        if v[key] != 0
    ]
    buyers  = sorted(rows, key=lambda x: x["net"], reverse=True)[:n]
    sellers = sorted(rows, key=lambda x: x["net"])[:n]
    return buyers, sellers


def _t86_int(s) -> int:
    try:
        return int(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return 0


async def _fetch_t86_for_date(target_date: date) -> tuple[str, dict[str, dict]]:
    """
    TWSE T86 單日全市場三大法人。
    回傳 (date_str, {symbol: {foreign_net, trust_net, dealer_net}})
    空資料代表假日或資料尚未釋出。
    """
    tw_date = target_date.strftime("%Y%m%d")
    url = f"https://www.twse.com.tw/fund/T86?response=json&date={tw_date}&selectType=ALL"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.twse.com.tw/",
    }
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            payload = resp.json()
        if payload.get("stat") != "OK" or not payload.get("data"):
            return target_date.isoformat(), {}
        result: dict[str, dict] = {}
        for row in payload["data"]:
            sym = str(row[0]).strip()
            if not sym or not all(c.isdigit() for c in sym):
                continue
            result[sym] = {
                "foreign_net": _t86_int(row[4]),
                "trust_net":   _t86_int(row[7]),
                "dealer_net":  _t86_int(row[8]),
            }
        return target_date.isoformat(), result
    except Exception as exc:
        logger.debug("[market chips] T86 %s failed: %s", target_date, exc)
        return target_date.isoformat(), {}


@router.get("/market/chips/summary")
@limiter.limit("10/minute")
async def get_market_chips_summary(
    request: Request,
    date_str: str = Query(None, alias="date", description="YYYY-MM-DD, default=today"),
    top_n:    int = Query(10, ge=5, le=30),
):
    if date_str:
        try:
            target = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="date 格式需為 YYYY-MM-DD")
    else:
        target = date.today()
    cache_key = target.isoformat()

    cached = _chips_cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < _CACHE_TTL:
        return cached["data"]

    # ── Step 1: TWSE T86（全市場一次 call，往前找最近有資料的交易日）─────
    t86_data: dict[str, dict] = {}
    display_date = cache_key
    for offset in range(0, 6):
        d = target - timedelta(days=offset)
        if d.weekday() >= 5:   # 跳過週末
            continue
        day_str, day_data = await _fetch_t86_for_date(d)
        if day_data:
            t86_data    = day_data
            display_date = day_str
            break

    # ── Step 2: 從 T86 建立 by_symbol（只保留主要股票）───────────────────
    # Build symbol→name map
    try:
        stock_list = await get_stock_list()
        name_map = {s["symbol"]: s["name"] for s in stock_list}
    except Exception:
        name_map = {}

    by_symbol: dict[str, dict] = {}
    for sym in _MAJOR_STOCKS:
        nets = t86_data.get(sym)
        if nets is None:
            continue
        by_symbol[sym] = {
            "name":        name_map.get(sym, sym),
            "date":        display_date,
            "foreign_net": nets["foreign_net"],
            "trust_net":   nets["trust_net"],
            "dealer_net":  nets["dealer_net"],
        }

    # ── Step 3: FinMind fallback（T86 完全失敗時）────────────────────────
    if not by_symbol:
        logger.warning("[market chips] T86 empty, falling back to FinMind for %d stocks", len(_MAJOR_STOCKS))
        start_fb = target - timedelta(days=5)
        batch_size = 10
        for i in range(0, len(_MAJOR_STOCKS), batch_size):
            batch = _MAJOR_STOCKS[i:i + batch_size]
            results = await asyncio.gather(
                *[_fetch_one_finmind(sym, start_fb, target) for sym in batch],
                return_exceptions=False,
            )
            for sym, rows in results:
                if not rows:
                    continue
                latest_date = max(r["date"] for r in rows)
                for row in rows:
                    if row["date"] != latest_date:
                        continue
                    cat = _classify_finmind(row.get("name", ""))
                    if cat == "unknown":
                        continue
                    if sym not in by_symbol:
                        by_symbol[sym] = {
                            "name": name_map.get(sym, sym), "date": latest_date,
                            "foreign_net": 0, "trust_net": 0, "dealer_net": 0,
                        }
                    net = int(row.get("buy", 0)) - int(row.get("sell", 0))
                    by_symbol[sym][f"{cat}_net"] += net

    if not by_symbol:
        raise HTTPException(
            status_code=404,
            detail=f"No market chips data available near {cache_key}",
        )

    # Use the most common date across stocks as the display date
    from collections import Counter
    date_counts = Counter(v["date"] for v in by_symbol.values())
    display_date = date_counts.most_common(1)[0][0]

    total_foreign = sum(v["foreign_net"] for v in by_symbol.values())
    total_trust   = sum(v["trust_net"]   for v in by_symbol.values())
    total_dealer  = sum(v["dealer_net"]  for v in by_symbol.values())

    foreign_buyers,  foreign_sellers  = _top_movers(by_symbol, "foreign_net", top_n)
    trust_buyers,    trust_sellers    = _top_movers(by_symbol, "trust_net",   top_n)
    dealer_buyers,   dealer_sellers   = _top_movers(by_symbol, "dealer_net",  top_n)

    result = {
        "date": display_date,
        "total": {
            "foreign": total_foreign,
            "trust":   total_trust,
            "dealer":  total_dealer,
        },
        "foreign": {"buyers": foreign_buyers, "sellers": foreign_sellers},
        "trust":   {"buyers": trust_buyers,   "sellers": trust_sellers},
        "dealer":  {"buyers": dealer_buyers,  "sellers": dealer_sellers},
    }

    _chips_cache[cache_key] = {"ts": time.time(), "data": result}
    return result


@router.get("/market/ranking")
@limiter.limit("20/minute")
async def get_market_ranking(request: Request):
    """
    熱門排行榜：漲幅 Top 20 / 跌幅 Top 20 / 爆量 Top 20
    資料來源：screener 快取 + mis.twse 即時補全
    快取 TTL：3 分鐘
    """
    data = await fetch_market_ranking()
    if not data:
        raise HTTPException(status_code=503, detail="Ranking data unavailable")
    return data
