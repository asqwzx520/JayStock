"""
每日籌碼排程任務
台股收盤後（14:10）抓取三大法人買賣超資料，批次寫入 Supabase chips_daily 表。
若 Supabase 未設定則靜默跳過（純 live API fallback 模式仍可運作）。
"""
import asyncio
import logging
from datetime import date, timedelta

from app.services.finmind_service import fetch_institutional
from app.core.supabase_client import get_supabase
from app.tasks.daily_kline import POPULAR_SYMBOLS

logger = logging.getLogger(__name__)

_FOREIGN = {"Foreign_Investor", "Foreign_Dealer_Self"}
_TRUST   = {"Investment_Trust"}
_DEALER  = {"Dealer_self", "Dealer_Hedging"}

_REQUEST_INTERVAL = 0.6


def _classify(name: str) -> str:
    if name in _FOREIGN:
        return "foreign"
    if name in _TRUST:
        return "trust"
    if name in _DEALER:
        return "dealer"
    return "unknown"


def _aggregate_rows(raw: list[dict]) -> dict[str, dict]:
    """將 FinMind 原始多行資料聚合為 {date: {foreign/trust/dealer buy/sell}}"""
    by_date: dict[str, dict] = {}
    for row in raw:
        d = row["date"]
        if d not in by_date:
            by_date[d] = {
                "foreign_buy":  0, "foreign_sell": 0,
                "trust_buy":    0, "trust_sell":   0,
                "dealer_buy":   0, "dealer_sell":  0,
            }
        cat = _classify(row.get("name", ""))
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
    return by_date


async def fetch_daily_chips() -> None:
    """排程入口：抓昨日三大法人資料並 upsert 到 Supabase"""
    supabase = get_supabase()
    if supabase is None:
        logger.info("Supabase 未設定，跳過 daily_chip 快取任務")
        return

    today     = date.today()
    start     = today - timedelta(days=5)   # 多抓幾天保證有資料

    logger.info(f"[daily_chip] 開始抓取 {len(POPULAR_SYMBOLS)} 檔，查詢區間 {start}~{today}")

    success = 0
    failed  = 0

    for symbol in POPULAR_SYMBOLS:
        try:
            raw = await fetch_institutional(symbol, start=start, end=today)
            if not raw:
                logger.debug(f"[daily_chip] {symbol} 無資料，略過")
                continue

            by_date = _aggregate_rows(raw)

            # 只取最新一個有資料的交易日
            latest_date = sorted(by_date.keys())[-1]
            agg = by_date[latest_date]

            record = {
                "symbol":       symbol,
                "date":         latest_date,
                "foreign_buy":  agg["foreign_buy"],
                "foreign_sell": agg["foreign_sell"],
                "trust_buy":    agg["trust_buy"],
                "trust_sell":   agg["trust_sell"],
                "dealer_buy":   agg["dealer_buy"],
                "dealer_sell":  agg["dealer_sell"],
            }

            supabase.table("chips_daily").upsert(record, on_conflict="symbol,date").execute()
            success += 1
            logger.debug(f"[daily_chip] {symbol} upsert OK ({latest_date})")

        except Exception as e:
            failed += 1
            logger.warning(f"[daily_chip] {symbol} 失敗: {e}")

        await asyncio.sleep(_REQUEST_INTERVAL)

    logger.info(f"[daily_chip] 完成：成功 {success}，失敗 {failed}")
