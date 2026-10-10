import os
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, List
from backend.database import get_db
from backend.models import ProductType, Brand, Season, ArticulCounter
from backend.services.gemini_service import GeminiService
from backend.services.articul_service import calculate_row_formulas

router = APIRouter(prefix="/api/ai", tags=["AI Invoice OCR"])
gemini_service = GeminiService()

@router.post("/scan-invoice")
async def scan_invoice(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Upload invoice/waybill photo, extract table items with Gemini Flash AI,
    and calculate initial formulas.
    """
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Fayl bo'sh")

    # Gather reference context to help Gemini normalize product names
    known_pts = [p.name for p in db.query(ProductType).limit(100).all()]
    known_brands = [b.name for b in db.query(Brand).limit(50).all()]
    known_seasons = [s.collection for s in db.query(Season).all()]

    ref_context = {
        "known_product_types": known_pts,
        "known_brands": known_brands,
        "known_seasons": known_seasons
    }

    mime_type = file.content_type or "image/jpeg"
    extracted_rows = await gemini_service.parse_invoice_image(
        image_bytes=contents,
        mime_type=mime_type,
        reference_context=ref_context
    )

    if not extracted_rows:
        return {
            "status": "warning",
            "message": "AI rasmda tovar qatorlarini aniqlay olmadi yoki API xatosi yuz berdi. Iltimos, rasmni tekshiring yoki qo'lda kiriting.",
            "rows": []
        }

    # Fetch counter preview
    counter = db.query(ArticulCounter).filter(
        ArticulCounter.group_code == "GLOBAL",
        ArticulCounter.season_code == "GLOBAL"
    ).first()
    base_counter = counter.last_number if counter else 500

    enriched_rows = []
    for idx, r in enumerate(extracted_rows):
        p_type = r.get("product_type", "")
        coll = r.get("collection", "AW26")
        brand = r.get("brand", "De Luxury")
        desc = r.get("description", "")
        model = r.get("model_code", "")
        qty = float(r.get("quantity") or 1.0)
        p_buy = float(r.get("price_buy") or 0.0)
        p_sale = float(r.get("price_sale") or 0.0)
        confidence = float(r.get("confidence") or 0.9)
        low_fields = r.get("low_confidence_fields", [])

        # Auto formula calculations
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

        preview_num = base_counter + idx + 1
        articul_code = f"{calc['season_code']}{calc['group_code']}{preview_num:05d}"

        enriched_rows.append({
            "country": r.get("country", "Турция"),
            "product_type": p_type,
            "category": calc["category"],
            "group_name": calc["group_name"],
            "brand": brand,
            "collection": coll,
            "season": r.get("season", "Весна-Осень"),
            "size": r.get("size", "M"),
            "description": desc,
            "model_code": model,
            "quantity": qty,
            "price_buy": p_buy,
            "price_sale": p_sale,
            "articul": articul_code,
            "full_name": calc["full_name"],
            "markup_pct": calc["markup_pct"],
            "sum_buy": calc["sum_buy"],
            "sum_sale": calc["sum_sale"],
            "ai_generated": True,
            "ai_confidence": confidence,
            "ai_low_confidence_fields": low_fields
        })

    return {
        "status": "success",
        "message": f"{len(enriched_rows)} ta tovar qatori muvaffaqiyatli aniqlandi!",
        "rows": enriched_rows
    }
