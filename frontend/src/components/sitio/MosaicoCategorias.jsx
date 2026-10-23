import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { EASE } from "@/components/sitio/motion";
import { CATEGORIAS, aproximado } from "@/data/categorias";

// Mosaico de borde a borde con la familia de color RYSA (rojos, grafitos y
// cálidos). Capas: la foto a color, encima el color del cuadro semitransparente
// (`tinte`; al pasar el cursor baja a `tinteHover` y la foto se ve más) y, sobre
// eso, bandas sólidas del mismo color detrás del título y de la información,
// para que las letras nunca dependan de lo claro u oscuro de la foto.
const ESTILOS = {
  desechables: { fondo: "205,7,8", texto: "#FFFFFF", suave: "rgba(255,255,255,0.88)", acento: "#FFFFFF", tinte: 0.5 },
  bolsas: { fondo: "46,47,52", texto: "#FFFFFF", suave: "rgba(255,255,255,0.85)", acento: "#F27A7C", tinte: 0.5 },
  limpieza: { fondo: "246,245,242", texto: "#18191D", suave: "#3D3E43", acento: "#CD0708", tinte: 0.45 },
  recipientes: { fondo: "74,75,80", texto: "#FFFFFF", suave: "rgba(255,255,255,0.85)", acento: "#FFFFFF", tinte: 0.5 },
  reposteria: { fondo: "251,211,211", texto: "#520709", suave: "#7A0A0E", acento: "#A3060A", tinte: 0.45 },
  "ferreteria-campo": { fondo: "122,10,14", texto: "#FFFFFF", suave: "rgba(255,255,255,0.85)", acento: "#F7B2B3", tinte: 0.5 },
};
const rgba = (rgb, a) => `rgba(${rgb},${a})`;

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
  return (
    <motion.li variants={cuadro} className="relative">
      <Link to={`/productos/${cat.slug}`} aria-label={`${cat.nombre}, ${aproximado(cat.articulos)} artículos`}
        className="group relative block h-[300px] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:h-[360px] lg:h-[420px]"
        style={{ backgroundColor: rgba(e.fondo, 1), color: e.texto }}>
        <motion.div variants={foto} className="absolute inset-0">
          <img src={cat.imagen} alt="" loading="lazy" decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1400ms] ease-out-rysa group-hover:rotate-[-1.5deg] group-hover:scale-110" />
        </motion.div>
        {/* Color del cuadro, 40 % más transparente que antes; más claro al pasar el cursor */}
        <div className="absolute inset-0 transition-opacity duration-700 ease-out-rysa group-hover:opacity-60 group-focus-visible:opacity-60"
          style={{ backgroundColor: rgba(e.fondo, e.tinte) }} aria-hidden="true" />

        <div className="relative flex h-full flex-col justify-between">
          {/* Banda del título */}
          <div className="flex items-start justify-between gap-4 p-5 pb-10 sm:p-7 sm:pb-12"
            style={{ background: `linear-gradient(to bottom, ${rgba(e.fondo, 0.94)} 0%, ${rgba(e.fondo, 0.82)} 55%, ${rgba(e.fondo, 0)} 100%)` }}>
            <h3 className="titular-fino text-[1.45rem] leading-tight sm:text-[1.8rem] lg:text-[2rem]">{cat.nombre}</h3>
            <span className="pt-1 font-display text-xs tabular-nums tracking-[0.2em]" style={{ color: e.suave }}>{String(indice + 1).padStart(2, "0")}</span>
          </div>

          {/* Banda de información: los tipos aparecen aquí dentro, sobre color sólido */}
          <div className="p-5 pt-10 sm:p-7 sm:pt-12"
            style={{ background: `linear-gradient(to top, ${rgba(e.fondo, 0.96)} 0%, ${rgba(e.fondo, 0.9)} 60%, ${rgba(e.fondo, 0)} 100%)` }}>
            <ul className="mb-4 hidden max-h-0 space-y-1.5 overflow-hidden text-[0.95rem] font-medium opacity-0 transition-all duration-700 ease-out-rysa [@media(hover:hover)]:block group-hover:max-h-40 group-hover:opacity-100 group-focus-visible:max-h-40 group-focus-visible:opacity-100"
              aria-hidden="true">
              {cat.tipos.slice(0, 4).map((t) => (
                <li key={t} className="flex items-center gap-3"><span className="h-px w-3 shrink-0" style={{ backgroundColor: e.acento }} />{t}</li>
              ))}
            </ul>
            <div className="flex items-end justify-between gap-4 border-t pt-4" style={{ borderColor: `${e.texto}40` }}>
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: e.suave }}>{aproximado(cat.articulos)} artículos</span>
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all duration-500 ease-out-rysa group-hover:scale-110"
                style={{ borderColor: `${e.texto}66` }} aria-hidden="true">
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
