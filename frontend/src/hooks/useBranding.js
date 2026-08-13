import { useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";

const DEFAULT_LOGO = "/brand/ISOTIPO-Photoroom.png";

export function useBranding() {
  const [brand, setBrand] = useState({ empresa_nombre: "Grupo RYSA", logo_url: "" });
  useEffect(() => {
    api.get("/settings/branding")
      .then((r) => setBrand({ empresa_nombre: r.data?.empresa_nombre || "Grupo RYSA", logo_url: r.data?.logo_url || "" }))
      .catch(() => {});
  }, []);
  return { ...brand, logo: brand.logo_url ? fileUrl(brand.logo_url) : DEFAULT_LOGO };
}
