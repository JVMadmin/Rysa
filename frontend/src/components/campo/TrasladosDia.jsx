import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { fmtHora, hoyLocal } from "@/lib/fechas";
import { Input } from "@/components/ui/input";
import { ArrowRight, Clock, Loader2, MapPin, Navigation, PauseCircle, Route } from "lucide-react";

const duracion = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`);

function Dato({ icono: Icono, titulo, valor, detalle }) {
  return (
    <div className="card-soft p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400"><Icono className="h-3.5 w-3.5" /> {titulo}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-slate-800">{valor}</div>
      {detalle && <div className="text-xs text-slate-500">{detalle}</div>}
    </div>
  );
}

// Tiempos de traslado del vendedor en un día: paradas (≥ 5 min en un mismo
// lugar), traslados entre ellas y kilómetros, calculados con su rastro GPS.
export default function TrasladosDia({ vendedorId }) {
  const [fecha, setFecha] = useState(hoyLocal());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vendedorId) return;
    let vivo = true;
    setCargando(true); setError("");
    api.get(`/supervision/vendedores/${vendedorId}/traslados`, { params: { fecha } })
      .then(({ data }) => { if (vivo) setDatos(data); })
      .catch((e) => { if (vivo) { setDatos(null); setError(formatApiError(e.response?.data?.detail)); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [vendedorId, fecha]);

  const r = datos?.resumen;
  return (
    <div className="space-y-4" data-testid="traslados-dia">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Calculado con la ubicación que manda la app durante la jornada. Una parada es quedarse 5 min o más en el mismo lugar.</p>
        <Input type="date" value={fecha} max={hoyLocal()} onChange={(e) => setFecha(e.target.value || hoyLocal())} className="h-9 w-40" data-testid="traslados-fecha" />
      </div>

      {cargando ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-red-600">{error}</p>
      ) : !r?.inicio ? (
        <div className="card-soft p-6 text-center text-sm text-slate-500">
          Sin recorrido registrado ese día. La app manda la ubicación solo con la jornada iniciada y el permiso de ubicación «Permitir todo el tiempo».
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Dato icono={Clock} titulo="Jornada" valor={`${fmtHora(r.inicio)} – ${fmtHora(r.fin)}`} detalle={duracion(r.tiempo_total_min)} />
            <Dato icono={Route} titulo="Recorrido" valor={`${r.distancia_km.toFixed(1)} km`} />
            <Dato icono={Navigation} titulo="En movimiento" valor={duracion(r.tiempo_movimiento_min)} />
            <Dato icono={PauseCircle} titulo="Detenido" valor={duracion(r.tiempo_detenido_min)} />
            <Dato icono={MapPin} titulo="Paradas" valor={r.paradas} />
            <Dato icono={ArrowRight} titulo="Traslado promedio" valor={r.traslado_promedio_min ? duracion(r.traslado_promedio_min) : "—"} detalle="entre paradas" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card-soft overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Traslados</div>
              {datos.traslados.length === 0 ? <p className="p-4 text-sm text-slate-500">Sin traslados.</p> : (
                <ul className="divide-y divide-slate-100">
                  {datos.traslados.map((t) => (
                    <li key={t.inicio} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-700">{t.desde || "Sin cliente"} <ArrowRight className="inline h-3.5 w-3.5 text-slate-400" /> {t.hasta || "Sin cliente"}</div>
                        <div className="text-xs text-slate-500 tabular-nums">{fmtHora(t.inicio)} – {fmtHora(t.fin)}</div>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <div className="font-semibold text-slate-800">{duracion(t.duracion_min)}</div>
                        <div className="text-xs text-slate-500">{t.distancia_km.toFixed(1)} km</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card-soft overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Paradas</div>
              {datos.paradas.length === 0 ? <p className="p-4 text-sm text-slate-500">Sin paradas de 5 min o más.</p> : (
                <ul className="divide-y divide-slate-100">
                  {datos.paradas.map((p) => (
                    <li key={p.inicio} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-700">{p.lugar || "Lugar sin cliente"}</div>
                        <div className="text-xs text-slate-500 tabular-nums">{fmtHora(p.inicio)} – {fmtHora(p.fin)}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-semibold tabular-nums text-slate-800">{duracion(p.duracion_min)}</span>
                        <a href={`https://www.google.com/maps?q=${p.latitud},${p.longitud}`} target="_blank" rel="noreferrer" title="Ver en el mapa" className="text-slate-400 hover:text-brand-600"><MapPin className="h-4 w-4" /></a>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
