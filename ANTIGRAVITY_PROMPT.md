# KIRIM (ПРИХОД) AVTOMATLASHTIRISH TIZIMI — Loyiha texnik topshirig'i

> Bu fayl loyihani noldan boshlash uchun to'liq kontekst beradi. Ilova — MoySklad bilan
> integratsiyalashgan, kiyim-kechak chakana savdosi uchun **приход (товар qabul qilish)**
> jarayonini avtomatlashtiruvchi web ilova. Hozirgi jarayon Excel + Power Query orqali
> qo'lda bajariladi; vazifa — shu jarayonni to'liq avtomatlashtirish.

---

## 1. Loyihaning maqsadi

Hozir omborchi tovar qabul qilganda qo'lda Excel shablon to'ldiradi (ierarxik dropdown bilan,
xato yozishning oldini olish uchun), so'ng Power Query orqali tozalab, natijani yangi Excel
faylga ko'chirib, MoySklad'ga **import** qiladi. Bu jarayonni to'liq web ilovaga ko'chirish kerak:
omborchi ma'lumotlarni browser'dagi jadvalga kiritadi (yoki накладная fotosini yuklaydi, AI
avtomatik to'ldiradi), tizim xatolarni tekshiradi, va xato bo'lmasa **MoySklad API orqali
avtomatik приход/приемка hujjatini yaratadi**.

## 2. Jarayon ishtirokchilari va qoidalar

- Hujjatni faqat **bitta rol — omborchi** to'ldiradi (ko'p xodimli workflow hozircha kerak emas).
- **Tasdiqlash (approval) bosqichi YO'Q.** Xatolik topilmasa — avtomatik MoySklad'ga yuboriladi.
  Xatolik topilsa — jarayon to'xtaydi, aniq qaysi qatorda/qaysi maydonda xato borligi
  ko'rsatiladi, omborchi tuzatib qayta yuboradi.
- Ilova — **desktop web ilova** (Telegram Mini App emas), chunki ish asosan kompyuterda,
  Excel'dagidek tez klaviatura bilan (Tab/Enter/strelka, pastga nusxalash) ishlash kerak.
  Telegram faqat **bildirishnoma** uchun ishlatilishi mumkin (masalan bot orqali "✅ Приход
  yaratildi" yoki "❌ Xatolik: 3-qator").

## 3. Hozirgi Excel jarayonining to'liq mantiqi (eski tizim — yangisi shuni almashtiradi)

Eski shablon 3 varaqdan iborat edi: **Asosiy** (kiritish), **Tayyor** (Power Query orqali
tozalangan chiqish), **Ruyxat** (spravochniklar). Yangi tizimda bu uchala varaq ham o'z
vazifasini bajaradi, lekin Excel formulalari o'rniga **backend mantiqi** sifatida amalga oshadi.

### 3.1. Kiritiladigan maydonlar (foydalanuvchi to'ldiradi)
| Maydon | Izoh |
|---|---|
| Страна | Mamlakat (dropdown) |
| Вид товара | Mahsulot turi (dropdown, masalan "Футболка", "Ремень") |
| Бренд | Brend (dropdown, yangisini qo'shish mumkin) |
| Коллекция | Masalan "AW26" |
| Сезон | Masalan "Весна-Осень" |
| Размер | O'lcham |
| Описание | Erkin matn (masalan rang/fason qisqa tavsifi) |
| Код модели | Ishlab chiqaruvchi modeli kodi (bo'lishi mumkin, erkin matn) |
| Количество | Son |
| Закупочная цена | Sotib olish narxi |
| Цена продажи | Sotish narxi |

### 3.2. Avtomatik hisoblanadigan maydonlar (foydalanuvchi TEGMAYDI — backend hisoblaydi)

**Артикул** (eng muhim formula):
```
Артикул = Mavsum_kodi(Коллекция) + Guruh_kodi(Группы) + Ketma_ket_raqam(5 xonali, zero-padded)
```
- `Mavsum_kodi` — "Коллекция" qiymati (masalan "AW26") `mavsum_kodlari.csv` jadvalidan qidiriladi → kod (masalan "A26")
- `Guruh_kodi` — pastda hisoblangan "Группы" qiymati `guruh_kodlari.csv` jadvalidan qidiriladi → kod (masalan "UND")
- Ketma-ket raqam — global counter, oxirgi ishlatilgan raqam +1 (eski Excelda `Last Articul` katagida saqlangan edi — yangi tizimda DB'dagi counter jadvali)
- Misol: Коллекция=AW26, Группы=Нижнее белье → `A26` + `UND` + `00520` = **`A26UND00520`**

**Категория** va **Группы** — "Вид товара" orqali avtomatik topiladi:
```
Категория, Группы = VLOOKUP(Вид_товара, vid_tovara_kategoriya_guruh.csv)
```
Masalan: Вид товара="Футболка" → Категория="Футболки и поло", Группы="Одежда Топ"

**Наименование** — avtomatik birlashtiriladi:
```
Наименование = TRIM(Вид_товара + " " + Описание + " " + Бренд + " " + Код_модели)
```

**Надценка** (markup %):
```
Надценка = (Цена_продажи / Закупочная_цена) - 1
```

**Сумма закупа** = `Количество × Закупочная_цена`
**Сумма продажи** = `Количество × Цена_продажи`

### 3.3. Spravochnik (reference) fayllar — bu arxivga ilova qilingan

Quyidagi CSV fayllar eski Excel'dan to'g'ridan-to'g'ri ajratib olingan — yangi tizimning
boshlang'ich (seed) ma'lumotlari sifatida DB'ga import qilinishi kerak:

- **`mavsum_kodlari.csv`** (Коллекция → Код) — Артикул formulasidagi mavsum qismi uchun
- **`guruh_kodlari.csv`** (Группа → Код) — Артикул formulasidagi guruh qismi uchun (15 ta guruh,
  masalan Аксессуары→ACC, Верхняя одежда→OUT, Нижнее белье→UND, Обувь→SHO, Одежда Топ→TOP va h.k.)
- **`vid_tovara_kategoriya_guruh.csv`** (Вид товара → Категория → Группа) — 248 qatorlik to'liq
  mapping, Категория/Группы avtomatik aniqlash uchun asosiy jadval
- **`ranglar_1.csv`** — rang nomlari ro'yxati (raqamlangan, 55+ ta)

> Eslatma: asl Excel faylida yana rang kodlari (RGB), mato turlari, naqsh turlari, mamlakatlar,
> yosh/jins toifalari kabi qo'shimcha spravochniklar ham bor edi — ular hozircha asosiy
> Артикул/Категория formulasiga bevosita ta'sir qilmaydi, lekin to'liq dropdown tajribasi
> uchun keyinroq xuddi shunday CSV import qilinishi kerak bo'ladi (foydalanuvchidan so'rab olish kerak).

### 3.4. Olib tashlangan ustunlar
"Варианты" va "Образец" ustunlari — eski Excel'da faqat tezroq ierarxiya aniqlash uchun
ishlatilgan vaqtinchalik yordamchi ustunlar edi. **Yangi tizimda kerak emas.**

## 4. Yangi tizimning funksional talablari

1. **Kiritish jadvali (grid)** — Excel'dagidek tez ishlaydigan jadval komponenti: Tab/Enter/
   strelka bilan harakatlanish, pastga nusxalash (fill-down), dropdown kataklar.
2. **Avtomatik hisoblash** — foydalanuvchi "Вид товара", "Коллекция" kabi maydonlarni
   tanlashi bilan Категория, Группы, Артикул, Наименование, Надценка, Summalar real vaqtda
   (frontend yoki backend orqali) hisoblanib ko'rsatiladi.
3. **Spravochniklar ilovaning o'z bazasida — asosiy manba hisoblanadi**, lekin har bir
   yozuv yonida MoySklad bilan mosligi holati ko'rsatiladi:
   - ✅ **synced** — MoySklad'da ham mavjud va mos
   - ⚠️ **local_only** — faqat bizning bazada, MoySklad'da hali yo'q
   - ❌ **conflict** — nomuvofiqlik (masalan ID boshqacha yoki MoySklad'da o'chirilgan)
4. **AI-fotosurat orqali to'ldirish** — накладная (yetkazib beruvchi hujjati) fotosi
   yuklanadi, AI (Gemini Flash API) qatorlarni o'qib jadvalga avtomatik joylaydi.
   - AI **har doim** eng yaqin mos keladigan qiymatni tanlab yozadi (bo'sh qoldirmaydi).
   - Agar AI ishonchi past bo'lsa — o'sha katakcha **boshqa rangda (masalan sariq fon)**
     belgilanadi, omborchi ko'rib tasdiqlaydi yoki ustidan to'g'ri qiymatni yozadi.
5. **Validatsiya va yuborish** — "MoySklad'ga yuborish" tugmasi bosilganda:
   - Barcha majburiy maydonlar to'ldirilganligi tekshiriladi
   - Xatolik topilsa — jarayon to'xtaydi, aniq qator/maydon va sabab ko'rsatiladi
   - Xatolik bo'lmasa — MoySklad API orqali приход/приемка avtomatik yaratiladi
   - Natija (muvaffaqiyat/xato) Telegram bot orqali ham xabar qilinadi

## 5. Texnik stack (tavsiya etilgan, lekin moslashuvchan)

- **Backend:** Python + FastAPI (MoySklad bilan ishlash tajribasi mavjud, Gemini Flash
  integratsiyasi uchun ham qulay)
- **Ma'lumotlar bazasi:** PostgreSQL
- **Frontend:** Web (brauzer), jadval komponenti uchun **Handsontable** yoki **AG Grid**
  kabi tayyor kutubxona (Excel-simon klaviatura tajribasi uchun)
- **AI:** Google Gemini Flash API (накладная fotosini o'qish uchun)
- **Joylashtirish:** boshida bitta VPS (backend + DB + frontend bitta serverda) yetarli

## 6. Ma'lumotlar bazasi — boshlang'ich sxema (taklif)

```
-- Spravochniklar (har birida MoySklad bilan moslik holati)
tovar_turlari     (id, nomi, kategoriya_id, guruh_id, moysklad_id, status)
kategoriyalar     (id, nomi, moysklad_id, status)
guruhlar          (id, nomi, kod, moysklad_id, status)   -- kod: Артикул formulasi uchun
brendlar          (id, nomi, moysklad_id, status)
ranglar           (id, nomi, rgb, moysklad_id, status)
mamlakatlar       (id, nomi, moysklad_id, status)
mavsumlar         (id, kollektsiya, kod, moysklad_id, status)  -- kod: Артикул formulasi uchun

-- Hujjatlar
artikul_counter   (guruh_id, mavsum_id, oxirgi_raqam)
prixod_hujjatlari (id, holati, yaratilgan_vaqt, moysklad_document_id, xatolik_matni)
prixod_qatorlari  (id, hujjat_id, artikul, vid_tovara_id, brend_id, ..., son, narx_sotib,
                    narx_sotish, ai_generated, ai_ishonch_darajasi)
```

## 7. MVP bosqichlari (tavsiya etilgan tartib)

1. MoySklad API bilan autentifikatsiya + nomenklaturani o'qib DB'ga sinxronlash (bir tomonlama, pastga)
2. Spravochnik jadvallarini seed-data (ilova qilingan CSV fayllar) bilan to'ldirish
3. Kiritish jadvali (grid) — qo'lda kiritish, avtomatik Артикул/Категория/Наименование hisoblash
4. Validatsiya + MoySklad'ga приход yaratish (yuqoriga yuborish)
5. Telegram bot — bildirishnoma
6. AI-fotosurat orqali avtomatik to'ldirish (eng oxirida, chunki eng murakkab qism)

## 8. Ilova qilingan fayllar

- `mavsum_kodlari.csv`
- `guruh_kodlari.csv`
- `vid_tovara_kategoriya_guruh.csv`
- `ranglar_1.csv`

---

*Bu hujjat — foydalanuvchi (retail avtomatlashtirish bo'yicha mutaxassis, MoySklad eksperti,
o'zi ham Python/Excel integratsiyalar yozadi) bilan Claude o'rtasidagi muhokama asosida
tuzilgan. Noaniq qolgan joy bo'lsa, ishni boshlashdan oldin foydalanuvchidan so'rang —
taxmin qilib davom etmang.*
