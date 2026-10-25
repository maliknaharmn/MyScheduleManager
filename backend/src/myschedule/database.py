import asyncio
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from myschedule.config import Settings
from myschedule.postgres import postgres_engine


class Database:
    def __init__(self, settings: Settings):
        self.engine = (
            postgres_engine(settings.database_url.get_secret_value())
            if settings.database_url
            else None
        )
        self.auth_engine = (
            postgres_engine(settings.auth_database_url.get_secret_value())
            if settings.auth_database_url
            else None
        )

    async def close(self) -> None:
        if self.engine:
            await self.engine.dispose()
        if self.auth_engine:
            await self.auth_engine.dispose()

    async def ready(self) -> bool:
        if self.engine is None or self.auth_engine is None:
            return False

        async def probe(*, auth: bool) -> bool:
            try:
                async with asyncio.timeout(10), self.session(auth=auth) as session:
                    safe = await session.scalar(
                        text(
                            "SELECT NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole) "
                            "AND NOT EXISTS (SELECT 1 FROM pg_auth_members m "
                            "JOIN pg_roles parent ON parent.oid=m.roleid "
                            "WHERE m.member=role.oid AND parent.rolname='neon_superuser') "
                            "FROM pg_roles role WHERE rolname=current_user"
                        )
                    )
                    if not safe:
                        return False
                    if auth:
                        await session.execute(text("SELECT id FROM users LIMIT 0"))
                        await session.execute(text("SELECT id FROM sessions LIMIT 0"))
                    else:
                        revision = await session.scalar(
                            text("SELECT version_num FROM alembic_version")
                        )
                        if revision != "0001":
                            return False
                        await session.execute(text("SELECT id FROM schedules LIMIT 0"))
                    return True
            except (SQLAlchemyError, RuntimeError, TimeoutError, OSError):
                return False

        return all(await asyncio.gather(probe(auth=False), probe(auth=True)))

    @asynccontextmanager
    async def session(self, user_id: UUID | None = None, *, auth: bool = False):
        engine = self.auth_engine if auth else self.engine
        if engine is None:
            raise RuntimeError("Database connection is not configured")
        factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with factory() as session, session.begin():
            if user_id is not None:
                # Reset on commit/rollback, including pooled connections.
                await session.execute(
                    text("SELECT set_config('app.user_id', :user_id, true)"),
                    {"user_id": str(user_id)},
                )
            yield session
