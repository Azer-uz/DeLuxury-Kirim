"""MoySklad tovar "доп. поля"lari (атрибуты) — ko'rish, yaratish, o'zgartirish, o'chirish va ilova maydonlariga bog'lash.

Maqsad: yangi mijoz bilan nomenklatura kelishilgach, uning MoySklad'ini shu ilovaning sozlamalaridan tayyorlash.
Ilova har bir o'z maydonini (kategoriya, brend, rang ...) qaysi MoySklad maydoniga yozishini `attribute_map` sozlamasi
belgilaydi (atribut ID bo'yicha — MoySklad'da nomi o'zgarsa ham bog'lanish buzilmaydi).
"""
import json
import logging
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from backend.services.app_settings import get_raw_setting, set_raw_setting
from backend.services.moysklad_service import MoySkladService, MoySkladError

logger = logging.getLogger(__name__)

# Ilovaning o'z maydonlari: kalit -> (ko'rsatiladigan nom, MoySklad'dagi standart atribut nomi)
APP_FIELDS: List[Dict[str, str]] = [
    {"key": "category", "label": "Категория (ierarxiyadan avto)", "default": "Категория"},
    {"key": "product_type", "label": "Вид товара", "default": "Вид товара"},
    {"key": "collection", "label": "Коллекция (mavsum kodi)", "default": "Коллекция"},
    {"key": "season", "label": "Сезон", "default": "Сезон"},
    {"key": "brand", "label": "Бренд", "default": "Бренд"},
    {"key": "model_code", "label": "Модель (avto: A26TOP00724)", "default": "Модель"},
    {"key": "factory_code", "label": "Код модели (zavod artikuli)", "default": "Код модели"},
    {"key": "series", "label": "Серия (seriyadagi dona soni)", "default": "Серия"},
    {"key": "size", "label": "Размер", "default": "Размер"},
    {"key": "color", "label": "Цвет", "default": "Цвет"},
    {"key": "country", "label": "Страна (atribut sifatida; standart 'country' maydoni baribir to'ldiriladi)", "default": ""},
]

ATTRIBUTE_TYPES = ["string", "text", "long", "double", "boolean", "time", "link", "customentity"]
SNAPSHOT_KEY = "attribute_snapshot"
MAP_KEY = "attribute_map"

# ================= MoySklad bilan ishlash =================
class AttributesService:
    def __init__(self, ms: MoySkladService):
        self.ms = ms

    async def list_attributes(self) -> List[Dict[str, Any]]:
        data = await self.ms._call("GET", "entity/product/metadata/attributes")
        rows = data.get("rows", []) if isinstance(data, dict) else []
        self.ms._attrs_metadata = rows  # payload yig'uvchi kesh ham yangilansin
        return [self._public(a) for a in rows]

    async def list_dictionaries(self) -> List[Dict[str, Any]]:
        data = await self.ms._call("GET", "context/companysettings/metadata")
        return [
            {"id": c.get("meta", {}).get("href", "").rstrip("/").split("/")[-1], "name": c.get("name", "")}
            for c in (data or {}).get("customEntities", [])
        ]

    async def create_attribute(self, name: str, attr_type: str, required: bool = False,
                               dictionary_id: Optional[str] = None, new_dictionary_name: Optional[str] = None) -> Dict[str, Any]:
        name = (name or "").strip()
        if not name:
            raise MoySkladError("Maydon nomi bo'sh")
        if attr_type not in ATTRIBUTE_TYPES:
            raise MoySkladError(f"Noma'lum tur: {attr_type}")
        payload: Dict[str, Any] = {"name": name, "type": attr_type, "required": bool(required)}
        if attr_type == "customentity":
            if new_dictionary_name:
                created = await self.ms._call("POST", "entity/customentity", json_data={"name": new_dictionary_name.strip()})
                dict_meta = created.get("meta")
            elif dictionary_id:
                dict_meta = {
                    "href": f"{self.ms.base_url}/context/companysettings/metadata/customEntities/{dictionary_id}",
                    "type": "customentitymetadata", "mediaType": "application/json",
                }
            else:
                raise MoySkladError("Spravochnik turi uchun mavjud spravochnikni tanlang yoki yangisini yarating")
            payload["customEntityMeta"] = dict_meta
        created_attr = await self.ms._call("POST", "entity/product/metadata/attributes", json_data=payload)
        self.ms._attrs_metadata = None
        return self._public(created_attr)

    async def update_attribute(self, attr_id: str, name: Optional[str] = None, required: Optional[bool] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if name is not None and name.strip():
            payload["name"] = name.strip()
        if required is not None:
            payload["required"] = bool(required)
        if not payload:
            raise MoySkladError("O'zgartiriladigan maydon yo'q")
        updated = await self.ms._call("PUT", f"entity/product/metadata/attributes/{attr_id}", json_data=payload)
        self.ms._attrs_metadata = None
        return self._public(updated)

    async def delete_attribute(self, attr_id: str):
        await self.ms._call("DELETE", f"entity/product/metadata/attributes/{attr_id}")
        self.ms._attrs_metadata = None

    @staticmethod
    def _public(a: Dict[str, Any]) -> Dict[str, Any]:
        ce_href = (a.get("customEntityMeta") or {}).get("href", "")
        return {
            "id": a.get("id"),
            "name": a.get("name", ""),
            "type": a.get("type", ""),
            "required": bool(a.get("required")),
            "dictionary_id": ce_href.rstrip("/").split("/")[-1] if ce_href else None,
        }

# ================= Bog'lanish (attribute_map) =================
def get_attribute_map(db: Session, attributes: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """{app_field: {"attr_id": ..., "enabled": bool}}. Sozlama yo'q bo'lsa — standart nomlar bo'yicha avtomatik bog'lanadi"""
    raw = get_raw_setting(db, MAP_KEY)
    stored: Dict[str, Any] = {}
    if raw:
        try:
            stored = json.loads(raw)
        except (ValueError, TypeError):
            stored = {}
    by_name = {a["name"]: a["id"] for a in attributes}
    result: Dict[str, Dict[str, Any]] = {}
    for f in APP_FIELDS:
        entry = stored.get(f["key"])
        if entry is None:
            attr_id = by_name.get(f["default"]) if f["default"] else None
            entry = {"attr_id": attr_id, "enabled": bool(attr_id)}
        result[f["key"]] = {"attr_id": entry.get("attr_id"), "enabled": bool(entry.get("enabled"))}
    return result

def save_attribute_map(db: Session, mapping: Dict[str, Any], attributes: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    valid_ids = {a["id"] for a in attributes}
    clean: Dict[str, Dict[str, Any]] = {}
    for f in APP_FIELDS:
        entry = mapping.get(f["key"]) or {}
        attr_id = entry.get("attr_id") or None
        if attr_id and attr_id not in valid_ids:
            raise MoySkladError(f"'{f['label']}' uchun tanlangan maydon MoySklad'da yo'q")
        clean[f["key"]] = {"attr_id": attr_id, "enabled": bool(entry.get("enabled")) and bool(attr_id)}
    set_raw_setting(db, MAP_KEY, json.dumps(clean, ensure_ascii=False))
    return clean

def required_app_fields(mapping: Dict[str, Dict[str, Any]], attributes: List[Dict[str, Any]]) -> List[str]:
    """MoySklad'da majburiy bo'lgan atributga bog'langan ilova maydonlari (qatorda bo'sh bo'lsa yuborilmaydi)."""
    by_id = {a["id"]: a for a in attributes}
    out = []
    for key, entry in mapping.items():
        a = by_id.get(entry.get("attr_id")) if entry.get("enabled") else None
        if a and a.get("required"):
            out.append(key)
    return out


def mapping_problems(mapping: Dict[str, Dict[str, Any]], attributes: List[Dict[str, Any]]) -> List[str]:
    """Yuborishdan oldin: yoqilgan maydon MoySklad'da yo'q bo'lsa; majburiy MoySklad maydoni bog'lanmagan bo'lsa"""
    by_id = {a["id"]: a for a in attributes}
    labels = {f["key"]: f["label"] for f in APP_FIELDS}
    problems = []
    mapped_ids = set()
    for key, entry in mapping.items():
        if entry.get("enabled") and entry.get("attr_id"):
            if entry["attr_id"] not in by_id:
                problems.append(f"'{labels.get(key, key)}' bog'langan MoySklad maydoni o'chirilgan — Sozlamalar → Доп. поля")
            else:
                mapped_ids.add(entry["attr_id"])
    for a in attributes:
        if a["required"] and a["id"] not in mapped_ids:
            problems.append(f"MoySklad'da '{a['name']}' majburiy, lekin ilova maydoniga bog'lanmagan")
    return problems

# ================= O'zgarishlarni aniqlash =================
def diff_snapshot(db: Session, attributes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Oxirgi ko'rilgan holat bilan solishtiradi, farqlarni qaytaradi va yangi holatni saqlaydi"""
    raw = get_raw_setting(db, SNAPSHOT_KEY)
    first_time = raw is None
    old: Dict[str, Dict[str, Any]] = {}
    if raw:
        try:
            old = {a["id"]: a for a in json.loads(raw)}
        except (ValueError, TypeError):
            old = {}
    new = {a["id"]: a for a in attributes}
    added = [new[i] for i in new if i not in old]
    removed = [old[i] for i in old if i not in new]
    changed = [
        {"before": old[i], "after": new[i]}
        for i in new if i in old and (old[i]["name"], old[i]["type"], old[i]["required"]) != (new[i]["name"], new[i]["type"], new[i]["required"])
    ]
    if first_time or added or removed or changed:
        set_raw_setting(db, SNAPSHOT_KEY, json.dumps(attributes, ensure_ascii=False))
    return {"added": added, "removed": removed, "changed": changed, "first_time": first_time}

def format_diff(diff: Dict[str, Any]) -> str:
    lines = []
    for a in diff["added"]:
        lines.append(f"➕ qo'shildi: {a['name']} ({a['type']}{', majburiy' if a['required'] else ''})")
    for a in diff["removed"]:
        lines.append(f"➖ o'chirildi: {a['name']} ({a['type']})")
    for c in diff["changed"]:
        b, n = c["before"], c["after"]
        what = []
        if b["name"] != n["name"]:
            what.append(f"nomi «{b['name']}» → «{n['name']}»")
        if b["type"] != n["type"]:
            what.append(f"turi {b['type']} → {n['type']}")
        if b["required"] != n["required"]:
            what.append("majburiy bo'ldi" if n["required"] else "majburiy emas bo'ldi")
        lines.append(f"✏️ o'zgardi: {n['name']} — " + ", ".join(what))
    return "\n".join(lines)
