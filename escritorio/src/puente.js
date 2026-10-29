// Puente local de impresión en http://127.0.0.1:9731, abierto mientras la app
// corre. Permite que el ERP abierto en Chrome en ESTA misma PC también imprima
// directo (una página web no puede tocar impresoras por sí sola).
//   GET  /estado   → { ok, app, version }
//   GET  /printers → [{ nombre, predeterminada, estado }]
//   POST /print    → { printer, pdf_base64, documento, copias } → { ok } | { error }
// Solo responde al origen del ERP: cualquier otro sitio recibe 403, así una
// página ajena no puede mandar impresiones.
const http = require("http");

const PUERTO = 9731;
const MAX_CUERPO = 21 * 1024 * 1024; // PDF de 15 MB en base64

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > MAX_CUERPO) {
        reject(new Error("El PDF es demasiado grande"));
        req.destroy();
      } else partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
    req.on("error", reject);
  });
}

function iniciarPuente({ origen, version, listar, imprimir }) {
  const servidor = http.createServer(async (req, res) => {
    const desde = req.headers.origin || "";
    if (desde !== origen) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Solo el ERP de Grupo RYSA puede usar el puente de impresión.");
    }
    const cors = {
      "Access-Control-Allow-Origin": desde,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      // Chrome lo pide para que un sitio público hable con localhost.
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "600",
    };
    const json = (codigo, cuerpo) => {
      res.writeHead(codigo, { ...cors, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(cuerpo));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    try {
      const ruta = new URL(req.url, "http://127.0.0.1").pathname;
      if (req.method === "GET" && ruta === "/estado") return json(200, { ok: true, app: "RYSA ERP", version });
      if (req.method === "GET" && ruta === "/printers") return json(200, await listar());
      if (req.method === "POST" && ruta === "/print") {
        const datos = JSON.parse((await leerCuerpo(req)) || "{}");
        const r = await imprimir({
          impresora: datos.printer || "",
          pdf_base64: datos.pdf_base64 || "",
          tipo: datos.documento || "carta",
          copias: datos.copias || 1,
        });
        return r.ok ? json(200, { ok: true }) : json(r.error === "Falta el PDF" ? 400 : 500, { error: r.error });
      }
      return json(404, { error: "No encontrado" });
    } catch (e) {
      return json(500, { error: String((e && e.message) || e).slice(0, 300) });
    }
  });
  // Puerto ocupado (otra copia de la app u otro programa): la app sigue sin puente.
  servidor.on("error", () => {});
  servidor.listen(PUERTO, "127.0.0.1");
  return servidor;
}

module.exports = { iniciarPuente, PUERTO };
