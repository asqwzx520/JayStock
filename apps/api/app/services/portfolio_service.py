"""
P2-10: Portfolio backtest — run N symbols in parallel, combine by weight.

Each slot uses its own strategy, date range is shared (or per-slot).
Portfolio equity = weighted sum of individual normalized equity curves.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="portfolio")


# ── Per-slot backtest (sync) ───────────────────────────────────────────────────

def _run_slot_sync(
    symbol: str,
    strategy: dict,
    start_date: str,
    end_date: str,
    weight: float,
    initial_capital: float,
    stop_loss: float | None,
    take_profit: float | None,
) -> dict | None:
    """Fetch + backtest one slot. Returns {symbol, weight, stats, equity_df} or None."""
    try:
        from app.services.backtest_service import (
            _fetch_ohlcv_sync, _to_df, _add_indicators, _gen_signals,
            _run_portfolio as _sim_portfolio, _calc_stats,
            _add_fundamental_columns, _is_tw_symbol,
        )

        slot_capital = initial_capital * weight
        is_tw  = _is_tw_symbol(symbol)
        yf_sym = f"{symbol}.TW" if is_tw else symbol

        raw = _fetch_ohlcv_sync(yf_sym, start_date, end_date)
        if not raw or len(raw) < 30:
            return None

        bench_yf = "0050.TW" if is_tw else "SPY"
        bench_raw = _fetch_ohlcv_sync(bench_yf, start_date, end_date)

        df       = _to_df(raw)
        bench_df = _to_df(bench_raw) if bench_raw else None

        df = _add_indicators(df, strategy)
        df = df.dropna()
        if len(df) < 10:
            return None

        if strategy.get("type") in ("custom", "dsl"):
            if strategy.get("type") == "custom":
                df = _add_fundamental_columns(df, symbol)

        signals    = _gen_signals(df, strategy)
        equity_df, trades = _sim_portfolio(
            df, signals, slot_capital, symbol,
            stop_loss, take_profit,
        )
        stats = _calc_stats(equity_df, trades, bench_df, slot_capital)

        return {
            "symbol":     symbol,
            "weight":     weight,
            "stats":      stats,
            "equity_df":  equity_df,    # DataFrame with DatetimeIndex, "equity" col
            "trades":     trades,
            "slot_capital": slot_capital,
        }
    except Exception as exc:
        logger.debug("[portfolio] %s failed: %s", symbol, exc)
        return None


# ── Merge individual equity curves ────────────────────────────────────────────

def _merge_curves(slots: list[dict], initial_capital: float) -> tuple[pd.DataFrame, list[dict]]:
    """
    Merge weighted equity curves into a single portfolio equity curve.

    Reindexes all slot curves to the union of dates, fills forward,
    then sums to get portfolio equity.
    Returns (equity_df, benchmark_curve_list).
    """
    all_equity: dict[str, pd.Series] = {}
    for s in slots:
        eq = s["equity_df"]["equity"]
        all_equity[s["symbol"]] = eq

    if not all_equity:
        return pd.DataFrame(), []

    # Union of all trading dates
    combined = pd.concat(all_equity.values(), axis=1)
    combined.columns = list(all_equity.keys())
    combined = combined.sort_index().ffill()

    # Sum slot equities → portfolio equity
    portfolio_eq = combined.sum(axis=1)

    equity_df = pd.DataFrame({
        "equity":       portfolio_eq,
        "drawdown_pct": _calc_drawdown(portfolio_eq),
    })
    return equity_df, combined


def _calc_drawdown(equity: pd.Series) -> pd.Series:
    running_max = equity.cummax()
    return (equity - running_max) / running_max


# ── Public API ────────────────────────────────────────────────────────────────

async def run_portfolio_backtest(slots_config: list[dict]) -> dict:
    """
    Run portfolio backtest.

    slots_config: list of {
        symbol, strategy, start_date, end_date,
        weight,           # float 0–1, will be normalised to sum=1
        initial_capital,  # shared across all slots
        stop_loss_pct, take_profit_pct
    }

    Returns {
        stats: portfolio-level stats dict,
        equity_curve: [{time, value, drawdown}],
        slot_results: [{symbol, weight, stats, contribution_pct}],
        initial_capital: float,
    }
    """
    if not slots_config:
        raise ValueError("至少需要 1 個持倉槽")
    if len(slots_config) > 8:
        raise ValueError("最多支援 8 個持倉槽")

    # Normalise weights
    total_w = sum(s.get("weight", 1.0) for s in slots_config)
    if total_w <= 0:
        total_w = len(slots_config)
    initial_capital = float(slots_config[0].get("initial_capital", 1_000_000))

    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(
            _executor,
            _run_slot_sync,
            s["symbol"],
            s["strategy"],
            s["start_date"],
            s["end_date"],
            s.get("weight", 1.0) / total_w,
            initial_capital,
            s.get("stop_loss_pct"),
            s.get("take_profit_pct"),
        )
        for s in slots_config
    ]
    raw_results = await asyncio.gather(*tasks)
    slots = [r for r in raw_results if r is not None]

    if not slots:
        raise ValueError("所有持倉槽回測失敗，請確認股票代號與日期範圍")

    # Merge equity curves
    equity_df, per_sym_df = _merge_curves(slots, initial_capital)

    # Build equity curve list
    step = max(1, len(equity_df) // 1000)
    eq_sampled = equity_df.iloc[::step]
    equity_curve = [
        {
            "time":     idx.strftime("%Y-%m-%d"),
            "value":    round(float(row["equity"]), 2),
            "drawdown": round(float(row["drawdown_pct"]), 4),
        }
        for idx, row in eq_sampled.iterrows()
    ]

    # Portfolio-level stats (approximate from equity curve)
    final_eq  = float(equity_df["equity"].iloc[-1]) if len(equity_df) else initial_capital
    total_ret = (final_eq - initial_capital) / initial_capital

    # Per-slot contribution
    slot_results = []
    for s in slots:
        slot_final  = float(s["equity_df"]["equity"].iloc[-1])
        slot_init   = float(s["slot_capital"])
        slot_return = (slot_final - slot_init) / initial_capital   # % of total portfolio
        slot_results.append({
            "symbol":           s["symbol"],
            "weight":           round(s["weight"], 4),
            "stats":            s["stats"],
            "contribution_pct": round(slot_return * 100, 2),
        })

    # Simple portfolio stats
    from app.services.backtest_service import _calc_stats as _cs
    # We can't call _calc_stats directly without trades list, so build approximate stats
    years = max(1e-6, (equity_df.index[-1] - equity_df.index[0]).days / 365.25) if len(equity_df) > 1 else 1
    cagr  = (final_eq / initial_capital) ** (1 / years) - 1 if years > 0 else 0.0
    dd_series = equity_df["drawdown_pct"]
    max_dd = float(dd_series.min()) if len(dd_series) else 0.0

    portfolio_stats = {
        "total_return":  round(total_ret, 4),
        "cagr":          round(cagr, 4),
        "max_drawdown":  round(max_dd, 4),
        "final_equity":  round(final_eq, 2),
        "slot_count":    len(slots),
    }

    return {
        "stats":            portfolio_stats,
        "equity_curve":     equity_curve,
        "slot_results":     slot_results,
        "initial_capital":  initial_capital,
        "per_symbol_curve": {
            sym: [
                {"time": idx.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
                for idx, v in per_sym_df[sym].dropna().iloc[::step].items()
            ]
            for sym in per_sym_df.columns
        },
    }
