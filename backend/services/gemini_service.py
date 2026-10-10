import json
import base64
import logging
import httpx
from typing import Dict, Any, List
from backend.config import get_settings

logger = logging.getLogger(__name__)

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

class GeminiService:
    def __init__(self):
        self.settings = get_settings()
        self.api_key = self.settings.gemini_api_key

    async def parse_invoice_image(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        reference_context: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        Parse waybill / invoice image and extract structured line items matching reference catalog.
        """
        if not self.api_key:
            logger.warning("Gemini API key is not configured.")
            return []

        b64_image = base64.b64encode(image_bytes).decode("utf-8")

        # Provide brief reference context to guide normalization
        known_vid = (reference_context or {}).get("known_product_types", [])[:80]
        known_brands = (reference_context or {}).get("known_brands", [])[:40]
        known_seasons = (reference_context or {}).get("known_seasons", [])

        prompt = f"""
Siz kiyim-kechak do'koni uchun tovar kirim (накладная / счёт-фактура / invoice) rasmini o'qib, jadval qatorlarini chiqarib beruvchi sun'iy intellektsiz.

Rasmdagi har bir tovar qatorini aniqlab, quyidagi JSON formatida qaytaring:
[
  {{
    "country": "Страна (masalan: Турция, Италия, Китай, Узбекистан)",
    "product_type": "Вид товара (ruscha, masalan: Футболка, Джинсы, Куртка, Рубашка, Свитер, Платье, Ремень)",
    "brand": "Бренд (masalan: Zara, De Luxury, Massimo Dutti, Lacoste va h.k.)",
    "collection": "Коллекция (masalan: AW26, SS26, CONT)",
    "season": "Сезон (masalan: Весна-Осень, Зима, Лето)",
    "size": "Размер (masalan: S, M, L, XL, 42, 44, 46)",
    "description": "Описание / Rang / Fason qisqa tavsifi",
    "model_code": "Код модели (agar rasmda bo'lsa)",
    "quantity": 1.0 (soni),
    "price_buy": 15.0 (sotib olish narxi / tan narx),
    "price_sale": 35.0 (sotish narxi; agar rasmda yo'q bo'lsa, price_buy * 2.2 qilib hisoblang),
    "confidence": 0.95 (0.0 dan 1.0 gacha ishonchlilik darajasi),
    "low_confidence_fields": ["maydon1", "maydon2"] (agar biror maydon aniq ko'rinmasa yoki taxmin qilingan bo'lsa)
  }}
]

QOIDALAR:
1. Qatorlarni bo'sh qoldirmang, eng yaqin mos keladigan qiymatlarni tanlang.
2. Agar biror qiymatga ishonchingiz komil bo'lmasa, confidence qiymatini 0.7 dan past qiling va low_confidence_fields ro'yxatiga o'sha maydon nomini kiriting.
3. Faqat toza JSON array qaytaring (hech qanday qo'shimcha matnsiz).

Ma'lumotlar bazasidagi namunaviy turlar:
{", ".join(known_vid[:40]) if known_vid else "Футболка, Джинсы, Куртка, Блузка, Свитер, Платье, Рубашка"}
"""

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": b64_image
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "response_mime_type": "application/json"
            }
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            try:
                resp = await client.post(
                    f"{GEMINI_API_URL}?key={self.api_key}",
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )

                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        content_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        # Parse JSON array
                        content_text = content_text.strip()
                        if content_text.startswith("```json"):
                            content_text = content_text[7:]
                        if content_text.endswith("```"):
                            content_text = content_text[:-3]
                        parsed_items = json.loads(content_text.strip())
                        if isinstance(parsed_items, list):
                            return parsed_items
                else:
                    logger.error(f"Gemini API error ({resp.status_code}): {resp.text}")
            except Exception as e:
                logger.exception("Failed to parse invoice with Gemini API")

        return []
