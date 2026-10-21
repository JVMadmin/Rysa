import { useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";

const DEFAULT_LOGO = "/brand/ISOTIPO-Photoroom.png";

// URL absolutas de un entorno local de desarrollo (persistidas en la BD) NO son
// útiles en producción/navegador del cliente; se descartan y se usa el logo por
// defecto. Esto evita que un logo_url "muerto" oculte el logotipo del ERP.
const esLocal = (u) => /localhost|127\.0\.0\.1|192\.168\.|10\.0\./.test(u || "");

export { DEFAULT_LOGO };

const VACIO = {
  empresa_nombre: "Grupo RYSA", logo_url: "", correo: "", telefono: "",
  whatsapp: "", direccion: "", ciudad: "", estado: "", horario: "",
};

// Una sola petición por carga de página aunque varios componentes usen el hook.
let cache = null;

export function useBranding() {
  const [brand, setBrand] = useState(cache || VACIO);
  useEffect(() => {
    if (!cache) {
      cache = api.get("/settings/branding")
        .then((r) => ({ ...VACIO, ...(r.data || {}), empresa_nombre: r.data?.empresa_nombre || "Grupo RYSA" }))
        .catch(() => VACIO);
    }
    Promise.resolve(cache).then((b) => { cache = b; setBrand(b); });
  }, []);
  const raw = brand.logo_url;
  const logo = raw && !esLocal(raw) ? fileUrl(raw) : DEFAULT_LOGO;
  return { ...brand, logo };
}
