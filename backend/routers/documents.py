import asyncio
import html
import json
import logging
import time
import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Optional
from backend.database import get_db
from backend.models import PrixodDocument, PrixodItem, DraftState, ModelAllocation
from backend.services.app_settings import get_app_settings
from backend.services.articul_service import (
    CODE_COUNTER, RefLookup, allocate_codes, allocate_model_numbers, build_articul, build_full_name,
    build_model_code, calc_money, is_multi_size, normalize_size, product_key, sync_counter
)
from backend.services.moysklad_service import MoySkladService, MoySkladError
from backend.services.telegram_service import tg_service
from backend.services.attributes_service import AttributesService, get_attribute_map, mapping_problems
from backend.routers.attributes import notify_if_changed

router = APIRouter(prefix="/api/documents", tags=["Documents & Submission"])
logger = logging.getLogger(__name__)
ms_service = MoySkladService()
attributes_service = AttributesService(ms_service)

@router.get("/drafts")
def get_all_drafts(db: Session = Depends(get_db)):
    """Retrieve all saved drafts with summary metadata."""
    drafts = db.query(DraftState).order_by(DraftState.updated_at.desc()).all()
    results = []
    for d in drafts:
        # Check rows count
        r_count = d.total_items
        if not r_count and d.data_json:
            try:
                parsed = json.loads(d.data_json)
                r_count = len(parsed.get("rows", []))
            except Exception:
                r_count = 0
        if not d.total_items:   # bo'sh jadval avtosaqlangan — ro'yxatda ko'rsatilmaydi
            continue
        results.append({
            "id": d.id,
            "draft_key": d.draft_key,
            "doc_number": d.doc_number or f"Q-{d.id}",
            "date": d.date or ((d.updated_at + datetime.timedelta(hours=5)).strftime("%Y-%m-%d") if d.updated_at else ""),
            "counterparty_name": d.counterparty_name or "(Noma'lum)",
            "store_name": d.store_name or "Основной склад",
            "currency": d.currency or "UZS",
            "total_items": r_count,
            "total_qty": d.total_qty,
            "total_sum_buy": d.total_sum_buy,
            "total_sum_sale": d.total_sum_sale,
            "updated_at": (d.updated_at + datetime.timedelta(hours=5)).strftime("%Y-%m-%d %H:%M") if d.updated_at else ""
        })
    return results

@router.get("/draft")
def get_draft(db: Session = Depends(get_db)):
    """Retrieve latest active draft state for backward compatibility."""
    draft = db.query(DraftState).order_by(DraftState.updated_at.desc()).first()
    if draft and draft.data_json:
        try:
            data = json.loads(draft.data_json)
            data["draft_id"] = draft.id
            return data
        except Exception:
            return {"header": {}, "rows": []}
    return {"header": {}, "rows": []}

@router.get("/draft/{draft_id}")
def get_draft_by_id(draft_id: int, db: Session = Depends(get_db)):
    """Retrieve specific draft by ID."""
    draft = db.query(DraftState).filter(DraftState.id == draft_id).first()
    if not draft or not draft.data_json:
        raise HTTPException(status_code=404, detail="Qoralama topilmadi")
    try:
        data = json.loads(draft.data_json)
        data["draft_id"] = draft.id
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Qoralama ma'lumotini o'qishda xatolik: {e}")

@router.post("/draft")
def save_draft(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Save or update draft with metadata."""
    header = data.get("header", {})
    rows = data.get("rows", [])
    draft_id = data.get("draft_id") or header.get("draft_id")

    # Compute summary metrics
    valid_items = [r for r in rows if r.get("product_type") or (float(r.get("price_buy") or 0) > 0)]
    t_items = len(valid_items)
    t_qty = sum(float(r.get("quantity") or 0) for r in rows)
    t_sum_buy = sum(float(r.get("sum_buy") or 0) for r in rows)
    t_sum_sale = sum(float(r.get("sum_sale") or 0) for r in rows)

    doc_num = (header.get("doc_number") or "").strip()
    cp_name = (header.get("counterparty_name") or "").strip()
    cp_id = header.get("counterparty_id")
    st_name = (header.get("store_name") or "Основной склад").strip()
    st_id = header.get("store_id")
    doc_date = (header.get("date") or "").strip()
    cur = (header.get("currency") or "UZS").strip()

    json_str = json.dumps(data, ensure_ascii=False)

    draft = None
    if draft_id:
        draft = db.query(DraftState).filter(DraftState.id == int(draft_id)).first()

    if not draft and doc_num:
        draft = db.query(DraftState).filter(DraftState.doc_number == doc_num).first()

    if not draft:
        draft = DraftState(
            draft_key=f"draft_{doc_num or datetime.datetime.utcnow().timestamp()}",
            doc_number=doc_num,
            date=doc_date,
            counterparty_name=cp_name,
            counterparty_id=cp_id,
            store_name=st_name,
            store_id=st_id,
            currency=cur,
            total_items=t_items,
            total_qty=t_qty,
            total_sum_buy=t_sum_buy,
            total_sum_sale=t_sum_sale,
            data_json=json_str
        )
        db.add(draft)
    else:
        draft.doc_number = doc_num or draft.doc_number
        draft.date = doc_date or draft.date
        draft.counterparty_name = cp_name or draft.counterparty_name
        draft.counterparty_id = cp_id or draft.counterparty_id
        draft.store_name = st_name or draft.store_name
        draft.store_id = st_id or draft.store_id
        draft.currency = cur or draft.currency
        draft.total_items = t_items
        draft.total_qty = t_qty
        draft.total_sum_buy = t_sum_buy
        draft.total_sum_sale = t_sum_sale
        draft.data_json = json_str
        draft.updated_at = datetime.datetime.utcnow()

    db.commit()
    return {
        "status": "saved",
        "draft_id": draft.id,
        "doc_number": draft.doc_number,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else ""
    }

@router.delete("/draft/{draft_id}")
def delete_draft(draft_id: int, db: Session = Depends(get_db)):
    """Delete draft by ID."""
    draft = db.query(DraftState).filter(DraftState.id == draft_id).first()
    if draft:
        db.delete(draft)
        db.commit()
        return {"status": "deleted", "message": "Qoralama o'chirildi"}
    raise HTTPException(status_code=404, detail="Qoralama topilmadi")

def _num(val: Any, default: float = 0.0) -> float:
    try:
        return float(val) if val not in (None, "") else default
    except (TypeError, ValueError):
        return default

def _txt(val: Any) -> str:
    return str(val or "").strip()

def _is_useful(r: Dict[str, Any]) -> bool:
    return bool(_txt(r.get("product_type"))) or _num(r.get("price_buy")) > 0

def _check_rows(rows: List[Dict[str, Any]], header: Dict[str, Any], settings: Dict[str, Any], refs: RefLookup, check_header: bool):
    """Biznes qoidalari bo'yicha tekshiruv. Qaytaradi: (xatolar, ogohlantirishlar, tayyorlangan qatorlar)"""
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    prepared: List[Dict[str, Any]] = []

    def err(row: int, field: str, msg: str):
        errors.append({"row": row, "field": field, "message": f"{row}-qator: {msg}" if row else msg})

    currency = _txt(header.get("currency")) or "UZS"
    rate = _num(header.get("rate"), 0.0)
    if check_header:
        if not _txt(header.get("counterparty_id")):
            err(0, "counterparty", "Yetkazib beruvchi (kontragent) tanlanmagan!")
        if not _txt(header.get("store_id")):
            err(0, "store", "Ombor (склад) tanlanmagan!")
    if currency == "USD":
        if not settings.get("usd_enabled"):
            err(0, "currency", "USD kirim sozlamalarda yoqilmagan.")
        elif rate <= 0:
            err(0, "rate", "USD kursi kiritilmagan!")
    elif currency != "UZS":
        err(0, "currency", f"Valyuta qo'llab-quvvatlanmaydi: {currency}")

    if not rows:
        err(0, "rows", "Jadvalda hech bo'lmaganda 1 ta tovar qatori bo'lishi kerak.")

    seen_variants: Dict[tuple, int] = {}
    for idx, r in enumerate(rows, 1):
        pt = refs.product_type(r.get("product_type"))
        if not _txt(r.get("product_type")):
            err(idx, "product_type", "'Вид товара' tanlanmagan!")
        elif not pt:
            err(idx, "product_type", f"'{_txt(r.get('product_type'))}' ierarxiyada yo'q — Manbalar bo'limiga qo'shing.")
        elif not pt["group_code"]:
            err(idx, "product_type", f"'{pt['name']}' uchun guruh kodi belgilanmagan (Manbalar → Ierarxiya).")

        season_code = refs.season_code(r.get("collection"))
        if not _txt(r.get("collection")):
            err(idx, "collection", "'Коллекция' kiritilmagan!")
        elif not season_code:
            err(idx, "collection", f"'{_txt(r.get('collection'))}' kolleksiyasi spravochnikda yo'q (mavsum kodi topilmadi).")

        qty = _num(r.get("quantity"))
        p_buy = _num(r.get("price_buy"))
        p_sale = _num(r.get("price_sale"))
        if qty <= 0:
            err(idx, "quantity", "Soni 0 dan katta bo'lishi kerak!")
        if p_buy <= 0:
            err(idx, "price_buy", "Sotib olish narxi (Закупочная цена) kiritilmagan!")
        if p_sale <= 0:
            err(idx, "price_sale", "Sotish narxi (Цена продажи) kiritilmagan!")
        elif p_buy > 0 and p_sale < p_buy * (rate if currency == "USD" else 1.0):
            warnings.append({"row": idx, "field": "price_sale", "message": f"{idx}-qator: Sotish narxi tan narxdan kam (zarar)!"})

        color = _txt(r.get("color"))
        color_code = refs.color_code(color)
        if settings.get("color_enabled"):
            if not color:
                err(idx, "color", "Rang tanlanmagan!")
            elif not color_code:
                err(idx, "color", f"'{color}' rangi spravochnikda yo'q yoki uning qisqa kodi (BLK, WHT...) belgilanmagan.")

        size = _txt(r.get("size"))
        if settings.get("size_enabled"):
            if not size:
                err(idx, "size", "Razmer kiritilmagan!")
            elif is_multi_size(size):
                err(idx, "size", f"Bitta qatorda bir nechta razmer ({size}). Ctrl+Enter bilan razmerlarga ajrating.")

        custom_articul = _txt(r.get("articul")) if r.get("custom_articul") else ""
        model_key = _txt(r.get("model_key")) or f"row{idx}"
        variant = ("custom", custom_articul) if custom_articul else (
            model_key,
            color_code if settings.get("color_enabled") else "",
            normalize_size(size) if settings.get("size_enabled") else "",
        )
        if variant in seen_variants:
            err(idx, "articul", f"{seen_variants[variant]}-qator bilan bir xil tovar (model/rang/razmer takrorlangan). Sonini bitta qatorga jamlang.")
        else:
            seen_variants[variant] = idx

        prepared.append({
            "row_index": idx,
            "model_key": model_key,
            "custom_articul": custom_articul,
            "product_type": pt["name"] if pt else _txt(r.get("product_type")),
            "category": pt["category"] if pt else "",
            "group_name": pt["group_name"] if pt else "",
            "group_code": pt["group_code"] if pt else "",
            "season_code": season_code or "",
            "collection": _txt(r.get("collection")),
            "season": _txt(r.get("season")),
            "brand": _txt(r.get("brand")),
            "factory_code": _txt(r.get("factory_code")),
            "description": _txt(r.get("description")),
            "color": color,
            "color_code": color_code or "",
            # Razmer rejimida razmer tovarni ajratadi — MoySklad'ga bir xil ko'rinishda ("m" -> "M")
            "size": normalize_size(size) if settings.get("size_enabled") else size,
            "country": _txt(r.get("country")),
            "quantity": qty,
            "price_buy": p_buy,
            "price_sale": p_sale,
            "ai_generated": bool(r.get("ai_generated")),
            "ai_confidence": _num(r.get("ai_confidence"), 1.0) if r.get("ai_confidence") is not None else None,
        })

    return errors, warnings, prepared

@router.post("/validate")
def validate_rows(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Qatorlarni (va sarlavha yuborilsa — kontragent/ombor/valyutani) tekshiradi"""
    rows = [r for r in data.get("rows", []) if _is_useful(r)]
    header = data.get("header") or {}
    errors, warnings, _ = _check_rows(rows, header, get_app_settings(db), RefLookup(db), check_header=bool(header))
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "total_rows": len(rows),
        "valid_rows": len(rows) - len(set(e["row"] for e in errors if e["row"]))
    }

# Model raqamlari va kodlarni ajratish bir vaqtda faqat bitta so'rovda (ikki omborchi bir xil raqam olmasin)
_allocation_lock = asyncio.Lock()

# MoySklad'da takroriy kod topilsa adminlarga ogohlantirish (6 soatda bir martadan ko'p emas)
DUPLICATE_WARN_INTERVAL = 6 * 3600
_last_duplicate_warning = {"time": 0.0, "codes": ()}

async def _warn_duplicate_codes(duplicates: List[str]):
    now = time.time()
    codes = tuple(duplicates)
    if codes == _last_duplicate_warning["codes"] and now - _last_duplicate_warning["time"] < DUPLICATE_WARN_INTERVAL:
        return
    _last_duplicate_warning.update(time=now, codes=codes)
    logger.warning(f"MoySklad'da takroriy tovar kodlari: {', '.join(codes)}")
    shown = ", ".join(codes[:20]) + (f" ... (+{len(codes) - 20})" if len(codes) > 20 else "")
    await tg_service.send_message(
        f"<b>⚠️ {html.escape(tg_service.settings.company_name)} — KOD NAZORATI</b>\n\n"
        f"MoySklad'da bir xil kodli tovarlar bor: <code>{html.escape(shown)}</code>\n"
        f"Kirim kod bo'yicha ishlaydi — bu kodlarni MoySklad'da tuzating (Товары → Код)."
    )

@router.post("/submit-moysklad")
async def submit_to_moysklad(data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    """
    Tekshiradi → model raqamlarini doimiy ajratadi → MoySklad'da tovar (bulk) va Приемка yaratadi → Telegram.
    Xato bo'lsa qoralama saqlanib qoladi; qayta yuborilganda aynan shu artikullar ishlatiladi.
    """
    header = data.get("header", {})
    rows = [r for r in data.get("rows", []) if _is_useful(r)]
    settings = get_app_settings(db)
    refs = RefLookup(db)

    errors, _, prepared = _check_rows(rows, header, settings, refs, check_header=True)
    if errors:
        raise HTTPException(status_code=400, detail={"message": "Hujjatda xatoliklar mavjud!", "errors": errors})

    # Hujjat raqami: standart — faqat yuborish lahzasida MoySklad'dagi oxirgi raqamdan keyin beriladi (auto).
    # Qo'lda raqam faqat foydalanuvchi ataylab yozganda (header.manual_number=true).
    manual_number = bool(header.get("manual_number")) and bool(_txt(header.get("doc_number")))
    doc_number = _txt(header.get("doc_number")) if manual_number else ""
    currency = _txt(header.get("currency")) or "UZS"
    rate = _num(header.get("rate"), 1.0) if currency == "USD" else 1.0
    if header.get("draft_id"):
        scope = f"draft{header.get('draft_id')}"
    elif manual_number:
        scope = f"doc{doc_number}"
    else:
        scope = f"adhoc{int(time.time())}"

    # 1. Model raqamlari: MoySklad'dagi eng katta raqamdan keyin, qoralama bo'yicha doimiy
    try:
        # Raqam ajratishdan oldin — allaqachon yuborilgan hujjat qayta yuborilsa raqamlar behuda sarflanmasin
        if manual_number and await ms_service.supply_exists(doc_number):
            raise HTTPException(status_code=409, detail=f"MoySklad'da №{doc_number} raqamli Приемка allaqachon mavjud. Hujjat raqamini o'zgartiring.")
        ms_max = await ms_service.get_max_model_number()
        code_stats = await ms_service.get_code_stats()
        # Доп. поля: ilova maydonlari -> MoySklad atributlari (sozlamadan); tashqi o'zgarish bo'lsa xabar
        ms_attributes = await attributes_service.list_attributes()
    except MoySkladError as e:
        raise HTTPException(status_code=502, detail=f"MoySklad'dan ma'lumot olib bo'lmadi: {e}")
    await notify_if_changed(db, ms_attributes, "kirim yuborishda aniqlandi")
    ms_service.attribute_map = get_attribute_map(db, ms_attributes)
    attr_problems = mapping_problems(ms_service.attribute_map, ms_attributes)
    if settings.get("size_enabled") and not ms_service.attribute_map.get("size", {}).get("enabled"):
        attr_problems.append("Razmer rejimi yoqilgan, lekin 'Размер' maydoni MoySklad atributiga bog'lanmagan — razmerlar farqlanmaydi")
    if attr_problems:
        raise HTTPException(status_code=400, detail={"message": "MoySklad доп. поля sozlamasida muammo:", "errors": [{"row": 0, "field": "attributes", "message": m} for m in attr_problems]})
    if code_stats["duplicates"]:
        await _warn_duplicate_codes(code_stats["duplicates"])
    async with _allocation_lock:
        sync_counter(db, ms_max)
        numbers = allocate_model_numbers(db, scope, [p["model_key"] for p in prepared if not p["custom_articul"]])

    items = []
    seen_products: Dict[tuple, int] = {}
    size_in_name = settings.get("size_enabled") and settings.get("size_in_name")
    for p in prepared:
        if p["custom_articul"]:
            model_code = ""
            articul = p["custom_articul"]
        else:
            model_code = build_model_code(p["season_code"], p["group_code"], numbers[p["model_key"]])
            articul = build_articul(model_code, p["color_code"], settings)
        key = product_key(articul, p["size"], settings)
        if key in seen_products:
            label = f"{articul} ({p['size']})" if key[1] else articul
            raise HTTPException(status_code=400, detail={"message": "Hujjatda xatoliklar mavjud!", "errors": [{
                "row": p["row_index"], "field": "articul",
                "message": f"{p['row_index']}-qator: {label} tovari {seen_products[key]}-qatorda ham bor."}]})
        seen_products[key] = p["row_index"]
        money = calc_money(p["quantity"], p["price_buy"], p["price_sale"], rate)
        items.append({
            **{k: v for k, v in p.items() if k not in ("model_key", "custom_articul", "color_code", "group_code", "season_code")},
            "model_code": model_code,
            "articul": articul,
            "product_key": key,
            "full_name": build_full_name(p["product_type"], p["description"], p["brand"], p["factory_code"],
                                         p["size"] if size_in_name else ""),
            **money,
        })

    # Tovar kodlari: MoySklad'dagi eng katta koddan keyin, ketma-ket, tovarga (artikul+razmer) doimiy bog'langan
    async with _allocation_lock:
        sync_counter(db, code_stats["max"], CODE_COUNTER)
        codes = allocate_codes(db, scope, [it["product_key"] for it in items])
    for it in items:
        it["code"] = codes[it["product_key"]]

    total_sum_buy = round(sum(it["sum_buy"] for it in items), 2)
    total_sum_sale = round(sum(it["sum_sale"] for it in items), 2)
    total_qty = sum(it["quantity"] for it in items)

    # 2. Hujjat raqami — auto rejimda MoySklad o'zi beradi (name yuborilmaydi), javobdan o'qiladi.
    #    Qo'lda rejimda foydalanuvchi yozgan raqam ishlatiladi.
    if not manual_number:
        doc_number = ""

    # 3. Hujjat yozuvi (tarix uchun)
    new_doc = PrixodDocument(
        doc_number=doc_number,
        counterparty_name=_txt(header.get("counterparty_name")),
        counterparty_id=_txt(header.get("counterparty_id")),
        store_name=_txt(header.get("store_name")),
        store_id=_txt(header.get("store_id")),
        currency=currency,
        total_sum_buy=total_sum_buy,
        total_sum_sale=total_sum_sale,
        total_qty=total_qty,
        total_items=len(items),
        status="sending",
        notes=header.get("notes"),
    )
    db.add(new_doc)
    db.flush()
    item_columns = {c.name for c in PrixodItem.__table__.columns}
    for it in items:
        db.add(PrixodItem(document_id=new_doc.id, **{k: v for k, v in it.items() if k in item_columns}))
    db.commit()

    # 3. MoySklad
    ms_result = await ms_service.create_supply_document(
        match_size=bool(settings.get("size_enabled")),
        organization_id=header.get("organization_id"),
        counterparty_id=_txt(header.get("counterparty_id")),
        store_id=_txt(header.get("store_id")),
        items=items,
        doc_number=doc_number,
        notes=header.get("notes"),
        doc_date=_txt(header.get("doc_date")) or _txt(header.get("date")),
        currency=currency,
        rate=rate,
    )

    user = getattr(request.state, "user", {}) or {}
    if ms_result.get("status") != "success":
        error_msg = ms_result.get("message", "Noma'lum xatolik")
        new_doc.status = "error"
        new_doc.error_message = error_msg
        db.commit()
        await tg_service.notify_prixod_error(doc_number or "avto", error_msg, user=user.get("name"))
        raise HTTPException(status_code=502, detail=f"MoySklad'ga yuborishda xatolik: {error_msg}")

    new_doc.status = "sent"
    new_doc.moysklad_document_id = ms_result.get("document_id")
    new_doc.moysklad_document_name = ms_result.get("document_name")
    if not doc_number and ms_result.get("document_name"):
        doc_number = str(ms_result.get("document_name"))
        new_doc.doc_number = doc_number
    db.commit()

    # Qoralamani o'chiramiz (ajratilgan model raqamlari tarix uchun qoladi)
    draft = None
    if header.get("draft_id"):
        draft = db.query(DraftState).filter(DraftState.id == int(header["draft_id"])).first()
    if not draft and doc_number:
        draft = db.query(DraftState).filter(DraftState.doc_number == doc_number).first()
    if draft:
        db.delete(draft)
    # Raqamlar MoySklad artikullarida saqlandi; ajratmalarni o'chiramiz — SQLite qoralama ID sini qayta bersa ham eski raqamlar qaytmasin
    db.query(ModelAllocation).filter(ModelAllocation.alloc_key.like(f"{scope}:%")).delete(synchronize_session=False)
    db.commit()

    await tg_service.notify_prixod_created(
        doc_number=ms_result.get("document_name") or doc_number,
        counterparty=_txt(header.get("counterparty_name")),
        store=_txt(header.get("store_name")),
        total_items=len(items),
        total_qty=total_qty,
        total_sum_buy=total_sum_buy,
        total_sum_sale=total_sum_sale,
        currency=currency,
        moysklad_url=ms_result.get("moysklad_url"),
        user=user.get("name"),
    )

    return {
        "status": "success",
        "message": "Приемка (Kirim) MoySklad'da muvaffaqiyatli yaratildi!",
        "document_id": new_doc.id,
        "moysklad_document_id": ms_result.get("document_id"),
        "moysklad_document_name": ms_result.get("document_name"),
        "doc_number": doc_number,
        "auto_number": not manual_number,
        "moysklad_url": ms_result.get("moysklad_url"),
        "total_items": len(items),
        "total_sum_buy": total_sum_buy,
        "total_sum_sale": total_sum_sale,
        "articuls": [{"row": it["row_index"], "model": it["model_code"], "articul": it["articul"], "size": it["size"], "code": it["code"]} for it in items],
    }

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
