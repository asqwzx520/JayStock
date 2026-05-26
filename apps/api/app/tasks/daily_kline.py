import logging
from datetime import date

logger = logging.getLogger(__name__)


async def fetch_daily_kline():
    today = date.today().strftime("%Y-%m-%d")
    logger.info(f"Fetching daily kline for {today}")
    # TODO: 實作 FinMind 日 K 線抓取並寫入 Supabase
    # Dataset: TaiwanStockPrice
