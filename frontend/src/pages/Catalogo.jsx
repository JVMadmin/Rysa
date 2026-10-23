import { useEffect, useMemo, useState } from "react";
import { api, money, fotoProducto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Images, Search, PackageX, RefreshCw, ArrowLeft, LayoutGrid } from "lucide-react";
import { CATEGORIAS } from "@/data/categorias";
import { MARCAS_SITIO, marcaPorSlug } from "@/data/marcas";

const OTROS = { slug: "otros", nombre: "Otros productos", corto: "Otros", imagen: "/images/categorias/hero.webp" };
const POR_PAGINA = 60;

/**
 * CATÁLOGO — módulo de SOLO CONSULTA compartido por vendedor de piso, cajera
 * y vendedor de campo (§3.8). Se carga todo el inventario una vez; primero se
 * elige la categoría (las mismas del sitio) y luego se filtra por marca (con
 * su logotipo) y por texto. Muestra imagen, nombre, precio público y
 * existencia. NUNCA costo ni utilidad.
 */
export default function Catalogo() {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");          // "" = portada de categorías; "todas" = todo
  const [marca, setMarca] = useState("");
  const [soloConExistencia, setSoloConExistencia] = useState(false);
  const [limite, setLimite] = useState(POR_PAGINA);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/catalogo");
      setItems(data || []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { setLimite(POR_PAGINA); }, [cat, marca, q, soloConExistencia]);

  const catDe = (p) => p.categoria_sitio || "otros";
  const base = useMemo(() => (items || []).filter((p) => !soloConExistencia || Number(p.existencia) > 0), [items, soloConExistencia]);

  const conteoCat = useMemo(() => {
    const c = {};
    base.forEach((p) => { c[catDe(p)] = (c[catDe(p)] || 0) + 1; });
    return c;
  }, [base]);
  const portada = [...CATEGORIAS, OTROS].filter((c) => conteoCat[c.slug]);

  const enCategoria = useMemo(() => base.filter((p) => !cat || cat === "todas" || catDe(p) === cat), [base, cat]);
  const marcas = useMemo(() => {
    const c = {};
    enCategoria.forEach((p) => { if (p.marca) c[p.marca] = (c[p.marca] || 0) + 1; });
    return MARCAS_SITIO.filter((m) => c[m.slug]).map((m) => ({ ...m, n: c[m.slug] }));
  }, [enCategoria]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return enCategoria.filter((p) => (!marca || p.marca === marca)
      && (!t || `${p.nombre} ${p.codigo}`.toLowerCase().includes(t)));
  }, [enCategoria, marca, q]);

  const verPortada = !cat && !q.trim();
  const catActual = [...CATEGORIAS, OTROS].find((c) => c.slug === cat);
  const elegir = (slug) => { setCat(slug); setMarca(""); };

  return (
    <div className="space-y-5" data-testid="catalogo-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2">
            <Images className="w-6 h-6 text-brand-600" /> Catálogo
          </h1>
          <p className="text-slate-500 text-sm">
            {items ? `${base.length} productos cargados${verPortada ? " · elige una categoría" : ` · ${filtrados.length} en esta vista`}` : "Cargando productos…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSoloConExistencia((v) => !v)}
            className={`px-3 h-9 rounded-full text-sm border font-medium ${soloConExistencia ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            data-testid="catalogo-solo-existencia">Solo con existencia</button>
          <Button variant="outline" onClick={load} data-testid="catalogo-refresh">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        </div>
      </div>

      <div className="relative max-w-xl">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en todo el catálogo por nombre o código…" className="pl-10 h-11 text-base" data-testid="catalogo-q" />
      </div>

      {loading && !items ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>
      ) : verPortada ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="catalogo-categorias">
          <button onClick={() => elegir("todas")} className="group relative flex h-44 flex-col justify-end overflow-hidden rounded-lg bg-slate-900 p-4 text-left text-white">
            <LayoutGrid className="absolute right-4 top-4 h-8 w-8 text-white/30" />
            <span className="font-display text-xl font-bold">Todos los productos</span>
            <span className="text-sm text-white/70">{base.length} artículos</span>
          </button>
          {portada.map((c) => (
            <button key={c.slug} onClick={() => elegir(c.slug)} data-testid={`catalogo-cat-${c.slug}`}
              className="group relative flex h-44 flex-col justify-end overflow-hidden rounded-lg bg-slate-800 p-4 text-left text-white">
              <img src={c.imagen} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <span className="relative font-display text-xl font-bold leading-tight">{c.nombre}</span>
              <span className="relative text-sm text-white/80">{conteoCat[c.slug]} artículos</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setCat(""); setQ(""); setMarca(""); }} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4" /> Categorías
            </button>
            {[{ slug: "todas", corto: "Todas" }, ...CATEGORIAS, OTROS].filter((c) => c.slug === "todas" || conteoCat[c.slug]).map((c) => (
              <button key={c.slug} onClick={() => elegir(c.slug)}
                className={`h-9 rounded-full border px-3 text-sm ${(cat || "todas") === c.slug ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                {c.corto || c.nombre}
              </button>
            ))}
          </div>

          {marcas.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1" data-testid="catalogo-marcas">
              <button onClick={() => setMarca("")}
                className={`flex h-14 shrink-0 items-center rounded-lg border px-4 text-sm font-semibold ${!marca ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Todas las marcas</button>
              {marcas.map((m) => (
                <button key={m.slug} onClick={() => setMarca(m.slug === marca ? "" : m.slug)} title={m.nombre}
                  className={`flex h-14 shrink-0 items-center gap-2 rounded-lg border bg-white px-3 ${marca === m.slug ? "border-brand-600 ring-2 ring-brand-600/30" : "border-slate-200 hover:border-slate-400"}`}>
                  {m.logo ? <img src={m.logo} alt={m.nombre} className="h-8 max-w-[92px] object-contain" /> : <span className="text-sm font-semibold text-slate-700">{m.nombre}</span>}
                  <span className="text-xs text-slate-400">{m.n}</span>
                </button>
              ))}
            </div>
          )}

          {catActual && <h2 className="font-display text-lg font-bold text-slate-800">{catActual.nombre}{marca ? ` · ${marcaPorSlug(marca)?.nombre}` : ""}</h2>}

          {filtrados.length === 0 ? (
            <div className="card-soft p-12 text-center" data-testid="catalogo-vacio">
              <PackageX className="w-10 h-10 mx-auto text-slate-300 mb-3" />
              <p className="text-sm text-slate-500">Sin productos para esta búsqueda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtrados.slice(0, limite).map((p) => {
                const m = p.marca ? marcaPorSlug(p.marca) : null;
                const ex = Number(p.existencia);
                return (
                  <div key={p.id} className="card-soft overflow-hidden flex flex-col" data-testid={`catalogo-item-${p.codigo}`}>
                    <div className="aspect-square bg-white border-b border-slate-100 flex items-center justify-center overflow-hidden relative">
                      {fotoProducto(p.imagen)
                        ? <img src={fotoProducto(p.imagen)} alt={p.nombre} loading="lazy" className="w-full h-full object-contain p-2" />
                        : <Images className="w-12 h-12 text-slate-300" />}
                      <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-bold border ${
                        ex <= 0 ? "bg-red-600 text-white border-red-600" : ex < 5 ? "bg-amber-500 text-white border-amber-500" : "bg-white/90 text-slate-700 border-slate-200"}`}>
                        {ex <= 0 ? "Agotado" : `Exist: ${p.existencia}`}
                      </span>
                      {m?.logo && <img src={m.logo} alt={m.nombre} className="absolute bottom-2 left-2 h-6 max-w-[70px] object-contain rounded bg-white/90 px-1" />}
                    </div>
                    <div className="p-3 flex-1 flex flex-col">
                      <div className="text-xs text-slate-400">{p.codigo}</div>
                      <div className="font-semibold text-base leading-snug line-clamp-2">{p.nombre}</div>
                      <div className="mt-auto pt-2 flex items-end justify-between">
                        {Number(p.precio_publico) > 0
                          ? <span className="font-display font-black text-xl text-brand-600">{money(p.precio_publico)}</span>
                          : <span className="text-xs text-slate-400">Precio a consultar</span>}
                        <span className={`text-sm tabular-nums ${ex <= 0 ? "text-red-600 font-semibold" : "text-slate-500"}`}>{ex} {(p.unidad_medida || "pza").toLowerCase()}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {filtrados.length > limite && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimite(limite + POR_PAGINA)}>Ver más ({filtrados.length - limite})</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
