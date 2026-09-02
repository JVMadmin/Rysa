# Grupo RYSA ERP - Backend (FastAPI + PostgreSQL)
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# OCR de facturas: Tesseract con idioma español para leer fotos/PDF escaneados.
# libgomp1 es requerido por PyMuPDF (import fitz) para abrir/rastrear PDFs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-spa libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Dependencias del proyecto (sin cache para imagen reducida)
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# Código fuente del backend (excluye .env, venv, uploads, etc. via .dockerignore)
COPY . .

# Scripts: diagnóstico + bootstrap del primer admin
RUN chmod +x /app/scripts/check_installation.py /app/scripts/bootstrap_admin.py

EXPOSE 8000

# Entry point real:
#   1) Alembic aplica el esquema (incluye las 12 migraciones y las 13 tablas legacy_*)
#   2) bootstrap_admin crea/actualiza el admin con ADMIN_EMAIL/ADMIN_PASSWORD
#   3) uvicorn sirve la API
CMD ["sh", "-c", "alembic upgrade head && python -m scripts.bootstrap_admin && uvicorn server:app --host 0.0.0.0 --port 8000"]
