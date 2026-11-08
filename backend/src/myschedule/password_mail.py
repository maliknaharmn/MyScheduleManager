"""Brevo SMTP transport. Never log SMTP protocol, messages, links or credentials."""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from myschedule.config import Settings

logger = logging.getLogger(__name__)


class PasswordMailUnavailable(Exception):
    pass


class PasswordMailer:
    def __init__(self, settings: Settings):
        self.settings = settings

    def probe(self) -> tuple[bool, int | None]:
        """Opt-in TLS/auth check from the actual cloud container. Never sends mail."""
        settings = self.settings
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
                smtp.login(
                    settings.smtp_username.get_secret_value(),
                    settings.smtp_password.get_secret_value(),
                )
            return True, None
        except (smtplib.SMTPException, OSError, TimeoutError, ValueError) as error:
            return False, getattr(error, "smtp_code", None)

    def send(self, recipient: str, purpose: str, token: str) -> None:
        settings = self.settings
        # Do not turn the endpoint into a general email sender, even if miscalled.
        if recipient.casefold() != settings.password_owner_email.casefold():
            raise PasswordMailUnavailable()
        path, title, lifetime = (
            ("activate-password", "Aktifkan password MySchedule Manager", "24 jam")
            if purpose == "invitation"
            else ("reset-password", "Atur ulang password MySchedule Manager", "30 menit")
        )
        if purpose not in {"invitation", "reset"}:
            raise PasswordMailUnavailable()
        message = EmailMessage()
        message["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
        message["To"] = recipient
        message["Subject"] = title
        # Disabling Brevo click tracking also keeps the fragment out of tracking
        # redirects. GET only opens the form; final use requires an explicit POST.
        message["X-Mailin-Track-Clicks"] = "0"
        message["X-Mailin-Track-Opens"] = "0"
        link = f"{settings.app_origin.rstrip('/')}/{path}#token={token}"
        message.set_content(
            f"{title}\n\nBuka tautan berikut, lalu tetapkan password baru sendiri:\n{link}\n\n"
            f"Tautan berlaku {lifetime}, hanya sekali pakai, "
            "dan tidak membuat sesi login otomatis. Jangan bagikan tautan ini. "
            "Semua sesi aplikasi akun akan berakhir setelah password disimpan.\n\n"
            "Jika Anda tidak meminta email ini, abaikan. Membuka tautan saja tidak mengubah akun.\n"
        )
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
                smtp.login(
                    settings.smtp_username.get_secret_value(),
                    settings.smtp_password.get_secret_value(),
                )
                if smtp.send_message(message):
                    raise PasswordMailUnavailable()
                logger.info("password_mail_accepted purpose=%s", purpose)
        except (smtplib.SMTPException, OSError, TimeoutError, ValueError) as error:
            # Operational evidence for cloud egress/IP verification, without
            # identities, server text, links, tokens, messages or credentials.
            logger.warning("password_mail_failed smtp_code=%s", getattr(error, "smtp_code", None))
            raise PasswordMailUnavailable() from error
