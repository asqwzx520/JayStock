"""
Shared input validators used across API routes.
"""
import re
from fastapi import HTTPException

# Matches UUID v4: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
_UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)

# Taiwan stock symbols (numeric 4-6 chars) and US tickers (alpha 1-5 chars)
# Also accepts ETF codes like "00878", "0050"
_SYMBOL_RE = re.compile(r"^[0-9A-Za-z]{1,10}$")


def require_user(x_user_id: str | None) -> str:
    """Validate X-User-ID header is a properly-formatted UUID v4."""
    if not x_user_id or not _UUID_V4_RE.match(x_user_id.lower()):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid X-User-ID header (expected UUID v4)",
        )
    return x_user_id.lower()


def validate_symbol(symbol: str) -> str:
    """Validate a stock symbol to prevent injection into downstream URLs."""
    if not symbol or not _SYMBOL_RE.match(symbol):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid symbol format: '{symbol}'. Expected 1-10 alphanumeric characters.",
        )
    return symbol.upper()


def validate_symbols(symbols: list[str]) -> list[str]:
    """Validate a list of symbols, returning cleaned list."""
    return [validate_symbol(s) for s in symbols]
