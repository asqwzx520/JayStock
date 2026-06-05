from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Server
    debug: bool = False
    cors_origins: List[str] = ["http://localhost:3000"]

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""

    # Upstash Redis
    redis_url: str = "redis://localhost:6379"

    # Gemini AI
    gemini_api_key: str = ""

    # Groq (fallback AI)
    groq_api_key: str = ""

    # Data sources
    finmind_token: str = ""

    # Email Digest (SMTP)
    digest_smtp_host: str = "smtp.gmail.com"
    digest_smtp_port: int = 587
    digest_smtp_user: str = ""
    digest_smtp_pass: str = ""
    digest_recipients: str = ""   # comma-separated emails

    # Error Monitoring
    sentry_dsn: str = ""

    # Admin token — gates internal/debug endpoints (screener/cache, etc.)
    admin_token: str = ""

    # Data / file storage
    data_dir: str = "/tmp"

    # Web Push Notification (VAPID)
    # Generate keys: openssl ecparam -name prime256v1 -genkey -noout -out vapid_private.pem
    # then: python -c "from pywebpush import vapid; vapid.Vapid().from_file('vapid_private.pem').generate_vapid_keypair()"
    # Or use: https://vapidkeys.com/
    vapid_private_key: str = ""   # PEM or base64url private key
    vapid_public_key:  str = ""   # base64url public key (sent to browser)
    vapid_sub:         str = "mailto:admin@jaystock.app"  # contact email


settings = Settings()
