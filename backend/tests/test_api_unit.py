import httpx
import pytest

from myschedule.config import Settings
from myschedule.main import create_app


@pytest.fixture
async def client():
    app = create_app(Settings(_env_file=None, app_env="test"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client
    await app.state.database.close()


async def test_health_and_status_without_configuration_are_honest(client):
    assert (await client.get("/health/live")).status_code == 200
    assert (await client.get("/health/ready")).status_code == 503
    response = await client.get("/api/v1/status")
    assert response.json()["data"]["database"] == "not_ready"
    assert response.json()["data"]["google_login_configured"] is False
    assert response.json()["data"]["calendar_integration"] == "not_implemented"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"] == response.json()["meta"]["request_id"]


async def test_no_development_login_bypass(client):
    assert (await client.get("/api/v1/me")).status_code == 401
    assert (await client.post("/api/v1/auth/dev-login")).status_code == 404
    result = await client.get("/api/v1/auth/google/start")
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "GOOGLE_NOT_CONFIGURED"


async def test_error_envelopes_and_input_redaction(client):
    response = await client.get("/api/v1/auth/google/start", params={"return_to": "x" * 501})
    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["path"] == "return_to"
    assert "x" * 501 not in response.text
    missing = await client.get("/does-not-exist")
    assert missing.json()["error"]["code"] == "NOT_FOUND"


async def test_openapi_describes_public_models_and_actual_error_envelope(client):
    response = await client.get("/openapi.json")
    schema = response.json()
    profile_patch = schema["paths"]["/api/v1/me/profile"]["patch"]
    error_schema = profile_patch["responses"]["422"]["content"]["application/json"]["schema"]
    assert error_schema["$ref"].endswith("/ErrorResponse")
    assert "MeData" in schema["components"]["schemas"]
    for private_field in ("token_hash", "refresh_token_ciphertext", "google_client_secret"):
        assert private_field not in response.text
