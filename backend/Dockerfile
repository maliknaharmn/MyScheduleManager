FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_ENV=production

WORKDIR /app

COPY pyproject.toml requirements-dev.lock ./
RUN pip install --no-cache-dir -r requirements-dev.lock

COPY src ./src
COPY alembic.ini ./
COPY alembic ./alembic
RUN pip install --no-cache-dir --no-deps . \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home app

USER 10001:10001
CMD ["python", "-m", "myschedule.serve"]
