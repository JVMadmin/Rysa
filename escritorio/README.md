# RYSA ERP para escritorio (Windows)

App nativa de Windows que abre **solo el ERP** de `https://gruporysa.com`
(`/login` y `/app/...`), con caché local de imágenes de producto y archivos
estáticos en la carpeta que se elige al instalar.

## Stack elegido: Electron (y no Tauri 2)

| | Tauri 2 | Electron |
|---|---|---|
| Instalador | ~5–10 MB | ~108 MB (medido: `RYSA-ERP-Setup-1.0.0.exe`) |
| RAM con el ERP abierto | ~120–200 MB (WebView2 también es Chromium multiproceso) | ~150–250 MB |
| Motor web | WebView2 del sistema. Windows 10 actualizado ya lo trae; si falta, el instalador lo descarga | Chromium incluido; no depende de lo que tenga la PC |
| Interceptar `https://gruporysa.com/...` y responder desde disco | No hay API pública para URLs remotas: hay que ir a COM de WebView2 (`WebResourceRequested`) a mano | `session.protocol.handle("https")`, la API oficial |
| Elegir la carpeta de datos en el instalador | Plantilla NSIS propia | Macro `customPageAfterChangeDir` de electron-builder |
| Auto-actualización | `tauri-plugin-updater` | `electron-updater` (proveedor genérico) |
| Compilar en esta PC | Requiere Rust **y** Visual Studio Build Tools + Windows SDK (~5 GB, con permisos de administrador). Aquí no están | Solo Node.js, que ya está |

Tauri gana en tamaño del instalador. Pero lo que más importa aquí es el
rendimiento, y ese depende de servir las imágenes desde disco sin rodeos.
Electron lo hace con una API oficial y estable, y la app se compila en esta PC
sin instalar herramientas de sistema. La RAM es parecida en los dos, porque
WebView2 también es Chromium. Los ~100 MB extra del instalador se descargan una
sola vez.

## Qué hace

- **Solo el ERP.** Abre `https://gruporysa.com/app` (o `/login` si no hay
  sesión). Cualquier ruta del sitio público (`/`, `/productos`, `/facturacion`,
  ...) se redirige a `/app`, también cuando la navegación es interna del SPA.
  Los enlaces a otros dominios, `mailto:` y `tel:` se abren en el navegador o la
  app del sistema. Los PDFs y tickets del ERP se abren en otra ventana de la app.
- **Caché en disco** (`src/cache.js`), en `<carpeta de datos>\cache\gruporysa.com\...`:

  | Ruta | Regla |
  |---|---|
  | `/static/js|css|media/*` (nombres con hash de CRA) | Inmutable: siempre desde disco |
  | `/api/files/uploads/<uuid32>.webp` (fotos subidas desde el ERP) | Inmutable: siempre desde disco |
  | `/api/files/uploads/productos|familias|marca/*`, `/brand/*` | Se sirve del disco al instante. Si la copia tiene más de 6 h, se revalida en segundo plano (`If-None-Match`, 304 = sin descarga) |
  | Todo lo demás (API, login, `index.html`, PDFs, documentos) | Directo al servidor, sin caché propia |

  Cada respuesta servida por la app lleva la cabecera `x-rysa-cache: HIT | MISS | STALE`.
  Lo que ya está en disco se ve aunque el servidor no responda.
- **Perfil de Chromium** (sesión, `localStorage`, caché HTTP) en
  `<carpeta de datos>\perfil`. Registros en `<carpeta de datos>\registros`.
- **Menú** (oculto, aparece con **Alt**): Recargar, Zoom, *Caché → Estado de la
  caché* (archivos, MB y aciertos de la sesión), *Abrir carpeta de datos*,
  *Vaciar caché de imágenes*.
- **Una sola instancia**: abrir el acceso directo otra vez trae al frente la ventana abierta.
- Si no hay conexión al arrancar, muestra una pantalla propia y reintenta sola.

## Impresión directa (desde la versión 1.1.0)

El ERP imprime sin diálogo a la impresora de Windows elegida para cada
documento. Cada PC elige en **Configuración → Impresoras → Impresoras de este
equipo** su impresora de tickets y la de carta; se guarda en esa PC.

| Documento | Impresora del cliente | Cómo se imprime |
|---|---|---|
| Ticket | Xprinter XP-N160II (térmica 80 mm, 72 mm útiles) | PDF oficial a tamaño real (`noscale`); el corte lo hace el driver XP-80 |
| Carta, cotización, reportes | Brother DCP-L2660DW (láser) | PDF ajustado a hoja carta (`fit`) |

- **Dentro de la app:** `src/preload.js` expone `window.rysaEscritorio`
  (`version`, `listarImpresoras()`, `imprimir({ impresora, pdf_base64, tipo, copias })`).
  `src/main.js` solo atiende peticiones que vienen del ERP.
- **ERP abierto en Chrome en la misma PC:** mientras la app está abierta,
  `src/puente.js` escucha en `http://127.0.0.1:9731` (`GET /estado`,
  `GET /printers`, `POST /print`). Solo acepta el origen del ERP; cualquier otro
  sitio recibe 403.
- La impresión usa SumatraPDF, incluido en `pdf-to-printer`. Va desempaquetado
  fuera de `app.asar` (`asarUnpack`), porque Windows no puede ejecutarlo desde
  dentro del archivo.
- Sin la app, el ERP usa el diálogo del navegador. Chrome recuerda la última
  impresora elegida.

**Configurar la Xprinter XP-N160II en Windows:** instala el driver XP-80 de
Xprinter. En *Preferencias de impresión* elige papel **80 mm × 297 mm** (o
rollo), márgenes 0 y **cortar al final del documento**. Imprime la hoja de
prueba desde Configuración: la regla de 72 mm debe verse completa.

## Instalador

`RYSA-ERP-Setup-<versión>.exe` (NSIS, en español):

1. Instalar para *mí* o para *todos los usuarios*.
2. **Carpeta de instalación** (por defecto `%LOCALAPPDATA%\Programs\RYSA ERP`).
3. **Carpeta de datos y caché** (por defecto `%LOCALAPPDATA%\RYSA ERP`). Puede
   estar en otro disco.
4. Crea los accesos directos **RYSA ERP** en el escritorio y en el menú Inicio.

La carpeta de datos se guarda en el registro (`HKCU` o `HKLM\Software\GrupoRYSA\RYSA ERP`,
valor `Datos`), así las actualizaciones la conservan, y en `rysa-datos.txt`
junto al `.exe`, que es lo que lee la app. Si se instala para todos los usuarios,
el instalador da permiso de escritura a *Usuarios* sobre esa carpeta.
Al desinstalar **no** se borra la carpeta de datos.

## Compilar

Requisitos: Windows 10/11 x64 y Node.js 20 o más nuevo. No hace falta Docker,
Rust ni Visual Studio.

Windows aquí tiene `LongPathsEnabled=0`, así que conviene compilar en una ruta
corta, fuera del repositorio:

```powershell
robocopy escritorio C:\rysa-esc /E /XD node_modules dist prueba-datos
cd C:\rysa-esc
npm ci
# npm 11 no ejecuta scripts de instalación sin aprobación; el de Electron baja su binario:
node node_modules/electron/install.js
npm run instalador        # → dist\RYSA-ERP-Setup-1.0.0.exe
```

Otros comandos:

- `npm run iniciar`: abre la app sin instalar (Electron de desarrollo). Variables
  opcionales: `RYSA_DATOS` (carpeta de datos), `RYSA_URL` (otro servidor, p. ej.
  uno de pruebas).
- `npm run iconos`: regenera `recursos/icono.ico`, `icono-256.png` e
  `instalador-lateral.bmp` desde el isotipo de la marca
  (`rysa-vendedores/assets/images/icon.png`). El icono es el isotipo GR en relieve
  sobre una placa con sombra, y desde 128 px lleva el título **RYSA ERP**. A 16–64 px
  solo va el isotipo, porque ahí el texto no se alcanza a leer.

El instalador no está firmado. Windows SmartScreen mostrará "Editor desconocido"
hasta firmarlo con un certificado de firma de código (`win.certificateFile` en
`package.json`).

## Verificar la caché

```powershell
cd C:\rysa-esc
node scripts/verificar-cache.mjs                                   # Electron de desarrollo
node scripts/verificar-cache.mjs "$env:LOCALAPPDATA\Programs\RYSA ERP\RYSA ERP.exe"   # app instalada
```

El script abre la app con depuración remota, comprueba que `/productos`
redirige al ERP, pide una foto de producto dos veces (MISS y luego HIT) y
confirma que quedó en disco. Después reinicia la app, recarga ignorando la caché
de Chromium y comprueba que el JS/CSS/fuentes de `/static/` y la foto salen
del disco (`x-rysa-cache: HIT`).

## Cambio en el backend

`GET /api/files/{path}` (`backend/server.py`, función `serve_file`). Antes no
mandaba ninguna cabecera de caché. Ahora:

- `uploads/<uuid32>.webp` → `Cache-Control: public, max-age=31536000, immutable`.
  Ese nombre nunca se reescribe: cada subida genera un uuid nuevo.
- `uploads/productos/*`, `uploads/familias/*`, `uploads/marca/*` →
  `Cache-Control: no-cache` + `ETag`. Esos archivos sí se reemplazan con el mismo
  nombre (`importar_fotos.py`, `importar_familias.py`, logo), así que el navegador
  siempre pregunta, y si no cambiaron recibe `304` sin cuerpo.
- Todo lo demás (PDFs, documentos, `uploads/documentos_cliente/`, ...) queda igual.

El ERP web se ve igual. Solo ahorra descargas repetidas. La app de escritorio
funciona igual sin este cambio, pero con él revalida con 304 en vez de bajar la
imagen completa.

## Actualizaciones automáticas

Ya está configurado `electron-updater` con proveedor genérico
`https://gruporysa.com/escritorio/` (`build.publish` en `package.json`). Para
activarlo:

1. Subir `version` en `package.json` y compilar.
2. Copiar `dist\latest.yml` y `dist\RYSA-ERP-Setup-<versión>.exe` a una carpeta
   del servidor que nginx sirva como estáticos en `/escritorio/`. Hoy esa ruta cae
   en el `index.html` del SPA, así que la comprobación falla en silencio y no
   pasa nada.

La app busca actualizaciones al arrancar, las descarga en segundo plano y las
instala al cerrarse. La carpeta de datos se conserva.
