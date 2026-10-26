# backend/routers/telegram.py — Telegram bot holati va sinov xabari (Sozlamalar sahifasi)
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.services.app_settings import telegram_runtime, get_app_settings
from backend.services.telegram_service import tg_service
from backend.routers.auth import require_admin

router = APIRouter(prefix="/api/telegram", tags=["Telegram"])


@router.get("/status")
async def telegram_status(db: Session = Depends(get_db)):
    rt = telegram_runtime(db)
    me = await tg_service.get_me(rt["token"]) if rt["token"] else None
    return {
        "configured": bool(rt["token"]),
        "enabled": rt["enabled"],
        "valid": bool(me),
        "username": (me or {}).get("username", ""),
        "bot_name": (me or {}).get("first_name", ""),
        "recipients": rt["recipients"],
    }


@router.post("/test")
async def telegram_test(data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    """Sinov xabari. Saqlanmagan token/ID'lar bilan ham tekshirish mumkin (body: token, ids)."""
    require_admin(request)
    rt = telegram_runtime(db)
    token = (data.get("token") or "").strip()
    if not token or "…" in token or token == "***":
        token = rt["token"]
    ids_raw = (data.get("ids") or "").strip()
    ids = [x.strip() for x in ids_raw.replace(";", ",").split(",") if x.strip()] if ids_raw else rt["recipients"]
    if not token:
        raise HTTPException(status_code=400, detail="Bot tokeni kiritilmagan")
    if not ids:
        raise HTTPException(status_code=400, detail="Qabul qiluvchi chat ID kiritilmagan")
    me = await tg_service.get_me(token)
    if not me:
        raise HTTPException(status_code=400, detail="Token noto'g'ri yoki Telegram javob bermadi")
    s = get_app_settings(db)
    ok = await tg_service.send_message(
        f"✅ <b>{s.get('company_name') or 'Kirim'}</b>: Telegram ulanishi ishlayapti (@{me.get('username')}).",
        token=token, recipients=ids,
    )
    return {"status": "ok" if ok else "partial", "username": me.get("username"), "sent_to": ids,
            "message": "Xabar yuborildi" if ok else "Ba'zi ID'larga yuborilmadi (bot bilan /start bosilganini tekshiring)"}
