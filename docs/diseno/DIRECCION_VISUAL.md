# Dirección visual — Grupo RYSA

Documento vivo del sistema visual compartido por el sitio público y el ERP.
Fecha de definición: 2026-10-20.

## 1. De dónde sale (investigación)

**Marca.** El logotipo oficial es negro: "GRUPO / RYSA" en una grotesca ancha y pesada, con ilustraciones de línea de los productos y el giro "PLÁSTICOS • EMPAQUES • DESECHABLES • SUMINISTROS". El isotipo "GR" combina **carbón `#1F2023`** y **rojo `#CF090B`**, ambos medidos sobre `isotipo1.png`. El terracota `#C1401E` que usaba el ERP no proviene de la marca.

**Catálogo real** (2,260 productos activos, consulta de solo lectura del 2026-10-20). El campo `linea` contiene la **marca o fabricante**, no la familia (REYMA 192, INIX 122, Aguirey 67, Chiaplast 67, Politab 35, Primo 33, Dinastía 24…). La familia se deduce de la descripción:

| Categoría del sitio | Artículos | Marcas en inventario |
|---|---|---|
| Desechables para alimentos | 550 | REYMA, INIX, PRIMO, Garduño, Serviplastic |
| Bolsas, rollos y película | 427 | Chiaplast, Politab, REYMA, Dinastía, Serviplastic, Coplasur |
| Ferretería y campo | 210 | Truper, Fiero, Bellota, Philips |
| Repostería y presentación | 179 | Garduño |
| Limpieza e higiene | 157 | Aguirey, Ideal, Perico |
| Recipientes y artículos plásticos | 121 | Cubasa, Aguirey |
| Otros, principalmente abarrotes (no se publican) | 616 | Electrolit, Coca-Cola, La Sierra… |

Ojo con la terminología del inventario: **BISAGRA** es el *contenedor desechable con tapa de bisagra* (INIX), no un herraje; **ASA** es la *bolsa tipo camiseta*. Las reglas de clasificación están en `frontend/src/data/categorias.js` (comentario de cabecera).

Unidad: pieza. Precio mediano: $69 (el 50 % central entre $32 y $287).

**Fotografía.** No hay fotos reales de producto: las 1,500 `imagen_url` apuntan a **una misma foto genérica de Unsplash**, asignada por `catalog_images.py`, cuyas reglas además son de material eléctrico. Solo hay 1 foto subida. El sitio público trata esas URLs como "sin foto".

## 2. Principios

1. **Mostrador, no folleto.** Un distribuidor de piso y mayoreo: el producto y la información van primero, sin adornos de agencia.
2. **Carbón domina, rojo señala.** El rojo marca acciones primarias, la familia activa y el acento editorial; nunca rellena superficies grandes.
3. **Datos reales o nada.** Familias, marcas y productos salen de la BD. Si falta una foto real se muestra una ficha tipográfica, no una imagen genérica que finja ser el producto.
4. **Un solo sistema.** El sitio público y el ERP comparten tokens, tipografía y componentes base.

## 3. Paleta

Medida sobre los logos oficiales (isotipo "GR" y logotipo a color). El gris del isotipo **no es negro**: es un grafito metálico que va de `#494A4E` (brillo) a `#1F2024`; el rojo va de `#EB0F11` (brillo) a `#CD0708` (base), con sombra `#950000`. Las superficies oscuras usan el grafito medio, no el tono más profundo, para no sentirse pesadas. (Se descartaron el negro casi puro y una variante con vino tinto.)

| Token | Valor | Uso |
|---|---|---|
| `brand-500` | `#EB0F11` | Brillo de la "R": indicador activo, acentos sobre grafito |
| `brand-600` (rojo RYSA) | `#CD0708` | Botón primario, etiquetas, familia activa |
| `brand-700` / `800` | `#A3060A` / `#7A0A0E` | Hover y presionado / sombra |
| `brand-50` / `100` / `300` | `#FDECEC` / `#FBD3D3` / `#F27A7C` | Fondos de selección, badges, etiquetas sobre grafito |
| `carbon-900` (grafito) | `#2E2F34` | Hero, pie, paneles oscuros, botón secundario oscuro |
| `carbon-950` | `#232428` | Menú lateral del ERP |
| `carbon-700` / `800` | `#4A4B50` / `#3D3E43` | Brillo del grafito, hovers |
| Neutros (`slate`) | `#F5F5F6` → `#18191D` | Fondos, bordes y texto. Texto principal `#18191D` |
| `success` / `warning` / `info` | `#15803D` / `#B45309` / `#1D4ED8` | Estados |
| `danger` | `#B42318` | Errores: siempre con icono, para no confundirse con el rojo de marca |

Contraste (WCAG AA): blanco sobre `brand-600` 5.8:1; blanco sobre grafito 900 13.4:1; `slate-200` sobre grafito 9.6:1; `brand-300` sobre grafito 5.0:1; texto `#18191D` sobre blanco 17.6:1.

Logotipo: `logotipo-color.webp` sobre fondos claros (encabezado, login móvil) y `logotipo-Photoroom.png` invertido a blanco sobre grafito.

## 4. Tipografía

| Rol | Familia | Por qué |
|---|---|---|
| Titulares | **Archivo** (variable, eje de ancho 62–125) en ancho **expandido** y pesos 700–900 | Grotesca industrial de Omnibus-Type (Argentina) con soporte completo de español. Su versión expandida dialoga con el "RYSA" ancho del logotipo y con la rotulación de mostrador. |
| Texto, UI, formularios, tablas | **IBM Plex Sans** 400/500/600/700 | Muy legible en pantallas de baja resolución, numerales claros y tabulares (`tnum`) para precios y folios, buena lectura de acentos y textos largos. Evita el par Inter/Outfit genérico. |

Se cargan **localmente** con `@fontsource` (sin Google Fonts).

Escala (rem sobre 16 px; el ERP aplica una densidad de 87.5 %):
`display-xl 4.5` · `display-lg 3.5` · `display 2.75` · `h1 2.125` · `h2 1.625` · `h3 1.25` · `body-lg 1.125` · `body 1` · `sm 0.875` · `xs 0.75` · `2xs 0.6875`.
Altura de línea: titulares 1.02–1.1, texto 1.55. Tracking: titulares expandidos −0.01em; etiquetas en mayúsculas +0.08em.

## 5. Forma y movimiento

- Radios: `sm 4px`, `md 8px`, `lg 12px` (el 20 px anterior era demasiado blando para el giro).
- Sombras: dos niveles (`card`, `raised`) con base carbón.
- Movimiento: 150 ms (hover), 240 ms (entradas), `cubic-bezier(.2,.7,.2,1)`. Se respeta `prefers-reduced-motion`.

## 6. Fotografía

Fotos de uso libre de Unsplash (licencia que permite uso comercial) que corresponden con la familia. Se usan como **imagen representativa de la familia**, nunca como foto de un artículo concreto.

| Uso | Foto | Fuente |
|---|---|---|
| Hero / recipientes | Cubetas y palanganas con escoba | https://unsplash.com/photos/loXX7MAtCqQ |
| Desechables | Vaso y contenedores con tapa | https://unsplash.com/photos/D0FWHT-eW_I |
| Desechables (alt.) | Contenedores para llevar | https://unsplash.com/photos/SRFOOdORhKw |
| Limpieza | Escobas de colores | https://unsplash.com/photos/YEUJcQvIKVU |
| Recipientes (alt.) | Anaquel con cubetas y tinas | https://unsplash.com/photos/vCCWqUr5Y2k |

**Pendientes de foto real:** bolsas, rollos y película; ferretería y herrajes; repostería y presentación; lonas, morrales y sombreros; y todo el catálogo a nivel artículo. Lo ideal es fotografiar el producto propio sobre fondo neutro, en formato 4:3 y de al menos 1600 px.

## 7. Fotos de producto en el ERP

- El ERP ya no muestra las fotos genéricas autoasignadas: `fotoProducto()` en `frontend/src/lib/api.js` las trata como "sin foto".
- **Open Food Facts** (licencia CC BY-SA 3.0): de 633 productos con código EAN, 78 tienen foto. Tras la revisión visual quedan **75 aprobadas**, principalmente bebidas y abarrotes. Plásticos y desechables no aparecen en esa base.
- Herramienta: `backend/scripts/importar_fotos.py`. Por defecto simula; con `--aplicar` descarga, convierte a WebP, guarda localmente y registra `imagen_fuente` (origen, licencia, URL) para la atribución. `--limpiar-genericas` retira las fotos genéricas.
- Para REYMA, Chiaplast, INIX y demás no hay fuente abierta verificable: requieren foto propia o autorización escrita del fabricante.
