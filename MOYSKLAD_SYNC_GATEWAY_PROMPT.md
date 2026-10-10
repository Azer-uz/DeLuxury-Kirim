# MOYSKLAD SYNC/GATEWAY XIZMATI — Loyiha texnik topshirig'i

> Bu fayl — **De Luxury** kiyim-kechak do'konining MoySklad integratsiyasi uchun markaziy
> "API Gateway" xizmatini qurish bo'yicha to'liq topshiriq. Bu xizmat ikkita mustaqil loyihani
> (приход web ilova va hisobot Telegram boti) birlashtiradi va ularning MoySklad API'ga
> mustaqil, nazoratsiz so'rov yuborishining oldini oladi.
>
> Bu hujjat `ANTIGRAVITY_PROMPT.md` (приход ilovasi uchun) bilan birga ishlatiladi —
> u yerdagi "6-bo'lim: MoySklad integratsiyasi" aynan shu xizmat orqali amalga oshadi.

---

## 1. Muammo (nega bu xizmat kerak)

De Luxury uchun ikkita alohida loyiha quriladi:
1. **Приход web ilova** — tovar qabul qilish, MoySklad'ga yozish (write)
2. **Hisobot Telegram bot** — sotuvlar, qoldiqlar, balanslar haqida hisobot, MoySklad'dan o'qish (read)

Agar ikkalasi **mustaqil ravishda**, to'g'ridan-to'g'ri MoySklad API'ga so'rov yuborsa:
- Ikkalasi bir vaqtda ishlasa, birgalikda MoySklad'ning so'rov limitiga (rate limit) tez yetib
  qolish xavfi bor — natijada `429 Too Many Requests` yoki `1073` (parallel so'rov limiti) xatosi
- Ikkala loyiha ham MoySklad token'ini o'zida saqlashi kerak bo'ladi — xavfsizlik nuqtai nazaridan yomon
- Hisobot boti har safar savol kelganda MoySklad'dan jonli so'rasa — sekin ishlaydi va behuda
  so'rovlarni ko'paytiradi

## 2. Yechim — markaziy Sync/Gateway xizmati

**Asosiy qoida: MoySklad API bilan FAQAT shu bitta xizmat gaplashadi.** Приход ilova ham,
hisobot bot ham, kelajakda qo'shiladigan har qanday boshqa bot/ilova ham — MoySklad'ga emas,
shu xizmat boshqaradigan **umumiy PostgreSQL bazaga** ulanadi (yoki shu xizmatning o'z ichki
API'siga murojaat qiladi).

```
                         ┌─────────────────────────┐
                         │      MoySklad API        │
                         └───────────▲──────────────┘
                                     │  (FAQAT shu yerdan so'rov ketadi)
                         ┌───────────┴──────────────┐
                         │   MOYSKLAD SYNC/GATEWAY   │
                         │        XIZMATI            │
                         │  - Rate-limit nazorati     │
                         │  - Webhook qabul qiluvchi  │
                         │  - Zaxira cron-sync        │
                         │  - Yozish navbati (queue)  │
                         │  - Ichki REST API          │
                         └───────────┬──────────────┘
                                     │
                         ┌───────────▼──────────────┐
                         │   PostgreSQL (umumiy)     │
                         └───────────┬──────────────┘
                     ┌───────────────┼───────────────┐
                     ▼               ▼               ▼
            Приход web ilova   Hisobot bot    (kelajakdagi botlar)
```

## 3. Xizmatning asosiy vazifalari

### 3.1. O'qish yo'nalishi (MoySklad → bizning baza)

- **Webhook qabul qiluvchi (eng muhim, birinchi ustuvorlik):** MoySklad'da hujjat
  yaratilganda/o'zgarganda (приход, otgruzka, kontragent balansi va h.k.) MoySklad o'zi shu
  xizmatga HTTP so'rov yuboradi (push), xizmat buni darhol bazaga yozadi. Bu doimiy so'rab
  turishni (polling) deyarli yo'q qiladi.
- **Zaxira cron-sync:** webhook qandaydir sababga ko'ra yetib kelmay qolishi mumkin (tarmoq
  uzilishi va h.k.), shuning uchun har 15-30 daqiqada "to'liq emas, faqat o'zgargan"
  ma'lumotlarni tekshirib turuvchi zaxira sinxronizatsiya ham bo'lishi kerak.
- Sinxronlanadigan ma'lumotlar: nomenklatura, narxlar, qoldiqlar, kontragentlar (balans bilan
  birga), otgruzka/приход hujjatlari, qo'shimcha xususiyatlar (доп. поля).

### 3.2. Yozish yo'nalishi (bizning baza → MoySklad)

- Приход web ilovasi "Yuborish" tugmasi bosilganda, to'g'ridan-to'g'ri MoySklad'ga emas —
  shu xizmatning ichki **yozish navbati (write queue)**ga so'rov qo'shadi.
- Xizmat navbatdagi so'rovlarni birin-ketin (yoki nazorat ostida bir nechtasini parallel)
  MoySklad'ga yuboradi, natijani (muvaffaqiyat/xato) qaytarib beradi.

### 3.3. Rate-limit nazorati

- Har bir MoySklad javobidagi `X-RateLimit-Remaining` va `X-Lognex-Retry-After`
  sarlavhalarini o'qiydi.
- Limitga yaqinlashganda so'rovlarni avtomatik sekinlashtiradi (token bucket yoki shunga
  o'xshash algoritm).
- `429` xatosi kelsa — avtomatik kutib, qayta urinadi (retry with backoff), dasturchiga/
  foydalanuvchiga xato ko'rsatmaydi (agar oxir-oqibat muvaffaqiyatli bo'lsa).

### 3.4. Ichki API (boshqa xizmatlar uchun)

Приход ilova va hisobot bot MoySklad'ning o'ziga emas, shu xizmatning **o'z ichki REST
API'siga** murojaat qiladi. Masalan:
- `GET /internal/api/contragent/{id}/balance` — kontragent balansi (lokal bazadan, tez)
- `GET /internal/api/sales?from=...&to=...` — sotuvlar hisobot uchun
- `POST /internal/api/prixod` — yangi приход yaratish (navbatga qo'yiladi)
- `GET /internal/api/nomenklatura` — mahsulotlar ro'yxati, dropdown uchun

## 4. Texnik stack (tavsiya)

- **Backend:** Python + FastAPI (приход ilovasi bilan bir xil stack — kodni qayta ishlatish
  va jamoa uchun bitta texnologiya bilan ishlash osonroq)
- **Navbat (queue):** Redis + oddiy worker (yoki Celery/RQ) — yozish so'rovlari uchun
- **Ma'lumotlar bazasi:** PostgreSQL (приход ilovasi bilan **bitta umumiy baza**, yoki alohida
  schema — loyihani soddalashtirish uchun bitta baza tavsiya etiladi)
- **Webhook endpoint:** FastAPI'ning o'zida alohida route (masalan `/webhooks/moysklad`),
  MoySklad'dan kelgan so'rovni imzosi/manzilini tekshirib qabul qiladi

## 5. Xavfsizlik

- MoySklad API token **faqat shu xizmatda** saqlanadi (environment variable yoki secret
  manager orqali) — приход ilova va hisobot bot hech qachon tokenni ko'rmaydi/saqlamaydi.
- Ichki API (`/internal/api/...`) faqat o'zimizning ilova/botlardan kirish mumkin bo'lishi
  uchun oddiy ichki token yoki tarmoq darajasida cheklov (masalan faqat bitta VPS ichida,
  tashqi internetga ochiq bo'lmasligi) qo'yiladi.

## 6. MVP bosqichlari

1. PostgreSQL sxemasini loyihalash (приход ilova uchun `ANTIGRAVITY_PROMPT.md`dagi sxema bilan
   birlashtirilgan holda)
2. MoySklad'dan **asosiy nomenklatura va qoldiqlarni** birinchi to'liq sinxronlash (bir martalik)
3. Webhook qabul qiluvchi endpoint — MoySklad tomonda webhook ro'yxatdan o'tkaziladi
4. Zaxira cron-sync (har 15-30 daqiqada)
5. Yozish navbati — приход ilovasi uchun `POST /internal/api/prixod`
6. Rate-limit monitoring va avtomatik sekinlashtirish
7. Hisobot bot shu ichki API'ga ulanadi (MoySklad'ga emas)

## 7. Muvaffaqiyat mezonlari

- Приход ilova va hisobot bot **hech qachon** MoySklad API'ga to'g'ridan-to'g'ri so'rov
  yubormaydi — barcha so'rovlar shu xizmat orqali o'tadi
- `429` xatosi amalda deyarli chiqmaydi (rate-limit nazorati tufayli)
- Hisobotlar lokal bazadan o'qilgani uchun bir necha soniyada javob qaytadi (MoySklad'ni
  kutish shart emas)

---

*Bu hujzhat — foydalanuvchi (retail avtomatlashtirish bo'yicha mutaxassis, MoySklad eksperti)
bilan Claude o'rtasidagi muhokama asosida tuzilgan. Noaniq qolgan joy bo'lsa, ishni
boshlashdan oldin foydalanuvchidan so'rang — taxmin qilib davom etmang.*
