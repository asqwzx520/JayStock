"""
Shared input validators used across API routes.
"""
import re
from fastapi import HTTPException

# Matches UUID v4: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
_UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)

# Google OAuth sub: pure numeric string, 10–21 digits
_GOOGLE_ID_RE = re.compile(r"^\d{10,21}$")

# Taiwan stock symbols (numeric 4-6 chars) and US tickers (alpha 1-5 chars)
# Also accepts ETF codes like "00878", "0050"
_SYMBOL_RE = re.compile(r"^[0-9A-Za-z]{1,10}$")


def require_user(x_user_id: str | None) -> str:
    """Validate X-User-ID header is either a UUID v4 or a Google OAuth numeric ID."""
    if not x_user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid X-User-ID header",
        )
    uid = x_user_id.strip()
    if _UUID_V4_RE.match(uid.lower()) or _GOOGLE_ID_RE.match(uid):
        return uid
    raise HTTPException(
        status_code=401,
        detail="Missing or invalid X-User-ID header",
    )


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
