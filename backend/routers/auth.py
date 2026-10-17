from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Request, Response
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
