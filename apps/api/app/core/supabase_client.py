"""
Supabase 客戶端 — 懶初始化單例
未設定 SUPABASE_URL / SUPABASE_KEY 時回傳 None，功能自動降級
"""
import base64
import json
import logging

logger = logging.getLogger(__name__)

_client = None
_init_attempted = False


def _assert_anon_key(key: str) -> None:
    """Warn loudly if someone accidentally supplies the service-role key.

    The service-role key bypasses all Supabase RLS policies, which would
    expose every user's data to cross-user access.
    """
    try:
        # JWT payload is the second segment (base64url-encoded JSON)
        padded = key.split(".")[1] + "=="
        payload = json.loads(base64.b64decode(padded))
        if payload.get("role") == "service_role":
            raise RuntimeError(
                "CRITICAL: SUPABASE_KEY is the service-role key. "
                "This bypasses ALL Row-Level Security policies. "
                "Set SUPABASE_KEY to the anon/public key instead."
            )
    except RuntimeError:
        raise
    except Exception:
        # Can't decode — key may be malformed; still try to connect
        logger.warning("Could not decode SUPABASE_KEY JWT to verify role — proceeding")


def get_supabase():
    """回傳 Supabase Client（anon key），未設定則回傳 None（不拋例外）"""
    global _client, _init_attempted
    if _init_attempted:
        return _client
    _init_attempted = True

    from app.core.config import settings
    if not settings.supabase_url or not settings.supabase_key:
        logger.info("Supabase 未設定，跳過 DB 快取（使用 live API fallback）")
        return None

    _assert_anon_key(settings.supabase_key)

    try:
        from supabase import create_client
        _client = create_client(settings.supabase_url, settings.supabase_key)
        logger.info("Supabase 客戶端初始化成功")
    except Exception as e:
        logger.error(f"Supabase 初始化失敗: {e}")
        _client = None

    return _client


# ── Admin client（service_role key，後端寫入專用）──────────────────────────────

_admin_client = None
_admin_init_attempted = False


def get_supabase_admin():
    """
    回傳 service_role Supabase Client，供後端寫入 kline_daily / chips_daily 等快取表。
    service_role 繞過 RLS — 僅限後端 server-side 呼叫，絕不暴露給前端。
    未設定 SUPABASE_SERVICE_KEY 則回傳 None（靜默降級，不影響讀取功能）。
    """
    global _admin_client, _admin_init_attempted
    if _admin_init_attempted:
        return _admin_client
    _admin_init_attempted = True

    from app.core.config import settings
    if not settings.supabase_url or not settings.supabase_service_key:
        logger.info("SUPABASE_SERVICE_KEY 未設定，Supabase 寫入快取停用")
        return None

    try:
        from supabase import create_client
        _admin_client = create_client(settings.supabase_url, settings.supabase_service_key)
        logger.info("Supabase admin 客戶端初始化成功（service_role）")
    except Exception as e:
        logger.error(f"Supabase admin 初始化失敗: {e}")
        _admin_client = None

    return _admin_client
