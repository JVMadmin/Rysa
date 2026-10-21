// Categorías del sitio público de Grupo RYSA.
//
// Fuente: inventario real del ERP (consulta de solo lectura del 2026-10-20,
// 2,260 productos activos). Las familias se dedujeron de las descripciones,
// porque el campo `linea` del ERP guarda la marca, no la familia. Las marcas
// citadas aparecen en ese inventario. Los conteos se muestran redondeados
// hacia abajo para no envejecer mal ("más de 500").
//
// Imágenes: representativas de la familia (Unsplash, licencia de uso
// comercial). Ver public/images/categorias/FUENTES.md. No son fotos de un
// artículo concreto.

export const CATEGORIAS = [
  {
    slug: "desechables",
    nombre: "Desechables para alimentos",
    corto: "Desechables",
    resumen: "Vasos, tapas, charolas, contenedores con bisagra y todo lo necesario para servir y entregar comida.",
    descripcion:
      "La línea con más variedad del inventario: vasos térmicos y de plástico en varias capacidades con sus tapas, charolas, contenedores con bisagra, domos, platos, cubiertos, popotes y vasos soufflé. Pensada para fondas, taquerías, cafeterías, eventos y venta para llevar.",
    imagen: "/images/categorias/desechables.webp",
    imagenAlt: "Vaso térmico con tapa y contenedores desechables para comida",
    articulos: 550,
    tipos: ["Vasos térmicos y de plástico", "Tapas para vaso", "Contenedores con bisagra", "Charolas", "Domos", "Platos", "Cubiertos", "Popotes", "Vasos soufflé", "Servilletas y palillos"],
    marcas: ["REYMA", "INIX", "PRIMO", "Garduño", "Serviplastic"],
  },
  {
    slug: "bolsas",
    nombre: "Bolsas, rollos y película",
    corto: "Bolsas y rollos",
    resumen: "Bolsas tipo camiseta, bolsas naturales, rollos, celofán, bolsas zip, Vitafilm y emplaye.",
    descripcion:
      "Para empacar, despachar y proteger: bolsas tipo camiseta en tamaños chico a jumbo, bolsas naturales y negras para basura, rollos en distintas medidas, celofán, bolsas con cierre, película Vitafilm y emplaye para tarimas.",
    imagen: "/images/categorias/bolsas.webp",
    imagenAlt: "Bolsa de plástico tipo camiseta",
    articulos: 427,
    tipos: ["Bolsas tipo camiseta (asa)", "Bolsas naturales", "Bolsas negras para basura", "Rollos", "Celofán", "Bolsas zip", "Vitafilm", "Emplaye"],
    marcas: ["Chiaplast", "Politab", "REYMA", "Dinastía", "Serviplastic", "Coplasur", "Banaplastic"],
  },
  {
    slug: "limpieza",
    nombre: "Limpieza e higiene",
    corto: "Limpieza",
    resumen: "Escobas, trapeadores, fibras, cepillos y artículos para mantener limpio el negocio y el hogar.",
    descripcion:
      "Escobas tipo abanico y de cepillo, trapeadores, fibras metálicas y de esponja, cepillos, jabones y detergentes. Artículos de uso diario para negocios, oficinas y hogares.",
    imagen: "/images/categorias/limpieza.webp",
    imagenAlt: "Escobas de colores en exhibición",
    articulos: 157,
    tipos: ["Escobas", "Trapeadores", "Fibras", "Cepillos", "Jabones y detergentes", "Guantes"],
    marcas: ["Aguirey", "Ideal", "Perico"],
  },
  {
    slug: "recipientes",
    nombre: "Recipientes y artículos plásticos",
    corto: "Recipientes",
    resumen: "Cubetas, palanganas, tambos, bateas, canastas y bebederos para el hogar, el negocio y el campo.",
    descripcion:
      "Plásticos de uso rudo y diario: cubetas, palanganas, tambos, bateas, tinas, canastas, botes y bebederos y comederos para el campo.",
    imagen: "/images/categorias/recipientes.webp",
    imagenAlt: "Anaquel con cubetas y tinas de plástico",
    articulos: 121,
    tipos: ["Cubetas", "Palanganas", "Tambos", "Bateas y tinas", "Canastas", "Botes", "Bebederos y comederos"],
    marcas: ["Cubasa", "Aguirey"],
  },
  {
    slug: "reposteria",
    nombre: "Repostería y presentación",
    corto: "Repostería",
    resumen: "Bases de cartón doradas y plateadas, cenefas, adhesivos y papel para presentar pasteles y regalos.",
    descripcion:
      "Para pastelerías, panaderías y tiendas de regalos: bases de cartón redondas y rectangulares en dorado y plateado, cenefas, adhesivos, papel, moldes y aluminio.",
    imagen: "/images/categorias/reposteria.webp",
    imagenAlt: "Caja de repostería con panqués",
    articulos: 179,
    tipos: ["Bases de cartón doradas y plateadas", "Cenefas", "Adhesivos", "Papel", "Moldes", "Aluminio"],
    marcas: ["Garduño"],
  },
  {
    slug: "ferreteria-campo",
    nombre: "Ferretería y campo",
    corto: "Ferretería y campo",
    resumen: "Lonas de uso rudo, cuerdas, mallas, cintas, limas, focos, morrales y sombreros.",
    descripcion:
      "Lonas de uso rudo en varias medidas, cuerdas, malla mosquitera, cintas masking y de empaque, limas, focos y encendedores, además de morrales, sombreros de palma y jaulas.",
    imagen: "/images/categorias/ferreteria.webp",
    imagenAlt: "Muro de exhibición con herramientas y artículos de ferretería",
    imagenSecundaria: "/images/categorias/lonas.webp",
    imagenSecundariaAlt: "Bolsas tejidas de colores en un mercado",
    articulos: 210,
    tipos: ["Lonas de uso rudo", "Cuerdas", "Malla mosquitera", "Cintas", "Limas", "Focos", "Encendedores", "Morrales", "Sombreros", "Jaulas"],
    marcas: ["Truper", "Fiero", "Bellota", "Philips"],
  },
];

export const TOTAL_ARTICULOS = 2260;

export const porSlug = (slug) => CATEGORIAS.find((c) => c.slug === slug);

// "más de 500" a partir de 550: redondea hacia abajo y siempre por debajo del
// valor real, para que "más de" sea cierto.
export function aproximado(n) {
  const m = n - 1;
  if (n > 1000) return `más de ${(Math.floor(m / 100) * 100).toLocaleString("es-MX")}`;
  if (n > 100) return `más de ${Math.floor(m / 50) * 50}`;
  return `más de ${Math.max(0, Math.floor(m / 10) * 10)}`;
}
