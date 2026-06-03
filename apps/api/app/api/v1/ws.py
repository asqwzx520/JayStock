"""
WebSocket 即時行情推播
端點：ws(s)://host/ws/quotes?symbols=2330,2317,0050

盤中（09:00–13:35 台灣時間，週一~五）每 5 秒推送一次。
盤外降頻到 30 秒。
只推送有變動的報價（diff）；無變動發心跳 {"type":"ping"}。
"""
import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.twse_fetcher import fetch_quotes, CircuitOpenError
from app.core.validators import validate_symbol

logger = logging.getLogger(__name__)
router = APIRouter()

TZ_TAIPEI = ZoneInfo("Asia/Taipei")

# Per-IP connection tracking (in-memory; fine for single-worker)
_MAX_CONNS_PER_IP = 10
_ip_conn_count: dict[str, int] = defaultdict(int)

# Idle timeout: close if no data received from server side for this many seconds
_IDLE_TIMEOUT = 120


def _market_interval() -> int:
    """盤中 5 秒，盤外 30 秒"""
    now = datetime.now(tz=TZ_TAIPEI)
    if now.weekday() >= 5:
        return 30
    t = (now.hour, now.minute)
    return 5 if (9, 0) <= t <= (13, 35) else 30


def _client_ip(websocket: WebSocket) -> str:
    """Extract the real client IP, respecting X-Forwarded-For from a trusted proxy."""
    forwarded = websocket.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = websocket.client
    return client.host if client else "unknown"


@router.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket) -> None:
    """
    Query params:
      symbols=2330,2317,0050  （逗號分隔，最多 50 個）

    訊息格式（JSON）：
      {"type": "quotes", "data": {symbol: Quote, ...}}   — 報價更新
      {"type": "ping"}                                    — 心跳（無變動）
      {"type": "stale"}                                   — circuit breaker 開路
      {"type": "error", "msg": "..."}                     — 抓取失敗
    """
    client_ip = _client_ip(websocket)

    # Per-IP connection limit
    if _ip_conn_count[client_ip] >= _MAX_CONNS_PER_IP:
        await websocket.close(code=1008, reason="Too many connections from this IP")
        return

    await websocket.accept()
    _ip_conn_count[client_ip] += 1

    try:
        # Validate and sanitise symbols
        symbols_raw = websocket.query_params.get("symbols", "")
        raw_list = [s.strip() for s in symbols_raw.split(",") if s.strip()][:50]
        try:
            symbols = [validate_symbol(s) for s in raw_list]
        except Exception:
            await websocket.close(code=1003, reason="Invalid symbol format")
            return

        if not symbols:
            await websocket.close(code=1003, reason="No symbols")
            return

        logger.info("[WS/quotes] connected ip=%s symbols=%s", client_ip, ",".join(symbols[:5]))
        last_prices: dict[str, float] = {}
        first_push = True
        idle_elapsed = 0

        while True:
            interval = _market_interval()
            try:
                raw = await asyncio.wait_for(fetch_quotes(symbols), timeout=10)

                if first_push:
                    await websocket.send_text(json.dumps({"type": "quotes", "data": raw}))
                    last_prices = {s: q["price"] for s, q in raw.items()}
                    first_push = False
                    idle_elapsed = 0
                else:
                    diff = {
                        s: q for s, q in raw.items()
                        if last_prices.get(s) != q.get("price")
                    }
                    if diff:
                        await websocket.send_text(json.dumps({"type": "quotes", "data": diff}))
                        for s, q in diff.items():
                            last_prices[s] = q["price"]
                        idle_elapsed = 0
                    else:
                        await websocket.send_text(json.dumps({"type": "ping"}))
                        idle_elapsed += interval
                        if idle_elapsed >= _IDLE_TIMEOUT:
                            logger.info("[WS/quotes] idle timeout ip=%s", client_ip)
                            await websocket.close(code=1000, reason="Idle timeout")
                            return

            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "error", "msg": "fetch timeout"}))
            except CircuitOpenError:
                await websocket.send_text(json.dumps({"type": "stale"}))
            except Exception as exc:
                logger.warning("[WS/quotes] fetch error: %s", exc)
                await websocket.send_text(json.dumps({"type": "error", "msg": str(exc)}))

            await asyncio.sleep(interval)

    except WebSocketDisconnect:
        logger.info("[WS/quotes] disconnected ip=%s", client_ip)
    finally:
        _ip_conn_count[client_ip] = max(0, _ip_conn_count[client_ip] - 1)
