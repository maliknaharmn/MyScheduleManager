"""Railway portability must preserve auth, private TLS and controlled cutover behavior."""

import json
import ssl
from pathlib import Path
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import pytest

from myschedule.config import Settings
from myschedule.database import Database
from myschedule.main import create_app
from myschedule.password_mail import PasswordMailer, PasswordMailUnavailable
from myschedule.postgres import connection_options
from myschedule.serve import main as serve


def mail_settings(**updates):
    values = {
        "password_auth_enabled": True,
        "password_owner_user_id": uuid4(),
        "password_owner_email": "owner@example.invalid",
        "session_secret": "unit-only-session-secret-" * 3,
        "smtp_from_email": "sender@example.invalid",
        "mail_transport": "brevo_api",
        "brevo_api_key": "synthetic-api-key-not-a-real-credential",
        "app_origin": "https://app.example.invalid",
    }
    return Settings(_env_file=None, **(values | updates))


def test_brevo_https_requires_its_own_secret_and_does_not_require_smtp_credentials():
    settings = mail_settings()
    assert not settings.smtp_username.get_secret_value()
    assert not settings.smtp_password.get_secret_value()
    with pytest.raises(ValueError, match="backend API key"):
        mail_settings(brevo_api_key="")
    with pytest.raises(ValueError, match="SMTP startup probe"):
        mail_settings(smtp_probe_on_startup=True)
    with pytest.raises(ValueError) as error:
        mail_settings(password_owner_user_id=None)
    assert "synthetic-api-key" not in str(error.value)


def mock_brevo(monkeypatch, handler):
    actual_client = httpx.Client
    calls = []

    def factory(**kwargs):
        assert kwargs == {
            "timeout": 10,
            "verify": True,
            "follow_redirects": False,
            "trust_env": False,
        }

        def respond(request):
            calls.append(request)
            return handler(request)

        return actual_client(transport=httpx.MockTransport(respond))

    monkeypatch.setattr("myschedule.password_mail.httpx.Client", factory)
    monkeypatch.setattr("myschedule.password_mail.smtplib.SMTP", Mock(side_effect=AssertionError))
    return calls


def test_brevo_https_preserves_owner_only_fragment_link_and_does_not_log_payload(
    monkeypatch, caplog
):
    calls = mock_brevo(
        monkeypatch, lambda request: httpx.Response(201, json={"messageId": "test-only-message-id"})
    )
    mailer = PasswordMailer(mail_settings())
    mailer.send("owner@example.invalid", "invitation", "synthetic-link-token")
    assert len(calls) == 1
    request = calls[0]
    assert str(request.url) == "https://api.brevo.com/v3/smtp/email"
    assert request.headers["api-key"] == "synthetic-api-key-not-a-real-credential"
    body = json.loads(request.content)
    assert body["to"] == [{"email": "owner@example.invalid"}]
    assert body["sender"]["email"] == "sender@example.invalid"
    assert "/activate-password#token=synthetic-link-token" in body["textContent"]
    assert "24 jam" in body["textContent"] and "?token=" not in body["textContent"]
    assert "htmlContent" not in body
    assert body["headers"] == {"X-Mailin-Track-Clicks": "0", "X-Mailin-Track-Opens": "0"}
    for value in ("synthetic-link-token", "synthetic-api-key", "owner@example.invalid"):
        assert value not in caplog.text
    for recipient, purpose in [
        ("other@example.invalid", "reset"),
        ("owner@example.invalid", "other"),
    ]:
        with pytest.raises(PasswordMailUnavailable):
            mailer.send(recipient, purpose, "synthetic-link-token")
    assert len(calls) == 1


@pytest.mark.parametrize("status", [200, 302, 401, 429, 500])
def test_brevo_failures_never_follow_redirects_retry_fallback_or_leak_errors(
    monkeypatch, caplog, status
):
    calls = mock_brevo(
        monkeypatch,
        lambda request: httpx.Response(
            status,
            headers={"Location": "https://untrusted.example.invalid"},
            json={"message": "PRIVATE_PROVIDER_RESPONSE"},
        ),
    )
    with pytest.raises(PasswordMailUnavailable):
        PasswordMailer(mail_settings()).send("owner@example.invalid", "reset", "synthetic-token")
    assert len(calls) == 1
    assert "PRIVATE_PROVIDER_RESPONSE" not in caplog.text and "synthetic-token" not in caplog.text


@pytest.mark.parametrize("body", [{}, {"messageId": ""}, {"messageId": None}, []])
def test_brevo_success_without_an_acceptance_id_is_not_reported_as_success(monkeypatch, body):
    calls = mock_brevo(monkeypatch, lambda request: httpx.Response(201, json=body))
    with pytest.raises(PasswordMailUnavailable):
        PasswordMailer(mail_settings()).send("owner@example.invalid", "reset", "synthetic-token")
    assert len(calls) == 1


def test_brevo_timeout_does_not_retry_or_expose_exception_details(monkeypatch, caplog):
    def timeout(request):
        raise httpx.ReadTimeout("PRIVATE_PROVIDER_RESPONSE", request=request)

    calls = mock_brevo(monkeypatch, timeout)
    with pytest.raises(PasswordMailUnavailable) as error:
        PasswordMailer(mail_settings()).send("owner@example.invalid", "reset", "synthetic-token")
    assert len(calls) == 1 and error.value.__cause__ is None
    assert "PRIVATE_PROVIDER_RESPONSE" not in caplog.text


def test_private_postgres_ca_keeps_certificate_and_hostname_verification():
    # A public test CA needs no private key and works in Linux/macOS CI trust stores.
    cert = ssl.create_default_context().get_ca_certs(binary_form=True)[0]
    pem = ssl.DER_cert_to_PEM_cert(cert)
    url, arguments = connection_options(
        "postgresql://app:unit-only@postgres.railway.internal/db?sslmode=verify-full",
        ssl_ca_pem=pem,
    )
    assert "sslmode" not in url.query
    assert arguments["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert arguments["ssl"].check_hostname
    assert arguments["ssl"].cert_store_stats()["x509_ca"] == 1
    for mode in ("disable", "require", "verify-ca"):
        with pytest.raises(ValueError, match="verified TLS"):
            connection_options(f"postgresql://app@db/db?sslmode={mode}", ssl_ca_pem=pem)
    with pytest.raises(ValueError, match="Neon's public certificate"):
        connection_options("postgresql://app@ep-example.neon.tech/db", ssl_ca_pem=pem)


def test_both_runtime_roles_receive_the_same_private_ca(monkeypatch):
    calls = []

    def engine(value, **options):
        calls.append(options)
        return object()

    monkeypatch.setattr("myschedule.database.postgres_engine", engine)
    Database(
        Settings(
            _env_file=None,
            database_url="postgresql://app@db/db",
            auth_database_url="postgresql://auth@db/db",
            database_ssl_ca_pem="test-ca-pem",
        )
    )
    assert len(calls) == 2 and all(call["ssl_ca_pem"] == "test-ca-pem" for call in calls)


async def test_maintenance_blocks_reads_logins_and_mutations_before_side_effects():
    app = create_app(Settings(_env_file=None, maintenance_mode=True))
    app.state.database.ready = AsyncMock(return_value=True)
    app.state.password_auth.mailer.send = Mock(side_effect=AssertionError)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://app.example.invalid"
        ) as client:
            for method, path in [
                ("GET", "/api/v1/me"),
                ("GET", "/api/v1/status"),
                ("GET", "/api/v1/auth/google/start"),
                ("GET", "/api/v1/auth/google/callback?code=private-test-code"),
                ("POST", "/api/v1/auth/password/forgot"),
                ("POST", "/api/v1/schedules"),
                ("PATCH", "/api/v1/me/profile"),
                ("DELETE", "/api/v1/notes/test-id"),
            ]:
                response = await client.request(method, path)
                assert response.status_code == 503
                assert response.json()["error"]["code"] == "SERVICE_MAINTENANCE"
                assert response.headers["cache-control"] == "no-store"
                assert response.headers["retry-after"] == "60"
                assert "set-cookie" not in response.headers
                assert "private-test-code" not in response.text
            assert app.state.database.ready.await_count == 0
            assert (await client.get("/health/live")).status_code == 200
            assert (await client.get("/health/ready")).status_code == 200
            assert app.state.database.ready.await_count == 1
    finally:
        await app.state.database.close()


def test_container_entrypoint_uses_platform_port_one_worker_and_no_access_logs(monkeypatch):
    run = Mock()
    monkeypatch.setenv("PORT", "12345")
    monkeypatch.setenv("WEB_CONCURRENCY", "8")
    monkeypatch.setattr("myschedule.serve.uvicorn.run", run)
    serve()
    assert run.call_args.args == ("myschedule.main:app",)
    assert run.call_args.kwargs == {
        "host": "0.0.0.0",
        "port": 12345,
        "workers": 1,
        "access_log": False,
    }


@pytest.mark.parametrize("port", ["invalid", "0", "-1", "65536"])
def test_container_entrypoint_rejects_invalid_ports_without_starting(monkeypatch, port):
    run = Mock()
    monkeypatch.setenv("PORT", port)
    monkeypatch.setattr("myschedule.serve.uvicorn.run", run)
    with pytest.raises(SystemExit, match="PORT must be an integer"):
        serve()
    run.assert_not_called()


def test_container_build_is_narrow_nonroot_and_excludes_private_configuration():
    backend = Path(__file__).resolve().parents[1]
    dockerfile = (backend / "Dockerfile").read_text()
    ignore = (backend / ".dockerignore").read_text().splitlines()
    assert "USER 10001:10001" in dockerfile
    assert 'CMD ["python", "-m", "myschedule.serve"]' in dockerfile
    assert "COPY . " not in dockerfile
    assert ignore[0] == "**" and ".env.*" in ignore and ".local/" in ignore
    assert "src/myschedule/local_preview.py" in ignore
