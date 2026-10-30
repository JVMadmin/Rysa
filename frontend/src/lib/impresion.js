// Impresión directa a impresoras del equipo (ticket térmico y carta).
//
// Tres caminos, en este orden:
//   1. App de escritorio RYSA ERP: expone window.rysaEscritorio (preload) e
//      imprime en silencio a la impresora de Windows elegida.
//   2. Puente local de la app (http://localhost:9731): cuando el ERP se abre en
//      Chrome en una PC que tiene la app de escritorio abierta.
//   3. Navegador: el diálogo de impresión del sistema. Chrome recuerda la última
//      impresora elegida, pero no puede imprimir sin diálogo ni elegir impresora.
//
// Cada equipo guarda qué impresora usa para tickets y cuál para carta (las
// mismas impresoras tienen nombres distintos en cada PC), con respaldo en las
// predeterminadas generales de Configuración → Impresoras.
import { api } from "@/lib/api";
import { toast } from "sonner";

const CLAVE_EQUIPO = "rysa_impresoras_equipo";
const PUENTE_DEFAULT = "http://localhost:9731";

// Tipos de documento → a qué impresora del equipo van.
export const DESTINO = { ticket: "ticket", carta: "carta", cotizacion: "carta", reporte: "carta", factura: "carta" };

// Perfiles conocidos del cliente.
export const PERFILES = [
  { clave: "xprinter_n160ii", nombre: "Xprinter XP-N160II", uso: "ticket",
    detalle: "Térmica de 80 mm (72 mm de impresión), corte automático. Instala el driver «XP-80» de Xprinter y deja el papel en 80 mm × rollo.",
    patron: /xp[\s-]?(n160|80|58)|xprinter|pos[\s-]?80/i },
  { clave: "brother_dcp_l2660dw", nombre: "Brother DCP-L2660DW", uso: "carta",
    detalle: "Láser monocromática tamaño carta (Wi-Fi o USB). Usa el driver de Brother; papel carta.",
    patron: /brother|dcp[\s-]?l?26/i },
];

export function leerEquipo() {
  try { return JSON.parse(localStorage.getItem(CLAVE_EQUIPO) || "{}") || {}; } catch { return {}; }
}

export function guardarEquipo(cfg) {
  try { localStorage.setItem(CLAVE_EQUIPO, JSON.stringify(cfg || {})); } catch {}
}

// Pantallas que no tienen la configuración a la mano: se pide una vez.
let _settings = null;
async function conSettings(settings) {
  if (settings) return settings;
  if (!_settings) {
    try { _settings = (await api.get("/settings")).data || {}; } catch { _settings = {}; }
  }
  return _settings;
}

const puenteUrl = (settings) => String(settings?.printers?.bridge_url || "").trim() || PUENTE_DEFAULT;

let _modo = null;           // "app" | "puente" | "navegador"
let _modoHasta = 0;

/** Cómo puede imprimir este equipo. Se recuerda 60 s. */
export async function detectarModo(settings, { forzar = false } = {}) {
  if (window.rysaEscritorio?.imprimir) return "app";
  if (!forzar && _modo && Date.now() < _modoHasta) return _modo;
  let modo = "navegador";
  try {
    const r = await fetch(puenteUrl(settings) + "/estado", { signal: AbortSignal.timeout(1500) });
    if (r.ok) modo = "puente";
  } catch { /* sin puente */ }
  _modo = modo;
  _modoHasta = Date.now() + 60000;
  return modo;
}

/** Impresoras instaladas en este equipo (solo con la app o el puente). */
export async function listarImpresoras(settings) {
  if (window.rysaEscritorio?.listarImpresoras) return window.rysaEscritorio.listarImpresoras();
  const r = await fetch(puenteUrl(settings) + "/printers", { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error("puente");
  const data = await r.json();
  return (Array.isArray(data) ? data : data.printers || []).map((p) => ({
    nombre: p.nombre || p.name, predeterminada: !!(p.predeterminada || p.isDefault), estado: p.estado || "",
  }));
}

/** Impresora (nombre de Windows) para un tipo de documento en este equipo. */
export function impresoraPara(tipo, settings) {
  const destino = DESTINO[tipo] || "carta";
  const equipo = leerEquipo();
  if (equipo[destino]) return equipo[destino];
  const pred = (settings?.printers?.predeterminadas || {})[tipo] || (settings?.printers?.predeterminadas || {})[destino];
  const p = (settings?.printers?.lista || []).find((x) => x.id === pred && x.habilitada !== false);
  return p?.nombre || "";
}

async function pdfBase64(pdfUrl) {
  const ruta = pdfUrl.replace(/^.*\/api\//, "/");
  const resp = await api.get(ruta, { responseType: "blob" });
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1] || "");
    fr.onerror = () => rej(new Error("lectura"));
    fr.readAsDataURL(resp.data);
  });
}

/**
 * Imprime un PDF del ERP directo a la impresora del equipo.
 * Devuelve true si se envió; false si este equipo solo puede imprimir con el
 * diálogo del navegador (quien llama hace ese respaldo).
 */
export async function imprimirDirecto({ tipo, pdfUrl, copias = 1, nombre = "" }, settingsDados) {
  const settings = await conSettings(settingsDados);
  const modo = await detectarModo(settings);
  if (modo === "navegador" || !pdfUrl) return false;
  const impresora = impresoraPara(tipo, settings);
  const pdf_base64 = await pdfBase64(pdfUrl);
  if (modo === "app") {
    const r = await window.rysaEscritorio.imprimir({ impresora, pdf_base64, tipo, copias, nombre_archivo: nombre });
    if (!r?.ok) throw new Error(r?.error || "No se pudo imprimir");
    return true;
  }
  const r = await fetch(puenteUrl(settings) + "/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printer: impresora, pdf_base64, documento: tipo, copias, filename: nombre }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    let msg = "No se pudo imprimir";
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return true;
}

/** PDF del ERP como blob: del mismo origen que la página, así el visor de PDF
 * del navegador deja imprimirlo desde el iframe (y nunca apunta a una URL
 * interna del servidor). */
async function pdfBlobUrl(pdfUrl) {
  const ruta = pdfUrl.replace(/^.*\/api\//, "/");
  const { data } = await api.get(ruta, { responseType: "blob" });
  return URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
}

/**
 * Respaldo del navegador: carga el PDF en un iframe oculto y abre el diálogo
 * de impresión cuando el visor terminó de dibujarlo. Si el navegador no deja
 * imprimir desde el iframe, abre el PDF en otra pestaña.
 */
export function imprimirConNavegador(src) {
  const f = document.createElement("iframe");
  Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0" });
  f.src = src;
  f.onload = () => {
    setTimeout(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch { window.open(src, "_blank"); }
    }, 500);
    setTimeout(() => { f.remove(); if (src.startsWith("blob:")) URL.revokeObjectURL(src); }, 60000);
  };
  document.body.appendChild(f);
  return true;
}

/**
 * Imprime un PDF del ERP: directo a la impresora del equipo (app de escritorio
 * o su puente) o, si no hay, con el diálogo del navegador. Lanza error solo si
 * no se pudo obtener el PDF (quien llama puede usar su plantilla HTML).
 */
export async function imprimirPdf({ tipo, pdfUrl, copias = 1, nombre = "",
  mensaje = "Documento enviado a la impresora." }, settings) {
  try {
    if (await imprimirDirecto({ tipo, pdfUrl, copias, nombre }, settings)) {
      toast.success(mensaje);
      return "directo";
    }
  } catch (e) {
    toast.error(`No se pudo imprimir directo (${e.message || "error"}). Se abre el diálogo de impresión.`);
  }
  imprimirConNavegador(await pdfBlobUrl(pdfUrl));
  return "dialogo";
}
