"""
/api/v1/feedback — Beta 用戶回饋端點

接收前端 FeedbackWidget 送來的使用者回饋，
儲存到本地 JSONL 紀錄檔（feedback.jsonl）。
後續可換成 Supabase 寫入或寄信通知。
"""

import json
import logging
import os
import stat
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr, Field

from app.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter()

# ── 儲存路徑（使用 /tmp 或 DATA_DIR 環境變數）────────────────────────────────
_DATA_DIR = Path(os.environ.get("DATA_DIR", "/tmp"))
_FEEDBACK_FILE = _DATA_DIR / "feedback.jsonl"


# ── Request schema ─────────────────────────────────────────────────────────────
class FeedbackRequest(BaseModel):
    category: str           = Field(..., pattern=r"^(bug|feature|ux|other)$")
    message:  str           = Field(..., min_length=1, max_length=2000)
    contact:  EmailStr | None = None   # validated email（選填）
    url:      str | None    = None     # 來源頁面
    ua:       str | None    = None     # user-agent


# ── Response schema ────────────────────────────────────────────────────────────
class FeedbackResponse(BaseModel):
    ok:      bool
    message: str
    id:      str


# ── POST /api/v1/feedback ──────────────────────────────────────────────────────
@router.post("/feedback", response_model=FeedbackResponse, status_code=201)
@limiter.limit("3/minute")
async def submit_feedback(request: Request, body: FeedbackRequest):
    """接收並儲存使用者回饋"""
    ts = datetime.now(timezone.utc)
    entry_id = ts.strftime("%Y%m%dT%H%M%S%f")

    record = {
        "id":        entry_id,
        "ts":        ts.isoformat(),
        "category":  body.category,
        "message":   body.message,
        "contact":   str(body.contact) if body.contact else None,
        "url":       body.url,
        # 不儲存完整 UA，只保留前 200 字元避免過大
        "ua":        (body.ua or "")[:200] if body.ua else None,
    }

    # ── 寫入 JSONL ─────────────────────────────────────────────────────────────
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        with _FEEDBACK_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        # Restrict file to owner read/write only (not world-readable)
        _FEEDBACK_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)
        logger.info("Feedback [%s] %s: %.80s", entry_id, body.category, body.message)
    except Exception as exc:
        logger.error("Failed to write feedback: %s", exc)
        # 記錄失敗不應讓前端看到 500；對用戶友善仍返回成功

    return FeedbackResponse(
        ok=True,
        message="感謝您的回饋！",
        id=entry_id,
    )
