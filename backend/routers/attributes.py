"""Sozlamalar → MoySklad доп. поля: ko'rish, yaratish, o'zgartirish, o'chirish, ilova maydonlariga bog'lash"""
import html
from typing import Any, Dict, List
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

@router.get("/required-fields")
async def required_fields(db: Session = Depends(get_db)):
    """Qatorda bo'sh bo'lmasligi kerak bo'lgan ilova maydonlari (MoySklad'da majburiy atributga bog'langan)"""
    from backend.services.attributes_service import required_app_fields
    try:
        attributes = await svc.list_attributes()
    except MoySkladError:
        return {"fields": []}
    return {"fields": required_app_fields(get_attribute_map(db, attributes), attributes)}


_DICT_CACHE: Dict[str, Any] = {}


@router.get("/dict-values/{field}")
async def dict_values(field: str, db: Session = Depends(get_db)):
    """Ilova maydoniga bog'langan MoySklad lug'atining qiymatlari (jadvaldagi ro'yxat uchun), 10 daqiqa kesh"""
    import time as _t
    cached = _DICT_CACHE.get(field)
    if cached and _t.time() - cached["ts"] < 600:
        return {"field": field, "values": cached["values"]}
    try:
        attributes = await svc.list_attributes()
    except MoySkladError:
        return {"field": field, "values": []}
    mapping = get_attribute_map(db, attributes)
    entry = mapping.get(field) or {}
    attr = next((a for a in attributes if a["id"] == entry.get("attr_id")), None) if entry.get("attr_id") else None
    dict_id = (attr or {}).get("dictionary_id")
    values: List[str] = []
    if dict_id:
        offset = 0
        while True:
            data = await svc.ms._call("GET", f"entity/customentity/{dict_id}", params={"limit": 1000, "offset": offset})
            rows = data.get("rows", [])
            values += [r.get("name") for r in rows if r.get("name")]
            if len(rows) < 1000:
                break
            offset += 1000
    def _k(v):
        try:
            return (0, float(str(v).replace(",", ".")), "")
        except ValueError:
            return (1, 0, str(v).lower())
    values = sorted(set(values), key=_k)
    _DICT_CACHE[field] = {"ts": _t.time(), "values": values}
    return {"field": field, "values": values}


@router.put("/map")
async def update_map(data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    require_admin(request)
    try:
        attributes = await svc.list_attributes()
        mapping = save_attribute_map(db, data.get("mapping") or {}, attributes)
        _DICT_CACHE.clear()
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
