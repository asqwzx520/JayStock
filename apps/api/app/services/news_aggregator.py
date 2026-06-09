"""
多源新聞聚合器

來源：
1. Yahoo Finance RSS（英文為主）
2. 鉅亨網 anue.com（中文，主力）
3. MoneyDJ RSS（中文）
4. Google News RSS（多語）

統一 schema：
{ title, publisher, link, published_at(unix), thumbnail, source, importance, is_chinese }

importance 演算法（與既有 market_service 一致）：
- 高：法說/財報/EPS/除息/Fed/標普/輝達/重大訊息
- 中：半導體/AI/法人/外資/產業
- 低：其餘

去重：以 link URL 為 unique key。
"""
from __future__ import annotations

import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from app.core.cache import ttl_cache

logger = logging.getLogger(__name__)

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
}

# Importance keywords（與 market_service.py / StockNews.tsx 對齊）
_HIGH_KEYWORDS = [
    "法說", "財報", "eps", "EPS", "除息", "除權", "配息", "股利",
    "漲停", "跌停", "停牌", "下市", "重大訊息",
    "非農", "gdp", "GDP", "cpi", "CPI", "pce", "PCE",
    "Fed", "聯準會", "升息", "降息", "利率決策",
    "標普", "道瓊", "那斯達克", "大跌", "暴跌", "崩盤", "熊市",
    "nvidia", "NVIDIA", "輝達", "蘋果", "Apple", "特斯拉", "Tesla",
]
_MID_KEYWORDS = [
    "半導體", "晶圓", "AI", "人工智慧", "法人", "買超", "賣超",
    "外資", "投信", "自營商", "產業", "供應鏈",
]


def _is_chinese(text: str) -> bool:
    return bool(re.search(r"[一-鿿]", text or ""))


def _score_importance(title: str, publisher: str) -> str:
    text = (title + " " + publisher).lower()
    if any(k.lower() in text for k in _HIGH_KEYWORDS):
        return "高"
    if any(k.lower() in text for k in _MID_KEYWORDS):
        return "中"
    return "低"


def _parse_rss_date(s: str) -> int | None:
    """RFC 822 / ISO 8601 → unix"""
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


async def _fetch_rss(url: str, client: httpx.AsyncClient) -> list[dict]:
    """通用 RSS / Atom 解析"""
    try:
        resp = await client.get(url)
        if resp.status_code != 200:
            return []
        text = resp.text
    except Exception as e:
        logger.debug("[news] %s failed: %s", url, e)
        return []

    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []

    # 處理 namespace
    ns = {}
    if root.tag.startswith("{"):
        ns_uri = root.tag[1:].split("}")[0]
        ns = {"": ns_uri}

    items: list[dict] = []

    # RSS 2.0：<channel><item>
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link  = (item.findtext("link")  or "").strip()
        pub   = (item.findtext("pubDate") or item.findtext("date") or "").strip()
        if not title or not link:
            continue
        items.append({
            "title": title,
            "link":  link,
            "published_at": _parse_rss_date(pub) or 0,
        })

    # Atom：<entry>
    if not items:
        for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
            title = (entry.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
            link_el = entry.find("{http://www.w3.org/2005/Atom}link")
            link = link_el.get("href") if link_el is not None else ""
            pub = (entry.findtext("{http://www.w3.org/2005/Atom}updated") or "").strip()
            if not title or not link:
                continue
            items.append({
                "title": title,
                "link":  link,
                "published_at": _parse_rss_date(pub) or 0,
            })

    return items


# ─────────────────────────────────────────────────────────────
# 各來源
# ─────────────────────────────────────────────────────────────

async def fetch_yahoo_rss(symbol: str, client: httpx.AsyncClient) -> list[dict]:
    """Yahoo Finance 國際版 RSS（英文為主）"""
    sym = symbol
    if symbol.isdigit() and len(symbol) == 4:
        sym = f"{symbol}.TW"
    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={sym}&region=US&lang=en-US"
    items = await _fetch_rss(url, client)
    for it in items:
        it["publisher"] = "Yahoo Finance"
        it["source"]    = "yahoo"
    return items


async def fetch_anue_rss(symbol: str, client: httpx.AsyncClient) -> list[dict]:
    """
    鉅亨網新聞（中文）
    台股有獨立頁面：https://news.cnyes.com/news/cat/tw_stock_news?stockId={symbol}
    但 RSS endpoint：
    https://api.cnyes.com/media/api/v1/newslist/category/tw_stock_news （JSON，非 RSS）
    這裡用較穩的 Google News fallback 找鉅亨網結果。
    """
    if not (symbol.isdigit() and len(symbol) == 4):
        return []
    q = f"{symbol} site:cnyes.com"
    url = f"https://news.google.com/rss/search?q={q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    items = await _fetch_rss(url, client)
    for it in items:
        it["publisher"] = "鉅亨網"
        it["source"]    = "anue"
    return items


async def fetch_moneydj_rss(symbol: str, client: httpx.AsyncClient) -> list[dict]:
    """MoneyDJ 中文新聞（透過 Google News）"""
    if not (symbol.isdigit() and len(symbol) == 4):
        return []
    q = f"{symbol} site:moneydj.com"
    url = f"https://news.google.com/rss/search?q={q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    items = await _fetch_rss(url, client)
    for it in items:
        it["publisher"] = "MoneyDJ"
        it["source"]    = "moneydj"
    return items


async def fetch_google_news_rss(symbol: str, client: httpx.AsyncClient) -> list[dict]:
    """Google News 中文搜尋（總和源）"""
    if not (symbol.isdigit() and len(symbol) == 4):
        # 美股直接用 ticker
        q = symbol
    else:
        q = f"{symbol} 股價 OR 股票"
    url = f"https://news.google.com/rss/search?q={q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    items = await _fetch_rss(url, client)
    for it in items:
        it["publisher"] = it.get("publisher") or "Google News"
        it["source"]    = "google"
    return items


# ─────────────────────────────────────────────────────────────
# 主聚合 API
# ─────────────────────────────────────────────────────────────

@ttl_cache(ttl=300)
async def fetch_aggregated_news(symbol: str, limit: int = 50) -> list[dict]:
    """
    聚合多源新聞、去重、排序、計算 importance / is_chinese。
    """
    async with httpx.AsyncClient(
        headers=_BROWSER_HEADERS,
        follow_redirects=True,
        timeout=15,
    ) as client:
        results = await asyncio.gather(
            fetch_yahoo_rss(symbol, client),
            fetch_anue_rss(symbol, client),
            fetch_moneydj_rss(symbol, client),
            fetch_google_news_rss(symbol, client),
            return_exceptions=True,
        )

    all_items: list[dict] = []
    for r in results:
        if isinstance(r, Exception) or not isinstance(r, list):
            continue
        all_items.extend(r)

    # 去重（以 link 為 key）
    seen: set[str] = set()
    deduped: list[dict] = []
    for it in all_items:
        link = it.get("link") or ""
        if not link or link in seen:
            continue
        seen.add(link)

        title     = it.get("title") or ""
        publisher = it.get("publisher") or ""
        it["importance"] = _score_importance(title, publisher)
        it["is_chinese"] = _is_chinese(title)
        it["thumbnail"]  = it.get("thumbnail")  # 多數 RSS 沒提供
        deduped.append(it)

    # 排序：先新→舊
    deduped.sort(key=lambda x: x.get("published_at") or 0, reverse=True)
    return deduped[:limit]
