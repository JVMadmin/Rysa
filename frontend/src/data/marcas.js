// Marcas que distribuye Grupo RYSA. El listado con productos y precios viene
// del backend (/api/publico/marcas); aquí solo lo que es de presentación.
// Logotipos: public/brand/marcas/FUENTES.md. Sin logo se muestra el nombre.
export const MARCAS_SITIO = [
  { slug: "reyma", nombre: "REYMA", logo: "/brand/marcas/reyma.webp" },
  { slug: "inix", nombre: "INIX", logo: "/brand/marcas/inix.webp" },
  { slug: "chiaplast", nombre: "Chiaplast", logo: "/brand/marcas/chiaplast.webp" },
  { slug: "aguirey", nombre: "Aguirey" },
  { slug: "politab", nombre: "Politab" },
  { slug: "primo", nombre: "PRIMO", logo: "/brand/marcas/primo.webp" },
  { slug: "dinastia", nombre: "Dinastía" },
  { slug: "garduno", nombre: "Garduño" },
  { slug: "serviplastic", nombre: "Serviplastic" },
  { slug: "cubasa", nombre: "Cubasa", logo: "/brand/marcas/cubasa.webp" },
  { slug: "ideal", nombre: "Ideal", logo: "/brand/marcas/ideal.webp" },
  { slug: "poliplast", nombre: "Poliplast" },
  { slug: "coplasur", nombre: "Coplasur", logo: "/brand/marcas/coplasur.webp" },
  { slug: "tarasquito", nombre: "Tarasquito", logo: "/brand/marcas/tarasquito.webp" },
  { slug: "banaplastic", nombre: "Banaplastic", logo: "/brand/marcas/banaplastic.webp" },
  { slug: "anguiplast", nombre: "Anguiplast", logo: "/brand/marcas/anguiplast.webp" },
  { slug: "truper", nombre: "Truper", logo: "/brand/marcas/truper.webp" },
];

export const marcaPorSlug = (slug) => MARCAS_SITIO.find((m) => m.slug === slug);
