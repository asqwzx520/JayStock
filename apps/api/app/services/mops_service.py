"""
公開資訊觀測站（MOPS）爬蟲

抓取：
- 季財報（綜合損益表 + 資產負債表）
- 月營收自結公告

注意：MOPS HTML 結構偶爾會變，所有 parser 都用「欄位名稱」對位而非 index，並有 try/except 包裹。
失敗時上層應 fallback 到 FinMind。

URLs:
- 月營收：https://mops.twse.com.tw/nas/t21/sii/t21sc03_{year}_{month}.html
- 季財報（IFRS）：https://mops.twse.com.tw/mops/web/ajax_t164sb04
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx

from app.core.cache import ttl_cache
from app.core.config import settings

logger = logging.getLogger(__name__)
_TZ_TAIPEI = ZoneInfo("Asia/Taipei")

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Referer": "https://mops.twse.com.tw/",
}


def _parse_num(s: str | None) -> float | None:
    """MOPS 數字常含逗號 / 全形負號 / 括號表負數"""
    if s is None:
        return None
    s = str(s).strip().replace(",", "").replace("−", "-").replace(" ", "")
    if not s or s in ("--", "-", "N/A"):
        return None
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


# ─────────────────────────────────────────────────────────────
# 月營收（每月 10 日前公告）
# ─────────────────────────────────────────────────────────────

@ttl_cache(ttl=3600)
async def fetch_monthly_revenue_all(year_roc: int, month: int) -> dict[str, dict]:
    """
    取得指定年月（民國年）全市場上市公司自結營收。
    回傳 {symbol: {revenue, yoy_pct, mom_pct}}

    MOPS endpoint：https://mops.twse.com.tw/nas/t21/sii/t21sc03_{年}_{月}.html
    """
    if not settings.enable_mops_scraper:
        return {}
    url = f"https://mops.twse.com.tw/nas/t21/sii/t21sc03_{year_roc}_{month}.html"
    try:
        async with httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            follow_redirects=True,
            timeout=30,
        ) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return {}
            html = resp.text
    except Exception as e:
        logger.warning("[mops.monthly_revenue] %s/%s failed: %s", year_roc, month, e)
        return {}

    # MOPS 月營收頁面為粗糙 HTML 表格。用正則抓 <tr>...<td>code</td>...<td>name</td>...
    # 欄位順序（常見）：[公司代號, 公司名稱, 當月營收, 上月營收, 去年當月營收,
    #                    上月比較增減(%), 去年同月增減(%), 當月累計營收, 去年累計營收, 前期比較增減(%)]
    result: dict[str, dict] = {}

    # 抓所有 <tr> 區塊
    tr_pattern = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
    td_pattern = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL | re.IGNORECASE)
    tag_strip  = re.compile(r"<[^>]+>")

    for tr_match in tr_pattern.finditer(html):
        tds = [tag_strip.sub("", c).strip() for c in td_pattern.findall(tr_match.group(1))]
        if len(tds) < 7:
            continue
        sym = tds[0]
        if not re.match(r"^\d{4}$", sym):  # 股票代號必為 4 位數
            continue
        revenue = _parse_num(tds[2])
        if revenue is None:
            continue
        result[sym] = {
            "revenue": revenue,
            "mom_pct": _parse_num(tds[5]) if len(tds) > 5 else None,
            "yoy_pct": _parse_num(tds[6]) if len(tds) > 6 else None,
        }
    return result


async def fetch_latest_monthly_revenue() -> tuple[int, int, dict[str, dict]]:
    """
    自動找最近一個有公告的月份（民國年, 月, data）。
    每月 10 日後通常會有上個月的資料。
    """
    now = datetime.now(_TZ_TAIPEI)
    year_ad = now.year
    month   = now.month - 1
    if month == 0:
        year_ad -= 1
        month = 12

    # 嘗試 3 個月，找到第一個有資料的
    for _ in range(3):
        year_roc = year_ad - 1911
        data = await fetch_monthly_revenue_all(year_roc, month)
        if data:
            return year_ad, month, data
        # 往前一個月
        month -= 1
        if month == 0:
            month = 12
            year_ad -= 1
    return 0, 0, {}


# ─────────────────────────────────────────────────────────────
# 季財報（綜合損益 + 資產負債）
# ─────────────────────────────────────────────────────────────

MOPS_T164SB04_URL = "https://mops.twse.com.tw/mops/web/ajax_t164sb04"


@ttl_cache(ttl=3600)
async def fetch_quarterly_financials(symbol: str, year_ad: int, quarter: int) -> dict | None:
    """
    取得單一公司單一季 IFRS 財報。
    年用西元年，quarter 1-4。

    回傳：
    {
      revenue, gross_profit, operating_income, net_income, eps,
      equity, total_assets
    }
    若爬不到回傳 None。
    """
    if not settings.enable_mops_scraper:
        return None

    year_roc = year_ad - 1911
    season = f"0{quarter}"
    payload = {
        "encodeURIComponent": "1",
        "step": "1",
        "firstin": "1",
        "off": "1",
        "queryName": "co_id",
        "inpuType": "co_id",
        "TYPEK": "all",
        "isnew": "false",
        "co_id": symbol,
        "year": str(year_roc),
        "season": season,
    }
    try:
        async with httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            follow_redirects=True,
            timeout=25,
        ) as client:
            resp = await client.post(MOPS_T164SB04_URL, data=payload)
            if resp.status_code != 200:
                return None
            html = resp.text
    except Exception as e:
        logger.debug("[mops.fin] %s %sQ%s failed: %s", symbol, year_ad, quarter, e)
        return None

    if "查無資料" in html or "查詢無資料" in html:
        return None

    # 用 keyword 抓欄位（MOPS 報表 HTML 順序固定，但保險用 keyword）
    out: dict = {
        "revenue": None,
        "gross_profit": None,
        "operating_income": None,
        "net_income": None,
        "eps": None,
        "equity": None,
        "total_assets": None,
    }

    def _extract_by_keyword(html: str, keywords: list[str]) -> float | None:
        """從 HTML 中找包含 keyword 的 <tr>，回傳該 row 第一個數字欄位"""
        for kw in keywords:
            pat = re.compile(
                rf"<tr[^>]*>[\s\S]*?{re.escape(kw)}[\s\S]*?</tr>",
                re.IGNORECASE,
            )
            m = pat.search(html)
            if not m:
                continue
            tds = re.findall(r"<td[^>]*>([\s\S]*?)</td>", m.group(0))
            if len(tds) < 2:
                continue
            # 通常第 2 個 td 是本期金額
            for cell in tds[1:]:
                text = re.sub(r"<[^>]+>", "", cell).strip()
                v = _parse_num(text)
                if v is not None:
                    return v
        return None

    out["revenue"]          = _extract_by_keyword(html, ["營業收入合計", "營業收入"])
    out["gross_profit"]     = _extract_by_keyword(html, ["營業毛利"])
    out["operating_income"] = _extract_by_keyword(html, ["營業利益"])
    out["net_income"]       = _extract_by_keyword(html, ["本期淨利", "本期綜合損益總額"])
    out["eps"]              = _extract_by_keyword(html, ["基本每股盈餘", "每股盈餘"])
    out["equity"]           = _extract_by_keyword(html, ["權益總計", "權益總額"])
    out["total_assets"]     = _extract_by_keyword(html, ["資產總計", "資產總額"])

    # 至少要有 revenue 或 net_income 才算成功
    if out["revenue"] is None and out["net_income"] is None:
        return None
    return out
