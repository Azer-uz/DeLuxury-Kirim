from sqlalchemy.orm import Session
from sqlalchemy import or_
from backend.models import Group, Season, Category, ProductType, ArticulCounter

def get_next_articul_number(db: Session, group_code: str = "GLOBAL", season_code: str = "GLOBAL", increment: bool = True) -> int:
    """
    Get the next articul sequence number.
    If increment is True, increments and saves the counter in DB.
    """
    # Look for specific (group_code, season_code) or fallback to GLOBAL
    counter = db.query(ArticulCounter).filter(
        ArticulCounter.group_code == "GLOBAL",
        ArticulCounter.season_code == "GLOBAL"
    ).first()

    if not counter:
        counter = ArticulCounter(group_code="GLOBAL", season_code="GLOBAL", last_number=500)
        db.add(counter)
        db.flush()

    if increment:
        counter.last_number += 1
        db.flush()
        return counter.last_number
    else:
        return counter.last_number + 1

def calculate_row_formulas(
    db: Session,
    product_type_name: str | None,
    collection_name: str | None,
    brand_name: str | None = None,
    description: str | None = None,
    model_code: str | None = None,
    quantity: float = 1.0,
    price_buy: float = 0.0,
    price_sale: float = 0.0,
    current_articul: str | None = None
) -> dict:
    """
    Calculate category, group, articul, full name, markup %, and sums for a row.
    """
    category_name = ""
    group_name = ""
    group_code = "UND"
    season_code = "CON"

    # 1. Look up Category & Group from ProductType
    if product_type_name:
        pt = db.query(ProductType).filter(ProductType.name.ilike(product_type_name.strip())).first()
        if pt:
            if pt.category:
                category_name = pt.category.name
            if pt.group:
                group_name = pt.group.name
                group_code = pt.group.code

    # 2. Look up Season code from Collection
    if collection_name:
        season_obj = db.query(Season).filter(Season.collection.ilike(collection_name.strip())).first()
        if season_obj:
            season_code = season_obj.code
        else:
            # Fallback heuristic: e.g. "AW26" -> "A26", "SS25" -> "S25"
            c_clean = collection_name.strip().upper()
            if c_clean.startswith("AW"):
                season_code = "A" + c_clean[2:]
            elif c_clean.startswith("SS"):
                season_code = "S" + c_clean[2:]
            else:
                season_code = c_clean[:3]

    # 3. Articul calculation
    # If user has not set an articul or wants auto-articul preview
    next_num = get_next_articul_number(db, increment=False)
    zero_padded_num = f"{next_num:05d}"
    calculated_articul = f"{season_code}{group_code}{zero_padded_num}"

    # 4. Full Name (Наименование) = TRIM(Вид_товара + " " + Описание + " " + Бренд + " " + Код_модели)
    name_parts = [
        (product_type_name or "").strip(),
        (description or "").strip(),
        (brand_name or "").strip(),
        (model_code or "").strip()
    ]
    full_name = " ".join([p for p in name_parts if p])

    # 5. Markup & Sums
    qty = float(quantity) if quantity else 0.0
    p_buy = float(price_buy) if price_buy else 0.0
    p_sale = float(price_sale) if price_sale else 0.0

    sum_buy = round(qty * p_buy, 2)
    sum_sale = round(qty * p_sale, 2)
    
    markup_pct = 0.0
    if p_buy > 0:
        markup_pct = round(((p_sale / p_buy) - 1) * 100, 2)

    return {
        "category": category_name,
        "group_name": group_name,
        "group_code": group_code,
        "season_code": season_code,
        "calculated_articul": calculated_articul,
        "full_name": full_name,
        "markup_pct": markup_pct,
        "sum_buy": sum_buy,
        "sum_sale": sum_sale
    }
