// Redondeo del precio FINAL que paga el cliente (con IVA), configurable en
// Configuración → Precios (settings.redondeo_precios).
export const REDONDEO_DEFAULT = "arriba_peso";

export const MODOS_REDONDEO = {
  arriba_peso: "Hacia arriba al peso (44.20 → 45)",
  arriba_50: "Hacia arriba a 50 centavos (44.20 → 44.50)",
  cercano_peso: "Al peso más cercano (44.20 → 44 · 44.60 → 45)",
  ninguno: "Sin redondeo (centavos exactos)",
};

export function redondearPrecio(valor, modo = REDONDEO_DEFAULT) {
  // Primero a centavos, para que 45.000000001 no suba a 46.
  const c = Math.round((Number(valor) || 0) * 100) / 100;
  switch (modo) {
    case "ninguno": return c;
    case "arriba_50": return Math.ceil(c * 2 - 1e-9) / 2;
    case "cercano_peso": return Math.round(c);
    default: return Math.ceil(c - 1e-9);
  }
}

// El carrito y el backend trabajan con precio NETO (sin IVA). Devuelve el neto
// cuyo precio con IVA queda exactamente en el valor redondeado.
export function netoRedondeado(neto, ivaTasa, modo = REDONDEO_DEFAULT) {
  const f = 1 + (Number(ivaTasa) || 0) / 100;
  if (modo === "ninguno") return +(Number(neto) || 0).toFixed(2);
  return +(redondearPrecio((Number(neto) || 0) * f, modo) / f).toFixed(4);
}

// % de utilidad sobre costo por lista cuando Configuración no los tiene
// guardados. Referencia B90 (costo 29.63): 50% → $48, 40% → $45, 30% → $42.
export const LISTAS_PCT_DEFAULT = [50, 40, 30, 20, 15];

// IVA del producto en %. 0 es válido (exento); solo sin dato se usa 8.
export const tasaIva = (p) => {
  for (const k of ["iva_tasa", "iva", "impuesto"]) {
    const v = p?.[k];
    if (v !== undefined && v !== null && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return 8;
};

// [{neto, conIva}] por posición de lista ({0,0} si esa lista no tiene precio).
// Sin listas capturadas, el precio guardado del producto cuenta como Precio 1
// (es el que trae la importación del sistema anterior).
function capturados(p, f) {
  let out = (p.precios || []).map((e) => {
    let neto = Number(e?.precio_sin_iva || 0);
    const con = Number(e?.precio_con_iva || 0);
    // El neto guardado vale si cuadra con el precio con IVA; si no (se capturó
    // con IVA y el neto quedó redondeado a centavos), se deriva de él.
    if (con > 0 && (neto <= 0 || Math.abs(+(neto * f).toFixed(2) - con) > 0.005)) neto = con / f;
    return { neto, conIva: con > 0 ? con : neto > 0 ? +(neto * f).toFixed(2) : 0 };
  });
  if (!out.some((x) => x.neto > 0)) {
    let neto = Number(p.precio_sin_iva || 0);
    const con = Number(p.precio_con_iva || 0);
    if (neto <= 0 && con > 0) neto = con / f;
    out = neto > 0 ? [{ neto, conIva: con > 0 ? con : +(neto * f).toFixed(2) }] : [];
  }
  return out;
}

// Precio de una lista. Misma regla que backend/moneycalc.py (precios_lista):
//  - Precio capturado en el producto: tal cual, sin redondeo (es el del
//    sistema anterior o el que puso el usuario; no debe variar).
//  - Lista sin precio en un producto que sí tiene otros: el último precio
//    capturado anterior (el último precio es el de revendedores).
//  - Producto sin ningún precio: % de la lista sobre el costo (si el % > 0),
//    redondeado según Configuración.
// Devuelve { neto, conIva, capturado }. El carrito y la venta usan el NETO y el
// IVA se suma una sola vez en el total.
export function precioDeLista(p, l, pct = LISTAS_PCT_DEFAULT, modo = REDONDEO_DEFAULT) {
  const n = pct?.length ?? LISTAS_PCT_DEFAULT.length;
  const iva = tasaIva(p);
  const f = 1 + iva / 100;
  if (Number(l) === n + 1) {
    const min = Number(p.precio_minimo ?? 0);
    return { neto: min, conIva: +(min * f).toFixed(2), capturado: min > 0 };
  }
  const caps = capturados(p, f);
  const lIdx = Math.max(0, Number(l) - 1);
  let ultimo = null;
  for (let i = 0; i <= lIdx && i < caps.length; i += 1) if (caps[i].neto > 0) ultimo = caps[i];
  const propio = caps[lIdx];
  if (propio && propio.neto > 0) return { neto: +propio.neto.toFixed(6), conIva: propio.conIva, capturado: true };
  if (ultimo) return { neto: +ultimo.neto.toFixed(6), conIva: ultimo.conIva, capturado: false };
  const costo = Number(p.costo ?? 0);
  const pctLista = Number(pct?.[lIdx] ?? 0);
  if (!caps.length && costo > 0 && pctLista > 0 && lIdx < n) {
    const neto = netoRedondeado(costo * (1 + pctLista / 100), iva, modo);
    return { neto, conIva: +(neto * f).toFixed(2), capturado: false };
  }
  return { neto: 0, conIva: 0, capturado: false };
}

// Listas (1..n) que el producto tiene capturadas: las que se ofrecen en F6.
export const listasCapturadas = (p, pct = LISTAS_PCT_DEFAULT) =>
  Array.from({ length: pct?.length ?? LISTAS_PCT_DEFAULT.length }, (_, i) => i + 1)
    .filter((l) => precioDeLista(p, l, pct).capturado);

// Precio NETO (sin IVA) de una lista.
export const precioNetoLista = (p, l, pct = LISTAS_PCT_DEFAULT, modo = REDONDEO_DEFAULT) =>
  precioDeLista(p, l, pct, modo).neto;

// Precio con IVA de una lista (lo que paga el cliente).
export const precioLista = (p, l, pct = LISTAS_PCT_DEFAULT, modo = REDONDEO_DEFAULT) =>
  precioDeLista(p, l, pct, modo).conIva;
