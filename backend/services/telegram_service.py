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

    async def notify_prixod_created(
        self,
        doc_number: str,
        counterparty: str,
        store: str,
        total_items: int,
        total_qty: float,
        total_sum_buy: float,
        total_sum_sale: float,
        moysklad_url: Optional[str] = None
    ):
        """Send notification about successfully created Приемка in MoySklad."""
        msg = (
            f"<b>✅ YANGI KIRIM (ПРИЕМКА) YARATILDI!</b>\n\n"
            f"📄 <b>Hujjat:</b> {doc_number}\n"
            f"🏢 <b>Ombor:</b> {store or 'Asosiy ombor'}\n"
            f"🤝 <b>Yetkazib beruvchi:</b> {counterparty or 'Noma\'lum'}\n"
            f"📦 <b>Pozitsiyalar soni:</b> {total_items} ta\n"
            f"🔢 <b>Umumiy dona:</b> {total_qty:,.0f} dona\n"
            f"💵 <b>Kirim summasi (tan narx):</b> ${total_sum_buy:,.2f}\n"
            f"🏷️ <b>Sotish summasi:</b> ${total_sum_sale:,.2f}\n"
        )
        if moysklad_url:
            msg += f"\n🔗 <a href='{moysklad_url}'>MoySklad'da ko'rish</a>"

        await self.send_message(msg)

    async def notify_prixod_error(self, doc_number: str, error_text: str):
        """Send error alert notification."""
        msg = (
            f"<b>❌ KIRIM HUJJATIDA XATOLIK!</b>\n\n"
            f"📄 <b>Hujjat:</b> {doc_number or 'Nomsiz'}\n"
            f"⚠️ <b>Sabab:</b>\n<code>{error_text}</code>\n\n"
            f"Omborchi ilovada tuzatib qayta yuborishi kerak."
        )
        await self.send_message(msg)
