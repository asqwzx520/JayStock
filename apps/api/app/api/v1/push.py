"""
Web Push 訂閱管理 API

GET    /api/v1/push/vapid-public-key  → 回傳 VAPID 公鑰（前端訂閱時需要）
POST   /api/v1/push/subscribe         → 儲存瀏覽器訂閱端點
DELETE /api/v1/push/subscribe         → 移除訂閱端點（取消訂閱）
GET    /api/v1/push/status            → 查詢當前用戶的訂閱數量
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.validators import require_user
from app.services.push_service import (
    delete_subscription,
    get_subscriptions_for_user,
    save_subscription,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class PushSubscribeBody(BaseModel):
    # 放寬長度限制，瀏覽器實作可能產生較長的值
    endpoint: str  = Field(..., min_length=1)
    p256dh:   str  = Field(..., min_length=1)
    auth:     str  = Field(..., min_length=1)


class PushUnsubscribeBody(BaseModel):
    endpoint: str = Field(..., min_length=1)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/push/vapid-public-key")
async def get_vapid_public_key():
    """
    回傳 VAPID 公鑰（Base64URL 格式）。
    前端呼叫 PushManager.subscribe() 時需要傳入此 key。
    VAPID 未設定時回傳 enabled: false（前端應隱藏訂閱按鈕）。
    """
    if not settings.vapid_public_key:
        return {"enabled": False, "public_key": None}
    return {"enabled": True, "public_key": settings.vapid_public_key}


@router.post("/push/subscribe", status_code=201)
@limiter.limit("10/minute")
async def subscribe_push(
    request: Request,
    x_user_id: Optional[str] = Header(default=None),
):
    """儲存瀏覽器 Push 訂閱（upsert by endpoint）"""
    uid = require_user(x_user_id)

    if not settings.vapid_public_key:
        raise HTTPException(status_code=503, detail="Web Push 未啟用（VAPID 未設定）")

    # 手動解析 body —— 繞過 slowapi decorator 導致 Pydantic body 被誤判為 query param 的問題
    try:
        raw = await request.json()
        body = PushSubscribeBody(**raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors())
    except Exception:
        raise HTTPException(status_code=400, detail="body 格式錯誤，需為 JSON")

    logger.info(
        "[push] subscribe uid=%s endpoint_len=%d p256dh_len=%d auth_len=%d",
        uid[:8], len(body.endpoint), len(body.p256dh), len(body.auth),
    )
    save_subscription(uid, body.endpoint, body.p256dh, body.auth)
    logger.info("[push] 訂閱已儲存 uid=%s ep=...%s", uid[:8], body.endpoint[-20:])
    return {"ok": True}


@router.delete("/push/subscribe", status_code=204)
@limiter.limit("10/minute")
async def unsubscribe_push(
    request: Request,
    x_user_id: Optional[str] = Header(default=None),
):
    """移除指定端點的訂閱"""
    uid = require_user(x_user_id)

    try:
        raw = await request.json()
        body = PushUnsubscribeBody(**raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors())
    except Exception:
        raise HTTPException(status_code=400, detail="body 格式錯誤，需為 JSON")

    delete_subscription(uid, body.endpoint)
    logger.info("[push] 訂閱已移除 uid=%s", uid[:8])


@router.get("/push/status")
async def push_status(
    x_user_id: Optional[str] = Header(default=None),
):
    """查詢當前用戶的訂閱端點數量（用於前端判斷是否已訂閱）"""
    uid = require_user(x_user_id)
    subs = get_subscriptions_for_user(uid)
    return {
        "enabled": bool(settings.vapid_public_key),
        "subscribed_count": len(subs),
    }
