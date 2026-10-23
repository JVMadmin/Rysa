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
  { slug: "cubasa", nombre: "Cubasa" },
  { slug: "ideal", nombre: "Ideal" },
  { slug: "poliplast", nombre: "Poliplast" },
  { slug: "coplasur", nombre: "Coplasur" },
  { slug: "tarasquito", nombre: "Tarasquito" },
  { slug: "banaplastic", nombre: "Banaplastic" },
  { slug: "anguiplast", nombre: "Anguiplast" },
  { slug: "truper", nombre: "Truper" },
];

export const marcaPorSlug = (slug) => MARCAS_SITIO.find((m) => m.slug === slug);
