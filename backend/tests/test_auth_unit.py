import hashlib
from urllib.parse import parse_qs, urlsplit

import pytest

from myschedule.auth import GoogleClient, HandshakeStore, csrf_for_hash, safe_return_to
from myschedule.config import Settings
from myschedule.errors import ApiError


def test_handshake_is_bound_to_browser_and_single_use():
    store = HandshakeStore()
    item = store.create("/settings")
    with pytest.raises(ApiError):
        store.consume(item.state, "wrong-cookie")
    assert store.consume(item.state, item.binding) == item
    with pytest.raises(ApiError):
        store.consume(item.state, item.binding)


def test_expired_handshake_and_capacity_limit():
    store = HandshakeStore(ttl=-1)
    item = store.create("/")
    with pytest.raises(ApiError, match="OAUTH_STATE_EXPIRED"):
        store.consume(item.state, item.binding)
    store = HandshakeStore(capacity=1)
    store.create("/")
    with pytest.raises(ApiError) as exc:
        store.create("/")
    assert exc.value.status_code == 429


@pytest.mark.parametrize(
    "path", ["https://evil.example", "//evil.example", "/\\evil", "/admin", "/\n"]
)
def test_redirect_validation(path):
    with pytest.raises(ApiError):
        safe_return_to(path)


@pytest.mark.parametrize("path", ["/", "/settings", "/agenda/new", "/notes?completion=open"])
def test_internal_return_paths(path):
    assert safe_return_to(path) == path


def test_csrf_is_stable_session_bound_and_not_session_token():
    settings = Settings(_env_file=None, session_secret="s" * 48)
    a = hashlib.sha256(b"session-a").hexdigest()
    b = hashlib.sha256(b"session-b").hexdigest()
    assert csrf_for_hash(a, settings) == csrf_for_hash(a, settings)
    assert csrf_for_hash(a, settings) not in {a, csrf_for_hash(b, settings)}


async def test_google_authorization_uses_pkce_nonce_and_identity_scopes_only():
    settings = Settings(
        _env_file=None, google_client_id="test-client", google_client_secret="secret"
    )
    item = HandshakeStore().create("/")
    url = await GoogleClient(settings).authorization_url(item)
    params = parse_qs(urlsplit(url).query)
    assert params["state"] == [item.state]
    assert params["nonce"] == [item.nonce]
    assert params["code_challenge_method"] == ["S256"]
    assert item.verifier not in url
    assert "calendar" not in params["scope"][0]


@pytest.mark.parametrize("legacy_allowlist", ["[]", '["former-owner@example.invalid"]'])
def test_public_login_readiness_ignores_legacy_email_allowlist(monkeypatch, legacy_allowlist):
    monkeypatch.setenv("ALLOWED_GOOGLE_EMAILS", legacy_allowlist)
    settings = Settings(
        _env_file=None,
        app_env="test",
        google_client_id="test-client",
        google_client_secret="test-secret",
        session_secret="s" * 48,
        database_url="postgresql://app:fake@localhost/myschedule_test",
        auth_database_url="postgresql://auth:fake@localhost/myschedule_test",
    )
    assert settings.google_login_configured
    for field in (
        "google_client_id",
        "google_client_secret",
        "session_secret",
        "database_url",
        "auth_database_url",
    ):
        incomplete = Settings(**{**settings.model_dump(), field: ""}, _env_file=None)
        assert not incomplete.google_login_configured


@pytest.mark.parametrize(
    "bad_claim", [{"nonce": "wrong"}, {"email_verified": False}, {"sub": ""}, {"email": ""}]
)
async def test_google_identity_nonce_verified_email_and_subject_are_required(
    monkeypatch, bad_claim
):
    settings = Settings(
        _env_file=None, google_client_id="test-client", google_client_secret="secret"
    )
    item = HandshakeStore().create("/")

    class TokenClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

        async def fetch_token(self, *_args, **_kwargs):
            return {"id_token": "provider-test-token"}

    client = GoogleClient(settings)
    monkeypatch.setattr(client, "_client", TokenClient)
    claims = {
        "nonce": item.nonce,
        "email_verified": True,
        "sub": "test-sub",
        "email": "test@example.invalid",
    }
    claims.update(bad_claim)
    monkeypatch.setattr("myschedule.auth.verify_oauth2_token", lambda *_args: claims)
    with pytest.raises(ApiError) as exc:
        await client.exchange("test-code", item)
    assert exc.value.code == "GOOGLE_LOGIN_FAILED"
