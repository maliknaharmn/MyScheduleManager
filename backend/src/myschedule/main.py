import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, Response
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from myschedule.auth import (
    OAUTH_COOKIE,
    OAUTH_PATH,
    SESSION_COOKIE,
    GoogleClient,
    HandshakeStore,
    Identity,
    assert_csrf,
    create_login,
    csrf_for_hash,
    current_identity,
    safe_return_to,
)
from myschedule.config import Settings, get_settings
from myschedule.database import Database
from myschedule.errors import ApiError, api_error_handler, envelope, validation_error_handler
from myschedule.models import AppSession, Profile
from myschedule.resources import router as resource_router
from myschedule.schemas import (
    EnvelopeResponse,
    ErrorResponse,
    HealthData,
    MeData,
    ProfileUpdate,
    PublicProfile,
    StatusData,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await app.state.database.close()

    app = FastAPI(
        title="MySchedule Manager",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.app_env != "production" else None,
        responses={
            status: {"model": ErrorResponse} for status in (400, 401, 403, 404, 409, 422, 429, 503)
        },
    )
    app.state.settings = settings
    app.state.database = Database(settings)
    app.state.handshakes = HandshakeStore()
    app.state.google = GoogleClient(settings)
    app.include_router(resource_router)

    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError):
        return await api_error_handler(
            request,
            ApiError(503, "DATABASE_UNAVAILABLE", "Data belum dapat diproses. Coba lagi sebentar."),
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return await api_error_handler(
            request,
            ApiError(
                exc.status_code,
                "NOT_FOUND" if exc.status_code == 404 else "REQUEST_FAILED",
                "Halaman tidak ditemukan."
                if exc.status_code == 404
                else "Permintaan tidak tersedia.",
            ),
        )

    @app.middleware("http")
    async def response_security(request: Request, call_next):
        request.state.request_id = secrets.token_hex(12)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.get("/health/live", tags=["health"], response_model=EnvelopeResponse[HealthData])
    async def live(request: Request):
        return envelope(request, {"status": "ok"})

    async def database_ready() -> bool:
        return await app.state.database.ready()

    @app.get(
        "/health/ready",
        tags=["health"],
        response_model=EnvelopeResponse[HealthData],
        responses={503: {"model": EnvelopeResponse[HealthData]}},
    )
    async def ready(request: Request):
        healthy = await database_ready()
        return JSONResponse(
            status_code=200 if healthy else 503,
            content=envelope(request, {"status": "ready" if healthy else "not_ready"}),
        )

    @app.get("/api/v1/status", tags=["setup"], response_model=EnvelopeResponse[StatusData])
    async def status(request: Request):
        return envelope(
            request,
            {
                "phase": "foundation",
                "database": "ready" if await database_ready() else "not_ready",
                "google_login_configured": settings.google_login_configured,
                "calendar_integration": "not_implemented",
                "capabilities": {"schedules": True, "notes": True, "calendar_reminders": False},
                "auth_handshake_storage": "single_process_memory",
            },
        )

    @app.get("/api/v1/auth/google/start", tags=["auth"])
    async def google_start(request: Request, return_to: str = Query("/", max_length=500)):
        return_to = safe_return_to(return_to)
        if not settings.google_login_configured:
            raise ApiError(
                503, "GOOGLE_NOT_CONFIGURED", "Login Google belum dikonfigurasi di server."
            )
        handshake = app.state.handshakes.create(return_to)
        url = await app.state.google.authorization_url(handshake)
        response = RedirectResponse(url, status_code=303)
        response.set_cookie(
            OAUTH_COOKIE,
            handshake.binding,
            max_age=600,
            path=OAUTH_PATH,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
        )
        return response

    @app.get("/api/v1/auth/google/callback", tags=["auth"])
    async def google_callback(
        request: Request,
        state: str = Query("", max_length=256),
        code: str = Query("", max_length=4096),
        error: str | None = Query(None, max_length=200),
    ):
        handshake = app.state.handshakes.consume(state, request.cookies.get(OAUTH_COOKIE, ""))
        if error or not code:
            response = RedirectResponse(f"{settings.app_origin}/login?error=google_cancelled", 303)
        else:
            identity = await app.state.google.exchange(code, handshake)
            token = await create_login(
                app.state.database, settings, identity, request.cookies.get(SESSION_COOKIE)
            )
            response = RedirectResponse(f"{settings.app_origin}{handshake.return_to}", 303)
            response.set_cookie(
                SESSION_COOKIE,
                token,
                max_age=settings.session_ttl_seconds,
                httponly=True,
                secure=settings.cookie_secure,
                samesite="lax",
                path="/",
            )
        response.delete_cookie(OAUTH_COOKIE, path=OAUTH_PATH)
        return response

    Login = Annotated[Identity, Depends(current_identity)]

    @app.get("/api/v1/me", tags=["account"], response_model=EnvelopeResponse[MeData])
    async def me(request: Request, identity: Login):
        async with app.state.database.session(identity.user_id) as session:
            profile = await session.get(Profile, identity.user_id)
            if profile is None:
                raise ApiError(503, "PROFILE_UNAVAILABLE", "Profil belum tersedia. Login kembali.")
            data = {
                "user": {
                    "id": str(identity.user_id),
                    "email": identity.email,
                    "display_name": identity.display_name,
                },
                "profile": {
                    "timezone": profile.timezone,
                    "daily_reminder_time": profile.daily_reminder_time.strftime("%H:%M"),
                    "version": profile.version,
                },
                "csrf_token": csrf_for_hash(identity.session_hash, settings),
                "calendar": {"connection_status": "not_implemented"},
            }
        return envelope(request, data)

    @app.patch(
        "/api/v1/me/profile", tags=["account"], response_model=EnvelopeResponse[PublicProfile]
    )
    async def update_profile(request: Request, identity: Login, body: ProfileUpdate):
        assert_csrf(request, identity)
        async with app.state.database.session(identity.user_id) as session:
            changes = body.model_dump(exclude_unset=True, exclude={"expected_version"})
            row = await session.scalar(
                update(Profile)
                .where(
                    Profile.user_id == identity.user_id,
                    Profile.version == body.expected_version,
                )
                .values(**changes, version=Profile.version + 1)
                .returning(Profile)
            )
            if row is None:
                current = await session.get(Profile, identity.user_id)
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "Profil sudah berubah. Tinjau ulang.",
                    {"current_version": current.version if current else None},
                )
            data = {
                "timezone": row.timezone,
                "daily_reminder_time": row.daily_reminder_time.strftime("%H:%M"),
                "version": row.version,
            }
        return envelope(request, data)

    @app.post("/api/v1/auth/logout", status_code=204, tags=["auth"])
    async def logout(request: Request, identity: Login):
        assert_csrf(request, identity)
        async with app.state.database.session(auth=True) as session:
            await session.execute(
                update(AppSession)
                .where(
                    AppSession.id == identity.session_id,
                    AppSession.user_id == identity.user_id,
                )
                .values(revoked_at=datetime.now(UTC))
            )
        response = Response(status_code=204)
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response

    return app


app = create_app()
