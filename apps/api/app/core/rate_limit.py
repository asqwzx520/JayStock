"""
Shared rate-limiter instance.

Kept in a separate module to avoid circular imports:
main.py → routers → main.py (would fail).
Instead: main.py → core.rate_limit ← routers
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
