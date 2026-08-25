/**
 * ===========================================================================
 * Utilidades de ubicación / mapas para el módulo de campo.
 * Compartido por Supervisión Comercial y Mi Actividad de Campo vía MapaCampo.
 *
 * Exporta:
 *  - MAP_THEME / MAP_ATTRIBUTION / PALENQUE .... configuración del mapa base
 *  - ESTADO_LABEL / ESTADO_DOT ................ catálogo de estados de flota
 *  - coordValida(lat, lng) .................... validación de coordenadas
 *  - boundsDe(pts) ............................ encuadre para varios puntos
 *  - iconCliente(c, sel) / iconVendedor(...) .. marcadores divIcon
 *  - separarVendedores(lista) ................. {enMapa, sinGps}
 * ===========================================================================
 */
import L from "leaflet";

/* ------------------------------ Mapa base -------------------------------- */
export const MAP_THEME = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Centro operativo: Palenque, Chiapas. */
export const PALENQUE = [17.5095, -91.9827];

/* --------------------------- Estados de flota ----------------------------- */
export const ESTADO_LABEL = {
  activo: "Activo",
  en_ruta: "En ruta",
  sin_actividad: "Sin actividad",
  sin_datos: "Sin datos",
};

export const ESTADO_DOT = {
  activo: "#2563eb",
  en_ruta: "#059669",
  sin_actividad: "#dc2626",
  sin_datos: "#94a3b8",
};

/* ------------------------------ Validación -------------------------------- */
/** ¿Es una coordenada geográfica utilizable? Devuelve true/false. */
export function coordValida(latitud, longitud) {
  const la = Number(latitud);
  const ln = Number(longitud);
  return (
    Number.isFinite(la) && Number.isFinite(ln)
    && la >= -90 && la <= 90
    && ln >= -180 && ln <= 180
    && !(la === 0 && ln === 0)
  );
}

/** LatLngBounds a partir de una lista de puntos [lat,lng] (ignora inválidos). */
export function boundsDe(pts) {
  const valides = (pts || [])
    .filter((p) => p && coordValida(p[0], p[1]))
    .map((p) => [Number(p[0]), Number(p[1])]);
  return L.latLngBounds(valides);
}

/* ------------------------------ Marcadores -------------------------------- */
const _pinHtml = (color, size, seleccionado, emoji) => `
  <div style="
    width:${size}px;height:${size}px;
    transform:translate(-50%,-100%);
    display:flex;align-items:center;justify-content:center;
    background:${color};color:#fff;font-size:${Math.round(size * 0.5)}px;
    border:2px solid #fff;border-radius:50% 50% 50% 4px;
    box-shadow:0 1px 6px rgba(0,0,0,.35)${seleccionado ? ",0 0 0 4px rgba(193,64,30,.45)" : ""};
  ">${emoji}</div>`;

const _mkIcon = (html, size, anchorY) => L.divIcon({
  className: "",
  html,
  iconSize: [size, size],
  iconAnchor: [0, 0],
  popupAnchor: [0, -(anchorY || size)],
});

/** Marcador de cliente: rojo si hay vencido, ámbar con saldo, verde al día. */
export function iconCliente(cliente, seleccionado = false) {
  const vencido = Number(cliente?.vencido || 0);
  const saldo = Number(cliente?.saldo || 0);
  const color = vencido > 0 ? "#dc2626" : saldo > 0 ? "#d97706" : "#16a34a";
  const size = seleccionado ? 32 : 24;
  return _mkIcon(_pinHtml(color, size, seleccionado, "🏪"), size, size + 8);
}

/** Marcador de vendedor según su estado de actividad GPS. */
export function iconVendedor(estado, seleccionado = false) {
  const color = ESTADO_DOT[estado] || ESTADO_DOT.sin_datos;
  const size = seleccionado ? 34 : 26;
  const emoji = estado === "en_ruta" ? "🛵" : estado === "sin_actividad" ? "⚠️" : "🧑‍💼";
  return _mkIcon(_pinHtml(color, size, seleccionado, emoji), size, size + 8);
}

/* --------------------------- Normalización flota -------------------------- */
/**
 * Separa la lista cruda de vendedores (/supervision/map) en:
 *   - enMapa: los que tienen última ubicación GPS válida (con pos=[lat,lng]).
 *   - sinGps: los que no (para avisos informativos).
 */
export function separarVendedores(vendedores = []) {
  const out = { enMapa: [], sinGps: [] };
  for (const v of vendedores || []) {
    const ub = v?.ultima_ubicacion || null;
    if (ub && coordValida(ub.latitud, ub.longitud)) {
      out.enMapa.push({ ...v, pos: [Number(ub.latitud), Number(ub.longitud)] });
    } else {
      out.sinGps.push(v);
    }
  }
  return out;
}
