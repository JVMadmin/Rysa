/**
 * Utilidades compartidas de mapas/GPS entre Mapas, Rutas (Mi Ruta),
 * Supervisión y detalle de clientes. ÚNICA fuente de verdad para:
 * - validación de coordenadas (nada inválido llega jamás a Leaflet)
 * - normalización de vendedores con/sin ubicación
 * - iconos, tema de tiles y centro por defecto.
 * Sin datos mock: todo sale de /supervision/map · /seller/map · /locations/{id}.
 */
import L from "leaflet";

export const MAP_THEME = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION = "&copy; OpenStreetMap";
// Centro por defecto: Palenque, Chiapas.
export const PALENQUE = [17.5095, -91.9827];

export const ESTADO_DOT = {
  en_ruta: "#10b981",
  activo: "#3b82f6",
  sin_actividad: "#ef4444",
  sin_datos: "#94a3b8",
};
export const ESTADO_LABEL = {
  en_ruta: "En ruta",
  activo: "Activo",
  sin_actividad: "Sin actividad",
  sin_datos: "Sin datos",
};

/** ¿Par lat/lng utilizable por Leaflet? Ignora basura, strings vacíos y (0,0). */
export function coordValida(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la === 0 && ln === 0) return false; // GPS sin fix típico
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return false;
  return true;
}

/** Convierte {latitud,longitud} a [lat,lng]; null si es inválida. */
export function puntoDe(u) {
  if (!u) return null;
  const la = Number(u.latitud), ln = Number(u.longitud);
  return coordValida(la, ln) ? [la, ln] : null;
}

/**
 * Separa vendedores según su última ubicación GPS.
 * Devuelve SOLO usuarios activos con ubicación válida en `enMapa`;
 * los activos sin GPS van a `sinGps`; cualquier otro registro se ignora.
 */
export function separarVendedores(vendedores = []) {
  const enMapa = [];
  const sinGps = [];
  for (const v of Array.isArray(vendedores) ? vendedores : []) {
    if (v?.activo === false) continue; // inactivo: nunca se muestra
    const pos = puntoDe(v.ultima_ubicacion);
    if (pos) enMapa.push({ ...v, pos });
    else sinGps.push(v);
  }
  enMapa.sort((a, b) => String(b.ultima_ubicacion?.fecha || "")
    .localeCompare(String(a.ultima_ubicacion?.fecha || "")));
  return { enMapa, sinGps };
}

/** Bounds seguros para fitBounds; fallback al centro por defecto. */
export function boundsDe(pts) {
  const valides = (pts || []).filter((p) => coordValida(p[0], p[1]));
  if (!valides.length) return [PALENQUE];
  const lats = valides.map((p) => p[0]);
  const lngs = valides.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

/** Punto de marcador simple (clientes, GPS). */
export const dotIcon = (bg) =>
  L.divIcon({
    className: "rysa-map-dot",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });

/** Marcador de vendedor; resaltado = anillo pulsante cuando está seleccionado. */
export const iconVendedor = (estado, resaltado = false) => {
  const bg = ESTADO_DOT[estado] || ESTADO_DOT.sin_datos;
  const size = resaltado ? 30 : 16;
  const dot = resaltado ? 18 : 14;
  const ring = resaltado
    ? `<span style="position:absolute;inset:-6px;border-radius:50%;border:3px solid ${bg};opacity:.55;animation:rysaPulse 1.4s ease-out infinite"></span>`
    : "";
  return L.divIcon({
    className: "rysa-map-dot",
    html: `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${ring}` +
      `<div style="width:${dot}px;height:${dot}px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
};

/**
 * Marcador de CLIENTE — SIEMPRE AMARILLO para distinguirlo de los vendedores
 * (verde/azul/rojo/gris). `seleccionada` agrega anillo pulsante y tamaño mayor.
 */
export const iconCliente = (_estadoAdeudo, seleccionada = false) => {
  const bg = "#EAB308"; // amarillo (yellow-500): color distintivo de clientes
  const size = seleccionada ? 30 : 16;
  const dot = seleccionada ? 18 : 13;
  const ring = seleccionada
    ? `<span style="position:absolute;inset:-6px;border-radius:50%;border:3px solid ${bg};opacity:.55;animation:rysaPulse 1.4s ease-out infinite"></span>`
    : "";
  return L.divIcon({
    className: "rysa-map-dot",
    html: `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${ring}` +
      `<div style="width:${dot}px;height:${dot}px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
};
