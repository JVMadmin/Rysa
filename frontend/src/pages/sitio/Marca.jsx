import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import SitioLayout, { BOTON_CONTORNO_CLARO } from "@/components/sitio/SitioLayout";
import CatalogoProductos from "@/components/sitio/CatalogoProductos";
import { EASE, TitularPalabras } from "@/components/sitio/motion";
import { api } from "@/lib/api";
import { marcaPorSlug } from "@/data/marcas";

// Catálogo de una marca: productos del inventario de Grupo RYSA con su precio
// público (Precio 1 con IVA, mismas reglas que el POS). Las fotos son del
// catálogo del fabricante cuando se identificó el producto.
export default function Marca() {
  const { slug } = useParams();
  const presentacion = marcaPorSlug(slug);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    window.scrollTo(0, 0);
    setDatos(null); setError("");
    api.get(`/publico/marcas/${slug}`)
      .then((r) => { setDatos(r.data); document.title = `${r.data.nombre} — Grupo RYSA`; })
      .catch(() => setError("No encontramos esta marca."));
  }, [slug]);

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
            <CatalogoProductos productos={datos?.productos} nombre={nombre} />

            {datos && (
              <p className="mt-10 max-w-3xl text-xs leading-5 text-slate-500">
                Precios de Grupo RYSA con IVA incluido, por pieza o presentación indicada, sujetos a cambio y a disponibilidad.
                Precio de mayoreo disponible para negocios. Las imágenes provienen del catálogo del fabricante o son de productos de la misma familia (ilustrativas).
                {datos.sitio && <> Sitio del fabricante: <a href={datos.sitio} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-carbon-900">{datos.sitio.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" /></a>.</>}
              </p>
            )}
          </>
        )}
      </section>
    </SitioLayout>
  );
}
