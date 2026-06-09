"""
TDCC 集保結算所股權分散表 endpoint

GET /api/v1/ownership/{symbol}
回傳該股最近 N 週的股權分散變化（散戶 vs 大戶比例）
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.rate_limit import limiter
from app.core.supabase_client import get_supabase
from app.core.validators import validate_symbol
from app.services.tdcc_service import fetch_tdcc_ownership_all

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/ownership/{symbol}")
@limiter.limit("20/minute")
async def get_ownership(
    request: Request,
    symbol: str,
    weeks: int = Query(12, ge=1, le=52, description="近 N 週"),
):
    sym = validate_symbol(symbol)

    # 1. Supabase
    db = get_supabase()
    history: list[dict] = []
    if db is not None:
        try:
            cutoff = (date.today() - timedelta(weeks=weeks)).isoformat()
            resp = (
                db.table("tdcc_ownership")
                .select("week_date, retail_pct, major_pct, shareholder_count, major_count")
                .eq("symbol", sym)
                .gte("week_date", cutoff)
                .order("week_date", desc=False)
                .execute()
            )
            history = resp.data or []
        except Exception as e:
            logger.warning("[ownership] supabase %s failed: %s", sym, e)

    # 2. 若 Supabase 空，live fetch（取最新一週）
    if not history:
        try:
            data = await fetch_tdcc_ownership_all()
            rec = data.get(sym)
            if rec and rec.get("week_date"):
                wd_clean = rec["week_date"].replace("/", "")
                history = [{
                    "week_date":         f"{wd_clean[:4]}-{wd_clean[4:6]}-{wd_clean[6:8]}",
                    "retail_pct":        rec.get("retail_pct"),
                    "major_pct":         rec.get("major_pct"),
                    "shareholder_count": rec.get("shareholder_count"),
                    "major_count":       rec.get("major_count"),
                }]
        except Exception as e:
            logger.warning("[ownership] live fetch %s failed: %s", sym, e)

    if not history:
        raise HTTPException(status_code=404, detail=f"No ownership data for {sym}")

    latest = history[-1]
    return {
        "symbol":  sym,
        "weeks":   weeks,
        "latest":  latest,
        "history": history,
    }
