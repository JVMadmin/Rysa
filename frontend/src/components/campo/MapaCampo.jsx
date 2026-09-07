import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import { MapPinOff, Crosshair } from "lucide-react";
import ErrorBoundaryMapa from "@/components/campo/ErrorBoundaryMapa";
import {
  MAP_THEME, MAP_ATTRIBUTION, PALENQUE,
  iconCliente, iconVendedor, ESTADO_LABEL, coordValida, boundsDe,
} from "@/lib/ubicaciones";
import { money, fileUrl } from "@/lib/api";

/* ------------------------- helpers internos de vuelo ------------------------ */
function Volar({ pos, zoom = 15, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (pos && coordValida(pos[0], pos[1])) {
      try { map.flyTo(pos, zoom, { duration: 0.8 }); } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

function Encajar({ pts, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (!pts?.length) return;
    try { map.flyToBounds(boundsDe(pts), { padding: [40, 40], duration: 0.8 }); } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

/** Captura de coordenada al hacer clic en el mapa (modo "ubicar cliente"). */
function ClickCatcher({ activo, onPick }) {
  useMapEvents({
    click(e) {
      if (activo && onPick) onPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

/**
 * ===========================================================================
 * MapaCampo — ÚNICO componente de mapa parametrizable del sistema.
 * Lo usan Supervisión Comercial (mapa en vivo + clientes) y Mi Actividad de
 * Campo (mis visitas + mi ruta). También podría adoptarlo Supervisión.
 *
 * Props:
 *  - clientes:      [{id,nombre,saldo,vencido,ultima_visita,telefono,direccion,
 *                     ciudad,vendedor_nombre,latitud,longitud}] — coords se
 *                    validan aquí; inválidas se ignoran.
 *  - vendedores:    lista YA normalizada por separarVendedores() ({pos,...}).
 *  - rutaGps:       [{id,latitud,longitud,fecha,precision,velocidad_kmh}]
 *  - selClienteId / onSelectCliente(id): fila↔mapa bidireccional; el cliente
 *    seleccionado vuela al centro, se resalta y su ficha vive fuera.
 *  - selVendedorId / onSelectVendedor(id)
 *  - enfocarTrigger: nº que al cambiar re-vuela al cliente seleccionado
 *    (botón "Ubicar" del listado).
 *  - altura, autoFitKey, vacio:{titulo,texto}
 */
export default function MapaCampo({
  clientes = [], vendedores = [], rutaGps = [],
  selClienteId = "", onSelectCliente,
  selVendedorId = "", onSelectVendedor,
  enfocarTrigger = 0, altura = "480px", autoFitKey = 0,
  vacio = null, mostrarClientes = true, mostrarVendedores = true,
  modoCaptura = false, onCapturaPunto,
  rutaSugeridaPts = [],
}) {
  const cliValidos = useMemo(
    () => clientes.map((c) => ({ ...c, pos: coordValida(c.latitud, c.longitud) ? [Number(c.latitud), Number(c.longitud)] : null }))
                 .filter((c) => c.pos),
    [clientes]);
  const venValidos = useMemo(() => (vendedores || []).filter((v) => v.pos && coordValida(v.pos[0], v.pos[1])), [vendedores]);

  const todosPts = useMemo(() => [
    ...(mostrarClientes ? cliValidos.map((c) => c.pos) : []),
    ...(mostrarVendedores ? venValidos.map((v) => v.pos) : []),
  ], [cliValidos, venValidos, mostrarClientes, mostrarVendedores]);

  const selCli = cliValidos.find((c) => c.id === selClienteId) || null;
  const selVen = venValidos.find((v) => v.id === selVendedorId) || null;

  const sinDatos = todosPts.length === 0 && rutaGps.length === 0;

  return (
    <div className="rounded-lg overflow-hidden border border-slate-200 relative" style={{ height: altura }}>
      <ErrorBoundaryMapa>
        <MapContainer center={PALENQUE} zoom={12}
          style={{ height: "100%", width: "100%", cursor: modoCaptura ? "crosshair" : "" }}>
          <TileLayer url={MAP_THEME} attribution={MAP_ATTRIBUTION} />
          <ClickCatcher activo={modoCaptura} onPick={onCapturaPunto} />
          {/* Encuadre de flota solo si no hay vendedor seleccionado */}
          <Encajar pts={selVendedorId ? [] : todosPts} trigger={autoFitKey} />
          {/* Vuelo y seguimiento en vivo al vendedor seleccionado */}
          {selCli && <Volar pos={selCli.pos} zoom={16} trigger={`${selCli.id}|${enfocarTrigger}`} />}
          {selVen && <Volar pos={selVen.pos} zoom={16} trigger={`${selVen.id}|${selVen.pos[0]}|${selVen.pos[1]}`} />}

          {/* Track GPS del día con indicador tipo temperatura cronológica */}
          {rutaGps.length > 1 && (
            <>
              {/* Segmentos coloreados por temperatura cronológica */}
              {rutaGps.slice(0, -1).map((p, i) => {
                const nextP = rutaGps[i + 1];
                const ratio = rutaGps.length > 1 ? i / (rutaGps.length - 1) : 0;
                // Gradiente térmico: Cyan frío (mañana) -> Azul -> Amarillo (mediodía) -> Naranja -> Rojo cálido (tarde/noche)
                let color = "#06b6d4";
                if (ratio > 0.75) color = "#dc2626"; // Rojo cálido
                else if (ratio > 0.5) color = "#f97316"; // Naranja
                else if (ratio > 0.25) color = "#eab308"; // Amarillo
                else if (ratio > 0.1) color = "#2563eb"; // Azul
                
                return (
                  <Polyline
                    key={`seg-${p.id || i}`}
                    positions={[
                      [Number(p.latitud), Number(p.longitud)],
                      [Number(nextP.latitud), Number(nextP.longitud)],
                    ]}
                    pathOptions={{ color, weight: 5, opacity: 0.85 }}
                  />
                );
              })}

              {/* Puntos clave de paso con hora exacta */}
              {rutaGps.map((p, i) => {
                const ratio = rutaGps.length > 1 ? i / (rutaGps.length - 1) : 0;
                let dotColor = "#06b6d4";
                if (ratio > 0.75) dotColor = "#dc2626";
                else if (ratio > 0.5) dotColor = "#f97316";
                else if (ratio > 0.25) dotColor = "#eab308";
                else if (ratio > 0.1) dotColor = "#2563eb";

                const isStart = i === 0;
                const isEnd = i === rutaGps.length - 1;
                const timeStr = (p.fecha || "").slice(11, 19) || "--:--";

                return (
                  <CircleMarker
                    key={p.id || i}
                    center={[Number(p.latitud), Number(p.longitud)]}
                    radius={isStart || isEnd ? 6.5 : 4}
                    pathOptions={{
                      color: "#ffffff",
                      weight: isStart || isEnd ? 2 : 1,
                      fillColor: isStart ? "#16a34a" : isEnd ? "#dc2626" : dotColor,
                      fillOpacity: 0.95,
                    }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1">
                        <div className="font-bold text-slate-800 flex items-center justify-between gap-2">
                          <span>{isStart ? "🏁 Inicio de ruta" : isEnd ? "📍 Posición más reciente" : `Paso #${i + 1}`}</span>
                          <span className="font-mono text-[#C1401E]">{timeStr}</span>
                        </div>
                        <div className="text-slate-500">
                          Hora: <b>{timeStr}</b><br />
                          Precisión: {p.precision != null ? `±${p.precision} m` : "—"}<br />
                          {p.velocidad_kmh != null ? `Velocidad: ${p.velocidad_kmh} km/h` : ""}
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </>
          )}

          {/* Ruta sugerida numerada (orden óptimo de visitas) */}
          {rutaSugeridaPts.length > 1 && (
            <>
              <Polyline positions={rutaSugeridaPts.map((p) => p.pos)}
                        pathOptions={{ color: "#f59e0b", weight: 4, opacity: 0.85 }} />
              {rutaSugeridaPts.map((p, i) => (
                <CircleMarker key={`rs-${p.id || i}`} center={p.pos} radius={11}
                  pathOptions={{ color: "#fff", weight: 2, fillColor: "#f59e0b", fillOpacity: 1 }}>
                  <Popup><div className="text-xs"><b>{i + 1}.</b> {p.nombre}</div></Popup>
                </CircleMarker>
              ))}
            </>
          )}

          {/* Vendedores (solo activos con GPS válido, ya filtrados arriba) */}
          {mostrarVendedores && venValidos.map((v) => (
            <Marker key={`v-${v.id}`} position={v.pos}
                    icon={iconVendedor(v.estado, v.id === selVendedorId)}
                    eventHandlers={{ click: () => onSelectVendedor && onSelectVendedor(v.id) }}>
              <Popup>
                <div className="text-xs" style={{ minWidth: 180 }}>
                  <b>{v.name}</b> · {ESTADO_LABEL[v.estado] || v.estado}<br />
                  Ventas hoy: {money(v.ventas_hoy?.monto)} · Cobros: {money(v.cobros_hoy)}<br />
                  CxC vencido: {money(v.cxc?.vencido)}<br />
                  <span className="text-slate-400">Últ. GPS: {(v.ultima_ubicacion?.fecha || "").slice(0, 16).replace("T", " ")}</span>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Clientes con ficha rápida vía popup + selección */}
          {mostrarClientes && cliValidos.map((c) => (
            <Marker key={`c-${c.id}`} position={c.pos}
                    icon={iconCliente(c, c.id === selClienteId)}
                    eventHandlers={{ click: () => onSelectCliente && onSelectCliente(c.id) }}>
              <Popup>
                <div className="text-xs">
                  {c.foto_fachada && (
                    <img src={fileUrl(c.foto_fachada)} alt={`Fachada de ${c.nombre}`}
                         className="w-44 h-24 object-cover rounded mb-1.5 border border-slate-200" loading="lazy" />
                  )}
                  <b>{c.nombre}</b>{c.vendedor_nombre ? ` · ${c.vendedor_nombre}` : ""}<br />
                  {c.direccion && <span>{c.direccion}<br /></span>}
                  {Number(c.vencido || 0) > 0
                    ? <span className="text-red-600">Vencido: {money(c.vencido)}</span>
                    : Number(c.saldo || 0) > 0 ? `Saldo: ${money(c.saldo)}` : <span className="text-green-600">Sin saldo</span>}<br />
                  {c.ultima_visita ? `Últ. visita: ${String(c.ultima_visita).slice(0, 10)}` : "Sin visitas"}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </ErrorBoundaryMapa>

      {modoCaptura && (
        <div className="absolute inset-x-0 bottom-0 z-[500] bg-[#C1401E] text-white text-xs font-semibold px-3 py-2 flex items-center gap-2 pointer-events-none">
          <Crosshair className="w-4 h-4" />
          Toca el punto exacto del negocio en el mapa para asignar la ubicación…
        </div>
      )}

      {sinDatos && vacio && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center pointer-events-none">
          <div className="bg-white/95 border border-slate-200 rounded-xl shadow-sm px-6 py-5 text-center pointer-events-auto max-w-sm" data-testid="mapa-campo-vacio">
            <MapPinOff className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <div className="font-semibold text-slate-700 text-sm">{vacio.titulo}</div>
            {vacio.texto && <p className="text-xs text-slate-400 mt-1">{vacio.texto}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
