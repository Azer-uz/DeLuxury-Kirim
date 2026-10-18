import html
import httpx
import logging
from typing import List, Optional
from backend.config import get_settings

logger = logging.getLogger(__name__)

class TelegramService:
    def __init__(self):
        self.settings = get_settings()
        self.token = self.settings.telegram_bot_token
        self.base_url = f"https://api.telegram.org/bot{self.token}"

    def get_recipient_ids(self) -> List[str]:
        recipients = []
        if self.settings.super_admin_ids:
            for item in self.settings.super_admin_ids.split(","):
                if item.strip():
                    recipients.append(item.strip())
        if self.settings.manager_ids:
            for item in self.settings.manager_ids.split(","):
                if item.strip() and item.strip() not in recipients:
                    recipients.append(item.strip())
        return recipients

    async def send_message(self, text: str, parse_mode: str = "HTML") -> bool:
        """Send message to all configured admin/manager chat IDs."""
        if not self.token:
            logger.info("Telegram Bot token not configured, skipping notification.")
            return False

        recipients = self.get_recipient_ids()
        if not recipients:
            logger.info("No Telegram recipient IDs configured.")
            return False

        success = True
        async with httpx.AsyncClient(timeout=10.0) as client:
            for chat_id in recipients:
                try:
                    resp = await client.post(
                        f"{self.base_url}/sendMessage",
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
