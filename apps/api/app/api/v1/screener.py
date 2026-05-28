"""
選股器 API

端點：
  GET  /api/v1/screener/templates  → 列出 5 個預設模板
  POST /api/v1/screener/run        → 執行選股（模板 ID 或自然語言）
  GET  /api/v1/screener/cache      → 快取狀態（除錯用）

模板：
  strong_breakout  強勢突破  — 均線突破 + 爆量 + RSI 強勢
  foreign_buying   外資連買  — 外資連續買超 ≥ 3 日
  margin_warning   融資控盤警示 — 外資賣超 + 股價下跌（主力撤退訊號）
  accumulation     低檔蓄積  — RSI 超賣 + 量縮 + 接近 20 日低點
  major_control    主力控盤  — 外資 + 投信同向買超 + 量比 ≥ 1.1
"""

import datetime
import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.screener_service import get_metrics, get_cache_info

logger = logging.getLogger(__name__)
router = APIRouter()

# ── 模板定義 ──────────────────────────────────────────────────────────────────
TEMPLATES = [
    {
        "id":   "strong_breakout",
        "name": "強勢突破",
        "icon": "🚀",
        "desc": "股價突破20日均線、量比>1.3、RSI>55，捕捉短線動能股",
        "tags": ["技術面", "動能", "突破"],
        "color": "#F59E0B",
    },
    {
        "id":   "foreign_buying",
        "name": "外資連買",
        "icon": "🏦",
        "desc": "外資連續買超3日以上，追蹤主力法人資金動向",
        "tags": ["籌碼", "外資", "法人"],
        "color": "#3B82F6",
    },
    {
        "id":   "margin_warning",
        "name": "融資控盤警示",
        "icon": "⚠️",
        "desc": "外資賣超且股價下跌，主力撤退訊號，注意風險",
        "tags": ["籌碼", "警示", "風險"],
        "color": "#EF4444",
    },
    {
        "id":   "accumulation",
        "name": "低檔蓄積",
        "icon": "📦",
        "desc": "RSI<38超賣、量能萎縮、股價接近20日低點，等待反彈",
        "tags": ["技術面", "超賣", "反彈"],
        "color": "#8B5CF6",
    },
    {
        "id":   "major_control",
        "name": "主力控盤",
        "icon": "🎯",
        "desc": "外資與投信同向買超、量比>1.1，籌碼集中訊號",
        "tags": ["籌碼", "主力", "三大法人"],
        "color": "#10B981",
    },
]

_TEMPLATE_MAP = {t["id"]: t for t in TEMPLATES}

# ── 模板條件定義 ──────────────────────────────────────────────────────────────
# 每個 key 對應一個過濾規則（見 _matches 函式）
_CONDITIONS: dict[str, dict] = {
    "strong_breakout": {
        "above_ma20":     True,
        "rsi_min":        55.0,
        "vol_ratio_min":  1.3,
        "change_pct_min": 0.0,
    },
    "foreign_buying": {
        "foreign_streak_dir": "buy",
        "foreign_streak_min": 3,
    },
    "margin_warning": {
        "foreign_streak_dir": "sell",
        "change_pct_max":     0.0,
    },
    "accumulation": {
        "rsi_max":        38.0,
        "vol_ratio_max":  0.95,
        "near_low20":     True,
        "change_pct_min": -8.0,   # 排除自由落體
    },
    "major_control": {
        "foreign_streak_dir": "buy",
        "foreign_streak_min": 1,
        "trust_streak_dir":   "buy",
        "trust_streak_min":   1,
        "vol_ratio_min":      1.1,
    },
}

# ── NLP 關鍵字 → 模板 ─────────────────────────────────────────────────────────
_NL_RULES: list[tuple[list[str], str]] = [
    (["強勢", "突破", "爆量", "多頭", "上攻", "漲停", "放量", "量增"],    "strong_breakout"),
    (["外資", "外國法人", "外資買", "外資連買", "外人", "連買"],           "foreign_buying"),
    (["融資", "融資增加", "融資警示", "主力出貨", "空頭", "賣壓", "賣超"], "margin_warning"),
    (["低檔", "超賣", "底部", "觸底", "蓄積", "反彈", "底部整理"],        "accumulation"),
    (["主力", "三大法人", "法人", "籌碼", "集中", "控盤", "投信"],        "major_control"),
]


def _parse_nl(query: str) -> Optional[str]:
    q = query.lower().strip()
    if not q:
        return None
    best_id, best_cnt = None, 0
    for keywords, tid in _NL_RULES:
        cnt = sum(1 for k in keywords if k in q)
        if cnt > best_cnt:
            best_cnt = cnt
            best_id  = tid
    return best_id if best_cnt > 0 else None


# ── 過濾邏輯 ──────────────────────────────────────────────────────────────────

def _matches(m: dict, cond: dict) -> bool:
    if cond.get("above_ma20")    and not m.get("above_ma20"):        return False
    if cond.get("near_low20")    and not m.get("near_low20"):        return False

    if "rsi_min"        in cond and m["rsi14"]     < cond["rsi_min"]:       return False
    if "rsi_max"        in cond and m["rsi14"]     > cond["rsi_max"]:       return False
    if "vol_ratio_min"  in cond and m["vol_ratio"] < cond["vol_ratio_min"]:  return False
    if "vol_ratio_max"  in cond and m["vol_ratio"] > cond["vol_ratio_max"]:  return False
    if "change_pct_min" in cond and m["change_pct"] < cond["change_pct_min"]: return False
    if "change_pct_max" in cond and m["change_pct"] > cond["change_pct_max"]: return False

    fs = m.get("foreign_streak", {})
    ts = m.get("trust_streak",   {})

    if "foreign_streak_dir" in cond and fs.get("direction") != cond["foreign_streak_dir"]: return False
    if "foreign_streak_min" in cond and fs.get("days", 0)   < cond["foreign_streak_min"]:  return False
    if "trust_streak_dir"   in cond and ts.get("direction") != cond["trust_streak_dir"]:   return False
    if "trust_streak_min"   in cond and ts.get("days", 0)   < cond["trust_streak_min"]:    return False

    return True


# ── 評分（綜合分數，0-100）────────────────────────────────────────────────────

def _score(m: dict, cond: dict, tid: str) -> float:
    pts = 0.0

    if tid == "strong_breakout":
        if m.get("above_ma20"):   pts += 25
        if m.get("ma20_breakout"): pts += 15  # 突破日加分
        # RSI 55–80 → 0–20 分
        rsi_score = max(0.0, min((m["rsi14"] - 55) / 25 * 20, 20))
        pts += rsi_score
        # vol_ratio 1.3–3.0 → 0–25 分
        vr_score  = max(0.0, min((m["vol_ratio"] - 1.3) / 1.7 * 25, 25))
        pts += vr_score
        # 漲幅 0–5% → 0–15 分
        ch_score  = max(0.0, min(m["change_pct"] / 5 * 15, 15))
        pts += ch_score

    elif tid == "foreign_buying":
        days = m["foreign_streak"]["days"]
        pts = min(days / 10 * 60, 60)         # 連買越久越高（最多60分）
        if m.get("trust_streak", {}).get("direction") == "buy":
            pts += 20                          # 投信共振加分
        if m.get("above_ma20"):
            pts += 20

    elif tid == "margin_warning":
        pts = 40
        # 外資賣超越多越危險
        fs_days = m.get("foreign_streak", {}).get("days", 0)
        pts += min(fs_days / 5 * 30, 30)
        # 跌幅
        pts += min(abs(m["change_pct"]) / 3 * 30, 30) if m["change_pct"] < 0 else 0

    elif tid == "accumulation":
        # RSI 越低分越高（超賣越深）
        pts = max(0.0, min((38 - m["rsi14"]) / 20 * 40, 40))
        # 量縮
        vr = m["vol_ratio"]
        pts += max(0.0, min((0.95 - vr) / 0.5 * 25, 25))
        # 接近低點
        if m.get("near_low20"): pts += 20
        # change_pct 輕微下跌(-3%~0) → 蓄積型
        if -3.0 <= m["change_pct"] <= 0:
            pts += 15

    elif tid == "major_control":
        f_days = m.get("foreign_streak", {}).get("days", 0)
        t_days = m.get("trust_streak",   {}).get("days", 0)
        pts  = min(f_days / 8 * 40, 40)
        pts += min(t_days / 5 * 30, 30)
        vr_score = max(0.0, min((m["vol_ratio"] - 1.1) / 0.9 * 20, 20))
        pts += vr_score
        if m.get("above_ma20"): pts += 10

    else:
        pts = 50.0   # 自訂條件時給基礎分

    return round(min(max(pts, 0), 100), 1)


# ── Pydantic 模型 ─────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    template_id: Optional[str] = None
    nl_query:    Optional[str] = None
    limit:       int            = 50


# ── 端點 ──────────────────────────────────────────────────────────────────────

@router.get("/screener/templates")
async def list_templates():
    return {"templates": TEMPLATES}


@router.get("/screener/cache")
async def cache_status():
    info = get_cache_info()
    updated = (
        datetime.datetime.fromtimestamp(info["updated_at"]).isoformat()
        if info["updated_at"] else None
    )
    return {**info, "updated_at_iso": updated}


@router.post("/screener/run")
async def run_screener(body: RunRequest):
    # 決定使用哪個模板
    tid = body.template_id
    if not tid and body.nl_query:
        tid = _parse_nl(body.nl_query)

    cond = _CONDITIONS.get(tid, {}) if tid else {}
    tpl  = _TEMPLATE_MAP.get(tid)   if tid else None

    # 取快取（首次呼叫時會觸發同步刷新，需等待 ~15-30 秒）
    all_metrics = await get_metrics()

    # 過濾 + 評分
    matched: list[dict] = []
    for sym, m in all_metrics.items():
        if not cond or _matches(m, cond):
            score = _score(m, cond, tid) if tid else 50.0
            matched.append({**m, "score": score})

    matched.sort(key=lambda x: x["score"], reverse=True)
    matched = matched[: body.limit]

    info = get_cache_info()
    cache_dt = (
        datetime.datetime.fromtimestamp(info["updated_at"]).strftime("%Y-%m-%d %H:%M")
        if info["updated_at"] else None
    )

    return {
        "template":   tpl,
        "conditions": cond,
        "total":      len(matched),
        "results":    matched,
        "cache_time": cache_dt,
        "nl_matched": tid if (body.nl_query and not body.template_id) else None,
    }
