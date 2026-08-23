// Datos ficticios SOLO para prueba local del Consultor de Precios.
// Activa en .env.local con REACT_APP_MOCK=1 (no requiere base de datos).
// Reproducen la forma exacta del DTO que devuelve la API real.

const AHORA = new Date().toISOString();

function prod(over) {
  return {
    id: "",
    sku: "",
    barcode: "",
    codigos_barras: [],
    imagen: "",
    descripcion: "",
    presentacion: "",
    unidad: "PZA",
    precio_publico: 0,
    precio_sin_iva: 0,
    iva: 16,
    iva_importe: 0,
    incluye_iva: true,
    sucursal: null,
    actualizacion: AHORA,
    ...over,
  };
}

const PRODUCTOS = [
  prod({
    id: "m1",
    codigo: "VAS-12001",
    sku: "VAS-12001",
    barcode: "7500000000012",
    codigos_barras: ["7500000000012", "VAS-12001"],
    nombre: "Vaso Desechable 12 oz",
    presentacion: "Paquete 50 pzas",
    unidad: "PZA",
    iva: 8,
    precio_sin_iva: 40.0,
    precio_publico: 43.2,
    iva_importe: 3.2,
  }),
  prod({
    id: "m2",
    codigo: "VAS-12002",
    sku: "VASP-12TR",
    nombre: "Vaso 12 oz Transparente",
    presentacion: "Caja 100 pzas",
    unidad: "CAJA",
    precio_sin_iva: 100.0,
    precio_publico: 116.0,
    iva_importe: 16.0,
    barcode: "7500000000104",
    codigos_barras: ["7500000000104"],
  }),
  prod({
    id: "m3",
    codigo: "VAS-12003",
    sku: "VASP-12RF",
    nombre: "Vaso 12 oz Reforzado",
    presentacion: "Paquete 25 pzas",
    unidad: "P",
    barcode: "7500000000111",
    codigos_barras: ["7500000000111", "VASP-12RF"],
    precio_publico: 116.0,
    precio_sin_iva: 100.0,
    iva_importe: 16.0,
  }),
  prod({
    id: "m4",
    codigo: "PLT-062",
    nombre: "Plato 6.5 oz Desechable",
    presentacion: "Paquete 100 pzas",
    unidad: "P",
    barcode: "7500000000128",
    codigos_barras: ["7500000000128"],
    precio_publico: 87.0,
    precio_sin_iva: 75.0,
    iva_importe: 12.0,
  }),
  prod({
    id: "m5",
    codigo: "BOL-2500",
    sku: "BOLSA-25X35",
    nombre: "Bolsa Negra 25x35",
    descripcion: "Bolsa de basura calibre 200",
    presentacion: "Rollo 50 pzas",
    unidad: "R",
    barcode: "7500000000203",
    codigos_barras: ["7500000000203", "BOL-2500"],
    precio_publico: 149.0,
    precio_sin_iva: 149.0,
    iva: 0,
    iva_importe: 0,
  }),
];

// Ajuste fino: fuerza numeros exactos para que la tarjeta muestre valores limpios.
function f(sin, tasa = 16) {
  const iva = tasa > 0 ? Math.round((sin * tasa) / 100 * 100) / 100 : 0;
  return { precio_sin_iva: sin, iva: tasa, iva_importe: iva, precio_publico: Math.round((sin + iva) * 100) / 100 };
}

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

export function buscar(p, term) {
  const t = norm(term);
  if (!t) return false;
  const haystack = norm(
    [p.nombre, p.codigo, p.sku, p.barcode, p.descripcion, p.presentacion].join(" ")
  );
  return haystack.includes(t);
}

export function search(q) {
  const results = PRODUCTOS.filter((p) => buscar(p, q)).slice(0, 25);
  return Promise.resolve({ q, total: results.length, results });
}

export function byCodigo(code) {
  const c = norm(code);
  const prod = PRODUCTOS.find((p) => norm(p.codigo) === c || norm(p.sku) === c);
  return Promise.resolve(prod ? { found: true, product: prod } : { found: false, product: null });
}

export function byBarcode(code) {
  const c = norm(code);
  const prod = PRODUCTOS.find(
    (p) =>
      norm(p.barcode) === c ||
      (p.codigos_barras || []).some((b) => norm(b) === c)
  );
  return Promise.resolve(prod ? { found: true, product: prod } : { found: false, product: null });
}

export function health() {
  return Promise.resolve({ ok: true });
}