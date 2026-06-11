"""
P2-9: Full TW stock pool scan — async job system.

Flow:
  POST /backtest/scan  → creates job, launches asyncio background task → {job_id}
  GET  /backtest/scan/{job_id}  → {status, progress, total, results, error}

Implementation:
  - In-memory job store (dict), 1h TTL lazy cleanup
  - ThreadPoolExecutor for CPU-bound _backtest_core_sync calls
  - Max 8 concurrent workers (Render free-tier friendly)
  - Composite score: Sharpe×0.4 + WinRate×0.3 + (1-MaxDD)×0.3
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ── Scan pool: top-tier TW stocks by approximate market cap ───────────────────
# Covers ~95% of TWSE/TPEx trading volume
TW_SCAN_POOL: list[str] = [
    # 半導體 / IC 設計 / 晶圓代工
    "2330", "2303", "2454", "2379", "3711", "2337", "3034",
    "2344", "3231", "2382", "4938", "6415", "5347", "3661",
    "2449", "2385", "6770", "2338", "3036", "2408",
    # 電子製造 / 系統整合
    "2317", "2354", "2353", "2357", "2376", "2327",
    "2360", "3008", "2356", "2352", "2308", "2386",
    # 光電 / 顯示
    "2458", "3035", "6668", "3443", "2474",
    # 網通 / 伺服器
    "3045", "4904", "3060", "2457", "6214",
    # 電信
    "2412", "4904", "3045",
    # 金融 — 銀行 / 壽險 / 證券
    "2891", "2882", "2886", "2884", "2892",
    "2881", "2883", "2885", "2887", "2888",
    "2889", "2880", "5880", "2890", "2823",
    # 傳統產業 — 石化 / 鋼鐵 / 食品
    "1301", "1303", "1326", "2002", "1216",
    "1229", "1102", "1101", "2207", "1301",
    # 汽車 / 零件
    "2201", "1590",
    # 零售 / 消費
    "2912", "5903", "9904",
    # 生技 / 醫療
    "4711", "6446", "6490", "4725", "4952",
    # ETF（有成交量才適合回測）
    "0050", "0056", "00878", "00713", "00919", "006208",
]
# 去重並保持順序
_seen: set[str] = set()
TW_SCAN_POOL = [x for x in TW_SCAN_POOL if not (x in _seen or _seen.add(x))]  # type: ignore[func-returns-value]


# ── Job state ──────────────────────────────────────────────────────────────────

@dataclass
class ScanJob:
    job_id:     str
    status:     str = "pending"    # pending | running | done | failed
    progress:   int = 0
    total:      int = 0
    results:    list[dict] = field(default_factory=list)
    error:      str | None = None
    created_at: float = field(default_factory=time.time)


# ── In-memory store ────────────────────────────────────────────────────────────

_jobs: dict[str, ScanJob] = {}
_JOB_TTL = 3600.0   # 1 hour

_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="scan")


def _cleanup_old_jobs() -> None:
    cutoff = time.time() - _JOB_TTL
    stale = [jid for jid, j in _jobs.items() if j.created_at < cutoff]
    for jid in stale:
        _jobs.pop(jid, None)


def get_job(job_id: str) -> ScanJob | None:
    _cleanup_old_jobs()
    return _jobs.get(job_id)


# ── Composite score ────────────────────────────────────────────────────────────

def _score(stats: dict) -> float:
    sharpe   = float(stats.get("sharpe",       0) or 0)
    win_rate = float(stats.get("win_rate",      0) or 0) / 100.0
    max_dd   = abs(float(stats.get("max_drawdown", 0) or 0))
    return sharpe * 0.4 + win_rate * 0.3 + max(0.0, 1.0 - max_dd) * 0.3


# ── Per-symbol backtest (sync, runs in thread) ─────────────────────────────────

def _run_one(symbol: str, strategy: dict, start_date: str, end_date: str,
             initial_capital: float, stop_loss: float | None,
             take_profit: float | None) -> dict | None:
    """Fetch + backtest a single symbol synchronously. Returns flat stats dict or None."""
    try:
        from app.services.backtest_service import (
            _fetch_ohlcv_sync, _to_df, _backtest_core_sync,
        )
        # Use yfinance sync fetch (TW stock = {code}.TW suffix)
        yf_sym = f"{symbol}.TW" if symbol.isdigit() else symbol
        raw = _fetch_ohlcv_sync(yf_sym, start_date, end_date)
        if not raw or len(raw) < 50:
            return None
        bench_raw = _fetch_ohlcv_sync("0050.TW", start_date, end_date)
        df       = _to_df(raw)
        bench_df = _to_df(bench_raw) if bench_raw else None

        stats = _backtest_core_sync(df, bench_df, strategy, symbol,
                                    initial_capital, stop_loss, take_profit)
        if not stats or stats.get("total_trades", 0) == 0:
            return None
        return {
            "symbol":        symbol,
            "score":         round(_score(stats), 4),
            "total_return":  round(float(stats.get("total_return",  0) or 0), 4),
            "cagr":          round(float(stats.get("cagr",          0) or 0), 4),
            "sharpe":        round(float(stats.get("sharpe",        0) or 0), 4),
            "max_drawdown":  round(float(stats.get("max_drawdown",  0) or 0), 4),
            "win_rate":      round(float(stats.get("win_rate",      0) or 0), 2),
            "profit_factor": round(float(stats.get("profit_factor", 0) or 0), 2),
            "total_trades":  int(stats.get("total_trades", 0) or 0),
            "avg_hold_days": round(float(stats.get("avg_hold_days", 0) or 0), 1),
        }
    except Exception as exc:
        logger.debug("[scan] %s failed: %s", symbol, exc)
        return None


# ── Background scan task ───────────────────────────────────────────────────────

async def _scan_task(job: ScanJob, pool: list[str], strategy: dict,
                     start_date: str, end_date: str, initial_capital: float,
                     stop_loss: float | None, take_profit: float | None) -> None:
    job.status = "running"
    job.total  = len(pool)
    loop       = asyncio.get_event_loop()

    sem = asyncio.Semaphore(8)   # max 8 concurrent

    async def _do(symbol: str) -> dict | None:
        async with sem:
            result = await loop.run_in_executor(
                _executor, _run_one,
                symbol, strategy, start_date, end_date,
                initial_capital, stop_loss, take_profit,
            )
            job.progress += 1
            return result

    try:
        tasks   = [_do(sym) for sym in pool]
        results = await asyncio.gather(*tasks, return_exceptions=False)
        job.results = sorted(
            [r for r in results if r is not None],
            key=lambda x: x["score"],
            reverse=True,
        )
        job.status = "done"
    except Exception as exc:
        logger.exception("[scan] job %s crashed", job.job_id)
        job.status = "failed"
        job.error  = str(exc)


# ── Public API ─────────────────────────────────────────────────────────────────

def create_scan_job(
    strategy: dict,
    start_date: str,
    end_date: str,
    initial_capital: float = 1_000_000.0,
    stop_loss: float | None = None,
    take_profit: float | None = None,
    extra_symbols: list[str] | None = None,
) -> str:
    _cleanup_old_jobs()
    job_id = str(uuid.uuid4())
    job    = ScanJob(job_id=job_id)
    _jobs[job_id] = job

    pool = list(TW_SCAN_POOL)
    if extra_symbols:
        for sym in extra_symbols:
            sym = sym.strip().upper()
            if sym and sym not in pool:
                pool.append(sym)

    asyncio.create_task(
        _scan_task(job, pool, strategy, start_date, end_date,
                   initial_capital, stop_loss, take_profit)
    )
    return job_id
