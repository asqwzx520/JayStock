"""
P3-11: Walk-Forward Analysis

Algorithm (non-overlapping windows):
  For each window i (of n_windows total):
    IS  = first is_pct  of window → parameter optimisation
    OOS = remaining     of window → out-of-sample test with best IS params

Efficiency ratio = OOS Sharpe / IS Sharpe
  > 0.70  excellent
  0.50-0.70  acceptable
  < 0.50  possible overfitting
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=6, thread_name_prefix="wf")

# ── Window splitting ───────────────────────────────────────────────────────────

def _split_windows(
    df: pd.DataFrame,
    n_windows: int,
    is_pct: float,
) -> list[dict]:
    """
    Split df (DatetimeIndex) into n_windows non-overlapping blocks.
    Each block: {'is_df', 'oos_df', 'is_start', 'is_end', 'oos_start', 'oos_end'}
    """
    n           = len(df)
    w_size      = n // n_windows
    min_is_rows = max(20, int(w_size * is_pct * 0.5))
    min_oos_rows = 5

    windows = []
    for i in range(n_windows):
        s = i * w_size
        e = s + w_size if i < n_windows - 1 else n
        window_df  = df.iloc[s:e]
        is_end_idx = int(len(window_df) * is_pct)
        is_df      = window_df.iloc[:is_end_idx]
        oos_df     = window_df.iloc[is_end_idx:]

        if len(is_df) < min_is_rows or len(oos_df) < min_oos_rows:
            continue

        fmt = "%Y-%m-%d"
        windows.append({
            "is_df":     is_df,
            "oos_df":    oos_df,
            "is_start":  is_df.index[0].strftime(fmt),
            "is_end":    is_df.index[-1].strftime(fmt),
            "oos_start": oos_df.index[0].strftime(fmt),
            "oos_end":   oos_df.index[-1].strftime(fmt),
        })
    return windows


# ── One window (sync, runs in thread) ────────────────────────────────────────

def _run_window_sync(
    win: dict,
    bench_df: pd.DataFrame | None,
    strategy_type: str,
    combos: list[dict],
    sort_by: str,
    initial_capital: float,
    stop_loss_pct: float | None,
    take_profit_pct: float | None,
    window_idx: int,
) -> dict:
    from app.services.backtest_service import (
        _backtest_core_sync,
        _add_indicators, _gen_signals, _run_portfolio,
    )

    is_df  = win["is_df"]
    oos_df = win["oos_df"]

    # ── IS phase: find best combo ──────────────────────────────────────────
    _SORT_DIR = {
        "sharpe": True, "total_return": True, "calmar": True,
        "win_rate": True, "max_drawdown": False,
    }
    higher_is_better = _SORT_DIR.get(sort_by, True)
    best_score  = float("-inf") if higher_is_better else float("inf")
    best_combo  = None
    best_is_stats = None

    for combo in combos:
        strategy = {"type": strategy_type, **combo}
        stats = _backtest_core_sync(
            is_df, bench_df, strategy, "", initial_capital,
            stop_loss_pct, take_profit_pct,
        )
        if stats is None:
            continue
        v = float(stats.get(sort_by, -999) or -999)
        if (higher_is_better and v > best_score) or (not higher_is_better and v < best_score):
            best_score     = v
            best_combo     = combo
            best_is_stats  = stats

    if best_combo is None:
        return {
            "window":    window_idx + 1,
            "is_start":  win["is_start"],  "is_end":  win["is_end"],
            "oos_start": win["oos_start"], "oos_end": win["oos_end"],
            "best_params": None,
            "is_stats":  None,
            "oos_stats": None,
            "oos_equity": [],
            "efficiency": None,
        }

    # ── OOS phase: test best combo ────────────────────────────────────────
    best_strategy = {"type": strategy_type, **best_combo}
    oos_stats = _backtest_core_sync(
        oos_df, bench_df, best_strategy, "", initial_capital,
        stop_loss_pct, take_profit_pct,
    ) or {}

    # Build OOS equity curve for stitching
    try:
        df_copy = oos_df.copy()
        df_copy = _add_indicators(df_copy, best_strategy)
        df_copy = df_copy.dropna()
        sigs    = _gen_signals(df_copy, best_strategy)
        eq_df, _ = _run_portfolio(
            df_copy, sigs, initial_capital, "", stop_loss_pct, take_profit_pct,
        )
        # Normalise to base 100 for this window
        base = float(eq_df["equity"].iloc[0])
        oos_equity_norm = [
            {
                "time":  idx.strftime("%Y-%m-%d"),
                "value": round(float(row["equity"]) / base * 100, 2),
            }
            for idx, row in eq_df.iterrows()
        ]
    except Exception:
        oos_equity_norm = []

    # Efficiency ratio: OOS sort_metric / IS sort_metric
    is_v  = float(best_is_stats.get(sort_by, 0) or 0)
    oos_v = float(oos_stats.get(sort_by, 0)     or 0)
    if is_v != 0:
        eff = round(oos_v / is_v, 3)
    else:
        eff = None

    return {
        "window":      window_idx + 1,
        "is_start":    win["is_start"],  "is_end":    win["is_end"],
        "oos_start":   win["oos_start"], "oos_end":   win["oos_end"],
        "best_params": best_combo,
        "is_stats":    _slim(best_is_stats),
        "oos_stats":   _slim(oos_stats),
        "oos_equity":  oos_equity_norm,
        "efficiency":  eff,
    }


def _slim(stats: dict | None) -> dict | None:
    if not stats:
        return None
    keys = ["total_return", "cagr", "sharpe", "sortino", "max_drawdown",
            "win_rate", "profit_factor", "total_trades"]
    return {k: round(float(stats[k]), 4) if stats.get(k) is not None else None
            for k in keys}


# ── Public API ────────────────────────────────────────────────────────────────

async def run_walk_forward(
    symbol: str,
    strategy_type: str,
    param_ranges: dict[str, list],
    sort_by: str,
    start_date: str,
    end_date: str,
    n_windows: int = 5,
    is_pct: float = 0.67,
    initial_capital: float = 1_000_000.0,
    stop_loss_pct: float | None = None,
    take_profit_pct: float | None = None,
) -> dict:
    from app.services.backtest_service import (
        _fetch_ohlcv_sync, _to_df, _yf_symbol, _is_tw_symbol,
        _build_param_combos, MAX_OPTIMIZE_COMBOS,
    )

    # ── Build combos ──────────────────────────────────────────────────────
    combos = _build_param_combos(param_ranges)
    if not combos:
        raise ValueError("參數範圍不能為空")
    if len(combos) > MAX_OPTIMIZE_COMBOS:
        raise ValueError(
            f"參數組合數（{len(combos)}）超過上限 {MAX_OPTIMIZE_COMBOS}，"
            f"請縮小範圍再試"
        )

    # ── Fetch data ────────────────────────────────────────────────────────
    loop   = asyncio.get_event_loop()
    is_tw  = _is_tw_symbol(symbol)
    yf_sym = _yf_symbol(symbol)
    bench_sym = "0050.TW" if is_tw else "SPY"

    raw, raw_bench = await asyncio.gather(
        loop.run_in_executor(_executor, _fetch_ohlcv_sync, yf_sym,    start_date, end_date),
        loop.run_in_executor(_executor, _fetch_ohlcv_sync, bench_sym, start_date, end_date),
    )
    if not raw:
        raise ValueError(f"無法取得 {symbol} 歷史資料")

    df       = _to_df(raw)
    bench_df = _to_df(raw_bench) if raw_bench else None

    # ── Split windows ─────────────────────────────────────────────────────
    windows = _split_windows(df, n_windows, is_pct)
    if not windows:
        raise ValueError("資料不足以分割窗口，請擴大日期範圍")

    # ── Run each window in parallel ───────────────────────────────────────
    tasks = [
        loop.run_in_executor(
            _executor,
            _run_window_sync,
            win, bench_df, strategy_type, combos, sort_by,
            initial_capital, stop_loss_pct, take_profit_pct, i,
        )
        for i, win in enumerate(windows)
    ]
    win_results = list(await asyncio.gather(*tasks))

    # ── Aggregate ─────────────────────────────────────────────────────────
    valid   = [w for w in win_results if w["oos_stats"] is not None]
    n_valid = len(valid)

    def _avg(key: str, src: str) -> float | None:
        vals = [w[src].get(key) for w in valid if w[src] and w[src].get(key) is not None]
        return round(sum(vals) / len(vals), 4) if vals else None

    avg_is_sharpe   = _avg("sharpe", "is_stats")
    avg_oos_sharpe  = _avg("sharpe", "oos_stats")
    avg_is_return   = _avg("total_return", "is_stats")
    avg_oos_return  = _avg("total_return", "oos_stats")
    eff_values      = [w["efficiency"] for w in valid if w["efficiency"] is not None]
    avg_efficiency  = round(sum(eff_values) / len(eff_values), 3) if eff_values else None

    # Efficiency interpretation
    if avg_efficiency is None:
        interpretation = "資料不足"
    elif avg_efficiency >= 0.70:
        interpretation = "✅ 策略強健（OOS / IS ≥ 0.70）"
    elif avg_efficiency >= 0.50:
        interpretation = "⚠️ 可接受（建議擴大樣本再確認）"
    else:
        interpretation = "❌ 過擬合風險（OOS / IS < 0.50）"

    # Build stitched OOS equity curve
    # Re-normalize each window's oos_equity so they chain:
    # start of window_i at 100 × previous ending ratio
    stitched: list[dict] = []
    running_mult = 1.0
    for w in win_results:
        curve = w.get("oos_equity", [])
        if not curve:
            continue
        # curve is already base-100 normalised
        for pt in curve:
            stitched.append({
                "time":  pt["time"],
                "value": round(pt["value"] * running_mult, 2),
            })
        last_val = curve[-1]["value"] if curve else 100.0
        running_mult *= last_val / 100.0

    return {
        "windows":         win_results,
        "n_windows_valid": n_valid,
        "avg_is_sharpe":   avg_is_sharpe,
        "avg_oos_sharpe":  avg_oos_sharpe,
        "avg_is_return":   avg_is_return,
        "avg_oos_return":  avg_oos_return,
        "avg_efficiency":  avg_efficiency,
        "interpretation":  interpretation,
        "oos_equity_curve": stitched,
        "sort_by":         sort_by,
    }
