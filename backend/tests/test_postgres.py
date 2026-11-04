import ssl

import pytest
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool

from myschedule.config import Settings
from myschedule.postgres import connection_options, postgres_engine, require_same_database

NEON = "postgresql://user:fake-password@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"


def test_neon_libpq_url_is_adapted_with_verified_tls():
    url, arguments = connection_options(NEON)
    assert url.drivername == "postgresql+asyncpg"
    assert url.password == "fake-password"
    assert "sslmode" not in url.query and "channel_binding" not in url.query
    assert isinstance(arguments["ssl"], ssl.SSLContext)
    assert arguments["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert arguments["ssl"].check_hostname
    assert arguments["statement_cache_size"] == 0


@pytest.mark.parametrize("value", [NEON, "postgresql://app:fake@localhost/myschedule_test"])
def test_runtime_reuses_a_small_bounded_client_pool(value):
    engine = postgres_engine(value)
    assert isinstance(engine.pool, AsyncAdaptedQueuePool)
    assert engine.pool.size() == 2
    assert engine.pool._max_overflow == 1
    assert engine.pool.timeout() == 5
    assert engine.pool._recycle == 300


def test_runtime_pool_limits_are_configurable_without_changing_roles_or_tls():
    engine = postgres_engine(NEON, pool_size=1, max_overflow=0)
    assert engine.pool.size() == 1
    assert engine.pool._max_overflow == 0


def test_migrations_do_not_keep_a_client_pool():
    engine = postgres_engine(NEON.replace("-pooler.", "."), migration=True)
    assert isinstance(engine.pool, NullPool)


@pytest.mark.parametrize(
    "options",
    [{"database_pool_size": 0}, {"database_pool_size": 11}, {"database_pool_max_overflow": -1}],
)
def test_runtime_pool_configuration_is_bounded(options):
    with pytest.raises(ValueError):
        Settings(_env_file=None, **options)


def test_migrations_refuse_pooler():
    with pytest.raises(ValueError, match="UNPOOLED"):
        connection_options(NEON, migration=True)


def test_local_socket_url_is_preserved():
    url, arguments = connection_options(
        "postgresql+asyncpg://owner@/myschedule_dev?host=/tmp", migration=True
    )
    assert url.query["host"] == "/tmp"
    assert "ssl" not in arguments


@pytest.mark.parametrize("driver", ["postgres", "postgresql", "postgresql+asyncpg"])
def test_postgres_schemes_are_supported(driver):
    url, _ = connection_options(f"{driver}://user:fake@localhost/mydb")
    assert url.drivername == "postgresql+asyncpg"


def test_neon_tls_cannot_be_disabled():
    with pytest.raises(ValueError, match="TLS"):
        connection_options(NEON.replace("sslmode=require", "sslmode=disable"))


def test_explicit_no_env_loading_is_preserved_for_tests():
    settings = Settings(_env_file=None, app_env="test")
    assert settings.database_url is None


def test_migration_target_accepts_pooler_direct_pair():
    require_same_database(NEON, NEON.replace("-pooler.", "."))


def test_local_socket_and_tcp_are_the_same_target():
    require_same_database(
        "postgresql://app@127.0.0.1/myschedule_test",
        "postgresql+asyncpg://owner@/myschedule_test?host=/tmp",
    )


def test_migration_refuses_local_neon_mismatch():
    with pytest.raises(ValueError, match="different databases"):
        require_same_database(NEON, "postgresql://owner@localhost/myschedule_dev")
