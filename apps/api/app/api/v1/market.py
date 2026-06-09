import time
import asyncio
import logging
from datetime import date, timedelta
from fastapi import APIRouter, Query, HTTPException, Request

from app.services.stock_list import search_stocks, get_stock_list
from app.services.finmind_service import fetch_institutional
from app.services.twse_service import fetch_t86_for_date as twse_fetch_t86
from app.services.market_service import (
    fetch_indices,
    fetch_market_breadth,
    fetch_sector_heatmap,
    fetch_market_ranking,
)
from app.core.rate_limit import limiter
from app.core.supabase_client import get_supabase

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
    """大盤指數（台股加權 + 美股三大指數 + 那指期貨 + 費半）"""
    data = await fetch_indices()
    return {"indices": data}


@router.get("/market/breadth")
@limiter.limit("30/minute")
async def get_market_breadth(request: Request):
    data = await fetch_market_breadth()
    if not data:
        raise HTTPException(status_code=503, detail="Market breadth data temporarily unavailable")
    return data


@router.get("/market/sectors")
@limiter.limit("30/minute")
async def get_sector_heatmap(request: Request):
    data = await fetch_sector_heatmap()
    return {"sectors": data}


@router.get("/market/search")
@limiter.limit("60/minute")
async def stock_search(
    request: Request,
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(20, ge=1, le=50),
):
    results = await search_stocks(q, limit)
    return {"query": q, "count": len(results), "data": results}


# ─────────────────────────────────────────────────────────────
# Market chips summary（法人動向）
# ─────────────────────────────────────────────────────────────

_FOREIGN_FM = {"Foreign_Investor", "Foreign_Dealer_Self"}
_TRUST_FM   = {"Investment_Trust"}
_DEALER_FM  = {"Dealer_self", "Dealer_Hedging"}


def _classify_finmind(name: str) -> str:
    if name in _FOREIGN_FM: return "foreign"
    if name in _TRUST_FM:   return "trust"
    if name in _DEALER_FM:  return "dealer"
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


async def _from_supabase_chips(target: date) -> tuple[str, dict[str, dict]]:
    """
    從 chips_daily 讀取最近一個交易日的全市場法人。
    回傳 (date_str, {symbol: {foreign_net, trust_net, dealer_net}})
    """
    db = get_supabase()
    if db is None:
        return "", {}
    start = (target - timedelta(days=7)).isoformat()
    try:
        resp = (
            db.table("chips_daily")
            .select("date, symbol, foreign_buy, foreign_sell, trust_buy, trust_sell, dealer_buy, dealer_sell")
            .gte("date", start)
            .lte("date", target.isoformat())
            .in_("symbol", _MAJOR_STOCKS)
            .execute()
        )
        rows = resp.data or []
    except Exception as e:
        logger.warning("[market.chips] supabase failed: %s", e)
        return "", {}

    if not rows:
        return "", {}

    # 取最新日期
    latest = max(r["date"] for r in rows)
    result: dict[str, dict] = {}
    for r in rows:
        if r["date"] != latest:
            continue
        sym = r["symbol"]
        result[sym] = {
            "foreign_net": int(r["foreign_buy"] or 0) - int(r["foreign_sell"] or 0),
            "trust_net":   int(r["trust_buy"]   or 0) - int(r["trust_sell"]   or 0),
            "dealer_net":  int(r["dealer_buy"]  or 0) - int(r["dealer_sell"]  or 0),
        }
    return latest, result


async def _from_t86_live(target: date) -> tuple[str, dict[str, dict]]:
    """T86 live 全市場（用新 twse_service 取，schema 用欄位名匹配）"""
    for offset in range(0, 6):
        d = target - timedelta(days=offset)
        if d.weekday() >= 5:
            continue
        try:
            day_data = await twse_fetch_t86(d)
        except Exception as e:
            logger.debug("[market.chips] t86 %s failed: %s", d, e)
            day_data = {}
        if day_data:
            return d.isoformat(), day_data
    return "", {}


async def _fetch_one_finmind(sym: str, start: date, end: date) -> tuple[str, list]:
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

    # ── Step 1: Supabase chips_daily（由 daily_chips_full job 寫入）────────
    display_date, t86_data = await _from_supabase_chips(target)

    # ── Step 2: T86 live fallback（Supabase 空 / 冷啟動）─────────────────
    if not t86_data:
        display_date, t86_full = await _from_t86_live(target)
        # 只保留 _MAJOR_STOCKS
        t86_data = {sym: t86_full[sym] for sym in _MAJOR_STOCKS if sym in t86_full}

    # ── 建立 by_symbol ────────────────────────────────────────────────────
    try:
        stock_list = await get_stock_list()
        name_map = {s["symbol"]: s["name"] for s in stock_list}
    except Exception:
        name_map = {}

    by_symbol: dict[str, dict] = {}
    for sym, nets in t86_data.items():
        by_symbol[sym] = {
            "name":        name_map.get(sym, sym),
            "date":        display_date,
            "foreign_net": nets["foreign_net"],
            "trust_net":   nets["trust_net"],
            "dealer_net":  nets["dealer_net"],
        }

    # ── Step 3: FinMind 最終 fallback ────────────────────────────────────
    if not by_symbol:
        logger.warning("[market.chips] all primary sources empty, falling back to FinMind")
        start_fb = target - timedelta(days=5)
        for i in range(0, len(_MAJOR_STOCKS), 10):
            batch = _MAJOR_STOCKS[i:i + 10]
            results = await asyncio.gather(
                *[_fetch_one_finmind(s, start_fb, target) for s in batch],
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

    # 統一日期（多檢核可能不同源 → 取 mode）
    from collections import Counter
    date_counts = Counter(v["date"] for v in by_symbol.values() if v.get("date"))
    if date_counts:
        display_date = date_counts.most_common(1)[0][0]

    total_foreign = sum(v["foreign_net"] for v in by_symbol.values())
    total_trust   = sum(v["trust_net"]   for v in by_symbol.values())
    total_dealer  = sum(v["dealer_net"]  for v in by_symbol.values())

    foreign_buyers, foreign_sellers = _top_movers(by_symbol, "foreign_net", top_n)
    trust_buyers,   trust_sellers   = _top_movers(by_symbol, "trust_net",   top_n)
    dealer_buyers,  dealer_sellers  = _top_movers(by_symbol, "dealer_net",  top_n)

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
    data = await fetch_market_ranking()
    if not data:
        raise HTTPException(status_code=503, detail="Ranking data unavailable")
    return data
