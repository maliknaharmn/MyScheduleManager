from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, model_validator
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
    migration_database_url: SecretStr | None = None
    test_database_url: SecretStr | None = None
    test_auth_database_url: SecretStr | None = None
    test_migration_database_url: SecretStr | None = None
    session_secret: SecretStr | None = None
    cookie_secure: bool = False
    session_ttl_seconds: int = 60 * 60 * 24 * 7
    allowed_google_emails: list[str] = []
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str = "http://localhost:5173/api/v1/auth/google/callback"

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
            and self.allowed_google_emails
            and self.session_secret
            and len(self.session_secret.get_secret_value()) >= 32
            and self.database_url
            and self.auth_database_url
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
