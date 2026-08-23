// Cliente API del Consultor de Precios (solo lectura).
// La API base es relativa al mismo origen (via Nginx) o se sobreescribe con
// REACT_APP_PRICE_API_URL (p. ej. http://10.0.0.5:8040) en desarrollo.

import * as mock from "./mock";

const API = (process.env.REACT_APP_PRICE_API_URL || "").replace(/\/+$/, "");
const API_BASE = API + "/api/public-price";

// Modo MOCK (solo prueba local, sin base de datos): REACT_APP_MOCK=1
// sirve datos ficticios con la MISMA forma del DTO real para validar la UI.
export const MOCK = process.env.REACT_APP_MOCK === "1";

// Base para resolver imagenes de producto guardadas como ruta relativa en el ERP.
export const IMG_BASE = (process.env.REACT_APP_IMG_BASE || "").replace(/\/+$/, "");

export const SUCURSAL = (process.env.REACT_APP_SUCURSAL || "").trim();

export function resolveImg(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return IMG_BASE + (url.startsWith("/") ? url : "/" + url);
}

const TIMEOUT = 6500;

// Token opcional de la API (PRICE_API_TOKEN del backend). Si se configura,
// debe inyectarse en BUILD time como REACT_APP_PRICE_TOKEN (kiosco).
const TOKEN = (process.env.REACT_APP_PRICE_TOKEN || "").trim();
const AUTH_HEADERS = TOKEN ? { "X-Price-Token": TOKEN } : {};

async function requestJson(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT);
  try {
    const res = await fetch(API_BASE + path, { signal: ctrl.signal, headers: AUTH_HEADERS });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function withSucursal(params) {
  if (SUCURSAL) params.set("sucursal", SUCURSAL);
  return params;
}

export function searchProducts(q, opts = {}) {
  if (MOCK) return mock.search(q || "");
  const p = withSucursal(new URLSearchParams({ q: q || "", limit: "25" }));
  return requestJson(`/products/search?${p}`, opts);
}

export function productByCodigo(codigo, opts = {}) {
  if (MOCK) return mock.byCodigo(codigo);
  const p = withSucursal(new URLSearchParams());
  return requestJson(`/products/codigo/${encodeURIComponent(codigo)}?${p}`, opts);
}

export function productByBarcode(barcode, opts = {}) {
  if (MOCK) return mock.byBarcode(barcode);
  const p = withSucursal(new URLSearchParams());
  return requestJson(`/products/barcode/${encodeURIComponent(barcode)}?${p}`, opts);
}

export async function health(opts = {}) {
  if (MOCK) return !!(await mock.health()).ok;
  try {
    const r = await requestJson("/health", { timeout: 3000, ...opts });
    return !!(r && r.ok);
  } catch (e) {
    return false;
  }
}

export function formatMoney(n) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n || 0));
}