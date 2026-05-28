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

    # Data / file storage
    data_dir: str = "/tmp"


settings = Settings()
