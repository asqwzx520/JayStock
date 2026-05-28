"""
Supabase 客戶端 — 懶初始化單例
未設定 SUPABASE_URL / SUPABASE_KEY 時回傳 None，功能自動降級
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_client = None
_init_attempted = False


def get_supabase():
    """回傳 Supabase Client，未設定則回傳 None（不拋例外）"""
    global _client, _init_attempted
    if _init_attempted:
        return _client
    _init_attempted = True

    from app.core.config import settings
    if not settings.supabase_url or not settings.supabase_key:
        logger.info("Supabase 未設定，跳過 DB 快取（使用 live API fallback）")
        return None

    try:
        from supabase import create_client
        _client = create_client(settings.supabase_url, settings.supabase_key)
        logger.info("Supabase 客戶端初始化成功")
    except Exception as e:
        logger.error(f"Supabase 初始化失敗: {e}")
        _client = None

    return _client
