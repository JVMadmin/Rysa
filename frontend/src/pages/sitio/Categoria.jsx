import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import SitioLayout, { BOTON_CONTORNO_CLARO, BOTON_PRIMARIO, cotizarUrl, useContacto } from "@/components/sitio/SitioLayout";
import TarjetaFlip from "@/components/sitio/TarjetaFlip";
import CatalogoProductos from "@/components/sitio/CatalogoProductos";
import { Cortina, EASE, Elemento, Escalonar, Regla, Revelar, TitularPalabras } from "@/components/sitio/motion";
import { CATEGORIAS, aproximado, porSlug } from "@/data/categorias";
import { MARCAS_SITIO } from "@/data/marcas";
import { api } from "@/lib/api";

export default function Categoria() {
  const { slug } = useParams();
  const cat = porSlug(slug);
  const c = useContacto();
  const [datos, setDatos] = useState(null);

  useEffect(() => {
    if (cat) document.title = `${cat.nombre} — Grupo RYSA`;
    window.scrollTo(0, 0);
    setDatos(null);
    if (cat) api.get(`/publico/categorias/${cat.slug}`).then((r) => setDatos(r.data)).catch(() => setDatos({ productos: [], marcas: [] }));
  }, [cat]);

  if (!cat) return <Navigate to="/productos" replace />;

  const indice = CATEGORIAS.indexOf(cat);
  const otras = CATEGORIAS.filter((x) => x.slug !== cat.slug);
  const entrar = (delay) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, ease: EASE, delay } });

  return (
    <SitioLayout>
      <section aria-labelledby="categoria-titulo" className="grafito grano relative text-white">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative grid lg:min-h-[640px] lg:grid-cols-2">
          <div className="flex flex-col justify-center px-5 pb-14 pt-[7.5rem] sm:px-8 sm:pt-[8.5rem] lg:pb-24 lg:pt-[9rem] lg:pl-[max(2rem,calc((100vw-1240px)/2+2rem))] lg:pr-14">
            <nav aria-label="Ruta" className="text-sm text-slate-300">
              <Link to="/" className="hover:text-white">Inicio</Link> <span aria-hidden="true">/</span>{" "}
              <Link to="/productos" className="hover:text-white">Productos</Link> <span aria-hidden="true">/</span>{" "}
              <span className="text-white">{cat.corto}</span>
            </nav>
            <motion.p {...entrar(0.05)} className="mt-10 font-display text-xs tabular-nums uppercase tracking-[0.2em] text-brand-300">
              {String(indice + 1).padStart(2, "0")} / {String(CATEGORIAS.length).padStart(2, "0")} · {aproximado(cat.articulos)} artículos
            </motion.p>
            <TitularPalabras key={cat.slug} id="categoria-titulo" texto={cat.nombre} delay={0.1} palabra="metal"
              className="titular-fino mt-5 text-[2.3rem] sm:text-[3.2rem] lg:text-[3.6rem]" />
            <motion.span aria-hidden="true" className="mt-8 block h-px w-20 origin-left bg-brand-500"
              initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, ease: EASE, delay: 0.5 }} />
            <motion.p {...entrar(0.55)} className="mt-8 max-w-xl text-[1.05rem] leading-7 text-slate-300">{cat.descripcion}</motion.p>
            <motion.div {...entrar(0.65)} className="mt-10 flex flex-col gap-3 sm:flex-row">
              <a href={cotizarUrl(c, cat.nombre)} target={c.waUrl ? "_blank" : undefined} rel="noreferrer" className={BOTON_PRIMARIO}>
                {c.waUrl ? <MessageCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />} Cotizar {cat.corto.toLowerCase()}
              </a>
              <Link to="/productos" className={BOTON_CONTORNO_CLARO}>
                <span className="relative inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" /> Todas las categorías</span>
              </Link>
            </motion.div>
          </div>
          <div className="relative min-h-[320px] sm:min-h-[420px]">
            <Cortina key={cat.slug} src={cat.imagen} alt={cat.imagenAlt} className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-carbon-950/70 to-transparent" aria-hidden="true" />
            <p className="absolute bottom-3 right-3 rounded-sm bg-carbon-900/70 px-2 py-1 text-[0.7rem] text-white/80">Imagen representativa de la categoría</p>
          </div>
        </div>
      </section>

      <section aria-label="Detalle de la categoría" className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-16 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <Revelar as="h2" className="flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-brand-600"><Regla ancho="w-10" />Qué encuentras</Revelar>
            <Escalonar as="ul" paso={0.05} className="mt-8 grid gap-x-10 sm:grid-cols-2">
              {cat.tipos.map((t) => (
                <Elemento as="li" key={t} y={14} className="group flex items-center gap-4 border-b border-slate-200 py-4 text-[1.02rem]">
                  <span className="h-px w-3 shrink-0 bg-brand-500 transition-all duration-500 ease-out-rysa group-hover:w-6" aria-hidden="true" />{t}
                </Elemento>
              ))}
            </Escalonar>
            <Revelar as="p" delay={0.1} className="mt-8 max-w-xl text-sm leading-6 text-slate-500">
              Manejamos varias medidas, presentaciones y empaques de cada artículo. Si buscas algo específico, envíanos la
              descripción o el código y te confirmamos disponibilidad.
            </Revelar>
          </div>
          <aside className="space-y-10">
            {cat.marcas?.length > 0 && (
              <Revelar delay={0.1} className="border-t border-carbon-900 pt-6">
                <h2 className="text-xs uppercase tracking-[0.2em] text-slate-500">Marcas en esta categoría</h2>
                <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
                  {cat.marcas.map((m) => {
                    const ficha = MARCAS_SITIO.find((x) => x.nombre.toUpperCase() === m.toUpperCase());
                    return (
                      <li key={m} className="titular-fino text-[1.35rem] text-carbon-900">
                        {ficha ? <Link to={`/productos/marca/${ficha.slug}`} className="underline-offset-4 transition-colors hover:text-brand-600 hover:underline">{m}</Link> : m}
                      </li>
                    );
                  })}
                </ul>
              </Revelar>
            )}
            {cat.imagenSecundaria && (
              <Cortina src={cat.imagenSecundaria} alt={cat.imagenSecundariaAlt} loading="lazy" desde="abajo" className="aspect-[4/3] rounded-sm" />
            )}
          </aside>
        </div>
      </section>

      <section aria-labelledby="productos-titulo" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 sm:py-20">
          <Revelar as="h2" id="productos-titulo" className="titular-fino text-[1.9rem] sm:text-[2.3rem]">Productos de {cat.corto.toLowerCase()}</Revelar>
          <div className="mt-8">
            <CatalogoProductos productos={datos?.productos} nombre={cat.corto} marcas={datos?.marcas || []} mostrarMarca />
          </div>
          <p className="mt-10 max-w-3xl text-xs leading-5 text-slate-500">
            Precios de Grupo RYSA con IVA incluido, sujetos a cambio y a disponibilidad. Precio de mayoreo disponible para negocios.
            Las imágenes marcadas como ilustrativas son de productos de la misma familia.
          </p>
        </div>
      </section>

      <section aria-labelledby="otras-titulo" className="papel border-t border-slate-200 py-20 sm:py-24">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <Revelar as="h2" id="otras-titulo" className="titular-fino text-[1.75rem]">Otras categorías</Revelar>
          <Escalonar as="ul" className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {otras.map((o) => (
              <Elemento as="li" key={o.slug}>
                <TarjetaFlip cat={o} indice={CATEGORIAS.indexOf(o)} alto="h-[280px]" compacta />
              </Elemento>
            ))}
          </Escalonar>
        </div>
      </section>
    </SitioLayout>
  );
}
