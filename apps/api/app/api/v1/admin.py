"""
管理端 endpoints（用 X-Admin-Token 保護）

- POST /admin/backfill                      全 Tier1 回補
- POST /admin/backfill/{symbol}             單檔 lazy backfill
- POST /admin/recompute-tier1               手動觸發重算 universe
- GET  /admin/cache-failures                查未解決失敗
- POST /admin/retry-failures                手動觸發 failure retry
- GET  /admin/schedule-status               看各 job 上次跑時間
- POST /admin/trigger-job/{job_id}          立刻跑某個排程 job
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta

from fastapi import APIRouter, Header, HTTPException, Query, Request

from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.supabase_client import get_supabase_admin
from app.core.tier1 import recompute_tier1, get_tier1_symbols

logger = logging.getLogger(__name__)
router = APIRouter()


def _check_token(x_admin_token: str | None) -> None:
    if not settings.admin_token:
        raise HTTPException(status_code=503, detail="Admin endpoints disabled (ADMIN_TOKEN not set)")
    if x_admin_token != settings.admin_token:
        raise HTTPException(status_code=403, detail="Invalid admin token")


@router.post("/admin/backfill")
@limiter.limit("2/minute")
async def admin_backfill(
    request: Request,
    days: int = Query(90, ge=10, le=365),
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
):
    """背景觸發全 Tier1 K 線回補 + 籌碼當日 + 財報"""
    _check_token(x_admin_token)

    async def _runner():
        from app.tasks.daily_kline_tier1      import fetch_daily_kline_tier1
        from app.tasks.daily_chips_full       import fetch_daily_chips_full
        from app.tasks.daily_snapshot_full    import fetch_daily_snapshot_full
        from app.tasks.daily_financials_tier1 import fetch_daily_financials_tier1
        # 順序：snapshot 先（決定 tier1 universe）→ kline → chips → financials
        await fetch_daily_snapshot_full()
        await fetch_daily_kline_tier1()
        await fetch_daily_chips_full()
        await fetch_daily_financials_tier1()

    asyncio.create_task(_runner())
    return {"status": "started", "days": days, "message": "Backfill running in background. Check /admin/schedule-status"}


@router.post("/admin/backfill/{symbol}")
@limiter.limit("10/minute")
async def admin_backfill_one(
    request: Request,
    symbol: str,
    days: int = Query(90, ge=10, le=365),
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
):
    """單檔 lazy backfill：拉 90 天 K 線 + 寫入 Supabase"""
    _check_token(x_admin_token)

    from app.services.yf_direct import fetch_kline as yf_fetch
    end   = date.today()
    start = end - timedelta(days=days)

    rows = await yf_fetch(symbol, start, end)
    if not rows:
        return {"status": "no_data", "symbol": symbol}

    db = get_supabase_admin()
    if db is None:
        return {"status": "no_db", "symbol": symbol, "rows": len(rows)}

    records = [
        {
            "symbol": symbol, "date": r["date"],
            "open": r.get("open"), "high": r.get("high"),
            "low": r.get("low"), "close": r.get("close"),
            "volume": int(r.get("volume") or 0),
            "turnover": 0, "source": "yf_direct_backfill",
        }
        for r in rows
        if r.get("close") is not None
    ]
    try:
        for i in range(0, len(records), 500):
            db.table("kline_daily").upsert(records[i:i + 500], on_conflict="symbol,date").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB write failed: {e}")

    return {"status": "ok", "symbol": symbol, "rows": len(records)}


@router.post("/admin/recompute-tier1")
@limiter.limit("2/minute")
async def admin_recompute_tier1(
    request: Request,
    size: int = Query(250, ge=50, le=1000),
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
):
    _check_token(x_admin_token)
    n = await recompute_tier1(days_lookback=5, target_size=size)
    return {"status": "ok", "size": n}


@router.get("/admin/cache-failures")
@limiter.limit("10/minute")
async def admin_cache_failures(
    request: Request,
    resolved: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
):
    _check_token(x_admin_token)
    db = get_supabase_admin()
    if db is None:
        return {"rows": [], "total": 0}
    try:
        resp = (
            db.table("cache_failures")
            .select("id, job_name, target_symbol, target_date, error_msg, retry_count, created_at, resolved")
            .eq("resolved", resolved)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"rows": resp.data or [], "total": len(resp.data or [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/admin/schedule-status")
@limiter.limit("10/minute")
async def admin_schedule_status(
    request: Request,
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
):
    _check_token(x_admin_token)
    from app.tasks.scheduler import get_schedule_status
    return {"jobs": get_schedule_status()}


@router.post("/admin/trigger-job/{job_id}")
@limiter.limit("5/minute")
async def admin_trigger_job(
    request: Request,
    job_id: str,
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
):
    """立刻執行一個排程 job（不等下次 cron）"""
    _check_token(x_admin_token)
    job_map = {
        "daily_chips_full":       "app.tasks.daily_chips_full:fetch_daily_chips_full",
        "daily_snapshot_full":    "app.tasks.daily_snapshot_full:fetch_daily_snapshot_full",
        "daily_kline_tier1":      "app.tasks.daily_kline_tier1:fetch_daily_kline_tier1",
        "daily_financials_tier1": "app.tasks.daily_financials_tier1:fetch_daily_financials_tier1",
        "daily_news_tier1":       "app.tasks.daily_news_tier1:fetch_daily_news_tier1",
        "weekly_tdcc":            "app.tasks.weekly_tdcc:fetch_weekly_tdcc",
        "weekly_recompute_tier1": "app.tasks.weekly_recompute_tier1:weekly_recompute_tier1",
        "monthly_revenue":        "app.tasks.monthly_revenue:fetch_monthly_revenue_job",
        "intraday_indices":       "app.tasks.intraday_indices:warm_indices",
    }
    spec = job_map.get(job_id)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Unknown job_id; choose from {list(job_map.keys())}")

    mod_path, fn_name = spec.split(":")
    import importlib
    mod = importlib.import_module(mod_path)
    fn = getattr(mod, fn_name)
    asyncio.create_task(fn())
    return {"status": "triggered", "job_id": job_id}


# ──────────────────────────────────────────────────────────────────────────────
# Health ping endpoint（cron-job.org keepalive，免 token）
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/health/ping")
async def health_ping():
    """
    輕量 ping，用於 Render Free spin-down 防護。
    建議：cron-job.org 設定每 10 分鐘 GET 一次。
    """
    return {"status": "alive"}
