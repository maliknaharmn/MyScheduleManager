"""Password primitives. No identity provisioning, network screening or plaintext persistence."""

import asyncio
import re
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from myschedule.errors import ApiError

# OWASP's Argon2id minimum: 19 MiB, two iterations, one lane. At most two
# simultaneous operations per process on the existing small Cloud instance.
_hasher = PasswordHasher(memory_cost=19456, time_cost=2, parallelism=1)
_workers = asyncio.Semaphore(2)

# Public examples, not user credentials. Conservative offline screening avoids
# transmitting even password-derived data to an unapproved breach-lookup service.
_common = {
    "password",
    "password1",
    "password123",
    "password1234",
    "qwerty123",
    "qwerty1234",
    "welcome1",
    "welcome123",
    "admin123",
    "admin1234",
    "abc12345",
    "abc123456",
    "letmein1",
    "changeme1",
    "iloveyou1",
    "12345678",
    "123456789",
    "p@ssw0rd",
    "p@ssword1",
    "passw0rd",
    "password2026",
    "myschedule1",
    "myschedule123",
}


def validate_password(value: str, username: str, email: str) -> None:
    if (
        not 8 <= len(value) <= 128
        or not re.search(r"[A-Z]", value)
        or not re.search(r"[0-9]", value)
    ):
        raise ApiError(
            422, "PASSWORD_POLICY", "Gunakan 8-128 karakter, minimal satu kapital dan satu angka."
        )
    if any(character == "\x00" for character in value):
        raise ApiError(422, "PASSWORD_POLICY", "Password memuat karakter yang tidak didukung.")
    folded = value.casefold()
    stem = folded.rstrip("0123456789!@#$%^&*._- ")
    identities = {username.casefold(), email.casefold(), email.split("@")[0].casefold()}
    if folded in _common or stem in _common or folded in identities or stem in identities:
        raise ApiError(
            422,
            "PASSWORD_TOO_COMMON",
            "Pilih password yang tidak umum dan bukan turunan username atau email.",
        )


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    # A public dummy value for equal-cost verification of unknown credentials.
    return _hasher.hash("public-dummy-not-an-account-password")


async def hash_password(value: str) -> str:
    async with _workers:
        return await asyncio.to_thread(_hasher.hash, value)


def _verify(encoded: str | None, value: str) -> bool:
    try:
        matched = _hasher.verify(encoded or _dummy_hash(), value)
        return bool(encoded and matched)
    except (VerificationError, InvalidHashError):
        return False


async def verify_password(encoded: str | None, value: str) -> bool:
    async with _workers:
        return await asyncio.to_thread(_verify, encoded, value)
