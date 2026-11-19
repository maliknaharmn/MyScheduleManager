"""Brevo SMTP/HTTPS transports. Never log messages, links, credentials or provider bodies."""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

import httpx

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
        # Request no relay tracking; use plaintext rather than HTML tracking assets.
        # GET only opens the form; final use requires an explicit POST.
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
        if settings.mail_transport == "brevo_api":
            self._send_https(recipient, title, message.get_content(), purpose)
            return
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

    def _send_https(self, recipient: str, title: str, content: str, purpose: str) -> None:
        # Fixed HTTPS destination, verified certificates, no redirects, retries or SMTP fallback.
        # A timeout may occur after acceptance; automatically sending again could duplicate mail.
        status = None
        try:
            with httpx.Client(
                timeout=10, verify=True, follow_redirects=False, trust_env=False
            ) as client:
                response = client.post(
                    "https://api.brevo.com/v3/smtp/email",
                    headers={
                        "api-key": self.settings.brevo_api_key.get_secret_value(),
                        "accept": "application/json",
                    },
                    json={
                        "sender": {
                            "name": self.settings.smtp_from_name,
                            "email": self.settings.smtp_from_email,
                        },
                        "to": [{"email": recipient}],
                        "subject": title,
                        "textContent": content,
                        "headers": {"X-Mailin-Track-Clicks": "0", "X-Mailin-Track-Opens": "0"},
                    },
                )
                status = response.status_code
                if status != 201:
                    raise ValueError("Brevo did not confirm acceptance")
                message_id = response.json().get("messageId")
                if not isinstance(message_id, str) or not message_id.strip():
                    raise ValueError("Brevo did not confirm acceptance")
            logger.info("password_mail_accepted purpose=%s transport=brevo_api", purpose)
        except (httpx.HTTPError, OSError, TimeoutError, ValueError, TypeError, AttributeError):
            logger.warning("password_mail_failed transport=brevo_api http_status=%s", status)
            raise PasswordMailUnavailable() from None
