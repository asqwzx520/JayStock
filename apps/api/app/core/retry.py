"""
重試 wrapper + 失敗記錄

用法：
    from app.core.retry import with_retry, log_failure, process_pending_failures

    @with_retry(max_attempts=3)
    async def fetch_kline_for(symbol):
        ...

    或：
    await log_failure("daily_kline_tier1", symbol="2330", error="429 quota")
    await process_pending_failures("daily_kline_tier1", retry_fn=lambda s, d: ...)
"""
from __future__ import annotations

import asyncio
import functools
import logging
from datetime import date
from typing import Awaitable, Callable, TypeVar

from app.core.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

T = TypeVar("T")


def with_retry(max_attempts: int = 3, base_delay: float = 2.0):
    """
    Async exponential backoff retry decorator.
    Delays：base_delay × 2^attempt（2s, 4s, 8s）
    """
    def decorator(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            last_exc: Exception | None = None
            for attempt in range(max_attempts):
                try:
                    return await fn(*args, **kwargs)
                except Exception as e:
                    last_exc = e
                    if attempt == max_attempts - 1:
                        break
                    delay = base_delay * (2 ** attempt)
                    logger.warning(
                        "[retry] %s attempt %d/%d failed: %s (retry in %.1fs)",
                        fn.__name__, attempt + 1, max_attempts, e, delay,
                    )
                    await asyncio.sleep(delay)
            raise last_exc if last_exc else RuntimeError("retry failed")
        return wrapper
    return decorator


async def log_failure(
    job_name: str,
    *,
    symbol: str | None = None,
    target_date: date | None = None,
    error: str = "",
) -> None:
    """
    失敗時寫進 cache_failures 表，下一輪 daily job 開頭自動 retry。
    Supabase 未設定則靜默 skip。
    """
    db = get_supabase_admin()
    if db is None:
        return
    try:
        db.table("cache_failures").insert({
            "job_name":      job_name,
            "target_symbol": symbol,
            "target_date":   target_date.isoformat() if target_date else None,
            "error_msg":     (error or "")[:500],
        }).execute()
    except Exception as e:
        logger.warning("[retry.log_failure] %s", e)


async def process_pending_failures(
    job_name: str,
    retry_fn: Callable[[str | None, date | None], Awaitable[bool]],
    *,
    max_items: int = 50,
) -> int:
    """
    處理該 job 未解決的失敗。
    retry_fn(symbol, target_date) → bool（True 表示這次成功）
    回傳成功 resolved 的筆數。
    """
    db = get_supabase_admin()
    if db is None:
        return 0

    try:
        resp = (
            db.table("cache_failures")
            .select("id, target_symbol, target_date, retry_count")
            .eq("job_name", job_name)
            .eq("resolved", False)
            .lt("retry_count", 5)
            .order("created_at", desc=False)
            .limit(max_items)
            .execute()
        )
        rows = resp.data or []
    except Exception as e:
        logger.warning("[retry.process_pending] query failed: %s", e)
        return 0

    resolved = 0
    for r in rows:
        sym = r.get("target_symbol")
        td  = r.get("target_date")
        td_parsed = date.fromisoformat(td) if td else None
        try:
            ok = await retry_fn(sym, td_parsed)
        except Exception as e:
            ok = False
            logger.debug("[retry.process_pending] %s %s failed: %s", job_name, sym, e)

        if ok:
            try:
                db.table("cache_failures").update({"resolved": True}).eq("id", r["id"]).execute()
                resolved += 1
            except Exception:
                pass
        else:
            try:
                db.table("cache_failures").update({
                    "retry_count": (r.get("retry_count") or 0) + 1,
                }).eq("id", r["id"]).execute()
            except Exception:
                pass
    return resolved
