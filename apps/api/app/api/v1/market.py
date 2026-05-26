from fastapi import APIRouter, Query
from app.services.stock_list import search_stocks

router = APIRouter()


@router.get("/market/search")
async def stock_search(
    q: str = Query(..., min_length=1, description="Search query (symbol or name)"),
    limit: int = Query(20, ge=1, le=50),
):
    results = await search_stocks(q, limit)
    return {"query": q, "count": len(results), "data": results}
