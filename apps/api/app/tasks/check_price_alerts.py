"""
價格提醒排程任務
盤中每 5 分鐘執行（09:00–13:35 台灣時間），
比對自選股的 price_alert_above / price_alert_below，
觸發後寫入 price_alert_notifications，並清除已觸發的設定（一次性提醒）。
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.supabase_client import get_supabase
from app.services.twse_fetcher import fetch_quotes

logger = logging.getLogger(__name__)

TZ_TAIPEI = ZoneInfo("Asia/Taipei")
MARKET_OPEN  = (9,  0)
MARKET_CLOSE = (13, 35)


def _is_market_hours() -> bool:
    now = datetime.now(tz=TZ_TAIPEI)
    if now.weekday() >= 5:          # 週六/日
        return False
    t = (now.hour, now.minute)
    return MARKET_OPEN <= t <= MARKET_CLOSE


async def check_price_alerts() -> None:
    """排程入口：檢查全部用戶的價格提醒"""
    if not _is_market_hours():
        return

    sb = get_supabase()
    if sb is None:
        return

    try:
        # 取出所有有設定提醒的 watchlist items
        resp = (
            sb.table("watchlist_items")
            .select("id,user_id,symbol,price_alert_above,price_alert_below")
            .or_("price_alert_above.not.is.null,price_alert_below.not.is.null")
            .execute()
        )
        items = resp.data or []
    except Exception as e:
        logger.error(f"[alerts] 讀取 watchlist_items 失敗: {e}")
        return

    if not items:
        return

    # 批次抓現價（最多 50 個一批）
    symbols = list({it["symbol"] for it in items})
    prices: dict[str, float] = {}
    for i in range(0, len(symbols), 50):
        batch = symbols[i:i+50]
        try:
            result = await fetch_quotes(batch)
            for sym, q in result.items():
                if q.get("price"):
                    prices[sym] = float(q["price"])
        except Exception as e:
            logger.warning(f"[alerts] 抓報價失敗 {batch}: {e}")

    if not prices:
        return

    triggered_ids: list[str] = []
    notifications: list[dict] = []

    for it in items:
        sym   = it["symbol"]
        price = prices.get(sym)
        if price is None:
            continue

        above = it.get("price_alert_above")
        below = it.get("price_alert_below")

        if above is not None and price >= float(above):
            notifications.append({
                "user_id":    it["user_id"],
                "symbol":     sym,
                "alert_type": "above",
                "threshold":  float(above),
                "price":      price,
            })
            triggered_ids.append(it["id"])
            logger.info(f"[alerts] {sym} 突破 {above}（現價 {price}）")

        elif below is not None and price <= float(below):
            notifications.append({
                "user_id":    it["user_id"],
                "symbol":     sym,
                "alert_type": "below",
                "threshold":  float(below),
                "price":      price,
            })
            triggered_ids.append(it["id"])
            logger.info(f"[alerts] {sym} 跌破 {below}（現價 {price}）")

    if not notifications:
        return

    try:
        sb.table("price_alert_notifications").insert(notifications).execute()
    except Exception as e:
        logger.error(f"[alerts] 寫入通知失敗: {e}")
        return

    # 觸發後清除提醒設定（一次性）
    for iid in triggered_ids:
        try:
            sb.table("watchlist_items").update({
                "price_alert_above": None,
                "price_alert_below": None,
            }).eq("id", iid).execute()
        except Exception as e:
            logger.warning(f"[alerts] 清除 {iid} 提醒設定失敗: {e}")

    logger.info(f"[alerts] 本輪觸發 {len(notifications)} 筆通知")
