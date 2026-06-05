from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query, Request
import logging

from app.services.finmind_service import fetch_institutional, fetch_margin, fetch_broker_data
from app.core.supabase_client import get_supabase
from app.core.validators import validate_symbol
from app.core.rate_limit import limiter
from app.core.broker_types import classify_broker, is_known_daytrade, detect_daytrade_rate

logger = logging.getLogger(__name__)
router = APIRouter()

_FOREIGN = {"Foreign_Investor", "Foreign_Dealer_Self"}
_TRUST   = {"Investment_Trust"}
_DEALER  = {"Dealer_self", "Dealer_Hedging"}


# ── Helpers ────────────────────────────────────────────────────────────────────

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
        logger.warning(f"[chips] Supabase 讀取失敗: {e}")
        return None


def _build_cumulative_series(data: list[dict]) -> list[dict]:
    """每日累積持倉 cumsum（以選取期間第一天為基準）"""
    running = {"foreign": 0, "trust": 0, "dealer": 0}
    series = []
    for r in data:
        running["foreign"] += r["foreign_net"]
        running["trust"]   += r["trust_net"]
        running["dealer"]  += r["dealer_net"]
        series.append({
            "date":    r["date"],
            "foreign": running["foreign"],
            "trust":   running["trust"],
            "dealer":  running["dealer"],
            "total":   running["foreign"] + running["trust"] + running["dealer"],
        })
    return series


async def _compute_score(
    symbol: str,
    data: list[dict],
    streak: dict,
    cumul_series: list[dict],
) -> dict:
    """7 項加權評分，滿分 100。"""
    items: dict = {}
    total = 0

    # ① 外資連買天數 (20pts)
    fs = streak["foreign"]
    f_days = fs["days"] if fs["direction"] == "buy" else 0
    if f_days >= 10: sc = 20
    elif f_days >= 7: sc = 16
    elif f_days >= 5: sc = 12
    elif f_days >= 3: sc = 8
    elif f_days >= 1: sc = 4
    else: sc = 0
    label_val = f"連{'買' if fs['direction']=='buy' else '賣'}{fs['days']}日" if fs["days"] else "持平"
    items["foreign_streak"] = {"score": sc, "max": 20, "label": "外資連買", "value": label_val}
    total += sc

    # ② 投信連買天數 (15pts)
    ts = streak["trust"]
    t_days = ts["days"] if ts["direction"] == "buy" else 0
    if t_days >= 7: sc = 15
    elif t_days >= 5: sc = 12
    elif t_days >= 3: sc = 9
    elif t_days >= 1: sc = 5
    else: sc = 0
    label_val = f"連{'買' if ts['direction']=='buy' else '賣'}{ts['days']}日" if ts["days"] else "持平"
    items["trust_streak"] = {"score": sc, "max": 15, "label": "投信連買", "value": label_val}
    total += sc

    # ③ 自營連買天數 (10pts)
    ds = streak["dealer"]
    d_days = ds["days"] if ds["direction"] == "buy" else 0
    if d_days >= 5: sc = 10
    elif d_days >= 3: sc = 7
    elif d_days >= 1: sc = 4
    else: sc = 0
    label_val = f"連{'買' if ds['direction']=='buy' else '賣'}{ds['days']}日" if ds["days"] else "持平"
    items["dealer_streak"] = {"score": sc, "max": 10, "label": "自營連買", "value": label_val}
    total += sc

    # ④ 外資累積持倉方向 (15pts)
    f_cumsum = cumul_series[-1]["foreign"] if cumul_series else 0
    avg_daily = sum(abs(r["foreign_net"]) for r in data) / max(len(data), 1)
    if f_cumsum > avg_daily * 10: sc = 15
    elif f_cumsum > avg_daily * 3: sc = 12
    elif f_cumsum > 0: sc = 8
    elif f_cumsum == 0: sc = 4
    else: sc = 0
    items["foreign_cumsum"] = {
        "score": sc, "max": 15, "label": "外資持倉",
        "value": f"{f_cumsum:+,.0f}張",
    }
    total += sc

    # ⑤ 三法人合力 (10pts)
    if cumul_series:
        last_c = cumul_series[-1]
        positive_count = sum(1 for k in ["foreign", "trust", "dealer"] if last_c[k] > 0)
        t_cumsum = last_c["total"]
    else:
        positive_count = 0
        t_cumsum = 0
    if t_cumsum > 0 and positive_count >= 2: sc = 10
    elif t_cumsum > 0: sc = 6
    elif t_cumsum == 0: sc = 3
    else: sc = 0
    items["combined_force"] = {
        "score": sc, "max": 10, "label": "三法人合力",
        "value": f"正向{positive_count}家",
    }
    total += sc

    # ⑥⑦ 融資/融券 (各15pts) — 需要 margin 資料
    try:
        end_d   = date.today()
        start_d = end_d - timedelta(days=35)
        raw_mg  = await fetch_margin(symbol, start=start_d, end=end_d)
        if raw_mg:
            sorted_mg = sorted(raw_mg, key=lambda x: x["date"])
            latest    = sorted_mg[-1]
            mb = int(latest.get("MarginPurchaseTodayBalance", 0))
            sb = int(latest.get("ShortSaleTodayBalance", 0))

            # ⑥ 融資使用率反向 (15pts)：相對 20 日均值
            avg_mb = sum(int(r.get("MarginPurchaseTodayBalance", 0)) for r in sorted_mg) / len(sorted_mg)
            rel = mb / avg_mb if avg_mb > 0 else 1.0
            if rel < 0.7: sc = 15
            elif rel < 0.85: sc = 12
            elif rel < 1.0: sc = 9
            elif rel < 1.2: sc = 5
            else: sc = 2
            items["margin_usage"] = {
                "score": sc, "max": 15, "label": "融資籌碼",
                "value": f"{mb:,}張（均值{rel:.1f}x）",
            }
            total += sc

            # ⑦ 軋空潛力 (15pts)
            sr = sb / mb if mb > 0 else 0.0
            if sr > 0.4: sc = 15
            elif sr > 0.25: sc = 12
            elif sr > 0.1: sc = 8
            elif sr > 0.05: sc = 5
            else: sc = 2
            items["short_squeeze"] = {
                "score": sc, "max": 15, "label": "軋空潛力",
                "value": f"資券比 {sr:.2f}",
            }
            total += sc
        else:
            items["margin_usage"]  = {"score": 7, "max": 15, "label": "融資籌碼", "value": "無資料", "na": True}
            items["short_squeeze"] = {"score": 7, "max": 15, "label": "軋空潛力", "value": "無資料", "na": True}
            total += 14
    except Exception as exc:
        logger.debug("[chips score] margin fetch failed: %s", exc)
        items["margin_usage"]  = {"score": 7, "max": 15, "label": "融資籌碼", "value": "無資料", "na": True}
        items["short_squeeze"] = {"score": 7, "max": 15, "label": "軋空潛力", "value": "無資料", "na": True}
        total += 14

    return {"total": min(total, 100), "items": items}


# ── Main chips endpoint ────────────────────────────────────────────────────────

@router.get("/chips/{symbol}")
@limiter.limit("30/minute")
async def get_chips(
    request: Request,
    symbol: str,
    days: int = Query(60, ge=5, le=240, description="Trading days"),
):
    sym   = validate_symbol(symbol)
    end   = date.today()
    start = end - timedelta(days=int(days * 1.8))

    # 1. Supabase cache
    cached = await _chips_from_supabase(sym, start, end)
    if cached is not None:
        data = _build_response_data(cached, days)
    else:
        try:
            raw = await fetch_institutional(sym, start=start, end=end)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"FinMind error: {e}")
        if not raw:
            raise HTTPException(status_code=404, detail=f"No chips data for {sym}")
        data = _build_response_from_finmind(raw, days)

    if not data:
        raise HTTPException(status_code=404, detail=f"No chips data for {sym}")

    cumul_series = _build_cumulative_series(data)

    streak = {
        "foreign": _compute_streak(data, "foreign_net"),
        "trust":   _compute_streak(data, "trust_net"),
        "dealer":  _compute_streak(data, "dealer_net"),
    }

    score = await _compute_score(sym, data, streak, cumul_series)

    return {
        "symbol":            sym,
        "days":              days,
        "data":              data,
        "cumulative": {
            "foreign": sum(r["foreign_net"] for r in data),
            "trust":   sum(r["trust_net"]   for r in data),
            "dealer":  sum(r["dealer_net"]  for r in data),
            "total":   sum(r["total_net"]   for r in data),
        },
        "cumulative_series": cumul_series,
        "streak":            streak,
        "score":             score,
    }


# ── Broker chips endpoint ──────────────────────────────────────────────────────

@router.get("/chips/{symbol}/brokers")
@limiter.limit("15/minute")
async def get_broker_chips(
    request: Request,
    symbol: str,
    days: int = Query(5, ge=5, le=20, description="5 / 10 / 20"),
):
    sym   = validate_symbol(symbol)
    end   = date.today()
    start = end - timedelta(days=int(days * 1.8))

    try:
        raw = await fetch_broker_data(sym, start=start, end=end)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FinMind broker error: {e}")

    if not raw:
        raise HTTPException(status_code=404, detail=f"No broker data for {sym}")

    # Aggregate per broker
    by_broker: dict[str, dict] = {}
    broker_records: dict[str, list[dict]] = {}

    for row in raw:
        bid  = row.get("broker_id") or row.get("sell_broker_id") or ""
        name = row.get("broker_name") or row.get("sell_broker_name") or bid or "未知"
        key  = name

        buy  = int(row.get("buy",  0))
        sell = int(row.get("sell", 0))
        d    = row.get("date", "")

        if key not in by_broker:
            by_broker[key] = {"broker_id": bid, "broker_name": name, "buy": 0, "sell": 0, "net": 0}
            broker_records[key] = []

        by_broker[key]["buy"]  += buy
        by_broker[key]["sell"] += sell
        by_broker[key]["net"]  += (buy - sell)
        broker_records[key].append({"date": d, "buy": buy, "sell": sell})

    # Classify & detect day-trade
    foreign_brokers: list[dict] = []
    trust_brokers:   list[dict] = []
    daytrade_brokers: list[dict] = []
    all_brokers: list[dict] = []

    for name, agg in by_broker.items():
        cat = classify_broker(name)
        rate = detect_daytrade_rate(broker_records[name])
        entry = {**agg, "type": cat, "daytrade_rate": rate}
        all_brokers.append(entry)
        if cat == "foreign":
            foreign_brokers.append(entry)
        elif cat == "trust":
            trust_brokers.append(entry)

        # 隔日沖：已知名單 OR 演算法偵測 rate > 0.45
        if is_known_daytrade(name) or rate > 0.45:
            daytrade_brokers.append({**entry, "pattern": "known" if is_known_daytrade(name) else "detected"})

    def top_net(lst: list[dict], n: int = 5) -> tuple[list[dict], list[dict]]:
        s = sorted(lst, key=lambda x: x["net"], reverse=True)
        return s[:n], s[-n:][::-1]   # top buy, top sell

    f_buy, f_sell = top_net(foreign_brokers)
    t_buy, t_sell = top_net(trust_brokers)
    g_buy, g_sell = top_net(all_brokers)

    # Deduplicate daytrade by name
    seen: set[str] = set()
    dt_dedup: list[dict] = []
    for b in sorted(daytrade_brokers, key=lambda x: x["daytrade_rate"], reverse=True):
        if b["broker_name"] not in seen:
            seen.add(b["broker_name"])
            dt_dedup.append(b)

    return {
        "symbol":  sym,
        "days":    days,
        "general": {"top_buy": g_buy, "top_sell": g_sell},
        "foreign": {"top_buy": f_buy, "top_sell": f_sell},
        "trust":   {"top_buy": t_buy, "top_sell": t_sell},
        "daytrade": dt_dedup[:10],
    }
