from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

scheduler = AsyncIOScheduler(timezone="Asia/Taipei")


def start_scheduler():
    import os
    if os.environ.get("DISABLE_SCHEDULER", "").lower() in ("1", "true", "yes"):
        return   # CI / test 環境跳過排程啟動

    from app.tasks.daily_chip          import fetch_daily_chips
    from app.tasks.daily_kline         import fetch_daily_kline
    from app.tasks.check_price_alerts  import check_price_alerts

    # 每日盤後 14:10 抓三大法人
    scheduler.add_job(
        fetch_daily_chips,
        CronTrigger(hour=14, minute=10, day_of_week="mon-fri"),
        id="daily_chips",
        replace_existing=True,
    )
    # 每日盤後 14:30 抓日 K 線
    scheduler.add_job(
        fetch_daily_kline,
        CronTrigger(hour=14, minute=30, day_of_week="mon-fri"),
        id="daily_kline",
        replace_existing=True,
    )
    # 盤中每 5 分鐘檢查價格提醒（任務內部再判斷是否在市場時間）
    scheduler.add_job(
        check_price_alerts,
        IntervalTrigger(minutes=5),
        id="check_price_alerts",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
