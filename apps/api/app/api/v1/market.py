import time
import asyncio
from datetime import date, timedelta
from fastapi import APIRouter, Query, HTTPException, Request
from app.services.stock_list import search_stocks, get_stock_list
from app.services.finmind_service import fetch_institutional
from app.services.market_service import (
    fetch_indices,
    fetch_market_breadth,
    fetch_sector_heatmap,
    fetch_market_ranking,
)
from app.core.rate_limit import limiter

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

_FOREIGN = {"Foreign_Investor", "Foreign_Dealer_Self"}
_TRUST   = {"Investment_Trust"}
_DEALER  = {"Dealer_self", "Dealer_Hedging"}


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


def _classify(name: str) -> str:
    if name in _FOREIGN: return "foreign"
    if name in _TRUST:   return "trust"
    if name in _DEALER:  return "dealer"
    return "unknown"


def _top_movers(by_symbol: dict, key: str, n: int = 10):
    rows = [
        {"symbol": sym, "name": v.get("name", sym), "net": v[key]}
        for sym, v in by_symbol.items()
        if v[key] != 0
    ]
    buyers  = sorted(rows, key=lambda x: x["net"], reverse=True)[:n]
    sellers = sorted(rows, key=lambda x: x["net"])[:n]
    return buyers, sellers


async def _fetch_one(sym: str, start: date, end: date) -> tuple[str, list]:
    try:
        rows = await fetch_institutional(sym, start=start, end=end)
        return sym, rows
    except Exception:
        return sym, []


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

    # Build symbol→name map from TWSE stock list
    try:
        stock_list = await get_stock_list()
        name_map = {s["symbol"]: s["name"] for s in stock_list}
    except Exception:
        name_map = {}

    # Fetch latest available trading day: query a 5-day window to handle weekends/holidays
    start = target - timedelta(days=5)

    # Parallel fetch for all major stocks (batches of 10 to avoid overwhelming FinMind)
    by_symbol: dict[str, dict] = {}
    batch_size = 10
    for i in range(0, len(_MAJOR_STOCKS), batch_size):
        batch = _MAJOR_STOCKS[i:i + batch_size]
        results = await asyncio.gather(
            *[_fetch_one(sym, start, target) for sym in batch],
            return_exceptions=False,
        )
        for sym, rows in results:
            # Keep only the most recent date's data
            if not rows:
                continue
            latest_date = max(r["date"] for r in rows)
            day_rows = [r for r in rows if r["date"] == latest_date]
            actual_date = latest_date  # track what date we got

            for row in day_rows:
                cat = _classify(row.get("name", ""))
                if cat == "unknown":
                    continue
                if sym not in by_symbol:
                    by_symbol[sym] = {
                        "name": name_map.get(sym, sym), "date": actual_date,
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
