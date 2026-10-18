import json
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from backend.config import get_settings
from backend.services.gateway_core import gateway

logger = logging.getLogger(__name__)

# Artikuldagi model raqami: "A26TOP00724", "A26TOP00724BLK", "A26TOP00724BLK-XL" -> 724
MODEL_NUMBER_RE = re.compile(r"^[A-Z0-9]*?[A-Z](\d{5})(?!\d)")
BULK_CHUNK = 50

class MoySkladError(Exception):
    pass

def _error_text(res: Dict[str, Any]) -> str:
    """Gateway xato javobidan MoySklad'ning o'qiladigan xabarini ajratadi"""
    detail = res.get("detail") or ""
    try:
        parsed = json.loads(detail)
        errors = parsed.get("errors") if isinstance(parsed, dict) else None
        if errors:
            return "; ".join(e.get("error", "") for e in errors if e.get("error"))
    except (ValueError, TypeError):
        pass
    return str(detail)[:300] or "Noma'lum xatolik"

class MoySkladService:
    """MoySklad bilan barcha ishlar — faqat Gateway (rate-limit, retry) orqali"""

    def __init__(self):
        self.settings = get_settings()
        self.base_url = self.settings.moysklad_api_url.rstrip("/")
        self.token = self.settings.moysklad_token
        self._price_type_meta: Optional[Dict[str, Any]] = None
        self._attrs_metadata: Optional[List[Dict[str, Any]]] = None
        self._ce_cache: Dict[str, Dict[str, Any]] = {}
        self._country_cache: Dict[str, Optional[Dict[str, Any]]] = {}
        self._folder_cache: Dict[str, Dict[str, Any]] = {}
        self._currency_cache: Dict[str, Dict[str, Any]] = {}
        self._products_scan: Tuple[float, List[Dict[str, Any]]] = (0.0, [])

    def _headers(self) -> Dict[str, str]:
        return gateway._headers()

    def meta(self, entity: str, entity_id: str) -> Dict[str, Any]:
        return {"href": f"{self.base_url}/entity/{entity}/{entity_id}", "type": entity, "mediaType": "application/json"}

    async def _call(self, method: str, endpoint: str, params: Optional[Dict[str, Any]] = None, json_data: Any = None) -> Any:
        res = await gateway.execute_request(method, endpoint, params=params, json_data=json_data)
        if isinstance(res, dict) and res.get("error"):
            raise MoySkladError(_error_text(res))
        return res

    async def _fetch_all(self, endpoint: str, params: Optional[Dict[str, Any]] = None, page: int = 1000) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        offset = 0
        while True:
            data = await self._call("GET", endpoint, params={**(params or {}), "limit": page, "offset": offset})
            batch = data.get("rows", []) if isinstance(data, dict) else []
            rows.extend(batch)
            size = data.get("meta", {}).get("size", 0) if isinstance(data, dict) else 0
            offset += page
            if not batch or offset >= size:
                return rows

    # ================= ULANISH VA SPRAVOCHNIKLAR =================
    async def test_connection(self) -> Dict[str, Any]:
        if not self.token:
            return {"status": "error", "message": "MoySklad API token kiritilmagan (.env faylida MOYSKLAD_TOKEN yo'q)"}
        try:
            data = await self._call("GET", "entity/organization")
            orgs = data.get("rows", [])
            org_name = orgs[0].get("name", "Noma'lum") if orgs else "Tashkilot topilmadi"
            return {"status": "connected", "organization_name": org_name, "organizations": orgs,
                    "message": f"Ulanish muvaffaqiyatli: {org_name}"}
        except MoySkladError as e:
            return {"status": "error", "message": f"MoySklad API xatosi: {e}"}

    async def _safe_list(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        try:
            return await self._fetch_all(endpoint, params)
        except MoySkladError as e:
            logger.error(f"Error fetching {endpoint}: {e}")
            return []

    async def get_stores(self) -> List[Dict[str, Any]]:
        return await self._safe_list("entity/store")

    async def get_counterparties(self) -> List[Dict[str, Any]]:
        return await self._safe_list("entity/counterparty")

    async def get_organizations(self) -> List[Dict[str, Any]]:
        return await self._safe_list("entity/organization")

    async def get_product_folders(self) -> List[Dict[str, Any]]:
        return await self._safe_list("entity/productfolder")

    async def create_counterparty(self, name: str, phone: Optional[str] = None, description: Optional[str] = None, tag: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"name": name.strip()}
        if phone:
            payload["phone"] = phone.strip()
        if description:
            payload["description"] = description.strip()
        if tag:
            payload["tags"] = [tag.strip()]
        try:
            return {"status": "created", "counterparty": await self._call("POST", "entity/counterparty", json_data=payload)}
        except MoySkladError as e:
            return {"status": "error", "message": f"MoySklad xatosi: {e}"}

    async def get_next_supply_number(self) -> str:
        """Oxirgi Приемка raqamidan keyingi 5 xonali raqam (masalan 00042)"""
        try:
            data = await self._call("GET", "entity/supply", params={"order": "moment,desc", "limit": 30})
            highest = 0
            for r in data.get("rows", []):
                digits = "".join(ch for ch in (r.get("name") or "") if ch.isdigit())
                if digits:
                    highest = max(highest, int(digits))
            if highest > 0:
                return f"{highest + 1:05d}"
        except MoySkladError as e:
            logger.error(f"Error determining next supply number: {e}")
        return "00001"

    async def supply_exists(self, name: str) -> bool:
        data = await self._call("GET", "entity/supply", params={"filter": f"name={name}", "limit": 1})
        return bool(data.get("rows"))

    async def get_currency(self, iso_code: str) -> Optional[Dict[str, Any]]:
        if iso_code not in self._currency_cache:
            for cur in await self._safe_list("entity/currency"):
                self._currency_cache[cur.get("isoCode", "")] = cur
        return self._currency_cache.get(iso_code)

    # ================= MODEL RAQAMI (MoySklad bilan sinxron) =================
    async def get_all_products(self, max_age: int = 60) -> List[Dict[str, Any]]:
        ts, rows = self._products_scan
        if rows and time.time() - ts < max_age:
            return rows
        rows = await self._fetch_all("entity/product")
        self._products_scan = (time.time(), rows)
        return rows

    async def get_code_stats(self) -> Dict[str, Any]:
        """Butun assortiment (tovar, xizmat, komplekt, modifikatsiya) kodlari: eng katta raqamli kod va takrorlar.
        Kod MoySklad'da butun assortiment bo'yicha unikal bo'lishi kerak"""
        rows = await self._fetch_all("entity/assortment")
        seen: Dict[str, int] = {}
        highest = 0
        for r in rows:
            code = (r.get("code") or "").strip()
            if not code:
                continue
            seen[code] = seen.get(code, 0) + 1
            if code.isdigit():
                highest = max(highest, int(code))
        return {"max": highest, "duplicates": sorted(c for c, n in seen.items() if n > 1), "total": len(rows)}

    async def find_products_by_codes(self, codes: List[str]) -> Dict[str, Dict[str, Any]]:
        found: Dict[str, Dict[str, Any]] = {}
        unique = list(dict.fromkeys(c for c in codes if c))
        for i in range(0, len(unique), BULK_CHUNK):
            chunk = unique[i:i + BULK_CHUNK]
            data = await self._call("GET", "entity/product", params={"filter": ";".join(f"code={c}" for c in chunk), "limit": 1000})
            for p in data.get("rows", []):
                found[(p.get("code") or "").strip()] = p
        return found

    async def get_max_model_number(self) -> int:
        """MoySklad'dagi artikullardan eng katta model raqami (A26TOP00724BLK -> 724)"""
        highest = 0
        for p in await self.get_all_products():
            m = MODEL_NUMBER_RE.match((p.get("article") or "").strip().upper())
            if m:
                highest = max(highest, int(m.group(1)))
        return highest

    # ================= MAHSULOTLARNI TOPISH / YARATISH =================
    async def _price_type(self) -> Optional[Dict[str, Any]]:
        if self._price_type_meta:
            return self._price_type_meta
        pts = await self._call("GET", "context/companysettings/pricetype")
        if pts:
            chosen = next((pt for pt in pts if pt.get("name") == "Цена продажи"), pts[0])
            self._price_type_meta = chosen.get("meta")
        return self._price_type_meta

    async def _attributes_map(self) -> Dict[str, Dict[str, Any]]:
        if self._attrs_metadata is None:
            data = await self._call("GET", "entity/product/metadata/attributes")
            self._attrs_metadata = data.get("rows", [])
        return {a.get("name"): a for a in self._attrs_metadata if a.get("name")}

    async def _custom_entity_value(self, dict_id: str, value: str) -> Optional[Dict[str, Any]]:
        clean = str(value).strip()
        if not clean:
            return None
        key = f"{dict_id}:{clean.lower()}"
        if key in self._ce_cache:
            return self._ce_cache[key]
        data = await self._call("GET", f"entity/customentity/{dict_id}", params={"search": clean, "limit": 100})
        for row in data.get("rows", []):
            if (row.get("name") or "").strip().lower() == clean.lower():
                self._ce_cache[key] = row.get("meta")
                return self._ce_cache[key]
        created = await self._call("POST", f"entity/customentity/{dict_id}", json_data={"name": clean})
        self._ce_cache[key] = created.get("meta")
        return self._ce_cache[key]

    async def _country_meta(self, name: str) -> Optional[Dict[str, Any]]:
        clean = (name or "").strip()
        if not clean:
            return None
        if clean.lower() not in self._country_cache:
            data = await self._call("GET", "entity/country", params={"search": clean, "limit": 100})
            self._country_cache[clean.lower()] = next(
                (c.get("meta") for c in data.get("rows", []) if (c.get("name") or "").strip().lower() == clean.lower()),
                None
            )
        return self._country_cache[clean.lower()]

    async def find_or_create_product_folder(self, folder_name: str) -> Optional[Dict[str, Any]]:
        if not folder_name:
            return None
        if folder_name in self._folder_cache:
            return self._folder_cache[folder_name]
        data = await self._call("GET", "entity/productfolder", params={"filter": f"name={folder_name}"})
        rows = data.get("rows", [])
        folder = rows[0] if rows else await self._call("POST", "entity/productfolder", json_data={"name": folder_name})
        self._folder_cache[folder_name] = folder
        return folder

    async def find_products_by_articles(self, articles: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """Artikul bo'yicha mavjud tovarlar (bir maydon bir necha marta = OR filtri).
        Razmer rejimida bitta artikulda bir nechta tovar bo'ladi (har bir razmer alohida)"""
        found: Dict[str, List[Dict[str, Any]]] = {}
        unique = list(dict.fromkeys(a for a in articles if a))
        for i in range(0, len(unique), BULK_CHUNK):
            chunk = unique[i:i + BULK_CHUNK]
            data = await self._call("GET", "entity/product", params={"filter": ";".join(f"article={a}" for a in chunk), "limit": 1000})
            for p in data.get("rows", []):
                found.setdefault((p.get("article") or "").strip(), []).append(p)
        return found

    def product_size(self, product: Dict[str, Any]) -> str:
        """Tovarning razmer atributi (bog'langan maydon ID bo'yicha, bo'lmasa "Размер" nomi), normallashtirilgan: " m " -> "M" """
        size_id = (self.attribute_map.get("size") or {}).get("attr_id")
        for attr in product.get("attributes", []):
            if (size_id and attr.get("id") == size_id) or (not size_id and attr.get("name") == "Размер"):
                value = attr.get("value")
                value = value.get("name", "") if isinstance(value, dict) else value
                return "".join(str(value or "").split()).upper()
        return ""

    # Ilova maydoni -> MoySklad atributi (ID bo'yicha). documents.py yuborishdan oldin sozlamadan o'rnatadi
    attribute_map: Dict[str, Dict[str, Any]] = {}

    async def build_product_payload(self, item: Dict[str, Any], buy_currency_meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        attrs_by_id = {a.get("id"): a for a in (await self._attributes_map()).values()}
        attributes = []
        for field, entry in self.attribute_map.items():
            if not entry.get("enabled") or not entry.get("attr_id"):
                continue
            meta_info = attrs_by_id.get(entry["attr_id"])
            value = item.get(field)
            if not value or not meta_info:
                continue
            custom_href = meta_info.get("customEntityMeta", {}).get("href", "")
            attr_type = meta_info.get("type", "")
            if custom_href:
                elem_meta = await self._custom_entity_value(custom_href.split("/")[-1], str(value))
                if elem_meta:
                    attributes.append({"meta": meta_info.get("meta"), "value": {"meta": elem_meta}})
            elif attr_type in ("long", "double"):
                try:
                    attributes.append({"meta": meta_info.get("meta"), "value": float(value) if attr_type == "double" else int(float(value))})
                except (TypeError, ValueError):
                    continue
            elif attr_type == "boolean":
                attributes.append({"meta": meta_info.get("meta"), "value": str(value).strip().lower() in ("1", "true", "ha", "да", "yes")})
            else:
                attributes.append({"meta": meta_info.get("meta"), "value": str(value)})

        buy_price: Dict[str, Any] = {"value": round(float(item["price_buy"]) * 100)}
        if buy_currency_meta:
            buy_price["currency"] = {"meta": buy_currency_meta}

        sale_price: Dict[str, Any] = {"value": round(float(item["price_sale"]) * 100)}
        pt_meta = await self._price_type()
        if pt_meta:
            sale_price["priceType"] = {"meta": pt_meta}

        # Kod — ilova bergan unikal kalit (ketma-ket, qaytarilmaydi). Shtrixkodni MoySklad o'zi beradi
        payload: Dict[str, Any] = {
            "name": item["full_name"],
            "code": item["code"],
            "article": item["articul"],
            "description": item.get("description") or "",
            "buyPrice": buy_price,
            "salePrices": [sale_price],
            "attributes": attributes,
        }
        folder = await self.find_or_create_product_folder(item.get("group_name") or item.get("category") or "")
        if folder and folder.get("meta"):
            payload["productFolder"] = {"meta": folder["meta"]}
        country_meta = await self._country_meta(item.get("country") or "")
        if country_meta:
            payload["country"] = {"meta": country_meta}
        return payload

    def _same_product(self, product: Dict[str, Any], item: Dict[str, Any], match_size: bool) -> bool:
        if (product.get("article") or "").strip() != item["articul"]:
            return False
        return not match_size or self.product_size(product) == item["product_key"][1]

    async def ensure_products(self, items: List[Dict[str, Any]], buy_currency_meta: Optional[Dict[str, Any]], match_size: bool) -> Dict[tuple, Dict[str, Any]]:
        """Har bir qator uchun MoySklad tovari (kalit — item["product_key"]), KOD bo'yicha:
          - kod MoySklad'da shu artikul(+razmer) tovarida bo'lsa — o'sha tovar (xatodan keyin qayta yuborish);
          - kod boshqa tovarda band bo'lsa yoki shu artikul(+razmer) boshqa kod bilan mavjud bo'lsa — TO'XTATAMIZ
            (takror kod yoki takror tovar yaratilmasin);
          - qolganlari shu kod bilan bulk yaratiladi va MoySklad qaytargan kod tekshiriladi."""
        by_code = await self.find_products_by_codes([it["code"] for it in items])
        by_article = await self.find_products_by_articles([it["articul"] for it in items])
        existing: Dict[tuple, Dict[str, Any]] = {}
        conflicts: List[str] = []
        for it in items:
            label = f"{it['row_index']}-qator ({it['articul']}{' / ' + it['size'] if match_size else ''})"
            owner = by_code.get(it["code"])
            if owner:
                if self._same_product(owner, it, match_size):
                    existing[it["product_key"]] = owner
                else:
                    conflicts.append(f"{label}: kod {it['code']} MoySklad'da boshqa tovarda band — «{owner.get('name')}» ({owner.get('article') or 'artikulsiz'})")
                continue
            twin = next((p for p in by_article.get(it["articul"], []) if self._same_product(p, it, match_size)), None)
            if twin:
                conflicts.append(f"{label}: bu tovar MoySklad'da boshqa kod bilan allaqachon bor — kod {twin.get('code')}")
        if conflicts:
            raise MoySkladError("Kod nazorati: " + " | ".join(conflicts[:5]) + (f" | ... yana {len(conflicts) - 5} ta" if len(conflicts) > 5 else ""))

        to_create = [it for it in items if it["product_key"] not in existing]
        created: List[Dict[str, Any]] = []

        try:
            for i in range(0, len(to_create), BULK_CHUNK):
                chunk = to_create[i:i + BULK_CHUNK]
                payloads = [await self.build_product_payload(it, buy_currency_meta) for it in chunk]
                result = await self._call("POST", "entity/product", json_data=payloads)
                results = result if isinstance(result, list) else [result]
                errors = []
                for it, res in zip(chunk, results):
                    if isinstance(res, dict) and res.get("errors"):
                        errors.append(f"{it['row_index']}-qator ({it['articul']}): " + "; ".join(e.get("error", "") for e in res["errors"]))
                    elif isinstance(res, dict) and res.get("meta"):
                        existing[it["product_key"]] = res
                        created.append(res)
                        if (res.get("code") or "") != it["code"]:
                            errors.append(f"{it['row_index']}-qator: MoySklad kodni {it['code']} o'rniga {res.get('code') or 'bo`sh'} qilib saqladi")
                if errors:
                    raise MoySkladError("Tovar yaratilmadi — " + " | ".join(errors[:5]))
        finally:
            if created:
                self._products_scan = (0.0, [])  # model raqami skaneri keyingi safar yangilansin

        return existing

    # ================= PRIYOMKA (SUPPLY) =================
    async def create_supply_document(
        self,
        organization_id: Optional[str],
        counterparty_id: str,
        store_id: str,
        items: List[Dict[str, Any]],
        doc_number: Optional[str] = None,
        notes: Optional[str] = None,
        doc_date: Optional[str] = None,
        currency: str = "UZS",
        rate: Optional[float] = None,
        match_size: bool = False,
    ) -> Dict[str, Any]:
        try:
            if organization_id:
                org_meta = self.meta("organization", organization_id)
            else:
                orgs = await self.get_organizations()
                if not orgs:
                    return {"status": "error", "message": "MoySklad'da birorta ham Tashkilot (Юрлицо) topilmadi!"}
                org_meta = orgs[0]["meta"]

            if doc_number and await self.supply_exists(doc_number):
                return {"status": "error", "message": f"MoySklad'da №{doc_number} raqamli Приемка allaqachon mavjud. Hujjat raqamini o'zgartiring."}

            currency_meta = None
            if currency == "USD":
                cur = await self.get_currency("USD")
                if not cur:
                    return {"status": "error", "message": "MoySklad'da USD valyutasi topilmadi (Справочники → Валюты)."}
                currency_meta = cur["meta"]

            products = await self.ensure_products(items, currency_meta, match_size)

            positions = [
                {
                    "quantity": float(it["quantity"]),
                    "price": round(float(it["price_buy"]) * 100),  # hujjat valyutasida, tiyin/sentlarda
                    "assortment": {"meta": products[it["product_key"]]["meta"]},
                }
                for it in items
            ]

            payload: Dict[str, Any] = {
                "organization": {"meta": org_meta},
                "agent": {"meta": self.meta("counterparty", counterparty_id)},
                "store": {"meta": self.meta("store", store_id)},
                "positions": positions,
                "description": notes or "Kirim Web Ilova orqali yaratildi",
            }
            if doc_number:
                payload["name"] = str(doc_number)
            moment = self._supply_moment(doc_date)
            if moment:
                payload["moment"] = moment
            if currency_meta:
                payload["rate"] = {"currency": {"meta": currency_meta}, "value": float(rate)}

            data = await self._call("POST", "entity/supply", json_data=payload)
            doc_id = data.get("id", "")
            return {
                "status": "success",
                "document_id": doc_id,
                "document_name": data.get("name", "Приемка"),
                "moysklad_url": f"https://online.moysklad.ru/app/#supply/edit?id={doc_id}",
                "positions_count": len(positions),
                "total_sum": data.get("sum", 0) / 100.0,
            }
        except MoySkladError as e:
            logger.error(f"Supply creation failed: {e}")
            return {"status": "error", "message": str(e)}

    @staticmethod
    def _supply_moment(doc_date: Optional[str]) -> Optional[str]:
        """Nakladnoy sanasi (YYYY-MM-DD). Bugungi yoki kelajak sana bo'lsa MoySklad joriy vaqtni qo'yadi"""
        if not doc_date:
            return None
        try:
            day = datetime.strptime(doc_date[:10], "%Y-%m-%d")
        except ValueError:
            return None
        moscow_now = datetime.utcnow() + timedelta(hours=3)
        if day.date() >= moscow_now.date():
            return None
        return day.strftime("%Y-%m-%d 10:00:00")
