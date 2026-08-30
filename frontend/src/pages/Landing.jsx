import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Boxes, Check, ChevronRight, Mail, MapPin, Menu, MessageCircle,
  Package, Phone, Recycle, ShoppingBag, Truck, Warehouse, X,
} from "lucide-react";

const CATEGORIES = [
  {
    name: "Plásticos y contenedores",
    description: "Tambos, cubetas, contenedores y soluciones para uso industrial y comercial.",
    icon: Boxes,
    image: "https://images.unsplash.com/photo-1710141530542-f792450e736e?auto=format&fit=crop&w=1200&q=85",
  },
  {
    name: "Empaques y bolsas",
    description: "Bolsas, papel, emplaye y materiales para proteger y presentar tus productos.",
    icon: ShoppingBag,
    image: "https://images.unsplash.com/photo-1616429368325-d5d7542b0ec3?auto=format&fit=crop&w=1000&q=85",
  },
  {
    name: "Desechables",
    description: "Vasos, cubiertos y artículos prácticos para negocios, eventos y servicio de alimentos.",
    icon: Recycle,
    image: "https://images.unsplash.com/photo-1541698321721-c083f55816da?auto=format&fit=crop&w=1000&q=85",
  },
];

const PRODUCT_LINES = [
  "Tambos y cubetas", "Bolsas y papel", "Vasos y desechables", "Contenedores",
  "Bolsas para silo", "Emplaye y rollos", "Suministros comerciales",
];

const NAVIGATION = [
  ["Inicio", "#inicio"],
  ["Nosotros", "#nosotros"],
  ["Productos", "#productos"],
  ["Contacto", "#contacto"],
];

function Brand({ compact = false }) {
  return (
    <div className="flex items-center shrink-0">
      <img
        src={compact ? "/brand/isotipo1.png" : "/brand/logotipo-Photoroom.png"}
        alt="Grupo RYSA"
        className={compact ? "h-10 w-14 object-contain" : "h-11 w-[164px] object-contain object-left"}
      />
    </div>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7f7f5] text-[#17191d] selection:bg-red-700 selection:text-white">
      <header className="sticky top-0 z-50 border-b border-black/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#inicio" aria-label="Grupo RYSA, inicio" className="hidden sm:flex"><Brand /></a>
          <a href="#inicio" aria-label="Grupo RYSA, inicio" className="sm:hidden"><Brand compact /></a>

          <nav className="hidden items-center gap-7 lg:flex" aria-label="Navegación principal">
            {NAVIGATION.map(([label, href]) => (
              <a key={href} href={href} className="text-xs font-bold uppercase tracking-[0.13em] text-[#2b2e34] transition-colors hover:text-red-700">
                {label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-4 sm:flex">
            <a href="#contacto" className="hidden items-center gap-2 text-sm font-medium text-[#363941] transition-colors hover:text-red-700 xl:flex">
              <Phone className="h-4 w-4 text-red-700" /> Atención personalizada
            </a>
            <Link to="/login">
              <Button data-testid="landing-login-btn" className="h-10 rounded-none bg-red-700 px-5 text-xs font-bold uppercase tracking-[0.1em] hover:bg-red-800">
                Acceso ERP
              </Button>
            </Link>
          </div>

          <button type="button" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} onClick={() => setMenuOpen((open) => !open)} className="inline-flex h-10 w-10 items-center justify-center border border-black/15 text-[#1d2025] lg:hidden">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-black/10 bg-white px-5 py-5 lg:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col gap-1" aria-label="Navegación móvil">
              {NAVIGATION.map(([label, href]) => (
                <a key={href} href={href} onClick={closeMenu} className="border-b border-black/10 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#202329] hover:text-red-700">
                  {label}
                </a>
              ))}
              <Link to="/login" onClick={closeMenu} className="mt-4">
                <Button className="h-11 w-full rounded-none bg-red-700 text-xs font-bold uppercase tracking-[0.1em] hover:bg-red-800">Acceso ERP</Button>
              </Link>
            </nav>
          </div>
        )}
      </header>

      <main>
        <section id="inicio" className="relative isolate min-h-[660px] overflow-hidden bg-[#16181c]">
          <img
            src="https://images.unsplash.com/photo-1710141530542-f792450e736e?auto=format&fit=crop&w=2200&q=90"
            alt="Materiales y suministros para operación comercial"
            className="absolute inset-0 -z-20 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#101216]/95 via-[#15171c]/82 to-[#15171c]/20" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#101216]/70 to-transparent" />
          <div className="mx-auto flex min-h-[660px] max-w-7xl items-center px-5 py-20 sm:px-8 lg:py-28">
            <div className="max-w-3xl animate-fade-up">
              <div className="mb-7 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.22em] text-white/80">
                <span className="h-[2px] w-11 bg-red-600" /> Plásticos · Empaques · Desechables
              </div>
              <h1 className="max-w-3xl font-display text-5xl font-black leading-[0.96] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                Suministros que mantienen tu negocio en movimiento.
              </h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-white/75 sm:text-lg">
                Grupo RYSA reúne soluciones en plásticos, empaques, desechables y suministros para las necesidades diarias de tu operación.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a href="#productos">
                  <Button className="h-12 w-full rounded-none bg-red-700 px-6 text-xs font-bold uppercase tracking-[0.1em] hover:bg-red-800 sm:w-auto">
                    Explorar productos <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </a>
                <a href="#contacto">
                  <Button variant="outline" className="h-12 w-full rounded-none border-white/40 bg-transparent px-6 text-xs font-bold uppercase tracking-[0.1em] text-white hover:border-white hover:bg-white hover:text-[#17191d] sm:w-auto">
                    Solicitar atención
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-1 divide-y divide-black/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[["Mayoreo", "Atención para negocios y distribuidores"], ["Menudeo", "Compra justo lo que necesitas"], ["Soluciones", "Para empaque, servicio y operación"]].map(([title, text]) => (
              <div key={title} className="flex items-center gap-4 px-6 py-6 sm:px-8">
                <span className="h-9 w-1 bg-red-700" />
                <div><strong className="block font-display text-lg font-extrabold tracking-tight">{title}</strong><span className="text-sm text-[#666b73]">{text}</span></div>
              </div>
            ))}
          </div>
        </section>

        <section id="nosotros" className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-2 lg:items-center lg:gap-24 lg:py-32">
          <div className="order-2 lg:order-1">
            <p className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-red-700"><span className="h-[2px] w-9 bg-red-700" /> Nosotros</p>
            <h2 className="mt-5 max-w-lg font-display text-4xl font-black leading-tight tracking-[-0.035em] text-[#191b20] sm:text-5xl">Una respuesta confiable para cada necesidad de suministro.</h2>
            <p className="mt-6 max-w-xl text-base leading-7 text-[#5f646d]">
              Grupo RYSA comercializa plásticos, empaques, desechables y suministros. Nuestra oferta está pensada para facilitar la compra de materiales esenciales en un mismo lugar.
            </p>
            <a href="#productos" className="mt-8 inline-flex items-center gap-2 border-b-2 border-red-700 pb-2 text-xs font-bold uppercase tracking-[0.12em] text-[#1d2025] transition-colors hover:text-red-700">
              Conoce nuestras líneas <ChevronRight className="h-4 w-4" />
            </a>
          </div>
          <div className="relative order-1 lg:order-2">
            <div className="absolute -left-3 -top-3 h-24 w-24 border-l-2 border-t-2 border-red-700 sm:-left-5 sm:-top-5" />
            <img src="https://images.unsplash.com/photo-1616429368325-d5d7542b0ec3?auto=format&fit=crop&w=1200&q=85" alt="Materiales para empaque" className="relative aspect-[4/3] w-full object-cover grayscale-[15%]" />
            <div className="absolute bottom-0 left-0 bg-[#191b20] px-6 py-5 text-white sm:left-8 sm:bottom-8"><span className="block text-xs font-bold uppercase tracking-[0.16em] text-red-500">Grupo RYSA</span><span className="mt-1 block font-display text-xl font-extrabold">Soluciones para tu operación</span></div>
          </div>
        </section>

        <section id="productos" className="bg-[#1a1c21] py-24 text-white lg:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div><p className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-red-500"><span className="h-[2px] w-9 bg-red-600" /> Productos</p><h2 className="mt-5 font-display text-4xl font-black tracking-[-0.035em] sm:text-5xl">Líneas para cada negocio.</h2></div>
              <p className="max-w-md text-sm leading-6 text-white/65">Explora una selección de las líneas que forman parte de nuestra oferta comercial.</p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {CATEGORIES.map((category) => {
                const Icon = category.icon;
                return <article key={category.name} className="group relative min-h-[390px] overflow-hidden border border-white/15 bg-[#25282f]">
                  <img src={category.image} alt={category.name} className="absolute inset-0 h-full w-full object-cover opacity-65 transition duration-700 group-hover:scale-105 group-hover:opacity-80" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#101216] via-[#101216]/35 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-7"><div className="mb-5 flex h-11 w-11 items-center justify-center border border-red-500 bg-[#17191d]/80"><Icon className="h-5 w-5 text-red-500" /></div><h3 className="font-display text-2xl font-extrabold">{category.name}</h3><p className="mt-3 text-sm leading-6 text-white/75">{category.description}</p></div>
                </article>;
              })}
            </div>
            <div className="mt-10 flex flex-wrap gap-2.5 border-t border-white/15 pt-8">
              {PRODUCT_LINES.map((line) => <span key={line} className="inline-flex items-center gap-2 border border-white/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/80"><Check className="h-3.5 w-3.5 text-red-500" />{line}</span>)}
            </div>
          </div>
        </section>

        <section id="contacto" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
          <div className="grid overflow-hidden border border-black/10 lg:grid-cols-[1.15fr_.85fr]">
            <div className="bg-white p-8 sm:p-12 lg:p-16"><p className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-red-700"><span className="h-[2px] w-9 bg-red-700" /> Contacto</p><h2 className="mt-5 max-w-lg font-display text-4xl font-black leading-tight tracking-[-0.035em] sm:text-5xl">Hablemos de lo que tu negocio necesita.</h2><p className="mt-6 max-w-lg leading-7 text-[#626770]">Conoce nuestra oferta de productos y recibe atención para encontrar la solución más adecuada para tu operación.</p><div className="mt-10 flex flex-col gap-4 sm:flex-row"><a href="mailto:contacto@gruporysa.com"><Button className="h-12 rounded-none bg-red-700 px-6 text-xs font-bold uppercase tracking-[0.1em] hover:bg-red-800"><Mail className="mr-2 h-4 w-4" /> Escribirnos</Button></a><Link to="/login"><Button variant="outline" className="h-12 rounded-none border-[#1b1d22] px-6 text-xs font-bold uppercase tracking-[0.1em] hover:bg-[#1b1d22] hover:text-white">Acceso al ERP <ArrowRight className="ml-2 h-4 w-4" /></Button></Link></div></div>
            <div className="bg-[#f4f4f2] p-8 sm:p-12 lg:p-16"><div className="inline-flex"><Brand /></div><div className="mt-12 space-y-6 text-sm text-[#3d4148]"><div className="flex gap-4"><Mail className="h-5 w-5 shrink-0 text-red-700" /><span>contacto@gruporysa.com</span></div><div className="flex gap-4"><MessageCircle className="h-5 w-5 shrink-0 text-red-700" /><span>Atención por WhatsApp disponible</span></div><div className="flex gap-4"><MapPin className="h-5 w-5 shrink-0 text-red-700" /><span>México</span></div></div><div className="mt-12 border-t border-black/10 pt-6 text-xs uppercase tracking-[0.12em] text-[#8a8f98]">Plásticos · Empaques · Desechables · Suministros</div></div>
          </div>
        </section>
      </main>

      <footer className="bg-[#ececea] py-10 text-[#3d4148]"><div className="mx-auto flex max-w-7xl flex-col gap-7 px-5 sm:px-8 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-4"><Brand compact /><span className="text-xs uppercase tracking-[0.14em]">Grupo RYSA</span></div><nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold uppercase tracking-[0.1em]">{NAVIGATION.map(([label, href]) => <a key={href} href={href} className="transition-colors hover:text-red-700">{label}</a>)}</nav><p className="text-xs">© {new Date().getFullYear()} Grupo RYSA. Todos los derechos reservados.</p></div></footer>
    </div>
  );
}

