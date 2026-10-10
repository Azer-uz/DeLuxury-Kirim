import csv
import io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import Dict, Any, List
from backend.database import get_db
from backend.models import (
    ProductType, Category, Group, Season, Brand, Color, Country, SeasonType, SizeItem
)
from backend.services.moysklad_service import MoySkladService

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
        "colors": [{"id": c.id, "name": c.name, "code_no": c.code_no, "rgb": c.rgb, "status": c.status} for c in colors],
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
async def import_hierarchy_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Import or bulk update Product types hierarchy from CSV/Excel."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Fayl bo'sh")

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

    # Normalize header indices
    header_clean = [h.strip().lower() for h in header]
    vid_idx = next((i for i, h in enumerate(header_clean) if "вид" in h or "nomi" in h or "tovar" in h), 0)
    kat_idx = next((i for i, h in enumerate(header_clean) if "категор" in h or "kategoriya" in h), 1)
    gur_idx = next((i for i, h in enumerate(header_clean) if "групп" in h or "guruh" in h), 2)

    groups_map = {g.name.strip().lower(): g for g in db.query(Group).all()}
    categories_map = {c.name.strip().lower(): c for c in db.query(Category).all()}

    imported_count = 0
    updated_count = 0

    for row in reader:
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

@router.post("/sync-moysklad")
async def sync_moysklad_catalog(db: Session = Depends(get_db)):
    """Sync and update local status against MoySklad folders and products."""
    folders = await moysklad_service.get_product_folders()
    folder_names = {f.get("name", "").lower(): f.get("id") for f in folders if f.get("name")}

    categories = db.query(Category).all()
    synced_count = 0
    for cat in categories:
        if cat.name.lower() in folder_names:
            cat.status = "synced"
            cat.moysklad_id = folder_names[cat.name.lower()]
            synced_count += 1
        else:
            cat.status = "local_only"

    db.commit()
    return {
        "status": "success",
        "synced_categories_count": synced_count,
        "total_categories": len(categories),
        "moysklad_folders_count": len(folders)
    }
