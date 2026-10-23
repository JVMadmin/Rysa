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

// Precio NETO (sin IVA) de una lista: el carrito y el backend trabajan en neto
// y el IVA se suma una sola vez en el total. Usa el precio capturado en el
// producto para esa lista; si no hay, aplica el % de la lista sobre el costo.
// En ambos casos el precio con IVA queda redondeado según la configuración.
// Ej. B90 (costo 29.63): P1 50% → $48, P2 40% → $45, P3 30% → $42 con IVA.
// Antes devolvía el precio CON IVA y el total le volvía a sumar el IVA.
export const precioNetoLista = (p, l, pct = LISTAS_PCT_DEFAULT, modo = REDONDEO_DEFAULT) => {
  const n = pct?.length ?? LISTAS_PCT_DEFAULT.length;
  const iva = Number(p.iva_tasa ?? p.iva ?? 8);
  if (Number(l) === n + 1) return Number(p.precio_minimo ?? 0);
  const arr = p.precios || [];
  const lIdx = Number(l) - 1;
  const capturado = Number(arr[lIdx]?.precio_con_iva || 0);
  if (capturado > 0) return netoRedondeado(capturado / (1 + iva / 100), iva, modo);
  const costo = Number(p.costo ?? 0);
  if (costo > 0 && lIdx < n) {
    const pctLista = Number(pct[lIdx] ?? pct[0] ?? 0);
    return netoRedondeado(costo * (1 + pctLista / 100), iva, modo);
  }
  const primero = Number(arr[0]?.precio_con_iva || 0);
  return primero ? netoRedondeado(primero / (1 + iva / 100), iva, modo) : 0;
};

// Precio con IVA de una lista (lo que paga el cliente), ya redondeado.
export const precioLista = (p, l, pct = LISTAS_PCT_DEFAULT, modo = REDONDEO_DEFAULT) =>
  +(precioNetoLista(p, l, pct, modo) * (1 + Number(p.iva_tasa ?? p.iva ?? 8) / 100)).toFixed(2);
