from fastapi import APIRouter, HTTPException, Request
from app.services.twse_fetcher import fetch_quotes
from app.services.market_service import fetch_us_quote, fetch_stock_news
from app.core.validators import validate_symbol, validate_symbols
from app.core.rate_limit import limiter

router = APIRouter()


@router.get("/quotes/{symbol}")
@limiter.limit("60/minute")
async def get_quote(request: Request, symbol: str):
    sym = validate_symbol(symbol)
    result = await fetch_quotes([sym])
    if sym not in result:
        raise HTTPException(status_code=404, detail=f"Symbol {sym} not found")
    return result[sym]


@router.get("/quotes")
@limiter.limit("30/minute")
async def get_quotes_batch(request: Request, symbols: str):
    """
    批次查詢，symbols 以逗號分隔：?symbols=2330,2317,0050
    """
    raw = [s.strip() for s in symbols.split(",") if s.strip()]
    if not raw:
        raise HTTPException(status_code=400, detail="No symbols provided")
    if len(raw) > 50:
        raise HTTPException(status_code=400, detail="Max 50 symbols per request")
    symbol_list = validate_symbols(raw)
    return await fetch_quotes(symbol_list)


@router.get("/quotes/us/{symbol}")
@limiter.limit("30/minute")
async def get_us_quote(request: Request, symbol: str):
    """
    取得美股報價（Yahoo Finance / yfinance）
    例：GET /api/v1/quotes/us/AAPL
    """
    sym = validate_symbol(symbol)
    result = await fetch_us_quote(sym)
    if result is None:
        raise HTTPException(status_code=404, detail=f"US symbol {sym} not found")
    return result


@router.get("/news/{symbol}")
@limiter.limit("20/minute")
async def get_stock_news(request: Request, symbol: str):
    """
    取得個股新聞（多源聚合：Yahoo + 鉅亨 + MoneyDJ + Google News）

    優先順序：
    1. Supabase news_cache（由 daily_news_tier1 寫入）
    2. 即時聚合 (fetch_aggregated_news)
    3. 舊路徑 fetch_stock_news (yfinance) 作為最後保底

    台股：GET /api/v1/news/2330
    美股：GET /api/v1/news/AAPL
    """
    sym = validate_symbol(symbol)

    # 1. Supabase cache
    try:
        from app.core.supabase_client import get_supabase
        db = get_supabase()
        if db is not None:
            resp = (
                db.table("news_cache")
                .select("title, publisher, link, published_at, importance, is_chinese, thumbnail, source")
                .eq("symbol", sym)
                .order("published_at", desc=True)
                .limit(50)
                .execute()
            )
            rows = resp.data or []
            if rows:
                from datetime import datetime
                news = []
                for r in rows:
                    pub = r.get("published_at")
                    if isinstance(pub, str):
                        try:
                            pub_ts = int(datetime.fromisoformat(pub.replace("Z", "+00:00")).timestamp())
                        except Exception:
                            pub_ts = 0
                    else:
                        pub_ts = 0
                    news.append({
                        "title":        r.get("title", ""),
                        "publisher":    r.get("publisher", ""),
                        "link":         r.get("link", ""),
                        "published_at": pub_ts,
                        "importance":   r.get("importance", "低"),
                        "is_chinese":   bool(r.get("is_chinese")),
                        "thumbnail":    r.get("thumbnail"),
                        "type":         r.get("source", ""),
                    })
                return {"symbol": sym, "count": len(news), "news": news, "source": "cache"}
    except Exception:
        pass

    # 2. 即時多源聚合
    try:
        from app.services.news_aggregator import fetch_aggregated_news
        items = await fetch_aggregated_news(sym, limit=50)
        if items:
            news = [
                {
                    "title":        it.get("title", ""),
                    "publisher":    it.get("publisher", ""),
                    "link":         it.get("link", ""),
                    "published_at": it.get("published_at", 0),
                    "importance":   it.get("importance", "低"),
                    "is_chinese":   bool(it.get("is_chinese")),
                    "thumbnail":    it.get("thumbnail"),
                    "type":         it.get("source", ""),
                }
                for it in items
            ]
            return {"symbol": sym, "count": len(news), "news": news, "source": "aggregated"}
    except Exception:
        pass

    # 3. 舊路徑保底
    news = await fetch_stock_news(sym)
    return {"symbol": sym, "count": len(news), "news": news, "source": "legacy"}
