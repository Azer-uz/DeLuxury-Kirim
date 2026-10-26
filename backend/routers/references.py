import csv
import io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
import re
from typing import Dict, Any, List
from backend.database import get_db
from backend.models import (
    ProductType, Category, Group, Season, Brand, Color, Country, SeasonType, SizeItem
)
from backend.services.moysklad_service import MoySkladService
from backend.routers.auth import require_admin

router = APIRouter(prefix="/api/references", tags=["References & Catalog"])
moysklad_service = MoySkladService()

@router.get("/all")
def get_all_references(db: Session = Depends(get_db)):
    """Fetch all reference dictionaries for the grid and catalog management."""
    groups = db.query(Group).order_by(Group.name).all()
    seasons = db.query(Season).order_by(Season.collection).all()
    season_types = db.query(SeasonType).order_by(SeasonType.name).all()
    size_items = db.query(SizeItem).order_by(SizeItem.sort_order, SizeItem.id).all()
    categories = db.query(Category).order_by(Category.name).all()
    product_types = db.query(ProductType).order_by(ProductType.name).all()
    brands = db.query(Brand).order_by(Brand.name).all()
    colors = db.query(Color).order_by(Color.code_no, Color.name).all()
    countries = db.query(Country).order_by(Country.name).all()

    # Build mapping dictionary for fast frontend lookup
    pt_map = {}
    for pt in product_types:
        pt_map[pt.name] = {
            "id": pt.id,
            "category": pt.category.name if pt.category else "",
            "group": pt.group.name if pt.group else "",
            "group_code": pt.group.code if pt.group else "UND",
            "status": pt.status
        }

    season_map = {s.collection: s.code for s in seasons}

    return {
        "groups": [{"id": g.id, "name": g.name, "code": g.code, "status": g.status} for g in groups],
        "seasons": [{"id": s.id, "collection": s.collection, "code": s.code, "status": s.status} for s in seasons],
        "season_types": [{"id": st.id, "name": st.name, "status": st.status} for st in season_types],
        "sizes": [{"id": sz.id, "name": sz.name, "status": sz.status} for sz in size_items],
        "categories": [{"id": c.id, "name": c.name, "status": c.status} for c in categories],
        "product_types": [
            {
                "id": pt.id,
                "name": pt.name,
                "category": pt.category.name if pt.category else "",
                "group": pt.group.name if pt.group else "",
                "group_code": pt.group.code if pt.group else "UND",
                "status": pt.status
            }
            for pt in product_types
        ],
        "brands": [{"id": b.id, "name": b.name, "status": b.status} for b in brands],
        "colors": [
            {
                "id": c.id, 
                "name": c.name, 
                "code_no": c.code_no, 
                "short_code": (c.short_code or "").upper(),
                "name_ru": c.name_ru or "",
                "name_tr": c.name_tr or "",
                "name_en": c.name_en or "",
                "is_favorite": bool(c.is_favorite), 
                "rgb": c.rgb, 
                "status": c.status
            } 
            for c in colors
        ],
        "countries": [{"id": cnt.id, "name": cnt.name, "status": cnt.status} for cnt in countries],
        "product_type_map": pt_map,
        "season_map": season_map
    }

# ================= PRODUCT TYPE (IERARXIYA) CRUD =================
@router.post("/product-type")
def add_or_update_product_type(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Add or update a product type with category and group."""
    pt_id = data.get("id")
    name = (data.get("name") or "").strip()
    category_name = (data.get("category") or "").strip()
    group_name = (data.get("group") or "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="Mahsulot turi nomi kiritilishi shart")

    # Category
    cat_obj = None
    if category_name:
        cat_obj = db.query(Category).filter(Category.name.ilike(category_name)).first()
        if not cat_obj:
            cat_obj = Category(name=category_name, status="local_only")
            db.add(cat_obj)
            db.flush()

    # Group
    group_obj = None
    if group_name:
        group_obj = db.query(Group).filter(Group.name.ilike(group_name)).first()

    existing = None
    if pt_id:
        existing = db.query(ProductType).filter(ProductType.id == pt_id).first()
    if not existing:
        existing = db.query(ProductType).filter(ProductType.name.ilike(name)).first()

    if existing:
        existing.name = name
        existing.category_id = cat_obj.id if cat_obj else None
        existing.group_id = group_obj.id if group_obj else None
        db.commit()
        return {"status": "updated", "id": existing.id, "name": existing.name}
    else:
        new_pt = ProductType(
            name=name,
            category_id=cat_obj.id if cat_obj else None,
            group_id=group_obj.id if group_obj else None,
            status="local_only"
        )
        db.add(new_pt)
        db.commit()
        db.refresh(new_pt)
        return {"status": "created", "id": new_pt.id, "name": new_pt.name}

@router.delete("/product-type/{pt_id}")
def delete_product_type(pt_id: int, db: Session = Depends(get_db)):
    """Delete a product type from hierarchy."""
    pt = db.query(ProductType).filter(ProductType.id == pt_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="Mahsulot turi topilmadi")
    db.delete(pt)
    db.commit()
    return {"status": "deleted", "id": pt_id}

# ================= EXCEL/CSV IMPORT & EXPORT FOR IERARXIYA =================
@router.post("/import-hierarchy-csv")
async def import_hierarchy_csv(
    request: Request,
    file: UploadFile = File(...),
    mode: str = "merge",
    db: Session = Depends(get_db)
):
    """Import or bulk update Product types hierarchy from CSV/Excel. mode='merge' or 'replace'."""
    if mode == "replace":
        require_admin(request)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Fayl bo'sh")

    rows_data = []
    is_xlsx = (file.filename and file.filename.endswith(".xlsx")) or contents[:4] == b"PK\x03\x04"
    if is_xlsx:
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
            sheet = wb.active
            all_excel_rows = list(sheet.iter_rows(values_only=True))
            if not all_excel_rows:
                raise HTTPException(status_code=400, detail="Excel fayli bo'sh")
            header = [str(c or "").strip() for c in all_excel_rows[0]]
            for r in all_excel_rows[1:]:
                rows_data.append([str(c or "").strip() for c in r])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Excel faylini o'qishda xatolik: {e}")
    else:
        try:
            decoded = contents.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                decoded = contents.decode("cp1251")
            except Exception:
                decoded = contents.decode("latin1")

        reader = csv.reader(io.StringIO(decoded), delimiter=';' if ';' in decoded[:200] else ',')
        header = next(reader, None)
        if not header:
            raise HTTPException(status_code=400, detail="CSV fayl sarlavhasi topilmadi")
        rows_data = [r for r in reader]

    # Normalize header indices
    header_clean = [h.strip().lower() for h in header]
    vid_idx = next((i for i, h in enumerate(header_clean) if "вид" in h or "nomi" in h or "tovar" in h), 0)
    kat_idx = next((i for i, h in enumerate(header_clean) if "категор" in h or "kategoriya" in h), 1)
    gur_idx = next((i for i, h in enumerate(header_clean) if "групп" in h or "guruh" in h), 2)

    groups_map = {g.name.strip().lower(): g for g in db.query(Group).all()}
    categories_map = {c.name.strip().lower(): c for c in db.query(Category).all()}

    # "replace" — eski ierarxiya faqat fayl muvaffaqiyatli o'qilgandan keyin, bitta tranzaksiyada o'chiriladi
    if mode == "replace":
        if not any(len(r) > vid_idx and (r[vid_idx] or "").strip() for r in rows_data):
            raise HTTPException(status_code=400, detail="Faylda birorta ham 'Вид товара' qatori topilmadi — ierarxiya o'zgartirilmadi.")
        db.query(ProductType).delete()
        db.flush()

    imported_count = 0
    updated_count = 0

    for row in rows_data:
        if not row or len(row) <= vid_idx:
            continue
        vid_name = (row[vid_idx] or "").strip()
        if not vid_name:
            continue

        kat_name = (row[kat_idx] if len(row) > kat_idx else "").strip()
        gur_name = (row[gur_idx] if len(row) > gur_idx else "").strip()

        # Category
        cat_obj = None
        if kat_name:
            kat_key = kat_name.lower()
            if kat_key not in categories_map:
                cat_obj = Category(name=kat_name, status="local_only")
                db.add(cat_obj)
                db.flush()
                categories_map[kat_key] = cat_obj
            else:
                cat_obj = categories_map[kat_key]

        # Group
        group_obj = groups_map.get(gur_name.lower()) if gur_name else None

        # Existing ProductType
        existing_pt = db.query(ProductType).filter(ProductType.name.ilike(vid_name)).first()
        if existing_pt:
            existing_pt.category_id = cat_obj.id if cat_obj else None
            existing_pt.group_id = group_obj.id if group_obj else None
            updated_count += 1
        else:
            new_pt = ProductType(
                name=vid_name,
                category_id=cat_obj.id if cat_obj else None,
                group_id=group_obj.id if group_obj else None,
                status="local_only"
            )
            db.add(new_pt)
            imported_count += 1

    db.commit()
    return {
        "status": "success",
        "imported_new": imported_count,
        "updated": updated_count,
        "total": imported_count + updated_count
    }

@router.get("/export-hierarchy-csv")
def export_hierarchy_csv(db: Session = Depends(get_db)):
    """Download current hierarchy as CSV."""
    pts = db.query(ProductType).order_by(ProductType.name).all()
    output = io.StringIO()
    output.write("\uFEFF")  # UTF-8 BOM
    writer = csv.writer(output, delimiter=';')
    writer.writerow(["Вид товара", "Категория", "Группа", "Код группы"])
    for pt in pts:
        writer.writerow([
            pt.name,
            pt.category.name if pt.category else "",
            pt.group.name if pt.group else "",
            pt.group.code if pt.group else ""
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=DeLuxury_Ierarxiya.csv"}
    )

# ================= SEZONLAR & RAZMERLAR CRUD =================
@router.post("/season-type")
def add_season_type(data: Dict[str, str], db: Session = Depends(get_db)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Sezon nomi kiritilmadi")
    existing = db.query(SeasonType).filter(SeasonType.name.ilike(name)).first()
    if existing:
        return {"status": "exists", "id": existing.id}
    st = SeasonType(name=name, status="local_only")
    db.add(st)
    db.commit()
    return {"status": "created", "id": st.id, "name": st.name}

@router.delete("/season-type/{st_id}")
def delete_season_type(st_id: int, db: Session = Depends(get_db)):
    st = db.query(SeasonType).filter(SeasonType.id == st_id).first()
    if st:
        db.delete(st)
        db.commit()
    return {"status": "deleted"}

@router.post("/size-item")
def add_size_item(data: Dict[str, str], db: Session = Depends(get_db)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Razmer nomi kiritilmadi")
    existing = db.query(SizeItem).filter(SizeItem.name.ilike(name)).first()
    if existing:
        return {"status": "exists", "id": existing.id}
    sz = SizeItem(name=name, status="local_only")
    db.add(sz)
    db.commit()
    return {"status": "created", "id": sz.id, "name": sz.name}

@router.delete("/size-item/{sz_id}")
def delete_size_item(sz_id: int, db: Session = Depends(get_db)):
    sz = db.query(SizeItem).filter(SizeItem.id == sz_id).first()
    if sz:
        db.delete(sz)
        db.commit()
    return {"status": "deleted"}

# ================= TAHRIRLASH / O'CHIRISH (Manbalar) =================
def _clean(v) -> str:
    return (v or "").strip()


@router.put("/group/{g_id}")
def update_group(g_id: int, data: Dict[str, Any], db: Session = Depends(get_db)):
    g = db.query(Group).filter(Group.id == g_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Guruh topilmadi")
    name, code = _clean(data.get("name")), _clean(data.get("code")).upper()
    if name:
        dup = db.query(Group).filter(Group.name.ilike(name), Group.id != g_id).first()
        if dup:
            raise HTTPException(status_code=400, detail=f"'{name}' nomli guruh allaqachon bor")
        g.name = name
    if code:
        if not re.fullmatch(r"[A-Z0-9]{2,5}", code):
            raise HTTPException(status_code=400, detail="Guruh kodi 2-5 ta lotin harf/raqam bo'lsin (masalan TOP)")
        dup = db.query(Group).filter(Group.code == code, Group.id != g_id).first()
        if dup:
            raise HTTPException(status_code=400, detail=f"'{code}' kodi '{dup.name}' guruhida ishlatilgan")
        g.code = code
    db.commit()
    return {"status": "updated", "group": {"id": g.id, "name": g.name, "code": g.code}}


@router.delete("/group/{g_id}")
def delete_group(g_id: int, db: Session = Depends(get_db)):
    g = db.query(Group).filter(Group.id == g_id).first()
    if not g:
        return {"status": "deleted"}
    used = db.query(ProductType).filter(ProductType.group_id == g_id).count()
    if used:
        raise HTTPException(status_code=400, detail=f"Bu guruhga {used} ta mahsulot turi bog'langan. Avval ularni boshqa guruhga o'tkazing")
    db.delete(g); db.commit()
    return {"status": "deleted"}


@router.put("/season/{s_id}")
def update_season(s_id: int, data: Dict[str, Any], db: Session = Depends(get_db)):
    s = db.query(Season).filter(Season.id == s_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Kolleksiya topilmadi")
    col, code = _clean(data.get("collection")), _clean(data.get("code")).upper()
    if col:
        dup = db.query(Season).filter(Season.collection.ilike(col), Season.id != s_id).first()
        if dup:
            raise HTTPException(status_code=400, detail=f"'{col}' kolleksiyasi allaqachon bor")
        s.collection = col
    if code:
        s.code = code
    db.commit()
    return {"status": "updated", "season": {"id": s.id, "collection": s.collection, "code": s.code}}


@router.delete("/season/{s_id}")
def delete_season(s_id: int, db: Session = Depends(get_db)):
    s = db.query(Season).filter(Season.id == s_id).first()
    if s:
        db.delete(s); db.commit()
    return {"status": "deleted"}


def _rename_simple(db: Session, model, obj_id: int, data: Dict[str, Any], label: str):
    obj = db.query(model).filter(model.id == obj_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{label} topilmadi")
    name = _clean(data.get("name"))
    if not name:
        raise HTTPException(status_code=400, detail=f"{label} nomi bo'sh bo'lmasin")
    dup = db.query(model).filter(model.name.ilike(name), model.id != obj_id).first()
    if dup:
        raise HTTPException(status_code=400, detail=f"'{name}' allaqachon mavjud")
    obj.name = name
    db.commit()
    return {"status": "updated", "id": obj.id, "name": obj.name}


@router.put("/season-type/{st_id}")
def update_season_type(st_id: int, data: Dict[str, Any], db: Session = Depends(get_db)):
    return _rename_simple(db, SeasonType, st_id, data, "Sezon")


@router.put("/size-item/{sz_id}")
def update_size_item(sz_id: int, data: Dict[str, Any], db: Session = Depends(get_db)):
    return _rename_simple(db, SizeItem, sz_id, data, "Razmer")


@router.put("/brand/{b_id}")
def update_brand(b_id: int, data: Dict[str, Any], db: Session = Depends(get_db)):
    return _rename_simple(db, Brand, b_id, data, "Brend")


@router.delete("/brand/{b_id}")
def delete_brand(b_id: int, db: Session = Depends(get_db)):
    b = db.query(Brand).filter(Brand.id == b_id).first()
    if b:
        db.delete(b); db.commit()
    return {"status": "deleted"}


@router.put("/country/{c_id}")
def update_country(c_id: int, data: Dict[str, Any], db: Session = Depends(get_db)):
    return _rename_simple(db, Country, c_id, data, "Mamlakat")


@router.delete("/country/{c_id}")
def delete_country(c_id: int, db: Session = Depends(get_db)):
    c = db.query(Country).filter(Country.id == c_id).first()
    if c:
        db.delete(c); db.commit()
    return {"status": "deleted"}


@router.delete("/color/{color_id}")
def delete_color(color_id: int, db: Session = Depends(get_db)):
    c = db.query(Color).filter(Color.id == color_id).first()
    if c:
        db.delete(c); db.commit()
    return {"status": "deleted"}


# ================= OTHER REFERENCES =================
@router.post("/brand")
def add_brand(data: Dict[str, str], db: Session = Depends(get_db)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Brend nomi bo'sh bo'lishi mumkin emas")
    existing = db.query(Brand).filter(Brand.name.ilike(name)).first()
    if existing:
        return {"status": "exists", "brand": {"id": existing.id, "name": existing.name, "status": existing.status}}
    new_b = Brand(name=name, status="local_only")
    db.add(new_b)
    db.commit()
    db.refresh(new_b)
    return {"status": "created", "brand": {"id": new_b.id, "name": new_b.name, "status": new_b.status}}

@router.post("/country")
def add_country(data: Dict[str, str], db: Session = Depends(get_db)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Mamlakat nomi bo'sh bo'lishi mumkin emas")
    existing = db.query(Country).filter(Country.name.ilike(name)).first()
    if existing:
        return {"status": "exists", "country": {"id": existing.id, "name": existing.name, "status": existing.status}}
    new_c = Country(name=name, status="local_only")
    db.add(new_c)
    db.commit()
    db.refresh(new_c)
    return {"status": "created", "country": {"id": new_c.id, "name": new_c.name, "status": new_c.status}}

@router.post("/season")
def add_season(data: Dict[str, str], db: Session = Depends(get_db)):
    col = (data.get("collection") or "").strip()
    code = (data.get("code") or "").strip()
    if not col or not code:
        raise HTTPException(status_code=400, detail="Kolleksiya va kod kiritilishi shart")
    existing = db.query(Season).filter(Season.collection.ilike(col)).first()
    if existing:
        existing.code = code
        db.commit()
        return {"status": "updated", "season": {"id": existing.id, "collection": existing.collection, "code": existing.code}}
    new_s = Season(collection=col, code=code, status="local_only")
    db.add(new_s)
    db.commit()
    db.refresh(new_s)
    return {"status": "created", "season": {"id": new_s.id, "collection": new_s.collection, "code": new_s.code}}

# ================= RANG (COLOR) CRUD & TOP 10 FAVORITES =================
@router.post("/color")
def add_color(data: Dict[str, Any], db: Session = Depends(get_db)):
    name = (data.get("name") or "").strip()
    short_code = (data.get("short_code") or "").strip().upper()
    code_no = data.get("code_no")
    rgb = (data.get("rgb") or "").strip()
    is_favorite = bool(data.get("is_favorite", False))

    if not name:
        raise HTTPException(status_code=400, detail="Rang nomi kiritilishi shart")
    if not short_code:
        raise HTTPException(status_code=400, detail="3 harfli qisqa kod kiritilishi shart (masalan: BLK)")

    # Tekshiruv: short_code unikal bo'lishi shart!
    dup_code = db.query(Color).filter(Color.short_code == short_code).first()
    if dup_code:
        raise HTTPException(status_code=400, detail=f"'{short_code}' kodi allaqachon '{dup_code.name}' rangiga biriktirilgan! Kod unikal bo'lishi shart.")

    existing_name = db.query(Color).filter(Color.name.ilike(name)).first()
    if existing_name:
        raise HTTPException(status_code=400, detail=f"'{name}' nomli rang allaqachon mavjud!")

    new_color = Color(
        name=name,
        short_code=short_code,
        name_ru=(data.get("name_ru") or "").strip() or None,
        name_tr=(data.get("name_tr") or "").strip() or None,
        name_en=(data.get("name_en") or "").strip() or None,
        code_no=code_no,
        rgb=rgb,
        is_favorite=is_favorite,
        status="local_only"
    )
    db.add(new_color)
    db.commit()
    db.refresh(new_color)
    return {
        "status": "created",
        "color": {
            "id": new_color.id,
            "name": new_color.name,
            "short_code": new_color.short_code,
            "code_no": new_color.code_no,
            "is_favorite": new_color.is_favorite
        }
    }

@router.put("/color/{color_id}")
def update_color(color_id: int, data: Dict[str, Any], db: Session = Depends(get_db)):
    color = db.query(Color).filter(Color.id == color_id).first()
    if not color:
        raise HTTPException(status_code=404, detail="Rang topilmadi")

    name = (data.get("name") or "").strip()
    short_code = (data.get("short_code") or "").strip().upper()
    
    if name:
        color.name = name
    if short_code:
        # Tekshiruv: boshqa rangda aynan shu short_code bormi?
        dup_code = db.query(Color).filter(Color.short_code == short_code, Color.id != color_id).first()
        if dup_code:
            raise HTTPException(
                status_code=400, 
                detail=f"Xatolik: '{short_code}' kodi allaqachon '{dup_code.name}' rangiga biriktirilgan! Kodlar takrorlanmasligi shart."
            )
        color.short_code = short_code

    if "name_ru" in data:
        color.name_ru = (data.get("name_ru") or "").strip() or None
    if "name_tr" in data:
        color.name_tr = (data.get("name_tr") or "").strip() or None
    if "name_en" in data:
        color.name_en = (data.get("name_en") or "").strip() or None
    if "is_favorite" in data:
        color.is_favorite = bool(data["is_favorite"])
    if "code_no" in data and data["code_no"] is not None:
        color.code_no = int(data["code_no"])
    if "rgb" in data:
        color.rgb = (data["rgb"] or "").strip()

    db.commit()
    return {
        "status": "updated",
        "color": {
            "id": color.id,
            "name": color.name,
            "short_code": color.short_code,
            "code_no": color.code_no,
            "is_favorite": color.is_favorite
        }
    }

@router.post("/color/toggle-favorite/{color_id}")
def toggle_color_favorite(color_id: int, db: Session = Depends(get_db)):
    color = db.query(Color).filter(Color.id == color_id).first()
    if not color:
        raise HTTPException(status_code=404, detail="Rang topilmadi")

    color.is_favorite = not bool(color.is_favorite)
    db.commit()
    return {"status": "ok", "id": color.id, "name": color.name, "is_favorite": color.is_favorite}

@router.post("/sync-moysklad")
async def sync_moysklad_catalog(db: Session = Depends(get_db)):
    """Lokal ma'lumotnomalarni MoySklad bilan solishtirish: har bir qiymat MoySklad'ning tegishli lug'atida
    (Вид товара, Категория, Бренд, Сезон, Коллекция, Цвет, Размерный ряд) bormi — 'synced' / 'local_only'."""
    from backend.services.attributes_service import AttributesService, get_attribute_map
    svc = AttributesService(moysklad_service)
    attributes = await svc.list_attributes()
    mapping = get_attribute_map(db, attributes)
    by_id = {a["id"]: a for a in attributes}
    by_name = {(a.get("name") or "").strip().lower(): a for a in attributes}

    def dict_id_for(field_key: str, *fallback_names: str):
        entry = mapping.get(field_key) or {}
        a = by_id.get(entry.get("attr_id")) if entry.get("attr_id") else None
        if not a:
            for n in fallback_names:
                a = by_name.get(n.lower())
                if a:
                    break
        return (a or {}).get("dictionary_id")

    async def dict_values(dict_id: str) -> dict:
        """{lower_name: id} — lug'atning barcha qiymatlari"""
        out = {}
        if not dict_id:
            return out
        offset = 0
        while True:
            data = await moysklad_service._call("GET", f"entity/customentity/{dict_id}", params={"limit": 1000, "offset": offset})
            rows = data.get("rows", [])
            for r in rows:
                nm = (r.get("name") or "").strip()
                if nm:
                    out[nm.lower()] = r.get("id")
            if len(rows) < 1000:
                break
            offset += 1000
        return out

    def apply(objs, names_of, values: dict, counter: dict, label: str):
        synced = 0
        for o in objs:
            hit = None
            for nm in names_of(o):
                if nm and nm.strip().lower() in values:
                    hit = values[nm.strip().lower()]
                    break
            if hit:
                o.status = "synced"; o.moysklad_id = hit; synced += 1
            else:
                o.status = "local_only"
        counter[label] = {"synced": synced, "total": len(objs), "moysklad_values": len(values)}

    result = {}
    # Вид товара
    vid = await dict_values(dict_id_for("product_type", "Вид товара"))
    apply(db.query(ProductType).all(), lambda o: [o.name], vid, result, "product_types")
    # Категория: lug'at yoki tovar papkalari
    cat_vals = await dict_values(dict_id_for("category", "Категория"))
    if not cat_vals:
        folders = await moysklad_service.get_product_folders()
        cat_vals = {(f.get("name") or "").lower(): f.get("id") for f in folders if f.get("name")}
    apply(db.query(Category).all(), lambda o: [o.name], cat_vals, result, "categories")
    brand_vals = await dict_values(dict_id_for("brand", "Бренд"))
    apply(db.query(Brand).all(), lambda o: [o.name], brand_vals, result, "brands")
    season_vals = await dict_values(dict_id_for("season", "Сезон"))
    apply(db.query(SeasonType).all(), lambda o: [o.name], season_vals, result, "season_types")
    coll_vals = await dict_values(dict_id_for("collection", "Коллекция"))
    apply(db.query(Season).all(), lambda o: [o.collection], coll_vals, result, "seasons")
    color_vals = await dict_values(dict_id_for("color", "Цвет"))
    apply(db.query(Color).all(), lambda o: [o.name, o.name_ru, o.name_tr, o.name_en], color_vals, result, "colors")
    size_vals = await dict_values(dict_id_for("size", "Размерный ряд", "Размер"))
    apply(db.query(SizeItem).all(), lambda o: [o.name], size_vals, result, "sizes")
    db.commit()
    total_synced = sum(v["synced"] for v in result.values())
    return {
        "status": "success",
        "synced_categories_count": result.get("categories", {}).get("synced", 0),
        "total_categories": result.get("categories", {}).get("total", 0),
        "summary": result,
        "message": "MoySklad bilan solishtirildi: " + ", ".join(f"{k} {v['synced']}/{v['total']}" for k, v in result.items()),
        "total_synced": total_synced,
    }
