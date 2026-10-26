import csv
from pathlib import Path
from sqlalchemy.orm import Session
from backend.models import (
    Group, Season, Category, ProductType, Color, Country, Brand, ArticulCounter,
    SeasonType, SizeItem
)

SEED_DIR = Path(__file__).resolve().parent / "seed_data"
if not SEED_DIR.exists():
    SEED_DIR = Path(__file__).resolve().parent.parent

def seed_database(db: Session):
    """Boshlang'ich ma'lumotlar — FAQAT bo'sh jadvallarga. Mijoz o'chirgan/qayta nomlagan qiymatlar restartda qaytib kelmasligi uchun."""
    """Seed initial reference data from CSV files into database."""
    
    # 1. Seed Guruhlar (guruh_kodlari.csv)
    guruh_file = SEED_DIR / "guruh_kodlari.csv"
    if guruh_file.exists() and db.query(Group).count() == 0:
        with open(guruh_file, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                guruh_name = row.get("Guruh", "").strip()
                guruh_kod = row.get("Kod", "").strip()
                if guruh_name and guruh_kod:
                    existing = db.query(Group).filter(Group.name == guruh_name).first()
                    if not existing:
                        db.add(Group(name=guruh_name, code=guruh_kod, status="local_only"))
        db.commit()

    # 2. Seed Mavsumlar (mavsum_kodlari.csv)
    mavsum_file = SEED_DIR / "mavsum_kodlari.csv"
    if mavsum_file.exists() and db.query(Season).count() == 0:
        with open(mavsum_file, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                koll = row.get("Коллекция", "").strip()
                kod = row.get("Код", "").strip()
                if koll and kod:
                    existing = db.query(Season).filter(Season.collection == koll).first()
                    if not existing:
                        db.add(Season(collection=koll, code=kod, status="local_only"))
        db.commit()

    # 3. Seed Vid Tovara, Kategoriya & Guruh mapping (vid_tovara_kategoriya_guruh.csv)
    vid_file = SEED_DIR / "vid_tovara_kategoriya_guruh.csv"
    if vid_file.exists() and db.query(ProductType).count() == 0:
        # Load all groups in memory for fast lookup
        groups_map = {g.name.strip().lower(): g for g in db.query(Group).all()}
        categories_map = {c.name.strip().lower(): c for c in db.query(Category).all()}

        with open(vid_file, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                vid_name = row.get("Вид товара", "").strip()
                kat_name = row.get("Категория", "").strip()
                gur_name = row.get("Группа", "").strip()
                
                if not vid_name:
                    continue

                # Ensure Category exists
                if kat_name:
                    kat_key = kat_name.lower()
                    if kat_key not in categories_map:
                        new_kat = Category(name=kat_name, status="local_only")
                        db.add(new_kat)
                        db.flush()
                        categories_map[kat_key] = new_kat
                    cat_obj = categories_map[kat_key]
                else:
                    cat_obj = None

                # Find Group
                group_obj = groups_map.get(gur_name.lower()) if gur_name else None

                # Ensure ProductType exists
                existing_pt = db.query(ProductType).filter(ProductType.name == vid_name).first()
                if not existing_pt:
                    db.add(ProductType(
                        name=vid_name,
                        category_id=cat_obj.id if cat_obj else None,
                        group_id=group_obj.id if group_obj else None,
                        status="local_only"
                    ))
        db.commit()

    # 4. Seed Ranglar (ranglar_1.csv)
    rang_file = SEED_DIR / "ranglar_1.csv"
    if rang_file.exists() and db.query(Color).count() == 0:
        with open(rang_file, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rang_name = row.get("Rang", "").strip()
                code_no_str = row.get("No", "").strip()
                code_no = int(code_no_str) if code_no_str.isdigit() else None
                if rang_name:
                    existing = db.query(Color).filter(Color.name == rang_name).first()
                    if not existing:
                        db.add(Color(name=rang_name, code_no=code_no, status="local_only"))
        db.commit()

    # 5. Seed default Mamlakatlar
    default_countries = [
        "Турция", "Италия", "Китай", "Узбекистан", "Россия",
        "ОАЭ", "Германия", "Вьетнам", "Бангладеш", "Португалия", "Франция", "Испания"
    ]
    for c_name in default_countries:
        existing = db.query(Country).filter(Country.name == c_name).first()
        if not existing:
            db.add(Country(name=c_name, status="local_only"))

    # 6. Seed default Brendlar
    default_brands = [
        "De Luxury", "Zara", "Massimo Dutti", "Tommy Hilfiger", "Lacoste",
        "Hugo Boss", "Calvin Klein", "Polo Ralph Lauren", "Nike", "Adidas",
        "Puma", "Armani", "Gucci", "Prada", "Balenciaga", "Diesel", "Guess",
        "H&M", "Mango", "LC Waikiki", "Koton", "U.S. Polo Assn."
    ]
    for b_name in default_brands:
        existing = db.query(Brand).filter(Brand.name == b_name).first()
        if not existing:
            db.add(Brand(name=b_name, status="local_only"))

    # 7. Seed default Sezonlar (Fasllar)
    default_seasons = ["Весна-Осень", "Зима", "Лето", "Всесезон", "Демисезон"]
    for s_name in default_seasons:
        existing = db.query(SeasonType).filter(SeasonType.name == s_name).first()
        if not existing:
            db.add(SeasonType(name=s_name, status="local_only"))

    # 8. Seed default Razmerlar
    default_sizes = [
        "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL",
        "36", "38", "40", "42", "44", "46", "48", "50", "52", "54", "56",
        "Universal"
    ]
    for idx, sz_name in enumerate(default_sizes):
        existing = db.query(SizeItem).filter(SizeItem.name == sz_name).first()
        if not existing:
            db.add(SizeItem(name=sz_name, sort_order=idx, status="local_only"))

    # 9. Seed ArticulCounter default global counter if none exists
    global_counter = db.query(ArticulCounter).filter(
        ArticulCounter.group_code == "GLOBAL",
        ArticulCounter.season_code == "GLOBAL"
    ).first()
    if not global_counter:
        db.add(ArticulCounter(group_code="GLOBAL", season_code="GLOBAL", last_number=0))  # MoySklad artikullari bilan sinxronlanadi

    db.commit()
