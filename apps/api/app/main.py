import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.rate_limit import limiter
from app.api.v1 import quotes, kline, chips, margin, market, screener, watchlist, feedback, alerts, ws, digest, fundamental, backtest, technical, financials, monthly_revenue, valuation_band, peer_comparison, foreign_holding, dividends, ai_analysis, compare, earnings, volume_profile, financial_alerts
from app.tasks.scheduler import start_scheduler, stop_scheduler

logger = logging.getLogger(__name__)

# ── Sentry error monitoring（可選，需設定 SENTRY_DSN）────────────────────────
if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.asyncio import AsyncioIntegration
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        integrations=[FastApiIntegration(), AsyncioIntegration()],
        traces_sample_rate=0.05,
        environment="production" if not settings.debug else "development",
    )


class _RemoveServerHeader(BaseHTTPMiddleware):
    """Strip the Uvicorn 'server' header to reduce fingerprinting surface."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if "server" in response.headers:
            del response.headers["server"]
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.supabase_url and not settings.debug:
        raise RuntimeError(
            "SUPABASE_URL must be set in production. "
            "Set DEBUG=true to allow in-memory fallback in development."
        )
    if not settings.supabase_url:
        logger.warning(
            "Supabase not configured — running with in-memory fallback. "
            "NOT suitable for multi-worker production deployments."
        )
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Stock Platform API",
    version="0.1.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(_RemoveServerHeader)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(quotes.router,    prefix="/api/v1", tags=["quotes"])
app.include_router(kline.router,     prefix="/api/v1", tags=["kline"])
app.include_router(chips.router,     prefix="/api/v1", tags=["chips"])
app.include_router(margin.router,    prefix="/api/v1", tags=["margin"])
app.include_router(market.router,    prefix="/api/v1", tags=["market"])
app.include_router(screener.router,  prefix="/api/v1", tags=["screener"])
app.include_router(watchlist.router, prefix="/api/v1", tags=["watchlist"])
app.include_router(feedback.router,  prefix="/api/v1", tags=["feedback"])
app.include_router(alerts.router,    prefix="/api/v1", tags=["alerts"])
app.include_router(digest.router,      prefix="/api/v1", tags=["digest"])
app.include_router(fundamental.router, prefix="/api/v1", tags=["fundamental"])
app.include_router(backtest.router,   prefix="/api/v1", tags=["backtest"])
app.include_router(technical.router,  prefix="/api/v1", tags=["technical"])
app.include_router(financials.router,       prefix="/api/v1", tags=["financials"])
app.include_router(monthly_revenue.router,  prefix="/api/v1", tags=["monthly-revenue"])
app.include_router(valuation_band.router,  prefix="/api/v1", tags=["valuation-band"])
app.include_router(peer_comparison.router,  prefix="/api/v1", tags=["peer-comparison"])
app.include_router(foreign_holding.router, prefix="/api/v1", tags=["foreign-holding"])
app.include_router(dividends.router,       prefix="/api/v1", tags=["dividends"])
app.include_router(ai_analysis.router,     prefix="/api/v1", tags=["ai-analysis"])
app.include_router(compare.router,         prefix="/api/v1", tags=["compare"])
app.include_router(earnings.router,        prefix="/api/v1", tags=["earnings"])
app.include_router(volume_profile.router,  prefix="/api/v1", tags=["volume-profile"])
app.include_router(financial_alerts.router, prefix="/api/v1", tags=["financial-alerts"])
app.include_router(ws.router,              tags=["websocket"])


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok", "version": "0.1.0"}
