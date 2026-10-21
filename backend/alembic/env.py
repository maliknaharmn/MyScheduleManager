import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from myschedule.config import Settings
from myschedule.models import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)


def migration_url() -> str:
    settings = Settings()
    use_test = config.get_main_option("use_test_database") == "true"
    value = settings.test_migration_database_url if use_test else settings.migration_database_url
    if value is None:
        raise RuntimeError("Set the migration owner connection before running Alembic")
    return value.get_secret_value()


def include_name(name, type_, parent_names):
    if type_ == "schema":
        return name in {None, "app_private"}
    return True


def run_sync(connection):
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        include_schemas=True,
        include_name=include_name,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async():
    engine = create_async_engine(migration_url(), poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(run_sync)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(url=migration_url(), target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(run_async())
