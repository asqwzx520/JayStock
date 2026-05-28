from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query
import logging

from app.services.finmind_service import fetch_institutional
from app.core.supabase_client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()

_FOREIGN = {"Foreign_Investor", "Foreign_Dealer_Self"}
_TRUST   = {"Investment_Trust"}
_DEALER  = {"Dealer_self", "Dealer_Hedging"}


def _compute_streak(data: list[dict], key: str) -> dict:
    """計算最近連續買超/賣超天數"""
    if not data:
        return {"days": 0, "direction": "flat"}
    last = data[-1][key]
    if last == 0:
        return {"days": 0, "direction": "flat"}
    direction = "buy" if last > 0 else "sell"
    count = 0
    for row in reversed(data):
        net = row[key]
        if (direction == "buy" and net > 0) or (direction == "sell" and net < 0):
            count += 1
        else:
            break
    return {"days": count, "direction": direction}


def _classify(name: str) -> str:
    if name in _FOREIGN:
        return "foreign"
    if name in _TRUST:
        return "trust"
    if name in _DEALER:
        return "dealer"
    return "unknown"


def _build_response_data(raw_rows: list[dict], days: int) -> list[dict]:
    """將 Supabase chips_daily 格式（已聚合）直接轉換成回應格式"""
    sorted_rows = sorted(raw_rows, key=lambda r: r["date"])[-days:]
    data = []
    for r in sorted_rows:
        fn = r["foreign_buy"] - r["foreign_sell"]
        tn = r["trust_buy"]   - r["trust_sell"]
        dn = r["dealer_buy"]  - r["dealer_sell"]
        data.append({
            "date":         r["date"],
            "foreign_buy":  r["foreign_buy"],
            "foreign_sell": r["foreign_sell"],
            "foreign_net":  fn,
            "trust_buy":    r["trust_buy"],
            "trust_sell":   r["trust_sell"],
            "trust_net":    tn,
            "dealer_buy":   r["dealer_buy"],
            "dealer_sell":  r["dealer_sell"],
            "dealer_net":   dn,
            "total_net":    fn + tn + dn,
        })
    return data


def _build_response_from_finmind(raw: list[dict], days: int) -> list[dict]:
    """將 FinMind 原始多行資料聚合後轉換成回應格式"""
    by_date: dict[str, dict] = {}
    for row in raw:
        d = row["date"]
        if d not in by_date:
            by_date[d] = {
                "date": d,
                "foreign_buy": 0, "foreign_sell": 0,
                "trust_buy":   0, "trust_sell":   0,
                "dealer_buy":  0, "dealer_sell":  0,
            }
        cat  = _classify(row.get("name", ""))
        buy  = int(row.get("buy",  0))
        sell = int(row.get("sell", 0))
        if cat == "foreign":
            by_date[d]["foreign_buy"]  += buy
            by_date[d]["foreign_sell"] += sell
        elif cat == "trust":
            by_date[d]["trust_buy"]    += buy
            by_date[d]["trust_sell"]   += sell
        elif cat == "dealer":
            by_date[d]["dealer_buy"]   += buy
            by_date[d]["dealer_sell"]  += sell

    sorted_dates = sorted(by_date.keys())[-days:]
    data = []
    for d in sorted_dates:
        r  = by_date[d]
        fn = r["foreign_buy"] - r["foreign_sell"]
        tn = r["trust_buy"]   - r["trust_sell"]
        dn = r["dealer_buy"]  - r["dealer_sell"]
        data.append({
            "date":         d,
            "foreign_buy":  r["foreign_buy"],
            "foreign_sell": r["foreign_sell"],
            "foreign_net":  fn,
            "trust_buy":    r["trust_buy"],
            "trust_sell":   r["trust_sell"],
            "trust_net":    tn,
            "dealer_buy":   r["dealer_buy"],
            "dealer_sell":  r["dealer_sell"],
            "dealer_net":   dn,
            "total_net":    fn + tn + dn,
        })
    return data


async def _chips_from_supabase(
    symbol: str, start: date, end: date
) -> list[dict] | None:
    """從 Supabase 讀取已聚合的籌碼快取；未設定或無資料回傳 None"""
    try:
        supabase = get_supabase()
        if supabase is None:
            return None
        resp = (
            supabase.table("chips_daily")
            .select(
                "date,"
                "foreign_buy,foreign_sell,"
                "trust_buy,trust_sell,"
                "dealer_buy,dealer_sell"
            )
            .eq("symbol", symbol)
            .gte("date", start.isoformat())
            .lte("date", end.isoformat())
            .order("date")
            .execute()
        )
        rows = resp.data
        if not rows:
            return None
        return rows
    except Exception as e:
        logger.warning(f"[chips] Supabase 讀取失敗，fallback to FinMind: {e}")
        return None


@router.get("/chips/{symbol}")
async def get_chips(
    symbol: str,
    days: int = Query(60, ge=5, le=240, description="Trading days"),
):
    end   = date.today()
    start = end - timedelta(days=int(days * 1.8))

    # 1. 嘗試從 Supabase 快取讀取（已聚合格式）
    cached = await _chips_from_supabase(symbol, start, end)
    if cached is not None:
        logger.debug(f"[chips] {symbol} 使用 Supabase 快取 ({len(cached)} rows)")
        data = _build_response_data(cached, days)
    else:
        # 2. Cache miss → 呼叫 FinMind live API
        logger.debug(f"[chips] {symbol} cache miss，呼叫 FinMind")
        try:
            raw = await fetch_institutional(symbol, start=start, end=end)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"FinMind error: {e}")

        if not raw:
            raise HTTPException(status_code=404, detail=f"No chips data for {symbol}")

        data = _build_response_from_finmind(raw, days)

    if not data:
        raise HTTPException(status_code=404, detail=f"No chips data for {symbol}")

    return {
        "symbol": symbol,
        "days":   days,
        "data":   data,
        "cumulative": {
            "foreign": sum(r["foreign_net"] for r in data),
            "trust":   sum(r["trust_net"]   for r in data),
            "dealer":  sum(r["dealer_net"]  for r in data),
            "total":   sum(r["total_net"]   for r in data),
        },
        "streak": {
            "foreign": _compute_streak(data, "foreign_net"),
            "trust":   _compute_streak(data, "trust_net"),
            "dealer":  _compute_streak(data, "dealer_net"),
        },
    }
