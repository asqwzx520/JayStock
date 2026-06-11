"""
回測 API

GET  /api/v1/backtest/presets  → 6 種預設策略模板
POST /api/v1/backtest/run      → 執行回測（最長等待 60 秒）
"""
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Header, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from app.core.rate_limit import limiter
from app.core.supabase_client import get_supabase
from app.core.validators import require_user
from app.services.backtest_service import run_backtest, run_optimize, _PRESET_GRIDS

logger = logging.getLogger(__name__)
router = APIRouter()


# ── 預設策略模板 ──────────────────────────────────────────────────────────────

PRESETS = [
    {
        "id":    "ma_cross",
        "name":  "均線黃金交叉",
        "desc":  "快線上穿慢線進場，下穿出場。台股常用 MA5/MA20。",
        "icon":  "📈",
        "params": [
            {"key": "fast",  "label": "快線天數", "type": "int", "default": 5,  "min": 2,  "max": 60},
            {"key": "slow",  "label": "慢線天數", "type": "int", "default": 20, "min": 5,  "max": 240},
        ],
        "default": {"type": "ma_cross", "fast": 5, "slow": 20},
    },
    {
        "id":    "rsi_mean_rev",
        "name":  "RSI 超賣反彈",
        "desc":  "RSI 跌破超賣線買入，升破超買線賣出。均值回歸策略。",
        "icon":  "🔄",
        "params": [
            {"key": "period",     "label": "RSI 週期",  "type": "int",   "default": 14, "min": 5,  "max": 30},
            {"key": "oversold",   "label": "超賣線",    "type": "int",   "default": 30, "min": 10, "max": 45},
            {"key": "overbought", "label": "超買線",    "type": "int",   "default": 70, "min": 55, "max": 90},
        ],
        "default": {"type": "rsi_mean_rev", "period": 14, "oversold": 30, "overbought": 70},
    },
    {
        "id":    "macd_signal",
        "name":  "MACD 訊號線",
        "desc":  "MACD 上穿訊號線進場（黃金叉），下穿出場（死亡叉）。",
        "icon":  "📊",
        "params": [
            {"key": "fast",   "label": "快線",  "type": "int", "default": 12, "min": 3,  "max": 30},
            {"key": "slow",   "label": "慢線",  "type": "int", "default": 26, "min": 10, "max": 60},
            {"key": "signal", "label": "訊號線", "type": "int", "default":  9, "min": 3,  "max": 20},
        ],
        "default": {"type": "macd_signal", "fast": 12, "slow": 26, "signal": 9},
    },
    {
        "id":    "kd_cross",
        "name":  "KD 黃金交叉",
        "desc":  "K 線從低位（<25）上穿 D 線進場；高位（>75）死亡叉出場。台股投資人最熟悉的指標之一。",
        "icon":  "⚡",
        "params": [
            {"key": "k_period",  "label": "K 週期",  "type": "int", "default":  9, "min": 3,  "max": 20},
            {"key": "d_period",  "label": "D 週期",  "type": "int", "default":  3, "min": 2,  "max": 10},
            {"key": "buy_zone",  "label": "進場區（K<）", "type": "int", "default": 25, "min": 10, "max": 40},
            {"key": "sell_zone", "label": "出場區（K>）", "type": "int", "default": 75, "min": 60, "max": 90},
        ],
        "default": {"type": "kd_cross", "k_period": 9, "d_period": 3, "buy_zone": 25, "sell_zone": 75},
    },
    {
        "id":    "boll_bounce",
        "name":  "布林通道均值回歸",
        "desc":  "收盤觸及下軌進場，觸及上軌出場。適合震盪市場。",
        "icon":  "🎯",
        "params": [
            {"key": "period", "label": "週期",   "type": "int",   "default": 20,  "min": 10, "max": 60},
            {"key": "std",    "label": "標準差倍數", "type": "float", "default": 2.0, "min": 1.0, "max": 3.0},
        ],
        "default": {"type": "boll_bounce", "period": 20, "std": 2.0},
    },
    {
        "id":    "custom",
        "name":  "自訂條件",
        "desc":  "組合多個技術指標條件（AND/OR），打造專屬策略。",
        "icon":  "🔧",
        "params": [],
        "default": {
            "type": "custom",
            "logic": "AND",
            "entry_conditions": [{"field": "close", "op": "cross_above", "value": "ma20"}],
            "exit_conditions":  [{"field": "rsi14", "op": ">", "value": 70}],
        },
    },
]


# ── Request / Response models ─────────────────────────────────────────────────

class BacktestStrategy(BaseModel):
    type: str
    fast:        Optional[int]   = None
    slow:        Optional[int]   = None
    signal:      Optional[int]   = None
    period:      Optional[int]   = None
    oversold:    Optional[int]   = None
    overbought:  Optional[int]   = None
    k_period:    Optional[int]   = None
    d_period:    Optional[int]   = None
    buy_zone:    Optional[int]   = None
    sell_zone:   Optional[int]   = None
    std:         Optional[float] = None
    logic:       Optional[str]   = "AND"  # backwards compat: shared logic
    entry_logic: Optional[str]   = None   # P0-3: independent entry AND/OR
    exit_logic:  Optional[str]   = None   # P0-3: independent exit AND/OR
    entry_conditions: Optional[list[dict]] = None
    exit_conditions:  Optional[list[dict]] = None


class BacktestRequest(BaseModel):
    symbol:          str   = Field(..., min_length=1, max_length=10, pattern=r"^[0-9A-Za-z]+$")
    strategy:        BacktestStrategy
    start_date:      str   = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date:        str   = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    initial_capital: float = Field(default=1_000_000.0, gt=0, le=1_000_000_000)
    stop_loss_pct:   Optional[float] = Field(default=None, ge=0.01, le=0.5)
    take_profit_pct: Optional[float] = Field(default=None, ge=0.01, le=5.0)

    @model_validator(mode="after")
    def _check_dates(self):
        try:
            start = date.fromisoformat(self.start_date)
            end   = date.fromisoformat(self.end_date)
        except ValueError as e:
            raise ValueError(f"日期格式錯誤: {e}") from e
        if start >= end:
            raise ValueError("start_date 必須早於 end_date")
        if (end - start).days < 60:
            raise ValueError("回測期間至少需要 60 天")
        if (end - start).days > 365 * 20:
            raise ValueError("回測期間最長 20 年")
        today = date.today()
        if end > today:
            self.end_date = today.strftime("%Y-%m-%d")
        return self


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/backtest/presets")
async def get_presets():
    """取得 6 種預設策略模板（含參數說明與預設值）"""
    return {"presets": PRESETS}


@router.post("/backtest/run")
@limiter.limit("5/minute")   # 回測 CPU 較重，限流保護
async def run_backtest_endpoint(
    request: Request,
    body: BacktestRequest = Body(...),
):
    """
    執行回測。

    回傳：
    - stats: 11 項績效指標
    - equity_curve: 資金曲線（最多 1000 點）
    - benchmark_curve: 大盤基準曲線（0050/SPY）
    - trades: 每筆交易記錄
    - monthly_returns: 月度報酬（用於熱力圖）
    """
    strategy_dict = body.strategy.model_dump(exclude_none=True)
    try:
        result = await run_backtest(
            symbol          = body.symbol.upper(),
            strategy        = strategy_dict,
            start_date      = body.start_date,
            end_date        = body.end_date,
            initial_capital = body.initial_capital,
            stop_loss_pct   = body.stop_loss_pct,
            take_profit_pct = body.take_profit_pct,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.exception("[backtest] 執行失敗 symbol=%s strategy=%s", body.symbol, body.strategy.type)
        raise HTTPException(status_code=500, detail=f"回測執行失敗：{e}") from e


# ─── P1-5: 參數最佳化 ────────────────────────────────────────────────────────

_VALID_STRATEGY_TYPES = {"ma_cross", "rsi_mean_rev", "macd_signal", "kd_cross", "boll_bounce"}
_VALID_SORT_BY        = {"sharpe", "total_return", "win_rate", "max_drawdown"}


class OptimizeRequest(BaseModel):
    symbol:          str  = Field(..., min_length=1, max_length=10, pattern=r"^[0-9A-Za-z]+$")
    strategy_type:   str
    param_ranges:    Optional[dict[str, list]] = None
    use_preset:      bool = False
    start_date:      str  = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date:        str  = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    initial_capital: float = Field(default=1_000_000.0, gt=0)
    stop_loss_pct:   Optional[float] = None
    take_profit_pct: Optional[float] = None
    sort_by:         str  = Field(default="sharpe")
    top_n:           int  = Field(default=30, ge=5, le=100)

    @model_validator(mode="after")
    def _validate(self):
        if self.strategy_type not in _VALID_STRATEGY_TYPES:
            raise ValueError(f"strategy_type 必須是 {_VALID_STRATEGY_TYPES} 之一")
        if self.sort_by not in _VALID_SORT_BY:
            raise ValueError(f"sort_by 必須是 {_VALID_SORT_BY} 之一")
        if not self.use_preset and not self.param_ranges:
            raise ValueError("請提供 param_ranges 或設定 use_preset=true")
        return self


@router.get("/backtest/optimize/presets")
async def get_optimize_presets():
    """回傳各策略的預設最佳化掃描範圍"""
    return {"presets": _PRESET_GRIDS}


@router.post("/backtest/optimize")
@limiter.limit("3/minute")
async def optimize_strategy(
    request: Request,
    body: OptimizeRequest = Body(...),
):
    """
    執行參數最佳化（Grid Search）。

    - use_preset=true：使用內建掃描範圍，自動計算所有組合
    - param_ranges：自訂各參數候選值（A 模式）
    - 最多 300 組合；回傳 Top N 排行 + 2 參數時附熱力圖矩陣
    """
    try:
        result = await run_optimize(
            symbol          = body.symbol.upper(),
            strategy_type   = body.strategy_type,
            param_ranges    = body.param_ranges or {},
            start_date      = body.start_date,
            end_date        = body.end_date,
            initial_capital = body.initial_capital,
            stop_loss_pct   = body.stop_loss_pct,
            take_profit_pct = body.take_profit_pct,
            sort_by         = body.sort_by,
            top_n           = body.top_n,
            use_preset      = body.use_preset,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.exception("[optimize] failed symbol=%s strategy=%s", body.symbol, body.strategy_type)
        raise HTTPException(status_code=500, detail=f"最佳化失敗：{e}") from e


# ─── P0-4: 儲存策略 / 我的策略列表 ────────────────────────────────────────────
#
# Supabase 表：backtest_strategies
#   id            UUID PK
#   user_id       TEXT
#   name          TEXT
#   note          TEXT
#   strategy_json JSONB  (BacktestStrategy 序列化)
#   symbol        TEXT
#   start_date    TEXT
#   end_date      TEXT
#   initial_capital      DOUBLE PRECISION
#   stop_loss_pct        DOUBLE PRECISION (nullable)
#   take_profit_pct      DOUBLE PRECISION (nullable)
#   created_at    TIMESTAMPTZ DEFAULT NOW()
#
# 無 Supabase 時 fallback 至 in-memory（per-process，重啟即失，但 UI 仍可用）
# ─────────────────────────────────────────────────────────────────────────────

_mem_strategies: dict[str, list[dict]] = {}   # user_id → list of strategies (newest first)
_MAX_PER_USER = 50


class SavedStrategyCreate(BaseModel):
    name:           str = Field(..., min_length=1, max_length=60)
    note:           Optional[str] = Field(default="", max_length=500)
    strategy:       BacktestStrategy
    symbol:         str = Field(..., min_length=1, max_length=10, pattern=r"^[0-9A-Za-z]+$")
    start_date:     str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date:       str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    initial_capital: float = Field(default=1_000_000.0, gt=0)
    stop_loss_pct:   Optional[float] = None
    take_profit_pct: Optional[float] = None


def _strategy_to_dict(row_id: str, user_id: str, body: SavedStrategyCreate) -> dict:
    return {
        "id":              row_id,
        "user_id":         user_id,
        "name":            body.name.strip(),
        "note":            (body.note or "").strip(),
        "strategy_json":   body.strategy.model_dump(exclude_none=True),
        "symbol":          body.symbol.upper(),
        "start_date":      body.start_date,
        "end_date":        body.end_date,
        "initial_capital": body.initial_capital,
        "stop_loss_pct":   body.stop_loss_pct,
        "take_profit_pct": body.take_profit_pct,
        "created_at":      datetime.now(timezone.utc).isoformat(),
    }


@router.get("/backtest/strategies")
async def list_strategies(
    request: Request,
    x_user_id: Optional[str] = Header(default=None),
):
    """列出當前使用者已儲存的策略（最新在前）"""
    user_id = require_user(x_user_id)
    try:
        sb = get_supabase()
        if sb is not None:
            resp = (
                sb.table("backtest_strategies")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(_MAX_PER_USER)
                .execute()
            )
            return {"strategies": resp.data or []}
    except Exception as e:
        logger.warning("[backtest] Supabase list_strategies failed, fallback memory: %s", e)
    return {"strategies": _mem_strategies.get(user_id, [])}


@router.post("/backtest/strategies")
@limiter.limit("30/minute")
async def save_strategy(
    request: Request,
    body: SavedStrategyCreate = Body(...),
    x_user_id: Optional[str] = Header(default=None),
):
    """儲存一筆策略（包含完整回測設定，可一鍵重跑）"""
    user_id = require_user(x_user_id)
    row_id  = str(uuid.uuid4())
    row     = _strategy_to_dict(row_id, user_id, body)

    try:
        sb = get_supabase()
        if sb is not None:
            sb.table("backtest_strategies").insert(row).execute()
            return row
    except Exception as e:
        logger.warning("[backtest] Supabase save_strategy failed, fallback memory: %s", e)

    arr = _mem_strategies.setdefault(user_id, [])
    arr.insert(0, row)
    if len(arr) > _MAX_PER_USER:
        del arr[_MAX_PER_USER:]
    return row


@router.delete("/backtest/strategies/{strategy_id}")
async def delete_strategy(
    request: Request,
    strategy_id: str,
    x_user_id: Optional[str] = Header(default=None),
):
    """刪除一筆已儲存的策略"""
    user_id = require_user(x_user_id)
    try:
        sb = get_supabase()
        if sb is not None:
            sb.table("backtest_strategies").delete().eq("id", strategy_id).eq("user_id", user_id).execute()
            return {"ok": True}
    except Exception as e:
        logger.warning("[backtest] Supabase delete_strategy failed, fallback memory: %s", e)

    arr = _mem_strategies.get(user_id, [])
    _mem_strategies[user_id] = [s for s in arr if s.get("id") != strategy_id]
    return {"ok": True}
