import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Any, Dict
from backend.database import get_db
from backend.models import ModelAllocation
from backend.routers.auth import require_admin
from backend.services.articul_service import CODE_COUNTER, format_code, get_code_counter, get_counter, sync_counter
from backend.services.moysklad_service import MoySkladService, MoySkladError

router = APIRouter(prefix="/api/articul", tags=["Model raqami va tovar kodi"])
ms_service = MoySkladService()
logger = logging.getLogger(__name__)

CODE_KEY = "%:code:%"

_COUNTER_CACHE: Dict[str, Any] = {}   # MoySklad assortimentini (3000+ tovar) har sahifa ochilishida o'qimaslik uchun
COUNTER_CACHE_TTL = 30


def invalidate_counter_cache():
    _COUNTER_CACHE.clear()


@router.get("/counter")
async def get_counter_info(db: Session = Depends(get_db)):
    """Oxirgi model raqami va tovar kodi (MoySklad bilan sinxron) — jadvalda oldindan ko'rish uchun. 30 s kesh."""
    import time as _t
    cached = _COUNTER_CACHE.get("data")
    if cached and _t.time() - _COUNTER_CACHE.get("ts", 0) < COUNTER_CACHE_TTL:
        return cached
    duplicates = []
    try:
        last_num = sync_counter(db, await ms_service.get_max_model_number())
        stats = await ms_service.get_code_stats()
        last_code = sync_counter(db, stats["max"], CODE_COUNTER)
        duplicates = stats["duplicates"]
        synced = True
    except MoySkladError as e:
        logger.warning(f"Counter sync failed: {e}")
        last_num = get_counter(db).last_number
        last_code = get_code_counter(db).last_number
        synced = False
    _result = {
        "last_number": last_num,
        "next_preview": f"{last_num + 1:05d}",
        "last_code": last_code,
        "next_code": format_code(last_code + 1),
        "duplicate_codes": duplicates,
        "synced": synced,
    }
    if synced:
        _COUNTER_CACHE.update({"data": _result, "ts": _t.time()})
    return _result

@router.post("/counter")
def update_counter(data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    """Qo'lda o'rnatish (faqat admin).
    Model raqami: yuborilmagan qoralamalarga ajratilganlardan pastga tushmaydi.
    Tovar kodi: faqat OSHIRISH mumkin — berilgan kod hech qachon qayta berilmasligi uchun."""
    require_admin(request)
    invalidate_counter_cache()
    result: Dict[str, Any] = {"status": "success"}

    if data.get("last_number") is not None:
        new_val = int(data["last_number"])
        if new_val < 0:
            raise HTTPException(status_code=400, detail="Noto'g'ri raqam kiritildi")
        reserved = db.query(func.max(ModelAllocation.number)).filter(~ModelAllocation.alloc_key.like(CODE_KEY)).scalar() or 0
        counter = get_counter(db)
        counter.last_number = max(new_val, reserved)
        result["last_number"] = counter.last_number

    if data.get("last_code") is not None:
        counter = get_code_counter(db)
        new_code = int(data["last_code"])
        if new_code < counter.last_number:
            raise HTTPException(status_code=400, detail=f"Tovar kodini kamaytirib bo'lmaydi (hozir {format_code(counter.last_number)}) — kodlar qaytarilmasligi kerak.")
        counter.last_number = new_code
        result["last_code"] = counter.last_number

    db.commit()
    result.setdefault("last_number", get_counter(db).last_number)
    return result
