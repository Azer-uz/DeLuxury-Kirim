import httpx
import logging
from typing import Dict, Any, List, Optional
from backend.config import get_settings

logger = logging.getLogger(__name__)

class MoySkladService:
    def __init__(self):
        self.settings = get_settings()
        self.base_url = self.settings.moysklad_api_url.rstrip("/")
        self.token = self.settings.moysklad_token
        self._price_type_meta: Optional[Dict[str, Any]] = None
        self._attrs_metadata: Optional[List[Dict[str, Any]]] = None
        self._ce_cache: Dict[str, Dict[str, Any]] = {}
        self._country_cache: Dict[str, Dict[str, Any]] = {}

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip",
            "Lognex-Pretty-Print": "true"
        }

    async def get_max_product_code(self) -> int:
        """Get the highest numeric product code currently in MoySklad."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(
                    f"{self.base_url}/entity/product?order=code,desc&limit=10",
                    headers=self._headers()
                )
                if resp.status_code == 200:
                    for p in resp.json().get("rows", []):
                        c = p.get("code")
                        if c and str(c).isdigit():
                            return int(c)
            except Exception as e:
                logger.warning(f"Error getting max product code: {e}")
        return 658

    async def get_default_price_type_meta(self, client: httpx.AsyncClient) -> Optional[Dict[str, Any]]:
        if self._price_type_meta:
            return self._price_type_meta
        try:
            resp = await client.get(f"{self.base_url}/context/companysettings/pricetype", headers=self._headers())
            if resp.status_code == 200:
                pts = resp.json()
                if pts:
                    for pt in pts:
                        if pt.get("name") == "Цена продажи":
                            self._price_type_meta = pt.get("meta")
                            return self._price_type_meta
                    self._price_type_meta = pts[0].get("meta")
                    return self._price_type_meta
        except Exception as e:
            logger.warning(f"Error fetching price types: {e}")
        return None

    async def get_product_attributes_metadata(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        if self._attrs_metadata:
            return self._attrs_metadata
        try:
            resp = await client.get(f"{self.base_url}/entity/product/metadata/attributes", headers=self._headers())
            if resp.status_code == 200:
                self._attrs_metadata = resp.json().get("rows", [])
                return self._attrs_metadata
        except Exception as e:
            logger.warning(f"Error fetching product attributes metadata: {e}")
        return []

    async def resolve_custom_entity_value(self, client: httpx.AsyncClient, dict_id: str, value_name: str) -> Optional[Dict[str, Any]]:
        if not value_name or not str(value_name).strip():
            return None
        clean_val = str(value_name).strip()
        cache_key = f"{dict_id}:{clean_val.lower()}"
        if cache_key in self._ce_cache:
            return self._ce_cache[cache_key]
        try:
            search_url = f"{self.base_url}/entity/customentity/{dict_id}?search={clean_val}"
            r = await client.get(search_url, headers=self._headers())
            if r.status_code == 200:
                for row in r.json().get("rows", []):
                    if row.get("name", "").strip().lower() == clean_val.lower():
                        meta = row.get("meta")
                        self._ce_cache[cache_key] = meta
                        return meta
            post_r = await client.post(
                f"{self.base_url}/entity/customentity/{dict_id}",
                headers=self._headers(),
                json={"name": clean_val}
            )
            if post_r.status_code in [200, 201]:
                meta = post_r.json().get("meta")
                self._ce_cache[cache_key] = meta
                return meta
        except Exception as e:
            logger.warning(f"Error resolving custom entity '{clean_val}' in {dict_id}: {e}")
        return None

    async def resolve_country_meta(self, client: httpx.AsyncClient, country_name: str) -> Optional[Dict[str, Any]]:
        if not country_name or not str(country_name).strip():
            return None
        clean_name = str(country_name).strip()
        cache_key = clean_name.lower()
        if cache_key in self._country_cache:
            return self._country_cache[cache_key]
        try:
            r = await client.get(f"{self.base_url}/entity/country?search={clean_name}", headers=self._headers())
            if r.status_code == 200:
                for c in r.json().get("rows", []):
                    if c.get("name", "").strip().lower() == clean_name.lower():
                        meta = c.get("meta")
                        self._country_cache[cache_key] = meta
                        return meta
        except Exception as e:
            logger.warning(f"Error resolving country {country_name}: {e}")
        return None

    async def find_or_create_product(self, item_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Find product by article/code or create new product in MoySklad with full attributes & priceType.
        """
        articul = (item_data.get("articul") or "").strip()
        name = (item_data.get("full_name") or item_data.get("name") or articul).strip()
        price_buy = float(item_data.get("price_buy", 0.0))
        price_sale = float(item_data.get("price_sale", 0.0))
        description = item_data.get("description", "")
        category_name = item_data.get("category", "")
        brand_name = item_data.get("brand", "")

        async with httpx.AsyncClient(timeout=25.0) as client:
            # 1. Search by article / code
            if articul:
                search_url = f"{self.base_url}/entity/product?filter=article={articul}"
                resp = await client.get(search_url, headers=self._headers())
                if resp.status_code == 200:
                    rows = resp.json().get("rows", [])
                    if rows:
                        return {"status": "found", "product": rows[0]}

            # 2. Search by exact name
            if name:
                search_name_url = f"{self.base_url}/entity/product?filter=name={name}"
                resp2 = await client.get(search_name_url, headers=self._headers())
                if resp2.status_code == 200:
                    rows2 = resp2.json().get("rows", [])
                    if rows2:
                        return {"status": "found", "product": rows2[0]}

            # 3. Create new product
            folder_obj = None
            group_name = (item_data.get("group_name") or "").strip()
            folder_target = group_name or category_name
            if folder_target:
                folder_obj = await self.find_or_create_product_folder(folder_target)

            # Code resolution: exactly 5 digits matching articul suffix (e.g. 00659)
            code_val = (item_data.get("code") or "").strip()
            if not code_val and articul and len(articul) >= 5 and articul[-5:].isdigit():
                code_val = articul[-5:]
            elif not code_val:
                code_val = articul

            # PriceType resolution
            pt_meta = await self.get_default_price_type_meta(client)
            sale_prices = []
            if pt_meta:
                sale_prices.append({
                    "value": int(price_sale * 100),
                    "priceType": {"meta": pt_meta}
                })
            else:
                sale_prices.append({
                    "value": int(price_sale * 100)
                })

            # Custom Attributes resolution
            attrs_metadata = await self.get_product_attributes_metadata(client)
            attr_map = {a.get("name"): a for a in attrs_metadata if a.get("name")}

            attr_values_to_set = [
                ("Категория", item_data.get("category")),
                ("Вид товара", item_data.get("product_type")),
                ("Коллекция", item_data.get("collection") or "AW26"),
                ("Сезон", item_data.get("season") or "Весна-Осень"),
                ("Бренд", item_data.get("brand") or "De Luxury"),
                ("Модель", item_data.get("calculated_model") or item_data.get("model_code")),
                ("Код модели", item_data.get("factory_code") or item_data.get("model_code")),
                ("Размер", item_data.get("size")),
                ("Цвет", item_data.get("color"))
            ]

            attributes_payload = []
            for attr_name, val_str in attr_values_to_set:
                if not val_str:
                    continue
                meta_info = attr_map.get(attr_name)
                if not meta_info:
                    continue
                attr_type = meta_info.get("type", "").lower()
                if attr_type in ["string", "text", "link"]:
                    attributes_payload.append({
                        "meta": meta_info.get("meta"),
                        "value": str(val_str)
                    })
                elif attr_type == "customentity":
                    custom_href = meta_info.get("customEntityMeta", {}).get("href", "")
                    if custom_href:
                        dict_id = custom_href.split("/")[-1]
                        elem_meta = await self.resolve_custom_entity_value(client, dict_id, str(val_str))
                        if elem_meta:
                            attributes_payload.append({
                                "meta": meta_info.get("meta"),
                                "value": {"meta": elem_meta}
                            })
                else:
                    # Fallback for generic types
                    custom_href = meta_info.get("customEntityMeta", {}).get("href", "")
                    if custom_href:
                        dict_id = custom_href.split("/")[-1]
                        elem_meta = await self.resolve_custom_entity_value(client, dict_id, str(val_str))
                        if elem_meta:
                            attributes_payload.append({
                                "meta": meta_info.get("meta"),
                                "value": {"meta": elem_meta}
                            })
                    else:
                        attributes_payload.append({
                            "meta": meta_info.get("meta"),
                            "value": str(val_str)
                        })

            payload: Dict[str, Any] = {
                "name": name,
                "article": articul,
                "code": code_val,
                "description": f"{description} | Brand: {brand_name}".strip(" |"),
                "buyPrice": {
                    "value": int(price_buy * 100)
                },
                "salePrices": sale_prices,
                "attributes": attributes_payload
            }

            # Country
            country_name = item_data.get("country")
            if country_name:
                c_meta = await self.resolve_country_meta(client, country_name)
                if c_meta:
                    payload["country"] = {"meta": c_meta}

            if folder_obj and "meta" in folder_obj:
                payload["productFolder"] = {"meta": folder_obj["meta"]}

            create_resp = await client.post(
                f"{self.base_url}/entity/product",
                headers=self._headers(),
                json=payload
            )

            if create_resp.status_code in [200, 201]:
                return {"status": "created", "product": create_resp.json()}
            else:
                error_msg = f"Mahsulot yaratishda xatolik ({create_resp.status_code}): {create_resp.text}"
                logger.error(error_msg)
                return {"status": "error", "message": error_msg}

    async def test_connection(self) -> Dict[str, Any]:
        """Verify API token and get organization account details."""
        if not self.token:
            return {"status": "error", "message": "MoySklad API token kiritilmagan (.env faylida MOYSKLAD_TOKEN yo'q)"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(f"{self.base_url}/entity/organization", headers=self._headers())
                if resp.status_code == 200:
                    data = resp.json()
                    orgs = data.get("rows", [])
                    org_name = orgs[0].get("name", "Noma'lum") if orgs else "Tashkilot topilmadi"
                    return {
                        "status": "connected",
                        "organization_name": org_name,
                        "organizations": orgs,
                        "message": f"Ulanish muvaffaqiyatli: {org_name}"
                    }
                else:
                    return {
                        "status": "error",
                        "status_code": resp.status_code,
                        "message": f"MoySklad API xatosi ({resp.status_code}): {resp.text}"
                    }
            except Exception as e:
                logger.exception("MoySklad connection test failed")
                return {"status": "error", "message": f"Ulanishda xatolik: {str(e)}"}

    async def get_stores(self) -> List[Dict[str, Any]]:
        """Get list of warehouses/stores (omborlar)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(f"{self.base_url}/entity/store?limit=100", headers=self._headers())
                if resp.status_code == 200:
                    return resp.json().get("rows", [])
                return []
            except Exception as e:
                logger.error(f"Error fetching stores: {e}")
                return []

    async def get_counterparties(self) -> List[Dict[str, Any]]:
        """Get list of suppliers/counterparties (kontragentlar / yetkazib beruvchilar)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(f"{self.base_url}/entity/counterparty?limit=100", headers=self._headers())
                if resp.status_code == 200:
                    return resp.json().get("rows", [])
                return []
            except Exception as e:
                logger.error(f"Error fetching counterparties: {e}")
                return []

    async def create_counterparty(self, name: str, phone: Optional[str] = None, description: Optional[str] = None, tag: Optional[str] = None) -> Dict[str, Any]:
        """Create a new counterparty in MoySklad."""
        payload = {"name": name.strip()}
        if phone:
            payload["phone"] = phone.strip()
        if description:
            payload["description"] = description.strip()
        if tag:
            payload["tags"] = [tag.strip()]

        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.post(f"{self.base_url}/entity/counterparty", headers=self._headers(), json=payload)
                if resp.status_code in (200, 201):
                    return {"status": "created", "counterparty": resp.json()}
                else:
                    return {"status": "error", "message": f"MoySklad xatosi: {resp.text}"}
            except Exception as e:
                logger.error(f"Error creating counterparty: {e}")
                return {"status": "error", "message": str(e)}

    async def get_next_supply_number(self) -> str:
        """Find the latest Supply (Приемка) document number and calculate the next 5-digit number (e.g. 00035)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(f"{self.base_url}/entity/supply?order=moment,desc&limit=30", headers=self._headers())
                if resp.status_code == 200:
                    rows = resp.json().get("rows", [])
                    highest = 0
                    for r in rows:
                        name = (r.get("name") or "").strip()
                        # Extract digits
                        digits_only = "".join(ch for ch in name if ch.isdigit())
                        if digits_only:
                            try:
                                val = int(digits_only)
                                if val > highest:
                                    highest = val
                            except ValueError:
                                pass
                    if highest > 0:
                        return f"{highest + 1:05d}"
            except Exception as e:
                logger.error(f"Error determining next supply number: {e}")
        return "00035"

    async def get_organizations(self) -> List[Dict[str, Any]]:
        """Get list of organizations (yuridik shaxslar)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(f"{self.base_url}/entity/organization?limit=100", headers=self._headers())
                if resp.status_code == 200:
                    return resp.json().get("rows", [])
                return []
            except Exception as e:
                logger.error(f"Error fetching organizations: {e}")
                return []

    async def get_product_folders(self) -> List[Dict[str, Any]]:
        """Get product groups/folders (Группы товаров / Категории)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(f"{self.base_url}/entity/productfolder?limit=100", headers=self._headers())
                if resp.status_code == 200:
                    return resp.json().get("rows", [])
                return []
            except Exception as e:
                logger.error(f"Error fetching product folders: {e}")
                return []

    async def find_or_create_product_folder(self, folder_name: str) -> Optional[Dict[str, Any]]:
        """Find product folder by name or create if missing."""
        if not folder_name:
            return None
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                # Search existing
                resp = await client.get(
                    f"{self.base_url}/entity/productfolder?filter=name={folder_name}",
                    headers=self._headers()
                )
                if resp.status_code == 200:
                    rows = resp.json().get("rows", [])
                    if rows:
                        return rows[0]
                
                # Create new folder
                create_resp = await client.post(
                    f"{self.base_url}/entity/productfolder",
                    headers=self._headers(),
                    json={"name": folder_name}
                )
                if create_resp.status_code in [200, 201]:
                    return create_resp.json()
            except Exception as e:
                logger.error(f"Error finding/creating product folder {folder_name}: {e}")
        return None

    async def create_supply_document(
        self,
        organization_id: Optional[str],
        counterparty_id: Optional[str],
        store_id: Optional[str],
        items: List[Dict[str, Any]],
        doc_number: Optional[str] = None,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create MoySklad Supply (Приемка / Приход) document with positions.
        """
        # Ensure default org, counterparty, store if not provided
        async with httpx.AsyncClient(timeout=30.0) as client:
            # 1. Fetch organization meta if missing
            org_meta = None
            if organization_id:
                org_meta = {"href": f"{self.base_url}/entity/organization/{organization_id}", "type": "organization"}
            else:
                orgs = await self.get_organizations()
                if orgs:
                    org_meta = orgs[0]["meta"]
                else:
                    return {"status": "error", "message": "MoySklad'da birorta ham Tashkilot (Юрлицо) topilmadi!"}

            # 2. Fetch counterparty meta if missing
            agent_meta = None
            if counterparty_id:
                agent_meta = {"href": f"{self.base_url}/entity/counterparty/{counterparty_id}", "type": "counterparty"}
            else:
                counterparties = await self.get_counterparties()
                if counterparties:
                    agent_meta = counterparties[0]["meta"]
                else:
                    return {"status": "error", "message": "MoySklad'da yetkazib beruvchi (Kontragent) topilmadi!"}

            # 3. Fetch store meta if missing
            store_meta = None
            if store_id:
                store_meta = {"href": f"{self.base_url}/entity/store/{store_id}", "type": "store"}
            else:
                stores = await self.get_stores()
                if stores:
                    store_meta = stores[0]["meta"]
                else:
                    return {"status": "error", "message": "MoySklad'da ombor (Склад) topilmadi!"}

            # 4. Prepare positions
            positions = []
            created_products = []

            for idx, item in enumerate(items, 1):
                # Ensure product exists in MoySklad
                prod_result = await self.find_or_create_product(item)
                if prod_result.get("status") in ["found", "created"]:
                    prod = prod_result["product"]
                    created_products.append(prod)
                    qty = float(item.get("quantity", 1.0))
                    price = float(item.get("price_buy", 0.0))

                    positions.append({
                        "quantity": qty,
                        "price": int(price * 100),  # in kopecks / tiyin
                        "assortment": {
                            "meta": prod["meta"]
                        }
                    })
                else:
                    return {
                        "status": "error",
                        "message": f"Qator #{idx} mahsuloti MoySklad'da yaratilmadi: {prod_result.get('message', 'Noma\'lum xatolik')}"
                    }

            if not positions:
                return {"status": "error", "message": "Hujjatda birorta ham to'g'ri mahsulot qatori yo'q!"}

            # 5. Build Supply payload
            supply_payload: Dict[str, Any] = {
                "organization": {"meta": org_meta},
                "agent": {"meta": agent_meta},
                "store": {"meta": store_meta},
                "positions": positions,
                "description": notes or "Kirim Web Ilova orqali avtomatik yaratildi (De Luxury)"
            }

            if doc_number:
                supply_payload["name"] = str(doc_number)

            supply_resp = await client.post(
                f"{self.base_url}/entity/supply",
                headers=self._headers(),
                json=supply_payload
            )

            if supply_resp.status_code in [200, 201]:
                data = supply_resp.json()
                doc_name = data.get("name", "Приемка")
                doc_id = data.get("id", "")
                ui_url = f"https://online.moysklad.ru/app/#supply/edit?id={doc_id}"
                
                return {
                    "status": "success",
                    "document_id": doc_id,
                    "document_name": doc_name,
                    "moysklad_url": ui_url,
                    "positions_count": len(positions),
                    "total_sum": data.get("sum", 0) / 100.0,
                    "raw_data": data
                }
            else:
                error_text = f"MoySklad Supply yaratishda xatolik ({supply_resp.status_code}): {supply_resp.text}"
                logger.error(error_text)
                return {"status": "error", "message": error_text}
