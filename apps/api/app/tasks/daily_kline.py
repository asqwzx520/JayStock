"""
每日 K 線排程任務
台股收盤後（14:30）抓取前一交易日日 K 資料，批次寫入 Supabase kline_daily 表。
若 Supabase 未設定則靜默跳過（純 live API fallback 模式仍可運作）。
"""
import asyncio
import logging
from datetime import date, timedelta

from app.services.finmind_service import fetch_daily_kline as finmind_fetch_kline
from app.core.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# 台股熱門標的（加權股 + ETF），每日快取此清單
POPULAR_SYMBOLS: list[str] = [
    # 半導體 / 電子
    "2330", "2303", "2454", "3034", "2308", "2382",
    "3711", "2395", "2357", "2356", "2379", "3008",
    "2301", "2344", "2376", "2385", "6770", "3037",
    # 金融
    "2882", "2881", "2886", "2891", "2884", "2885",
    "2880", "2892", "5880", "2883",
    # 傳產 / 原物料
    "1301", "1303", "1326", "6505", "2002",
    # 航運
    "2603", "2609", "2615",
    # 電信 / 其他
    "2412", "3045",
    # 代工 / ODM
    "2317", "4938", "2354",
    # ETF
    "0050", "0056", "00878", "00880", "006208",
]

# FinMind 免費 token rate limit：每秒約 1 req，加 0.6s 保護間距
_REQUEST_INTERVAL = 0.6


async def fetch_daily_kline() -> None:
    """排程入口：抓昨日日 K 並 upsert 到 Supabase"""
    supabase = get_supabase()
    if supabase is None:
        logger.info("Supabase 未設定，跳過 daily_kline 快取任務")
        return

    # 取「上一個交易日」：週一往前抓 3 天以確保有資料
    today = date.today()
    lookback = today - timedelta(days=1)
    start_str = (today - timedelta(days=5)).isoformat()
    end_str   = today.isoformat()

    logger.info(f"[daily_kline] 開始抓取 {len(POPULAR_SYMBOLS)} 檔，查詢區間 {start_str}~{end_str}")

    success = 0
    failed  = 0

    for symbol in POPULAR_SYMBOLS:
        try:
            rows = await finmind_fetch_kline(symbol, start=lookback - timedelta(days=4), end=today)
            if not rows:
                logger.debug(f"[daily_kline] {symbol} 無資料，略過")
                continue

            # 只取最新一筆（收盤後只新增當日）
            latest = rows[-1]
            record = {
                "symbol":   symbol,
                "date":     latest["date"],
                "open":     latest["open"],
                "high":     latest["high"],
                "low":      latest["low"],
                "close":    latest["close"],
                "volume":   int(latest.get("volume", 0)),
                "turnover": int(latest.get("turnover", 0)),
            }

            supabase.table("kline_daily").upsert(record, on_conflict="symbol,date").execute()
            success += 1
            logger.debug(f"[daily_kline] {symbol} upsert OK ({latest['date']})")

        except Exception as e:
            failed += 1
            logger.warning(f"[daily_kline] {symbol} 失敗: {e}")

        await asyncio.sleep(_REQUEST_INTERVAL)

    logger.info(f"[daily_kline] 完成：成功 {success}，失敗 {failed}")
