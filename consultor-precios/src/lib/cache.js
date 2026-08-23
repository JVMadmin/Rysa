// Cache local del Consultor de Precios (solo lectura).
// Fuente oficial: RYSA. La cache solo permite ver el ultimo precio conocido
// cuando hay interrupcion de red. Nunca modifica precios y se refresca con
// cualquier consulta exitosa.

const KEY = "rysa-price-checker:v1";

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch (e) {
    return {};
  }
}

function write(store) {
  try {
    // Limite de tamano: conservar las entradas mas recientes.
    const keys = Object.keys(store);
    if (keys.length > 400) {
      const sorted = keys.sort((a, b) => (store[b].savedAt || 0) - (store[a].savedAt || 0));
      for (const k of sorted.slice(400)) delete store[k];
    }
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) {
    /* almacenamiento lleno o no disponible: se ignora */
  }
}

/** Guarda el producto en cache bajo varias claves (id, codigo, barcodes). */
export function cacheSet(dto) {
  if (!dto || !dto.id) return;
  const store = read();
  const entry = { ...dto, savedAt: Date.now() };
  const keys = [entry.id, entry.codigo, entry.sku];
  (entry.codigos_barras || []).forEach((bc) => keys.push(bc));
  keys.forEach((k) => k && (store[String(k).toLowerCase()] = entry));
  store._ultimaSync = Date.now();
  write(store);
}

/** Recupera un producto cacheado por clave (codigo / barcode / id). */
export function cacheGet(key) {
  if (!key) return null;
  return read()[String(key).toLowerCase().trim()] || null;
}

/** Fecha (ms) de la ultima actualizacion sincronizada con RYSA. */
export function lastSync() {
  const store = read();
  return Number(store._lastSync || 0);
}

/** Expira la cache completa (boton Actualizar o cambios fuertes). */
export function cacheClear() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* ignore */
  }
}

// depuracion
export default { cacheSet, cacheGet, lastSync, cacheClear };