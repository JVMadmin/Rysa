import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Search } from "lucide-react";
import { cotizarUrl, useContacto } from "@/components/sitio/SitioLayout";
import { Elemento, Escalonar } from "@/components/sitio/motion";
import { fileUrl, money } from "@/lib/api";
import { marcaPorSlug } from "@/data/marcas";

const POR_PAGINA = 48;

// Rejilla de productos con precio público (Precio 1 con IVA) para las páginas
// de marca y de categoría: búsqueda, filtro por marca y "ver más".
export default function CatalogoProductos({ productos, nombre, marcas = [], mostrarMarca = false }) {
  const c = useContacto();
  const [q, setQ] = useState("");
  const [marca, setMarca] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (productos || []).filter((p) => (!marca || p.marca === marca)
      && (!t || `${p.descripcion} ${p.codigo}`.toLowerCase().includes(t)));
  }, [productos, q, marca]);

  const filtrar = (fn) => (v) => { fn(v); setLimite(POR_PAGINA); };

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-slate-600">
          {productos ? `${lista.length} producto${lista.length === 1 ? "" : "s"}${nombre ? ` · ${nombre}` : ""} con precio Grupo RYSA` : "Cargando productos…"}
        </p>
        <label className="relative block w-full sm:w-80">
          <span className="sr-only">Buscar en {nombre}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={q} onChange={(e) => filtrar(setQ)(e.target.value)} placeholder={`Buscar en ${nombre || "el catálogo"}`}
            className="h-11 w-full rounded-sm border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-carbon-900 focus:outline-none" />
        </label>
      </div>

      {marcas.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filtrar por marca">
          {[{ slug: "", nombre: "Todas" }, ...marcas].map((m) => (
            <button key={m.slug || "todas"} type="button" onClick={() => filtrar(setMarca)(m.slug)} aria-pressed={marca === m.slug}
              className={`h-9 rounded-full border px-4 text-sm transition-colors ${marca === m.slug ? "border-carbon-900 bg-carbon-900 text-white" : "border-slate-300 text-slate-700 hover:border-carbon-900"}`}>
              {m.nombre}{m.productos ? <span className="ml-1.5 text-xs opacity-60">{m.productos}</span> : null}
            </button>
          ))}
        </div>
      )}

      <Escalonar as="ul" paso={0.03} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" key={`${marca}-${lista.length}-${limite}`}>
        {lista.slice(0, limite).map((p) => {
          const m = mostrarMarca && p.marca ? marcaPorSlug(p.marca) : null;
          return (
            <Elemento as="li" key={p.id} y={16} className="group flex flex-col overflow-hidden rounded-sm border border-slate-200 bg-white transition-shadow hover:shadow-card-lg">
              <div className="relative flex aspect-square items-center justify-center bg-[#F6F5F2]">
                {p.imagen ? (
                  <img src={fileUrl(p.imagen)} alt={p.descripcion} loading="lazy" decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : (
                  <span className="titular-fino px-4 text-center text-[1.35rem] text-slate-400">{m?.nombre || nombre}</span>
                )}
                {p.ilustrativa && <span className="absolute left-2 top-2 rounded-sm bg-white/90 px-2 py-0.5 text-[0.68rem] text-slate-600">Imagen ilustrativa</span>}
              </div>
              <div className="flex flex-1 flex-col p-4">
                {m && <Link to={`/productos/marca/${m.slug}`} className="mb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-brand-600 hover:underline">{m.nombre}</Link>}
                <h3 className="text-[0.95rem] font-medium leading-snug text-carbon-900">{p.descripcion}</h3>
                <p className="mt-1 text-xs text-slate-500">{p.codigo} · {p.unidad}</p>
                <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                  <div>
                    <div className="text-2xs uppercase tracking-[0.14em] text-slate-500">Precio con IVA</div>
                    <div className="font-display text-xl font-bold text-carbon-900">{money(p.precio)}</div>
                  </div>
                  <a href={cotizarUrl(c, `${p.descripcion} (${p.codigo})`)} target={c.waUrl ? "_blank" : undefined} rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-sm bg-brand-600 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-700"
                    aria-label={`Cotizar ${p.descripcion}`}>
                    <MessageCircle className="h-3.5 w-3.5" /> Cotizar
                  </a>
                </div>
              </div>
            </Elemento>
          );
        })}
      </Escalonar>

      {lista.length > limite && (
        <div className="mt-10 flex justify-center">
          <button type="button" onClick={() => setLimite(limite + POR_PAGINA)}
            className="h-12 rounded-sm border border-carbon-900/30 px-7 text-sm font-medium text-carbon-900 transition-colors hover:border-carbon-900 hover:bg-carbon-900 hover:text-white">
            Ver más productos ({lista.length - limite})
          </button>
        </div>
      )}
      {productos && lista.length === 0 && <p className="mt-8 text-sm text-slate-600">No encontramos productos con esa búsqueda.</p>}
    </>
  );
}
