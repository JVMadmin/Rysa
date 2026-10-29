// RYSA ERP para escritorio (Windows).
// Abre solo el ERP de gruporysa.com (login y /app/...), nunca el sitio público,
// y sirve imágenes de producto y estáticos desde la carpeta de datos elegida
// en el instalador (ver cache.js).
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { CacheDisco } = require("./cache");
const { listarImpresoras, imprimirPdf } = require("./impresion");
const { iniciarPuente } = require("./puente");

const BASE = new URL(process.env.RYSA_URL || "https://gruporysa.com");
const INICIO = new URL("/app", BASE).href;
// Rutas del ERP que se pueden abrir; cualquier otra del mismo dominio (/, /productos,
// /facturacion, ...) es el sitio público y se redirige al ERP.
const RUTAS_ERP = /^\/(login|app|api|pago|verificar|static|brand)(\/|$)/;
const ESQUEMAS_EXTERNOS = new Set(["http:", "https:", "mailto:", "tel:", "whatsapp:"]);

// --- Carpeta de datos -------------------------------------------------------
// El instalador escribe la carpeta elegida en rysa-datos.txt (UTF-16 LE con BOM)
// junto al .exe.
function carpetaDatos() {
  if (process.env.RYSA_DATOS) return process.env.RYSA_DATOS;
  try {
    const crudo = fs.readFileSync(path.join(path.dirname(process.execPath), "rysa-datos.txt"));
    const utf16 = crudo[0] === 0xff && crudo[1] === 0xfe;
    const elegida = (utf16 ? crudo.subarray(2).toString("utf16le") : crudo.toString("utf8")).trim();
    if (elegida) return elegida;
  } catch {
    /* sin archivo: instalación manual o desarrollo */
  }
  return path.join(app.getPath("appData"), "..", "Local", "RYSA ERP");
}

const DATOS = carpetaDatos();
fs.mkdirSync(DATOS, { recursive: true });
// Perfil de Chromium (sesión, localStorage, caché HTTP) también en la carpeta elegida.
app.setPath("userData", path.join(DATOS, "perfil"));
app.setPath("crashDumps", path.join(DATOS, "perfil", "Crashpad"));
app.setAppLogsPath(path.join(DATOS, "registros"));

const instanciaPrincipal = app.requestSingleInstanceLock();
if (!instanciaPrincipal) app.quit();

let ventana = null;
let cache = null;

function esDelErp(u) {
  return u.origin === BASE.origin && RUTAS_ERP.test(u.pathname);
}

function abrirFuera(url) {
  try {
    const u = new URL(url);
    if (ESQUEMAS_EXTERNOS.has(u.protocol)) shell.openExternal(u.href);
  } catch {
    /* URL inválida: se ignora */
  }
}

// --- Intercepción de peticiones ---------------------------------------------
function instalarCache(ses) {
  const red = (url, headers) => ses.fetch(url, { headers, bypassCustomProtocolHandlers: true });
  cache = new CacheDisco(path.join(DATOS, "cache"), red);
  ses.protocol.handle("https", async (request) => {
    if (new URL(request.url).origin === BASE.origin) {
      try {
        const local = await cache.atender(request);
        if (local) return local;
      } catch {
        /* falla de red o disco: se intenta directo abajo */
      }
    }
    return ses.fetch(request, { bypassCustomProtocolHandlers: true });
  });
}

// --- Ventana ----------------------------------------------------------------
function protegerNavegacion(contenido) {
  contenido.on("will-navigate", (e, url) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (u.origin !== BASE.origin) {
      e.preventDefault();
      abrirFuera(url);
    } else if (!esDelErp(u)) {
      e.preventDefault();
      contenido.loadURL(INICIO);
    }
  });
  // Navegación interna del SPA (react-router): history.pushState no dispara will-navigate.
  contenido.on("did-navigate-in-page", (_e, url, principal) => {
    const u = new URL(url);
    if (principal && u.origin === BASE.origin && !esDelErp(u)) contenido.loadURL(INICIO);
  });
  contenido.setWindowOpenHandler(({ url }) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { action: "deny" };
    }
    // PDFs, tickets y vistas de impresión del propio ERP se abren en otra ventana de la app.
    if (u.protocol === "blob:" || u.protocol === "about:" || esDelErp(u)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { icon: icono(), autoHideMenuBar: true, backgroundColor: "#ffffff" },
      };
    }
    abrirFuera(url);
    return { action: "deny" };
  });
}

function icono() {
  return path.join(__dirname, "..", "recursos", "icono.ico");
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "RYSA ERP",
    icon: icono(),
    backgroundColor: "#1c1d20",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // window.rysaEscritorio: impresión directa para el ERP (ver impresion.js).
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`--rysa-version=${app.getVersion()}`],
    },
  });
  ventana.maximize();
  ventana.once("ready-to-show", () => ventana.show());
  ventana.on("page-title-updated", (e) => e.preventDefault());
  protegerNavegacion(ventana.webContents);
  app.on("web-contents-created", (_e, wc) => {
    if (wc !== ventana.webContents) protegerNavegacion(wc);
  });
  ventana.webContents.on("did-fail-load", (_e, codigo, _desc, url, principal) => {
    if (principal && codigo !== -3) {
      ventana.loadFile(path.join(__dirname, "sin-conexion.html"), { query: { volver: url || INICIO } });
    }
  });
  ventana.loadURL(INICIO);
}

// --- Impresión directa ------------------------------------------------------
// La página del ERP (y solo ella) puede listar impresoras e imprimir PDFs sin
// diálogo. El puente en localhost:9731 da lo mismo al ERP abierto en Chrome en
// esta PC mientras la app está abierta.
function desdeErp(evento) {
  try {
    return new URL(evento.senderFrame.url).origin === BASE.origin;
  } catch {
    return false;
  }
}

function instalarImpresion() {
  ipcMain.handle("rysa:impresoras", async (evento) => {
    if (!desdeErp(evento)) throw new Error("No permitido");
    return listarImpresoras(ventana.webContents);
  });
  ipcMain.handle("rysa:imprimir", async (evento, opciones) => {
    if (!desdeErp(evento)) return { ok: false, error: "No permitido" };
    return imprimirPdf(opciones || {});
  });
  iniciarPuente({
    origen: BASE.origin,
    version: app.getVersion(),
    listar: () => listarImpresoras(ventana.webContents),
    imprimir: imprimirPdf,
  });
}

// --- Menú (oculto; se muestra con Alt) --------------------------------------
async function mostrarEstadoCache() {
  const { archivos, bytes } = await cache.tamano();
  const s = cache.stats;
  await dialog.showMessageBox(ventana, {
    type: "info",
    title: "Caché local",
    message: "Caché local de imágenes y archivos",
    detail:
      `Carpeta de datos: ${DATOS}\n\n` +
      `Archivos en disco: ${archivos} (${(bytes / 1048576).toFixed(1)} MB)\n\n` +
      `En esta sesión:\n` +
      `  Desde disco: ${s.hit + s.stale}\n` +
      `  Descargados y guardados: ${s.miss}\n` +
      `  Revalidados en segundo plano: ${s.stale}`,
  });
}

async function vaciarCache() {
  const { response } = await dialog.showMessageBox(ventana, {
    type: "question",
    buttons: ["Vaciar", "Cancelar"],
    defaultId: 1,
    cancelId: 1,
    title: "Vaciar caché",
    message: "¿Borrar las imágenes guardadas en esta PC?",
    detail: "Se volverán a descargar del servidor conforme se usen. La sesión no se cierra.",
  });
  if (response !== 0) return;
  await cache.vaciar();
  await session.defaultSession.clearCache();
  ventana.webContents.reloadIgnoringCache();
}

function crearMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Archivo",
      submenu: [
        { label: "Ir al inicio", accelerator: "Alt+Home", click: () => ventana.loadURL(INICIO) },
        { role: "reload", label: "Recargar" },
        { type: "separator" },
        { role: "quit", label: "Salir" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
        { role: "resetZoom", label: "Tamaño normal" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pantalla completa" },
        { role: "toggleDevTools", label: "Herramientas de desarrollo" },
      ],
    },
    {
      label: "Caché",
      submenu: [
        { label: "Estado de la caché…", click: mostrarEstadoCache },
        { label: "Abrir carpeta de datos", click: () => shell.openPath(DATOS) },
        { type: "separator" },
        { label: "Vaciar caché de imágenes…", click: vaciarCache },
      ],
    },
  ]);
}

// --- Actualizaciones --------------------------------------------------------
// Se publica latest.yml + instalador en la URL "publish" de package.json.
// Mientras no exista, la comprobación falla en silencio.
function buscarActualizacion() {
  if (!app.isPackaged || process.env.RYSA_SIN_ACTUALIZAR === "1") return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.logger = null;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch {
    /* electron-updater no disponible */
  }
}

app.on("second-instance", () => {
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.focus();
});

app.whenReady().then(() => {
  if (!instanciaPrincipal) return;
  instalarCache(session.defaultSession);
  Menu.setApplicationMenu(crearMenu());
  crearVentana();
  instalarImpresion();
  buscarActualizacion();
});

app.on("window-all-closed", () => app.quit());
