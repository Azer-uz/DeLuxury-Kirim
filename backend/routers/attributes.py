"""Sozlamalar → MoySklad доп. поля: ko'rish, yaratish, o'zgartirish, o'chirish, ilova maydonlariga bog'lash"""
import html
from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.routers.auth import require_admin
from backend.services.attributes_service import (
    APP_FIELDS, ATTRIBUTE_TYPES, AttributesService, diff_snapshot, format_diff,
    get_attribute_map, mapping_problems, save_attribute_map
)
from backend.services.moysklad_service import MoySkladService, MoySkladError
from backend.services.telegram_service import tg_service

router = APIRouter(prefix="/api/attributes", tags=["MoySklad доп. поля"])
ms_service = MoySkladService()
svc = AttributesService(ms_service)

async def notify_if_changed(db: Session, attributes, source: str):
    """MoySklad'da maydonlar tashqaridan o'zgargan bo'lsa — adminlarga Telegram"""
    diff = diff_snapshot(db, attributes)
    if diff["first_time"] or not (diff["added"] or diff["removed"] or diff["changed"]):
        return diff
    await tg_service.send_message(
        f"<b>🧩 {html.escape(tg_service.settings.company_name)} — MOYSKLAD ДОП. ПОЛЯ O'ZGARDI</b>\n"
        f"<i>({source})</i>\n\n{html.escape(format_diff(diff))}\n\n"
        f"Ilova maydonlari bog'lanishini Sozlamalar → Доп. поля bo'limida tekshiring."
    )
    return diff

async def overview(db: Session) -> Dict[str, Any]:
    try:
        attributes = await svc.list_attributes()
        dictionaries = await svc.list_dictionaries()
    except MoySkladError as e:
        raise HTTPException(status_code=502, detail=f"MoySklad'dan maydonlar olinmadi: {e}")
    diff = await notify_if_changed(db, attributes, "sozlamalar ochilganda aniqlandi")
    mapping = get_attribute_map(db, attributes)
    return {
        "attributes": attributes,
        "dictionaries": dictionaries,
        "app_fields": APP_FIELDS,
        "types": ATTRIBUTE_TYPES,
        "mapping": mapping,
        "problems": mapping_problems(mapping, attributes),
        "changes": None if diff["first_time"] else {k: diff[k] for k in ("added", "removed", "changed")},
    }

@router.get("")
async def get_overview(db: Session = Depends(get_db)):
    return await overview(db)

@router.post("")
async def create(data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    require_admin(request)
    try:
        attr = await svc.create_attribute(
            name=data.get("name", ""), attr_type=data.get("type", "string"), required=bool(data.get("required")),
            dictionary_id=data.get("dictionary_id"), new_dictionary_name=data.get("new_dictionary_name"),
        )
    except MoySkladError as e:
        raise HTTPException(status_code=400, detail=str(e))
    diff_snapshot(db, await svc.list_attributes())  # o'zimiz qo'shganimiz "tashqi o'zgarish" deb xabar bermasin
    return {"status": "created", "attribute": attr, **(await overview(db))}

@router.put("/map")
async def update_map(data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    require_admin(request)
    try:
        attributes = await svc.list_attributes()
        mapping = save_attribute_map(db, data.get("mapping") or {}, attributes)
    except MoySkladError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "saved", "mapping": mapping, "problems": mapping_problems(mapping, attributes)}

@router.put("/{attr_id}")
async def update(attr_id: str, data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    require_admin(request)
    try:
        attr = await svc.update_attribute(attr_id, name=data.get("name"), required=data.get("required"))
    except MoySkladError as e:
        raise HTTPException(status_code=400, detail=str(e))
    diff_snapshot(db, await svc.list_attributes())
    return {"status": "updated", "attribute": attr}

@router.delete("/{attr_id}")
async def delete(attr_id: str, request: Request, db: Session = Depends(get_db)):
    require_admin(request)
    attributes = await svc.list_attributes()
    mapping = get_attribute_map(db, attributes)
    used_by = [f["label"] for f in APP_FIELDS if mapping.get(f["key"], {}).get("attr_id") == attr_id and mapping[f["key"]]["enabled"]]
    if used_by and not request.query_params.get("force"):
        raise HTTPException(status_code=409, detail=f"Bu maydon ilovada ishlatilmoqda: {', '.join(used_by)}. Avval bog'lanishni o'chiring.")
    try:
        await svc.delete_attribute(attr_id)
    except MoySkladError as e:
        raise HTTPException(status_code=400, detail=str(e))
    diff_snapshot(db, await svc.list_attributes())
    return {"status": "deleted"}
