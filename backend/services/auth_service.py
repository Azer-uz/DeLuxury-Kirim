"""Kirish — MoySklad login/paroli bilan.

Foydalanuvchini admin MoySklad'da (Настройки → Сотрудники) yaratadi va parolini ham o'sha yerda o'zgartiradi.
Ilova parolni saqlamaydi: kirishda MoySklad'ga Basic auth bilan tekshiradi va imzolangan sessiya cookie beradi.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Dict, Optional
import httpx
from sqlalchemy.orm import Session
from backend.config import get_settings
from backend.services.app_settings import get_raw_setting, set_raw_setting
from backend.services.gateway_core import gateway

SESSION_COOKIE = "kirim_session"
ADMIN_ROLES = {"owner", "admin"}

# Parol tanlashga qarshi: bitta IP + login uchun 15 daqiqada 5 ta urinish
MAX_ATTEMPTS = 5
ATTEMPT_WINDOW = 15 * 60
_failed_attempts: Dict[str, list] = {}

class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 401):
        super().__init__(message)
        self.status_code = status_code

_secret_cache: Optional[bytes] = None

def _secret(db: Session) -> bytes:
    global _secret_cache
    if _secret_cache:
        return _secret_cache
    configured = get_settings().session_secret
    if not configured:
        configured = get_raw_setting(db, "session_secret")
        if not configured:
            configured = secrets.token_urlsafe(48)
            set_raw_setting(db, "session_secret", configured)
    _secret_cache = configured.encode()
    return _secret_cache

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))

def create_session_token(db: Session, user: Dict[str, Any]) -> str:
    payload = {**user, "exp": int(time.time()) + get_settings().session_hours * 3600}
    body = _b64(json.dumps(payload, ensure_ascii=False).encode())
    sig = _b64(hmac.new(_secret(db), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"

def read_session_token(db: Session, token: Optional[str]) -> Optional[Dict[str, Any]]:
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    expected = _b64(hmac.new(_secret(db), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError):
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return payload

def _check_rate_limit(key: str):
    now = time.time()
    attempts = [t for t in _failed_attempts.get(key, []) if now - t < ATTEMPT_WINDOW]
    _failed_attempts[key] = attempts
    if len(attempts) >= MAX_ATTEMPTS:
        wait_min = int((ATTEMPT_WINDOW - (now - attempts[0])) // 60) + 1
        raise AuthError(f"Juda ko'p noto'g'ri urinish. {wait_min} daqiqadan so'ng qayta urinib ko'ring.", 429)

_account_id_cache: Optional[str] = None

async def _app_account_id() -> str:
    """Ilova tokeni tegishli MoySklad hisobi — boshqa hisob xodimlari kira olmasin"""
    global _account_id_cache
    if not _account_id_cache:
        res = await gateway.execute_request("GET", "context/employee")
        if not isinstance(res, dict) or res.get("error") or not res.get("accountId"):
            raise AuthError("MoySklad bilan bog'lanib bo'lmadi. Birozdan so'ng urinib ko'ring.", 503)
        _account_id_cache = res["accountId"]
    return _account_id_cache

async def authenticate(login: str, password: str, client_ip: str, allowed_logins: str) -> Dict[str, Any]:
    login = (login or "").strip()
    if not login or not password:
        raise AuthError("Login va parolni kiriting.", 400)

    limit_key = f"{client_ip}:{login.lower()}"
    _check_rate_limit(limit_key)

    basic = base64.b64encode(f"{login}:{password}".encode()).decode()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{gateway.base_url}/context/employee",
                headers={"Authorization": f"Basic {basic}", "Accept-Encoding": "gzip"},
            )
    except httpx.HTTPError:
        raise AuthError("MoySklad bilan bog'lanib bo'lmadi. Birozdan so'ng urinib ko'ring.", 503)

    if resp.status_code in (401, 403):
        _failed_attempts.setdefault(limit_key, []).append(time.time())
        raise AuthError("Login yoki parol noto'g'ri (MoySklad login/paroli).")
    if resp.status_code != 200:
        raise AuthError(f"MoySklad javobi: {resp.status_code}. Birozdan so'ng urinib ko'ring.", 503)

    employee = resp.json()
    if employee.get("accountId") != await _app_account_id():
        raise AuthError("Bu xodim ushbu do'kon MoySklad hisobiga tegishli emas.", 403)

    # Rol — ilova tokeni orqali (xodimning o'z huquqlari yetmasligi mumkin)
    role = ""
    security = await gateway.execute_request("GET", f"entity/employee/{employee['id']}/security")
    if isinstance(security, dict) and not security.get("error"):
        if security.get("isActive") is False:
            raise AuthError("Xodim MoySklad'da faol emas.", 403)
        role = security.get("role", {}).get("meta", {}).get("href", "").rstrip("/").split("/")[-1]

    uid = (employee.get("uid") or login).strip()
    admin_list = {x.strip().lower() for x in get_settings().admin_logins.split(",") if x.strip()}
    is_admin = role in ADMIN_ROLES or uid.lower() in admin_list

    allowed = {x.strip().lower() for x in (allowed_logins or "").split(",") if x.strip()}
    if allowed and not is_admin and uid.lower() not in allowed:
        raise AuthError("Sizga ilovaga kirish ruxsati berilmagan. Administratorga murojaat qiling.", 403)

    _failed_attempts.pop(limit_key, None)
    return {
        "login": uid,
        "name": employee.get("name") or employee.get("shortFio") or uid,
        "employee_id": employee.get("id"),
        "is_admin": is_admin,
    }
