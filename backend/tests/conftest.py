from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from pydantic import SecretStr
from sqlalchemy import delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import command
from myschedule.auth import GoogleIdentity, create_login
from myschedule.config import Settings
from myschedule.database import Database
from myschedule.models import Base, User


@pytest.fixture(scope="session")
def db_settings():
    local = Settings()
    urls = [
        local.test_database_url,
        local.test_auth_database_url,
        local.test_migration_database_url,
    ]
    if not all(urls):
        pytest.skip("Dedicated PostgreSQL test URLs not configured; no fallback to development DB")
    for url in urls:
        if not make_url(url.get_secret_value()).database.endswith("_test"):
            raise RuntimeError(
                "Refusing database tests against a database without the _test suffix"
            )
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("use_test_database", "true")
    command.upgrade(config, "head")
    return Settings(
        _env_file=None,
        app_env="test",
        database_url=urls[0],
        auth_database_url=urls[1],
        migration_database_url=urls[2],
        session_secret=SecretStr("test-only-secret-" * 4),
        allowed_google_emails=["test@example.invalid"],
    )


@dataclass
class SeededAccount:
    user_id: UUID
    token: str
    database: Database


@pytest.fixture
async def account(db_settings):
    database = Database(db_settings)
    subject = f"test-{uuid4()}"
    token = await create_login(
        database, db_settings, GoogleIdentity(subject, "test@example.invalid", "Test"), None
    )
    async with database.session(auth=True) as session:
        user_id = await session.scalar(select(User.id).where(User.google_subject == subject))
    yield SeededAccount(user_id, token, database)
    await database.close()
    engine = create_async_engine(db_settings.migration_database_url.get_secret_value())
    async with engine.begin() as connection:
        # Clean only this fixture's randomly identified rows, never TRUNCATE a shared database.
        for table in reversed(Base.metadata.sorted_tables):
            if "user_id" in table.c:
                await connection.execute(delete(table).where(table.c.user_id == user_id))
        await connection.execute(delete(User).where(User.id == user_id))
    await engine.dispose()
