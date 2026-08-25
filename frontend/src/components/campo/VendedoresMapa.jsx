import { useEffect } from "react";
import { useMap, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/api";
import {
  ESTADO_DOT, ESTADO_LABEL, iconVendedor,
} from "@/lib/ubicaciones";

/** Vuela (centra + zoom) hacia `pos` cada vez que cambia `trigger`. */
export function VolarA({ pos, zoom = 15, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) {
      map.flyTo(pos, zoom, { duration: 0.8 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

/** Ajusta el mapa a los puntos de la flota (opción "Todos"). */
export function EncajarFlota({ pts, trigger }) {
  const map = useMap();
  useEffect(() => {
    const valides = (pts || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!valides.length) return;
    try {
      map.flyToBounds(L.latLngBounds(valides), { padding: [40, 40], duration: 0.8 });
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

const fmtUbic = (f) => (f || "").slice(0, 16).replace("T", " ");

/** Marcadores de vendedores (solo reciben lista YA validada y normalizada). */
export function CapaVendedores({ vendedores = [], seleccionado = "", onSelect }) {
  return (
    <>
      {vendedores.map((v) => (
        <Marker key={v.id} position={v.pos}
                icon={iconVendedor(v.estado, v.id === seleccionado)}
                eventHandlers={{ click: () => onSelect && onSelect(v.id) }}>
          <Popup>
            <div className="text-xs" style={{ minWidth: 180 }}>
              <b>{v.name}</b> · {ESTADO_LABEL[v.estado] || v.estado}<br />
              Ventas hoy: {money(v.ventas_hoy?.monto)} · Cobros: {money(v.cobros_hoy)}<br />
              CxC vencido: {money(v.cxc?.vencido)}<br />
              <span className="text-slate-400">Últ. GPS: {fmtUbic(v.ultima_ubicacion?.fecha)}</span>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

/**
 * Panel informativo del vendedor seleccionado (compartido Mapas/Rutas).
 * Muestra su información básica; si no tiene GPS activo lo indica claramente.
 */
export function TarjetaInfoVendedor({ v, sinGps = false }) {
  if (!v) return null;
  const ub = v.ultima_ubicacion || {};
  return (
    <div className="card-soft p-4 flex flex-wrap items-start gap-x-6 gap-y-3" data-testid="info-vendedor">
      <div className="min-w-[160px]">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: ESTADO_DOT[v.estado] || "#94a3b8" }} />
          <span className="font-semibold text-slate-900">{v.name}</span>
          <Badge variant="outline" className="text-[10px] uppercase">
            {ESTADO_LABEL[v.estado] || v.estado}
          </Badge>
        </div>
        <div className="text-xs text-slate-400 mt-0.5">{v.email}</div>
      </div>

      {sinGps ? (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Sin ubicación GPS disponible — el vendedor no ha compartido posición o es inválida.
        </div>
      ) : (
        <>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Última ubicación</div>
            <div className="text-sm font-medium">{fmtUbic(ub.fecha) || "—"}</div>
            <div className="text-[11px] text-slate-400">
              {Number.isFinite(Number(ub.latitud)) ? `${Number(ub.latitud).toFixed(5)}, ${Number(ub.longitud).toFixed(5)}` : ""}
              {ub.precision != null ? ` · ±${ub.precision} m` : ""}
              {ub.bateria_pct != null ? ` · 🔋${ub.bateria_pct}%` : ""}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Ventas hoy</div>
            <div className="text-sm font-semibold text-slate-800">{money(v.ventas_hoy?.monto)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Cobros hoy</div>
            <div className="text-sm font-semibold text-emerald-700">{money(v.cobros_hoy)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">CxC vencido</div>
            <div className={`text-sm font-semibold ${(v.cxc?.vencido || 0) > 0 ? "text-red-600" : "text-slate-500"}`}>
              {money(v.cxc?.vencido)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Visitas hoy</div>
            <div className="text-sm font-semibold text-slate-700">{v.visitas?.hoy ?? 0}</div>
          </div>
        </>
      )}
    </div>
  );
}
