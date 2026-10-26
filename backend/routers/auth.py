from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse, HTMLResponse
import base64, hashlib, hmac, json, time
from sqlalchemy.orm import Session
from backend.config import get_settings
from backend.database import get_db
from backend.services.app_settings import get_app_settings, update_app_settings
from backend.services.auth_service import (
    SESSION_COOKIE, AuthError, authenticate, create_session_token
)

router = APIRouter(prefix="/api", tags=["Auth & Settings"])

def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def require_admin(request: Request) -> Dict[str, Any]:
    user = getattr(request.state, "user", None) or {}
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Bu amal faqat administrator uchun.")
    return user

@router.post("/auth/login")
async def login(data: Dict[str, Any], request: Request, response: Response, db: Session = Depends(get_db)):
    settings = get_app_settings(db)
    try:
        user = await authenticate(
            data.get("login", ""), data.get("password", ""), client_ip(request), settings.get("allowed_logins", "")
        )
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    cfg = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        create_session_token(db, user),
        max_age=cfg.session_hours * 3600,
        httponly=True,
        secure=cfg.cookie_secure,
        samesite="lax",
    )
    return {"status": "ok", "user": user}

def _sso_verify(token: str, secret: str):
    """Bosh ilova imzolagan token: body.sig (urlsafe b64, HMAC-SHA256)"""
    if not token or "." not in token or not secret:
        return None
    body, sig = token.rsplit(".", 1)
    expected = base64.urlsafe_b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    return payload


@router.get("/auth/sso")
def sso_login(token: str, response: Response, db: Session = Depends(get_db)):
    """Bosh ilovadan (Said Baraka) kelgan imzolangan havola bilan kirish va asosiy sahifaga o'tish"""
    cfg = get_settings()
    payload = _sso_verify(token, cfg.sso_secret)
    if not payload or not payload.get("login"):
        return HTMLResponse("<p style='font-family:sans-serif;padding:24px'>Havola yaroqsiz yoki muddati o'tgan. Bosh ilovadan qayta o'ting.</p>", status_code=401)
    user = {
        "login": str(payload.get("login")),
        "name": str(payload.get("name") or payload.get("login")),
        "employee_id": None,
        "is_admin": bool(payload.get("is_admin")),
        "can_create": bool(payload.get("can_create", True)),
        "sso": True,
        "home": str(payload.get("home") or cfg.sso_home_url or ""),
        "home_name": str(payload.get("home_name") or cfg.sso_home_name or "Bosh ilova"),
    }
    resp = RedirectResponse(url="/", status_code=303)
    resp.set_cookie(
        SESSION_COOKIE,
        create_session_token(db, user),
        max_age=cfg.session_hours * 3600,
        httponly=True,
        secure=cfg.cookie_secure,
        samesite="lax",
    )
    return resp


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    return {"status": "ok"}

@router.get("/auth/me")
def me(request: Request, db: Session = Depends(get_db)):
    return {"user": request.state.user, "settings": get_app_settings(db)}

@router.get("/settings")
def read_settings(db: Session = Depends(get_db)):
    return get_app_settings(db)

@router.put("/settings")
def save_settings(data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    require_admin(request)
    return update_app_settings(db, data)
