import html
import httpx
import logging
from typing import List, Optional
from backend.config import get_settings

logger = logging.getLogger(__name__)

class TelegramService:
    """Token va qabul qiluvchilar har yuborishda Sozlamalar (baza) dan, bo'lmasa .env dan olinadi —
    shuning uchun botni interfeysdan almashtirish uchun ilovani qayta ishga tushirish shart emas."""

    def __init__(self):
        self.settings = get_settings()

    def _runtime(self) -> dict:
        try:
            from backend.database import SessionLocal
            from backend.services.app_settings import telegram_runtime
            db = SessionLocal()
            try:
                return telegram_runtime(db)
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Telegram sozlamalarini o'qib bo'lmadi, .env ishlatiladi: {e}")
            ids = [x.strip() for x in f"{self.settings.super_admin_ids},{self.settings.manager_ids}".split(",") if x.strip()]
            return {"enabled": True, "token": self.settings.telegram_bot_token, "recipients": ids}

    @property
    def token(self) -> str:
        return self._runtime().get("token") or ""

    def get_recipient_ids(self) -> List[str]:
        return list(self._runtime().get("recipients") or [])

    async def get_me(self, token: Optional[str] = None) -> Optional[dict]:
        """Bot haqida ma'lumot (username) — sozlamalar sahifasidagi holat uchun"""
        tok = (token or self.token or "").strip()
        if not tok:
            return None
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"https://api.telegram.org/bot{tok}/getMe")
                if r.status_code == 200 and r.json().get("ok"):
                    return r.json().get("result")
        except Exception as e:
            logger.warning(f"Telegram getMe xato: {e}")
        return None

    async def send_message(self, text: str, parse_mode: str = "HTML", token: Optional[str] = None, recipients: Optional[List[str]] = None) -> bool:
        """Send message to all configured admin/manager chat IDs."""
        rt = self._runtime()
        if recipients is None and not rt.get("enabled", True):
            logger.info("Telegram bildirishnomalar o'chirilgan (sozlamalar).")
            return False
        tok = (token or rt.get("token") or "").strip()
        if not tok:
            logger.info("Telegram Bot token not configured, skipping notification.")
            return False

        recipients = recipients if recipients is not None else (rt.get("recipients") or [])
        if not recipients:
            logger.info("No Telegram recipient IDs configured.")
            return False

        success = True
        async with httpx.AsyncClient(timeout=10.0) as client:
            for chat_id in recipients:
                try:
                    resp = await client.post(
                        f"https://api.telegram.org/bot{tok}/sendMessage",
                        json={
                            "chat_id": chat_id,
                            "text": text,
                            "parse_mode": parse_mode,
                            "disable_web_page_preview": True
                        }
                    )
                    if resp.status_code != 200:
                        logger.warning(f"Failed to send Telegram message to {chat_id}: {resp.text}")
                        success = False
                except Exception as e:
                    logger.error(f"Error sending Telegram notification to {chat_id}: {e}")
                    success = False
        return success

    @staticmethod
    def _money(value: float, currency: str) -> str:
        formatted = f"{value:,.2f}".replace(",", " ")
        return f"${formatted}" if currency == "USD" else f"{formatted} so'm"

    async def notify_prixod_created(
        self,
        doc_number: str,
        counterparty: str,
        store: str,
        total_items: int,
        total_qty: float,
        total_sum_buy: float,
        total_sum_sale: float,
        currency: str = "UZS",
        moysklad_url: Optional[str] = None,
        user: Optional[str] = None,
    ):
        """MoySklad'da Приемка yaratilgani haqida xabar (sotuv summasi doim so'mda)"""
        unknown = "Noma'lum"
        msg = (
            f"<b>✅ {html.escape(self.settings.company_name)} — YANGI KIRIM (ПРИЕМКА)</b>\n\n"
            f"📄 <b>Hujjat:</b> {html.escape(doc_number or '')}\n"
            f"🏢 <b>Ombor:</b> {html.escape(store or unknown)}\n"
            f"🤝 <b>Yetkazib beruvchi:</b> {html.escape(counterparty or unknown)}\n"
            f"📦 <b>Pozitsiyalar soni:</b> {total_items} ta\n"
            f"🔢 <b>Umumiy dona:</b> {total_qty:,.0f} dona\n"
            f"💵 <b>Kirim summasi (tan narx):</b> {self._money(total_sum_buy, currency)}\n"
            f"🏷️ <b>Sotish summasi:</b> {self._money(total_sum_sale, 'UZS')}\n"
        )
        if user:
            msg += f"👤 <b>Kiritdi:</b> {html.escape(user)}\n"
        if moysklad_url:
            msg += f"\n🔗 <a href='{moysklad_url}'>MoySklad'da ko'rish</a>"

        await self.send_message(msg)

    async def notify_prixod_error(self, doc_number: str, error_text: str, user: Optional[str] = None):
        """Kirim yuborishda xatolik haqida ogohlantirish"""
        msg = (
            f"<b>❌ {html.escape(self.settings.company_name)} — KIRIM HUJJATIDA XATOLIK!</b>\n\n"
            f"📄 <b>Hujjat:</b> {html.escape(doc_number or 'Nomsiz')}\n"
            f"⚠️ <b>Sabab:</b>\n<code>{html.escape(error_text[:1500])}</code>\n\n"
        )
        if user:
            msg += f"👤 <b>Kiritdi:</b> {html.escape(user)}\n"
        msg += "Omborchi ilovada tuzatib qayta yuborishi kerak."
        await self.send_message(msg)

# Umumiy nusxa — barcha routerlar shundan foydalanadi
tg_service = TelegramService()
