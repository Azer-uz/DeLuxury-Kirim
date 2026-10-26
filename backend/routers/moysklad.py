from fastapi import APIRouter, Depends
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.services.moysklad_service import MoySkladService, MoySkladError

router = APIRouter(prefix="/api/moysklad", tags=["MoySklad Integration"])
ms_service = MoySkladService()

@router.get("/status")
async def check_status():
    """Check connection to MoySklad API."""
    return await ms_service.test_connection()

@router.get("/stores")
async def get_stores():
    """Get list of warehouses/stores from MoySklad."""
    stores = await ms_service.get_stores()
    return [
        {
            "id": s.get("id"),
            "name": s.get("name"),
            "address": s.get("address", ""),
            "archived": s.get("archived", False)
        }
        for s in stores if not s.get("archived")
    ]

@router.get("/counterparties")
async def get_counterparties():
    """Get list of suppliers/counterparties from MoySklad."""
    counterparties = await ms_service.get_counterparties()
    return [
        {
            "id": c.get("id"),
            "name": c.get("name"),
            "phone": c.get("phone", ""),
            "email": c.get("email", "")
        }
        for c in counterparties if not c.get("archived")
    ]

@router.post("/counterparties")
async def create_counterparty_endpoint(data: Dict[str, Any]):
    """Create a new supplier/counterparty in MoySklad."""
    name = (data.get("name") or "").strip()
    if not name:
        return {"status": "error", "message": "Kontragent nomi bo'sh bo'lishi mumkin emas"}
    phone = data.get("phone")
    desc = data.get("description")
    tag = data.get("tag") or data.get("group")
    return await ms_service.create_counterparty(name=name, phone=phone, description=desc, tag=tag)

_SEARCH_ATTR_CACHE: Dict[str, Any] = {}


@router.get("/products/search")
async def search_products(q: str = "", limit: int = 40, db: Session = Depends(get_db)):
    """Bazadan (MoySklad) tovar qidirish: nomi / artikul / kod bo'yicha. Takroriy tovar kirimida mavjud tovarni tanlash uchun."""
    q = (q or "").strip()
    if len(q) < 2:
        return {"items": [], "query": q}
    from backend.services.attributes_service import AttributesService, get_attribute_map
    import time as _t
    cached = _SEARCH_ATTR_CACHE.get("data")
    if cached and _t.time() - _SEARCH_ATTR_CACHE.get("ts", 0) < 120:
        attributes, mapping = cached
    else:
        try:
            attributes = await AttributesService(ms_service).list_attributes()
            mapping = get_attribute_map(db, attributes)
            _SEARCH_ATTR_CACHE.update({"data": (attributes, mapping), "ts": _t.time()})
        except MoySkladError:
            attributes, mapping = [], {}
    field_of = {v.get("attr_id"): k for k, v in mapping.items() if v.get("attr_id")}
    # So'zlarga bo'lamiz: "bv-745" -> ["bv", "745"] — MoySklad'da "BV 745" deb yozilgan bo'lsa ham topiladi
    import re as _re, asyncio as _aio
    toks = [t for t in _re.split(r"[\s\-_/,.;:]+", q) if t]
    compact = _re.sub(r"[\s\-_]+", "", q)
    lim = min(max(limit, 1), 100)
    queries = [{"search": q, "limit": lim}, {"filter": f"name~{q}", "limit": lim}]  # MoySklad 'search' noaniq — nom bo'yicha aniq qidiruv ham
    if len(toks) > 1:
        queries.append({"filter": ";".join(f"name~{t}" for t in toks), "limit": lim})
        queries.append({"search": " ".join(toks), "limit": lim})
    for val in {q, compact, " ".join(toks)}:
        queries.append({"filter": f"article~{val}", "limit": lim})
        queries.append({"filter": f"code~{val}", "limit": lim})
    # Код модели (zavod artikuli) atributi bo'yicha aniq moslik
    fc_attr = (mapping.get("factory_code") or {}).get("attr_id")
    if fc_attr:
        href = f"https://api.moysklad.ru/api/remap/1.2/entity/product/metadata/attributes/{fc_attr}"
        for val in {q, compact, " ".join(toks), "-".join(toks), q.upper(), " ".join(toks).upper(), "-".join(toks).upper()}:
            queries.append({"filter": f"{href}={val}", "limit": lim})

    async def _one(params):
        try:
            return await ms_service._call("GET", "entity/assortment", params=params)
        except MoySkladError:
            return {}
    results = await _aio.gather(*[_one(p) for p in queries])
    seen = set(); rows = []
    for data in results:
        for p in (data.get("rows", []) if isinstance(data, dict) else []):
            if p.get("id") in seen:
                continue
            seen.add(p.get("id")); rows.append(p)

    def _norm(s: str) -> str:
        return _re.sub(r"[\s\-_/.,]+", "", (s or "").lower())
    ntoks = [_norm(t) for t in toks]
    items = []
    for p in rows:
        if (p.get("meta") or {}).get("type") != "product" or p.get("archived"):
            continue
        fields: Dict[str, str] = {}
        for a in p.get("attributes", []) or []:
            key = field_of.get(a.get("id"))
            if not key:
                continue
            v = a.get("value")
            fields[key] = (v.get("name") if isinstance(v, dict) else ("" if v is None else str(v))) or ""
        sale = 0.0
        for sp in p.get("salePrices", []) or []:
            if sp.get("value"):
                sale = sp["value"] / 100.0
                break
        hay = _norm(" ".join([p.get("name") or "", p.get("article") or "", p.get("code") or ""] + list(fields.values())))
        hay_name = _norm(p.get("name") or "")
        hits = sum(1 for t in ntoks if t and t in hay)
        score = hits * 10 + (5 if ntoks and all(t in hay_name for t in ntoks) else 0) + (3 if compact and compact.lower() in hay else 0)
        items.append({
            "id": p.get("id"),
            "name": p.get("name") or "",
            "article": p.get("article") or "",
            "code": p.get("code") or "",
            "price_buy": ((p.get("buyPrice") or {}).get("value") or 0) / 100.0,
            "price_sale": sale,
            "stock": p.get("stock"),
            "quantity": p.get("quantity"),
            "fields": fields,
            "path": p.get("pathName") or "",
            "_hits": hits, "_score": score,
        })
    full = [it for it in items if ntoks and it["_hits"] == len(ntoks)]
    chosen = full if full else [it for it in items if it["_hits"] > 0] or items
    chosen.sort(key=lambda it: (-it["_score"], it["name"].lower()))
    for it in chosen:
        it.pop("_hits", None); it.pop("_score", None)
    return {"items": chosen[:lim], "query": q, "total": len(chosen), "exact": bool(full)}


@router.get("/next-doc-number")
async def get_next_doc_number_endpoint():
    """Get the next 5-digit document number matching MoySklad sequence (e.g. 00035)."""
    next_num = await ms_service.get_next_supply_number()
    if not next_num:
        return {"next_number": None, "error": "MoySklad'dan raqam olinmadi — token yoki tarmoqni tekshiring (Sozlamalar → API)"}
    return {"next_number": next_num}

@router.get("/currency-rate")
async def get_currency_rate(iso: str = "USD"):
    """MoySklad'dagi valyuta kursi (Справочники → Валюты) — kirim sarlavhasida standart kurs sifatida"""
    cur = await ms_service.get_currency(iso.upper())
    return {"iso": iso.upper(), "rate": cur.get("rate") if cur else None}

@router.get("/organizations")
async def get_organizations():
    """Get list of legal entities/organizations from MoySklad."""
    orgs = await ms_service.get_organizations()
    return [
        {
            "id": o.get("id"),
            "name": o.get("name")
        }
        for o in orgs if not o.get("archived")
    ]
