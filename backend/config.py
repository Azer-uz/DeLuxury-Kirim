import os
from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

class Settings(BaseSettings):
    moysklad_token: str = ""
    # Token manbai fayl (ixtiyoriy): shu fayldagi MOYSKLAD_TOKEN= qatori asosiy hisoblanadi va 401 bo'lganda qayta o'qiladi.
    # Said Baraka: bosh ilova har login'da yangi token oladi (eski tokenlar bekor bo'ladi) va uni o'z .env'iga yozadi —
    # MOYSKLAD_TOKEN_FILE=/var/www/moysklad-app/backend/.env qo'yilsa Kirim o'sha yangi tokenni avtomatik oladi.
    moysklad_token_file: str = ""
    moysklad_api_url: str = "https://api.moysklad.ru/api/remap/1.2"
    gemini_api_key: str = ""
    telegram_bot_token: str = ""
    # Telegram bildirishnoma oluvchilar (vergul bilan) — har bir mijoz .env faylida o'zi belgilaydi
    super_admin_ids: str = ""
    manager_ids: str = ""
    database_url: str = f"sqlite:///{BASE_DIR / 'kirim.db'}"
    app_host: str = "0.0.0.0"
    app_port: int = 8001
    timezone: str = "Asia/Tashkent"

    # Do'kon nomi (interfeys va Telegram xabarlari). Har bir mijoz o'rnatmasida o'zgaradi
    company_name: str = "DE LUXURY"

    # Kirish — MoySklad login/paroli bilan. Sessiya cookie imzosi uchun maxfiy kalit
    # (bo'sh bo'lsa birinchi ishga tushishda avtomatik yaratilib bazada saqlanadi)
    session_secret: str = ""
    session_hours: int = 12
    # HTTPS orqali ishlaganda true (cookie faqat shifrlangan ulanishda yuboriladi)
    cookie_secure: bool = False
    # Qo'shimcha adminlar (MoySklad loginlari, vergul bilan). MoySklad'dagi owner/admin roli avtomatik admin
    admin_logins: str = ""

    # SSO — bosh ilovadan (masalan Said Baraka) qayta login qilmasdan kirish. Umumiy maxfiy kalit ikkala ilovada bir xil
    sso_secret: str = ""
    sso_home_url: str = ""      # masalan https://said-baraka.uz — "orqaga" havolasi
    sso_home_name: str = ""     # masalan "Said Baraka"

    # Gateway (/api/gateway/*) — bot kabi ichki xizmatlar uchun. Localhost'dan tokensiz, tashqaridan faqat shu token bilan
    gateway_token: str = ""

    class Config:
        env_file = str(ENV_PATH)
        extra = "ignore"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
