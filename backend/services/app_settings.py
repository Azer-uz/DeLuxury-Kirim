"""Har bir mijoz o'rnatmasi uchun sozlanadigan kirim qoidalari.

Rejimlar (artikul tuzilishi):
  - rang ham, razmer ham o'chiq: Артикул = Модель                  (A26TOP00724)
  - faqat rang:                  Артикул = Модель + Rang kodi       (A26TOP00724BLK)
  - faqat razmer:                Артикул = Модель + "-" + Razmer    (A26TOP00724-XL)
  - rang + razmer:               Артикул = Модель + Rang + "-" + R. (A26TOP00724BLK-XL)
Bir modelning barcha rang/razmer variantlari bitta model raqamini oladi, har biri MoySklad'da alohida tovar.
"""
import json
from typing import Any, Dict
from sqlalchemy.orm import Session
from backend.config import get_settings
from backend.models import AppSetting

DEFAULTS: Dict[str, Any] = {
    "company_name": None,        # None -> .env COMPANY_NAME
    "color_enabled": True,       # Rang artikulga qo'shiladi va majburiy
    "size_enabled": False,       # Razmer artikulga qo'shiladi va majburiy (S, M, L ... alohida tovar)
    "size_separator": "-",       # Model/rang va razmer orasidagi belgi
    "usd_enabled": False,        # Kirimni dollarda qilish imkoniyati (odatda faqat so'm)
    "allowed_logins": "",        # Bo'sh — MoySklad hisobining barcha xodimlari kira oladi
}

BOOL_KEYS = {"color_enabled", "size_enabled", "usd_enabled"}

def get_app_settings(db: Session) -> Dict[str, Any]:
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
    return result

def update_app_settings(db: Session, changes: Dict[str, Any]) -> Dict[str, Any]:
    for key, value in changes.items():
        if key not in DEFAULTS:
            continue
        if key in BOOL_KEYS:
            value = bool(value)
        elif key == "size_separator":
            value = str(value or "")[:3]
        elif value is not None:
            value = str(value).strip()
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
