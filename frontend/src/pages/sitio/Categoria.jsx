import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Mail, MessageCircle } from "lucide-react";
import SitioLayout, { cotizarUrl, useContacto } from "@/components/sitio/SitioLayout";
import { CATEGORIAS, aproximado, porSlug } from "@/data/categorias";

export default function Categoria() {
  const { slug } = useParams();
  const cat = porSlug(slug);
  const c = useContacto();

  useEffect(() => {
    if (cat) document.title = `${cat.nombre} — Grupo RYSA`;
    window.scrollTo(0, 0);
  }, [cat]);

  if (!cat) return <Navigate to="/productos" replace />;

  const indice = CATEGORIAS.indexOf(cat);
  const otras = CATEGORIAS.filter((x) => x.slug !== cat.slug);

  return (
    <SitioLayout>
      <section aria-labelledby="categoria-titulo" className="bg-carbon-900 text-white">
        <div className="mx-auto grid max-w-[1240px] lg:grid-cols-2">
          <div className="px-5 pb-14 pt-10 sm:px-8 sm:pt-14 lg:py-24 lg:pr-14">
            <nav aria-label="Ruta" className="text-sm text-slate-400">
              <Link to="/" className="hover:text-white">Inicio</Link> <span aria-hidden="true">/</span>{" "}
              <Link to="/productos" className="hover:text-white">Productos</Link> <span aria-hidden="true">/</span>{" "}
              <span className="text-slate-300">{cat.corto}</span>
            </nav>
            <p className="mt-8 font-display text-sm font-semibold tabular-nums text-brand-400">
              {String(indice + 1).padStart(2, "0")} / {String(CATEGORIAS.length).padStart(2, "0")} · {aproximado(cat.articulos)} artículos
            </p>
            <h1 id="categoria-titulo" className="titular-ancho mt-3 text-[2.3rem] font-extrabold sm:text-display lg:text-display-lg">{cat.nombre}</h1>
            <p className="mt-6 max-w-xl text-[1.075rem] leading-7 text-slate-300">{cat.descripcion}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={cotizarUrl(c, cat.nombre)} target={c.waUrl ? "_blank" : undefined} rel="noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brand-600 px-6 text-[0.95rem] font-semibold text-white transition-colors hover:bg-brand-700">
                {c.waUrl ? <MessageCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />} Cotizar {cat.corto.toLowerCase()}
              </a>
              <Link to="/productos" className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-white/25 px-6 text-[0.95rem] font-semibold text-white transition-colors hover:border-white">
                <ArrowLeft className="h-4 w-4" /> Todas las categorías
              </Link>
            </div>
          </div>
          <div className="relative min-h-[300px] sm:min-h-[380px]">
            <img src={cat.imagen} alt={cat.imagenAlt} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            <p className="absolute bottom-3 right-3 rounded bg-carbon-900/70 px-2 py-1 text-[0.7rem] text-white/80">Imagen representativa de la categoría</p>
          </div>
        </div>
      </section>

      <section aria-label="Detalle de la categoría" className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid gap-14 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="etiqueta text-brand-600">Qué encuentras</h2>
            <ul className="mt-6 grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
              {cat.tipos.map((t) => (
                <li key={t} className="flex items-start gap-3 border-b border-slate-200 pb-3.5 text-[1.02rem]">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />{t}
                </li>
              ))}
            </ul>
            <p className="mt-8 max-w-xl text-sm leading-6 text-slate-500">
              Manejamos varias medidas, presentaciones y empaques de cada artículo. Si buscas algo específico, envíanos la
              descripción o el código y te confirmamos disponibilidad.
            </p>
          </div>
          <aside className="space-y-8">
            {cat.marcas?.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-6">
                <h2 className="etiqueta text-slate-500">Marcas en esta categoría</h2>
                <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                  {cat.marcas.map((m) => <li key={m} className="titular text-lg font-bold text-carbon-900">{m}</li>)}
                </ul>
              </div>
            )}
            {cat.imagenSecundaria && (
              <figure className="overflow-hidden rounded-lg">
                <img src={cat.imagenSecundaria} alt={cat.imagenSecundariaAlt} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
              </figure>
            )}
          </aside>
        </div>
      </section>

      <section aria-labelledby="otras-titulo" className="border-t border-slate-200 bg-slate-50 py-14 sm:py-16">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <h2 id="otras-titulo" className="titular text-[1.5rem] font-extrabold">Otras categorías</h2>
          <ul className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {otras.map((o) => (
              <li key={o.slug}>
                <Link to={`/productos/${o.slug}`} className="group flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
                  <img src={o.imagen} alt="" loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover" />
                  <span className="flex flex-1 items-center justify-between gap-3 p-4 text-[0.95rem] font-semibold text-carbon-900">
                    {o.nombre}<ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </SitioLayout>
  );
}
