"""
Web Push 通知服務（VAPID）

使用 pywebpush 發送系統推播到用戶的已訂閱端點。
訂閱資料優先存 Supabase push_subscriptions，Supabase 未設定時降級為 in-memory。

Supabase 表建議 DDL（一次性手動執行）：
  CREATE TABLE push_subscriptions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL,
    endpoint   TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(endpoint)
  );
  CREATE INDEX ON push_subscriptions (user_id);
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from app.core.config import settings
from app.core.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# ── In-memory fallback ────────────────────────────────────────────────────────
_subscriptions: list[dict] = []   # {user_id, endpoint, p256dh, auth}
_MAX_MEM_SUBS = 1000


# ── Subscription CRUD ─────────────────────────────────────────────────────────

def save_subscription(user_id: str, endpoint: str, p256dh: str, auth: str) -> None:
    """儲存或更新訂閱端點（upsert on endpoint）"""
    sb = get_supabase()
    if sb:
        try:
            sb.table("push_subscriptions").upsert(
                {"user_id": user_id, "endpoint": endpoint, "p256dh": p256dh, "auth": auth},
                on_conflict="endpoint",
            ).execute()
            return
        except Exception as e:
            logger.warning("[push] Supabase save failed, fallback to memory: %s", e)

    global _subscriptions
    _subscriptions = [s for s in _subscriptions if s["endpoint"] != endpoint]
    _subscriptions.append({"user_id": user_id, "endpoint": endpoint, "p256dh": p256dh, "auth": auth})
    if len(_subscriptions) > _MAX_MEM_SUBS:
        _subscriptions = _subscriptions[-_MAX_MEM_SUBS:]


def delete_subscription(user_id: str, endpoint: str) -> None:
    """移除訂閱端點"""
    sb = get_supabase()
    if sb:
        try:
            sb.table("push_subscriptions").delete() \
                .eq("user_id", user_id).eq("endpoint", endpoint).execute()
            return
        except Exception as e:
            logger.warning("[push] Supabase delete failed, fallback to memory: %s", e)

    global _subscriptions
    _subscriptions = [
        s for s in _subscriptions
        if not (s["user_id"] == user_id and s["endpoint"] == endpoint)
    ]


def get_subscriptions_for_user(user_id: str) -> list[dict]:
    """取得用戶的所有訂閱端點"""
    sb = get_supabase()
    if sb:
        try:
            resp = (
                sb.table("push_subscriptions")
                .select("endpoint,p256dh,auth")
                .eq("user_id", user_id)
                .execute()
            )
            return resp.data or []
        except Exception as e:
            logger.warning("[push] Supabase read failed, fallback to memory: %s", e)

    return [s for s in _subscriptions if s["user_id"] == user_id]


# ── Push send ─────────────────────────────────────────────────────────────────

async def send_push_to_user(
    user_id: str,
    title: str,
    body: str,
    url: str = "/",
    tag:  str = "price-alert",
) -> int:
    """
    發送 Web Push 通知給指定用戶的所有訂閱端點。
    回傳成功發送的端點數。

    VAPID 未設定（vapid_private_key 為空）時靜默跳過，不報錯。
    """
    if not settings.vapid_private_key or not settings.vapid_public_key:
        logger.debug("[push] VAPID 未設定，跳過 push（uid=%s）", user_id[:8])
        return 0

    subs = get_subscriptions_for_user(user_id)
    if not subs:
        return 0

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("[push] pywebpush 未安裝，跳過發送")
        return 0

    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    sent = 0
    dead: list[str] = []

    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_sub},
                ttl=86400,
            )
            sent += 1
        except Exception as exc:
            # pywebpush raises WebPushException; also guard generic exceptions
            status: Optional[int] = None
            try:
                from pywebpush import WebPushException as WPE  # noqa
                if isinstance(exc, WPE) and exc.response is not None:
                    status = exc.response.status_code
            except ImportError:
                pass

            if status in (404, 410):
                # Subscription is gone (browser unregistered) — clean up
                dead.append(sub["endpoint"])
                logger.info("[push] 端點已失效（%s），排程清除", status)
            else:
                logger.warning("[push] 發送失敗 ep=...%s: %s", sub["endpoint"][-20:], exc)

    for ep in dead:
        delete_subscription(user_id, ep)

    if sent > 0:
        logger.info("[push] 發送成功 %d/%d to uid=%s", sent, len(subs), user_id[:8])
    return sent
