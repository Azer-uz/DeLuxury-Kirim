import os
import re
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, List
from backend.database import get_db
from backend.models import ProductType, Brand, Season
from backend.services.gemini_service import GeminiService
from backend.services.articul_service import RefLookup, calculate_row_formulas
from backend.services.app_settings import get_app_settings

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
    if len(contents) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Rasm 25 MB dan katta — telefonda kichikroq sifatda suratga oling")

    # Gather reference context to help Gemini normalize product names
    known_pts = [p.name for p in db.query(ProductType).order_by(ProductType.name).all()]
    known_brands = [b.name for b in db.query(Brand).limit(50).all()]
    known_seasons = [s.collection for s in db.query(Season).all()]

    app_settings = get_app_settings(db)
    default_season = (app_settings.get("default_season") or "").strip() or "Весна-Осень"
    ref_context = {
        "known_product_types": known_pts,
        "known_brands": known_brands,
        "known_seasons": known_seasons,
        "default_season": default_season,
    }

    mime_type = file.content_type or "image/jpeg"
    ai_result = await gemini_service.parse_invoice_image(
        image_bytes=contents,
        mime_type=mime_type,
        reference_context=ref_context
    )

    if isinstance(ai_result, dict):
        kontragent = ai_result.get("kontragent", "")
        phone = ai_result.get("phone", "")
        doc_date = ai_result.get("date", "")
        extracted_rows = ai_result.get("rows", [])
    elif isinstance(ai_result, list):
        kontragent = ""
        phone = ""
        doc_date = ""
        extracted_rows = ai_result
    else:
        kontragent = ""
        phone = ""
        doc_date = ""
        extracted_rows = []

    if not extracted_rows:
        reason = (ai_result.get("reason") if isinstance(ai_result, dict) else "") or ""
        return {
            "status": "warning",
            "message": "AI rasmda tovar qatorlarini aniqlay olmadi." + (f" Sabab: {reason}" if reason else " Rasmni tiniqroq tushirib qayta urinib ko'ring."),
            "reason": reason,
            "rows": [],
            "kontragent": kontragent,
            "phone": phone,
            "date": doc_date
        }

    refs = RefLookup(db)
    # Nakladnoyda kolleksiya bo'lmaydi — eng oxirgi qo'shilgan kolleksiya taklif qilinadi (jadvalda o'zgartirsa bo'ladi)
    latest_season = db.query(Season).order_by(Season.id.desc()).first()
    default_collection = (app_settings.get("default_collection") or "").strip() or (latest_season.collection if latest_season else "")

    def safe_num(val, default=0.0):
        if val is None:
            return default
        if isinstance(val, (int, float)):
            return float(val)
        try:
            cleaned = str(val).replace("$", "").replace(" ", "").replace(",", ".").strip()
            return float(cleaned)
        except Exception:
            return default

    PRODUCT_TYPE_ALIASES = {
        "amerikanka": "Американка",
        "американка": "Американка",
        "dvoyka": "Двойка",
        "dvoika": "Двойка",
        "двойка": "Двойка",
        "dvoyka sport": "Спортивка двойка",
        "двойка спорт": "Спортивка двойка",
        "dvoyka s.k.": "Двойка",
        "dvoyka sk": "Двойка",
        "dvoyka pk": "Двойка",
        "dvoyka ka palto": "Двойка",
        "dvoyka koja": "Двойка",
        "svitr": "Свитер",
        "sviter": "Свитер",
        "свитр": "Свитер",
        "свитер": "Свитер",
        "futbolka": "Футболка",
        "футболка": "Футболка",
        "vitrovka": "Ветровка",
        "vitrovka koja": "Куртка кожаная",
        "ветровка": "Ветровка",
        "ветровка кожа": "Куртка кожаная",
        "bezrukavka": "Жилет безрукавка",
        "безрукавка": "Жилет безрукавка",
        "kurtka": "Куртка",
        "куртка": "Куртка",
        "kojinka": "Куртка кожаная",
        "кожинка": "Куртка кожаная",
        "koja kurtka": "Куртка кожаная",
        "кожаная куртка": "Куртка кожаная",
        "pidjak": "Пиджак",
        "пиджак": "Пиджак",
        "kardigan": "Кардиган",
        "кардиган": "Кардиган",
        "rubashka": "Рубашка",
        "рубашка": "Рубашка",
        "djinsi": "Джинсы",
        "джинсы": "Джинсы",
        "jeans": "Джинсы",
        "bryuki": "Брюки",
        "брюки": "Брюки",
        "tolstovka": "Толстовка",
        "толстовка": "Толстовка",
        "hudi": "Худи",
        "худи": "Худи",
        "kofta": "Кофта",
        "кофта": "Кофта",
        "platye": "Платье",
        "платье": "Платье",
        "bluzka": "Блузка",
        "блузка": "Блузка",
        "shorti": "Шорты",
        "шорты": "Шорты",
        "palto": "Пальто",
        "пальто": "Пальто",
        "jilet": "Жилет",
        "жилет": "Жилет",
        "kostyum": "Костюм",
        "костюм": "Костюм",
        "polo": "Футболка поло",
        "поло": "Футболка поло"
    }

    PRODUCT_TYPE_ALTERNATIVES = {
        "vitrovka koja": "Ветровка",
        "ветровка кожа": "Ветровка",
        "kojinka": "Ветровка",
        "кожинка": "Ветровка",
        "koja kurtka": "Ветровка",
        "кожаная куртка": "Ветровка",
        "dvoyka sport": "Двойка",
        "двойка спорт": "Двойка",
        "dvoyka s.k.": "Спортивка двойка",
        "dvoyka sk": "Спортивка двойка",
        "bezrukavka": "Футболка безрукавка",
        "безрукавка": "Футболка безрукавка",
        "kardigan": "Свитер",
        "кардиган": "Свитер",
    }

    def normalize_product_type(raw_name: str) -> tuple[str, bool, str]:
        if not raw_name:
            return "", False, ""
        clean = raw_name.strip()
        low = clean.lower()

        alt = PRODUCT_TYPE_ALTERNATIVES.get(low, "")
        is_ambiguous = bool(alt)

        # 1. Ierarxiyadagi nom (mijozning o'z ro'yxati) — birinchi navbatda
        exact = db.query(ProductType).filter(ProductType.name.ilike(clean)).first()
        if exact:
            return exact.name, False, ""

        # 2. Alias (lotincha/og'zaki yozuv) — natija ierarxiyada bo'lsa o'sha nom bilan
        if low in PRODUCT_TYPE_ALIASES:
            target = PRODUCT_TYPE_ALIASES[low]
            in_db = db.query(ProductType).filter(ProductType.name.ilike(target)).first()
            if not in_db:
                # so'zlari bir xil, tartibi boshqa nom ("Куртка кожаная" ~ "Кожаная куртка")
                words = [w for w in target.lower().split() if len(w) > 2]
                for pt in db.query(ProductType).all():
                    if all(any(pw.startswith(w[:5]) for pw in pt.name.lower().split()) for w in words):
                        in_db = pt; break
            return (in_db.name if in_db else target), is_ambiguous, alt

        # 3. So'zlar bo'yicha alias: katakdagi so'zlar ichida alias so'zlari bo'lsa (eng ko'p so'z mos kelgani g'olib):
        #    "ветровка замиш йока кожа" -> "ветровка кожа" (2 so'z) > "ветровка" (1 so'z)
        cell_words = [w for w in re.split(r"[\s/,.\-()]+", low) if w]
        def _hit(a: str, b: str) -> bool:
            return a == b or (len(a) >= 4 and len(b) >= 4 and (a.startswith(b[:4]) or b.startswith(a[:4])))
        best, best_n = None, 0
        for k, v in PRODUCT_TYPE_ALIASES.items():
            kw = k.split()
            if all(any(_hit(x, w) for w in cell_words) for x in kw) and len(kw) > best_n:
                best, best_n = k, len(kw)
        if best:
            target = PRODUCT_TYPE_ALIASES[best]
            in_db = db.query(ProductType).filter(ProductType.name.ilike(target)).first()
            alt_cand = PRODUCT_TYPE_ALTERNATIVES.get(best, "")
            return (in_db.name if in_db else target), bool(alt_cand), alt_cand

        # 4. Substring in DB
        partial = db.query(ProductType).filter(ProductType.name.ilike(f"%{clean}%")).first()
        if partial:
            return partial.name, False, ""

        return clean, False, ""

    _SPLIT = re.compile(r"[\s/,.\-()]+")

    def leftover_words(raw_cell: str, chosen_type: str) -> str:
        """'ветровка замиш йока кожа' - 'Кожаная куртка' -> 'замиш йока': tur nomiga kirgan so'zlar olib tashlanadi"""
        if not raw_cell or not chosen_type:
            return ""
        type_words = {w.lower() for w in _SPLIT.split(chosen_type) if w}
        for k, v in PRODUCT_TYPE_ALIASES.items():
            if v.lower() == chosen_type.lower() or chosen_type.lower() in v.lower():
                type_words.update(w for w in _SPLIT.split(k.lower()) if w)
        type_words.update({"кожа", "koja", "кожаная", "кожанная", "кожан"})  # material tur nomiga kiradi
        out = []
        for w in re.split(r"[\s/,]+", raw_cell.strip()):
            lw = w.lower().strip(".-()")
            if not lw:
                continue
            if any(lw == t or (len(lw) >= 4 and len(t) >= 4 and (t.startswith(lw[:4]) or lw.startswith(t[:4]))) for t in type_words):
                continue
            out.append(w)
        return " ".join(out).strip()

    enriched_rows = []
    for idx, r in enumerate(extracted_rows):
        raw_p_type = (r.get("product_type") or "").strip()
        raw_cell = (r.get("raw_product_type") or raw_p_type).strip()
        p_type, is_ambig, alt_type = normalize_product_type(raw_p_type)
        in_hierarchy = bool(p_type) and db.query(ProductType).filter(ProductType.name.ilike(p_type)).first() is not None
        if not in_hierarchy and raw_cell and raw_cell.lower() != raw_p_type.lower():
            # AI tanlagan nom ierarxiyada yo'q — katakning asl matnidan urinamiz
            p_type2, a2, alt2 = normalize_product_type(raw_cell)
            if p_type2 and db.query(ProductType).filter(ProductType.name.ilike(p_type2)).first():
                p_type, is_ambig, alt_type = p_type2, a2, alt2
        coll = r.get("collection") or default_collection
        brand = r.get("brand") or ""
        lifestyle = r.get("lifestyle", "")
        desc = (r.get("description") or "").strip() or lifestyle
        # Tur nomiga kirmagan so'zlar ("замиш йока") -> Описание
        rest = leftover_words(raw_cell, p_type)
        if rest and rest.lower() not in (desc or "").lower():
            desc = (rest + (" " + desc if desc else "")).strip()
        color = r.get("color", "")
        articul_in_sheet = r.get("articul", "")
        factory_code = articul_in_sheet
        size = r.get("size") or ""
        raw_qty = str(r.get("raw_quantity") or r.get("quantity") or "1")
        qty = safe_num(r.get("quantity"), 1.0)
        p_buy = safe_num(r.get("price_buy"), 0.0)
        p_sale = safe_num(r.get("price_sale"), 0.0)
        confidence = 0.75 if is_ambig else safe_num(r.get("confidence"), 0.9)
        low_fields = r.get("low_confidence_fields", [])

        # Auto formula calculations using normalized product type
        calc = calculate_row_formulas(
            db=db,
            product_type_name=p_type,
            collection_name=coll,
            brand_name=brand,
            description=desc,
            model_code=factory_code,
            quantity=qty,
            price_buy=p_buy,
            price_sale=p_sale,
            refs=refs
        )

        enriched_rows.append({
            "country": r.get("country") or "",
            "product_type": p_type,
            "category": calc["category"],
            "group_name": calc["group_name"],
            "brand": brand,
            "collection": coll,
            "season": (r.get("season") or "").strip() or default_season,
            "size": size,
            "description": desc,
            "color": color,
            "colors": [color] if color else [],
            "factory_code": factory_code,
            "model_code": factory_code,
            "quantity": qty,
            "raw_quantity": raw_qty,
            "price_buy": p_buy,
            "price_sale": p_sale,
            "full_name": calc["full_name"],
            "markup_pct": calc["markup_pct"],
            "sum_buy": calc["sum_buy"],
            "sum_sale": calc["sum_sale"],
            "ai_generated": True,
            "ai_ambiguous": is_ambig,
            "ai_alternative": alt_type,
            "ai_confidence": confidence,
            "ai_low_confidence_fields": low_fields
        })

    return {
        "status": "success",
        "message": f"{len(enriched_rows)} ta tovar qatori muvaffaqiyatli aniqlandi!",
        "kontragent": kontragent,
        "phone": phone,
        "date": doc_date,
        "rows": enriched_rows
    }
