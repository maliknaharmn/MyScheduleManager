import asyncio
from unittest.mock import AsyncMock

import httpx

from myschedule.config import Settings
from myschedule.database import Database
from myschedule.main import create_app


async def test_public_status_deduplicates_concurrent_probes_and_expires(monkeypatch):
    now = [100.0]
    monkeypatch.setattr("myschedule.database.monotonic", lambda: now[0])
    database = Database(Settings(_env_file=None))
    entered, release = asyncio.Event(), asyncio.Event()

    async def probe():
        entered.set()
        await release.wait()
        return True

    check = AsyncMock(side_effect=probe)
    monkeypatch.setattr(database, "_probe_ready", check)
    pending = [asyncio.create_task(database.status_ready()) for _ in range(10)]
    await entered.wait()
    assert check.await_count == 1
    release.set()
    assert all(await asyncio.gather(*pending))
    assert await database.status_ready()
    assert check.await_count == 1
    now[0] = 105.0
    assert await database.status_ready()
    assert check.await_count == 2
    await database.close()


async def test_live_readiness_never_uses_a_cached_success_and_updates_public_status(monkeypatch):
    app = create_app(Settings(_env_file=None))
    check = AsyncMock(side_effect=[True, False, True])
    monkeypatch.setattr(app.state.database, "_probe_ready", check)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/v1/status")
            assert response.json()["data"]["database"] == "ready"
            assert response.headers["cache-control"] == "no-store"
            timing = response.headers["server-timing"]
            assert timing.startswith("app;dur=")
            assert float(timing.removeprefix("app;dur=")) >= 0
            response = await client.get("/health/ready")
            assert response.status_code == 503
            assert response.json()["data"]["status"] == "not_ready"
            assert (await client.get("/api/v1/status")).json()["data"]["database"] == "not_ready"
            assert check.await_count == 2
            assert (await client.get("/api/v1/me")).status_code == 401
            assert (await client.get("/health/ready")).status_code == 200
            assert (await client.get("/api/v1/status")).json()["data"]["database"] == "ready"
            assert check.await_count == 3
    finally:
        await app.state.database.close()
