import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowUpRight, Mail, MapPin, Menu, MessageCircle, Phone, X } from "lucide-react";
import { useBranding } from "@/hooks/useBranding";
import { CATEGORIAS } from "@/data/categorias";

// Logotipo para grafito: letras blancas con la "R" y las líneas en rojo RYSA
// (derivado de logotipo-color.webp quitando el fondo blanco).
const LOGOTIPO_OSCURO = "/brand/logotipo-oscuro.webp";
const EASE = [0.2, 0.7, 0.2, 1];

// Botones del sitio. Los de contorno se rellenan con un barrido al pasar el
// cursor; su texto va en un <span className="relative"> para quedar encima.
const BOTON_BASE = "group relative inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-sm px-7 text-[0.95rem] font-medium transition-colors duration-500";
const BARRIDO = "before:absolute before:inset-0 before:origin-left before:scale-x-0 before:transition-transform before:duration-500 before:ease-out-rysa hover:before:scale-x-100";
export const BOTON_PRIMARIO = `${BOTON_BASE} bg-brand-600 text-white hover:bg-brand-700`;
export const BOTON_CONTORNO_CLARO = `${BOTON_BASE} ${BARRIDO} border border-white/40 text-white hover:border-white hover:text-carbon-900 before:bg-white`;
export const BOTON_CONTORNO = `${BOTON_BASE} ${BARRIDO} border border-carbon-900/30 text-carbon-900 hover:border-carbon-900 hover:text-white before:bg-carbon-900`;

// Enlaces de contacto a partir de Configuración. Los datos vacíos no se muestran.
export function useContacto() {
  const b = useBranding();
  const wa = (b.whatsapp || "").replace(/\D/g, "");
  const tel = (b.telefono || "").replace(/[^\d+]/g, "");
  return {
    ...b,
    waUrl: wa ? `https://wa.me/${wa.length === 10 ? "52" + wa : wa}` : "",
    telUrl: tel ? `tel:${tel}` : "",
    mailUrl: b.correo ? `mailto:${b.correo}` : "",
    ubicacion: [b.direccion, b.ciudad, b.estado].filter(Boolean).join(", "),
  };
}

// Enlace para pedir cotización: WhatsApp si está configurado; si no, correo.
export function cotizarUrl(c, asunto = "Cotización") {
  const texto = `Hola, me interesa una cotización: ${asunto}.`;
  if (c.waUrl) return `${c.waUrl}?text=${encodeURIComponent(texto)}`;
  if (c.correo) return `mailto:${c.correo}?subject=${encodeURIComponent(asunto + " — Grupo RYSA")}&body=${encodeURIComponent(texto)}`;
  return "/#contacto";
}

const NAV = [
  { to: "/productos", label: "Productos" },
  { to: "/facturacion", label: "Facturación" },
  { to: "/#nosotros", label: "Nosotros" },
  { to: "/#contacto", label: "Contacto" },
];

function Enlace({ to, children, className, ...rest }) {
  // Las anclas de la portada (/#seccion) navegan y luego desplazan.
  if (to.includes("#")) return <a href={to} className={className} {...rest}>{children}</a>;
  return (
    <NavLink to={to} {...rest} className={({ isActive }) => `${className} ${isActive ? "!text-white" : ""}`}>
      {children}
    </NavLink>
  );
}

export function SitioHeader() {
  const [abierto, setAbierto] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [sobre, setSobre] = useState(null);
  const { pathname } = useLocation();
  const c = useContacto();

  useEffect(() => setAbierto(false), [pathname]);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8);
    f(); window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);

  // El subrayado rojo sigue al cursor entre los enlaces y vuelve al activo.
  const activo = NAV.findIndex((n) => !n.to.includes("#") && pathname.startsWith(n.to));
  const marcado = sobre ?? (activo >= 0 ? activo : null);

  return (
    <header className={`sticky top-0 z-50 text-white transition-all duration-500 ${scrolled || abierto ? "bg-carbon-950/80 shadow-[0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl" : "bg-transparent"}`}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-white focus:px-3 focus:py-2 focus:text-carbon-900">
        Saltar al contenido
      </a>
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link to="/" aria-label="Grupo RYSA, ir al inicio" className="shrink-0">
          <img src={LOGOTIPO_OSCURO} alt="Grupo RYSA — Plásticos, empaques, desechables, suministros" width="900" height="424"
            className="h-11 w-auto sm:h-12" />
        </Link>

        <nav aria-label="Navegación principal" className="hidden items-center gap-1 md:flex" onMouseLeave={() => setSobre(null)}>
          {NAV.map((n, i) => (
            <Enlace key={n.to} to={n.to} onMouseEnter={() => setSobre(i)} onFocus={() => setSobre(i)} onBlur={() => setSobre(null)}
              className="relative px-4 py-2 text-[0.92rem] text-slate-300 transition-colors duration-300 hover:text-white">
              {n.label}
              {marcado === i && (
                <motion.span layoutId="nav-subrayado" className="absolute inset-x-4 -bottom-0.5 h-px bg-brand-500"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }} />
              )}
            </Enlace>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link to="/login" data-testid="landing-login-btn" className="rounded-sm px-3 py-2 text-sm text-slate-300 transition-colors hover:text-white">
            Acceso ERP
          </Link>
          <a href={cotizarUrl(c)} target={c.waUrl ? "_blank" : undefined} rel="noreferrer"
            className="group inline-flex h-10 items-center gap-2 rounded-sm bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-300 hover:bg-brand-700">
            Pedir cotización <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>

        <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} aria-controls="menu-movil"
          aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-white/25 text-white md:hidden">
          {abierto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <AnimatePresence>
        {abierto && (
          <motion.div id="menu-movil" className="overflow-hidden border-t border-white/10 md:hidden"
            initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.45, ease: EASE }}>
            <motion.div className="px-5 pb-6 pt-2" initial="oculto" animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } } }}>
              <nav aria-label="Navegación móvil" className="flex flex-col">
                {NAV.map((n) => (
                  <motion.div key={n.to} variants={{ oculto: { opacity: 0, x: -12 }, visible: { opacity: 1, x: 0 } }}>
                    <Enlace to={n.to} onClick={() => setAbierto(false)} className="block border-b border-white/10 py-4 text-lg text-white">
                      {n.label}
                    </Enlace>
                  </motion.div>
                ))}
              </nav>
              <motion.div variants={{ oculto: { opacity: 0 }, visible: { opacity: 1 } }} className="mt-6 grid gap-2">
                <a href={cotizarUrl(c)} className="inline-flex h-11 items-center justify-center rounded-sm bg-brand-600 text-sm font-medium text-white">Pedir cotización</a>
                <Link to="/login" className="inline-flex h-11 items-center justify-center rounded-sm border border-white/25 text-sm text-white">Acceso ERP</Link>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export function SitioFooter() {
  const c = useContacto();
  return (
    <footer className="grafito grano border-t border-white/[0.06] text-slate-400">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-16 sm:px-8 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <img src={LOGOTIPO_OSCURO} alt="Grupo RYSA" width="900" height="424" loading="lazy" className="h-14 w-auto" />
          <p className="mt-5 max-w-xs text-sm leading-6">
            Plásticos, empaques, desechables y suministros para negocios y hogares, por mayoreo y menudeo.
          </p>
        </div>
        <div>
          <h2 className="etiqueta text-slate-300">Productos</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {CATEGORIAS.map((cat) => (
              <li key={cat.slug}><Link to={`/productos/${cat.slug}`} className="group inline-flex items-center gap-2 transition-colors hover:text-white"><span className="h-px w-0 bg-brand-500 transition-all duration-300 group-hover:w-3" aria-hidden="true" />{cat.nombre}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="etiqueta text-slate-300">Contacto</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {c.correo && <li><a href={c.mailUrl} className="inline-flex items-center gap-2.5 transition-colors hover:text-white"><Mail className="h-4 w-4" />{c.correo}</a></li>}
            {c.telefono && <li><a href={c.telUrl} className="inline-flex items-center gap-2.5 transition-colors hover:text-white"><Phone className="h-4 w-4" />{c.telefono}</a></li>}
            {c.waUrl && <li><a href={c.waUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2.5 transition-colors hover:text-white"><MessageCircle className="h-4 w-4" />WhatsApp</a></li>}
            {c.ubicacion && <li className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{c.ubicacion}</li>}
          </ul>
          <Link to="/login" className="mt-6 inline-flex text-sm font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline">Acceso al ERP</Link>
        </div>
      </div>
      <div className="border-t border-white/[0.07]">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2 px-5 py-6 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} {c.empresa_nombre}. Todos los derechos reservados.</p>
          <p className="etiqueta text-[0.68rem] text-slate-400">Plásticos · Empaques · Desechables · Suministros</p>
        </div>
      </div>
    </footer>
  );
}

export default function SitioLayout({ children }) {
  const { pathname } = useLocation();
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-white text-carbon-900 antialiased">
        <SitioHeader />
        {/* Transición de entrada en cada cambio de página. */}
        <motion.main id="contenido" key={pathname} className="-mt-[72px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, ease: EASE }}>
          {children}
        </motion.main>
        <SitioFooter />
      </div>
    </MotionConfig>
  );
}
