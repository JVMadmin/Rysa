// Piezas de movimiento del sitio público (framer-motion).
// Todas respetan `prefers-reduced-motion`: SitioLayout envuelve el sitio en
// <MotionConfig reducedMotion="user"> y los valores ligados al scroll se
// anulan con useReducedMotion().
import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";

export const EASE = [0.2, 0.7, 0.2, 1];

// Aparece al entrar en pantalla: sube y se desvanece.
export function Revelar({ as = "div", delay = 0, y = 28, className, children, ...rest }) {
  const M = motion[as];
  return (
    <M className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }} transition={{ duration: 0.8, ease: EASE, delay }} {...rest}>
      {children}
    </M>
  );
}

// Contenedor que escalona la entrada de sus hijos <Elemento>.
export function Escalonar({ as = "div", paso = 0.08, className, children, ...rest }) {
  const M = motion[as];
  return (
    <M className={className} initial="oculto" whileInView="visible" viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      variants={{ visible: { transition: { staggerChildren: paso } } }} {...rest}>
      {children}
    </M>
  );
}

export function Elemento({ as = "div", y = 22, className, children, ...rest }) {
  const M = motion[as];
  return (
    <M className={className} variants={{ oculto: { opacity: 0, y }, visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } }} {...rest}>
      {children}
    </M>
  );
}

// Titular que entra palabra por palabra, cada una saliendo de su propia máscara.
// `palabra` da clase a cada palabra (p. ej. "metal") y `resaltar` lista los
// índices de palabras que van en rojo RYSA.
export function TitularPalabras({ texto, as = "h1", delay = 0, className, palabra = "", resaltar = [], ...rest }) {
  const M = motion[as];
  const palabras = texto.split(" ");
  return (
    <M className={className} initial="oculto" animate="visible" aria-label={texto}
      variants={{ visible: { transition: { staggerChildren: 0.06, delayChildren: delay } } }} {...rest}>
      {palabras.map((p, i) => (
        <span key={i} aria-hidden="true" className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span className={`inline-block ${resaltar.includes(i) ? "text-brand-400" : palabra}`}
            variants={{ oculto: { y: "105%" }, visible: { y: 0, transition: { duration: 0.9, ease: EASE } } }}>
            {p}
          </motion.span>
          {i < palabras.length - 1 && " "}
        </span>
      ))}
    </M>
  );
}

// Línea roja fina que se dibuja de izquierda a derecha.
export function Regla({ className = "", delay = 0, ancho = "w-16" }) {
  return (
    <motion.span aria-hidden="true" className={`block h-px origin-left bg-brand-500 ${ancho} ${className}`}
      initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
      transition={{ duration: 1, ease: EASE, delay }} />
  );
}

// Imagen que se descubre con una cortina (clip-path) al entrar en pantalla.
export function Cortina({ src, alt = "", className = "", imgClassName = "", delay = 0, desde = "derecha", ...img }) {
  const inicio = desde === "abajo" ? "inset(100% 0 0 0)" : "inset(0 0 0 100%)";
  return (
    <motion.div className={`overflow-hidden ${className}`} initial={{ clipPath: inicio }}
      whileInView={{ clipPath: "inset(0 0 0 0%)" }} viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 1.1, ease: EASE, delay }}>
      <motion.img src={src} alt={alt} decoding="async" className={`h-full w-full object-cover ${imgClassName}`}
        initial={{ scale: 1.18 }} whileInView={{ scale: 1 }} viewport={{ once: true }}
        transition={{ duration: 1.6, ease: EASE, delay }} {...img} />
    </motion.div>
  );
}

// Imagen con desplazamiento parallax ligado al scroll.
export function Parallax({ src, alt = "", className = "", intensidad = 70, ...img }) {
  const ref = useRef(null);
  const reducir = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reducir ? [0, 0] : [-intensidad, intensidad]);
  return (
    <div ref={ref} className={`overflow-hidden ${className}`}>
      <motion.img src={src} alt={alt} decoding="async" style={{ y, scale: reducir ? 1 : 1.18 }}
        className="h-full w-full object-cover" {...img} />
    </div>
  );
}

// Cifra que cuenta hasta su valor al aparecer. El lector de pantalla lee el valor final.
export function Contador({ valor, prefijo = "", className }) {
  const ref = useRef(null);
  const visto = useInView(ref, { once: true });
  const reducir = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!visto) return;
    if (reducir) { setN(valor); return; }
    const control = animate(0, valor, { duration: 1.6, ease: EASE, onUpdate: (v) => setN(Math.round(v)) });
    return () => control.stop();
  }, [visto, valor, reducir]);
  return (
    <span ref={ref} className={className}>
      <span className="sr-only">{prefijo}{valor.toLocaleString("es-MX")}</span>
      <span aria-hidden="true">{prefijo}{n.toLocaleString("es-MX")}</span>
    </span>
  );
}
