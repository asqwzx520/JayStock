"""
價格提醒通知 API

GET    /api/v1/alerts              → 取得未讀通知列表
POST   /api/v1/alerts/{id}/read   → 標記已讀
POST   /api/v1/alerts/read-all    → 全部標記已讀
DELETE /api/v1/alerts/{id}        → 刪除通知

Supabase 未設定時自動降級為 in-memory store（app.core.alert_store）。
"""
import logging
from typing import Optional
from fastapi import APIRouter, Header, HTTPException

from app.core.supabase_client import get_supabase
from app.core.validators import require_user
import app.core.alert_store as mem

logger = logging.getLogger(__name__)
router = APIRouter()

_require_user = require_user


@router.get("/alerts")
async def get_alerts(x_user_id: Optional[str] = Header(default=None)):
    """取得未讀通知（最多 50 筆，按時間倒序）"""
    uid = _require_user(x_user_id)
    sb  = get_supabase()

    if sb is None:
        return {"notifications": mem.get_unread(uid)}

    try:
        resp = (
            sb.table("price_alert_notifications")
            .select("id,symbol,alert_type,threshold,price,created_at")
            .eq("user_id", uid)
            .is_("read_at", "null")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        return {"notifications": resp.data or []}
    except Exception as e:
        logger.warning(f"[alerts] 讀取失敗，fallback to memory: {e}")
        return {"notifications": mem.get_unread(uid)}


@router.post("/alerts/{alert_id}/read", status_code=204)
async def mark_read(
    alert_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    """標記單筆通知為已讀"""
    uid = _require_user(x_user_id)
    sb  = get_supabase()

    if sb is None:
        mem.mark_read(alert_id, uid)
        return

    try:
        from datetime import datetime, timezone
        sb.table("price_alert_notifications").update({
            "read_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", alert_id).eq("user_id", uid).execute()
    except Exception as e:
        logger.warning(f"[alerts] 標記已讀失敗: {e}")
        mem.mark_read(alert_id, uid)


@router.post("/alerts/read-all", status_code=204)
async def mark_all_read(x_user_id: Optional[str] = Header(default=None)):
    """標記全部通知為已讀"""
    uid = _require_user(x_user_id)
    sb  = get_supabase()

    if sb is None:
        mem.mark_all_read(uid)
        return

    try:
        from datetime import datetime, timezone
        sb.table("price_alert_notifications").update({
            "read_at": datetime.now(timezone.utc).isoformat()
        }).eq("user_id", uid).is_("read_at", "null").execute()
    except Exception as e:
        logger.warning(f"[alerts] 全部標記已讀失敗: {e}")
        mem.mark_all_read(uid)


@router.delete("/alerts/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    uid = _require_user(x_user_id)
    sb  = get_supabase()

    if sb is None:
        mem.delete_notification(alert_id, uid)
        return

    try:
        sb.table("price_alert_notifications").delete().eq("id", alert_id).eq("user_id", uid).execute()
    except Exception as e:
        logger.warning(f"[alerts] 刪除失敗: {e}")
        mem.delete_notification(alert_id, uid)
