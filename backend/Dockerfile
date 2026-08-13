# Grupo RYSA ERP - Backend (FastAPI + PostgreSQL)
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencias del proyecto (sin cache para imagen reducida)
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# Código fuente del backend (excluye .env, venv, uploads, etc. via .dockerignore)
COPY . .

EXPOSE 8000

# Entry point real: Alembic aplica el esquema y uvicorn sirve la API.
CMD ["sh", "-c", "alembic upgrade head && uvicorn server:app --host 0.0.0.0 --port 8000"]
