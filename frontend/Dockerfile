# Grupo RYSA ERP - Frontend (React) build + Nginx estático
# Build multi-etapa: Node compila, Nginx sirve el SPA y resuelve React Router.

# --- Etapa 1: build ---
FROM node:20-alpine AS build
WORKDIR /app

# Argumentos de build; por defecto el API es relativa (mismo origen, vía Nginx -> /api)
ARG REACT_APP_BACKEND_URL=""
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

# Límite de heap de Node (evita OOM en máquinas con poca memoria durante el build)
ARG NODE_OPTIONS=""
ENV NODE_OPTIONS=$NODE_OPTIONS

COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

COPY . .
# Comando de build real del package.json: craco build -> genera carpeta build/
RUN npm run build

# --- Etapa 2: servidor estático ---
FROM nginx:1.27-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
