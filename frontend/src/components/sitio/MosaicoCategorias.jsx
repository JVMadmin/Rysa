import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { EASE } from "@/components/sitio/motion";
import { CATEGORIAS, aproximado } from "@/data/categorias";

// Mosaico de borde a borde con la familia de color RYSA (rojos, grafitos y
// cálidos). La foto de cada categoría va fundida en el color del cuadro;
// al pasar el cursor se acerca, gira un poco y recupera su color real.
// `fusion`: luminosity tiñe la foto con el fondo oscuro o rojo; multiply
// (sobre gris) la oscurece apenas sobre los fondos claros. `filtro` sube el
// contraste de fotos muy claras para que no se pierdan en el color.
const ESTILOS = {
  desechables: { fondo: "#CD0708", texto: "#FFFFFF", suave: "rgba(255,255,255,0.78)", acento: "#FFFFFF", fusion: "luminosity", opacidad: 0.9, filtro: "contrast(1.9) brightness(0.78)", veloCorto: true },
  bolsas: { fondo: "#2E2F34", texto: "#FFFFFF", suave: "rgba(255,255,255,0.72)", acento: "#F27A7C", fusion: "luminosity", opacidad: 0.45 },
  limpieza: { fondo: "#F6F5F2", texto: "#2E2F34", suave: "#52545A", acento: "#CD0708", fusion: "luminosity", opacidad: 0.9, filtro: "contrast(1.9) brightness(0.78)", veloCorto: true },
  recipientes: { fondo: "#4A4B50", texto: "#FFFFFF", suave: "rgba(255,255,255,0.75)", acento: "#FFFFFF", fusion: "luminosity", opacidad: 0.5 },
  reposteria: { fondo: "#FBD3D3", texto: "#7A0A0E", suave: "#A3060A", acento: "#A3060A", fusion: "multiply", opacidad: 0.55, gris: true },
  "ferreteria-campo": { fondo: "#7A0A0E", texto: "#FFFFFF", suave: "rgba(255,255,255,0.75)", acento: "#F7B2B3", fusion: "luminosity", opacidad: 0.5 },
};

const cuadro = {
  oculto: { clipPath: "inset(100% 0 0 0)" },
  visible: { clipPath: "inset(0% 0 0 0)", transition: { duration: 1, ease: EASE } },
};
const foto = {
  oculto: { scale: 1.25 },
  visible: { scale: 1, transition: { duration: 1.6, ease: EASE } },
};

function Cuadro({ cat, indice }) {
  const e = ESTILOS[cat.slug] || ESTILOS.bolsas;
  // Velo del color del cuadro arriba y abajo: mantiene el texto legible
  // incluso cuando la foto recupera su color.
  // `veloCorto` para fotos cuyo objeto está abajo (no lo tapa).
  const velo = e.veloCorto
    ? `linear-gradient(to bottom, ${e.fondo} 0%, ${e.fondo}00 34%, ${e.fondo}00 72%, ${e.fondo}D9 100%)`
    : `linear-gradient(to bottom, ${e.fondo} 0%, ${e.fondo}00 36%, ${e.fondo}00 44%, ${e.fondo}E6 78%, ${e.fondo} 100%)`;
  return (
    <motion.li variants={cuadro} className="relative">
      <Link to={`/productos/${cat.slug}`} aria-label={`${cat.nombre}, ${aproximado(cat.articulos)} artículos`}
        className="group relative block h-[340px] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:h-[380px] lg:h-[420px]"
        style={{ backgroundColor: e.fondo, color: e.texto }}>
        {/* El fondo va también aquí: el transform crea un contexto de apilamiento y
            la fusión solo ve lo que hay dentro de él. */}
        <motion.div variants={foto} className="absolute inset-0" style={{ backgroundColor: e.fondo }}>
          <img src={cat.imagen} alt="" loading="lazy" decoding="async"
            className={`absolute inset-0 h-full w-full object-cover transition-transform duration-[1400ms] ease-out-rysa group-hover:rotate-[-1.5deg] group-hover:scale-110 ${e.gris ? "grayscale" : ""}`}
            style={{ mixBlendMode: e.fusion, opacity: e.opacidad, filter: e.filtro }} />
          <img src={cat.imagen} alt="" loading="lazy" decoding="async" aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-all duration-[1400ms] ease-out-rysa group-hover:rotate-[-1.5deg] group-hover:scale-110 group-hover:opacity-80" />
        </motion.div>
        <div className="absolute inset-0" style={{ background: velo }} aria-hidden="true" />

        <div className="relative flex h-full flex-col justify-between p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <h3 className="titular-fino text-[1.7rem] leading-tight sm:text-[2rem]">{cat.nombre}</h3>
            <span className="font-display text-xs tabular-nums tracking-[0.2em]" style={{ color: e.suave }}>{String(indice + 1).padStart(2, "0")}</span>
          </div>

          <div>
            {/* Tipos de artículo: suben al pasar el cursor (solo con cursor real). */}
            <ul className="mb-5 hidden max-h-0 space-y-1.5 overflow-hidden text-[0.92rem] opacity-0 transition-all duration-700 ease-out-rysa [@media(hover:hover)]:block group-hover:max-h-40 group-hover:opacity-100 group-focus-visible:max-h-40 group-focus-visible:opacity-100"
              aria-hidden="true" style={{ textShadow: e.texto === "#FFFFFF" ? "0 1px 10px rgba(0,0,0,0.65)" : "0 1px 10px rgba(255,255,255,0.9)" }}>
              {cat.tipos.slice(0, 4).map((t) => (
                <li key={t} className="flex items-center gap-3"><span className="h-px w-3 shrink-0" style={{ backgroundColor: e.acento }} />{t}</li>
              ))}
            </ul>
            <div className="flex items-end justify-between gap-4 border-t pt-4" style={{ borderColor: `${e.texto}33` }}>
              <span className="text-xs uppercase tracking-[0.16em]" style={{ color: e.suave }}>{aproximado(cat.articulos)} artículos</span>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-500 ease-out-rysa group-hover:scale-110"
                style={{ borderColor: `${e.texto}55` }} aria-hidden="true">
                <ArrowRight className="h-4 w-4 transition-transform duration-500 group-hover:-rotate-45" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

export default function MosaicoCategorias() {
  return (
    <motion.ul initial="oculto" whileInView="visible" viewport={{ once: true, margin: "0px 0px -15% 0px" }}
      variants={{ visible: { transition: { staggerChildren: 0.09 } } }}
      className="grid sm:grid-cols-2 lg:grid-cols-3">
      {CATEGORIAS.map((cat, i) => <Cuadro key={cat.slug} cat={cat} indice={i} />)}
    </motion.ul>
  );
}
