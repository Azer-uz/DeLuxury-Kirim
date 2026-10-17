import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Dict
from backend.database import get_db
from backend.models import ModelAllocation
from backend.routers.auth import require_admin
from backend.services.articul_service import get_counter, sync_counter
from backend.services.moysklad_service import MoySkladService, MoySkladError

router = APIRouter(prefix="/api/articul", tags=["Model raqami"])
ms_service = MoySkladService()
logger = logging.getLogger(__name__)

@router.get("/counter")
async def get_counter_info(db: Session = Depends(get_db)):
    """Oxirgi ishlatilgan model raqami (MoySklad artikullari bilan sinxron). Jadval oldindan ko'rish uchun"""
    try:
        last_num = sync_counter(db, await ms_service.get_max_model_number())
        synced = True
    except MoySkladError as e:
        logger.warning(f"Model counter sync failed: {e}")
        last_num = get_counter(db).last_number
        synced = False
    return {"last_number": last_num, "next_preview": f"{last_num + 1:05d}", "synced": synced}

@router.post("/counter")
def update_counter(data: Dict[str, int], request: Request, db: Session = Depends(get_db)):
    """Model raqamini qo'lda o'rnatish (faqat admin; MoySklad'dagi eng katta raqamdan kichik bo'lsa keyingi sinxronda ko'tariladi)"""
    require_admin(request)
    new_val = data.get("last_number")
    if new_val is None or new_val < 0:
        raise HTTPException(status_code=400, detail="Noto'g'ri raqam kiritildi")
    # Yuborilmagan qoralamalarga ajratilgan raqamlardan pastga tushmaymiz (takror raqam bo'lmasin)
    reserved = db.query(func.max(ModelAllocation.number)).scalar() or 0
    counter = get_counter(db)
    counter.last_number = max(int(new_val), reserved)
    db.commit()
    return {"status": "success", "last_number": counter.last_number}
