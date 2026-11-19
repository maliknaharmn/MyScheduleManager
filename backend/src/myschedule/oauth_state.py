"""Shared OAuth state: encrypted server-side payload, hashed lookup, atomic one-use consume."""

import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import timedelta

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, func, select, text

from myschedule.auth import Handshake, HandshakeStore, safe_return_to
from myschedule.config import Settings
from myschedule.database import Database
from myschedule.errors import ApiError
from myschedule.models import OAuthHandshake

# Capacity is shared across all instances. This application-specific transaction
# lock serializes allocation, not callback consumption or unrelated API requests.
ALLOCATION_LOCK = 635904729184293


class MemoryHandshakeBackend:
    """Compatibility adapter for the original single-worker API during rollout."""

    def __init__(self):
        self.store = HandshakeStore()

    async def create(self, return_to: str) -> Handshake:
        return self.store.create(return_to)

    async def consume(self, state: str, binding: str) -> Handshake:
        return self.store.consume(state, binding)


class PostgresHandshakeBackend:
    def __init__(self, database: Database, settings: Settings, *, capacity: int = 512):
        if not settings.session_secret or len(settings.session_secret.get_secret_value()) < 32:
            raise ValueError("Shared OAuth state requires a strong session secret")
        if not 1 <= capacity <= 512:
            raise ValueError("Invalid OAuth state capacity")
        self.database, self.capacity = database, capacity
        key = hmac.digest(
            settings.session_secret.get_secret_value().encode(),
            b"oauth-state-encryption-v1",
            "sha256",
        )
        self.cipher = Fernet(base64.urlsafe_b64encode(key))

    async def create(self, return_to: str) -> Handshake:
        return_to = safe_return_to(return_to)
        state, binding, nonce, verifier = (
            secrets.token_urlsafe(32),
            secrets.token_urlsafe(32),
            secrets.token_urlsafe(32),
            secrets.token_urlsafe(64),
        )
        async with self.database.session(auth=True) as session:
            await session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": ALLOCATION_LOCK}
            )
            now = await session.scalar(select(func.clock_timestamp()))
            await session.execute(delete(OAuthHandshake).where(OAuthHandshake.expires_at <= now))
            count = await session.scalar(select(func.count()).select_from(OAuthHandshake))
            if count >= self.capacity:
                raise ApiError(
                    429, "LOGIN_BUSY", "Terlalu banyak percobaan login. Coba lagi nanti."
                )
            expires = now + timedelta(minutes=10)
            # Include the lookup state inside authenticated ciphertext to prevent row swapping.
            payload = json.dumps(
                {"state": state, "nonce": nonce, "verifier": verifier, "return_to": return_to}
            ).encode()
            session.add(
                OAuthHandshake(
                    state_hash=hashlib.sha256(state.encode()).hexdigest(),
                    binding_hash=hashlib.sha256(binding.encode()).hexdigest(),
                    encrypted_payload=self.cipher.encrypt(payload).decode(),
                    created_at=now,
                    expires_at=expires,
                )
            )
        return Handshake(state, binding, nonce, verifier, return_to, expires.timestamp())

    async def consume(self, state: str, binding: str) -> Handshake:
        if not all(re.fullmatch(r"[A-Za-z0-9_-]{43}", value) for value in (state, binding)):
            raise self._invalid()
        async with self.database.session(auth=True) as session:
            result = await session.execute(
                delete(OAuthHandshake)
                .where(
                    OAuthHandshake.state_hash == hashlib.sha256(state.encode()).hexdigest(),
                    OAuthHandshake.binding_hash == hashlib.sha256(binding.encode()).hexdigest(),
                )
                .returning(OAuthHandshake.encrypted_payload, OAuthHandshake.expires_at)
            )
            item = result.one_or_none()
            now = await session.scalar(select(func.clock_timestamp()))
        # Commit consumption before validating expiry/payload: errors must never roll it back.
        # A wrong/missing browser binding never consumes the legitimate flow's row.
        if item is None:
            raise self._invalid()
        if item.expires_at <= now:
            raise ApiError(400, "OAUTH_STATE_EXPIRED", "Sesi login kedaluwarsa. Mulai lagi.")
        try:
            payload = json.loads(self.cipher.decrypt(item.encrypted_payload.encode()))
            if payload["state"] != state or not all(
                isinstance(payload[key], str) for key in ("nonce", "verifier", "return_to")
            ):
                raise ValueError
            return_to = safe_return_to(payload["return_to"])
            return Handshake(
                state,
                binding,
                payload["nonce"],
                payload["verifier"],
                return_to,
                item.expires_at.timestamp(),
            )
        except (InvalidToken, ValueError, TypeError, KeyError):
            raise self._invalid() from None

    @staticmethod
    def _invalid() -> ApiError:
        return ApiError(400, "OAUTH_STATE_INVALID", "Sesi login tidak valid. Mulai login lagi.")
