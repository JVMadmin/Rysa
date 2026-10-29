// Verifica la app de escritorio de punta a punta (Node 22+, sin dependencias):
//   1. Arranca la app con depuración remota y espera la ventana del ERP.
//   2. Comprueba que el sitio público (/productos) redirige al ERP.
//   3. Pide una imagen de producto dos veces: MISS (descarga y guarda) y HIT (disco).
//   4. Cierra, vuelve a abrir y comprueba HIT de la imagen y de los /static/ del arranque.
//
// Uso:
//   node scripts/verificar-cache.mjs [ruta\a\RYSA ERP.exe] [carpeta-de-datos]
// Sin ruta usa el Electron de desarrollo (node_modules). Con el .exe instalado y sin
// carpeta, la app usa la que eligió el instalador.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const exe = process.argv[2] || path.join(RAIZ, "node_modules", "electron", "dist", "electron.exe");
const datos = process.argv[3] || (process.argv[2] ? null : path.join(RAIZ, "prueba-datos"));
const IMAGEN = process.env.RYSA_IMAGEN || "/api/files/uploads/familias/g2-asa-poliseda.webp";
const PUERTO = 9333;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function arrancar() {
  const args = [`--remote-debugging-port=${PUERTO}`];
  if (!process.argv[2]) args.unshift(RAIZ);
  const env = { ...process.env, RYSA_SIN_ACTUALIZAR: "1" };
  if (datos) env.RYSA_DATOS = datos;
  return spawn(exe, args, { env, stdio: "ignore" });
}

async function pagina() {
  for (let i = 0; i < 60; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json();
      const p = lista.find((t) => t.type === "page" && t.url.startsWith("https://"));
      if (p) return p;
    } catch {
      /* aún arrancando */
    }
    await espera(500);
  }
  throw new Error("La ventana del ERP no apareció");
}

async function conectar(p) {
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((ok, mal) => { ws.onopen = ok; ws.onerror = mal; });
  let id = 0;
  const pendientes = new Map();
  const eventos = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pendientes.has(d.id)) { pendientes.get(d.id)(d); pendientes.delete(d.id); }
    else if (d.method) eventos.push(d);
  };
  // Con límite de tiempo: una evaluación lanzada justo durante una navegación se pierde.
  const cmd = (method, params = {}) =>
    new Promise((ok) => {
      const n = ++id;
      pendientes.set(n, ok);
      ws.send(JSON.stringify({ id: n, method, params }));
      setTimeout(() => { if (pendientes.delete(n)) ok({}); }, 10000);
    });
  const evaluar = async (expr) => (await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { ws, cmd, evaluar, eventos };
}

async function pedirImagen(c) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await c.evaluar(`fetch(${JSON.stringify(IMAGEN)}).then(async r => ({ estado: r.status, cache: r.headers.get("x-rysa-cache"), bytes: (await r.arrayBuffer()).byteLength }))`);
    if (r) return r;
    await espera(1000);
  }
  return null;
}

async function esperarRuta(c, re, ms = 15000) {
  for (let t = 0; t < ms; t += 300) {
    const ruta = await c.evaluar("location.pathname");
    if (ruta && re.test(ruta)) return ruta;
    await espera(300);
  }
  return c.evaluar("location.pathname");
}

let ok = true;
const check = (cond, msg) => { console.log(`${cond ? "OK   " : "FALLA"} ${msg}`); ok &&= !!cond; };

// --- Primera ejecución ---
let app = arrancar();
let c = await conectar(await pagina());
check(/^\/(login|app)/.test(await esperarRuta(c, /^\/(login|app)/)), `abre el ERP: ${await c.evaluar("location.href")}`);

await c.evaluar(`location.href = "/productos"`);
await espera(1500);
const tras = await esperarRuta(c, /^\/(login|app)/);
check(/^\/(login|app)/.test(tras), `sitio público /productos redirige a ${tras}`);

const r1 = await pedirImagen(c);
const r2 = await pedirImagen(c);
console.log("     1a petición:", r1, " 2a petición:", r2);
check(r1?.estado === 200 && ["MISS", "HIT", "STALE"].includes(r1.cache), "imagen servida por la app");
check(r2?.cache === "HIT" || r2?.cache === "STALE", "2a petición sale del disco");
if (datos) {
  const enDisco = path.join(datos, "cache", "gruporysa.com", ...IMAGEN.split("/").filter(Boolean));
  check(existsSync(enDisco), `archivo en disco: ${enDisco}`);
}
c.ws.close();
app.kill();
await espera(2500);

// --- Segunda ejecución: todo debe venir del disco ---
app = arrancar();
const p2 = await pagina();
c = await conectar(p2);
await c.cmd("Network.enable");
await c.cmd("Page.reload", { ignoreCache: true });
await espera(6000);
const estaticos = c.eventos
  .filter((e) => e.method === "Network.responseReceived" && /\/static\//.test(e.params.response.url))
  .map((e) => ({ url: new URL(e.params.response.url).pathname, cache: e.params.response.headers["x-rysa-cache"] }));
console.log("     /static/ tras reiniciar:", estaticos);
check(estaticos.length > 0 && estaticos.every((e) => e.cache === "HIT"), "JS/CSS del ERP salen del disco");
const r3 = await pedirImagen(c);
console.log("     tras reiniciar:", r3);
check(r3?.cache === "HIT" || r3?.cache === "STALE", "imagen sale del disco tras reiniciar la app");
c.ws.close();
app.kill();
console.log(ok ? "\nTodo correcto." : "\nHay fallas.");
process.exit(ok ? 0 : 1);
