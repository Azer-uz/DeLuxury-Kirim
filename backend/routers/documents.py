import json
import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Optional
from backend.database import get_db
from backend.models import (
    PrixodDocument, PrixodItem, DraftState, ArticulCounter, ProductType, Season
)
from backend.services.articul_service import (
    calculate_row_formulas, get_next_articul_number
)
from backend.services.moysklad_service import MoySkladService
from backend.services.telegram_service import TelegramService

router = APIRouter(prefix="/api/documents", tags=["Documents & Submission"])
ms_service = MoySkladService()
tg_service = TelegramService()

@router.get("/draft")
def get_draft(db: Session = Depends(get_db)):
    """Retrieve saved draft state for the grid."""
    draft = db.query(DraftState).filter(DraftState.draft_key == "current_grid").first()
    if draft and draft.data_json:
        try:
            return json.loads(draft.data_json)
        except Exception:
            return {"header": {}, "rows": []}
    return {"header": {}, "rows": []}

@router.post("/draft")
def save_draft(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Save current grid state as draft."""
    draft = db.query(DraftState).filter(DraftState.draft_key == "current_grid").first()
    json_str = json.dumps(data, ensure_ascii=False)
    if not draft:
        draft = DraftState(draft_key="current_grid", data_json=json_str)
        db.add(draft)
    else:
        draft.data_json = json_str
        draft.updated_at = datetime.datetime.utcnow()
    db.commit()
    return {"status": "saved", "updated_at": draft.updated_at.isoformat() if draft.updated_at else ""}

@router.post("/validate")
def validate_rows(data: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Validate grid rows according to business rules:
    - Product type is required
    - Quantity must be > 0
    - Price buy must be > 0
    - Price sale must be >= Price buy (warn or error)
    - Brand is recommended
    """
    rows = data.get("rows", [])
    errors = []
    warnings = []

    if not rows:
        return {"valid": False, "errors": [{"row": 0, "field": "rows", "message": "Jadvalda hech bo'lmaganda 1 ta tovar qatori bo'lishi kerak."}]}

    for idx, r in enumerate(rows, 1):
        p_type = (r.get("product_type") or "").strip()
        if not p_type:
            errors.append({"row": idx, "field": "product_type", "message": f"{idx}-qator: 'Вид товара' tanlanmagan!"})

        qty = float(r.get("quantity") or 0)
        if qty <= 0:
            errors.append({"row": idx, "field": "quantity", "message": f"{idx}-qator: Soni 0 dan katta bo'lishi kerak!"})

        p_buy = float(r.get("price_buy") or 0)
        if p_buy <= 0:
            errors.append({"row": idx, "field": "price_buy", "message": f"{idx}-qator: Sotib olish narxi (Закупочная цена) kiritilmagan!"})

        p_sale = float(r.get("price_sale") or 0)
        if p_sale <= 0:
            errors.append({"row": idx, "field": "price_sale", "message": f"{idx}-qator: Sotish narxi (Цена продажи) kiritilmagan!"})
        elif p_buy > 0 and p_sale < p_buy:
            warnings.append({"row": idx, "field": "price_sale", "message": f"{idx}-qator: Sotish narxi sotib olish narxidan kam (zarar)!"})

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "total_rows": len(rows),
        "valid_rows": len(rows) - len(set(e["row"] for e in errors))
    }

@router.post("/submit-moysklad")
async def submit_to_moysklad(data: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Finalize receipt, allocate permanent articul numbers, create products & supply doc in MoySklad,
    and send Telegram alert.
    """
    header = data.get("header", {})
    raw_rows = data.get("rows", [])

    # 1. Validation check
    val_res = validate_rows({"rows": raw_rows}, db)
    if not val_res["valid"]:
        raise HTTPException(
            status_code=400,
            detail={"message": "Hujjatda xatoliklar mavjud!", "errors": val_res["errors"]}
        )

    # 2. Process rows and allocate sequential Articul codes
    processed_items = []
    total_sum_buy = 0.0
    total_sum_sale = 0.0
    total_qty = 0.0

    for idx, r in enumerate(raw_rows, 1):
        p_type = r.get("product_type", "").strip()
        coll = r.get("collection", "AW26").strip()
        brand = r.get("brand", "").strip()
        desc = r.get("description", "").strip()
        model = r.get("model_code", "").strip()
        qty = float(r.get("quantity") or 1.0)
        p_buy = float(r.get("price_buy") or 0.0)
        p_sale = float(r.get("price_sale") or 0.0)
        color = r.get("color", "").strip()
        country = r.get("country", "").strip()
        size = r.get("size", "").strip()

        # Calculation
        calc = calculate_row_formulas(
            db=db,
            product_type_name=p_type,
            collection_name=coll,
            brand_name=brand,
            description=desc,
            model_code=model,
            quantity=qty,
            price_buy=p_buy,
            price_sale=p_sale
        )

        # Allocate permanent sequential articul if not explicitly provided
        custom_art = (r.get("custom_articul") or r.get("articul") or "").strip()
        if custom_art and not custom_art.startswith("TEMP"):
            articul_code = custom_art
        else:
            # Atomic increment in DB
            next_num = get_next_articul_number(db, increment=True)
            articul_code = f"{calc['season_code']}{calc['group_code']}{next_num:05d}"

        item_dict = {
            "row_index": idx,
            "articul": articul_code,
            "product_type": p_type,
            "category": calc["category"],
            "group_name": calc["group_name"],
            "brand": brand,
            "collection": coll,
            "season": r.get("season", "Весна-Осень"),
            "size": size,
            "description": desc,
            "model_code": model,
            "color": color,
            "country": country,
            "quantity": qty,
            "price_buy": p_buy,
            "price_sale": p_sale,
            "sum_buy": calc["sum_buy"],
            "sum_sale": calc["sum_sale"],
            "markup_pct": calc["markup_pct"],
            "full_name": calc["full_name"],
            "ai_generated": bool(r.get("ai_generated")),
            "ai_confidence": float(r.get("ai_confidence", 1.0)) if r.get("ai_confidence") is not None else None
        }

        total_sum_buy += calc["sum_buy"]
        total_sum_sale += calc["sum_sale"]
        total_qty += qty
        processed_items.append(item_dict)

    # 3. Create Document Record in DB (pending status)
    doc_number = header.get("doc_number") or f"PRX-{datetime.datetime.now().strftime('%y%m%d-%H%M')}"
    new_doc = PrixodDocument(
        doc_number=doc_number,
        counterparty_name=header.get("counterparty_name", "Yetkazib beruvchi"),
        counterparty_id=header.get("counterparty_id"),
        store_name=header.get("store_name", "Asosiy Ombor"),
        store_id=header.get("store_id"),
        currency=header.get("currency", "USD"),
        total_sum_buy=round(total_sum_buy, 2),
        total_sum_sale=round(total_sum_sale, 2),
        total_qty=total_qty,
        total_items=len(processed_items),
        status="sending",
        notes=header.get("notes")
    )
    db.add(new_doc)
    db.flush()

    # Add items
    for p_item in processed_items:
        db_item = PrixodItem(
            document_id=new_doc.id,
            **p_item
        )
        db.add(db_item)
    db.commit()

    # 4. Call MoySklad API to create Supply
    ms_result = await ms_service.create_supply_document(
        organization_id=header.get("organization_id"),
        counterparty_id=header.get("counterparty_id"),
        store_id=header.get("store_id"),
        items=processed_items,
        doc_number=doc_number,
        notes=header.get("notes")
    )

    if ms_result.get("status") == "success":
        new_doc.status = "sent"
        new_doc.moysklad_document_id = ms_result.get("document_id")
        new_doc.moysklad_document_name = ms_result.get("document_name")
        db.commit()

        # Clear draft after successful creation
        draft = db.query(DraftState).filter(DraftState.draft_key == "current_grid").first()
        if draft:
            draft.data_json = json.dumps({"header": {}, "rows": []})
            db.commit()

        # Send Telegram notification
        await tg_service.notify_prixod_created(
            doc_number=doc_number,
            counterparty=header.get("counterparty_name", ""),
            store=header.get("store_name", ""),
            total_items=len(processed_items),
            total_qty=total_qty,
            total_sum_buy=total_sum_buy,
            total_sum_sale=total_sum_sale,
            moysklad_url=ms_result.get("moysklad_url")
        )

        return {
            "status": "success",
            "message": "Приемка (Kirim) MoySklad'da muvaffaqiyatli yaratildi!",
            "document_id": new_doc.id,
            "moysklad_document_id": ms_result.get("document_id"),
            "moysklad_document_name": ms_result.get("document_name"),
            "moysklad_url": ms_result.get("moysklad_url"),
            "total_items": len(processed_items),
            "total_sum_buy": total_sum_buy,
            "total_sum_sale": total_sum_sale
        }
    else:
        error_msg = ms_result.get("message", "Noma'lum xatolik")
        new_doc.status = "error"
        new_doc.error_message = error_msg
        db.commit()

        # Send Telegram error alert
        await tg_service.notify_prixod_error(doc_number, error_msg)

        raise HTTPException(
            status_code=500,
            detail=f"MoySklad'ga yuborishda xatolik yuz berdi: {error_msg}"
        )

@router.get("/history")
def get_documents_history(db: Session = Depends(get_db)):
    """Get list of past submitted receipt documents."""
    docs = db.query(PrixodDocument).order_by(PrixodDocument.created_at.desc()).limit(100).all()
    res = []
    for d in docs:
        ui_url = f"https://online.moysklad.ru/app/#supply/edit?id={d.moysklad_document_id}" if d.moysklad_document_id else None
        res.append({
            "id": d.id,
            "doc_number": d.doc_number,
            "doc_date": d.doc_date.strftime("%Y-%m-%d %H:%M") if d.doc_date else "",
            "counterparty_name": d.counterparty_name,
            "store_name": d.store_name,
            "currency": d.currency,
            "total_sum_buy": d.total_sum_buy,
            "total_sum_sale": d.total_sum_sale,
            "total_qty": d.total_qty,
            "total_items": d.total_items,
            "status": d.status,
            "moysklad_document_id": d.moysklad_document_id,
            "moysklad_document_name": d.moysklad_document_name,
            "moysklad_url": ui_url,
            "error_message": d.error_message,
            "created_at": d.created_at.isoformat() if d.created_at else ""
        })
    return res

@router.get("/{doc_id}")
def get_document_details(doc_id: int, db: Session = Depends(get_db)):
    """Get full details of a specific document with items."""
    doc = db.query(PrixodDocument).filter(PrixodDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Hujjat topilmadi")

    items = [
        {
            "id": it.id,
            "row_index": it.row_index,
            "articul": it.articul,
            "product_type": it.product_type,
            "category": it.category,
            "group_name": it.group_name,
            "brand": it.brand,
            "collection": it.collection,
            "season": it.season,
            "size": it.size,
            "description": it.description,
            "model_code": it.model_code,
            "color": it.color,
            "country": it.country,
            "quantity": it.quantity,
            "price_buy": it.price_buy,
            "price_sale": it.price_sale,
            "sum_buy": it.sum_buy,
            "sum_sale": it.sum_sale,
            "markup_pct": it.markup_pct,
            "full_name": it.full_name,
            "ai_generated": it.ai_generated,
            "ai_confidence": it.ai_confidence
        }
        for it in doc.items
    ]

    return {
        "id": doc.id,
        "doc_number": doc.doc_number,
        "doc_date": doc.doc_date.strftime("%Y-%m-%d %H:%M") if doc.doc_date else "",
        "counterparty_name": doc.counterparty_name,
        "store_name": doc.store_name,
        "currency": doc.currency,
        "total_sum_buy": doc.total_sum_buy,
        "total_sum_sale": doc.total_sum_sale,
        "total_qty": doc.total_qty,
        "total_items": doc.total_items,
        "status": doc.status,
        "moysklad_document_id": doc.moysklad_document_id,
        "moysklad_document_name": doc.moysklad_document_name,
        "error_message": doc.error_message,
        "items": items
    }
