// Caché en disco de imágenes de producto y estáticos del ERP.
//
// Intercepta las peticiones https del navegador embebido (protocol.handle) y,
// para las rutas cacheables, responde desde la carpeta de datos elegida en la
// instalación. Todo lo demás (API, login, index.html) pasa directo al servidor.
//
// Reglas:
//   INMUTABLE  /static/(js|css|media)/*  (nombre con hash de CRA)
//              /api/files/uploads/<uuid32>.webp  (cada subida = uuid nuevo)
//              → se sirven del disco sin tocar la red.
//   REVALIDAR  /api/files/uploads/(productos|familias|marca)/*, /brand/*
//              (se pueden reemplazar con el mismo nombre)
//              → se sirven del disco al instante y, si la copia tiene más de
//                REVALIDAR_MS, se revalida en segundo plano (If-None-Match /
//                If-Modified-Since; 304 = sin descarga).
// Sin conexión: lo que ya está en disco se sirve igual (no depende de la red).
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const REVALIDAR_MS = 6 * 60 * 60 * 1000;

const INMUTABLE = [
  /^\/static\/(js|css|media)\/[^/]+$/,
  /^\/api\/files\/uploads\/[0-9a-f]{32}\.(webp|png|jpe?g|gif)$/,
];
const REVALIDAR = [
  /^\/api\/files\/uploads\/(productos|familias|marca)\/[A-Za-z0-9._-]+$/,
  /^\/brand\/[A-Za-z0-9._-]+$/,
];

function clasificar(pathname) {
  if (INMUTABLE.some((r) => r.test(pathname))) return "inmutable";
  if (REVALIDAR.some((r) => r.test(pathname))) return "revalidar";
  return null;
}

class CacheDisco {
  constructor(dir, fetchRed) {
    this.dir = dir;
    this.fetchRed = fetchRed; // (url, headers) => Promise<Response>, sin pasar por el interceptor
    this.revalidando = new Set();
    this.stats = { hit: 0, miss: 0, stale: 0, error: 0 };
    fs.mkdirSync(dir, { recursive: true });
  }

  // Ruta del archivo en disco: <dir>/<host>/<ruta>. Las rutas ya pasaron por
  // las expresiones de arriba (sin "..", sin query), así que son seguras.
  rutaLocal(u) {
    return path.join(this.dir, u.host.replace(/[^A-Za-z0-9.-]/g, "_"), ...u.pathname.split("/").filter(Boolean));
  }

  async leerMeta(archivo) {
    try {
      return JSON.parse(await fsp.readFile(archivo + ".meta", "utf8"));
    } catch {
      return null;
    }
  }

  async guardar(archivo, cuerpo, res) {
    await fsp.mkdir(path.dirname(archivo), { recursive: true });
    const tmp = `${archivo}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fsp.writeFile(tmp, cuerpo);
    await fsp.rename(tmp, archivo);
    const meta = {
      tipo: res.headers.get("content-type") || "application/octet-stream",
      etag: res.headers.get("etag") || null,
      modificado: res.headers.get("last-modified") || null,
      revisado: Date.now(),
      bytes: cuerpo.length,
    };
    await fsp.writeFile(archivo + ".meta", JSON.stringify(meta));
    return meta;
  }

  respuestaLocal(cuerpo, meta, estado) {
    this.stats[estado.toLowerCase()]++;
    return new Response(cuerpo, {
      status: 200,
      headers: {
        "content-type": meta.tipo,
        "content-length": String(cuerpo.length),
        "x-rysa-cache": estado,
      },
    });
  }

  // Devuelve una Response, o null si la petición no es cacheable.
  async atender(request) {
    if (request.method !== "GET") return null;
    const u = new URL(request.url);
    if (u.search) return null;
    const clase = clasificar(u.pathname);
    if (!clase) return null;

    const archivo = this.rutaLocal(u);
    const meta = await this.leerMeta(archivo);
    if (meta) {
      let cuerpo = null;
      try {
        cuerpo = await fsp.readFile(archivo);
      } catch {
        /* meta sin archivo: se descarga de nuevo */
      }
      if (cuerpo) {
        if (clase === "revalidar" && Date.now() - meta.revisado > REVALIDAR_MS) {
          this.revalidar(u, archivo, meta);
          return this.respuestaLocal(cuerpo, meta, "STALE");
        }
        return this.respuestaLocal(cuerpo, meta, "HIT");
      }
    }

    let res;
    try {
      res = await this.fetchRed(u.href, {});
    } catch (e) {
      this.stats.error++;
      throw e;
    }
    if (res.status !== 200) return res;
    const cuerpo = Buffer.from(await res.arrayBuffer());
    let nuevaMeta;
    try {
      nuevaMeta = await this.guardar(archivo, cuerpo, res);
    } catch {
      nuevaMeta = { tipo: res.headers.get("content-type") || "application/octet-stream" };
    }
    return this.respuestaLocal(cuerpo, nuevaMeta, "MISS");
  }

  revalidar(u, archivo, meta) {
    if (this.revalidando.has(archivo)) return;
    this.revalidando.add(archivo);
    const headers = {};
    if (meta.etag) headers["if-none-match"] = meta.etag;
    if (meta.modificado) headers["if-modified-since"] = meta.modificado;
    (async () => {
      const res = await this.fetchRed(u.href, headers);
      if (res.status === 304) {
        meta.revisado = Date.now();
        await fsp.writeFile(archivo + ".meta", JSON.stringify(meta));
      } else if (res.status === 200) {
        await this.guardar(archivo, Buffer.from(await res.arrayBuffer()), res);
      } else if (res.status === 404) {
        await fsp.rm(archivo, { force: true });
        await fsp.rm(archivo + ".meta", { force: true });
      }
    })()
      .catch(() => {})
      .finally(() => this.revalidando.delete(archivo));
  }

  async tamano() {
    let archivos = 0;
    let bytes = 0;
    const recorrer = async (d) => {
      let entradas = [];
      try {
        entradas = await fsp.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entradas) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await recorrer(p);
        else if (!e.name.endsWith(".meta") && !e.name.endsWith(".tmp")) {
          archivos++;
          bytes += (await fsp.stat(p)).size;
        }
      }
    };
    await recorrer(this.dir);
    return { archivos, bytes };
  }

  async vaciar() {
    await fsp.rm(this.dir, { recursive: true, force: true });
    await fsp.mkdir(this.dir, { recursive: true });
  }
}

module.exports = { CacheDisco, clasificar };
