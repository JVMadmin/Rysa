import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import SitioLayout from "@/components/sitio/SitioLayout";
import { CATEGORIAS, aproximado } from "@/data/categorias";

export default function Categorias() {
  useEffect(() => { document.title = "Productos — Grupo RYSA"; window.scrollTo(0, 0); }, []);

  return (
    <SitioLayout>
      <section aria-labelledby="cat-titulo" className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-[1240px] px-5 pb-14 pt-14 sm:px-8 sm:pt-20">
          <nav aria-label="Ruta" className="text-sm text-slate-500"><Link to="/" className="hover:text-carbon-900">Inicio</Link> <span aria-hidden="true">/</span> Productos</nav>
          <h1 id="cat-titulo" className="titular-ancho mt-5 max-w-3xl text-[2.4rem] font-extrabold sm:text-display-lg">Nuestros productos</h1>
          <p className="mt-5 max-w-2xl text-[1.075rem] leading-7 text-slate-600">
            Seis categorías que cubren lo que consume un negocio de alimentos, una tienda o un hogar. Pregunta por cualquier
            artículo aunque no lo veas aquí: nuestro inventario es más amplio que lo que cabe en una página.
          </p>
        </div>
      </section>

      <section aria-label="Categorías" className="mx-auto max-w-[1240px] px-5 py-14 sm:px-8 sm:py-20">
        <ol className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
          {CATEGORIAS.map((cat, i) => (
            <li key={cat.slug} className="bg-white">
              <Link to={`/productos/${cat.slug}`}
                className="group grid gap-6 p-5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600 sm:p-7 md:grid-cols-[220px_1fr_auto] md:items-center">
                <div className="aspect-[4/3] overflow-hidden rounded-md bg-slate-100">
                  <img src={cat.imagen} alt="" loading="lazy" decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 ease-out-rysa group-hover:scale-[1.04]" />
                </div>
                <div>
                  <p className="font-display text-sm font-semibold tabular-nums text-brand-600">{String(i + 1).padStart(2, "0")} · {aproximado(cat.articulos)} artículos</p>
                  <h2 className="titular mt-1.5 text-[1.6rem] font-extrabold text-carbon-900">{cat.nombre}</h2>
                  <p className="mt-2 max-w-2xl text-[0.98rem] leading-6 text-slate-600">{cat.resumen}</p>
                  <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tipos de artículo">
                    {cat.tipos.slice(0, 6).map((t) => (
                      <li key={t} className="rounded-sm border border-slate-200 px-2 py-1 text-xs text-slate-600">{t}</li>
                    ))}
                  </ul>
                </div>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-carbon-900 group-hover:text-brand-600">
                  Ver categoría <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </SitioLayout>
  );
}
