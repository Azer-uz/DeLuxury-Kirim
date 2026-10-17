"""Yengil avtomatik migratsiya: modelda bor, bazada yo'q ustunlarni qo'shadi.

create_all() faqat yangi jadvallarni yaratadi — eski o'rnatmalarda (yoki yangi mijozda eski bazadan
yangilanganda) yangi ustunlar qo'shilmay qoladi va ilova "no such column" bilan yiqiladi.
"""
import logging
from typing import List
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger("kirim-app")

def _sql_default(col) -> str:
    default = col.default
    if default is None or not getattr(default, "is_scalar", False):
        return ""
    value = default.arg
    if isinstance(value, bool):
        return f" DEFAULT {int(value)}"
    if isinstance(value, (int, float)):
        return f" DEFAULT {value}"
    if isinstance(value, str):
        return " DEFAULT '" + value.replace("'", "''") + "'"
    return ""

def add_missing_columns(engine: Engine, metadata) -> List[str]:
    inspector = inspect(engine)
    added: List[str] = []
    with engine.begin() as conn:
        for table in metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                # SQLite ADD COLUMN: NOT NULL/UNIQUE cheklovlarisiz (eski qatorlar bo'sh qoladi)
                col_type = col.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type}{_sql_default(col)}'))
                added.append(f"{table.name}.{col.name}")
    if added:
        logger.info(f"Migratsiya: qo'shilgan ustunlar — {', '.join(added)}")
    return added

def fill_missing_color_codes(engine: Engine):
    """Qisqa kodi yo'q ranglarga kod beradi (artikuldagi rang qismi: BLK, WHT ...)"""
    from backend.migrate_colors import COLOR_CODES
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, name, short_code FROM ranglar")).fetchall()
        used = {r[2].upper() for r in rows if r[2]}
        filled = 0
        for row_id, name, short_code in rows:
            if short_code:
                continue
            code, fav = COLOR_CODES.get(name, ((name + "XXX")[:3].upper(), 0))
            base, n = code, 1
            while code in used:
                code = f"{base[:2]}{n}"
                n += 1
            used.add(code)
            conn.execute(text("UPDATE ranglar SET short_code = :c, is_favorite = :f WHERE id = :i"), {"c": code, "f": fav, "i": row_id})
            filled += 1
    if filled:
        logger.info(f"Migratsiya: {filled} ta rangga qisqa kod berildi")
