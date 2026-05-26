from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.api.v1 import quotes, kline, chips, market, screener, watchlist
from app.tasks.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Stock Platform API",
    version="0.1.0",
    lifespan=lifespan,
)

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
app.include_router(market.router,    prefix="/api/v1", tags=["market"])
app.include_router(screener.router,  prefix="/api/v1", tags=["screener"])
app.include_router(watchlist.router, prefix="/api/v1", tags=["watchlist"])


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
