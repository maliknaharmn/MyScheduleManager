import smtplib
import ssl
from contextlib import asynccontextmanager
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest

from myschedule.config import Settings
from myschedule.database import Database
from myschedule.errors import ApiError
from myschedule.main import create_app
from myschedule.password_mail import PasswordMailer, PasswordMailUnavailable
from myschedule.password_schemas import PasswordLogin
from myschedule.passwords import hash_password, validate_password, verify_password


def configured(**updates):
    return Settings(
        _env_file=None,
        password_auth_enabled=True,
        password_owner_user_id=uuid4(),
        password_owner_email="owner@example.invalid",
        session_secret="unit-only-secret-" * 4,
        smtp_username="smtp-test-login",
        smtp_password="smtp-test-not-a-real-key",
        smtp_from_email="sender@example.invalid",
        **updates,
    )


@pytest.mark.parametrize("value", ["Orbit482", "ORBIT482", "Orbit482!", "Panjang 12 Ω"])
def test_agreed_password_policy_allows_optional_symbols_and_no_lowercase_requirement(value):
    validate_password(value, "malik", "owner@example.invalid")


@pytest.mark.parametrize("value", ["shortA1", "lower123", "CapitalOnly", "x" * 129, "Null000\x00"])
def test_password_policy_rejects_missing_requirements_without_echoing_input(value):
    with pytest.raises(ApiError) as error:
        validate_password(value, "malik", "owner@example.invalid")
    assert value not in error.value.message


@pytest.mark.parametrize("value", ["Password1", "Password123!", "Malik123", "Owner123"])
def test_common_and_identity_derived_passwords_are_screened_offline(value):
    with pytest.raises(ApiError) as error:
        validate_password(value, "malik", "owner@example.invalid")
    assert error.value.code == "PASSWORD_TOO_COMMON"


async def test_argon2id_hashes_are_salted_and_missing_or_corrupt_hash_fails_closed():
    first, second = await hash_password("Orbit482"), await hash_password("Orbit482")
    assert first.startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    assert first != second and "Orbit482" not in first
    assert await verify_password(first, "Orbit482")
    assert not await verify_password(first, "Wrong482")
    assert not await verify_password(None, "Orbit482")
    assert not await verify_password("not-a-password-hash", "Orbit482")
    assert "Orbit482" not in repr(PasswordLogin(identifier="malik", password="Orbit482"))


async def test_disabled_native_service_has_no_credential_queries_and_signup_is_closed():
    app = create_app(Settings(_env_file=None))
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/v1/auth/password/context")
            assert response.json()["data"] == {
                "enabled": False,
                "registration_open": False,
                "csrf_token": None,
            }
            assert "set-cookie" not in response.headers
            assert (
                await client.post(
                    "/api/v1/auth/password/login",
                    json={"identifier": "malik", "password": "Orbit482"},
                )
            ).status_code == 503
            assert (await client.post("/api/v1/auth/password/signup", json={})).status_code == 403
            assert (await client.get("/api/v1/auth/password/security")).status_code == 401
    finally:
        await app.state.database.close()


async def test_native_auth_body_size_is_bounded_for_chunked_requests_before_validation():
    app = create_app(Settings(_env_file=None))

    async def chunks():
        for _ in range(20):
            yield b"x" * 1024

    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/api/v1/auth/password/login", content=chunks())
            assert response.status_code == 413
            assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"
            assert response.headers["cache-control"] == "no-store"
    finally:
        await app.state.database.close()


def test_password_settings_require_bound_identity_backend_secrets_and_verified_transport():
    assert not Settings(_env_file=None).password_auth_enabled
    assert configured().password_auth_enabled
    with pytest.raises(ValueError):
        Settings(_env_file=None, password_auth_enabled=True)
    with pytest.raises(ValueError):
        configured(smtp_port=25)
    with pytest.raises(ValueError):
        configured(smtp_security="plain")


@pytest.mark.parametrize("port", ["587", "2525"])
def test_smtp_port_parses_from_real_environment_strings(monkeypatch, port):
    monkeypatch.setenv("SMTP_PORT", port)
    assert Settings(_env_file=None).smtp_port == int(port)


@pytest.mark.parametrize(
    "revision,native,expected",
    [
        ("0001", False, True),
        ("0002", False, True),
        ("0001", True, False),
        ("0002", True, True),
        ("future-unreviewed", False, False),
    ],
)
async def test_rollout_readiness_accepts_only_known_compatible_schemas(revision, native, expected):
    database = Database(Settings(_env_file=None))
    database.engine = database.auth_engine = object()
    database.settings.password_auth_enabled = native
    queries = []

    class Session:
        async def scalar(self, query):
            queries.append(str(query))
            return revision if "version_num" in str(query) else True

        async def execute(self, query):
            queries.append(str(query))

    @asynccontextmanager
    async def session(**kwargs):
        yield Session()

    database.session = session
    assert await database._probe_ready() is expected
    assert any("app_private.password_" in query for query in queries) is native


def test_mailer_uses_verified_starttls_and_fragment_links_with_no_debug_logging(monkeypatch):
    smtp = Mock()
    smtp.send_message.return_value = {}
    client = Mock()
    client.__enter__ = Mock(return_value=smtp)
    client.__exit__ = Mock(return_value=False)
    connect = Mock(return_value=client)
    monkeypatch.setattr("myschedule.password_mail.smtplib.SMTP", connect)
    mailer = PasswordMailer(configured())
    mailer.send("owner@example.invalid", "invitation", "synthetic-token")
    tls = smtp.starttls.call_args.kwargs["context"]
    assert tls.verify_mode == ssl.CERT_REQUIRED and tls.check_hostname
    assert not smtp.set_debuglevel.called
    message = smtp.send_message.call_args.args[0]
    assert "/activate-password#token=synthetic-token" in message.get_content()
    assert "?token=" not in message.get_content()
    assert "24 jam" in message.get_content()
    assert "smtp-test-not-a-real-key" not in message.get_content()
    assert smtp.method_calls[0][0] == "ehlo"
    assert smtp.method_calls[1][0] == "starttls"
    with pytest.raises(PasswordMailUnavailable):
        mailer.send("someone-else@example.invalid", "reset", "synthetic-token")
    smtp.login.side_effect = smtplib.SMTPAuthenticationError(525, b"private-server-response")
    with pytest.raises(PasswordMailUnavailable):
        mailer.send("owner@example.invalid", "reset", "synthetic-token")


def test_startup_smtp_probe_reports_only_tls_auth_outcome_and_never_sends_mail(monkeypatch):
    smtp = Mock()
    client = Mock()
    client.__enter__ = Mock(return_value=smtp)
    client.__exit__ = Mock(return_value=False)
    monkeypatch.setattr("myschedule.password_mail.smtplib.SMTP", Mock(return_value=client))
    mailer = PasswordMailer(configured())
    assert mailer.probe() == (True, None)
    assert not smtp.send_message.called and not smtp.set_debuglevel.called
    smtp.login.side_effect = smtplib.SMTPAuthenticationError(525, b"private-provider-response")
    assert mailer.probe() == (False, 525)
    assert not smtp.send_message.called
