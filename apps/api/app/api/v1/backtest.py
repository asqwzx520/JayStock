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
from app.services.backtest_service import run_backtest, run_optimize, run_compare, _PRESET_GRIDS

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
    {
        "id":    "dsl",
        "name":  "DSL 自由式",
        "desc":  "用文字語法自由描述進出場條件，支援函數（ma/rsi/cross_above…）與跨日形態欄位。",
        "icon":  "✍️",
        "params": [],
        "default": {
            "type":      "dsl",
            "entry_dsl": "cross_above(ma(5), ma(20))",
            "exit_dsl":  "cross_below(ma(5), ma(20))",
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
    # P9-29 滑價 / P10-32 移動停損 / P10-33 時間停損
    slippage_pct:      float           = Field(default=0.001, ge=0.0, le=0.005)
    trailing_stop_pct: Optional[float] = Field(default=None, ge=0.01, le=0.5)
    max_hold_days:     Optional[int]   = Field(default=None, ge=1, le=365)

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
            slippage_pct      = body.slippage_pct,
            trailing_stop_pct = body.trailing_stop_pct,
            max_hold_days     = body.max_hold_days,
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


# ─── P1-6: 策略比較 ──────────────────────────────────────────────────────────

class CompareSlot(BaseModel):
    name:            str   = Field(..., min_length=1, max_length=40)
    symbol:          str   = Field(..., min_length=1, max_length=10, pattern=r"^[0-9A-Za-z]+$")
    strategy:        BacktestStrategy
    start_date:      str   = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date:        str   = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    initial_capital: float = Field(default=1_000_000.0, gt=0)
    stop_loss_pct:   Optional[float] = None
    take_profit_pct: Optional[float] = None


class CompareRequest(BaseModel):
    slots: list[CompareSlot] = Field(..., min_length=2, max_length=4)


@router.post("/backtest/compare")
@limiter.limit("5/minute")
async def compare_strategies(
    request: Request,
    body: CompareRequest = Body(...),
):
    """
    多策略並排比較。

    - 2–4 個策略（可不同股票、不同日期範圍）
    - 回傳：並排績效指標 + 正規化資金曲線（base 100）+ 配對 t-test 顯著性
    """
    try:
        slots = [
            {
                "name":            s.name,
                "symbol":          s.symbol.upper(),
                "strategy":        s.strategy.model_dump(exclude_none=True),
                "start_date":      s.start_date,
                "end_date":        s.end_date,
                "initial_capital": s.initial_capital,
                "stop_loss_pct":   s.stop_loss_pct,
                "take_profit_pct": s.take_profit_pct,
            }
            for s in body.slots
        ]
        result = await run_compare(slots)
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.exception("[compare] failed slots=%d", len(body.slots))
        raise HTTPException(status_code=500, detail=f"策略比較失敗：{e}") from e


# ─── P2-8: DSL 策略語法驗證 ────────────────────────────────────────────────────

class DSLValidateRequest(BaseModel):
    dsl: str = Field(..., max_length=1000)


@router.post("/backtest/dsl/validate")
@limiter.limit("30/minute")
async def validate_dsl(
    request: Request,
    body: DSLValidateRequest = Body(...),
):
    """即時 DSL 語法驗證（不執行回測）。"""
    from app.services.dsl_parser import dsl_validate
    return dsl_validate(body.dsl)


# ─── P2-9: 全台股池掃描 ───────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    strategy:        BacktestStrategy
    start_date:      str   = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date:        str   = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    initial_capital: float = Field(default=1_000_000.0, gt=0)
    stop_loss_pct:   Optional[float] = None
    take_profit_pct: Optional[float] = None
    extra_symbols:   list[str] = Field(default_factory=list, max_length=50)


@router.post("/backtest/scan")
@limiter.limit("2/minute")
async def create_scan(
    request: Request,
    body: ScanRequest = Body(...),
):
    """
    啟動全台股池回測掃描（非同步 job）。

    回傳 {job_id}，前端以 GET /backtest/scan/{job_id} 輪詢進度。
    """
    from app.services.scan_service import create_scan_job, TW_SCAN_POOL
    job_id = create_scan_job(
        strategy        = body.strategy.model_dump(exclude_none=True),
        start_date      = body.start_date,
        end_date        = body.end_date,
        initial_capital = body.initial_capital,
        stop_loss       = body.stop_loss_pct,
        take_profit     = body.take_profit_pct,
        extra_symbols   = [s.upper() for s in (body.extra_symbols or [])],
    )
    return {"job_id": job_id, "pool_size": len(TW_SCAN_POOL)}


@router.get("/backtest/scan/{job_id}")
async def get_scan_result(job_id: str):
    """輪詢掃描進度與結果。"""
    from app.services.scan_service import get_job
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return {
        "job_id":   job.job_id,
        "status":   job.status,
        "progress": job.progress,
        "total":    job.total,
        "results":  job.results,
        "error":    job.error,
    }


# ─── P2-10: 組合回測 (Portfolio) ──────────────────────────────────────────────

class PortfolioSlot(BaseModel):
    symbol:          str   = Field(..., min_length=1, max_length=10, pattern=r"^[0-9A-Za-z.]+$")
    strategy:        BacktestStrategy
    start_date:      str   = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date:        str   = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    weight:          float = Field(default=1.0, gt=0, le=10)
    initial_capital: float = Field(default=1_000_000.0, gt=0)
    stop_loss_pct:   Optional[float] = None
    take_profit_pct: Optional[float] = None


class PortfolioRequest(BaseModel):
    slots: list[PortfolioSlot] = Field(..., min_length=1, max_length=8)


@router.post("/backtest/portfolio")
@limiter.limit("3/minute")
async def portfolio_backtest(
    request: Request,
    body: PortfolioRequest = Body(...),
):
    """
    組合回測：最多 8 個持倉槽，各自跑策略，按權重合併資金曲線。

    回傳：整體績效 + 各槽績效 + 疊加資金曲線 + 各股貢獻度。
    """
    from app.services.portfolio_service import run_portfolio_backtest
    try:
        slots = [
            {
                "symbol":          s.symbol.upper(),
                "strategy":        s.strategy.model_dump(exclude_none=True),
                "start_date":      s.start_date,
                "end_date":        s.end_date,
                "weight":          s.weight,
                "initial_capital": s.initial_capital,
                "stop_loss_pct":   s.stop_loss_pct,
                "take_profit_pct": s.take_profit_pct,
            }
            for s in body.slots
        ]
        result = await run_portfolio_backtest(slots)
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.exception("[portfolio] failed")
        raise HTTPException(status_code=500, detail=f"組合回測失敗：{e}") from e


# ─── P3-11: Walk-Forward Analysis ────────────────────────────────────────────

class WalkForwardRequest(BaseModel):
    symbol:          str   = Field(..., min_length=1, max_length=10, pattern=r"^[0-9A-Za-z.]+$")
    strategy_type:   str
    param_ranges:    dict[str, list[float]]   # {"fast": [3,5,8], "slow": [15,20,30]}
    sort_by:         str  = "sharpe"
    start_date:      str  = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date:        str  = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    n_windows:       int  = Field(default=5,    ge=3, le=10)
    is_pct:          float = Field(default=0.67, ge=0.5, le=0.8)
    initial_capital: float = Field(default=1_000_000.0, gt=0)
    stop_loss_pct:   Optional[float] = None
    take_profit_pct: Optional[float] = None


@router.post("/backtest/walk-forward")
@limiter.limit("2/minute")
async def walk_forward(
    request: Request,
    body: WalkForwardRequest = Body(...),
):
    """
    Walk-Forward Analysis：在 N 個非重疊窗口中分別最佳化（IS）→ 驗證（OOS）。

    輸出：每窗口最佳參數 + IS/OOS 對照 + 效率比 + OOS 拼接資金曲線
    """
    from app.services.walk_forward_service import run_walk_forward
    try:
        result = await run_walk_forward(
            symbol          = body.symbol.upper(),
            strategy_type   = body.strategy_type,
            param_ranges    = body.param_ranges,
            sort_by         = body.sort_by,
            start_date      = body.start_date,
            end_date        = body.end_date,
            n_windows       = body.n_windows,
            is_pct          = body.is_pct,
            initial_capital = body.initial_capital,
            stop_loss_pct   = body.stop_loss_pct,
            take_profit_pct = body.take_profit_pct,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.exception("[walk-forward] failed symbol=%s", body.symbol)
        raise HTTPException(status_code=500, detail=f"Walk-Forward 失敗：{e}") from e


# ─── P4-16: 即時訊號偵測 ─────────────────────────────────────────────────────

class LiveSignalRequest(BaseModel):
    symbol:   str   = Field(..., min_length=1, max_length=10, pattern=r"^[0-9A-Za-z.]+$")
    strategy: BacktestStrategy


@router.post("/backtest/live-signal")
@limiter.limit("10/minute")
async def live_signal(request: Request, body: LiveSignalRequest = Body(...)):
    """
    拉最近 120 根日K棒，計算策略指標，回傳當日是否有進出場訊號。
    """
    from app.services.backtest_service import (
        _yf_symbol, _is_tw_symbol, _fetch_ohlcv_sync, _to_df,
        _add_indicators, _gen_signals,
    )
    from app.services.backtest_service import _fetch_tw_ohlcv
    import asyncio
    from datetime import date, timedelta

    end_date   = date.today().isoformat()
    start_date = (date.today() - timedelta(days=365)).isoformat()

    is_tw  = _is_tw_symbol(body.symbol)
    yf_sym = _yf_symbol(body.symbol)

    try:
        loop = asyncio.get_running_loop()
        if is_tw:
            raw = await _fetch_tw_ohlcv(body.symbol, start_date, end_date)
        else:
            raw = await loop.run_in_executor(
                None, _fetch_ohlcv_sync, yf_sym, start_date, end_date
            )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"無法取得 {body.symbol} 行情：{exc}") from exc

    if not raw:
        raise HTTPException(status_code=404, detail=f"查無 {body.symbol} 近期行情")

    try:
        strategy = body.strategy.model_dump(exclude_none=True)
        df = _to_df(raw)
        df = _add_indicators(df, strategy)
        df = df.dropna()
        if len(df) < 5:
            raise ValueError("有效資料列數不足")

        sigs = _gen_signals(df, strategy)

        # Latest bar
        last_date = df.index[-1]
        last_sig  = int(sigs.iloc[-1]) if len(sigs) else 0
        prev_sig  = int(sigs.iloc[-2]) if len(sigs) > 1 else 0

        if last_sig == 1 and prev_sig != 1:
            signal = "buy"
        elif last_sig == -1 and prev_sig != -1:
            signal = "sell"
        elif last_sig == 1:
            signal = "holding"
        else:
            signal = "none"

        # Build human-readable reason
        stype = strategy.get("type", "")
        reasons = {
            "ma_cross":     f"MA{strategy.get('fast',5)} {'>' if signal in ('buy','holding') else '<'} MA{strategy.get('slow',20)}",
            "rsi_mean_rev": f"RSI={round(float(df['rsi'].iloc[-1]),1) if 'rsi' in df.columns else '?'}",
            "macd_signal":  "MACD 訊號",
            "kd_cross":     f"K={round(float(df['k'].iloc[-1]),1) if 'k' in df.columns else '?'} D={round(float(df['d'].iloc[-1]),1) if 'd' in df.columns else '?'}",
            "boll_bounce":  "布林通道",
        }
        reason = reasons.get(stype, stype)

        # Collect latest indicator values for display
        indicator_cols = ["ma_fast", "ma_slow", "rsi", "k", "d", "macd", "macd_signal_line", "upper", "lower", "mid"]
        indicators = {}
        for col in indicator_cols:
            if col in df.columns:
                val = df[col].iloc[-1]
                if not (val != val):  # not NaN
                    indicators[col] = round(float(val), 4)

        return {
            "signal":       signal,
            "reason":       reason,
            "latest_date":  last_date.strftime("%Y-%m-%d"),
            "latest_close": round(float(df["close"].iloc[-1]), 2),
            "indicators":   indicators,
        }
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"訊號計算失敗：{exc}") from exc


# ─── P6-21: 最佳停損 / 停利推薦 ─────────────────────────────────────────────


class StopRecommendRequest(BaseModel):
    trades: list[dict]   # BacktestTrade records (entry_price, exit_price, pnl_pct, etc.)


@router.post("/backtest/stop-recommendation")
@limiter.limit("20/minute")
async def stop_recommendation(request: Request, body: StopRecommendRequest = Body(...)):
    """
    從歷史交易的 pnl_pct 分佈估算最佳停損 / 停利組合。

    演算法：
    1. 對每種 stop_loss 候選值（1%~20%，步長 1%），過濾掉虧損超過 stop_loss 的交易，
       模擬提前停損後的盈虧，計算總盈虧。
    2. 對每種 take_profit 候選值（3%~40%，步長 1%），同理。
    3. 找到使「調整後總盈虧」最大的 stop_loss / take_profit 組合。
    4. 回傳推薦值、預估改善幅度、以及分佈統計。
    """
    import numpy as np

    trades = body.trades
    if len(trades) < 5:
        raise HTTPException(status_code=422, detail="至少需要 5 筆交易才能計算推薦值")

    try:
        pnls = [float(t.get("pnl_pct", 0)) for t in trades]
        n = len(pnls)
        baseline_total = sum(pnls)

        # ── Stop-loss sweep (negative boundary) ──
        sl_candidates = [i / 100 for i in range(1, 21)]   # 1%~20%
        best_sl, best_sl_total = None, baseline_total
        sl_results = []
        for sl in sl_candidates:
            adj = [max(p, -sl) for p in pnls]
            total = sum(adj)
            sl_results.append({"sl": sl, "total": round(total, 4)})
            if total > best_sl_total:
                best_sl_total = total
                best_sl = sl

        # ── Take-profit sweep (positive cap) ──
        tp_candidates = [i / 100 for i in range(3, 41)]   # 3%~40%
        best_tp, best_tp_total = None, baseline_total
        tp_results = []
        for tp in tp_candidates:
            adj = [min(p, tp) for p in pnls]
            total = sum(adj)
            tp_results.append({"tp": tp, "total": round(total, 4)})
            if total > best_tp_total:
                best_tp_total = total
                best_tp = tp

        # ── Distribution stats ──
        pnls_arr = np.array(pnls)
        neg = pnls_arr[pnls_arr < 0]
        pos = pnls_arr[pnls_arr > 0]

        return {
            "baseline_total_pnl": round(baseline_total, 4),
            "recommended_stop_loss":   best_sl,
            "recommended_take_profit": best_tp,
            "sl_improved_total":  round(best_sl_total, 4) if best_sl else None,
            "tp_improved_total":  round(best_tp_total, 4) if best_tp else None,
            "sl_improvement_pct": round((best_sl_total - baseline_total) / max(abs(baseline_total), 0.0001) * 100, 2) if best_sl else 0,
            "tp_improvement_pct": round((best_tp_total - baseline_total) / max(abs(baseline_total), 0.0001) * 100, 2) if best_tp else 0,
            "trade_count": n,
            "avg_loss":    round(float(neg.mean()), 4) if len(neg) else 0,
            "avg_gain":    round(float(pos.mean()), 4) if len(pos) else 0,
            "p5_loss":     round(float(np.percentile(pnls_arr, 5)), 4),
            "p95_gain":    round(float(np.percentile(pnls_arr, 95)), 4),
        }
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"推薦計算失敗：{exc}") from exc


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


# ─── P11-35: 一鍵體檢 AI 白話總結 ────────────────────────────────────────────

class HealthCheckItem(BaseModel):
    name:   str
    status: str          # pass / warn / fail / skip
    detail: str = ""


class AiSummaryRequest(BaseModel):
    symbol:        str = Field(..., min_length=1, max_length=10)
    strategy_type: str = Field(default="", max_length=40)
    stats:         dict
    checks:        list[HealthCheckItem] = []


def _rule_based_summary(body: "AiSummaryRequest") -> str:
    """Gemini 不可用時的規則式 fallback"""
    s = body.stats
    parts: list[str] = []
    sharpe = float(s.get("sharpe", 0) or 0)
    mdd    = abs(float(s.get("max_drawdown", 0) or 0))
    wr     = float(s.get("win_rate", 0) or 0)
    if sharpe >= 1.0:
        parts.append(f"策略風險調整後報酬良好（Sharpe {sharpe:.2f}）。")
    elif sharpe >= 0.5:
        parts.append(f"策略表現中等（Sharpe {sharpe:.2f}），仍有優化空間。")
    else:
        parts.append(f"策略風險調整後報酬偏弱（Sharpe {sharpe:.2f}），不建議直接實盤。")
    if mdd > 0.25:
        parts.append(f"最大回撤 {mdd*100:.1f}% 偏深，注意資金控管。")
    fails = [c.name for c in body.checks if c.status == "fail"]
    warns = [c.name for c in body.checks if c.status == "warn"]
    if fails:
        parts.append("未通過項目：" + "、".join(fails) + "，建議先解決再考慮實盤。")
    elif warns:
        parts.append("注意項目：" + "、".join(warns) + "。")
    else:
        parts.append(f"各項體檢均通過，勝率 {wr*100:.0f}%，可進一步用 Walk-Forward 驗證穩健性。")
    return " ".join(parts)


@router.post("/backtest/ai-summary")
@limiter.limit("10/minute")
async def backtest_ai_summary(
    request: Request,
    body: AiSummaryRequest = Body(...),
):
    """體檢報告 AI 白話總結（Gemini 1.5 Flash；失敗時規則式 fallback）"""
    from app.core.config import settings

    text = ""
    if settings.gemini_api_key:
        try:
            import asyncio

            import google.generativeai as genai  # type: ignore
            genai.configure(api_key=settings.gemini_api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            s = body.stats
            checks_txt = "\n".join(
                f"- {c.name}: {c.status} {c.detail}" for c in body.checks
            )
            prompt = (
                "你是專業量化交易顧問。以下是一個台股/美股回測策略的體檢結果，"
                "請用繁體中文寫 3~5 句白話總結：這策略勝在哪、最大風險是什麼、下一步建議調什麼。"
                "不要列點，用流暢段落；不要免責聲明。\n\n"
                f"股票：{body.symbol}　策略：{body.strategy_type}\n"
                f"總報酬 {float(s.get('total_return',0))*100:.1f}%，"
                f"CAGR {float(s.get('cagr',0))*100:.1f}%，"
                f"Sharpe {float(s.get('sharpe',0)):.2f}，"
                f"最大回撤 {float(s.get('max_drawdown',0))*100:.1f}%，"
                f"勝率 {float(s.get('win_rate',0))*100:.0f}%，"
                f"交易次數 {int(s.get('total_trades',0))}\n"
                f"體檢項目：\n{checks_txt}"
            )
            loop = asyncio.get_running_loop()
            resp = await loop.run_in_executor(None, lambda: model.generate_content(prompt))
            text = (resp.text or "").strip()
        except Exception as exc:
            logger.warning("[backtest] AI summary failed: %s", exc)

    if not text:
        text = _rule_based_summary(body)
        return {"summary": text, "source": "rule"}
    return {"summary": text, "source": "gemini"}
