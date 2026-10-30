"""Keep deployment routing aligned with cookie-based, owner-scoped API access."""

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_netlify_builds_only_the_frontend_package():
    config = tomllib.loads((ROOT / "netlify.toml").read_text())
    assert config["build"]["base"] == "frontend"
    assert config["build"]["publish"] == "dist"
    assert config["build"]["command"] == "npm run build"
    assert config["build"]["environment"]["NODE_VERSION"] == "24"
    assert (ROOT / "frontend/package-lock.json").is_file()


def test_netlify_proxies_api_and_health_before_the_spa_fallback():
    config = tomllib.loads((ROOT / "netlify.toml").read_text())
    api, health, fallback = config["redirects"]
    for rule, path in ((api, "api"), (health, "health")):
        assert rule["from"] == f"/{path}/*"
        assert rule["to"] == f"https://myschedulemanager.fastapicloud.dev/{path}/:splat"
        assert rule["status"] == 200
        assert rule["force"] is True
        # Never replace the browser Origin or Cookie headers with static values.
        assert "headers" not in rule
    assert fallback == {"from": "/*", "to": "/index.html", "status": 200}
    assert not (ROOT / "frontend/public/_redirects").exists()


def test_netlify_caches_only_content_hashed_build_assets_as_immutable():
    config = tomllib.loads((ROOT / "netlify.toml").read_text())
    for rule in config["headers"]:
        if "Cache-Control" in rule["values"]:
            assert rule["for"] == "/assets/*"
            assert "immutable" in rule["values"]["Cache-Control"]


def test_netlify_local_account_linkage_is_gitignored():
    assert ".netlify/" in (ROOT / ".gitignore").read_text().splitlines()
