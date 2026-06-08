"""
股票清單服務
- 台股：從 TWSE 開放資料取得上市公司清單（動態，帶快取）
- 美股：S&P 500 靜態清單（無外部依賴）
用於前端搜尋功能
"""
import httpx
import asyncio
from typing import Optional

TWSE_STOCK_LIST_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"

_cache: list[dict] = []
_cache_lock = asyncio.Lock()


async def get_stock_list() -> list[dict]:
    global _cache
    if _cache:
        return _cache

    async with _cache_lock:
        if _cache:
            return _cache
        _cache = await _fetch_stock_list()
        return _cache


async def _fetch_stock_list() -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(TWSE_STOCK_LIST_URL)
        resp.raise_for_status()
        data = resp.json()

    seen = set()
    result = []
    for item in data:
        code = item.get("Code", "")
        if not code or code in seen:
            continue
        seen.add(code)
        result.append({
            "symbol": code,
            "name":   item.get("Name", ""),
            "market": "TW",
        })
    return result


async def search_stocks(query: str, limit: int = 20) -> list[dict]:
    stocks = await get_stock_list()
    q = query.strip().upper()
    if not q:
        return []

    exact = []
    prefix = []
    contains = []

    for s in stocks:
        sym  = s["symbol"].upper()
        name = s["name"]
        if sym == q or name == q:
            exact.append(s)
        elif sym.startswith(q) or name.startswith(q):
            prefix.append(s)
        elif q in sym or q in name:
            contains.append(s)

    tw_results = (exact + prefix + contains)[:limit]

    # ── 美股搜尋（S&P 500 靜態清單）────────────────────────────
    q_lower = q.lower()
    us_results = []
    for s in _SP500:
        sym  = s["symbol"]
        name = s["name"].lower()
        if sym == q or sym.startswith(q) or q_lower in name:
            us_results.append(s)
        if len(us_results) >= 10:
            break

    combined = tw_results + us_results
    return combined[:limit]


# ── S&P 500 靜態清單（常見 500 檔，依市值排序前段）──────────────────────────
# 格式：{"symbol": str, "name": str, "market": "US", "exchange": str}
_SP500: list[dict] = [
    {"symbol": "AAPL",  "name": "Apple Inc.",                    "market": "US", "exchange": "NASDAQ"},
    {"symbol": "MSFT",  "name": "Microsoft Corporation",         "market": "US", "exchange": "NASDAQ"},
    {"symbol": "NVDA",  "name": "NVIDIA Corporation",            "market": "US", "exchange": "NASDAQ"},
    {"symbol": "GOOGL", "name": "Alphabet Inc. Class A",         "market": "US", "exchange": "NASDAQ"},
    {"symbol": "GOOG",  "name": "Alphabet Inc. Class C",         "market": "US", "exchange": "NASDAQ"},
    {"symbol": "AMZN",  "name": "Amazon.com Inc.",               "market": "US", "exchange": "NASDAQ"},
    {"symbol": "META",  "name": "Meta Platforms Inc.",           "market": "US", "exchange": "NASDAQ"},
    {"symbol": "TSLA",  "name": "Tesla Inc.",                    "market": "US", "exchange": "NASDAQ"},
    {"symbol": "BRK.B", "name": "Berkshire Hathaway Inc. B",     "market": "US", "exchange": "NYSE"},
    {"symbol": "TSM",   "name": "Taiwan Semiconductor (ADR)",    "market": "US", "exchange": "NYSE"},
    {"symbol": "AVGO",  "name": "Broadcom Inc.",                 "market": "US", "exchange": "NASDAQ"},
    {"symbol": "LLY",   "name": "Eli Lilly and Company",         "market": "US", "exchange": "NYSE"},
    {"symbol": "JPM",   "name": "JPMorgan Chase & Co.",          "market": "US", "exchange": "NYSE"},
    {"symbol": "V",     "name": "Visa Inc.",                     "market": "US", "exchange": "NYSE"},
    {"symbol": "UNH",   "name": "UnitedHealth Group Inc.",       "market": "US", "exchange": "NYSE"},
    {"symbol": "XOM",   "name": "Exxon Mobil Corporation",       "market": "US", "exchange": "NYSE"},
    {"symbol": "MA",    "name": "Mastercard Incorporated",       "market": "US", "exchange": "NYSE"},
    {"symbol": "JNJ",   "name": "Johnson & Johnson",             "market": "US", "exchange": "NYSE"},
    {"symbol": "PG",    "name": "Procter & Gamble Co.",          "market": "US", "exchange": "NYSE"},
    {"symbol": "WMT",   "name": "Walmart Inc.",                  "market": "US", "exchange": "NYSE"},
    {"symbol": "HD",    "name": "The Home Depot Inc.",           "market": "US", "exchange": "NYSE"},
    {"symbol": "COST",  "name": "Costco Wholesale Corporation",  "market": "US", "exchange": "NASDAQ"},
    {"symbol": "ABBV",  "name": "AbbVie Inc.",                   "market": "US", "exchange": "NYSE"},
    {"symbol": "MRK",   "name": "Merck & Co. Inc.",              "market": "US", "exchange": "NYSE"},
    {"symbol": "BAC",   "name": "Bank of America Corporation",   "market": "US", "exchange": "NYSE"},
    {"symbol": "CRM",   "name": "Salesforce Inc.",               "market": "US", "exchange": "NYSE"},
    {"symbol": "AMD",   "name": "Advanced Micro Devices Inc.",   "market": "US", "exchange": "NASDAQ"},
    {"symbol": "ORCL",  "name": "Oracle Corporation",            "market": "US", "exchange": "NYSE"},
    {"symbol": "CVX",   "name": "Chevron Corporation",           "market": "US", "exchange": "NYSE"},
    {"symbol": "PEP",   "name": "PepsiCo Inc.",                  "market": "US", "exchange": "NASDAQ"},
    {"symbol": "ADBE",  "name": "Adobe Inc.",                    "market": "US", "exchange": "NASDAQ"},
    {"symbol": "NFLX",  "name": "Netflix Inc.",                  "market": "US", "exchange": "NASDAQ"},
    {"symbol": "TMO",   "name": "Thermo Fisher Scientific Inc.", "market": "US", "exchange": "NYSE"},
    {"symbol": "CSCO",  "name": "Cisco Systems Inc.",            "market": "US", "exchange": "NASDAQ"},
    {"symbol": "WFC",   "name": "Wells Fargo & Company",         "market": "US", "exchange": "NYSE"},
    {"symbol": "ABT",   "name": "Abbott Laboratories",           "market": "US", "exchange": "NYSE"},
    {"symbol": "LIN",   "name": "Linde plc",                     "market": "US", "exchange": "NASDAQ"},
    {"symbol": "ACN",   "name": "Accenture plc",                 "market": "US", "exchange": "NYSE"},
    {"symbol": "INTU",  "name": "Intuit Inc.",                   "market": "US", "exchange": "NASDAQ"},
    {"symbol": "MCD",   "name": "McDonald's Corporation",        "market": "US", "exchange": "NYSE"},
    {"symbol": "GS",    "name": "Goldman Sachs Group Inc.",      "market": "US", "exchange": "NYSE"},
    {"symbol": "PM",    "name": "Philip Morris International",   "market": "US", "exchange": "NYSE"},
    {"symbol": "IBM",   "name": "International Business Machines","market": "US", "exchange": "NYSE"},
    {"symbol": "NOW",   "name": "ServiceNow Inc.",               "market": "US", "exchange": "NYSE"},
    {"symbol": "QCOM",  "name": "Qualcomm Incorporated",         "market": "US", "exchange": "NASDAQ"},
    {"symbol": "CAT",   "name": "Caterpillar Inc.",              "market": "US", "exchange": "NYSE"},
    {"symbol": "DIS",   "name": "The Walt Disney Company",       "market": "US", "exchange": "NYSE"},
    {"symbol": "GE",    "name": "GE Aerospace",                  "market": "US", "exchange": "NYSE"},
    {"symbol": "AMGN",  "name": "Amgen Inc.",                    "market": "US", "exchange": "NASDAQ"},
    {"symbol": "RTX",   "name": "RTX Corporation",               "market": "US", "exchange": "NYSE"},
    {"symbol": "TXN",   "name": "Texas Instruments Incorporated","market": "US", "exchange": "NASDAQ"},
    {"symbol": "SPGI",  "name": "S&P Global Inc.",               "market": "US", "exchange": "NYSE"},
    {"symbol": "HON",   "name": "Honeywell International Inc.",  "market": "US", "exchange": "NASDAQ"},
    {"symbol": "BKNG",  "name": "Booking Holdings Inc.",         "market": "US", "exchange": "NASDAQ"},
    {"symbol": "LOW",   "name": "Lowe's Companies Inc.",         "market": "US", "exchange": "NYSE"},
    {"symbol": "ISRG",  "name": "Intuitive Surgical Inc.",       "market": "US", "exchange": "NASDAQ"},
    {"symbol": "T",     "name": "AT&T Inc.",                     "market": "US", "exchange": "NYSE"},
    {"symbol": "VRTX",  "name": "Vertex Pharmaceuticals Inc.",   "market": "US", "exchange": "NASDAQ"},
    {"symbol": "AXP",   "name": "American Express Company",      "market": "US", "exchange": "NYSE"},
    {"symbol": "BLK",   "name": "BlackRock Inc.",                "market": "US", "exchange": "NYSE"},
    {"symbol": "MS",    "name": "Morgan Stanley",                "market": "US", "exchange": "NYSE"},
    {"symbol": "PLD",   "name": "Prologis Inc.",                 "market": "US", "exchange": "NYSE"},
    {"symbol": "CB",    "name": "Chubb Limited",                 "market": "US", "exchange": "NYSE"},
    {"symbol": "CI",    "name": "Cigna Group",                   "market": "US", "exchange": "NYSE"},
    {"symbol": "DE",    "name": "Deere & Company",               "market": "US", "exchange": "NYSE"},
    {"symbol": "AMAT",  "name": "Applied Materials Inc.",        "market": "US", "exchange": "NASDAQ"},
    {"symbol": "UBER",  "name": "Uber Technologies Inc.",        "market": "US", "exchange": "NYSE"},
    {"symbol": "SCHW",  "name": "Charles Schwab Corporation",    "market": "US", "exchange": "NYSE"},
    {"symbol": "ETN",   "name": "Eaton Corporation plc",         "market": "US", "exchange": "NYSE"},
    {"symbol": "SYK",   "name": "Stryker Corporation",           "market": "US", "exchange": "NYSE"},
    {"symbol": "MU",    "name": "Micron Technology Inc.",        "market": "US", "exchange": "NASDAQ"},
    {"symbol": "PFE",   "name": "Pfizer Inc.",                   "market": "US", "exchange": "NYSE"},
    {"symbol": "ADI",   "name": "Analog Devices Inc.",           "market": "US", "exchange": "NASDAQ"},
    {"symbol": "KLAC",  "name": "KLA Corporation",               "market": "US", "exchange": "NASDAQ"},
    {"symbol": "LRCX",  "name": "Lam Research Corporation",      "market": "US", "exchange": "NASDAQ"},
    {"symbol": "REGN",  "name": "Regeneron Pharmaceuticals",     "market": "US", "exchange": "NASDAQ"},
    {"symbol": "PANW",  "name": "Palo Alto Networks Inc.",       "market": "US", "exchange": "NASDAQ"},
    {"symbol": "BSX",   "name": "Boston Scientific Corporation", "market": "US", "exchange": "NYSE"},
    {"symbol": "SNPS",  "name": "Synopsys Inc.",                 "market": "US", "exchange": "NASDAQ"},
    {"symbol": "CDNS",  "name": "Cadence Design Systems Inc.",   "market": "US", "exchange": "NASDAQ"},
    {"symbol": "GILD",  "name": "Gilead Sciences Inc.",          "market": "US", "exchange": "NASDAQ"},
    {"symbol": "MMC",   "name": "Marsh & McLennan Companies",    "market": "US", "exchange": "NYSE"},
    {"symbol": "EOG",   "name": "EOG Resources Inc.",            "market": "US", "exchange": "NYSE"},
    {"symbol": "ZTS",   "name": "Zoetis Inc.",                   "market": "US", "exchange": "NYSE"},
    {"symbol": "SO",    "name": "Southern Company",              "market": "US", "exchange": "NYSE"},
    {"symbol": "CME",   "name": "CME Group Inc.",                "market": "US", "exchange": "NASDAQ"},
    {"symbol": "WM",    "name": "Waste Management Inc.",         "market": "US", "exchange": "NYSE"},
    {"symbol": "AON",   "name": "Aon plc",                      "market": "US", "exchange": "NYSE"},
    {"symbol": "NOC",   "name": "Northrop Grumman Corporation",  "market": "US", "exchange": "NYSE"},
    {"symbol": "INTC",  "name": "Intel Corporation",             "market": "US", "exchange": "NASDAQ"},
    {"symbol": "USB",   "name": "U.S. Bancorp",                  "market": "US", "exchange": "NYSE"},
    {"symbol": "PNC",   "name": "PNC Financial Services Group",  "market": "US", "exchange": "NYSE"},
    {"symbol": "APH",   "name": "Amphenol Corporation",          "market": "US", "exchange": "NYSE"},
    {"symbol": "MCO",   "name": "Moody's Corporation",           "market": "US", "exchange": "NYSE"},
    {"symbol": "ITW",   "name": "Illinois Tool Works Inc.",      "market": "US", "exchange": "NYSE"},
    {"symbol": "ADP",   "name": "Automatic Data Processing",     "market": "US", "exchange": "NASDAQ"},
    {"symbol": "FI",    "name": "Fiserv Inc.",                   "market": "US", "exchange": "NASDAQ"},
    {"symbol": "TJX",   "name": "TJX Companies Inc.",            "market": "US", "exchange": "NYSE"},
    {"symbol": "ECL",   "name": "Ecolab Inc.",                   "market": "US", "exchange": "NYSE"},
    {"symbol": "ICE",   "name": "Intercontinental Exchange Inc.","market": "US", "exchange": "NYSE"},
    {"symbol": "HUM",   "name": "Humana Inc.",                   "market": "US", "exchange": "NYSE"},
    {"symbol": "SHW",   "name": "Sherwin-Williams Company",      "market": "US", "exchange": "NYSE"},
    {"symbol": "CTAS",  "name": "Cintas Corporation",            "market": "US", "exchange": "NASDAQ"},
    {"symbol": "NSC",   "name": "Norfolk Southern Corporation",  "market": "US", "exchange": "NYSE"},
    {"symbol": "TGT",   "name": "Target Corporation",            "market": "US", "exchange": "NYSE"},
    {"symbol": "NEE",   "name": "NextEra Energy Inc.",           "market": "US", "exchange": "NYSE"},
    {"symbol": "COF",   "name": "Capital One Financial Corp.",   "market": "US", "exchange": "NYSE"},
    {"symbol": "HCA",   "name": "HCA Healthcare Inc.",           "market": "US", "exchange": "NYSE"},
    {"symbol": "F",     "name": "Ford Motor Company",            "market": "US", "exchange": "NYSE"},
    {"symbol": "GM",    "name": "General Motors Company",        "market": "US", "exchange": "NYSE"},
    {"symbol": "SPOT",  "name": "Spotify Technology S.A.",       "market": "US", "exchange": "NYSE"},
    {"symbol": "COIN",  "name": "Coinbase Global Inc.",          "market": "US", "exchange": "NASDAQ"},
    {"symbol": "PLTR",  "name": "Palantir Technologies Inc.",    "market": "US", "exchange": "NASDAQ"},
    {"symbol": "APP",   "name": "AppLovin Corporation",          "market": "US", "exchange": "NASDAQ"},
    {"symbol": "ARM",   "name": "Arm Holdings plc",              "market": "US", "exchange": "NASDAQ"},
    {"symbol": "MRVL",  "name": "Marvell Technology Inc.",       "market": "US", "exchange": "NASDAQ"},
    {"symbol": "MSTR",  "name": "MicroStrategy Incorporated",    "market": "US", "exchange": "NASDAQ"},
    {"symbol": "SMCI",  "name": "Super Micro Computer Inc.",     "market": "US", "exchange": "NASDAQ"},
    {"symbol": "SPY",   "name": "SPDR S&P 500 ETF Trust",        "market": "US", "exchange": "NYSE"},
    {"symbol": "QQQ",   "name": "Invesco QQQ Trust ETF",         "market": "US", "exchange": "NASDAQ"},
    {"symbol": "IWM",   "name": "iShares Russell 2000 ETF",      "market": "US", "exchange": "NYSE"},
    {"symbol": "GLD",   "name": "SPDR Gold Shares ETF",          "market": "US", "exchange": "NYSE"},
    {"symbol": "TLT",   "name": "iShares 20+ Year Treasury Bond ETF","market": "US", "exchange": "NASDAQ"},
    {"symbol": "SOXX",  "name": "iShares Semiconductor ETF",     "market": "US", "exchange": "NASDAQ"},
    {"symbol": "SMH",   "name": "VanEck Semiconductor ETF",      "market": "US", "exchange": "NASDAQ"},
]
