import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Boxes, ShoppingBag, Package, Recycle, Truck, ArrowRight, Phone,
  MessageCircle, MapPin, Mail, CheckCircle2, Warehouse,
} from "lucide-react";

const CATS = [
  { name: "Bolsas de Papel", desc: "Estraza, revolución y kraft en todas las medidas.", icon: ShoppingBag,
    img: "https://images.unsplash.com/photo-1616429368325-d5d7542b0ec3?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", span: "md:col-span-7" },
  { name: "Vasos y Desechables", desc: "Vasos de plástico, cubiertos y productos desechables.", icon: Recycle,
    img: "https://images.unsplash.com/photo-1541698321721-c083f55816da?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", span: "md:col-span-5" },
  { name: "Empaque y Cajas", desc: "Emplayer, cajas de cartón y materiales para empaque.", icon: Package,
    img: "https://images.unsplash.com/photo-1769355104335-acef3aa4c9b6?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", span: "md:col-span-5" },
  { name: "Plásticos Industriales", desc: "Bolsas negras, plástico por rollo, tambos y cubetas.", icon: Boxes,
    img: "https://images.unsplash.com/photo-1710141530542-f792450e736e?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", span: "md:col-span-7" },
];

const DESTACADOS = ["Bolsas de papel", "Vasos de plástico", "Papel estraza", "Papel revolución",
  "Bolsas para silo", "Tambos de 200 L", "Cubetas de 20 L", "Emplayer", "Hilo vinil", "Bolsas negras", "Plástico por rollo"];

export default function Landing() {
  return (
    <div className="bg-[#F8F9FA] text-slate-900">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-white/40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-md bg-[#FF5A00] flex items-center justify-center">
              <Boxes className="w-5 h-5 text-white" />
            </div>
            <span className="font-display font-extrabold text-xl tracking-tight">Grupo RYSA</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#productos" className="hover:text-[#0055A4] transition-colors">Productos</a>
            <a href="#nosotros" className="hover:text-[#0055A4] transition-colors">Nosotros</a>
            <a href="#contacto" className="hover:text-[#0055A4] transition-colors">Contacto</a>
          </nav>
          <Link to="/login">
            <Button data-testid="landing-login-btn" className="rounded-full bg-[#0055A4] hover:bg-[#004385] text-white px-5">
              Iniciar sesión
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img src="https://images.unsplash.com/photo-1710141530542-f792450e736e?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600"
            alt="Almacén" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0F172A] via-[#0F172A]/90 to-[#0F172A]/40" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-28 lg:py-40">
          <div className="max-w-2xl animate-fade-up">
            <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#FF5A00] font-semibold mb-6">
              <span className="w-8 h-[2px] bg-[#FF5A00]" /> Mayoreo y Menudeo
            </span>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-white leading-[1.05]">
              Plásticos y desechables para tu negocio
            </h1>
            <p className="text-slate-300 text-lg mt-6 max-w-xl">
              Somos Grupo RYSA. Comercializamos bolsas, vasos, papel, empaque y productos plásticos con la mejor calidad y precio, al mayoreo y menudeo.
            </p>
            <div className="flex flex-wrap gap-4 mt-8">
              <a href="#productos">
                <Button className="rounded-full h-12 px-7 bg-[#FF5A00] hover:bg-[#E04F00] text-white font-semibold text-base">
                  Ver productos <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
              <a href="#contacto">
                <Button variant="outline" className="rounded-full h-12 px-7 bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white text-base">
                  <MessageCircle className="w-4 h-4 mr-2" /> Contáctanos
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Franja stats */}
      <section id="nosotros" className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-200">
          {[["+500", "Productos"], ["Mayoreo", "y Menudeo"], ["Entrega", "Rápida"], ["Precios", "Competitivos"]].map(([a, b], i) => (
            <div key={i} className="py-8 px-4 text-center">
              <div className="font-display text-2xl md:text-3xl font-black text-[#0055A4]">{a}</div>
              <div className="text-sm text-slate-500 mt-1">{b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Categorías bento */}
      <section id="productos" className="max-w-7xl mx-auto px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight">Nuestras categorías</h2>
          <p className="text-slate-500 mt-3">Todo lo que tu negocio necesita en materiales plásticos, papel y empaque.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mt-10">
          {CATS.map((c) => (
            <div key={c.name} className={`${c.span} group relative rounded-xl overflow-hidden h-64 border border-slate-200`}>
              <img src={c.img} alt={c.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <div className="absolute bottom-0 p-6 text-white">
                <c.icon className="w-7 h-7 mb-2 text-[#FF5A00]" />
                <h3 className="font-display text-xl font-bold">{c.name}</h3>
                <p className="text-slate-200 text-sm mt-1">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Destacados */}
      <section className="bg-white border-y border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="font-display text-2xl sm:text-3xl font-black tracking-tight mb-8">Productos destacados</h2>
          <div className="flex flex-wrap gap-3">
            {DESTACADOS.map((p) => (
              <span key={p} className="inline-flex items-center gap-2 bg-[#F1F5F9] border border-slate-200 rounded-full px-4 py-2 text-sm text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-[#0055A4]" /> {p}
              </span>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-6 mt-12">
            <div className="rounded-xl border border-slate-200 p-8 bg-[#F8F9FA]">
              <Warehouse className="w-8 h-8 text-[#0055A4]" />
              <h3 className="font-display text-xl font-bold mt-4">Ventas al Mayoreo</h3>
              <p className="text-slate-500 mt-2 text-sm">Precios especiales por volumen para distribuidores, restaurantes, tiendas y empresas.</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-8 bg-[#F8F9FA]">
              <Truck className="w-8 h-8 text-[#FF5A00]" />
              <h3 className="font-display text-xl font-bold mt-4">Ventas al Menudeo</h3>
              <p className="text-slate-500 mt-2 text-sm">Compra la cantidad que necesites, con atención personalizada y entrega rápida.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Contacto */}
      <section id="contacto" className="max-w-7xl mx-auto px-6 py-20">
        <div className="rounded-2xl bg-[#0F172A] p-10 md:p-14 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-black tracking-tight text-white">Contáctanos</h2>
            <p className="text-slate-300 mt-3 max-w-md">Solicita tu cotización o visita nuestra tienda. Con gusto te atendemos al mayoreo y menudeo.</p>
            <div className="mt-8 space-y-4 text-slate-200">
              <div className="flex items-center gap-3"><Phone className="w-5 h-5 text-[#FF5A00]" /> (000) 000 0000</div>
              <div className="flex items-center gap-3"><MessageCircle className="w-5 h-5 text-[#FF5A00]" /> WhatsApp disponible</div>
              <div className="flex items-center gap-3"><Mail className="w-5 h-5 text-[#FF5A00]" /> contacto@gruporysa.com</div>
              <div className="flex items-center gap-3"><MapPin className="w-5 h-5 text-[#FF5A00]" /> México</div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-8">
            <h3 className="font-display text-lg font-bold">¿Eres del equipo RYSA?</h3>
            <p className="text-slate-500 text-sm mt-2">Accede al sistema ERP para gestionar inventario, ventas y caja.</p>
            <Link to="/login">
              <Button data-testid="landing-cta-login" className="w-full h-12 mt-6 rounded-full bg-[#0055A4] hover:bg-[#004385] text-white font-semibold">
                Iniciar sesión en el ERP <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-[#0F172A] text-slate-400 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-[#FF5A00] flex items-center justify-center">
              <Boxes className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-bold text-white">Grupo RYSA</span>
          </div>
          <p className="text-sm">© {new Date().getFullYear()} Grupo RYSA. Plásticos y desechables. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
