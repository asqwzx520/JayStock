import httpx
import logging
from datetime import date

logger = logging.getLogger(__name__)

FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"


async def fetch_daily_chips():
    today = date.today().strftime("%Y-%m-%d")
    logger.info(f"Fetching institutional chips for {today}")
    # TODO: 實作 FinMind 三大法人資料抓取並寫入 Supabase
    # Dataset: TaiwanStockInstitutionalInvestorsBuySell
