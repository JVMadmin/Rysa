import { useMemo, useRef, useState, useEffect } from "react";
import { ESTADO_DOT, ESTADO_LABEL } from "@/lib/ubicaciones";
import { Search, Users, MapPinOff } from "lucide-react";

/**
 * Selector de vendedores activos con ubicación GPS válida.
 * Compartido por Mapas y Rutas: misma fuente (/supervision/map) y mismos
 * filtros (ver lib/ubicaciones.separarVendedores).
 *
 * props:
 *  - vendedores: lista ya normalizada (resultado de separarVendedores().enMapa)
 *  - valor: id del vendedor seleccionado o "" = Todos
 *  - onChange(id)
 *  - sinGpsCount: nº de vendedores activos sin GPS (solo informativo)
 */
export default function SelectorVendedor({ vendedores = [], valor = "", onChange,
                                            sinGpsCount = 0 }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const fuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return vendedores;
    return vendedores.filter((v) =>
      `${v.name || ""} ${v.email || ""}`.toLowerCase().includes(t));
  }, [q, vendedores]);

  const sel = vendedores.find((v) => v.id === valor);
  const haceMin = (f) => {
    if (!f) return null;
    const ms = Date.now() - new Date(f).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const m = Math.floor(ms / 60000);
    return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`;
  };

  if (!vendedores.length) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-dashed border-slate-300 text-sm text-slate-400"
           data-testid="selector-vendedor-vacio">
        <MapPinOff className="w-4 h-4" />
        Sin vendedores activos con GPS
        {sinGpsCount > 0 && <span className="text-[11px]">· {sinGpsCount} sin ubicación</span>}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref} data-testid="selector-vendedor">
      <button type="button" onClick={() => setAbierto((o) => !o)}
        className="h-9 min-w-[210px] max-w-[280px] flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-sm hover:border-slate-300">
        <Users className="w-4 h-4 text-slate-400 shrink-0" />
        {sel ? (
          <>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ESTADO_DOT[sel.estado] || "#94a3b8" }} />
            <span className="truncate font-medium">{sel.name}</span>
          </>
        ) : (
          <span className="truncate text-slate-600">Todos los vendedores ({vendedores.length})</span>
        )}
      </button>

      {abierto && (
        <div className="absolute z-[1000] mt-1 w-72 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar vendedor…"
                className="w-full h-8 pl-8 pr-2 text-sm rounded-md border border-slate-200 focus:outline-none focus:border-slate-400" />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button type="button"
              onClick={() => { onChange(""); setAbierto(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${!valor ? "bg-slate-50 font-semibold" : ""}`}
              data-testid="selector-vendedor-todos">
              Todos ({vendedores.length})
            </button>
            {filtrados.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">Sin coincidencias.</div>
            )}
            {filtrados.map((v) => (
              <button key={v.id} type="button"
                onClick={() => { onChange(v.id); setAbierto(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${valor === v.id ? "bg-slate-50" : ""}`}
                data-testid={`selector-vendedor-${v.id}`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ESTADO_DOT[v.estado] || "#94a3b8" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{v.name}</span>
                  <span className="block text-[11px] text-slate-400 truncate">
                    {ESTADO_LABEL[v.estado] || v.estado}
                    {haceMin(v.ultima_ubicacion?.fecha) ? ` · GPS ${haceMin(v.ultima_ubicacion.fecha)}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {sinGpsCount > 0 && (
            <div className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100 bg-slate-50">
              {sinGpsCount} vendedor(es) activo(s) sin ubicación GPS no se muestran en el mapa.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
