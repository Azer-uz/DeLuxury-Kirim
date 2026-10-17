"""Artikul, model, nom va narx formulalari — backend uchun yagona manba.

Модель   = Mavsum_kodi(Коллекция) + Guruh_kodi(Вид товара → Группа) + 5 xonali model raqami
Артикул  = Модель [+ Rang kodi] [+ ajratgich + Razmer]  (sozlamaga qarab, app_settings.py)
Код      = MoySklad o'zi beradi (ilova yubormaydi)
"""
from typing import Any, Dict, Iterable, List, Optional
from sqlalchemy.orm import Session
from backend.models import Season, ProductType, ArticulCounter, Color, ModelAllocation

MULTI_COLOR_NAMES = {"мультиколор", "multicolor", "aralash", "standart", "std"}
SIZE_SPLIT_CHARS = ",;/"

class RefLookup:
    """Spravochniklar bir marta o'qiladi (har bir qator uchun alohida so'rov yubormaslik uchun)"""

    def __init__(self, db: Session):
        self.product_types: Dict[str, Dict[str, str]] = {}
        for pt in db.query(ProductType).all():
            self.product_types[pt.name.strip().lower()] = {
                "name": pt.name,
                "category": pt.category.name if pt.category else "",
                "group_name": pt.group.name if pt.group else "",
                "group_code": (pt.group.code or "").strip().upper() if pt.group else "",
            }
        self.seasons = {s.collection.strip().lower(): (s.code or "").strip().upper() for s in db.query(Season).all()}
        self.colors = {c.name.strip().lower(): (c.short_code or "").strip().upper() for c in db.query(Color).all()}

    def product_type(self, name: Optional[str]) -> Optional[Dict[str, str]]:
        return self.product_types.get((name or "").strip().lower())

    def season_code(self, collection: Optional[str]) -> Optional[str]:
        return self.seasons.get((collection or "").strip().lower()) or None

    def color_code(self, color: Optional[str]) -> Optional[str]:
        clean = (color or "").strip().lower()
        if not clean:
            return None
        if clean in MULTI_COLOR_NAMES:
            return "STD"
        return self.colors.get(clean) or None

def normalize_size(size: Optional[str]) -> str:
    return "".join((size or "").split()).upper()

def is_multi_size(size: Optional[str]) -> bool:
    return any(ch in (size or "") for ch in SIZE_SPLIT_CHARS)

def build_model_code(season_code: str, group_code: str, number: int) -> str:
    return f"{season_code}{group_code}{number:05d}"

def build_articul(model_code: str, color_code: Optional[str], size: Optional[str], settings: Dict[str, Any]) -> str:
    articul = model_code
    if settings.get("color_enabled") and color_code:
        articul += color_code
    if settings.get("size_enabled") and size:
        articul += f"{settings.get('size_separator', '-')}{normalize_size(size)}"
    return articul

def build_full_name(product_type: str, description: str, brand: str, factory_code: str) -> str:
    """Наименование = Вид товара + Описание + Бренд + Код модели (zavod). Rang/razmer nomga qo'shilmaydi"""
    return " ".join(p.strip() for p in (product_type, description, brand, factory_code) if p and p.strip())

def calc_money(qty: float, price_buy: float, price_sale: float, rate: float = 1.0) -> Dict[str, float]:
    """rate — USD kirimda tan narxni so'mga o'tkazish kursi (sotuv narxi doim so'mda)"""
    buy_in_sale_currency = price_buy * (rate or 1.0)
    markup = round(((price_sale / buy_in_sale_currency) - 1) * 100, 2) if buy_in_sale_currency > 0 else 0.0
    return {"sum_buy": round(qty * price_buy, 2), "sum_sale": round(qty * price_sale, 2), "markup_pct": markup}

# ================= MODEL RAQAMLARI =================
def get_counter(db: Session) -> ArticulCounter:
    counter = db.query(ArticulCounter).filter(
        ArticulCounter.group_code == "GLOBAL",
        ArticulCounter.season_code == "GLOBAL"
    ).first()
    if not counter:
        counter = ArticulCounter(group_code="GLOBAL", season_code="GLOBAL", last_number=0)
        db.add(counter)
        db.flush()
    return counter

def sync_counter(db: Session, moysklad_max: int) -> int:
    """Hisoblagich MoySklad'dagi eng katta model raqamidan orqada qolmasin"""
    counter = get_counter(db)
    if moysklad_max > counter.last_number:
        counter.last_number = moysklad_max
    db.commit()
    return counter.last_number

def allocate_model_numbers(db: Session, scope: str, model_keys: Iterable[str]) -> Dict[str, int]:
    """Har bir model uchun doimiy raqam. Shu qoralama qayta yuborilsa — avvalgi raqamlar qaytariladi.
    Chaqiruvchi bitta jarayonda ketma-ket chaqirishi kerak (documents.py dagi lock)."""
    counter = get_counter(db)
    result: Dict[str, int] = {}
    for key in dict.fromkeys(model_keys):
        alloc_key = f"{scope}:{key}"[:200]
        existing = db.query(ModelAllocation).filter(ModelAllocation.alloc_key == alloc_key).first()
        if existing:
            result[key] = existing.number
            continue
        counter.last_number += 1
        db.add(ModelAllocation(alloc_key=alloc_key, number=counter.last_number))
        result[key] = counter.last_number
    db.commit()
    return result

# ================= OLDINDAN KO'RISH (AI skaner va /calculate-batch) =================
def calculate_row_formulas(
    db: Session,
    product_type_name: Optional[str],
    collection_name: Optional[str],
    brand_name: Optional[str] = None,
    description: Optional[str] = None,
    model_code: Optional[str] = None,
    quantity: float = 1.0,
    price_buy: float = 0.0,
    price_sale: float = 0.0,
    refs: Optional[RefLookup] = None,
) -> dict:
    refs = refs or RefLookup(db)
    pt = refs.product_type(product_type_name) or {}
    money = calc_money(float(quantity or 0), float(price_buy or 0), float(price_sale or 0))
    return {
        "category": pt.get("category", ""),
        "group_name": pt.get("group_name", ""),
        "group_code": pt.get("group_code", ""),
        "season_code": refs.season_code(collection_name) or "",
        "full_name": build_full_name(product_type_name or "", description or "", brand_name or "", model_code or ""),
        **money,
    }
