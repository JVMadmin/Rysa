import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, ArrowUpRight, FileCheck2, Handshake, Mail, MapPin, MessageCircle, Phone, Route, Tags } from "lucide-react";
import SitioLayout, { cotizarUrl, useContacto } from "@/components/sitio/SitioLayout";
import { CATEGORIAS, TOTAL_ARTICULOS, aproximado } from "@/data/categorias";

// Marcas presentes en el inventario real (ver data/categorias.js). Se muestran
// como texto, sin reproducir logotipos de terceros.
const MARCAS = ["REYMA", "Chiaplast", "INIX", "Politab", "PRIMO", "Aguirey", "Dinastía", "Truper", "Serviplastic", "Garduño", "Cubasa", "Ideal"];

// Ventajas que el propio sistema de Grupo RYSA respalda (listas de precio por
// volumen, facturación CFDI 4.0, cuentas por cobrar y vendedores en ruta).
const VENTAJAS = [
  { icon: Tags, titulo: "Precio por volumen", texto: "Manejamos varias listas de precio: compra por pieza o por mayoreo y paga lo que corresponde a tu volumen." },
  { icon: FileCheck2, titulo: "Factura electrónica", texto: "Emitimos CFDI 4.0 para tus compras, con los datos fiscales de tu negocio." },
  { icon: Handshake, titulo: "Crédito para clientes", texto: "Negocios con compras recurrentes pueden solicitar línea de crédito y abonar a su cuenta." },
  { icon: Route, titulo: "Asesores en ruta", texto: "Nuestros asesores visitan negocios, levantan pedidos y dan seguimiento a cada cliente." },
];

function Seccion({ id, etiqueta, titulo, children, className = "", oscura = false }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-titulo` : undefined} className={`scroll-mt-20 ${className}`}>
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        {etiqueta && (
          <p className={`etiqueta flex items-center gap-3 ${oscura ? "text-brand-400" : "text-brand-600"}`}>
            <span className="h-[2px] w-8 bg-current" aria-hidden="true" />{etiqueta}
          </p>
        )}
        {titulo && <h2 id={id ? `${id}-titulo` : undefined} className={`titular mt-4 max-w-3xl text-[2.1rem] font-extrabold sm:text-display ${oscura ? "text-white" : "text-carbon-900"}`}>{titulo}</h2>}
        {children}
      </div>
    </section>
  );
}

function TarjetaCategoria({ cat, indice, grande = false }) {
  return (
    <Link to={`/productos/${cat.slug}`}
      className={`group relative isolate flex flex-col justify-end overflow-hidden rounded-lg bg-carbon-900 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${grande ? "min-h-[420px] lg:min-h-[520px]" : "min-h-[300px]"}`}>
      <img src={cat.imagen} alt="" loading="lazy" decoding="async"
        className="absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-700 ease-out-rysa group-hover:scale-[1.04]" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-carbon-900 via-carbon-900/55 to-carbon-900/0" />
      <span className="absolute left-5 top-5 font-display text-sm font-semibold tabular-nums text-white/80">{String(indice + 1).padStart(2, "0")}</span>
      <div className="p-6 sm:p-7">
        <p className="etiqueta text-white/70">{aproximado(cat.articulos)} artículos</p>
        <h3 className={`titular mt-2 font-extrabold ${grande ? "text-[1.9rem] sm:text-[2.3rem]" : "text-[1.45rem]"}`}>{cat.nombre}</h3>
        <p className={`mt-3 max-w-md text-[0.95rem] leading-6 text-white/80 ${grande ? "" : "line-clamp-2"}`}>{cat.resumen}</p>
        <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white">
          Ver categoría <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
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

  return (
    <SitioLayout>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-titulo" className="relative bg-carbon-900 text-white">
        <div className="mx-auto grid max-w-[1240px] lg:grid-cols-[1.05fr_.95fr]">
          <div className="relative z-10 px-5 pb-14 pt-14 sm:px-8 sm:pt-20 lg:pb-24 lg:pr-12 lg:pt-28">
            <p className="etiqueta flex items-center gap-3 text-brand-400 animate-fade-up">
              <span className="h-[2px] w-8 bg-current" aria-hidden="true" />Plásticos · Empaques · Desechables · Suministros
            </p>
            <h1 id="hero-titulo" className="titular-ancho mt-6 text-[2.6rem] font-extrabold leading-[0.98] sm:text-display-lg lg:text-display-xl animate-fade-up [animation-delay:60ms]">
              Lo que tu negocio usa a diario, en un solo lugar.
            </h1>
            <p className="mt-6 max-w-lg text-[1.075rem] leading-7 text-slate-300 animate-fade-up [animation-delay:120ms]">
              Desechables, bolsas, limpieza, recipientes, repostería y ferretería para negocios y hogares.
              Surtimos por pieza o por mayoreo.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row animate-fade-up [animation-delay:180ms]">
              <Link to="/productos" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brand-600 px-6 text-[0.95rem] font-semibold text-white transition-colors hover:bg-brand-700">
                Ver productos <ArrowRight className="h-4 w-4" />
              </Link>
              <a href={cotizarUrl(c)} target={c.waUrl ? "_blank" : undefined} rel="noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-white/25 px-6 text-[0.95rem] font-semibold text-white transition-colors hover:border-white hover:bg-white hover:text-carbon-900">
                Pedir cotización
              </a>
            </div>
            <dl className="mt-14 grid max-w-lg grid-cols-3 gap-6 border-t border-white/10 pt-7">
              <div><dt className="text-xs text-slate-300">Artículos</dt><dd className="titular mt-1 text-2xl font-bold tabular-nums">+{(Math.floor((TOTAL_ARTICULOS - 1) / 100) * 100).toLocaleString("es-MX")}</dd></div>
              <div><dt className="text-xs text-slate-300">Categorías</dt><dd className="titular mt-1 text-2xl font-bold tabular-nums">{CATEGORIAS.length}</dd></div>
              <div><dt className="text-xs text-slate-300">Venta</dt><dd className="titular mt-1 text-[1.05rem] font-bold leading-tight sm:text-lg">Pieza y<br />mayoreo</dd></div>
            </dl>
          </div>
          <div className="relative min-h-[320px] sm:min-h-[420px] lg:min-h-full">
            <img src="/images/categorias/hero.webp" alt="Cubetas, palanganas y una escoba de plástico en colores rojo, naranja y amarillo"
              width="2400" height="1600" fetchpriority="high"
              className="absolute inset-0 h-full w-full object-cover lg:[clip-path:polygon(8%_0,100%_0,100%_100%,0_100%)]" />
            <div className="absolute inset-y-0 left-0 hidden w-24 bg-gradient-to-r from-carbon-900 to-transparent lg:block" aria-hidden="true" />
            <Link to="/productos/recipientes" className="absolute bottom-5 right-5 inline-flex items-center gap-2 rounded-md bg-white/95 px-3.5 py-2 text-xs font-semibold text-carbon-900 shadow-raised backdrop-blur transition-colors hover:bg-white">
              Recipientes y artículos plásticos <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Categorías ───────────────────────────────────────────────── */}
      <Seccion id="productos" etiqueta="Productos" titulo="Seis líneas para surtir tu negocio completo." className="py-20 sm:py-28">
        <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <p className="max-w-xl text-[1.05rem] leading-7 text-slate-600">
            Categorías armadas a partir de nuestro inventario real. Entra a cada una para ver los tipos de artículo y las marcas que manejamos.
          </p>
          <Link to="/productos" className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-carbon-900 underline-offset-4 hover:text-brand-600 hover:underline">
            Todas las categorías <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-7"><TarjetaCategoria cat={CATEGORIAS[0]} indice={0} grande /></div>
          <div className="lg:col-span-5"><TarjetaCategoria cat={CATEGORIAS[1]} indice={1} grande /></div>
          {CATEGORIAS.slice(2).map((cat, i) => (
            <div key={cat.slug} className="lg:col-span-3"><TarjetaCategoria cat={cat} indice={i + 2} /></div>
          ))}
        </div>
      </Seccion>

      {/* ── Marcas ───────────────────────────────────────────────────── */}
      <section aria-labelledby="marcas-titulo" className="border-y border-slate-200 bg-slate-50 py-12">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <h2 id="marcas-titulo" className="etiqueta text-slate-500">Marcas que encuentras con nosotros</h2>
          <ul className="mt-6 flex flex-wrap gap-x-9 gap-y-4">
            {MARCAS.map((m) => (
              <li key={m} className="titular text-[1.35rem] font-bold text-slate-500 transition-colors hover:text-carbon-900">{m}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Ventajas ─────────────────────────────────────────────────── */}
      <Seccion etiqueta="Cómo trabajamos" titulo="Compra como negocio, no como cliente de paso." className="py-20 sm:py-28">
        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          {VENTAJAS.map(({ icon: Icon, titulo, texto }) => (
            <article key={titulo} className="bg-white p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-md bg-brand-50 text-brand-600"><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <h3 className="titular mt-6 text-[1.2rem] font-bold">{titulo}</h3>
              <p className="mt-2.5 text-[0.95rem] leading-6 text-slate-600">{texto}</p>
            </article>
          ))}
        </div>
      </Seccion>

      {/* ── Nosotros ─────────────────────────────────────────────────── */}
      <section id="nosotros" aria-labelledby="nosotros-titulo" className="scroll-mt-20 bg-carbon-900 text-white">
        <div className="mx-auto grid max-w-[1240px] items-stretch lg:grid-cols-2">
          <div className="relative min-h-[300px] lg:min-h-[560px]">
            <img src="/images/categorias/limpieza.webp" alt="Escobas de colores en exhibición" loading="lazy" decoding="async"
              className="absolute inset-0 h-full w-full object-cover" />
          </div>
          <div className="px-5 py-16 sm:px-8 sm:py-20 lg:px-16 lg:py-24">
            <p className="etiqueta flex items-center gap-3 text-brand-400"><span className="h-[2px] w-8 bg-current" aria-hidden="true" />Nosotros</p>
            <h2 id="nosotros-titulo" className="titular mt-4 text-[2rem] font-extrabold sm:text-[2.6rem]">Un mostrador que conoce lo que se vende en tu negocio.</h2>
            <div className="mt-6 space-y-4 text-[1.05rem] leading-7 text-slate-300">
              <p>
                Grupo RYSA comercializa plásticos, empaques, desechables y suministros. Reunimos en un mismo lugar lo que una fonda,
                una tienda, una pastelería o un taller compran cada semana, para que no tengas que recorrer varios proveedores.
              </p>
              <p>
                Atendemos tanto al cliente que necesita unas piezas como al negocio que surte por caja, con precio según su volumen
                y factura electrónica.
              </p>
            </div>
            <Link to="/productos" className="mt-9 inline-flex items-center gap-2 border-b-2 border-brand-500 pb-1.5 text-sm font-semibold text-white transition-colors hover:text-brand-400">
              Conoce nuestras categorías <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Contacto ─────────────────────────────────────────────────── */}
      <Seccion id="contacto" etiqueta="Contacto" titulo="Cuéntanos qué necesitas y te cotizamos." className="py-20 sm:py-28">
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
          <div>
            <p className="max-w-xl text-[1.05rem] leading-7 text-slate-600">
              Envíanos la lista de artículos y cantidades. Te respondemos con disponibilidad, precio según volumen y tiempos de entrega.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {c.waUrl && (
                <a href={cotizarUrl(c)} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brand-600 px-6 text-[0.95rem] font-semibold text-white transition-colors hover:bg-brand-700">
                  <MessageCircle className="h-4 w-4" /> Cotizar por WhatsApp
                </a>
              )}
              {c.correo && (
                <a href={`mailto:${c.correo}?subject=${encodeURIComponent("Cotización — Grupo RYSA")}`}
                  className={`inline-flex h-12 items-center justify-center gap-2 rounded-md px-6 text-[0.95rem] font-semibold transition-colors ${c.waUrl ? "border border-slate-300 text-carbon-900 hover:border-carbon-900" : "bg-brand-600 text-white hover:bg-brand-700"}`}>
                  <Mail className="h-4 w-4" /> Escribir correo
                </a>
              )}
            </div>
          </div>
          <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {c.correo && <div className="flex items-start gap-4 p-5"><Mail className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden="true" /><div><dt className="text-xs text-slate-500">Correo</dt><dd className="mt-0.5 font-medium"><a href={c.mailUrl} className="hover:text-brand-600">{c.correo}</a></dd></div></div>}
            {c.telefono && <div className="flex items-start gap-4 p-5"><Phone className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden="true" /><div><dt className="text-xs text-slate-500">Teléfono</dt><dd className="mt-0.5 font-medium"><a href={c.telUrl} className="hover:text-brand-600">{c.telefono}</a></dd></div></div>}
            {c.waUrl && <div className="flex items-start gap-4 p-5"><MessageCircle className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden="true" /><div><dt className="text-xs text-slate-500">WhatsApp</dt><dd className="mt-0.5 font-medium"><a href={c.waUrl} target="_blank" rel="noreferrer" className="hover:text-brand-600">{c.whatsapp}</a></dd></div></div>}
            {c.ubicacion && <div className="flex items-start gap-4 p-5"><MapPin className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden="true" /><div><dt className="text-xs text-slate-500">Ubicación</dt><dd className="mt-0.5 font-medium">{c.ubicacion}</dd></div></div>}
            {c.horario && <div className="p-5 text-sm text-slate-600">{c.horario}</div>}
          </dl>
        </div>
      </Seccion>
    </SitioLayout>
  );
}
