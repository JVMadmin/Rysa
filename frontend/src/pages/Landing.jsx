import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ArrowUpRight, FileCheck2, Handshake, Mail, MapPin, MessageCircle, Phone, Route, Tags } from "lucide-react";
import SitioLayout, { BOTON_CONTORNO, BOTON_CONTORNO_CLARO, BOTON_PRIMARIO, cotizarUrl, useContacto } from "@/components/sitio/SitioLayout";
import MosaicoCategorias from "@/components/sitio/MosaicoCategorias";
import { Contador, EASE, Elemento, Escalonar, Parallax, Regla, Revelar, TitularPalabras } from "@/components/sitio/motion";
import { CATEGORIAS, TOTAL_ARTICULOS } from "@/data/categorias";
import { MARCAS_SITIO } from "@/data/marcas";


// Ventajas que el propio sistema de Grupo RYSA respalda (listas de precio por
// volumen, facturación CFDI 4.0, cuentas por cobrar y vendedores en ruta).
const VENTAJAS = [
  { icon: Tags, titulo: "Precio por volumen", texto: "Manejamos varias listas de precio: compra por pieza o por mayoreo y paga lo que corresponde a tu volumen." },
  { icon: FileCheck2, titulo: "Factura electrónica", texto: "Emitimos CFDI 4.0 para tus compras, con los datos fiscales de tu negocio." },
  { icon: Handshake, titulo: "Crédito para clientes", texto: "Negocios con compras recurrentes pueden solicitar línea de crédito y abonar a su cuenta." },
  { icon: Route, titulo: "Asesores en ruta", texto: "Nuestros asesores visitan negocios, levantan pedidos y dan seguimiento a cada cliente." },
];

// Diapositivas del hero: una por categoría; la de recipientes usa la foto principal.
const DIAPOSITIVAS = CATEGORIAS.map((c) => ({
  slug: c.slug,
  nombre: c.nombre,
  imagen: c.slug === "recipientes" ? "/images/categorias/hero.webp" : c.imagen,
  alt: c.slug === "recipientes" ? "Cubetas, palanganas y una escoba de plástico en colores rojo, naranja y amarillo" : c.imagenAlt,
}));
const INICIAL = Math.max(0, DIAPOSITIVAS.findIndex((d) => d.slug === "recipientes"));
const DURACION = 6500;

function Seccion({ id, etiqueta, titulo, children, className = "", oscura = false }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-titulo` : undefined} className={`scroll-mt-20 ${className}`}>
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        {etiqueta && (
          <Revelar as="p" className={`flex items-center gap-4 text-xs uppercase tracking-[0.2em] ${oscura ? "text-brand-300" : "text-brand-600"}`}>
            <Regla ancho="w-10" />{etiqueta}
          </Revelar>
        )}
        {titulo && (
          <Revelar as="h2" delay={0.08} id={id ? `${id}-titulo` : undefined}
            className={`titular-fino mt-5 max-w-3xl text-[2rem] sm:text-[2.75rem] ${oscura ? "text-white" : "text-carbon-900"}`}>
            {titulo}
          </Revelar>
        )}
        {children}
      </div>
    </section>
  );
}

// Fotografía del hero a sangre: cada cambio entra con una cortina y un
// acercamiento lento; las líneas inferiores muestran el avance y permiten elegir.
function HeroGaleria() {
  const reducir = useReducedMotion();
  const [actual, setActual] = useState(INICIAL);
  const [pausa, setPausa] = useState(false);
  const d = DIAPOSITIVAS[actual];

  useEffect(() => {
    if (reducir || pausa) return;
    const t = setTimeout(() => setActual((i) => (i + 1) % DIAPOSITIVAS.length), DURACION);
    return () => clearTimeout(t);
  }, [actual, reducir, pausa]);

  return (
    <div className="relative min-h-[340px] overflow-hidden bg-carbon-950 sm:min-h-[460px] lg:min-h-full"
      onMouseEnter={() => setPausa(true)} onMouseLeave={() => setPausa(false)}>
      <AnimatePresence initial={true}>
        <motion.img key={d.slug} src={d.imagen} alt={d.alt} width="2400" height="1600"
          fetchpriority={actual === INICIAL ? "high" : undefined} decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          initial={{ clipPath: "inset(0 0 0 100%)", scale: 1.14 }}
          animate={{ clipPath: "inset(0 0 0 0%)", scale: 1, transition: { clipPath: { duration: 1.2, ease: EASE }, scale: { duration: DURACION / 1000 + 1.2, ease: "linear" } } }}
          exit={{ opacity: 0.999, transition: { duration: 1.2 } }} />
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-carbon-950/80 via-transparent to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-carbon-950/70 to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-40 bg-gradient-to-r from-[#2C2D32] to-transparent lg:block" aria-hidden="true" />

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 p-5 sm:p-8">
        <AnimatePresence mode="wait">
          <motion.div key={d.slug} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: EASE }}>
            <Link to={`/productos/${d.slug}`} className="group inline-flex items-center gap-3 text-sm text-white">
              <span className="font-display text-xs tabular-nums tracking-[0.2em] text-white/80">
                {String(actual + 1).padStart(2, "0")} / {String(DIAPOSITIVAS.length).padStart(2, "0")}
              </span>
              <span className="border-b border-white/40 pb-0.5 transition-colors group-hover:border-brand-500">{d.nombre}</span>
              <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </motion.div>
        </AnimatePresence>
        <div className="flex gap-2" role="group" aria-label="Elegir fotografía">
          {DIAPOSITIVAS.map((x, i) => (
            <button key={x.slug} type="button" onClick={() => setActual(i)} aria-label={`Mostrar ${x.nombre}`} aria-pressed={i === actual}
              className="group relative h-6 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/30 transition-colors group-hover:bg-white/60" />
              {i === actual && (
                <motion.span key={`${x.slug}-${pausa}`} className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-brand-500"
                  initial={{ width: reducir || pausa ? "100%" : "0%" }} animate={{ width: "100%" }}
                  transition={{ duration: reducir || pausa ? 0 : DURACION / 1000, ease: "linear" }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Banda de marca: el giro del logotipo en letra gigante de contorno que corre
// sola de forma continua (cada línea en sentido contrario) y, además, se
// desplaza un poco con el scroll; en medio, la tira de íconos del logotipo.
function LineaGiro({ x, reversa, children }) {
  const linea = "titular-fino contorno whitespace-nowrap pr-[0.3em] text-[17vw] leading-[0.95] sm:text-[10.5vw]";
  return (
    <motion.div style={{ x }} aria-hidden="true">
      <div className={`marquesina-giro${reversa ? " reversa" : ""}`}>
        <p className={linea}>{children}</p>
        <p className={linea}>{children}</p>
      </div>
    </motion.div>
  );
}

function BandaGiro() {
  const ref = useRef(null);
  const reducir = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x1 = useTransform(scrollYProgress, [0, 1], reducir ? ["0%", "0%"] : ["4%", "-8%"]);
  const x2 = useTransform(scrollYProgress, [0, 1], reducir ? ["0%", "0%"] : ["-8%", "4%"]);
  return (
    <section ref={ref} aria-label="Plásticos, empaques, desechables y suministros" className="grafito grano overflow-hidden py-20 text-white sm:py-28">
      <LineaGiro x={x1}>
        Plásticos · <span className="text-brand-500 [-webkit-text-stroke:0]">Empaques</span> · Desechables · Suministros ·
      </LineaGiro>
      <Revelar className="mx-auto my-12 max-w-[1240px] px-5 sm:my-16 sm:px-8">
        <img src="/brand/iconos-linea.webp" alt="" width="860" height="92" loading="lazy" className="mx-auto w-full max-w-4xl opacity-90" />
      </Revelar>
      <LineaGiro x={x2} reversa>
        Mayoreo · Menudeo · <span className="metal [-webkit-text-stroke:0]">Factura</span> · Crédito ·
      </LineaGiro>
    </section>
  );
}

export default function Landing() {
  const c = useContacto();
  const { hash } = useLocation();

  // Llegadas a /#seccion desde otras páginas del sitio.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [hash]);

  useEffect(() => { document.title = "Grupo RYSA — Plásticos, empaques, desechables y suministros"; }, []);

  const entrar = (delay) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, ease: EASE, delay } });

  return (
    <SitioLayout>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-titulo" className="grafito grano relative text-white">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative grid lg:min-h-[100svh] lg:grid-cols-[1fr_1fr]">
          <div className="flex flex-col justify-center px-5 pb-14 pt-[8.5rem] sm:px-8 sm:pt-[9.5rem] lg:pb-24 lg:pl-[max(2rem,calc((100vw-1240px)/2+2rem))] lg:pr-14">
            <motion.p {...entrar(0)} className="text-xs uppercase tracking-[0.22em] text-brand-300">Mayoreo y menudeo</motion.p>
            <TitularPalabras id="hero-titulo" texto="Lo que tu negocio usa a diario, en un solo lugar." delay={0.1} palabra="metal" resaltar={[8, 9, 10]}
              className="titular-fino mt-6 text-[2.5rem] sm:text-[3.4rem] lg:text-[3.9rem]" />
            <motion.span aria-hidden="true" className="mt-8 block h-px w-20 origin-left bg-brand-500"
              initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, ease: EASE, delay: 0.7 }} />
            <motion.p {...entrar(0.75)} className="mt-8 max-w-md text-[1.05rem] leading-7 text-slate-300">
              Desechables, bolsas, limpieza, recipientes, repostería y ferretería para negocios y hogares.
              Seis categorías, marcas que ya conoces.
            </motion.p>
            <motion.div {...entrar(0.85)} className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link to="/productos" className={BOTON_PRIMARIO}>
                Ver productos <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
              <a href={cotizarUrl(c)} target={c.waUrl ? "_blank" : undefined} rel="noreferrer" className={BOTON_CONTORNO_CLARO}>
                <span className="relative">Pedir cotización</span>
              </a>
            </motion.div>
            <motion.dl {...entrar(1)} className="mt-16 grid max-w-md grid-cols-3 gap-6 border-t border-white/10 pt-7">
              <div><dt className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-300">Artículos</dt>
                <dd className="titular-fino mt-2 text-[1.7rem] tabular-nums"><Contador valor={Math.floor((TOTAL_ARTICULOS - 1) / 100) * 100} prefijo="+" /></dd></div>
              <div><dt className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-300">Categorías</dt>
                <dd className="titular-fino mt-2 text-[1.7rem] tabular-nums"><Contador valor={CATEGORIAS.length} /></dd></div>
              <div><dt className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-300">Venta</dt>
                <dd className="titular-fino mt-2 text-[1.05rem] leading-tight sm:text-lg">Pieza y<br />mayoreo</dd></div>
            </motion.dl>
          </div>
          <HeroGaleria />
        </div>
      </section>

      {/* ── Categorías ───────────────────────────────────────────────── */}
      <Seccion id="productos" etiqueta="Productos" titulo="Seis líneas para surtir tu negocio completo." className="pb-14 pt-24 sm:pb-16 sm:pt-32">
        <Revelar delay={0.12} className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <p className="max-w-xl text-[1.05rem] leading-7 text-slate-600">
            Pasa el cursor sobre cada categoría para ver qué incluye, o entra para conocer los tipos de artículo y las marcas que manejamos.
          </p>
          <Link to="/productos" className="group inline-flex shrink-0 items-center gap-2 border-b border-carbon-900/30 pb-1 text-sm font-medium text-carbon-900 transition-colors hover:border-brand-600 hover:text-brand-600">
            Todas las categorías <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Revelar>
      </Seccion>
      <MosaicoCategorias />

      <BandaGiro />

      {/* ── Marcas ───────────────────────────────────────────────────── */}
      <section aria-labelledby="marcas-titulo" className="papel overflow-hidden border-b border-slate-200 py-14">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <h2 id="marcas-titulo" className="text-xs uppercase tracking-[0.2em] text-slate-500">Marcas que encuentras con nosotros</h2>
        </div>
        <div className="relative mt-7 [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
          <div className="marquesina">
            {[0, 1].map((copia) => (
              <ul key={copia} aria-hidden={copia === 1 ? "true" : undefined} className="flex shrink-0 items-center">
                {/* Logotipo en gris como el texto; a color al pasar el cursor.
                    Cada marca abre su catálogo con precios RYSA. */}
                {MARCAS_SITIO.map((m) => (
                  <li key={m.slug} className="flex items-center gap-10 pr-10">
                    <Link to={`/productos/marca/${m.slug}`} tabIndex={copia === 1 ? -1 : undefined}
                      className="group flex h-12 items-center" aria-label={`Catálogo ${m.nombre}`}>
                      {m.logo ? (
                        <img src={m.logo} alt={m.nombre} loading="lazy"
                          className="h-10 w-auto object-contain opacity-60 grayscale transition duration-300 group-hover:opacity-100 group-hover:grayscale-0" />
                      ) : (
                        <span className="titular-fino whitespace-nowrap text-[1.6rem] text-slate-500 transition-colors duration-300 group-hover:text-carbon-900">{m.nombre}</span>
                      )}
                    </Link>
                    <span className="h-1 w-1 rounded-full bg-brand-500" aria-hidden="true" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </section>

      {/* ── Ventajas ─────────────────────────────────────────────────── */}
      <Seccion etiqueta="Cómo trabajamos" titulo="Compra como negocio, no como cliente de paso." className="py-24 sm:py-32">
        <Escalonar className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {VENTAJAS.map(({ icon: Icon, titulo, texto }, i) => (
            <Elemento as="article" key={titulo} className="group relative border-t border-slate-200 pt-7">
              <span className="absolute -top-px left-0 h-px w-0 bg-brand-600 transition-all duration-700 ease-out-rysa group-hover:w-full" aria-hidden="true" />
              <div className="flex items-center justify-between">
                <Icon className="h-6 w-6 text-brand-600 transition-transform duration-500 ease-out-rysa group-hover:-translate-y-1" strokeWidth={1.5} aria-hidden="true" />
                <span className="font-display text-xs tabular-nums tracking-[0.2em] text-slate-500">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="titular-fino mt-6 text-[1.3rem]">{titulo}</h3>
              <p className="mt-3 text-[0.95rem] leading-6 text-slate-600">{texto}</p>
            </Elemento>
          ))}
        </Escalonar>
      </Seccion>

      {/* ── Nosotros ─────────────────────────────────────────────────── */}
      <section id="nosotros" aria-labelledby="nosotros-titulo" className="grafito grano relative scroll-mt-20 text-white">
        <div className="grid items-stretch lg:grid-cols-2">
          <Parallax src="/images/categorias/limpieza.webp" alt="Escobas de colores en exhibición" loading="lazy"
            className="min-h-[320px] lg:min-h-[620px]" />
          <div className="rejilla relative flex flex-col justify-center px-5 py-20 sm:px-8 lg:py-28 lg:pl-16 lg:pr-[max(2rem,calc((100vw-1240px)/2+2rem))]">
            <Revelar as="p" className="flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-brand-300"><Regla ancho="w-10" />Nosotros</Revelar>
            <Revelar as="h2" delay={0.08} id="nosotros-titulo" className="titular-fino metal mt-5 text-[2rem] sm:text-[2.6rem]">
              Un mostrador que conoce lo que se vende en tu negocio.
            </Revelar>
            <Revelar delay={0.16} className="mt-7 space-y-4 text-[1.05rem] leading-7 text-slate-300">
              <p>
                Grupo RYSA comercializa plásticos, empaques, desechables y suministros. Reunimos en un mismo lugar lo que una fonda,
                una tienda, una pastelería o un taller compran cada semana, para que no tengas que recorrer varios proveedores.
              </p>
              <p>
                Atendemos tanto al cliente que necesita unas piezas como al negocio que surte por caja, con precio según su volumen
                y factura electrónica.
              </p>
            </Revelar>
            <Revelar delay={0.24}>
              <Link to="/productos" className={`mt-10 ${BOTON_CONTORNO_CLARO}`}>
                <span className="relative inline-flex items-center gap-2">Conoce nuestras categorías <ArrowRight className="h-4 w-4" /></span>
              </Link>
            </Revelar>
          </div>
        </div>
      </section>

      {/* ── Contacto ─────────────────────────────────────────────────── */}
      <Seccion id="contacto" etiqueta="Contacto" titulo="Cuéntanos qué necesitas y te cotizamos." className="papel py-24 sm:py-32">
        <div className="mt-12 grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
          <Revelar delay={0.1}>
            <p className="max-w-xl text-[1.05rem] leading-7 text-slate-600">
              Envíanos la lista de artículos y cantidades. Te respondemos con disponibilidad, precio según volumen y tiempos de entrega.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              {c.waUrl && (
                <a href={cotizarUrl(c)} target="_blank" rel="noreferrer" className={BOTON_PRIMARIO}>
                  <MessageCircle className="h-4 w-4" /> Cotizar por WhatsApp
                </a>
              )}
              {c.correo && (
                <a href={`mailto:${c.correo}?subject=${encodeURIComponent("Cotización — Grupo RYSA")}`} className={c.waUrl ? BOTON_CONTORNO : BOTON_PRIMARIO}>
                  <span className="relative inline-flex items-center gap-2"><Mail className="h-4 w-4" /> Escribir correo</span>
                </a>
              )}
            </div>
          </Revelar>
          <Escalonar as="dl" className="border-t border-slate-200">
            {c.correo && <Elemento className="flex items-start gap-4 border-b border-slate-200 py-5"><Mail className="mt-0.5 h-5 w-5 text-brand-600" strokeWidth={1.5} aria-hidden="true" /><div><dt className="text-xs uppercase tracking-[0.14em] text-slate-500">Correo</dt><dd className="mt-1 font-medium"><a href={c.mailUrl} className="hover:text-brand-600">{c.correo}</a></dd></div></Elemento>}
            {c.telefono && <Elemento className="flex items-start gap-4 border-b border-slate-200 py-5"><Phone className="mt-0.5 h-5 w-5 text-brand-600" strokeWidth={1.5} aria-hidden="true" /><div><dt className="text-xs uppercase tracking-[0.14em] text-slate-500">Teléfono</dt><dd className="mt-1 font-medium"><a href={c.telUrl} className="hover:text-brand-600">{c.telefono}</a></dd></div></Elemento>}
            {c.waUrl && <Elemento className="flex items-start gap-4 border-b border-slate-200 py-5"><MessageCircle className="mt-0.5 h-5 w-5 text-brand-600" strokeWidth={1.5} aria-hidden="true" /><div><dt className="text-xs uppercase tracking-[0.14em] text-slate-500">WhatsApp</dt><dd className="mt-1 font-medium"><a href={c.waUrl} target="_blank" rel="noreferrer" className="hover:text-brand-600">{c.whatsapp}</a></dd></div></Elemento>}
            {c.ubicacion && <Elemento className="flex items-start gap-4 border-b border-slate-200 py-5"><MapPin className="mt-0.5 h-5 w-5 text-brand-600" strokeWidth={1.5} aria-hidden="true" /><div><dt className="text-xs uppercase tracking-[0.14em] text-slate-500">Ubicación</dt><dd className="mt-1 font-medium">{c.ubicacion}</dd></div></Elemento>}
            {c.horario && <Elemento className="border-b border-slate-200 py-5 text-sm text-slate-600">{c.horario}</Elemento>}
          </Escalonar>
        </div>
      </Seccion>
    </SitioLayout>
  );
}
