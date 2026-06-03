"""
pytest conftest — CI 測試環境設定

在 app.main 被 import 之前設定必要的環境變數，
避免 FastAPI lifespan 因缺少 SUPABASE_URL 而 RuntimeError。
"""
import os

# 讓 FastAPI 以 debug（in-memory fallback）模式啟動
os.environ.setdefault("DEBUG", "true")

# 防止 scheduler 在測試中啟動真實排程
os.environ.setdefault("DISABLE_SCHEDULER", "true")
