"""
用戶自訂警示規則 CRUD API

認證：X-User-ID header（同 watchlist 模式）
儲存：Supabase（設定時）；否則 in-memory fallback

Supabase 建表 SQL（請在 Supabase Dashboard SQL Editor 執行）：
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_alert_rules (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]',
  logic      TEXT NOT NULL DEFAULT 'AND',
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_alert_rules_user_id ON user_alert_rules(user_id);
---------------------------------------------------------------------------

支援的條件欄位（field）：
  rsi14              RSI 14 日值（float）
  vol_ratio          成交量比（float）
  change_pct         漲跌幅 %（float）
  ma20_breakout      突破 MA20（1=是 0=否）
  above_ma20         站上 MA20（1=是 0=否）
  foreign_streak_days 外資連買天數（int）
  trust_streak_days   投信連買天數（int）

支援的運算子（operator）：>, <, >=, <=, =
邏輯（logic）：AND | OR
"""
from __future__ import annotations

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.supabase_client import get_supabase
from app.core.validators import require_user
from app.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter()

# ─── In-memory fallback ───────────────────────────────────────────────────────
_store: dict[str, list[dict]] = {}   # user_id → list of rules


# ─── Supabase helpers ─────────────────────────────────────────────────────────

def _db_load(user_id: str) -> list[dict] | None:
    try:
        sb = get_supabase()
        if sb is None:
            return None
        resp = (
            sb.table("user_alert_rules")
            .select("id,name,conditions,logic,is_active,created_at")
            .eq("user_id", user_id)
            .order("created_at")
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.warning("[alert_rules] load fail: %s", e)
        return None


def _db_upsert(user_id: str, rule: dict) -> bool:
    try:
        sb = get_supabase()
        if sb is None:
            return False
        sb.table("user_alert_rules").upsert({
            "id":         rule["id"],
            "user_id":    user_id,
            "name":       rule["name"],
            "conditions": rule["conditions"],
            "logic":      rule.get("logic", "AND"),
            "is_active":  rule.get("is_active", True),
        }).execute()
        return True
    except Exception as e:
        logger.warning("[alert_rules] upsert fail: %s", e)
        return False


def _db_delete(user_id: str, rule_id: str) -> bool:
    try:
        sb = get_supabase()
        if sb is None:
            return False
        sb.table("user_alert_rules").delete().eq("user_id", user_id).eq("id", rule_id).execute()
        return True
    except Exception as e:
        logger.warning("[alert_rules] delete fail: %s", e)
        return False


# ─── 統一入口 ─────────────────────────────────────────────────────────────────

def _get_user_rules(user_id: str) -> list[dict]:
    """公開函式，dashboard.py 使用"""
    rules = _db_load(user_id)
    if rules is not None:
        return rules
    return _store.get(user_id, [])


def _mem_get(user_id: str) -> list[dict]:
    if user_id not in _store:
        _store[user_id] = []
    return _store[user_id]


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

ALLOWED_FIELDS = {
    "rsi14", "vol_ratio", "change_pct",
    "ma20_breakout", "above_ma20",
    "foreign_streak_days", "trust_streak_days",
}
ALLOWED_OPS = {">", "<", ">=", "<=", "=", "=="}


class Condition(BaseModel):
    field:    str
    operator: str
    value:    float

    def validate_fields(self) -> None:
        if self.field not in ALLOWED_FIELDS:
            raise ValueError(f"Unsupported field: {self.field}. Allowed: {ALLOWED_FIELDS}")
        if self.operator not in ALLOWED_OPS:
            raise ValueError(f"Unsupported operator: {self.operator}")


class RuleCreate(BaseModel):
    name:       str              = Field(..., min_length=1, max_length=50)
    conditions: list[Condition]  = Field(..., min_length=1, max_length=3)
    logic:      str              = "AND"
    is_active:  bool             = True

    def model_post_init(self, __context):
        self.logic = self.logic.upper()
        if self.logic not in ("AND", "OR"):
            raise ValueError("logic must be AND or OR")
        for c in self.conditions:
            c.validate_fields()


class RuleUpdate(BaseModel):
    name:       Optional[str]             = None
    conditions: Optional[list[Condition]] = None
    logic:      Optional[str]             = None
    is_active:  Optional[bool]            = None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/alert-rules")
@limiter.limit("60/minute")
async def list_rules(
    request:   Request,
    x_user_id: Optional[str] = Header(default=None),
):
    """列出用戶所有自訂警示規則"""
    uid = require_user(x_user_id)
    rules = _get_user_rules(uid)
    return {"rules": rules, "count": len(rules)}


@router.post("/alert-rules", status_code=201)
@limiter.limit("30/minute")
async def create_rule(
    request:   Request,
    body:      RuleCreate,
    x_user_id: Optional[str] = Header(default=None),
):
    """新增自訂警示規則"""
    uid = require_user(x_user_id)

    rules = _get_user_rules(uid)
    if len(rules) >= 20:
        raise HTTPException(400, "Maximum 20 rules per user")

    rule = {
        "id":         f"rule_{uuid.uuid4().hex[:8]}",
        "name":       body.name,
        "conditions": [c.model_dump() for c in body.conditions],
        "logic":      body.logic,
        "is_active":  body.is_active,
    }

    ok = _db_upsert(uid, rule)
    if not ok:
        rules_mem = _mem_get(uid)
        rules_mem.append(rule)

    return rule


@router.put("/alert-rules/{rule_id}")
@limiter.limit("30/minute")
async def update_rule(
    request:   Request,
    rule_id:   str,
    body:      RuleUpdate,
    x_user_id: Optional[str] = Header(default=None),
):
    """更新自訂警示規則"""
    uid = require_user(x_user_id)
    rules = _get_user_rules(uid)

    target = next((r for r in rules if r["id"] == rule_id), None)
    if not target:
        raise HTTPException(404, f"Rule {rule_id} not found")

    if body.name is not None:
        target["name"] = body.name
    if body.conditions is not None:
        for c in body.conditions:
            c.validate_fields()
        target["conditions"] = [c.model_dump() for c in body.conditions]
    if body.logic is not None:
        logic = body.logic.upper()
        if logic not in ("AND", "OR"):
            raise HTTPException(400, "logic must be AND or OR")
        target["logic"] = logic
    if body.is_active is not None:
        target["is_active"] = body.is_active

    ok = _db_upsert(uid, target)
    if not ok:
        # memory 已經 in-place 修改了
        pass

    return target


@router.delete("/alert-rules/{rule_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_rule(
    request:   Request,
    rule_id:   str,
    x_user_id: Optional[str] = Header(default=None),
):
    """刪除自訂警示規則"""
    uid = require_user(x_user_id)
    ok = _db_delete(uid, rule_id)
    if not ok:
        # fallback: in-memory delete
        rules = _mem_get(uid)
        _store[uid] = [r for r in rules if r["id"] != rule_id]


@router.patch("/alert-rules/{rule_id}/toggle", status_code=200)
@limiter.limit("30/minute")
async def toggle_rule(
    request:   Request,
    rule_id:   str,
    x_user_id: Optional[str] = Header(default=None),
):
    """切換規則啟用/停用狀態"""
    uid = require_user(x_user_id)
    rules = _get_user_rules(uid)
    target = next((r for r in rules if r["id"] == rule_id), None)
    if not target:
        raise HTTPException(404, f"Rule {rule_id} not found")

    target["is_active"] = not target.get("is_active", True)
    _db_upsert(uid, target)
    return target
