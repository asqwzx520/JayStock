"""
集保結算所（TDCC）股權分散表

替代付費的「分點進出」資料，顯示：
- 散戶比例（< 10 張持股的人數佔比）
- 大戶比例（> 1000 張持股的人數佔比）
- 總股東數
- 大戶股東數

每週四公告上週五的股權分布。

資料來源：
https://opendata.tdcc.com.tw/getOD.ashx?id=1792 （股權分散表，CSV）
"""
from __future__ import annotations

import csv
import io
import logging
from collections import defaultdict
from datetime import date, datetime

import httpx

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

TDCC_CSV_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1792"

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/csv,application/csv,*/*",
}


def _safe_int(s) -> int:
    if s is None:
        return 0
    try:
        return int(str(s).replace(",", "").strip() or 0)
    except (ValueError, TypeError):
        return 0


# TDCC 股權分散表持股級距 ID（觀察 OpenData 文件）：
# 1: 1-999, 2: 1,000-5,000, 3: 5,001-10,000, ... 15: 1,000,001 以上, 16-17: 差異/合計
# 散戶 = level 1-4 (< 50 張)
# 大戶 = level 12-15 (> 400 張)
# 為簡化，我們把：
#   retail = level 1-4 (人數)
#   major  = level 12-15 (人數)
# 比例 = 該分組人數 / 總股東數


@ttl_cache(ttl=3600)
async def fetch_tdcc_ownership_all() -> dict[str, dict]:
    """
    抓取 TDCC 最新一週股權分散表，回傳 {symbol: data}。
    data = {week_date, shareholder_count, retail_pct, major_pct, major_count}
    """
    try:
        async with httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            follow_redirects=True,
            timeout=60,
        ) as client:
            resp = await client.get(TDCC_CSV_URL)
            if resp.status_code != 200:
                return {}
            text = resp.text
    except Exception as e:
        logger.warning("[tdcc.ownership] failed: %s", e)
        return {}

    reader = csv.DictReader(io.StringIO(text))
    by_symbol: dict[str, dict] = defaultdict(lambda: {
        "week_date": None,
        "shareholder_count": 0,
        "retail_count": 0,
        "major_count": 0,
    })
    latest_week: str | None = None

    # CSV 欄位（中文 headers，OpenData 文件）：
    # 資料日期 / 持股分級 / 證券代號 / 人數 / 股數 / 占集保庫存數比例
    for row in reader:
        sym = (row.get("證券代號") or "").strip()
        if not sym or not sym.isdigit():
            continue
        try:
            level    = int((row.get("持股分級") or "0").strip())
        except (ValueError, TypeError):
            continue
        people   = _safe_int(row.get("人數"))
        date_str = (row.get("資料日期") or "").strip()

        if latest_week is None or (date_str and date_str > (latest_week or "")):
            latest_week = date_str

        rec = by_symbol[sym]
        rec["week_date"] = date_str

        # 16/17 = 差異/合計，跳過避免污染
        if level == 17:
            rec["shareholder_count"] = people
        elif 1 <= level <= 4:
            rec["retail_count"] += people
        elif 12 <= level <= 15:
            rec["major_count"] += people

    # 計算比例
    out: dict[str, dict] = {}
    for sym, rec in by_symbol.items():
        total = rec["shareholder_count"]
        if total <= 0:
            continue
        out[sym] = {
            "week_date":         rec["week_date"],
            "shareholder_count": total,
            "retail_pct":        round(rec["retail_count"] / total * 100, 2),
            "major_pct":         round(rec["major_count"] / total * 100, 2),
            "major_count":       rec["major_count"],
        }
    return out
