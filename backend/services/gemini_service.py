import json
import base64
import logging
import io
import httpx
from typing import Dict, Any, List, Union
from PIL import Image, ImageOps
from backend.config import get_settings

logger = logging.getLogger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GEMINI_MODELS = [
    "gemini-3-flash-preview",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
]

class GeminiService:
    def __init__(self):
        self.settings = get_settings()
        self.api_key = self.settings.gemini_api_key

    def normalize_image(self, image_bytes: bytes) -> bytes:
        """
        EXIF bo'yicha to'g'rilaydi va JPEG ga o'tkazadi. Majburan burmaymiz: tik (portret) nakladnoylar ham bor,
        burilgan rasmni esa Gemini o'zi o'qiydi (promptda aytilgan).
        """
        try:
            im = Image.open(io.BytesIO(image_bytes))
            im = ImageOps.exif_transpose(im)
            # Juda katta rasm so'rovni sekinlashtiradi — 2400 px gacha kichraytiramiz
            im.thumbnail((2400, 2400))

            if im.mode in ("RGBA", "P"):
                im = im.convert("RGB")
            
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=90)
            return buf.getvalue()
        except Exception as e:
            logger.warning(f"Image normalization skipped: {e}")
            return image_bytes

    async def parse_invoice_image(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        reference_context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Parse waybill / invoice image (printed or handwritten) and extract structured header and line items.
        """
        if not self.api_key:
            logger.warning("Gemini API key is not configured.")
            return {"kontragent": "", "phone": "", "date": "", "rows": []}

        # Normalize orientation
        norm_bytes = self.normalize_image(image_bytes)
        b64_image = base64.b64encode(norm_bytes).decode("utf-8")

        prompt = """
Siz kiyim-kechak do'koni uchun kirim hisob-faktura (накладная / счёт-фактура / invoice) varaqasini o'qib beruvchi sun'iy intellektsiz.
Ushbu varaq qo'lda yozilgan (рукописная) yoki bosilgan bo'lishi mumkin.

DIQQAT:
1. Rasm har qanday burchakda (gorizontal yoki vertikal, 90 gradus burilgan) bo'lishi mumkin. Varaq matnlarini to'g'ri o'qing!
2. VARAQ SHAPKASI (YUQORI QISMI):
   - "Контрагент:" chizig'ida yozilgan ism/firma, yoki agar chiziq bo'sh bo'lsa, varaqning eng yuqori hoshiyasida ruchka bilan yozilgan ism (masalan: "Хиро", "Хирож" va h.k.).
   - "Тел. Номер:" telefon raqami (agar bo'lsa).
   - "Дата:" sana (agar bo'lsa).

3. JADVAL USTUNLARI (har bir tovar qatori uchun):
   - №: qator raqami (1, 2, 3...)
   - "Вид товар": tovar turi. DIQQAT: Har doim kiyimlar spravochnigi bo'yicha standart RUSCHA nomda yozing:
     * Amerikanka -> "Американка"
     * Dvoyka / Dvoyka S.K. -> "Двойка"
     * Dvoyka sport -> "Спортивка двойка"
     * Svitr -> "Свитер"
     * Futbolka -> "Футболка"
     * Vitrovka / Vitrovka koja -> "Ветровка"
     * Bezrukavka -> "Жилет безрукавка"
     * Kurtka -> "Куртка"
     * Kojinka -> "Куртка кожаная"
     * Pidjak -> "Пиджак"
     * Kardigan -> "Кардиган"
     * Rubashka -> "Рубашка"
     (Lotincha yozilmasin, toza ruscha spravochnik nomi bo'lsin!)
   - "Артикул": nakladnoydagi zavod artikul kodi (masalan: 88-020, 598581L, 59205, 2708, 6127, 62960-6, 99902, 99901, 99908...). Bu qiymat "articul" maydoniga o'zgarishsiz yoziladi.
   - "Бренд": brend nomi (masalan: Gratude, Brunello C, Loro P, Ganiani, Adidas, Artepro, Mandelli, Minlior, Grand Defile, Liwali, Razza, Renzo Rinal...)
   - "Образ Жизni": obraz jizni / lifestyle (masalan: Sport, Casual, Klassika, agar bo'sh bo'lsa "")
   - "Сезон": mavsum (agar yozilgan bo'lsa o'sha, bo'sh bo'lsa "Весна-Осень")
   - "Размерный ряд": razmer (masalan: 48-56, L-4XL, M-3XL, 48-58, S-XL)
   - "Кол-во": tovar soni. DIQQAT: Agar jadvalda "5x2" bo'lsa 5 * 2 = 10 dona, agar "5x3" bo'lsa 15 dona, "5x11" bo'lsa 55 dona, "6x2" bo'lsa 12 dona, "5x6" bo'lsa 30 dona, "5x10" bo'lsa 50 dona, "5" bo'lsa 5 dona deb umumiy dona sonini "quantity" ga raqam sifatida yozing. Asl yozuvni esa "raw_quantity" ga yozing (masalan "5x2").
   - "Закуп Цена": tan narx / sotib olish narxi (masalan: 180, 400, 200, 130, 420...)
   - "Продажная Цена": sotish narxi (masalan: 225, 555, 245, 195, 495...)

Javobni quyidagi aniq JSON formatida qaytaring:
{
  "kontragent": "...",
  "phone": "...",
  "date": "...",
  "rows": [
    {
      "row_no": 1,
      "product_type": "Американка",
      "articul": "88-020",
      "brand": "Gratude",
      "lifestyle": "",
      "season": "Весна-Осень",
      "size": "48-56",
      "quantity": 5,
      "raw_quantity": "5",
      "price_buy": 180.0,
      "price_sale": 225.0,
      "confidence": 0.95
    }
  ]
}

QOIDALAR:
1. Jadvaldagi barcha qatorlarni to'liq o'qing.
2. "Вид товар" maydoniga lotincha emas, faqat ruscha spravochnik nomini yozing.
3. Faqat toza JSON formatida javob bering, hech qanday ortiqcha matn qo'shmang.
"""
        known_types = (reference_context or {}).get("known_product_types") or []
        if known_types:
            prompt += (
                "\n4. \"product_type\" qiymati IMKON QADAR quyidagi ierarxiya ro'yxatidagi nomlardan biri bo'lsin "
                "(eng yaqin mosini tanlang):\n" + ", ".join(known_types) + "\n"
            )

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/jpeg",
                                "data": b64_image
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json"
            }
        }

        # Model band bo'lsa (503) keyingisiga o'tamiz. Kalit URL'da emas, sarlavhada — loglarga tushmaydi
        async with httpx.AsyncClient(timeout=120.0) as client:
            for model_name in GEMINI_MODELS:
                try:
                    resp = await client.post(
                        GEMINI_URL.format(model=model_name),
                        json=payload,
                        headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            content_text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                            if content_text.startswith("```"):
                                lines = content_text.splitlines()
                                if lines and lines[0].startswith("```"):
                                    lines = lines[1:]
                                if lines and lines[-1].strip().startswith("```"):
                                    lines = lines[:-1]
                                content_text = "\n".join(lines).strip()

                            parsed = json.loads(content_text)
                            if isinstance(parsed, dict):
                                return parsed
                            elif isinstance(parsed, list):
                                return {"kontragent": "", "phone": "", "date": "", "rows": parsed}
                    else:
                        logger.warning(f"Model {model_name} returned status {resp.status_code}, trying next model...")
                        continue
                except Exception as e:
                    logger.warning(f"Error calling {model_name}: {e}")
                    continue

        return {"kontragent": "", "phone": "", "date": "", "rows": []}
