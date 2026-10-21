import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { aproximado } from "@/data/categorias";

// Tarjeta de categoría que gira en 3D al pasar el cursor (o al enfocarla con
// teclado): al frente la foto, al reverso los tipos de artículo. En pantallas
// táctiles no gira y el frente ya lleva todo lo necesario para entrar.
export default function TarjetaFlip({ cat, indice, alto = "h-[340px]", compacta = false }) {
  return (
    <Link to={`/productos/${cat.slug}`} aria-label={`${cat.nombre}, ${aproximado(cat.articulos)} artículos`}
      className={`flip group block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${alto}`}>
      <div className="flip-interior">
        {/* Frente */}
        <div className="flip-cara overflow-hidden rounded-sm bg-carbon-900 text-white">
          <img src={cat.imagen} alt="" loading="lazy" decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-out-rysa group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-carbon-900/90 via-carbon-900/25 to-transparent" />
          <span className="absolute left-5 top-5 font-display text-xs font-medium tabular-nums tracking-[0.2em] text-white/80">
            {String(indice + 1).padStart(2, "0")}
          </span>
          <div className="absolute inset-x-0 bottom-0 p-6">
            <span className="mb-4 block h-px w-10 bg-brand-500 transition-all duration-500 ease-out-rysa group-hover:w-16" aria-hidden="true" />
            <h3 className={`titular-fino text-white ${compacta ? "text-[1.15rem]" : "text-[1.5rem] sm:text-[1.7rem]"}`}>{cat.nombre}</h3>
            <p className="mt-1.5 text-xs uppercase tracking-[0.16em] text-white/70">{aproximado(cat.articulos)} artículos</p>
          </div>
        </div>

        {/* Reverso */}
        <div className="flip-reverso flex flex-col justify-between overflow-hidden rounded-sm border border-white/10 bg-carbon-900 p-6 text-white" aria-hidden="true">
          <img src={cat.imagen} alt="" loading="lazy" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-[0.12] blur-sm" />
          <div className="relative">
            <p className="text-xs uppercase tracking-[0.18em] text-brand-300">{String(indice + 1).padStart(2, "0")} · {cat.corto}</p>
            <ul className={`mt-5 space-y-2 text-slate-200 ${compacta ? "text-[0.85rem]" : "text-[0.95rem]"}`}>
              {cat.tipos.slice(0, compacta ? 4 : 6).map((t) => (
                <li key={t} className="flex items-center gap-3"><span className="h-px w-3 shrink-0 bg-brand-500" />{t}</li>
              ))}
            </ul>
          </div>
          <span className="relative inline-flex items-center gap-2 border-t border-white/10 pt-4 text-sm font-medium text-white">
            Ver categoría <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}
