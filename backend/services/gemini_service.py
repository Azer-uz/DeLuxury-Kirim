import json
import base64
import logging
import io
import httpx
from typing import Dict, Any, List, Union
from PIL import Image, ImageOps
from backend.config import get_settings

try:  # iPhone HEIC/HEIF rasmlari
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIF_OK = True
except Exception:  # pragma: no cover
    HEIF_OK = False

logger = logging.getLogger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GEMINI_MODELS = [
    "gemini-3-flash-preview",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
]

class GeminiService:
    _quota_block: Dict[str, float] = {}   # model -> shu vaqtgacha chetlab o'tiladi (429 kvota)

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
            self.last_reason = f"Rasm formati o'qilmadi ({e.__class__.__name__}). JPG/PNG yuboring" + ("" if HEIF_OK else "; HEIC uchun serverda pillow-heif kerak")
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
        self.last_reason = ""
        if not self.api_key:
            logger.warning("Gemini API key is not configured.")
            self.last_reason = "GEMINI_API_KEY sozlanmagan (.env)"
            return {"kontragent": "", "phone": "", "date": "", "rows": [], "reason": self.last_reason}

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
     * Vitrovka -> "Ветровка"
     * Vitrovka koja / Koja kurtka / Ветровка кожа -> "Куртка кожаная" (yoki ro'yxatdagi shunga o'xshash nom)
     * Bezrukavka -> "Жилет безрукавка"
     * Kurtka -> "Куртка"
     * Kojinka -> "Куртка кожаная"
     * Pidjak -> "Пиджак"
     * Kardigan -> "Кардиган"
     * Rubashka -> "Рубашка"
     (Lotincha yozilmasin, toza ruscha spravochnik nomi bo'lsin!)
     MUHIM: "Вид товар" katagida tur nomidan tashqari qo'shimcha so'zlar ham bo'ladi (material, fason, izoh: "замиш", "йока", "кожа", "утеплённый", "с капюшоном", "на молнии"...).
     * "product_type" ga FAQAT spravochnikdagi tur nomini yozing — ro'yxatdan eng mosini tanlang. Masalan "ветровка замиш йока кожа" -> "Куртка кожаная" (ro'yxatda qanday yozilgan bo'lsa shunday).
     * Qolgan so'zlarni asl yozilishida "description" ga yozing: "замиш йока". Agar qo'shimcha so'z bo'lmasa "description": "".
     * Katakdagi asl matnni to'liq "raw_product_type" ga yozing: "ветровка замиш йока кожа".
   - "Артикул": nakladnoydagi zavod artikul kodi (masalan: 88-020, 598581L, 59205, 2708, 6127, 62960-6, 99902, 99901, 99908...). Bu qiymat "articul" maydoniga o'zgarishsiz yoziladi.
   - "Бренд": brend nomi (masalan: Gratude, Brunello C, Loro P, Ganiani, Adidas, Artepro, Mandelli, Minlior, Grand Defile, Liwali, Razza, Renzo Rinal...)
   - "Образ Жизni": obraz jizni / lifestyle (masalan: Sport, Casual, Klassika, agar bo'sh bo'lsa "")
   - "Сезон": mavsum (agar yozilgan bo'lsa o'sha, bo'sh bo'lsa "Весна-Осень")
   - "Серия": seriyadagi dona soni (masalan: 5, 6, 8, 10) -> "series" (matn sifatida, bo'sh bo'lsa "")
   - "Размерный ряд": razmer (masalan: 48-56, L-4XL, M-3XL, 48-58, S-XL)
   - "Цвет": rang — nakladnoyda qanday yozilgan bo'lsa shunday (masalan: K.BORDO, K.KAHVA, INDIGO, KLACI, K.GRI, Siyah, Beyaz). Rang yonidagi "59#", "36#" kabi raqam/belgilar rang kodi — ularni "color" ga qo'shmang, "color" faqat rang nomi; kodni rangdan keyin bo'sh joy bilan "color" katagida qoldiring ("INDIGO 59#" deb yozsangiz ham bo'ladi — ilova o'zi ajratadi). Bitta katakda bir nechta rang bo'lsa "colors" ro'yxatiga hammasini yozing.
   - "Повтор" / "povtor" / "повторный" yozuvi (odatda "Вид товар" katagida yoki tovar nomi ostida) — bu TOVAR BAZADA ALLAQACHON BOR degan BELGI. Uni product_type, description yoki articul ga YOZMANG; shu tovar qatoriga (va uning davom qatorlariga) "repeat": true qo'ying.
   - DAVOM QATORLARI (JUDA MUHIM): agar qatorda "Вид товар", "Артикул", "Бренд" kataklari BO'SH bo'lsa (yoki "Повтор", "povtor", "-//-", "〃", "тоже" yozilgan bo'lsa), lekin rang / soni / narx bor — bu YUQORIDAGI tovarning BOSHQA RANGI.
     Bunday qatorda product_type, raw_product_type, description, articul, brand, series, size, season ni yuqoridagi to'ldirilgan qatordan AYNAN ko'chiring va "same_model_as_prev": true qo'ying.
     Masalan: 3-qator "KLASSIC-shim GF-817 GRANDE-FALCO 8 30-38 INDIGO 112" va 4-6 qatorlar faqat "KAHVA 72", "KLACI 56", "K.GRI 72" — bu bitta model GF-817 ning 4 ta rangi: 4 ta qator, hammasida bir xil tur/artikul/brend, same_model_as_prev: true (3-qatorda false).
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
      "raw_product_type": "Американка",
      "description": "",
      "articul": "88-020",
      "brand": "Gratude",
      "lifestyle": "",
      "season": "Весна-Осень",
      "series": "5",
      "size": "48-56",
      "color": "K.Bordo",
      "colors": ["K.Bordo"],
      "same_model_as_prev": false,
      "repeat": false,
      "quantity": 5,
      "raw_quantity": "5",
      "price_buy": 180.0,
      "price_sale": 225.0,
      "confidence": 0.95
    }
  ]
}

QOIDALAR:
1. Jadvaldagi barcha qatorlarni to'liq o'qing — rang/soni/narxi bor har bir qator alohida JSON qator (davom qatorlari ham!).
2. "Вид товар" maydoniga lotincha emas, faqat ruscha spravochnik nomini yozing.
3. Faqat toza JSON formatida javob bering, hech qanday ortiqcha matn qo'shmang.
"""
        ds = (reference_context or {}).get("default_season")
        if ds and ds != "Весна-Осень":
            prompt = prompt.replace("Весна-Осень", ds)  # standart sezon — Sozlamalardan
        known_types = (reference_context or {}).get("known_product_types") or []
        if known_types:
            prompt += (
                "\n4. \"product_type\" qiymati FAQAT quyidagi ierarxiya ro'yxatidagi nomlardan biri bo'lsin "
                "(eng yaqin mosini tanlang, ro'yxatdagi yozilishini o'zgartirmang; tur nomiga kirmagan so'zlar \"description\" ga):\n" + ", ".join(known_types) + "\n"
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

        # Model band bo'lsa (503) — 2 marta qayta urinamiz, keyin keyingi model; kvota tugagan (429) model 10 daqiqa chetlab o'tiladi.
        # Kalit URL'da emas, sarlavhada — loglarga tushmaydi
        import time as _t, asyncio as _aio
        reasons: List[str] = []
        now = _t.time()
        async with httpx.AsyncClient(timeout=120.0) as client:
            for model_name in GEMINI_MODELS:
                until = self._quota_block.get(model_name, 0)
                if until > now:
                    reasons.append(f"{model_name}: kvota tugagan ({int((until - now) // 60) + 1} daq keyin qayta)")
                    continue
                try:
                    resp = None
                    for attempt in range(3):
                        resp = await client.post(
                            GEMINI_URL.format(model=model_name),
                            json=payload,
                            headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
                        )
                        if resp.status_code in (503, 500, 502, 504) and attempt < 2:
                            await _aio.sleep(2 + attempt * 2)   # vaqtinchalik yuklama — 2 s, 4 s kutib qayta
                            continue
                        break
                    if resp.status_code == 429:
                        body = resp.text.replace("\n", " ")
                        logger.warning(f"Model {model_name} quota (429): {body[:600]}")
                        per_day = "PerDay" in body or "per day" in body.lower() or "daily" in body.lower()
                        self._quota_block[model_name] = now + (3600 if per_day else 600)
                        reasons.append(f"{model_name}: kvota tugagan (429" + (", kunlik limit" if per_day else ", daqiqalik limit") + ")")
                        continue
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

                            try:
                                parsed = json.loads(content_text)
                            except json.JSONDecodeError:
                                reasons.append(f"{model_name}: javob JSON emas")
                                continue
                            if isinstance(parsed, dict):
                                parsed.setdefault("rows", [])
                                parsed["model"] = model_name
                                if not parsed["rows"]:
                                    parsed["reason"] = "Model jadvalda tovar qatori topmadi — rasm tiniq va to'liq emas yoki jadval kadrga sig'magan"
                                return parsed
                            elif isinstance(parsed, list):
                                return {"kontragent": "", "phone": "", "date": "", "rows": parsed, "model": model_name}
                        reasons.append(f"{model_name}: bo'sh javob")
                    else:
                        short = resp.text[:160].replace("\n", " ")
                        logger.warning(f"Model {model_name} returned status {resp.status_code}: {short}")
                        reasons.append(f"{model_name}: HTTP {resp.status_code}" + (" (rasm formati/hajmi qabul qilinmadi)" if resp.status_code == 400 else " (Google tomonida yuklama, 3 marta urinildi)" if resp.status_code == 503 else " (band, keyinroq)" if resp.status_code in (429, 503) else ""))
                        continue
                except Exception as e:
                    logger.warning(f"Error calling {model_name}: {e}")
                    reasons.append(f"{model_name}: {e.__class__.__name__}")
                    continue

        self.last_reason = (self.last_reason + "; " if self.last_reason else "") + " | ".join(reasons)
        return {"kontragent": "", "phone": "", "date": "", "rows": [], "reason": self.last_reason}
