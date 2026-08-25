import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from "react-leaflet";
import { MapPinOff } from "lucide-react";
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
        <MapContainer center={PALENQUE} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer url={MAP_THEME} attribution={MAP_ATTRIBUTION} />
          {/* Encuadre de flota en cada refresh de datos */}
          <Encajar pts={todosPts} trigger={autoFitKey} />
          {/* Vuelo a selección (cliente desde listado o marcador) */}
          {selCli && <Volar pos={selCli.pos} zoom={16} trigger={`${selCli.id}|${enfocarTrigger}`} />}
          {selVen && <Volar pos={selVen.pos} zoom={15} trigger={selVen.id} />}

          {/* Track GPS del día (Mi Ruta / vendedor seleccionado) */}
          {rutaGps.length > 1 && (
            <>
              <Polyline positions={rutaGps.map((p) => [Number(p.latitud), Number(p.longitud)])}
                        pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.75, dashArray: "6 6" }} />
              {rutaGps.map((p, i) => (
                <CircleMarker key={p.id || i} center={[Number(p.latitud), Number(p.longitud)]}
                  radius={4} pathOptions={{ color: "#fff", weight: 1.5, fillColor: i === 0 ? "#16a34a" : "#2563eb", fillOpacity: 0.95 }}>
                  <Popup>
                    <div className="text-xs">
                      <b>{i === 0 ? "Inicio de ruta" : `Punto ${i + 1}`}</b> · {(p.fecha || "").slice(11, 16)}<br />
                      Precisión: {p.precision ?? "—"} m{p.velocidad_kmh != null ? <> · Vel: {p.velocidad_kmh} km/h</> : null}
                    </div>
                  </Popup>
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
