"""SQLAlchemy/asyncpg connection policy shared by runtime, provisioning and Alembic."""

import ssl

from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool


def database_target(value: str) -> tuple[str, int, str | None]:
    url = make_url(value)
    host = url.host or str(url.query.get("host", "localhost"))
    if host in {"localhost", "127.0.0.1", "::1"} or host.startswith("/"):
        host = "local"
    elif host.endswith(".neon.tech"):
        host = host.replace("-pooler.", ".")
    return host, int(url.port or url.query.get("port", 5432)), url.database


def require_same_database(runtime: str, migration: str) -> None:
    if database_target(runtime) != database_target(migration):
        raise ValueError("Migration and runtime target different databases; no migration was run")


def connection_options(value: str, *, migration: bool = False) -> tuple[URL, dict]:
    url = make_url(value)
    if url.drivername not in {"postgres", "postgresql", "postgresql+asyncpg"}:
        raise ValueError("Use a PostgreSQL URL with the asyncpg driver")
    query = dict(url.query)
    neon = bool(url.host and url.host.endswith(".neon.tech"))
    pooled = bool(neon and "-pooler." in url.host)
    if migration and pooled:
        raise ValueError("Migrations require DATABASE_URL_UNPOOLED, not a pooler endpoint")
    arguments: dict = {"timeout": 15, "command_timeout": 20}
    sslmode = query.pop("sslmode", None)
    ssl_option = query.pop("ssl", None)
    binding = query.pop("channel_binding", None)
    if neon:
        if sslmode == "disable" or ssl_option in {"disable", "false", "0"}:
            raise ValueError("TLS cannot be disabled for Neon")
        if binding not in {None, "require", "prefer", "disable"}:
            raise ValueError("Unsupported libpq channel_binding setting")
        # asyncpg has no libpq channel_binding keyword. Authenticate the server with
        # verified TLS (certificate AND hostname), rather than forwarding libpq keywords.
        # Do not claim SCRAM-PLUS enforcement; see the deployment guide.
        arguments["ssl"] = ssl.create_default_context()
        if pooled:
            arguments.update(prepared_statement_cache_size=0, statement_cache_size=0)
    else:
        if binding is not None:
            raise ValueError("libpq channel_binding is unsupported by asyncpg")
        if sslmode is not None and ssl_option is not None and sslmode != ssl_option:
            raise ValueError("Conflicting SSL options")
        if sslmode is not None or ssl_option is not None:
            arguments["ssl"] = sslmode or ssl_option
    return url.set(drivername="postgresql+asyncpg", query=query), arguments


def postgres_engine(value: str, *, migration: bool = False) -> AsyncEngine:
    url, arguments = connection_options(value, migration=migration)
    options: dict = {"pool_pre_ping": True, "connect_args": arguments, "hide_parameters": True}
    if migration or (url.host and "-pooler." in url.host and url.host.endswith(".neon.tech")):
        # PgBouncer owns the pool. Do not multiply pools across Cloud replicas.
        options["poolclass"] = NullPool
    return create_async_engine(url, **options)
