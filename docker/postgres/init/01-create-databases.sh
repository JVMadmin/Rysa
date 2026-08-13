#!/bin/bash
# Grupo RYSA ERP - Crea las bases rysa_dev y rysa_prod en el volumen persistente.
# Se ejecuta UNA VEZ en la primera inicialización del volumen de PostgreSQL.
# Las TABLAS NO se crean aquí: se crean mediante Alembic (migraciones).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE rysa_dev;
    CREATE DATABASE rysa_prod;
EOSQL
