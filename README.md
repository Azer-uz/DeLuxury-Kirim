# DE LUXURY — Kirim (Приход) Avtomatlashtirish Tizimi

Kiyim-kechak chakana savdosi uchun **приход (товар qabul qilish)** jarayonini to'liq avtomatlashtiruvchi, MoySklad Remap 1.2 API va Google Gemini Flash AI bilan integratsiyalashgan zamonaviy web ilova.

---

## 🚀 Asosiy Imkoniyatlar (To'liq Qamrov)

1. **Excel-simon Tezkor Jadval (Desktop Grid):**
   - Klaviatura bilan tez boshqarish: `Tab`, `Shift+Tab`, `Enter` (pastga tushish), `↑↓` strelkalar, `Ctrl+D` (nusxalash).
   - Dropdown avtoto'ldirish: *Вид товара*, *Бренд*, *Коллекция*, *Сезон*, *Размер*, *Цвет / Описание*, *Страна*.
   - **Avtomatik Formulalar (Real-Time):**
     - **Категория & Группа:** `Вид товара` tanlanganda avtomatik aniqlanadi (248+ mapping jadvali).
     - **Артикул:** `Mavsum_kodi(Коллекция) + Guruh_kodi(Группы) + 5 xonali ketma-ket raqam` (masalan, `AW26` + `Одежда Топ` -> `A26TOP00501`).
     - **Наименование:** `TRIM(Вид_товара + " " + Описание + " " + Бренд + " " + Код_модели)`.
     - **Надценка %:** `(Цена продажи / Цена закупа) - 1`.
     - **Сумма закупа & Сумма продажи.**

2. **🤖 Google Gemini Flash AI (Накладная Fotosini O'qish):**
   - Yetkazib beruvchi hujjati (накладная, счет-фактура) rasmini yuklash yoki tashlash.
   - AI tovarlar qatorlarini o'qib, spravochniklarimiz bilan moslashtirib jadvalga avtomatik kiritadi.

3. **🏢 MoySklad Markaziy Sync / Gateway Xizmati (`MOYSKLAD_SYNC_GATEWAY_PROMPT.md`):**
   - Rate-Limit va Token Bucket nazorati (`429` xatolaridan avtomatik himoya va retry-backoff).
   - Yozish navbati (Write Queue) va Webhook qabul qiluvchi.
   - Ichki REST API Gateway (`/internal/api/*`).
   - Omborlar va Yetkazib beruvchilar live integratsiyasi, tezkor `+` bilan yangi kontragent yaratish.
   - MoySklad'dagi oxirgi `Приемка` raqamini o'qib avtomatik ketma-ket raqamlash (masalan `00035`).

4. **📱 Telegram Bildirishnomalari:**
   - Yangi kirim yaratilganda super-admin va menejerlarga summa, dona, ombor va to'g'ridan-to'g'ri MoySklad linki yuboriladi.

5. **📚 Manbalar (Katalog & Kodlar) Boshqaruvi (`De luxury kirim ilova files.zip` + Yangilanishlar):**
   - 248 ta Mahsulot turlari (Ierarxiya), 15 ta Guruh kodlari, Mavsumlar, Sezonlar (Fasllar), Razmerlar (O'lchamlar), Ranglar, Brendlar va Mamlakatlar.
   - Barcha ustunlar bo'yicha dinamik saralash (Sorting: `▲`, `▼`, `⇅`).
   - Kategoriya, Guruh va MoySklad holati bo'yicha alohida filtrlar.
   - Ierarxiyani to'g'ridan-to'g'ri interfeysdan qo'shish/tahrirlash yoki Excel/CSV orqali import/export qilish.
   - Har bir yozuvda MoySklad bilan moslik holati: `✅ Mos keldi` / `📦 Lokal`.

---

## 💻 Qanday Ishga Tushiriladi?

### 1-usul (1 Click):
`start_app.bat` faylini ikki marta bosing.

### 2-usul (Terminal):
```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
```

Brauzerda oching: **[http://localhost:8001](http://localhost:8001)**

---

## 📁 Papka Tarkibi

- `backend/`
  - `main.py` — FastAPI server va statik fayllar mount
  - `models.py` — SQLAlchemy modellari (Spravochniklar, Hujjatlar, Qoralamalar)
  - `database.py` — SQLite (WAL) / PostgreSQL ulanishi
  - `seed.py` — CSV spravochniklarini DB'ga yuklash
  - `services/`
    - `articul_service.py` — Артикул, Наименование va narx formulalari
    - `moysklad_service.py` — MoySklad Remap 1.2 API
    - `gemini_service.py` — Google Gemini 1.5 Flash Vision OCR
    - `telegram_service.py` — Telegram bot bildirishnomalari
  - `routers/` — REST API endpointlari
- `frontend/`
  - `index.html` — Asosiy interfeys
  - `css/style.css` — De Luxury premium qorong'u/oltin dizayn tizimi
  - `js/`
    - `grid.js` — Excel klaviatura va jadval boshqaruvi
    - `references.js` — Spravochniklar va mijoz hisoblash moduli
    - `ai-scanner.js` — AI nakladnaya fotosini o'qish
    - `history.js` — Kirimlar tarixi
    - `app.js` — Asosiy ilova boshqaruvchisi
