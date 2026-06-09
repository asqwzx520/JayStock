"""
APScheduler 排程註冊

詳見 docs/TIER-CACHE-REFACTOR.md Phase 3 排程表。
"""
import os
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler(timezone="Asia/Taipei")


def start_scheduler():
    if os.environ.get("DISABLE_SCHEDULER", "").lower() in ("1", "true", "yes"):
        logger.info("[scheduler] DISABLE_SCHEDULER=1, skipping")
        return

    # ── Daily ────────────────────────────────────────────────────────────
    from app.tasks.daily_chips_full       import fetch_daily_chips_full
    from app.tasks.daily_snapshot_full    import fetch_daily_snapshot_full
    from app.tasks.daily_kline_tier1      import fetch_daily_kline_tier1
    from app.tasks.daily_financials_tier1 import fetch_daily_financials_tier1
    from app.tasks.daily_news_tier1       import fetch_daily_news_tier1
    from app.tasks.check_price_alerts     import check_price_alerts
    from app.tasks.intraday_indices       import warm_indices
    from app.tasks.weekly_tdcc            import fetch_weekly_tdcc
    from app.tasks.weekly_recompute_tier1 import weekly_recompute_tier1
    from app.tasks.monthly_revenue        import fetch_monthly_revenue_job

    # 全市場法人（T86 bulk，1 call）
    scheduler.add_job(
        fetch_daily_chips_full,
        CronTrigger(hour=14, minute=10, day_of_week="mon-fri"),
        id="daily_chips_full", replace_existing=True,
    )
    # 全市場 snapshot（STOCK_DAY_ALL + BWIBBU_d）
    scheduler.add_job(
        fetch_daily_snapshot_full,
        CronTrigger(hour=14, minute=35, day_of_week="mon-fri"),
        id="daily_snapshot_full", replace_existing=True,
    )
    # Tier 1 K 線 (~250 檔，YF 直連)
    scheduler.add_job(
        fetch_daily_kline_tier1,
        CronTrigger(hour=15, minute=0, day_of_week="mon-fri"),
        id="daily_kline_tier1", replace_existing=True,
    )
    # Tier 1 季財報（MOPS）
    scheduler.add_job(
        fetch_daily_financials_tier1,
        CronTrigger(hour=15, minute=30, day_of_week="mon-fri"),
        id="daily_financials_tier1", replace_existing=True,
    )
    # Tier 1 新聞（多源聚合）
    scheduler.add_job(
        fetch_daily_news_tier1,
        CronTrigger(hour=15, minute=45, day_of_week="mon-fri"),
        id="daily_news_tier1", replace_existing=True,
    )

    # ── Weekly ───────────────────────────────────────────────────────────
    # 週四 17:30 TDCC 股權分散
    scheduler.add_job(
        fetch_weekly_tdcc,
        CronTrigger(day_of_week="thu", hour=17, minute=30),
        id="weekly_tdcc", replace_existing=True,
    )
    # 週日 02:00 重算 Tier 1 universe
    scheduler.add_job(
        weekly_recompute_tier1,
        CronTrigger(day_of_week="sun", hour=2, minute=0),
        id="weekly_recompute_tier1", replace_existing=True,
    )

    # ── Monthly ──────────────────────────────────────────────────────────
    # 每月 11 日 09:00 MOPS 月營收
    scheduler.add_job(
        fetch_monthly_revenue_job,
        CronTrigger(day="11", hour=9, minute=0),
        id="monthly_revenue", replace_existing=True,
    )

    # ── Intraday（盤中每 5 分鐘）─────────────────────────────────────────
    scheduler.add_job(
        warm_indices,
        IntervalTrigger(minutes=5),
        id="intraday_indices", replace_existing=True,
    )
    scheduler.add_job(
        check_price_alerts,
        IntervalTrigger(minutes=5),
        id="check_price_alerts", replace_existing=True,
    )

    scheduler.start()
    logger.info("[scheduler] started with %d jobs", len(scheduler.get_jobs()))


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)


def get_schedule_status() -> list[dict]:
    """admin endpoint 用：回傳各 job 狀態"""
    if not scheduler.running:
        return []
    out = []
    for j in scheduler.get_jobs():
        out.append({
            "id":       j.id,
            "next_run": j.next_run_time.isoformat() if j.next_run_time else None,
            "trigger":  str(j.trigger),
        })
    return out
