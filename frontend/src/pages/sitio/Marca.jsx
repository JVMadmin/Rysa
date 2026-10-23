import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, FileText, MessageCircle, Search } from "lucide-react";
import SitioLayout, { BOTON_CONTORNO_CLARO, cotizarUrl, useContacto } from "@/components/sitio/SitioLayout";
import { EASE, Elemento, Escalonar, TitularPalabras } from "@/components/sitio/motion";
import { api, fileUrl, money } from "@/lib/api";
import { marcaPorSlug } from "@/data/marcas";

// Catálogo de una marca: productos del inventario de Grupo RYSA con su precio
// público (Precio 1 con IVA, mismas reglas que el POS). Las fotos son del
// catálogo del fabricante cuando se identificó el producto.
export default function Marca() {
  const { slug } = useParams();
  const c = useContacto();
  const presentacion = marcaPorSlug(slug);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    window.scrollTo(0, 0);
    setDatos(null); setError("");
    api.get(`/publico/marcas/${slug}`)
      .then((r) => { setDatos(r.data); document.title = `${r.data.nombre} — Grupo RYSA`; })
      .catch(() => setError("No encontramos esta marca."));
  }, [slug]);

  const productos = useMemo(() => {
    const lista = datos?.productos || [];
    const t = q.trim().toLowerCase();
    return t ? lista.filter((p) => `${p.descripcion} ${p.codigo}`.toLowerCase().includes(t)) : lista;
  }, [datos, q]);

  const nombre = datos?.nombre || presentacion?.nombre || "";

  return (
    <SitioLayout>
      <section aria-labelledby="marca-titulo" className="grafito grano relative text-white">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1240px] px-5 pb-14 pt-[7.5rem] sm:px-8 sm:pt-[8.5rem]">
          <nav aria-label="Ruta" className="text-sm text-slate-300">
            <Link to="/" className="hover:text-white">Inicio</Link> <span aria-hidden="true">/</span>{" "}
            <Link to="/productos" className="hover:text-white">Productos</Link> <span aria-hidden="true">/</span>{" "}
            <span className="text-white">{nombre}</span>
          </nav>
          <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-center">
            {presentacion?.logo && (
              <motion.div className="flex h-24 w-40 shrink-0 items-center justify-center rounded-md bg-white p-3"
                initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: EASE }}>
                <img src={presentacion.logo} alt={nombre} className="max-h-full max-w-full object-contain" />
              </motion.div>
            )}
            <div>
              {nombre && <TitularPalabras key={slug} id="marca-titulo" texto={nombre} palabra="metal" className="titular-fino text-[2.4rem] sm:text-[3.2rem]" />}
              {datos?.resumen && <p className="mt-3 max-w-xl text-[1.05rem] leading-7 text-slate-300">{datos.resumen}</p>}
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {datos?.catalogo && (
              <a href={datos.catalogo} target="_blank" rel="noreferrer" className={BOTON_CONTORNO_CLARO}>
                <span className="relative inline-flex items-center gap-2"><FileText className="h-4 w-4" /> Catálogo oficial del fabricante</span>
              </a>
            )}
            <Link to="/productos" className="inline-flex h-12 items-center gap-2 text-sm text-slate-300 hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Todas las marcas y categorías
            </Link>
          </div>
        </div>
      </section>

      <section aria-label={`Productos ${nombre}`} className="mx-auto max-w-[1240px] px-5 py-14 sm:px-8 sm:py-20">
        {error && <p className="text-slate-600">{error} <Link to="/productos" className="text-brand-600 underline">Ver productos</Link></p>}
        {!error && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <p className="text-sm text-slate-600">
                {datos ? `${datos.productos.length} productos ${nombre} con precio Grupo RYSA` : "Cargando productos…"}
              </p>
              <label className="relative block w-full sm:w-80">
                <span className="sr-only">Buscar en {nombre}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar en ${nombre || "la marca"}`}
                  className="h-11 w-full rounded-sm border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-carbon-900 focus:outline-none" />
              </label>
            </div>

            <Escalonar as="ul" paso={0.03} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" key={`${slug}-${productos.length}`}>
              {productos.map((p) => (
                <Elemento as="li" key={p.id} y={16} className="group flex flex-col overflow-hidden rounded-sm border border-slate-200 bg-white transition-shadow hover:shadow-card-lg">
                  <div className="relative flex aspect-square items-center justify-center bg-[#F6F5F2]">
                    {p.imagen ? (
                      <img src={fileUrl(p.imagen)} alt={p.descripcion} loading="lazy" decoding="async"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <span className="titular-fino px-4 text-center text-[1.35rem] text-slate-400">{nombre}</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
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
              ))}
            </Escalonar>

            {datos && (
              <p className="mt-10 max-w-3xl text-xs leading-5 text-slate-500">
                Precios de Grupo RYSA con IVA incluido, por pieza o presentación indicada, sujetos a cambio y a disponibilidad.
                Precio de mayoreo disponible para negocios. Las imágenes provienen del catálogo del fabricante y son ilustrativas.
                {datos.sitio && <> Sitio del fabricante: <a href={datos.sitio} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-carbon-900">{datos.sitio.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" /></a>.</>}
              </p>
            )}
          </>
        )}
      </section>
    </SitioLayout>
  );
}
