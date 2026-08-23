# Grupo RYSA - Consultor de Precios (SPA independiente, kiosco)
# Build multi-etapa: Node compila, Nginx sirve el SPA y resuelve React Router.
# La API se sirve en el mismo origen (/api -> proxy -> rysa_price_checker).

# --- Etapa 1: build ---
FROM node:20-alpine AS build
WORKDIR /app

# Args de entorno de build. Por defecto la API es relativa (mismo origen).
ARG REACT_APP_PRICE_API_URL=""
ARG REACT_APP_IMG_BASE=""
ARG REACT_APP_SUCURSAL=""
# Token opcional de la API (debe coincidir con PRICE_API_TOKEN del backend).
ARG REACT_APP_PRICE_TOKEN=""
ENV REACT_APP_PRICE_API_URL=$REACT_APP_PRICE_API_URL
ENV REACT_APP_IMG_BASE=$REACT_APP_IMG_BASE
ENV REACT_APP_SUCURSAL=$REACT_APP_SUCURSAL
ENV REACT_APP_PRICE_TOKEN=$REACT_APP_PRICE_TOKEN

# Limite de heap de Node (evita OOM en maquinas con poca memoria).
ARG NODE_OPTIONS=""
ENV NODE_OPTIONS=$NODE_OPTIONS

COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

COPY . .
RUN npm run build

# --- Etapa 2: servidor estatico ---
FROM nginx:1.27-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]