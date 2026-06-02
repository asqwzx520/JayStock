"""
In-memory price alert notification store
Supabase 未設定時的 fallback，所有通知存放在 process memory。
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# {id, user_id, symbol, alert_type, threshold, price, created_at, read_at}
_notifications: list[dict] = []
_MAX_NOTIFICATIONS = 500  # 最多保留 500 筆


def add_notification(
    user_id: str,
    symbol: str,
    alert_type: str,
    threshold: float,
    price: float,
) -> None:
    """寫入一筆通知（觸發到價提醒時呼叫）"""
    global _notifications
    _notifications.append({
        "id":         str(uuid.uuid4()),
        "user_id":    user_id,
        "symbol":     symbol,
        "alert_type": alert_type,
        "threshold":  threshold,
        "price":      price,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read_at":    None,
    })
    if len(_notifications) > _MAX_NOTIFICATIONS:
        _notifications = _notifications[-_MAX_NOTIFICATIONS:]
    logger.debug("[alert_store] added %s %s %s@%s", user_id[:8], symbol, alert_type, price)


def get_unread(user_id: str, limit: int = 50) -> list[dict]:
    """取得未讀通知（按時間倒序）"""
    return [
        n for n in reversed(_notifications)
        if n["user_id"] == user_id and n["read_at"] is None
    ][:limit]


def mark_read(notification_id: str, user_id: str) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    for n in _notifications:
        if n["id"] == notification_id and n["user_id"] == user_id:
            n["read_at"] = ts
            return


def mark_all_read(user_id: str) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    for n in _notifications:
        if n["user_id"] == user_id and n["read_at"] is None:
            n["read_at"] = ts


def delete_notification(notification_id: str, user_id: str) -> None:
    global _notifications
    _notifications = [
        n for n in _notifications
        if not (n["id"] == notification_id and n["user_id"] == user_id)
    ]
