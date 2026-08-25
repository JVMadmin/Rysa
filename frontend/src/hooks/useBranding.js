import { useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";

const DEFAULT_LOGO = "/brand/ISOTIPO-Photoroom.png";

// URL absolutas de un entorno local de desarrollo (persistidas en la BD) NO son
// útiles en producción/navegador del cliente; se descartan y se usa el logo por
// defecto. Esto evita que un logo_url "muerto" oculte el logotipo del ERP.
const esLocal = (u) => /localhost|127\.0\.0\.1|192\.168\.|10\.0\./.test(u || "");

export { DEFAULT_LOGO };

export function useBranding() {
  const [brand, setBrand] = useState({ empresa_nombre: "Grupo RYSA", logo_url: "" });
  useEffect(() => {
    api.get("/settings/branding")
      .then((r) => setBrand({ empresa_nombre: r.data?.empresa_nombre || "Grupo RYSA", logo_url: r.data?.logo_url || "" }))
      .catch(() => {});
  }, []);
  const raw = brand.logo_url;
  const logo = raw && !esLocal(raw) ? fileUrl(raw) : DEFAULT_LOGO;
  return { ...brand, logo };
}
