import { useEffect, useMemo, useState } from "react";
import { api, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, Map as MapIcon, RefreshCw, Crosshair, Users, Store, Route as RouteIcon } from "lucide-react";

// Centro por defecto: Palenque, Chiapas.
const PALENQUE = [17.5095, -91.9827];

const dotIcon = (bg) =>
  L.divIcon({
    className: "rysa-map-dot",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });

const MAP_THEME = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

function FitBounds({ pts }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    }
  }, [pts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function Mapa() {
  const { can, user } = useAuth();
  const isSup = can("supervision.mapa") || can("supervision.ver");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [vendedorFiltro, setVendedorFiltro] = useState("");
  const [ruta, setRuta] = useState([]); // track GPS del día del vendedor
  const [lastUpdate, setLastUpdate] = useState(null);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const url = isSup ? "/supervision/map" : "/seller/map";
      const params = {};
      if (isSup && vendedorFiltro) params.vendedor_id = vendedorFiltro;
      if (isSup && soloVencidos) params.solo_vencidos = true;
      const { data } = await api.get(url, { params });
      setData(data);
      setLastUpdate(new Date());
    } catch (e) {
      setErr("No se pudo cargar el mapa. Verifica que tu rol tenga acceso a la supervisión de campo.");
      setData(null);
    } finally { setLoading(false); }
  };

  // Ruta GPS del día: ubicaciones registradas por el vendedor (supervisor elige
  // uno; un vendedor ve su propia ruta).
  const loadRuta = async () => {
    try {
      const vid = isSup ? vendedorFiltro : user?.id;
      if (!vid) { setRuta([]); return; }
      const hoy = new Date().toISOString().slice(0, 10);
      const { data } = await api.get(`/locations/${vid}`, { params: { desde: hoy, limit: 1000 } });
      setRuta((data || []).slice().sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "")));
    } catch (e) { setRuta([]); }
  };

  useEffect(() => {
    load();
    loadRuta(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [soloVencidos, vendedorFiltro]);

  // Auto-refresco cada 45 s: ubicaciones y saldos siempre frescos.
  useEffect(() => {
    const iv = setInterval(() => { load(); loadRuta(); }, 45000);
    return () => clearInterval(iv);
  }, [soloVencidos, vendedorFiltro]); // eslint-disable-line react-hooks/exhaustive-deps

  const clientes = useMemo(() => (data?.clientes || []).filter((c) => c.latitud && c.longitud), [data]);
  const sellers = useMemo(() => (data?.vendedores || []).filter((s) => s.ultima_ubicacion), [data]);
  const pts = useMemo(() => [...clientes.map((c) => [Number(c.latitud), Number(c.longitud)]), ...sellers.map((s) => [Number(s.ultima_ubicacion.latitud), Number(s.ultima_ubicacion.longitud)])], [clientes, sellers]);

  return (
    <div className="space-y-4" data-testid="mapa-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><MapIcon className="w-6 h-6 text-[#C1401E]" /> Mapa</h1>
          <p className="text-slate-500 text-sm">
            {isSup ? "Clientes y vendedores en campo (supervisión)" : "Mis clientes y mi ruta del día"}
            {lastUpdate ? ` · Actualizado ${lastUpdate.toLocaleTimeString("es-MX")} (auto cada 45 s)` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSup && (
            <>
              <select value={vendedorFiltro} onChange={(e) => setVendedorFiltro(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" data-testid="mapa-vendedor">
                <option value="">Todos los vendedores</option>
                {(data?.vendedores || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <Button size="sm" variant={soloVencidos ? "default" : "outline"} onClick={() => setSoloVencidos((x) => !x)} className={soloVencidos ? "bg-[#C1401E] hover:bg-[#A03316]" : ""} data-testid="mapa-vencidos">
                <Crosshair className="w-4 h-4 mr-1" /> Solo vencidos
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" /> Actualizar</Button>
        </div>
      </div>

      {err && <div className="card-soft p-6 text-center text-red-600">{err}</div>}

      {!err && loading && <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div>}

      {!err && !loading && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#C1401E]" /> Cliente</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500" /> En ruta</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500" /> Activo</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-slate-400" /> Sin actividad</span>
            {ruta.length > 1 && <span className="flex items-center gap-1.5"><RouteIcon className="w-3.5 h-3.5 text-blue-600" /> Ruta GPS del día: {ruta.length} puntos</span>}
            <span className="ml-auto"><Store className="w-3 h-3 inline mr-1" />{clientes.length} clientes · <Users className="w-3 h-3 inline mx-1" />{sellers.length} vendedores</span>
          </div>

          <div className="card-soft p-2">
            <div className="h-[62vh] rounded-lg overflow-hidden border border-slate-200">
              <MapContainer center={pts[0] || PALENQUE} zoom={13} style={{ height: "100%", width: "100%" }}>
                <TileLayer url={MAP_THEME} attribution="&copy; OpenStreetMap" />
                {pts.length > 0 && <FitBounds pts={pts} />}
                {ruta.length > 1 && (
                  <>
                    {/* Trayecto del día registrado por el GPS del vendedor */}
                    <Polyline positions={ruta.map((p) => [Number(p.latitud), Number(p.longitud)])}
                      pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.75, dashArray: "6 6" }} />
                    {ruta.map((p, i) => (
                      <CircleMarker key={p.id || i} center={[Number(p.latitud), Number(p.longitud)]}
                        radius={4} pathOptions={{ color: "#fff", weight: 1.5, fillColor: i === 0 ? "#16a34a" : "#2563eb", fillOpacity: 0.95 }}>
                        <Popup>
                          <div className="text-xs">
                            <b>{i === 0 ? "Inicio de ruta" : `Punto ${i + 1}`}</b> · {(p.fecha || "").slice(11, 16)}<br />
                            {(p.fecha || "").slice(0, 10)}<br />
                            Precisión: {p.precision ?? "—"} m{p.velocidad_kmh != null ? <> · Vel: {p.velocidad_kmh} km/h</> : null}<br />
                            Batería: {p.bateria_pct != null ? `${p.bateria_pct}%` : "—"}
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
                  </>
                )}
                {clientes.map((c) => (
                  <Marker key={c.id} position={[Number(c.latitud), Number(c.longitud)]} icon={dotIcon("#C1401E")}>
                    <Popup>
                      <div className="text-xs">
                        <b>{c.nombre}</b>{c.vendedor_nombre ? ` · ${c.vendedor_nombre}` : ""}<br />
                        {c.direccion && <span>{c.direccion}<br /></span>}
                        {c.vencido > 0 ? <span className="text-red-600">Vencido: {money(c.vencido)}</span> : c.saldo > 0 ? `Saldo: ${money(c.saldo)}` : <span className="text-green-600">Sin saldo</span>}<br />
                        {c.ultima_visita ? `Últ. visita: ${c.ultima_visita.slice(0, 10)}` : "Sin visitas"}
                      </div>
                    </Popup>
                  </Marker>
                ))}
                {sellers.map((s) => {
                  const bg = s.estado === "en_ruta" ? "#22c55e" : s.estado === "activo" ? "#3b82f6" : "#94a3b8";
                  return (
                    <Marker key={s.id} position={[Number(s.ultima_ubicacion.latitud), Number(s.ultima_ubicacion.longitud)]} icon={dotIcon(bg)}>
                      <Popup>
                        <div className="text-xs">
                          <b>{s.name}</b> · {s.estado}<br />
                          Ventas hoy: {money(s.ventas_hoy?.monto)} · Cobros: {money(s.cobros_hoy)}<br />
                          CxC vencido: {money(s.cxc?.vencido)}<br />
                          <span className="text-slate-400">{(s.ultima_ubicacion.fecha || "").slice(0, 16).replace("T", " ")}</span>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}