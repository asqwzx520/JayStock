"""
TWSE 非官方即時報價 Endpoint
mis.twse.com.tw — 盤中每 5-10 秒更新，社群廣泛使用

防護機制（詳見 ARCHITECTURE.md §3.3）：
  - User-Agent / Referer 模擬瀏覽器
  - Circuit Breaker：連續 3 次失敗 → 斷路 5 分鐘，不再打 TWSE
  - Fallback：Redis 快取最後報價 → FinMind kline close → 顯示「資料延遲」
"""
import httpx
import asyncio
import time
from typing import Optional

TWSE_QUOTE_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://mis.twse.com.tw/",
}

# ── Circuit Breaker 狀態 ──────────────────────────────────────────────────────
_consecutive_failures: int = 0
_circuit_open_until:   float = 0.0   # epoch seconds
_FAILURE_THRESHOLD = 3
_CIRCUIT_TIMEOUT   = 300             # 5 分鐘斷路


def _is_circuit_open() -> bool:
    return time.time() < _circuit_open_until


def _record_success() -> None:
    global _consecutive_failures, _circuit_open_until
    _consecutive_failures = 0
    _circuit_open_until   = 0.0


def _record_failure() -> None:
    global _consecutive_failures, _circuit_open_until
    _consecutive_failures += 1
    if _consecutive_failures >= _FAILURE_THRESHOLD:
        _circuit_open_until = time.time() + _CIRCUIT_TIMEOUT
        _consecutive_failures = 0


# ── 公開 API ─────────────────────────────────────────────────────────────────

class CircuitOpenError(Exception):
    """TWSE circuit breaker 已開路，請使用 fallback 資料"""


async def fetch_quotes(symbols: list[str]) -> dict:
    """
    批次查詢多檔股票即時報價。
    symbols: ["2330", "2317", ...]
    回傳格式：{ "2330": { price, change, change_pct, volume, ..., stale: False } }

    Raises CircuitOpenError 若 circuit breaker 已開路。
    """
    if _is_circuit_open():
        raise CircuitOpenError("TWSE circuit open — use fallback")

    ex_ch = "|".join(f"tse_{s}.tw" for s in symbols)
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                TWSE_QUOTE_URL,
                params={"ex_ch": ex_ch},
                headers=HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        _record_failure()
        raise exc

    _record_success()
    result = {}
    for item in data.get("msgArray", []):
        symbol = item.get("c", "")
        if not symbol:
            continue
        try:
            price = float(item.get("z", item.get("y", 0)))   # z=現價, y=昨收（無成交時）
            prev  = float(item.get("y", price))
            change     = round(price - prev, 2)
            change_pct = round((change / prev) * 100, 2) if prev else 0.0
            result[symbol] = {
                "symbol":     symbol,
                "name":       item.get("n", ""),
                "price":      price,
                "open":       _safe_float(item.get("o")),
                "high":       _safe_float(item.get("h")),
                "low":        _safe_float(item.get("l")),
                "prev_close": prev,
                "change":     change,
                "change_pct": change_pct,
                "volume":     _safe_int(item.get("v")),
                "bid":        _safe_float(item.get("b", "").split("_")[0]),
                "ask":        _safe_float(item.get("a", "").split("_")[0]),
                "time":       item.get("t", ""),
                "stale":      False,
            }
        except (ValueError, TypeError):
            continue
    return result


def make_stale_quote(symbol: str, fallback_price: float) -> dict:
    """建立標記 stale=True 的近似報價（fallback 用）"""
    return {
        "symbol":     symbol,
        "name":       symbol,
        "price":      fallback_price,
        "open":       0.0,
        "high":       0.0,
        "low":        0.0,
        "prev_close": fallback_price,
        "change":     0.0,
        "change_pct": 0.0,
        "volume":     0,
        "bid":        0.0,
        "ask":        0.0,
        "time":       "",
        "stale":      True,    # ⚠️ 前端顯示「資料延遲」
    }


def _safe_float(val: Optional[str]) -> float:
    try:
        return float(val) if val and val != "-" else 0.0
    except (ValueError, TypeError):
        return 0.0


def _safe_int(val: Optional[str]) -> int:
    try:
        return int(val) if val and val != "-" else 0
    except (ValueError, TypeError):
        return 0
