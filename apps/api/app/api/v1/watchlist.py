"""
自選股 Watchlist CRUD API

認證策略（MVP）：X-User-ID header（UUID，由前端 localStorage 產生）
儲存策略（MVP）：in-memory dict，重啟後清空（Supabase 整合留待 M2.5）

端點：
  GET    /api/v1/watchlist              → 取得完整 watchlist state
  POST   /api/v1/watchlist/sync         → 全量同步（前端送完整 state，後端存並回傳）
  POST   /api/v1/watchlist/groups       → 新增群組
  PUT    /api/v1/watchlist/groups/{gid} → 更新群組（名稱 / 排序）
  DELETE /api/v1/watchlist/groups/{gid} → 刪除群組（含內部所有股票）
  POST   /api/v1/watchlist/groups/{gid}/items   → 新增股票
  DELETE /api/v1/watchlist/items/{iid}           → 移除股票
  PUT    /api/v1/watchlist/items/{iid}           → 更新股票（備注/標籤/排序/到價提醒）
"""

import uuid
from typing import Optional
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter()

# ── In-memory store ───────────────────────────────────────────────────────────
# { user_id: WatchlistState }
_store: dict[str, dict] = {}

_DEFAULT_GROUP_ID = "default"

def _initial_state() -> dict:
    return {
        "groups": [
            {"id": _DEFAULT_GROUP_ID, "name": "自選股", "sort_order": 0}
        ],
        "items": {
            _DEFAULT_GROUP_ID: [
                {"id": f"item_{s}", "symbol": s, "note": "", "tags": [],
                 "sort_order": i, "price_alert_above": None, "price_alert_below": None}
                for i, s in enumerate(["2330", "2317", "2454", "2881", "0050"])
            ]
        },
    }

def _get(user_id: str) -> dict:
    if user_id not in _store:
        _store[user_id] = _initial_state()
    return _store[user_id]

def _require_user(x_user_id: Optional[str]) -> str:
    if not x_user_id or len(x_user_id) < 8:
        raise HTTPException(status_code=401, detail="Missing or invalid X-User-ID header")
    return x_user_id


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str
    sort_order: int = 0

class GroupUpdate(BaseModel):
    name:       Optional[str] = None
    sort_order: Optional[int] = None

class ItemCreate(BaseModel):
    symbol: str
    note:   str   = ""
    tags:   list[str] = []
    sort_order: int = 0
    price_alert_above: Optional[float] = None
    price_alert_below: Optional[float] = None

class ItemUpdate(BaseModel):
    note:       Optional[str]   = None
    tags:       Optional[list[str]] = None
    sort_order: Optional[int]   = None
    price_alert_above: Optional[float] = None
    price_alert_below: Optional[float] = None

class SyncPayload(BaseModel):
    """前端送來的完整 watchlist state，後端直接覆蓋"""
    groups: list[dict]
    items:  dict[str, list[dict]]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/watchlist")
async def get_watchlist(x_user_id: Optional[str] = Header(default=None)):
    uid = _require_user(x_user_id)
    return _get(uid)


@router.post("/watchlist/sync")
async def sync_watchlist(
    payload: SyncPayload,
    x_user_id: Optional[str] = Header(default=None),
):
    """全量同步：前端送完整 state，後端存並回傳（可當作 PUT /watchlist）"""
    uid = _require_user(x_user_id)
    _store[uid] = {"groups": payload.groups, "items": payload.items}
    return _store[uid]


# ── Group CRUD ────────────────────────────────────────────────────────────────

@router.post("/watchlist/groups", status_code=201)
async def create_group(
    body: GroupCreate,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get(uid)
    gid   = f"g_{uuid.uuid4().hex[:8]}"
    state["groups"].append({"id": gid, "name": body.name, "sort_order": body.sort_order})
    state["items"][gid] = []
    return {"id": gid, "name": body.name, "sort_order": body.sort_order}


@router.put("/watchlist/groups/{group_id}")
async def update_group(
    group_id: str,
    body: GroupUpdate,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get(uid)
    for g in state["groups"]:
        if g["id"] == group_id:
            if body.name       is not None: g["name"]       = body.name
            if body.sort_order is not None: g["sort_order"] = body.sort_order
            return g
    raise HTTPException(404, f"Group {group_id} not found")


@router.delete("/watchlist/groups/{group_id}", status_code=204)
async def delete_group(
    group_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get(uid)
    if len(state["groups"]) <= 1:
        raise HTTPException(400, "Cannot delete the last group")
    state["groups"] = [g for g in state["groups"] if g["id"] != group_id]
    state["items"].pop(group_id, None)


# ── Item CRUD ─────────────────────────────────────────────────────────────────

@router.post("/watchlist/groups/{group_id}/items", status_code=201)
async def add_item(
    group_id: str,
    body: ItemCreate,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get(uid)
    if group_id not in state["items"]:
        raise HTTPException(404, f"Group {group_id} not found")
    # 防重複
    sym = body.symbol.upper()
    for it in state["items"][group_id]:
        if it["symbol"] == sym:
            return it
    iid = f"item_{uuid.uuid4().hex[:8]}"
    item = {
        "id": iid, "symbol": sym, "note": body.note, "tags": body.tags,
        "sort_order": body.sort_order,
        "price_alert_above": body.price_alert_above,
        "price_alert_below": body.price_alert_below,
    }
    state["items"][group_id].append(item)
    return item


@router.delete("/watchlist/items/{item_id}", status_code=204)
async def remove_item(
    item_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get(uid)
    for gid, items in state["items"].items():
        state["items"][gid] = [it for it in items if it["id"] != item_id]


@router.put("/watchlist/items/{item_id}")
async def update_item(
    item_id: str,
    body: ItemUpdate,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get(uid)
    for items in state["items"].values():
        for it in items:
            if it["id"] == item_id:
                if body.note               is not None: it["note"]               = body.note
                if body.tags               is not None: it["tags"]               = body.tags
                if body.sort_order         is not None: it["sort_order"]         = body.sort_order
                if body.price_alert_above  is not None: it["price_alert_above"]  = body.price_alert_above
                if body.price_alert_below  is not None: it["price_alert_below"]  = body.price_alert_below
                return it
    raise HTTPException(404, f"Item {item_id} not found")
