from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2]
PROJECT_DIRECTORY = BACKEND_DIRECTORY.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIRECTORY / ".env", PROJECT_DIRECTORY / ".local/neon-runtime.env"),
        extra="ignore",
        case_sensitive=False,
    )

    app_env: Literal["development", "test", "production"] = "development"
    app_origin: str = "http://localhost:5173"
    database_url: SecretStr | None = None
    auth_database_url: SecretStr | None = None
    database_pool_size: int = Field(default=2, ge=1, le=10)
    database_pool_max_overflow: int = Field(default=1, ge=0, le=10)
    migration_database_url: SecretStr | None = None
    test_database_url: SecretStr | None = None
    test_auth_database_url: SecretStr | None = None
    test_migration_database_url: SecretStr | None = None
    session_secret: SecretStr | None = None
    cookie_secure: bool = False
    session_ttl_seconds: int = 60 * 60 * 24 * 7
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str = "http://localhost:5173/api/v1/auth/google/callback"
    password_auth_enabled: bool = False
    password_owner_user_id: UUID | None = None
    password_owner_email: str = ""
    password_owner_username: Literal["malik"] = "malik"
    smtp_host: Literal["smtp-relay.brevo.com"] = "smtp-relay.brevo.com"
    smtp_port: int = 587
    smtp_security: Literal["starttls"] = "starttls"
    smtp_username: SecretStr = SecretStr("")
    smtp_password: SecretStr = SecretStr("")
    smtp_from_email: str = ""
    smtp_from_name: str = "MySchedule Manager"
    smtp_probe_on_startup: bool = False

    @field_validator("smtp_port")
    @classmethod
    def smtp_starttls_port(cls, value: int) -> int:
        if value not in {587, 2525}:
            raise ValueError("SMTP requires STARTTLS on port 587 or 2525")
        return value

    @model_validator(mode="after")
    def validate_security(self):
        origin = urlsplit(self.app_origin)
        if (
            origin.scheme not in {"http", "https"}
            or not origin.netloc
            or origin.path not in {"", "/"}
        ):
            raise ValueError("APP_ORIGIN must be an HTTP(S) origin without a path")
        if self.session_ttl_seconds < 60:
            raise ValueError("Session lifetime is too short")
        if self.password_auth_enabled:
            from email.utils import parseaddr

            if not self.password_owner_user_id or not self.session_secret:
                raise ValueError("Password auth requires a bound owner ID and session secret")
            if len(self.session_secret.get_secret_value()) < 32:
                raise ValueError("Password auth requires a strong session secret")
            for email in (self.password_owner_email, self.smtp_from_email):
                if (
                    not email
                    or parseaddr(email)[1] != email
                    or email.count("@") != 1
                    or any(character.isspace() for character in email)
                ):
                    raise ValueError("Password auth requires valid owner and sender addresses")
            if any(character in self.smtp_from_name for character in "\r\n"):
                raise ValueError("Invalid sender name")
        if self.password_auth_enabled or self.smtp_probe_on_startup:
            if (
                not self.smtp_username.get_secret_value()
                or not self.smtp_password.get_secret_value()
            ):
                raise ValueError("SMTP requires backend credentials")
        if self.app_env == "production":
            if not self.cookie_secure or origin.scheme != "https":
                raise ValueError("Production requires HTTPS and secure cookies")
            if not self.session_secret or len(self.session_secret.get_secret_value()) < 32:
                raise ValueError("Production requires a strong SESSION_SECRET")
            if not self.database_url or not self.auth_database_url:
                raise ValueError("Production requires both database connections")
        return self

    @property
    def google_login_configured(self) -> bool:
        return bool(
            self.google_client_id
            and self.google_client_secret.get_secret_value()
            and self.session_secret
            and len(self.session_secret.get_secret_value()) >= 32
            and self.database_url
            and self.auth_database_url
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
