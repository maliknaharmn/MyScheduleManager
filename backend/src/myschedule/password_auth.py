"""Owner-only native auth, sharing the existing immutable user and session store."""

import asyncio
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

from myschedule.auth import GOOGLE_ISSUER, Identity, token_hash
from myschedule.config import Settings
from myschedule.database import Database
from myschedule.errors import ApiError
from myschedule.models import AppSession, PasswordCredential, PasswordLink, PasswordRateLimit, User
from myschedule.password_mail import PasswordMailer, PasswordMailUnavailable
from myschedule.passwords import hash_password, validate_password, verify_password


def utcnow() -> datetime:
    return datetime.now(UTC)


class PasswordService:
    def __init__(self, settings: Settings, database: Database, mailer: PasswordMailer):
        self.settings, self.database, self.mailer = settings, database, mailer

    def require_enabled(self) -> None:
        if not self.settings.password_auth_enabled or self.database.auth_engine is None:
            raise ApiError(
                503, "PASSWORD_UNAVAILABLE", "Akses password belum tersedia. Gunakan Google."
            )

    def bucket_hash(self, scope: str, value: str) -> str:
        return hmac.new(
            self.settings.session_secret.get_secret_value().encode(),
            f"native:{self.settings.password_owner_user_id}:{scope}:{value}".encode(),
            hashlib.sha256,
        ).hexdigest()

    async def claim(self, scope: str, value: str, limit: int, seconds: int) -> None:
        """Commit attempted uses independently of a later login/token rollback."""
        now = utcnow()
        cutoff = now - timedelta(seconds=seconds)
        bucket = self.bucket_hash(scope, value)
        stale = PasswordRateLimit.window_start <= cutoff
        async with self.database.session(auth=True) as session:
            # Expired identifiers/IPs need not accumulate indefinitely. No raw
            # identifiers, IP addresses, tokens or passwords are stored here.
            await session.execute(
                delete(PasswordRateLimit).where(
                    PasswordRateLimit.user_id == self.settings.password_owner_user_id,
                    PasswordRateLimit.window_start < now - timedelta(days=2),
                )
            )
            row = (
                await session.execute(
                    insert(PasswordRateLimit)
                    .values(
                        bucket_hash=bucket,
                        user_id=self.settings.password_owner_user_id,
                        window_start=now,
                        attempts=1,
                    )
                    .on_conflict_do_update(
                        index_elements=[PasswordRateLimit.bucket_hash],
                        set_={
                            "window_start": case(
                                (stale, now), else_=PasswordRateLimit.window_start
                            ),
                            "attempts": case(
                                (stale, 1),
                                else_=func.least(PasswordRateLimit.attempts + 1, limit + 1),
                            ),
                        },
                    )
                    .returning(PasswordRateLimit.attempts)
                )
            ).scalar_one()
        if row > limit:
            raise ApiError(429, "PASSWORD_RATE_LIMIT", "Terlalu banyak percobaan. Coba lagi nanti.")

    def identifier_key(self, value: str) -> str:
        normalized = value.strip().casefold()
        if normalized in {
            self.settings.password_owner_username,
            self.settings.password_owner_email.casefold(),
        }:
            # Username/email aliases must not double the owner's attempt budget.
            return str(self.settings.password_owner_user_id)
        return normalized

    async def login_budget(self, identifier: str, peer: str) -> None:
        await self.claim("login-global", "all", 60, 900)
        # Use the ASGI peer only, never arbitrary client-supplied forwarding headers.
        # This is a supplementary limit, not the sole credential protection.
        await self.claim("login-peer", peer, 30, 900)
        await self.claim("credentials", self.identifier_key(identifier), 5, 900)

    async def owner(self, session):
        # Fail closed on changed/disabled/absent identities. Never create or merge
        # a User from an email. All credential/session writes serialize on User.
        return await session.scalar(
            select(User)
            .where(
                User.id == self.settings.password_owner_user_id,
                User.google_issuer == GOOGLE_ISSUER,
                func.lower(User.email) == self.settings.password_owner_email.casefold(),
                User.disabled_at.is_(None),
            )
            .with_for_update()
        )

    async def credential(self, session) -> PasswordCredential | None:
        return await session.scalar(
            select(PasswordCredential)
            .where(
                PasswordCredential.user_id == self.settings.password_owner_user_id,
                PasswordCredential.username == self.settings.password_owner_username,
                PasswordCredential.email == self.settings.password_owner_email.casefold(),
            )
            .with_for_update()
        )

    async def login(self, identifier: str, password: str, old_token: str | None, peer: str) -> str:
        self.require_enabled()
        await self.login_budget(identifier, peer)
        token = secrets.token_urlsafe(48)
        matched = False
        async with self.database.session(auth=True) as session:
            user = await self.owner(session)
            credential = await self.credential(session) if user else None
            encoded = (
                credential.password_hash if credential and credential.email_verified_at else None
            )
            password_matches = await verify_password(encoded, password)
            matched = bool(
                user
                and encoded
                and password_matches
                and self.identifier_key(identifier) == str(user.id)
            )
            if matched:
                if old_token:
                    await session.execute(
                        update(AppSession)
                        .where(
                            AppSession.user_id == user.id,
                            AppSession.token_hash == token_hash(old_token),
                            AppSession.revoked_at.is_(None),
                        )
                        .values(revoked_at=utcnow())
                    )
                session.add(
                    AppSession(
                        user_id=user.id,
                        token_hash=token_hash(token),
                        expires_at=utcnow() + timedelta(seconds=self.settings.session_ttl_seconds),
                    )
                )
        if not matched:
            raise ApiError(
                401, "PASSWORD_LOGIN_FAILED", "Username/email atau password tidak cocok."
            )
        return token

    async def issue_email(self, email: str, purpose: str, peer: str) -> bool:
        """SMTP acceptance + commit, not inbox confirmation or an account-existence API."""
        self.require_enabled()
        assert purpose in {"invitation", "reset"}
        await self.claim("email-global", "all", 10, 3600)
        await self.claim("email-peer", peer, 6, 3600)
        normalized = email.strip().casefold()
        # Shared across invitation/reset so switching forms cannot bypass limits.
        await self.claim("email-cooldown", normalized, 1, 60)
        await self.claim("email-hour", normalized, 3, 3600)
        if normalized != self.settings.password_owner_email.casefold():
            return False
        try:
            async with self.database.session(auth=True) as session:
                user = await self.owner(session)
                if user is None:
                    return False
                credential = await self.credential(session)
                if purpose == "reset" and not (
                    credential and credential.password_hash and credential.email_verified_at
                ):
                    return False
                if purpose == "invitation" and credential and credential.password_hash:
                    return False
                if credential is None:
                    credential = PasswordCredential(
                        user_id=user.id,
                        username=self.settings.password_owner_username,
                        email=normalized,
                    )
                    session.add(credential)
                    await session.flush()
                raw = secrets.token_urlsafe(32)
                # Keep the per-user lock while sending to serialize resends. SMTP
                # is bounded to 10s; a transport failure rolls back the new link
                # and retains old usable links. No plaintext-token outbox is stored.
                await asyncio.to_thread(self.mailer.send, normalized, purpose, raw)
                now = utcnow()
                await session.execute(
                    update(PasswordLink)
                    .where(
                        PasswordLink.user_id == user.id,
                        PasswordLink.purpose == purpose,
                        PasswordLink.consumed_at.is_(None),
                    )
                    .values(consumed_at=now)
                )
                session.add(
                    PasswordLink(
                        user_id=user.id,
                        purpose=purpose,
                        token_hash=token_hash(raw),
                        created_at=now,
                        expires_at=now + timedelta(hours=24)
                        if purpose == "invitation"
                        else now + timedelta(minutes=30),
                    )
                )
            return True
        except PasswordMailUnavailable:
            # Conditional public copy is the same for unknown, disabled and
            # undeliverable accounts. The controlled invitation command checks False.
            return False

    async def replace_password(
        self, session, credential: PasswordCredential, password: str
    ) -> None:
        validate_password(password, credential.username, credential.email)
        if credential.password_hash and await verify_password(credential.password_hash, password):
            raise ApiError(422, "PASSWORD_REUSED", "Pilih password baru yang berbeda.")
        now = utcnow()
        credential.password_hash = await hash_password(password)
        credential.email_verified_at = credential.email_verified_at or now
        credential.password_changed_at = now
        await session.execute(
            update(PasswordLink)
            .where(
                PasswordLink.user_id == credential.user_id,
                PasswordLink.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        await session.execute(
            update(AppSession)
            .where(
                AppSession.user_id == credential.user_id,
                AppSession.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )

    async def use_link(self, raw: str, purpose: str, password: str, peer: str) -> None:
        self.require_enabled()
        await self.claim("link-global", "all", 60, 900)
        await self.claim("link-peer", peer, 30, 900)
        async with self.database.session(auth=True) as session:
            user = await self.owner(session)
            credential = await self.credential(session) if user else None
            link = (
                await session.scalar(
                    select(PasswordLink)
                    .where(
                        PasswordLink.token_hash == token_hash(raw),
                        PasswordLink.purpose == purpose,
                        PasswordLink.user_id == self.settings.password_owner_user_id,
                        PasswordLink.consumed_at.is_(None),
                        PasswordLink.expires_at > utcnow(),
                    )
                    .with_for_update()
                )
                if credential
                else None
            )
            if (
                not link
                or (purpose == "invitation" and credential.password_hash)
                or (purpose == "reset" and not credential.password_hash)
            ):
                raise ApiError(
                    400,
                    "PASSWORD_LINK_INVALID",
                    "Tautan tidak valid atau kedaluwarsa. Minta tautan baru.",
                )
            await self.replace_password(session, credential, password)

    async def change(self, identity: Identity, current: str, password: str, peer: str) -> None:
        self.require_enabled()
        if identity.user_id != self.settings.password_owner_user_id:
            raise ApiError(403, "PASSWORD_UNAVAILABLE", "Password belum diaktifkan untuk akun ini.")
        await self.login_budget(self.settings.password_owner_username, peer)
        async with self.database.session(auth=True) as session:
            user = (
                await self.owner(session)
                if identity.user_id == self.settings.password_owner_user_id
                else None
            )
            credential = await self.credential(session) if user else None
            live_session = await session.scalar(
                select(AppSession.id).where(
                    AppSession.id == identity.session_id,
                    AppSession.user_id == identity.user_id,
                    AppSession.revoked_at.is_(None),
                    AppSession.expires_at > utcnow(),
                )
            )
            correct = await verify_password(
                credential.password_hash if credential else None, current
            )
            if (
                not credential
                or not credential.email_verified_at
                or not live_session
                or not correct
            ):
                raise ApiError(
                    401,
                    "PASSWORD_LOGIN_FAILED",
                    "Password saat ini tidak cocok atau sesi berakhir.",
                )
            await self.replace_password(session, credential, password)

    async def security(self, identity: Identity) -> dict:
        enabled = (
            self.settings.password_auth_enabled
            and identity.user_id == self.settings.password_owner_user_id
        )
        if not enabled:
            return {"enabled": False, "password_active": False, "username": None, "email": None}
        async with self.database.session(auth=True) as session:
            user = await self.owner(session)
            credential = await self.credential(session) if user else None
            return {
                "enabled": bool(user),
                "password_active": bool(
                    credential and credential.password_hash and credential.email_verified_at
                ),
                "username": credential.username if credential else None,
                "email": credential.email if credential else None,
            }
