from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from myschedule.config import Settings


class Database:
    def __init__(self, settings: Settings):
        self.engine = (
            create_async_engine(settings.database_url.get_secret_value(), pool_pre_ping=True)
            if settings.database_url
            else None
        )
        self.auth_engine = (
            create_async_engine(settings.auth_database_url.get_secret_value(), pool_pre_ping=True)
            if settings.auth_database_url
            else None
        )

    async def close(self) -> None:
        if self.engine:
            await self.engine.dispose()
        if self.auth_engine:
            await self.auth_engine.dispose()

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
