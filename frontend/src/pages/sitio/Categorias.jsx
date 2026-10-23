import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import SitioLayout from "@/components/sitio/SitioLayout";
import { Cortina, EASE, Revelar, TitularPalabras } from "@/components/sitio/motion";
import { CATEGORIAS, aproximado } from "@/data/categorias";
import { MARCAS_SITIO } from "@/data/marcas";
import { api } from "@/lib/api";
import { Elemento, Escalonar } from "@/components/sitio/motion";

export default function Categorias() {
  useEffect(() => { document.title = "Productos — Grupo RYSA"; window.scrollTo(0, 0); }, []);
  // Marcas con productos activos (conteo real del inventario).
  const [conteo, setConteo] = useState({});
  useEffect(() => {
    api.get("/publico/marcas").then((r) => setConteo(Object.fromEntries((r.data || []).map((m) => [m.slug, m.productos])))).catch(() => {});
  }, []);
  const marcas = MARCAS_SITIO.filter((m) => !Object.keys(conteo).length || conteo[m.slug]);

  return (
    <SitioLayout>
      <section aria-labelledby="cat-titulo" className="grafito grano relative pt-[72px] text-white">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1240px] px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
          <nav aria-label="Ruta" className="text-sm text-slate-300"><Link to="/" className="hover:text-white">Inicio</Link> <span aria-hidden="true">/</span> Productos</nav>
          <TitularPalabras id="cat-titulo" texto="Nuestros productos" palabra="metal" className="titular-fino mt-6 text-[2.5rem] sm:text-[3.6rem]" />
          <motion.span aria-hidden="true" className="mt-8 block h-px w-20 origin-left bg-brand-500"
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, ease: EASE, delay: 0.4 }} />
          <motion.p className="mt-8 max-w-2xl text-[1.05rem] leading-7 text-slate-300"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.5 }}>
            Seis categorías que cubren lo que consume un negocio de alimentos, una tienda o un hogar. Pregunta por cualquier
            artículo aunque no lo veas aquí: nuestro inventario es más amplio que lo que cabe en una página.
          </motion.p>
        </div>
      </section>

      {/* Compra por marca: cada una abre su catálogo con precios RYSA */}
      <section aria-labelledby="marcas-titulo" className="papel border-b border-slate-200">
        <div className="mx-auto max-w-[1240px] px-5 py-14 sm:px-8 sm:py-16">
          <h2 id="marcas-titulo" className="flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-brand-600"><span className="h-px w-10 bg-brand-500" aria-hidden="true" />Compra por marca</h2>
          <Escalonar as="ul" paso={0.04} className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {marcas.map((m) => (
              <Elemento as="li" key={m.slug} y={14}>
                <Link to={`/productos/marca/${m.slug}`}
                  className="group flex h-full flex-col items-center justify-between gap-3 rounded-sm border border-slate-200 bg-white p-4 text-center transition-all hover:-translate-y-0.5 hover:border-carbon-900 hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
                  <span className="flex h-14 w-full items-center justify-center">
                    {m.logo
                      ? <img src={m.logo} alt="" className="max-h-12 max-w-[85%] object-contain opacity-70 grayscale transition duration-300 group-hover:opacity-100 group-hover:grayscale-0" />
                      : <span className="titular-fino text-[1.35rem] text-slate-500 transition-colors group-hover:text-carbon-900">{m.nombre}</span>}
                  </span>
                  <span className="text-xs text-slate-500">{m.logo ? `${m.nombre} · ` : ""}{conteo[m.slug] ? `${conteo[m.slug]} productos` : "Ver catálogo"}</span>
                </Link>
              </Elemento>
            ))}
          </Escalonar>
        </div>
      </section>

      <section aria-label="Categorías" className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 sm:py-24">
        <ol className="border-t border-slate-200">
          {CATEGORIAS.map((cat, i) => (
            <li key={cat.slug} className="border-b border-slate-200">
              <Link to={`/productos/${cat.slug}`}
                className="group relative grid gap-6 py-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600 sm:py-10 md:grid-cols-[260px_1fr_auto] md:items-center md:gap-10">
                <span className="absolute -bottom-px left-0 h-px w-0 bg-brand-600 transition-all duration-700 ease-out-rysa group-hover:w-full" aria-hidden="true" />
                <Cortina src={cat.imagen} loading="lazy" className="aspect-[4/3] rounded-sm bg-slate-100"
                  imgClassName="transition-transform duration-[1200ms] ease-out-rysa group-hover:scale-105" delay={0.05} />
                <Revelar delay={0.1}>
                  <p className="font-display text-xs tabular-nums uppercase tracking-[0.2em] text-brand-600">{String(i + 1).padStart(2, "0")} · {aproximado(cat.articulos)} artículos</p>
                  <h2 className="titular-fino mt-3 text-[1.75rem] text-carbon-900 transition-transform duration-500 ease-out-rysa group-hover:translate-x-1 sm:text-[2rem]">{cat.nombre}</h2>
                  <p className="mt-3 max-w-2xl text-[0.98rem] leading-6 text-slate-600">{cat.resumen}</p>
                  <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2" aria-label="Tipos de artículo">
                    {cat.tipos.slice(0, 6).map((t) => (
                      <li key={t} className="flex items-center gap-2 text-sm text-slate-600"><span className="h-px w-2.5 bg-brand-500" aria-hidden="true" />{t}</li>
                    ))}
                  </ul>
                </Revelar>
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 text-carbon-900 transition-all duration-500 ease-out-rysa group-hover:border-brand-600 group-hover:bg-brand-600 group-hover:text-white" aria-hidden="true">
                  <ArrowRight className="h-4 w-4 transition-transform duration-500 group-hover:-rotate-45" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </SitioLayout>
  );
}
