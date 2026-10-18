# DE LUXURY — Kirim (Приход) Avtomatlashtirish Tizimi

Kiyim-kechak chakana savdosi uchun **приход (товар qabul qilish)** jarayonini to'liq avtomatlashtiruvchi, MoySklad Remap 1.2 API va Google Gemini Flash AI bilan integratsiyalashgan zamonaviy web ilova.

---

## 🚀 Asosiy Imkoniyatlar (To'liq Qamrov)

1. **Excel-simon Tezkor Jadval (Desktop Grid):**
   - Klaviatura bilan tez boshqarish: `Tab`, `Shift+Tab`, `Enter` (pastga tushish), `↑↓` strelkalar, `Ctrl+D` (nusxalash).
   - Dropdown avtoto'ldirish: *Вид товара*, *Бренд*, *Коллекция*, *Сезон*, *Размер*, *Цвет / Описание*, *Страна*.
   - **Avtomatik Formulalar (Real-Time):**
     - **Категория & Группа:** `Вид товара` tanlanganda avtomatik aniqlanadi (248+ mapping jadvali).
     - **Модель:** `Mavsum_kodi(Коллекция) + Guruh_kodi(Группы) + 5 xonali model raqami` (masalan, `AW26` + `Одежда Топ` -> `A26TOP00724`).
     - **Артикул:** Модель + (sozlamaga qarab) rang kodi va/yoki razmer — pastdagi "Kirim qoidalari"ga qarang.
     - **Код товара:** har bir tovarning unikal kaliti (MoySklad importidagi kabi). Ilova beradi: MoySklad'dagi butun
       assortimentning eng katta kodidan keyin **ketma-ket**, hisoblagich faqat oshadi — kod **hech qachon qaytarilmaydi**.
       Kirim kod bo'yicha bog'lanadi. Kod MoySklad'da boshqa tovarda band bo'lsa yoki tovar boshqa kod bilan mavjud bo'lsa —
       yuborish to'xtaydi, sabab ekranda va Telegram'da ko'rsatiladi. MoySklad'da takroriy kodlar paydo bo'lsa adminlarga ogohlantirish boradi.
     - **Штрихкод:** MoySklad o'zi beradi (EAN13).
     - **Наименование:** `TRIM(Вид_товара + " " + Описание + " " + Бренд + " " + Код_модели)`.
     - **Надценка %:** `(Цена продажи / Цена закупа) - 1` (USD kirimda tan narx kurs bilan so'mga keltiriladi).
     - **Сумма закупа & Сумма продажи.**

### 🧩 Kirim qoidalari (har bir do'kon uchun Sozlamalar bo'limida)

| Rang | Artikul | Misol |
|---|---|---|
| o'chiq | Модель | `A26TOP00724` |
| yoqiq | Модель + Rang kodi | `A26TOP00724BLK` |

- **Razmer** artikulga kirmaydi. Razmer rejimi yoqilsa, har bir razmer (S, M, L ...) **bir xil artikulli alohida tovar** bo'ladi,
  o'z kodi va shtrixkodi bilan (MoySklad beradi). Sozlamaga qarab razmer tovar nomining oxiriga qo'shiladi.
  Misol: 1 model × 4 rang × 5 razmer = **1 model raqami, 4 artikul, 20 tovar** (20 kod / 20 shtrixkod).
- Bir modelning rang/razmer variantlari **bitta model raqamini** oladi.
  Jadvalda bir nechta rang tanlab yoki razmer katagiga `S, M, L` yozib **Ctrl+Enter** bosilsa — variant qatorlari yaratiladi.
- Model raqami MoySklad'dagi artikullardan avtomatik sinxronlanadi va qoralamaga doimiy bog'lanadi:
  xato bo'lib qayta yuborilsa ham artikullar o'zgarmaydi, tovarlar qayta yaratilmaydi.
- **USD kirim** — sozlamadan yoqiladi (odatda o'chiq). Tan narx dollarda, sotuv narxi so'mda; Приемка MoySklad'da kurs bilan yaratiladi.

### 🔐 Kirish
- Foydalanuvchilar **MoySklad login/paroli** bilan kiradi. Xodimni admin MoySklad'da (Настройки → Сотрудники) yaratadi va parolini ham o'sha yerda o'zgartiradi.
- MoySklad'dagi owner/admin roli — ilovada administrator (sozlamalar, model raqami). "Kirish ruxsati" ro'yxati bilan ilovaga kiradigan xodimlarni cheklash mumkin.
- `/api/gateway/*` (bot uchun) — faqat localhost yoki `GATEWAY_TOKEN` bilan.

### 🧩 MoySklad доп. поля (Sozlamalar)
- MoySklad'dagi tovar atributlarini ko'rish, **yaratish** (spravochnik turi uchun yangi spravochnik ham), nomini/majburiyligini o'zgartirish, **o'chirish**.
- Ilova maydonlari (Категория, Вид товара, Коллекция, Сезон, Бренд, Модель, Код модели, Размер, Цвет, Страна) qaysi MoySklad maydoniga yozilishi — bog'lanish jadvali (ID bo'yicha, nom o'zgarsa buzilmaydi). Standart: nomlari mos kelganlarga avtomatik.
- MoySklad'da maydonlar tashqaridan o'zgarsa (qo'shildi/o'chirildi/nomi/majburiyligi) — Sozlamalarda banner va Telegram'ga xabar.
- Bog'lanishda muammo bo'lsa (yoqilgan maydon o'chirilgan, majburiy maydon bog'lanmagan) kirim yuborilmaydi va sabab ko'rsatiladi.
- Yangi mijoz: nomenklatura kelishilgach, kerakli maydonlar shu yerdan MoySklad'da yaratiladi va bog'lanadi.

### 🏪 Yangi do'konga o'rnatish
1. `.env.example` → `.env`, MoySklad tokeni, `COMPANY_NAME` va Telegram sozlamalarini to'ldiring.
2. Ilovani ishga tushiring, MoySklad admin login/paroli bilan kiring.
3. **Sozlamalar → Kirim qoidalari**: rang/razmer/USD rejimini tanlang. **Manbalar**da ierarxiya, kolleksiya va rang kodlarini tekshiring.
4. Tashqi kirish faqat HTTPS (nginx + SSL) orqali bo'lsin va `COOKIE_SECURE=true` qo'ying.

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
