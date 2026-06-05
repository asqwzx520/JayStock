"""
盤前 AI 精選推播 API

POST /api/v1/digest/send   — 手動觸發（測試用）
GET  /api/v1/digest/status — 確認 SMTP 設定是否完整
"""
import os
import logging
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Request
from app.core.rate_limit import limiter
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/digest/status")
async def digest_status():
    """回傳 SMTP / recipient 設定狀態（不洩露實際值）"""
    smtp_user = os.environ.get("DIGEST_SMTP_USER", "")
    smtp_pass = os.environ.get("DIGEST_SMTP_PASS", "")
    recipients = os.environ.get("DIGEST_RECIPIENTS", "")
    recipient_list = [e.strip() for e in recipients.split(",") if e.strip()]

    return {
        "smtp_configured": bool(smtp_user and smtp_pass),
        "smtp_user_set":   bool(smtp_user),
        "smtp_pass_set":   bool(smtp_pass),
        "recipient_count": len(recipient_list),
        "recipients_set":  bool(recipient_list),
        "ready":           bool(smtp_user and smtp_pass and recipient_list),
    }


@router.post("/digest/send")
@limiter.limit("3/minute")
async def send_digest(
    request: Request,
    x_admin_token: Optional[str] = Header(default=None),
):
    """
    手動觸發盤前 AI 精選推播（測試 / 補發用）。

    注意：screener 快取需要有資料（曾呼叫過 /api/v1/screener/run）
    若快取空白，會先執行一次 screener refresh 再送信。
    """
    if not settings.admin_token or x_admin_token != settings.admin_token:
        raise HTTPException(status_code=403, detail="Forbidden")

    from app.services.digest_service import (
        _get_cached_metrics, _pick_top5, _generate_reason,
        _fallback_reason, _build_html, _send_email,
    )
    import asyncio
    from datetime import date

    # 1. 確認 SMTP 設定
    smtp_user = os.environ.get("DIGEST_SMTP_USER", "")
    smtp_pass = os.environ.get("DIGEST_SMTP_PASS", "")
    recipients_raw = os.environ.get("DIGEST_RECIPIENTS", "")
    recipients = [e.strip() for e in recipients_raw.split(",") if e.strip()]

    if not smtp_user or not smtp_pass:
        raise HTTPException(
            status_code=503,
            detail="SMTP credentials not configured. Set DIGEST_SMTP_USER and DIGEST_SMTP_PASS in Render environment variables.",
        )
    if not recipients:
        raise HTTPException(
            status_code=503,
            detail="DIGEST_RECIPIENTS not set. Add comma-separated email addresses in Render environment variables.",
        )

    # 2. 取選股快取；若空白先跑一次 screener refresh
    metrics = _get_cached_metrics()
    if not metrics:
        logger.info("Digest: screener cache empty — running refresh first")
        try:
            from app.services.screener_service import refresh_metrics
            await refresh_metrics()
            metrics = _get_cached_metrics()
        except Exception as exc:
            logger.warning("Screener refresh failed: %s", exc)

    if not metrics:
        raise HTTPException(
            status_code=503,
            detail="Screener cache is empty and refresh failed. Try calling POST /api/v1/screener/run first.",
        )

    # 3. 選 Top-5
    picks = _pick_top5(metrics)
    if not picks:
        raise HTTPException(
            status_code=422,
            detail="No qualifying stocks found (score < 30). Market data may be stale.",
        )

    # 4. 生成 AI 理由（並行）
    reasons = await asyncio.gather(
        *[_generate_reason(s) for s in picks],
        return_exceptions=True,
    )
    for s, r in zip(picks, reasons):
        s["reason"] = r if isinstance(r, str) else _fallback_reason(s)

    # 5. 送信
    html    = _build_html(picks)
    today   = date.today().strftime("%Y/%m/%d")
    subject = f"📊 StockPulse 盤前 AI 精選 Top5 — {today}"
    success = _send_email(subject, html, recipients)

    if not success:
        raise HTTPException(
            status_code=502,
            detail="Email send failed. Check Render logs for SMTP error details.",
        )

    return {
        "ok":         True,
        "sent_to":    len(recipients),
        "picks":      [{"symbol": s["symbol"], "name": s["name"], "score": s["score"]} for s in picks],
        "subject":    subject,
    }
