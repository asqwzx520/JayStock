"""
簡易 in-process TTL 快取

用法：
    from app.core.cache import ttl_cache

    @ttl_cache(ttl=300)          # 5 分鐘
    async def my_async_func(a, b):
        ...

    @ttl_cache(ttl=60)           # 1 分鐘（同步也支援）
    def my_sync_func(x):
        ...

特性：
- 以函數完整名稱 + 所有位置/關鍵字參數的 repr 為 key
- 多個裝飾實例共享同一個模組層級 dict，不會因重新 import 而清空
- 不做 LRU eviction，但最大條目數 MAX_ENTRIES 達到後直接清空（簡單安全）
- 完全同步，無鎖；FastAPI 單執行緒 event loop 環境已足夠

TTL 建議值（應用面）：
    日K / 法人 / 融資  —— 300 s（5 分鐘），盤後靜態資料
    分鐘K              —— 30  s（盤中 1m K 頻繁更新）
    市場全市場法人      —— 300 s
    個股即時報價        —— 5   s（由 TWSE 端控制；WebSocket 另行管理）
"""
from __future__ import annotations

import asyncio
import functools
import time
from typing import Any, Callable

MAX_ENTRIES = 2_000          # 超過就整個清掉（簡單防 OOM）

_store: dict[str, tuple[float, Any]] = {}   # key → (expires_at, value)


def _make_key(func: Callable, args: tuple, kwargs: dict) -> str:
    return f"{func.__module__}.{func.__qualname__}:{repr(args)}:{repr(sorted(kwargs.items()))}"


def ttl_cache(ttl: int = 300):
    """
    裝飾器工廠，ttl 單位為秒。
    支援 async def 與 def 函數。
    """
    def decorator(func: Callable) -> Callable:
        if asyncio.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                key = _make_key(func, args, kwargs)
                now = time.monotonic()
                entry = _store.get(key)
                if entry and entry[0] > now:
                    return entry[1]
                result = await func(*args, **kwargs)
                if len(_store) >= MAX_ENTRIES:
                    _store.clear()
                _store[key] = (now + ttl, result)
                return result
            return async_wrapper
        else:
            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs):
                key = _make_key(func, args, kwargs)
                now = time.monotonic()
                entry = _store.get(key)
                if entry and entry[0] > now:
                    return entry[1]
                result = func(*args, **kwargs)
                if len(_store) >= MAX_ENTRIES:
                    _store.clear()
                _store[key] = (now + ttl, result)
                return result
            return sync_wrapper
    return decorator


def cache_clear_prefix(prefix: str) -> int:
    """刪除 key 開頭符合 prefix 的所有條目，回傳刪除數量。"""
    to_delete = [k for k in _store if k.startswith(prefix)]
    for k in to_delete:
        del _store[k]
    return len(to_delete)


def cache_stats() -> dict:
    now = time.monotonic()
    alive = sum(1 for _, (exp, _) in _store.items() if exp > now)
    return {"total": len(_store), "alive": alive, "expired": len(_store) - alive}
