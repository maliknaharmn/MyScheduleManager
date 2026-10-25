import asyncio
from logging.config import fileConfig

from alembic import context
from myschedule.config import Settings
from myschedule.models import Base
from myschedule.postgres import connection_options, postgres_engine, require_same_database

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)


def migration_url() -> str:
    settings = Settings()
    use_test = config.get_main_option("use_test_database") == "true"
    value = settings.test_migration_database_url if use_test else settings.migration_database_url
    if value is None:
        raise RuntimeError("Set the migration owner connection before running Alembic")
    runtime = settings.test_database_url if use_test else settings.database_url
    if runtime:
        require_same_database(runtime.get_secret_value(), value.get_secret_value())
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
    engine = postgres_engine(migration_url(), migration=True)
    async with engine.connect() as connection:
        await connection.run_sync(run_sync)
    await engine.dispose()


if context.is_offline_mode():
    url, _ = connection_options(migration_url(), migration=True)
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(run_async())
