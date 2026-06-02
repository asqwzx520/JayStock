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
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.twse_fetcher import fetch_quotes, CircuitOpenError

logger = logging.getLogger(__name__)
router = APIRouter()

TZ_TAIPEI = ZoneInfo("Asia/Taipei")


def _market_interval() -> int:
    """盤中 5 秒，盤外 30 秒"""
    now = datetime.now(tz=TZ_TAIPEI)
    if now.weekday() >= 5:
        return 30
    t = (now.hour, now.minute)
    return 5 if (9, 0) <= t <= (13, 35) else 30


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
    await websocket.accept()

    symbols_raw = websocket.query_params.get("symbols", "")
    symbols = [s.strip().upper() for s in symbols_raw.split(",") if s.strip()][:50]

    if not symbols:
        await websocket.close(code=1003, reason="No symbols")
        return

    logger.info("[WS/quotes] connected symbols=%s", ",".join(symbols[:5]))
    last_prices: dict[str, float] = {}
    first_push = True

    try:
        while True:
            interval = _market_interval()
            try:
                raw = await fetch_quotes(symbols)

                if first_push:
                    # 第一次全量推送
                    await websocket.send_text(json.dumps({"type": "quotes", "data": raw}))
                    last_prices = {s: q["price"] for s, q in raw.items()}
                    first_push = False
                else:
                    diff = {
                        s: q for s, q in raw.items()
                        if last_prices.get(s) != q.get("price")
                    }
                    if diff:
                        await websocket.send_text(json.dumps({"type": "quotes", "data": diff}))
                        for s, q in diff.items():
                            last_prices[s] = q["price"]
                    else:
                        await websocket.send_text(json.dumps({"type": "ping"}))

            except CircuitOpenError:
                await websocket.send_text(json.dumps({"type": "stale"}))
            except Exception as exc:
                logger.warning("[WS/quotes] fetch error: %s", exc)
                await websocket.send_text(json.dumps({"type": "error", "msg": str(exc)}))

            await asyncio.sleep(interval)

    except WebSocketDisconnect:
        logger.info("[WS/quotes] disconnected (was watching %s)", ",".join(symbols[:3]))
