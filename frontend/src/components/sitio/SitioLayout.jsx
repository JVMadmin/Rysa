import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowUpRight, Mail, MapPin, Menu, MessageCircle, Phone, X } from "lucide-react";
import { useBranding } from "@/hooks/useBranding";
import { CATEGORIAS } from "@/data/categorias";

const LOGOTIPO = "/brand/logotipo-Photoroom.png";

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
  { to: "/#nosotros", label: "Nosotros" },
  { to: "/#contacto", label: "Contacto" },
];

function Enlace({ to, children, className, onClick }) {
  // Las anclas de la portada (/#seccion) navegan y luego desplazan.
  if (to.includes("#")) return <a href={to} className={className} onClick={onClick}>{children}</a>;
  return (
    <NavLink to={to} onClick={onClick}
      className={({ isActive }) => `${className} ${isActive ? "text-carbon-900 after:bg-brand-600" : ""}`}>
      {children}
    </NavLink>
  );
}

export function SitioHeader() {
  const [abierto, setAbierto] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const c = useContacto();

  useEffect(() => setAbierto(false), [pathname]);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8);
    f(); window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);

  return (
    <header className={`sticky top-0 z-50 bg-white/95 backdrop-blur transition-shadow ${scrolled ? "shadow-[0_1px_0_#E2E3E6]" : ""}`}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-carbon-900 focus:px-3 focus:py-2 focus:text-white">
        Saltar al contenido
      </a>
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link to="/" aria-label="Grupo RYSA, ir al inicio" className="shrink-0">
          <img src={LOGOTIPO} alt="Grupo RYSA — Plásticos, empaques, desechables, suministros" width="148" height="70"
            className="h-12 w-auto sm:h-[52px]" />
        </Link>

        <nav aria-label="Navegación principal" className="hidden items-center gap-8 md:flex">
          {NAV.map((n) => (
            <Enlace key={n.to} to={n.to}
              className="relative py-2 text-[0.95rem] font-medium text-slate-600 transition-colors hover:text-carbon-900 after:absolute after:inset-x-0 after:-bottom-0.5 after:h-[2px] after:rounded-full after:bg-transparent">
              {n.label}
            </Enlace>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link to="/login" data-testid="landing-login-btn" className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-carbon-900">
            Acceso ERP
          </Link>
          <a href={cotizarUrl(c)} target={c.waUrl ? "_blank" : undefined} rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700">
            Pedir cotización <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>

        <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} aria-controls="menu-movil"
          aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-carbon-900 md:hidden">
          {abierto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {abierto && (
        <div id="menu-movil" className="border-t border-slate-200 bg-white px-5 pb-6 pt-2 md:hidden">
          <nav aria-label="Navegación móvil" className="flex flex-col">
            {NAV.map((n) => (
              <Enlace key={n.to} to={n.to} onClick={() => setAbierto(false)}
                className="border-b border-slate-100 py-3.5 text-base font-medium text-carbon-900">
                {n.label}
              </Enlace>
            ))}
          </nav>
          <div className="mt-5 grid gap-2">
            <a href={cotizarUrl(c)} className="inline-flex h-11 items-center justify-center rounded-md bg-brand-600 text-sm font-semibold text-white">Pedir cotización</a>
            <Link to="/login" className="inline-flex h-11 items-center justify-center rounded-md border border-slate-300 text-sm font-medium text-carbon-900">Acceso ERP</Link>
          </div>
        </div>
      )}
    </header>
  );
}

export function SitioFooter() {
  const c = useContacto();
  return (
    <footer className="bg-carbon-950 text-slate-400">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-16 sm:px-8 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <img src={LOGOTIPO} alt="Grupo RYSA" width="148" height="70" className="h-14 w-auto invert" />
          <p className="mt-5 max-w-xs text-sm leading-6">
            Plásticos, empaques, desechables y suministros para negocios y hogares, por mayoreo y menudeo.
          </p>
        </div>
        <div>
          <h2 className="etiqueta text-slate-500">Productos</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {CATEGORIAS.map((cat) => (
              <li key={cat.slug}><Link to={`/productos/${cat.slug}`} className="transition-colors hover:text-white">{cat.nombre}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="etiqueta text-slate-500">Contacto</h2>
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
          <p className="etiqueta text-[0.68rem] text-slate-600">Plásticos · Empaques · Desechables · Suministros</p>
        </div>
      </div>
    </footer>
  );
}

export default function SitioLayout({ children }) {
  return (
    <div className="min-h-screen bg-white text-carbon-900 antialiased">
      <SitioHeader />
      <main id="contenido">{children}</main>
      <SitioFooter />
    </div>
  );
}
