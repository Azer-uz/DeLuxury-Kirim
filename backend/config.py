import os
from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

class Settings(BaseSettings):
    moysklad_token: str = ""
    moysklad_api_url: str = "https://api.moysklad.ru/api/remap/1.2"
    gemini_api_key: str = ""
    telegram_bot_token: str = ""
    super_admin_ids: str = "1223243487"
    manager_ids: str = "137334013"
    database_url: str = f"sqlite:///{BASE_DIR / 'kirim.db'}"
    app_host: str = "0.0.0.0"
    app_port: int = 8001
    timezone: str = "Asia/Tashkent"

    class Config:
        env_file = str(ENV_PATH)
        extra = "ignore"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
