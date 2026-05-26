from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler(timezone="Asia/Taipei")


def start_scheduler():
    from app.tasks.daily_chip import fetch_daily_chips
    from app.tasks.daily_kline import fetch_daily_kline

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
    scheduler.start()


def stop_scheduler():
    scheduler.shutdown(wait=False)
