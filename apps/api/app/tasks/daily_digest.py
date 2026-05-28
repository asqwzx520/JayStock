"""
每日盤前 AI 精選推播任務
由 scheduler.py 在 08:00 Asia/Taipei 呼叫
"""

import logging
from app.services.digest_service import run_daily_digest

logger = logging.getLogger(__name__)


async def send_daily_digest() -> None:
    """APScheduler 任務入口"""
    try:
        await run_daily_digest()
    except Exception as exc:
        logger.error("send_daily_digest failed: %s", exc, exc_info=True)
