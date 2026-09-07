import { useEffect } from "react";
import { useMap, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { money, fileUrl } from "@/lib/api";
import {
  ESTADO_DOT, ESTADO_LABEL, iconVendedor,
} from "@/lib/ubicaciones";
import { ClipboardList, ShoppingBag, Route as RouteIcon, User } from "lucide-react";

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
              <div className="flex items-center gap-2 mb-1.5">
                {v.foto_url ? (
                  <img src={fileUrl(v.foto_url)} alt={v.name} className="w-6 h-6 rounded-full object-cover border border-slate-200" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-orange-100 text-[#C1401E] flex items-center justify-center font-bold text-[10px]">
                    {(v.name || "V").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <b>{v.name}</b>
              </div>
              · {ESTADO_LABEL[v.estado] || v.estado}<br />
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
 * Muestra su información básica, foto, métricas del día y botones de acción rápida.
 */
export function TarjetaInfoVendedor({
  v, sinGps = false,
  onVerVisitas, onVerVentas,
  mostrarRuta = false, onToggleRuta,
}) {
  if (!v) return null;
  const ub = v.ultima_ubicacion || {};
  return (
    <div className="card-soft p-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3" data-testid="info-vendedor">
      <div className="flex items-center gap-3 min-w-[200px]">
        {v.foto_url ? (
          <img
            src={fileUrl(v.foto_url)}
            alt={v.name}
            className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#C1401E]/10 text-[#C1401E] flex items-center justify-center font-black text-base shrink-0">
            {(v.name || "V").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ESTADO_DOT[v.estado] || "#94a3b8" }} />
            <span className="font-bold text-slate-900">{v.name}</span>
            <Badge variant="outline" className="text-[10px] uppercase font-semibold">
              {ESTADO_LABEL[v.estado] || v.estado}
            </Badge>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{v.email}</div>
        </div>
      </div>

      {sinGps ? (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Sin ubicación GPS disponible — el vendedor no ha compartido posición o es inválida.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
        </div>
      )}

      {/* Botones de acción rápida solicitados en referencia visual */}
      <div className="flex flex-wrap items-center gap-2 border-t md:border-t-0 md:border-l border-slate-100 pt-2 md:pt-0 md:pl-4">
        {onVerVisitas && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onVerVisitas(v)}
            className="text-xs h-8 border-orange-200 text-orange-950 hover:bg-orange-50"
            title="Ver visitas realizadas hoy"
          >
            <ClipboardList className="w-3.5 h-3.5 mr-1 text-[#C1401E]" /> Visitas
          </Button>
        )}
        {onVerVentas && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onVerVentas(v)}
            className="text-xs h-8 border-emerald-200 text-emerald-950 hover:bg-emerald-50"
            title="Ver ventas y pedidos de hoy"
          >
            <ShoppingBag className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Ventas/Pedidos
          </Button>
        )}
        {onToggleRuta && !sinGps && (
          <Button
            size="sm"
            variant={mostrarRuta ? "default" : "outline"}
            onClick={onToggleRuta}
            className={`text-xs h-8 ${mostrarRuta ? "bg-[#C1401E] hover:bg-[#A03316] text-white" : "border-slate-200 text-slate-700"}`}
            title="Trazar histórico de recorrido con temperatura"
          >
            <RouteIcon className="w-3.5 h-3.5 mr-1" /> {mostrarRuta ? "Ocultar ruta" : "Ruta térmica"}
          </Button>
        )}
      </div>
    </div>
  );
}
