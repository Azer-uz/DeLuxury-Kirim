from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, List
from backend.database import get_db
from backend.models import ArticulCounter
from backend.services.articul_service import (
    calculate_row_formulas, get_next_articul_number
)

router = APIRouter(prefix="/api/articul", tags=["Articul & Formulas"])

@router.post("/calculate-batch")
def calculate_batch(data: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Calculate formulas for multiple grid rows.
    """
    rows = data.get("rows", [])
    results = []

    # Read base counter preview without incrementing yet
    counter = db.query(ArticulCounter).filter(
        ArticulCounter.group_code == "GLOBAL",
        ArticulCounter.season_code == "GLOBAL"
    ).first()
    base_counter = counter.last_number if counter else 500

    for idx, row in enumerate(rows):
        res = calculate_row_formulas(
            db=db,
            product_type_name=row.get("product_type"),
            collection_name=row.get("collection"),
            brand_name=row.get("brand"),
            description=row.get("description"),
            model_code=row.get("factory_code") or row.get("model_code"),
            quantity=float(row.get("quantity") or 1.0),
            price_buy=float(row.get("price_buy") or 0.0),
            price_sale=float(row.get("price_sale") or 0.0)
        )
        
        # If user didn't lock custom articul, generate sequential preview
        if not row.get("custom_articul"):
            preview_num = base_counter + idx + 1
            res["calculated_articul"] = f"{res['season_code']}{res['group_code']}{preview_num:05d}"
            res["articul"] = res["calculated_articul"]
        else:
            res["articul"] = row.get("articul")

        results.append(res)

    return {"results": results, "base_counter": base_counter}

from backend.services.moysklad_service import MoySkladService

ms_service = MoySkladService()

@router.get("/counter")
async def get_counter_info(db: Session = Depends(get_db)):
    """Get current last used articul/code number synchronized with MoySklad."""
    counter = db.query(ArticulCounter).filter(
        ArticulCounter.group_code == "GLOBAL",
        ArticulCounter.season_code == "GLOBAL"
    ).first()
    
    last_num = counter.last_number if counter else 500

    try:
        max_ms_code = await ms_service.get_max_product_code()
        if max_ms_code > last_num:
            last_num = max_ms_code
            if not counter:
                counter = ArticulCounter(group_code="GLOBAL", season_code="GLOBAL", last_number=last_num)
                db.add(counter)
            else:
                counter.last_number = last_num
            db.commit()
    except Exception as e:
        pass

    return {
        "last_number": last_num,
        "next_preview": f"{last_num + 1:05d}"
    }

@router.post("/counter")
def update_counter(data: Dict[str, int], db: Session = Depends(get_db)):
    """Manually update the last articul counter."""
    new_val = data.get("last_number")
    if new_val is None or new_val < 0:
        raise HTTPException(status_code=400, detail="Noto'g'ri raqam kiritildi")
    
    counter = db.query(ArticulCounter).filter(
        ArticulCounter.group_code == "GLOBAL",
        ArticulCounter.season_code == "GLOBAL"
    ).first()
    if not counter:
        counter = ArticulCounter(group_code="GLOBAL", season_code="GLOBAL", last_number=new_val)
        db.add(counter)
    else:
        counter.last_number = new_val
    db.commit()
    return {"status": "success", "last_number": counter.last_number}
