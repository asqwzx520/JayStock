from fastapi import APIRouter, HTTPException
from app.services.twse_fetcher import fetch_quotes
from app.services.market_service import fetch_us_quote, fetch_stock_news

router = APIRouter()


@router.get("/quotes/{symbol}")
async def get_quote(symbol: str):
    result = await fetch_quotes([symbol])
    if symbol not in result:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    return result[symbol]


@router.get("/quotes")
async def get_quotes_batch(symbols: str):
    """
    批次查詢，symbols 以逗號分隔：?symbols=2330,2317,0050
    """
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="No symbols provided")
    if len(symbol_list) > 50:
        raise HTTPException(status_code=400, detail="Max 50 symbols per request")
    return await fetch_quotes(symbol_list)


@router.get("/quotes/us/{symbol}")
async def get_us_quote(symbol: str):
    """
    取得美股報價（Yahoo Finance / yfinance）
    例：GET /api/v1/quotes/us/AAPL
    """
    result = await fetch_us_quote(symbol)
    if result is None:
        raise HTTPException(status_code=404, detail=f"US symbol {symbol.upper()} not found")
    return result


@router.get("/news/{symbol}")
async def get_stock_news(symbol: str):
    """
    取得個股新聞（Yahoo Finance / yfinance）
    台股：GET /api/v1/news/2330
    美股：GET /api/v1/news/AAPL
    快取 TTL：10 分鐘
    """
    news = await fetch_stock_news(symbol)
    return {"symbol": symbol.upper(), "count": len(news), "news": news}
