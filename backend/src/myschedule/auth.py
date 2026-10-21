import asyncio
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Annotated
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
import httpx2
from authlib.integrations.httpx_client import AsyncOAuth2Client
from authlib.oauth2.rfc6749.errors import OAuth2Error
from fastapi import Request, Security
from fastapi.security import APIKeyCookie
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.id_token import verify_oauth2_token
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from myschedule.config import Settings
from myschedule.database import Database
from myschedule.errors import ApiError
from myschedule.models import AppSession, Profile, Tag, User

SESSION_COOKIE = "myschedule_session"
OAUTH_COOKIE = "myschedule_oauth"
OAUTH_PATH = "/api/v1/auth/google"
GOOGLE_ISSUER = "https://accounts.google.com"
session_cookie = APIKeyCookie(name=SESSION_COOKIE, auto_error=False)


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str
    display_name: str | None


@dataclass(frozen=True)
class Handshake:
    state: str
    binding: str
    nonce: str
    verifier: str
    return_to: str
    expires_at: float


class HandshakeStore:
    """Single-process spike store. Restart fails closed; multi-worker deployment is not supported.

    There is intentionally no replayable state stored in a signed-but-readable browser cookie.
    Move to shared durable/TTL storage before deploying multiple API replicas/workers.
    """

    def __init__(self, ttl: int = 600, capacity: int = 512):
        self.ttl, self.capacity = ttl, capacity
        self._entries: dict[str, Handshake] = {}
        self._lock = Lock()

    def create(self, return_to: str) -> Handshake:
        now = time.monotonic()
        with self._lock:
            self._entries = {k: v for k, v in self._entries.items() if v.expires_at > now}
            if len(self._entries) >= self.capacity:
                raise ApiError(
                    429, "LOGIN_BUSY", "Terlalu banyak percobaan login. Coba lagi nanti."
                )
            item = Handshake(
                secrets.token_urlsafe(32),
                secrets.token_urlsafe(32),
                secrets.token_urlsafe(32),
                secrets.token_urlsafe(64),
                return_to,
                now + self.ttl,
            )
            self._entries[item.state] = item
            return item

    def consume(self, state: str, binding: str) -> Handshake:
        with self._lock:
            item = self._entries.get(state)
            if item is None or not secrets.compare_digest(item.binding, binding):
                raise ApiError(
                    400, "OAUTH_STATE_INVALID", "Sesi login tidak valid. Mulai login lagi."
                )
            self._entries.pop(state)
            if item.expires_at <= time.monotonic():
                raise ApiError(400, "OAUTH_STATE_EXPIRED", "Sesi login kedaluwarsa. Mulai lagi.")
            return item


def safe_return_to(value: str) -> str:
    parts = urlsplit(value)
    if (
        parts.scheme
        or parts.netloc
        or not value.startswith("/")
        or value.startswith("//")
        or "\\" in value
        or any(ord(c) < 32 for c in value)
    ):
        raise ApiError(422, "INVALID_RETURN_PATH", "Tujuan kembali harus halaman aplikasi ini.")
    allowed = ("/", "/agenda", "/notes", "/settings", "/week", "/day")
    if parts.path != "/" and not any(
        parts.path == path or parts.path.startswith(path + "/") for path in allowed[1:]
    ):
        raise ApiError(422, "INVALID_RETURN_PATH", "Halaman tujuan tidak diizinkan.")
    return value


class GoogleClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _client(self) -> AsyncOAuth2Client:
        return AsyncOAuth2Client(
            self.settings.google_client_id,
            self.settings.google_client_secret.get_secret_value(),
            redirect_uri=self.settings.google_redirect_uri,
            scope="openid email profile",
            code_challenge_method="S256",
            token_endpoint_auth_method="client_secret_post",
            timeout=15,
        )

    async def authorization_url(self, handshake: Handshake) -> str:
        async with self._client() as client:
            url, _ = client.create_authorization_url(
                "https://accounts.google.com/o/oauth2/v2/auth",
                state=handshake.state,
                nonce=handshake.nonce,
                code_verifier=handshake.verifier,
            )
            return url

    async def exchange(self, code: str, handshake: Handshake) -> GoogleIdentity:
        try:
            async with self._client() as client:
                token = await client.fetch_token(
                    "https://oauth2.googleapis.com/token",
                    grant_type="authorization_code",
                    code=code,
                    code_verifier=handshake.verifier,
                )
            claims = await asyncio.to_thread(
                verify_oauth2_token,
                token["id_token"],
                GoogleRequest(),
                self.settings.google_client_id,
            )
            if (
                not secrets.compare_digest(str(claims.get("nonce", "")), handshake.nonce)
                or claims.get("email_verified") is not True
                or not claims.get("sub")
                or not claims.get("email")
            ):
                raise ValueError("Invalid verified identity")
            return GoogleIdentity(claims["sub"], claims["email"], claims.get("name"))
        except (
            httpx.HTTPError,
            httpx2.HTTPError,
            OAuth2Error,
            GoogleAuthError,
            ValueError,
            KeyError,
        ) as exc:
            raise ApiError(
                401, "GOOGLE_LOGIN_FAILED", "Login Google gagal. Silakan mulai lagi."
            ) from exc


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_for_hash(session_hash: str, settings: Settings) -> str:
    if settings.session_secret is None:
        raise ApiError(503, "AUTH_NOT_CONFIGURED", "Konfigurasi keamanan belum lengkap.")
    return hmac.new(
        settings.session_secret.get_secret_value().encode(),
        f"csrf:{session_hash}".encode(),
        hashlib.sha256,
    ).hexdigest()


@dataclass(frozen=True)
class Identity:
    user_id: UUID
    session_id: UUID
    email: str
    display_name: str | None
    session_hash: str


def assert_allowed_email(email: str, settings: Settings) -> None:
    if email.casefold() not in {e.casefold() for e in settings.allowed_google_emails}:
        raise ApiError(403, "ACCOUNT_NOT_ALLOWED", "Akun ini belum diizinkan mengakses aplikasi.")


async def create_login(
    database: Database, settings: Settings, identity: GoogleIdentity, old_token: str | None
) -> str:
    assert_allowed_email(identity.email, settings)
    token = secrets.token_urlsafe(48)
    async with database.session(auth=True) as session:
        user = await session.scalar(
            select(User)
            .where(User.google_issuer == GOOGLE_ISSUER, User.google_subject == identity.subject)
            .with_for_update()
        )
        if user and user.disabled_at is not None:
            raise ApiError(403, "ACCOUNT_NOT_ALLOWED", "Akun ini tidak aktif.")
        if user is None:
            # Use ON CONFLICT for simultaneous first sign-ins on two devices.
            user_id = await session.scalar(
                insert(User)
                .values(
                    id=uuid4(),
                    google_issuer=GOOGLE_ISSUER,
                    google_subject=identity.subject,
                    email=identity.email,
                    display_name=identity.display_name,
                )
                .on_conflict_do_nothing(index_elements=["google_issuer", "google_subject"])
                .returning(User.id)
            )
            if user_id is None:
                user = await session.scalar(
                    select(User)
                    .where(
                        User.google_issuer == GOOGLE_ISSUER, User.google_subject == identity.subject
                    )
                    .with_for_update()
                )
                if user is None or user.disabled_at is not None:
                    raise ApiError(403, "ACCOUNT_NOT_ALLOWED", "Akun ini tidak aktif.")
                user_id = user.id
        else:
            user_id = user.id
        await session.execute(
            update(User)
            .where(User.id == user_id)
            .values(email=identity.email, display_name=identity.display_name)
        )
        await session.execute(
            text("SELECT set_config('app.user_id', :id, true)"), {"id": str(user_id)}
        )
        await session.execute(insert(Profile).values(user_id=user_id).on_conflict_do_nothing())
        for name in ("Important", "Plan", "Target"):
            await session.execute(
                insert(Tag)
                .values(
                    id=uuid4(),
                    user_id=user_id,
                    name=name,
                    normalized_name=name.casefold(),
                    system_key=name.casefold(),
                )
                .on_conflict_do_nothing()
            )
        if old_token:
            await session.execute(
                update(AppSession)
                .where(
                    AppSession.user_id == user_id, AppSession.token_hash == token_hash(old_token)
                )
                .values(revoked_at=datetime.now(UTC))
            )
        session.add(
            AppSession(
                user_id=user_id,
                token_hash=token_hash(token),
                expires_at=datetime.now(UTC) + timedelta(seconds=settings.session_ttl_seconds),
            )
        )
    return token


async def current_identity(
    request: Request, token: Annotated[str | None, Security(session_cookie)]
) -> Identity:
    if not token or len(token) > 256:
        raise ApiError(401, "AUTH_REQUIRED", "Login Google untuk mengakses jadwal pribadi.")
    database: Database = request.app.state.database
    if database.auth_engine is None:
        raise ApiError(503, "DATABASE_NOT_CONFIGURED", "Database autentikasi belum dikonfigurasi.")
    async with database.session(auth=True) as session:
        row = (
            await session.execute(
                select(AppSession, User)
                .join(User, User.id == AppSession.user_id)
                .where(
                    AppSession.token_hash == token_hash(token),
                    AppSession.revoked_at.is_(None),
                    AppSession.expires_at > datetime.now(UTC),
                    User.disabled_at.is_(None),
                )
            )
        ).one_or_none()
        if row is None:
            raise ApiError(401, "AUTH_REQUIRED", "Sesi berakhir. Silakan login kembali.")
        login, user = row
        assert_allowed_email(user.email, request.app.state.settings)
        return Identity(user.id, login.id, user.email, user.display_name, login.token_hash)


def assert_csrf(request: Request, identity: Identity) -> None:
    settings: Settings = request.app.state.settings
    token = request.headers.get("X-CSRF-Token", "")
    if request.headers.get("origin") != settings.app_origin.rstrip(
        "/"
    ) or not secrets.compare_digest(token, csrf_for_hash(identity.session_hash, settings)):
        raise ApiError(403, "CSRF_FAILED", "Permintaan tidak valid. Muat ulang halaman.")
