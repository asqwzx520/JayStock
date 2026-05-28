"""
自選股 Watchlist CRUD API

認證策略：X-User-ID header（UUID，由前端 localStorage 產生）
儲存策略：Supabase（設定時）；未設定自動 fallback 到 in-memory
"""

import uuid
import logging
from typing import Optional
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.core.supabase_client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()

# ── In-memory fallback（Supabase 未設定時使用）────────────────────────────────
_store: dict[str, dict] = {}
_DEFAULT_GROUP_ID = "default"


def _initial_state() -> dict:
    return {
        "groups": [
            {"id": _DEFAULT_GROUP_ID, "name": "自選股", "sort_order": 0}
        ],
        "items": {
            _DEFAULT_GROUP_ID: [
                {
                    "id": f"item_{s}", "symbol": s, "note": "", "tags": [],
                    "sort_order": i,
                    "price_alert_above": None, "price_alert_below": None,
                }
                for i, s in enumerate(["2330", "2317", "2454", "2881", "0050"])
            ]
        },
    }


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _db_load(user_id: str) -> dict | None:
    """從 Supabase 讀取完整 state；失敗或未設定回傳 None"""
    try:
        sb = get_supabase()
        if sb is None:
            return None

        g_resp = (
            sb.table("watchlist_groups")
            .select("id,name,sort_order")
            .eq("user_id", user_id)
            .order("sort_order")
            .execute()
        )
        i_resp = (
            sb.table("watchlist_items")
            .select("id,group_id,symbol,note,tags,sort_order,price_alert_above,price_alert_below")
            .eq("user_id", user_id)
            .order("sort_order")
            .execute()
        )

        groups = g_resp.data or []
        raw_items = i_resp.data or []

        items: dict[str, list] = {g["id"]: [] for g in groups}
        for it in raw_items:
            gid = it["group_id"]
            if gid not in items:
                items[gid] = []
            items[gid].append({
                "id":                it["id"],
                "symbol":            it["symbol"],
                "note":              it.get("note") or "",
                "tags":              it.get("tags") or [],
                "sort_order":        it.get("sort_order", 0),
                "price_alert_above": it.get("price_alert_above"),
                "price_alert_below": it.get("price_alert_below"),
            })

        return {"groups": groups, "items": items}
    except Exception as e:
        logger.warning(f"[watchlist] Supabase 讀取失敗，fallback to memory: {e}")
        return None


def _db_upsert_group(user_id: str, group: dict) -> bool:
    try:
        sb = get_supabase()
        if sb is None:
            return False
        sb.table("watchlist_groups").upsert(
            {"id": group["id"], "user_id": user_id,
             "name": group["name"], "sort_order": group.get("sort_order", 0)}
        ).execute()
        return True
    except Exception as e:
        logger.warning(f"[watchlist] group upsert 失敗: {e}")
        return False


def _db_delete_group(user_id: str, group_id: str) -> bool:
    try:
        sb = get_supabase()
        if sb is None:
            return False
        sb.table("watchlist_items").delete().eq("user_id", user_id).eq("group_id", group_id).execute()
        sb.table("watchlist_groups").delete().eq("user_id", user_id).eq("id", group_id).execute()
        return True
    except Exception as e:
        logger.warning(f"[watchlist] group delete 失敗: {e}")
        return False


def _db_upsert_item(user_id: str, group_id: str, item: dict) -> bool:
    try:
        sb = get_supabase()
        if sb is None:
            return False
        sb.table("watchlist_items").upsert({
            "id":                item["id"],
            "user_id":           user_id,
            "group_id":          group_id,
            "symbol":            item["symbol"],
            "note":              item.get("note", ""),
            "tags":              item.get("tags", []),
            "sort_order":        item.get("sort_order", 0),
            "price_alert_above": item.get("price_alert_above"),
            "price_alert_below": item.get("price_alert_below"),
        }).execute()
        return True
    except Exception as e:
        logger.warning(f"[watchlist] item upsert 失敗: {e}")
        return False


def _db_delete_item(user_id: str, item_id: str) -> bool:
    try:
        sb = get_supabase()
        if sb is None:
            return False
        sb.table("watchlist_items").delete().eq("user_id", user_id).eq("id", item_id).execute()
        return True
    except Exception as e:
        logger.warning(f"[watchlist] item delete 失敗: {e}")
        return False


def _db_sync(user_id: str, groups: list[dict], items: dict[str, list]) -> bool:
    """全量同步：清掉舊資料再寫入"""
    try:
        sb = get_supabase()
        if sb is None:
            return False
        # 刪舊資料
        sb.table("watchlist_items").delete().eq("user_id", user_id).execute()
        sb.table("watchlist_groups").delete().eq("user_id", user_id).execute()
        # 寫入新資料
        if groups:
            sb.table("watchlist_groups").insert(
                [{"id": g["id"], "user_id": user_id,
                  "name": g["name"], "sort_order": g.get("sort_order", 0)}
                 for g in groups]
            ).execute()
        flat_items = []
        for gid, group_items in items.items():
            for it in group_items:
                flat_items.append({
                    "id":                it["id"],
                    "user_id":           user_id,
                    "group_id":          gid,
                    "symbol":            it["symbol"],
                    "note":              it.get("note", ""),
                    "tags":              it.get("tags", []),
                    "sort_order":        it.get("sort_order", 0),
                    "price_alert_above": it.get("price_alert_above"),
                    "price_alert_below": it.get("price_alert_below"),
                })
        if flat_items:
            sb.table("watchlist_items").insert(flat_items).execute()
        return True
    except Exception as e:
        logger.warning(f"[watchlist] sync 失敗: {e}")
        return False


# ── Memory fallback helpers ───────────────────────────────────────────────────

def _mem_get(user_id: str) -> dict:
    if user_id not in _store:
        _store[user_id] = _initial_state()
    return _store[user_id]


def _get_state(user_id: str) -> dict:
    """統一入口：優先 Supabase，fallback memory"""
    state = _db_load(user_id)
    if state is not None:
        # 無任何群組時給預設值
        if not state["groups"]:
            default = _initial_state()
            _db_upsert_group(user_id, default["groups"][0])
            for it in default["items"][_DEFAULT_GROUP_ID]:
                _db_upsert_item(user_id, _DEFAULT_GROUP_ID, it)
            return default
        return state
    return _mem_get(user_id)


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
    note:   str       = ""
    tags:   list[str] = []
    sort_order:        int   = 0
    price_alert_above: Optional[float] = None
    price_alert_below: Optional[float] = None

class ItemUpdate(BaseModel):
    note:              Optional[str]       = None
    tags:              Optional[list[str]] = None
    sort_order:        Optional[int]       = None
    price_alert_above: Optional[float]     = None
    price_alert_below: Optional[float]     = None

class SyncPayload(BaseModel):
    groups: list[dict]
    items:  dict[str, list[dict]]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/watchlist")
async def get_watchlist(x_user_id: Optional[str] = Header(default=None)):
    uid = _require_user(x_user_id)
    return _get_state(uid)


@router.post("/watchlist/sync")
async def sync_watchlist(
    payload: SyncPayload,
    x_user_id: Optional[str] = Header(default=None),
):
    uid = _require_user(x_user_id)
    ok = _db_sync(uid, payload.groups, payload.items)
    if not ok:
        _store[uid] = {"groups": payload.groups, "items": payload.items}
    return {"groups": payload.groups, "items": payload.items}


# ── Group CRUD ────────────────────────────────────────────────────────────────

@router.post("/watchlist/groups", status_code=201)
async def create_group(
    body: GroupCreate,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get_state(uid)
    gid   = f"g_{uuid.uuid4().hex[:8]}"
    group = {"id": gid, "name": body.name, "sort_order": body.sort_order}
    state["groups"].append(group)
    state["items"][gid] = []
    _db_upsert_group(uid, group)
    if get_supabase() is None:
        _store[uid] = state
    return group


@router.put("/watchlist/groups/{group_id}")
async def update_group(
    group_id: str,
    body: GroupUpdate,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get_state(uid)
    for g in state["groups"]:
        if g["id"] == group_id:
            if body.name       is not None: g["name"]       = body.name
            if body.sort_order is not None: g["sort_order"] = body.sort_order
            _db_upsert_group(uid, g)
            if get_supabase() is None:
                _store[uid] = state
            return g
    raise HTTPException(404, f"Group {group_id} not found")


@router.delete("/watchlist/groups/{group_id}", status_code=204)
async def delete_group(
    group_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get_state(uid)
    if len(state["groups"]) <= 1:
        raise HTTPException(400, "Cannot delete the last group")
    state["groups"] = [g for g in state["groups"] if g["id"] != group_id]
    state["items"].pop(group_id, None)
    _db_delete_group(uid, group_id)
    if get_supabase() is None:
        _store[uid] = state


# ── Item CRUD ─────────────────────────────────────────────────────────────────

@router.post("/watchlist/groups/{group_id}/items", status_code=201)
async def add_item(
    group_id: str,
    body: ItemCreate,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get_state(uid)
    if group_id not in state["items"]:
        raise HTTPException(404, f"Group {group_id} not found")
    sym = body.symbol.upper()
    for it in state["items"][group_id]:
        if it["symbol"] == sym:
            return it
    iid  = f"item_{uuid.uuid4().hex[:8]}"
    item = {
        "id": iid, "symbol": sym,
        "note": body.note, "tags": body.tags,
        "sort_order": body.sort_order,
        "price_alert_above": body.price_alert_above,
        "price_alert_below": body.price_alert_below,
    }
    state["items"][group_id].append(item)
    _db_upsert_item(uid, group_id, item)
    if get_supabase() is None:
        _store[uid] = state
    return item


@router.delete("/watchlist/items/{item_id}", status_code=204)
async def remove_item(
    item_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get_state(uid)
    for gid, items in state["items"].items():
        state["items"][gid] = [it for it in items if it["id"] != item_id]
    _db_delete_item(uid, item_id)
    if get_supabase() is None:
        _store[uid] = state


@router.put("/watchlist/items/{item_id}")
async def update_item(
    item_id: str,
    body: ItemUpdate,
    x_user_id: Optional[str] = Header(default=None),
):
    uid   = _require_user(x_user_id)
    state = _get_state(uid)
    for gid, items in state["items"].items():
        for it in items:
            if it["id"] == item_id:
                if body.note               is not None: it["note"]               = body.note
                if body.tags               is not None: it["tags"]               = body.tags
                if body.sort_order         is not None: it["sort_order"]         = body.sort_order
                if body.price_alert_above  is not None: it["price_alert_above"]  = body.price_alert_above
                if body.price_alert_below  is not None: it["price_alert_below"]  = body.price_alert_below
                _db_upsert_item(uid, gid, it)
                if get_supabase() is None:
                    _store[uid] = state
                return it
    raise HTTPException(404, f"Item {item_id} not found")
