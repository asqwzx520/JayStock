"""
價格提醒通知 API

GET    /api/v1/alerts         → 取得未讀通知列表
POST   /api/v1/alerts/{id}/read → 標記已讀
DELETE /api/v1/alerts/{id}    → 刪除通知
"""
import logging
from typing import Optional
from fastapi import APIRouter, Header, HTTPException

from app.core.supabase_client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()


def _require_user(x_user_id: Optional[str]) -> str:
    if not x_user_id or len(x_user_id) < 8:
        raise HTTPException(status_code=401, detail="Missing or invalid X-User-ID header")
    return x_user_id


@router.get("/alerts")
async def get_alerts(x_user_id: Optional[str] = Header(default=None)):
    """取得未讀通知（最多 50 筆，按時間倒序）"""
    uid = _require_user(x_user_id)
    sb  = get_supabase()
    if sb is None:
        return {"notifications": []}

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
        logger.warning(f"[alerts] 讀取失敗: {e}")
        return {"notifications": []}


@router.post("/alerts/{alert_id}/read", status_code=204)
async def mark_read(
    alert_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    """標記單筆通知為已讀"""
    uid = _require_user(x_user_id)
    sb  = get_supabase()
    if sb is None:
        return

    try:
        from datetime import datetime, timezone
        sb.table("price_alert_notifications").update({
            "read_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", alert_id).eq("user_id", uid).execute()
    except Exception as e:
        logger.warning(f"[alerts] 標記已讀失敗: {e}")


@router.post("/alerts/read-all", status_code=204)
async def mark_all_read(x_user_id: Optional[str] = Header(default=None)):
    """標記全部通知為已讀"""
    uid = _require_user(x_user_id)
    sb  = get_supabase()
    if sb is None:
        return

    try:
        from datetime import datetime, timezone
        sb.table("price_alert_notifications").update({
            "read_at": datetime.now(timezone.utc).isoformat()
        }).eq("user_id", uid).is_("read_at", "null").execute()
    except Exception as e:
        logger.warning(f"[alerts] 全部標記已讀失敗: {e}")


@router.delete("/alerts/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    uid = _require_user(x_user_id)
    sb  = get_supabase()
    if sb is None:
        return

    try:
        sb.table("price_alert_notifications").delete().eq("id", alert_id).eq("user_id", uid).execute()
    except Exception as e:
        logger.warning(f"[alerts] 刪除失敗: {e}")
