import hashlib
import hmac
import re
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from myschedule.auth import SESSION_COOKIE, Identity, assert_csrf, current_identity
from myschedule.config import Settings
from myschedule.errors import ApiError, envelope
from myschedule.password_auth import PasswordService
from myschedule.password_schemas import (
    PasswordChange,
    PasswordContext,
    PasswordEmail,
    PasswordLinkUse,
    PasswordLogin,
    PasswordMessage,
    PasswordSecurity,
)
from myschedule.schemas import EnvelopeResponse

router = APIRouter(prefix="/api/v1/auth/password", tags=["auth"])
PREAUTH_COOKIE = "myschedule_password_csrf"
PREAUTH_PATH = "/api/v1/auth/password"
Login = Annotated[Identity, Depends(current_identity)]


def csrf_value(binding: str, settings: Settings) -> str:
    return hmac.new(
        settings.session_secret.get_secret_value().encode(),
        f"password-csrf:{binding}".encode(),
        hashlib.sha256,
    ).hexdigest()


def service(request: Request) -> PasswordService:
    result = request.app.state.password_auth
    result.require_enabled()
    return result


def assert_preauth_csrf(request: Request) -> None:
    settings = request.app.state.settings
    binding = request.cookies.get(PREAUTH_COOKIE, "")
    supplied = request.headers.get("X-CSRF-Token", "")
    if (
        request.headers.get("origin") != settings.app_origin.rstrip("/")
        or not re.fullmatch(r"[A-Za-z0-9_-]{43}", binding)
        or not secrets.compare_digest(supplied.encode(), csrf_value(binding, settings).encode())
    ):
        raise ApiError(403, "CSRF_FAILED", "Permintaan tidak valid. Muat ulang halaman.")


def peer(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("/context", response_model=EnvelopeResponse[PasswordContext])
async def context(request: Request, response: Response):
    settings = request.app.state.settings
    enabled = settings.password_auth_enabled and await request.app.state.database.status_ready()
    token = None
    if enabled:
        binding = request.cookies.get(PREAUTH_COOKIE, "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", binding):
            binding = secrets.token_urlsafe(32)
        response.set_cookie(
            PREAUTH_COOKIE,
            binding,
            path=PREAUTH_PATH,
            max_age=3600,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="strict",
        )
        token = csrf_value(binding, settings)
    return envelope(request, {"enabled": enabled, "registration_open": False, "csrf_token": token})


@router.get("/security", response_model=EnvelopeResponse[PasswordSecurity])
async def security(request: Request, identity: Login):
    return envelope(request, await request.app.state.password_auth.security(identity))


@router.post("/login", status_code=204)
async def login(request: Request, body: PasswordLogin):
    native = service(request)
    assert_preauth_csrf(request)
    token = await native.login(
        body.identifier,
        body.password.get_secret_value(),
        request.cookies.get(SESSION_COOKIE),
        peer(request),
    )
    settings = request.app.state.settings
    response = Response(status_code=204)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_seconds,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
    return response


@router.post("/signup", status_code=403)
async def signup(request: Request):
    # Deliberately not an account-creation endpoint. Full public signup visuals
    # must not override the owner-only native enrollment policy.
    raise ApiError(
        403, "PASSWORD_REGISTRATION_CLOSED", "Pendaftaran password belum dibuka. Gunakan Google."
    )


@router.post("/invitation", status_code=202, response_model=EnvelopeResponse[PasswordMessage])
async def invitation(request: Request, body: PasswordEmail):
    native = service(request)
    assert_preauth_csrf(request)
    await native.issue_email(body.email, "invitation", peer(request))
    return envelope(
        request,
        {
            "message": "Jika akun memenuhi syarat aktivasi, undangan akan dikirim. "
            "Periksa inbox dan spam."
        },
    )


@router.post("/forgot", status_code=202, response_model=EnvelopeResponse[PasswordMessage])
async def forgot(request: Request, body: PasswordEmail):
    native = service(request)
    assert_preauth_csrf(request)
    await native.issue_email(body.email, "reset", peer(request))
    return envelope(
        request,
        {
            "message": "Jika akun memiliki password dan email terverifikasi, "
            "tautan reset akan dikirim. Periksa inbox dan spam."
        },
    )


async def use_link(request: Request, body: PasswordLinkUse, purpose: str) -> Response:
    native = service(request)
    assert_preauth_csrf(request)
    await native.use_link(
        body.token.get_secret_value(), purpose, body.password.get_secret_value(), peer(request)
    )
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.post("/activate", status_code=204)
async def activate(request: Request, body: PasswordLinkUse):
    return await use_link(request, body, "invitation")


@router.post("/reset", status_code=204)
async def reset(request: Request, body: PasswordLinkUse):
    return await use_link(request, body, "reset")


@router.post("/change", status_code=204)
async def change(request: Request, body: PasswordChange, identity: Login):
    native = service(request)
    assert_csrf(request, identity)
    await native.change(
        identity,
        body.current_password.get_secret_value(),
        body.password.get_secret_value(),
        peer(request),
    )
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
