// Fechas y horas en la zona de la sucursal (México centro: UTC-6 fijo desde
// 2022, sin horario de verano). El servidor guarda marcas en UTC ISO
// ("2026-10-25T01:30:00+00:00") y las ventas LEGACY solo la fecha local
// ("2026-10-24"). Antes se recortaba la cadena ISO con slice() y se mostraba
// la hora UTC: una venta de las 19:30 salía con fecha del día siguiente.
// Usar SIEMPRE estas funciones para mostrar fechas; nunca slice() sobre ISO ni
// toISOString().slice(0, 10) para "hoy".
export const TZ_NEGOCIO = "America/Mexico_City";

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const aDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmt = (opts) => new Intl.DateTimeFormat("es-MX", { timeZone: TZ_NEGOCIO, ...opts });
const F_FECHA = fmt({ day: "2-digit", month: "2-digit", year: "numeric" });
const F_HORA = fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const F_LARGA = fmt({ day: "numeric", month: "short", year: "numeric" });
const F_ISO = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });

const desdeSoloFecha = (s) => { const [a, m, d] = s.split("-"); return `${d}/${m}/${a}`; };

/** "25/10/2026" (las fechas LEGACY sin hora se muestran tal cual). */
export function fmtFecha(v) {
  if (typeof v === "string" && SOLO_FECHA.test(v)) return desdeSoloFecha(v);
  const d = aDate(v);
  return d ? F_FECHA.format(d) : (v ? String(v) : "");
}

/** "13:45" en hora local; "" si el valor no trae hora. */
export function fmtHora(v) {
  if (typeof v === "string" && SOLO_FECHA.test(v)) return "";
  const d = aDate(v);
  return d ? F_HORA.format(d) : "";
}

/** "25/10/2026 13:45" (sin hora para fechas LEGACY). */
export function fmtFechaHora(v) {
  const h = fmtHora(v);
  const f = fmtFecha(v);
  return h ? `${f} ${h}` : f;
}

/** "25 oct 2026" para encabezados y textos. */
export function fmtFechaLarga(v) {
  if (typeof v === "string" && SOLO_FECHA.test(v)) {
    const [a, m, d] = v.split("-").map(Number);
    return F_LARGA.format(new Date(Date.UTC(a, m - 1, d, 12)));
  }
  const d = aDate(v);
  return d ? F_LARGA.format(d) : "";
}

/** "AAAA-MM-DD" local de una marca (para agrupar o comparar días). */
export function fechaLocalISO(v) {
  if (typeof v === "string" && SOLO_FECHA.test(v)) return v;
  const d = aDate(v);
  if (!d) return "";
  const p = Object.fromEntries(F_ISO.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hoy en la sucursal, "AAAA-MM-DD" (valor por defecto de filtros de fecha). */
export const hoyLocal = () => fechaLocalISO(new Date());

/** Hace `n` días (local), "AAAA-MM-DD". */
export const haceDiasLocal = (n) => fechaLocalISO(new Date(Date.now() - n * 86400000));

/** Primer día del mes local, "AAAA-MM-01". */
export const inicioMesLocal = () => `${hoyLocal().slice(0, 7)}-01`;
