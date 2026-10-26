"""Har bir mijoz o'rnatmasi uchun sozlanadigan kirim qoidalari.

Rejimlar:
  - rang o'chiq:  Артикул = Модель              (A26TOP00724)
  - rang yoqiq:   Артикул = Модель + Rang kodi  (A26TOP00724BLK)
  - razmer yoqiq: razmer artikulga KIRMAYDI — har bir razmer bir xil artikulli alohida tovar
                  (o'z kodi va shtrixkodi bilan; nomiga razmer qo'shilishi sozlanadi)
Misol: 1 model × 4 rang × 5 razmer = 1 model raqami, 4 artikul, 20 tovar (kod/shtrixkod).
"""
import json
from typing import Any, Dict
from sqlalchemy.orm import Session
from backend.config import get_settings
from backend.models import AppSetting

DEFAULTS: Dict[str, Any] = {
    "company_name": None,        # None -> .env COMPANY_NAME
    "color_enabled": True,       # Rang artikulga qo'shiladi va majburiy
    "size_enabled": False,       # Har bir razmer (S, M, L ...) — alohida tovar, razmer majburiy
    "size_in_name": True,        # Razmer rejimida tovar nomi oxiriga razmer qo'shiladi (kassa/inventarizatsiyada ajratish uchun)
    "usd_enabled": False,        # Kirimni dollarda qilish imkoniyati (odatda faqat so'm)
    "allowed_logins": "",        # Bo'sh — MoySklad hisobining barcha xodimlari kira oladi
    "color_primary_lang": "ru",   # Ranglarning asosiy nomi: ru (ruscha) | tr (turkcha) — mijozga qarab
    # Telegram bildirishnomalar — Sozlamalar sahifasidan boshqariladi; bo'sh bo'lsa .env qiymati ishlatiladi
    "telegram_enabled": True,
    "telegram_bot_token": None,   # None -> .env TELEGRAM_BOT_TOKEN
    "telegram_admin_ids": None,   # None -> .env SUPER_ADMIN_IDS
    "telegram_manager_ids": None, # None -> .env MANAGER_IDS
}

BOOL_KEYS = {"color_enabled", "size_enabled", "size_in_name", "usd_enabled", "telegram_enabled"}
SECRET_KEYS = {"telegram_bot_token"}


def mask_secret(value: str) -> str:
    v = value or ""
    if not v:
        return ""
    return (v[:6] + "…" + v[-4:]) if len(v) > 12 else "***"


def telegram_runtime(db: Session) -> Dict[str, Any]:
    """Amaldagi Telegram sozlamalari (baza, bo'lmasa .env)."""
    s = get_app_settings(db, include_secrets=True)
    cfg = get_settings()
    token = (s.get("telegram_bot_token") or cfg.telegram_bot_token or "").strip()
    admins = s.get("telegram_admin_ids") if s.get("telegram_admin_ids") is not None else cfg.super_admin_ids
    managers = s.get("telegram_manager_ids") if s.get("telegram_manager_ids") is not None else cfg.manager_ids
    ids = []
    for raw in (admins or "", managers or ""):
        for part in str(raw).replace(";", ",").split(","):
            p = part.strip()
            if p and p not in ids:
                ids.append(p)
    return {"enabled": bool(s.get("telegram_enabled", True)), "token": token, "recipients": ids}

def get_app_settings(db: Session, include_secrets: bool = False) -> Dict[str, Any]:
    stored = {s.key: s.value for s in db.query(AppSetting).filter(AppSetting.key.in_(DEFAULTS.keys())).all()}
    result: Dict[str, Any] = {}
    for key, default in DEFAULTS.items():
        if key in stored and stored[key] is not None:
            try:
                result[key] = json.loads(stored[key])
            except (ValueError, TypeError):
                result[key] = stored[key]
        else:
            result[key] = default
    if not result["company_name"]:
        result["company_name"] = get_settings().company_name
    cfg = get_settings()
    if result.get("telegram_bot_token") is None:
        result["telegram_bot_token"] = cfg.telegram_bot_token or ""
    if result.get("telegram_admin_ids") is None:
        result["telegram_admin_ids"] = cfg.super_admin_ids or ""
    if result.get("telegram_manager_ids") is None:
        result["telegram_manager_ids"] = cfg.manager_ids or ""
    if not include_secrets:
        result["telegram_bot_token_set"] = bool(result["telegram_bot_token"])
        result["telegram_bot_token"] = mask_secret(result["telegram_bot_token"])
    return result

def update_app_settings(db: Session, changes: Dict[str, Any]) -> Dict[str, Any]:
    for key, value in changes.items():
        if key not in DEFAULTS:
            continue
        if key in BOOL_KEYS:
            value = bool(value)
        elif value is not None:
            value = str(value).strip()
        if key == "color_primary_lang" and value not in ("ru", "tr"):
            value = "ru"
        if key in SECRET_KEYS and value and ("…" in value or value == "***"):
            continue  # niqoblangan qiymat qaytib keldi — tegmaymiz
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if not row:
            row = AppSetting(key=key)
            db.add(row)
        row.value = json.dumps(value, ensure_ascii=False)
    db.commit()
    return get_app_settings(db)

def get_raw_setting(db: Session, key: str) -> Any:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    return row.value if row else None

def set_raw_setting(db: Session, key: str, value: str):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key)
        db.add(row)
    row.value = value
    db.commit()
