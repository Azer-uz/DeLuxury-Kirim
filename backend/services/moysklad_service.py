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

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip",
            "Lognex-Pretty-Print": "true"
        }

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

    async def create_counterparty(self, name: str, phone: Optional[str] = None, description: Optional[str] = None) -> Dict[str, Any]:
        """Create a new counterparty in MoySklad."""
        payload = {"name": name.strip()}
        if phone:
            payload["phone"] = phone.strip()
        if description:
            payload["description"] = description.strip()

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

    async def find_or_create_product(self, item_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Find product by article/code or create new product in MoySklad.
        """
        articul = (item_data.get("articul") or "").strip()
        name = (item_data.get("full_name") or item_data.get("name") or articul).strip()
        price_buy = float(item_data.get("price_buy", 0.0))
        price_sale = float(item_data.get("price_sale", 0.0))
        description = item_data.get("description", "")
        category_name = item_data.get("category", "")
        brand_name = item_data.get("brand", "")

        async with httpx.AsyncClient(timeout=20.0) as client:
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
            if category_name:
                folder_obj = await self.find_or_create_product_folder(category_name)

            payload: Dict[str, Any] = {
                "name": name,
                "article": articul,
                "code": articul,
                "description": f"{description} | Brand: {brand_name}".strip(" |"),
                "buyPrice": {
                    "value": int(price_buy * 100),  # In kopecks/tiyin
                    "currency": {
                        "meta": {
                            "href": f"{self.base_url}/entity/currency/0",
                            "type": "currency"
                        }
                    }
                },
                "salePrices": [
                    {
                        "value": int(price_sale * 100),
                        "priceType": {
                            "meta": {
                                "href": f"{self.base_url}/context/companysettings/pricetype",
                                "type": "pricetype"
                            },
                            "name": "Цена продажи"
                        }
                    }
                ]
            }

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
