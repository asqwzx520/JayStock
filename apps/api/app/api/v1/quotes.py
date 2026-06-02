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
    取得個股新聞（Yahoo Finance / yfinance）
    台股：GET /api/v1/news/2330
    美股：GET /api/v1/news/AAPL
    快取 TTL：10 分鐘
    """
    sym = validate_symbol(symbol)
    news = await fetch_stock_news(sym)
    return {"symbol": sym, "count": len(news), "news": news}
