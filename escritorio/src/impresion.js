// Impresión directa (sin diálogo) a impresoras de Windows por su nombre.
// El ERP manda el PDF oficial del documento (ticket de 80 mm o carta) y aquí
// se imprime con SumatraPDF, que viene dentro de pdf-to-printer.
//   - ticket: tamaño real ("noscale"). El PDF mide 80 mm con 72 mm útiles,
//     igual que la Xprinter XP-N160II; el corte lo hace su driver.
//   - carta y demás: ajustado a hoja carta (Brother DCP-L2660DW u otra láser).
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_BYTES = 15 * 1024 * 1024;
let ptp = null;

function pdfToPrinter() {
  if (!ptp) ptp = require("pdf-to-printer");
  return ptp;
}

// Dentro del instalador el .exe va desempaquetado (asarUnpack), fuera de app.asar.
function rutaSumatra() {
  const dir = path.dirname(require.resolve("pdf-to-printer"));
  const real = dir.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  for (const d of [real, dir]) {
    try {
      const exe = fs.readdirSync(d).find((f) => /^SumatraPDF.*\.exe$/i.test(f));
      if (exe) return path.join(real, exe);
    } catch {
      /* se intenta la otra ruta */
    }
  }
  return undefined;
}

async function listarImpresoras(webContents) {
  const lista = await webContents.getPrintersAsync();
  return lista.map((p) => ({
    nombre: p.name,
    predeterminada: !!p.isDefault,
    estado: p.status === 0 || p.status === undefined ? "lista" : `código ${p.status}`,
  }));
}

async function imprimirPdf({ impresora = "", pdf_base64 = "", tipo = "carta", copias = 1 } = {}) {
  if (typeof pdf_base64 !== "string" || !pdf_base64) return { ok: false, error: "Falta el PDF" };
  const datos = Buffer.from(pdf_base64, "base64");
  if (datos.length > MAX_BYTES) return { ok: false, error: "El PDF es demasiado grande" };
  if (datos.subarray(0, 4).toString() !== "%PDF") return { ok: false, error: "El archivo no es un PDF" };
  const archivo = path.join(os.tmpdir(), `rysa-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await fs.promises.writeFile(archivo, datos);
  try {
    const opciones = {
      silent: true,
      copies: Math.min(Math.max(parseInt(copias, 10) || 1, 1), 10),
      scale: tipo === "ticket" ? "noscale" : "fit",
      sumatraPdfPath: rutaSumatra(),
    };
    if (impresora) opciones.printer = String(impresora);
    if (tipo !== "ticket") opciones.paperSize = "letter";
    await pdfToPrinter().print(archivo, opciones);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300) };
  } finally {
    // SumatraPDF termina al mandar el trabajo a la cola; se borra después.
    setTimeout(() => fs.promises.unlink(archivo).catch(() => {}), 30000);
  }
}

module.exports = { listarImpresoras, imprimirPdf };
