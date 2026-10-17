"""Artikul, model, nom va narx formulalari — backend uchun yagona manba.

Модель   = Mavsum_kodi(Коллекция) + Guruh_kodi(Вид товара → Группа) + 5 xonali model raqami
Артикул  = Модель [+ Rang kodi]  (rang rejimi yoqilgan bo'lsa)
Razmer   = artikulga kirmaydi: razmer rejimida har bir razmer bir xil artikulli ALOHIDA tovar
Код      = har bir tovarning unikal kaliti (MoySklad importidagi kabi): ilova beradi — ketma-ket, MoySklad'dagi
           eng katta koddan keyin, hech qachon qaytarilmaydi (hisoblagich faqat oshadi). Kirim kod bo'yicha bog'lanadi.
Штрихкод = MoySklad o'zi beradi
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

def build_articul(model_code: str, color_code: Optional[str], settings: Dict[str, Any]) -> str:
    if settings.get("color_enabled") and color_code:
        return model_code + color_code
    return model_code

def build_full_name(product_type: str, description: str, brand: str, factory_code: str, size: str = "") -> str:
    """Наименование = Вид товара + Описание + Бренд + Код модели (zavod) [+ Razmer — razmer rejimida, sozlamaga qarab]"""
    return " ".join(p.strip() for p in (product_type, description, brand, factory_code, size) if p and p.strip())

def product_key(articul: str, size: Optional[str], settings: Dict[str, Any]) -> tuple:
    """MoySklad'dagi bitta tovar: razmer rejimida (artikul, razmer), aks holda faqat artikul"""
    return (articul, normalize_size(size) if settings.get("size_enabled") else "")

def calc_money(qty: float, price_buy: float, price_sale: float, rate: float = 1.0) -> Dict[str, float]:
    """rate — USD kirimda tan narxni so'mga o'tkazish kursi (sotuv narxi doim so'mda)"""
    buy_in_sale_currency = price_buy * (rate or 1.0)
    markup = round(((price_sale / buy_in_sale_currency) - 1) * 100, 2) if buy_in_sale_currency > 0 else 0.0
    return {"sum_buy": round(qty * price_buy, 2), "sum_sale": round(qty * price_sale, 2), "markup_pct": markup}

# ================= MODEL RAQAMLARI VA TOVAR KODLARI =================
# Ikkala hisoblagich ham faqat oshadi: MoySklad'dagi eng katta qiymatdan orqada qolsa ko'tariladi, hech qachon tushmaydi —
# MoySklad'da tovar o'chirilsa ham uning kodi/raqami qayta berilmaydi.
MODEL_COUNTER = ("GLOBAL", "GLOBAL")
CODE_COUNTER = ("CODE", "CODE")
CODE_WIDTH = 5

def _get_counter(db: Session, kind: tuple) -> ArticulCounter:
    counter = db.query(ArticulCounter).filter(
        ArticulCounter.group_code == kind[0],
        ArticulCounter.season_code == kind[1]
    ).first()
    if not counter:
        counter = ArticulCounter(group_code=kind[0], season_code=kind[1], last_number=0)
        db.add(counter)
        db.flush()
    return counter

def get_counter(db: Session) -> ArticulCounter:
    return _get_counter(db, MODEL_COUNTER)

def get_code_counter(db: Session) -> ArticulCounter:
    return _get_counter(db, CODE_COUNTER)

def sync_counter(db: Session, moysklad_max: int, kind: tuple = MODEL_COUNTER) -> int:
    """Hisoblagich MoySklad'dagi eng katta qiymatdan orqada qolmasin"""
    counter = _get_counter(db, kind)
    if moysklad_max > counter.last_number:
        counter.last_number = moysklad_max
    db.commit()
    return counter.last_number

def format_code(number: int) -> str:
    return f"{number:0{CODE_WIDTH}d}"

def _allocate(db: Session, kind: tuple, alloc_keys: Dict[str, str]) -> Dict[str, int]:
    """alloc_keys: {natija kaliti: bazadagi doimiy kalit}. Bor bo'lsa avvalgi raqam, yo'q bo'lsa hisoblagich + 1.
    Chaqiruvchi bitta jarayonda ketma-ket chaqirishi kerak (documents.py dagi lock)."""
    counter = _get_counter(db, kind)
    result: Dict[str, int] = {}
    for key, alloc_key in alloc_keys.items():
        existing = db.query(ModelAllocation).filter(ModelAllocation.alloc_key == alloc_key[:200]).first()
        if existing:
            result[key] = existing.number
            continue
        counter.last_number += 1
        db.add(ModelAllocation(alloc_key=alloc_key[:200], number=counter.last_number))
        result[key] = counter.last_number
    db.commit()
    return result

def allocate_model_numbers(db: Session, scope: str, model_keys: Iterable[str]) -> Dict[str, int]:
    """Har bir model uchun doimiy raqam. Shu qoralama qayta yuborilsa — avvalgi raqamlar qaytariladi."""
    return _allocate(db, MODEL_COUNTER, {k: f"{scope}:{k}" for k in dict.fromkeys(model_keys)})

def allocate_codes(db: Session, scope: str, product_keys: Iterable[tuple]) -> Dict[tuple, str]:
    """Har bir tovar (artikul, razmer) uchun doimiy unikal kod. Qayta yuborishda o'sha kod."""
    keys = {k: f"{scope}:code:{k[0]}|{k[1]}" for k in dict.fromkeys(product_keys)}
    return {k: format_code(n) for k, n in _allocate(db, CODE_COUNTER, keys).items()}

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
