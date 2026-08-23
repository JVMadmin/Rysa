import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  TrendingUp, Loader2, MapPin, CalendarDays, Users, CheckCircle2, Wallet, Route as RouteIcon,
  Phone, ListChecks, ChevronRight, Crosshair,
} from "lucide-react";

const MAP_THEME = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const dotIcon = (bg) =>
  L.divIcon({
    className: "rysa-map-dot",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
const ESTADOS_V = { programada: "bg-blue-100 text-blue-700", en_camino: "bg-amber-100 text-amber-700", realizada: "bg-green-100 text-green-700", cancelada: "bg-red-100 text-red-700", no_localizado: "bg-slate-200 text-slate-600" };
const TIPOS_V = { visita: "Visita", cobro: "Cobro", nueva: "Nueva", seguimiento: "Seguimiento" };
// Ordena los clientes por vecino más cercano (aproximación de ruta).
const ordenarRuta = (pts) => {
  if (!pts.length) return [];
  const rest = [...pts];
  const ruta = [rest.shift()];
  while (rest.length) {
    const ult = ruta[ruta.length - 1];
    let bi = 0, bd = Infinity;
    rest.forEach((p, i) => {
      const d = (p[0] - ult[0]) ** 2 + (p[1] - ult[1]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    });
    ruta.push(rest.splice(bi, 1)[0]);
  }
  return ruta;
};

const KPI = ({ icon: Ic, label, value, cls, sub }) => (
  <div className="card-soft p-4">
    <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-slate-400">{label}</span><Ic className={`w-4 h-4 ${cls}`} /></div>
    <div className={`font-display font-black text-2xl mt-1 ${cls}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
  </div>
);

export default function MiRuta() {
  const { user } = useAuth();
  const [dash, setDash] = useState(null);
  const [mapp, setMapp] = useState(null);
  const [cartera, setCartera] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [detalle, setDetalle] = useState(null);
  // GPS en tiempo real (controlado por el vendedor)
  const [gpsOn, setGpsOn] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsPos, setGpsPos] = useState(null);
  const [gpsLast, setGpsLast] = useState(null);
  const gpsTimer = useRef(null);

  const reportarUbicacion = () => {
    if (!navigator.geolocation) { toast.error("GPS no disponible en este navegador"); setGpsOn(false); return; }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const la = +pos.coords.latitude.toFixed(6);
        const ln = +pos.coords.longitude.toFixed(6);
        setGpsPos([la, ln]);
        setGpsLast(Date.now());
        setGpsBusy(false);
        try { await api.post("/seller/location", { latitud: la, longitud: ln, precision: pos.coords.accuracy ?? null, fuente: "gps" }); } catch {}
      },
      () => { setGpsBusy(false); toast.error("No se pudo obtener tu ubicación. Revisa los permisos de GPS."); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 8000 }
    );
  };

  const toggleGps = () => {
    if (gpsOn) {
      setGpsOn(false);
      if (gpsTimer.current) { clearInterval(gpsTimer.current); gpsTimer.current = null; }
      toast.info("GPS detenido");
      return;
    }
    setGpsOn(true);
    reportarUbicacion();
    gpsTimer.current = setInterval(reportarUbicacion, 15000);
    toast.success("GPS activado — compartiendo tu ubicación cada 15s");
  };

  useEffect(() => () => { if (gpsTimer.current) clearInterval(gpsTimer.current); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [d, m, cl] = await Promise.all([
        api.get("/seller/dashboard").catch(() => ({ data: null })),
        api.get("/seller/map").catch(() => ({ data: null })),
        api.get("/seller/clients").catch(() => ({ data: [] })),
      ]);
      setDash(d.data);
      setMapp(m.data);
      setCartera(cl.data || []);
    } catch { toast.error("No se pudo cargar tu panel"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const clientes = mapp?.clientes || [];
  const visitasProg = mapp?.visitas_programadas || [];
  const pts = useMemo(() => clientes.map((c) => [Number(c.latitud), Number(c.longitud)]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])), [clientes]);
  const ruta = useMemo(() => ordenarRuta(pts), [pts]);
  const bounds = useMemo(() => {
    const all = pts;
    if (!all.length) return [[17.5095, -91.9827]]; // Palenque, Chiapas
    const lats = all.map((p) => p[0]), lngs = all.map((p) => p[1]);
    return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
  }, [pts]);
  const center = useMemo(() => {
    if (!pts.length) return [17.5095, -91.9827];
    const la = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const ln = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [la, ln];
  }, [pts]);

  const filtrados = useMemo(() => {
    const qq = q.toLowerCase();
    return qq ? cartera.filter((c) => `${c.nombre} ${c.codigo} ${c.telefono || ""}`.toLowerCase().includes(qq)) : cartera;
  }, [q, cartera]);
  const conUbicacion = useMemo(() => cartera.filter((c) => c.latitud != null && c.longitud != null).length, [cartera]);

  const v = dash?.visitas || {};
  const ventasHoy = dash?.ventas_dia || {};
  const ventasMes = dash?.ventas_mes || {};
  const df = (f) => (f || "").slice(0, 16).replace("T", " ");

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div>;

  return (
    <div className="space-y-5" data-testid="mi-ruta-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><RouteIcon className="w-6 h-6 text-[#C1401E]" /> Mi Ruta de Visitas</h1>
          <p className="text-slate-500 text-sm">{user?.name} · {cartera.length} clientes en tu cartera · {visitasProg.length} visitas programadas</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {gpsOn && gpsLast && (
            <span className="text-[11px] text-slate-500" data-testid="mi-ruta-gps-status">
              <b>{gpsPos ? `${gpsPos[0].toFixed(4)}, ${gpsPos[1].toFixed(4)}` : "Obteniendo…"}</b>
              {" "}· hace {Math.max(0, Math.round((Date.now() - gpsLast) / 1000))}s
            </span>
          )}
          <Button size="sm" variant={gpsOn ? "default" : "outline"} onClick={toggleGps} className={gpsOn ? "bg-[#C1401E] hover:bg-[#A03316]" : ""} data-testid="mi-ruta-gps">
            {gpsBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Crosshair className="w-4 h-4 mr-1" />} {gpsOn ? "GPS ON" : "Activar GPS"}
          </Button>
        </div>
      </div>

      {/* KPIs del vendedor (solo sus datos) */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KPI icon={TrendingUp} label="Mis ventas hoy" value={money(ventasHoy.monto)} cls="text-[#C1401E]" sub={`${ventasHoy.numero} ventas`} />
        <KPI icon={TrendingUp} label="Mis ventas del mes" value={money(ventasMes.monto)} cls="text-green-700" sub={`${ventasMes.numero} ventas`} />
        <KPI icon={Users} label="Clientes asignados" value={cartera.length} cls="text-blue-700" sub={`${conUbicacion} con ubicación`} />
        <KPI icon={CalendarDays} label="Visitas programadas" value={v.programadas ?? 0} cls="text-slate-700" sub={`${v.realizadas_hoy ?? 0} realizadas hoy`} />
        <KPI icon={CheckCircle2} label="Visitas de hoy" value={v.total_hoy ?? 0} cls="text-emerald-700" />
        <KPI icon={Wallet} label="Mis cobros hoy" value={money(dash?.cobros_hoy?.monto ?? 0)} cls="text-amber-600" sub={`${dash?.cobros_hoy?.numero ?? 0} cobros`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Mapa de ruta */}
        <div className="lg:col-span-2 card-soft p-4" data-testid="mi-ruta-mapa">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-slate-400">Ruta de visita de tus clientes</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500"><RouteIcon className="w-3.5 h-3.5" /> {ruta.length} paradas ordenadas</span>
          </div>
          <div className="h-[420px] rounded-lg overflow-hidden border border-slate-200">
            <MapContainer center={center} zoom={13} bounds={bounds} boundsOptions={{ padding: [40, 40] }} style={{ height: "100%", width: "100%" }}>
              <TileLayer url={MAP_THEME} attribution="&copy; OpenStreetMap" />
              {ruta.length > 1 && <Polyline positions={ruta} pathOptions={{ color: "#C1401E", weight: 3, dashArray: "6 4" }} />}
              {gpsPos && (
                <Marker position={gpsPos} icon={dotIcon("#3b82f6")}>
                  <Popup><div className="text-xs"><b>Mi ubicación</b><br />{gpsPos[0].toFixed(5)}, {gpsPos[1].toFixed(5)}</div></Popup>
                </Marker>
              )}
              {clientes.map((c) => {
                const la = Number(c.latitud), ln = Number(c.longitud);
                if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
                return (
                  <Marker key={c.id} position={[la, ln]} icon={dotIcon(c.saldo > 0 ? "#f59e0b" : "#C1401E")}>
                    <Popup>
                      <div className="text-xs">
                        <b>{c.nombre}</b> {c.telefono && <span>· {c.telefono}</span>}<br />
                        {c.saldo > 0 ? <span className="text-amber-700">Saldo: {money(c.saldo)}</span> : <span className="text-green-700">Sin saldo</span>}
                        {c.ultima_visita && <><br />Última visita: {c.ultima_visita.slice(0, 10)}</>}
                        {c.proxima_visita && <><br />Próxima: {c.proxima_visita.slice(0, 10)}</>}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        </div>

        {/* Visitas programadas */}
        <div className="card-soft" data-testid="mi-ruta-visitas">
          <div className="text-xs uppercase tracking-wider text-slate-400 p-3 flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> Mis visitas programadas</div>
          <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
            {visitasProg.length === 0 && <div className="p-4 text-center text-sm text-slate-400">Sin visitas programadas.</div>}
            {visitasProg.map((vi) => (
              <div key={vi.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{vi.cliente_nombre}</span>
                  <Badge className={ESTADOS_V[vi.estado] || ""}>{vi.estado}</Badge>
                </div>
                <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                  <CalendarDays className="w-3 h-3" /> {vi.fecha_programada?.slice(0, 10)} {vi.hora && `· ${vi.hora}`}
                  <Badge variant="outline">{TIPOS_V[vi.tipo_visita] || vi.tipo_visita}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Mis clientes */}
        <div className="card-soft" data-testid="mi-ruta-clientes">
          <div className="flex items-center justify-between p-3 gap-2">
            <span className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Users className="w-4 h-4" /> Mis clientes asignados ({filtrados.length})</span>
            <Input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="w-40 h-8 text-sm" />
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-xs text-slate-500">
                <th className="p-2">Cliente</th><th className="p-2 text-right">Saldo</th><th className="p-2">Próx. visita</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {filtrados.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-400">Sin clientes asignados.</td></tr>}
                {filtrados.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`mi-cliente-${c.id}`}>
                    <td className="p-2">
                      <div className="font-medium truncate max-w-[180px]">{c.nombre}</div>
                      {c.telefono && <div className="text-[11px] text-slate-400 flex items-center gap-1"><Phone className="w-3 h-3" /> {c.telefono}</div>}
                      {(c.latitud == null || c.longitud == null) && <div className="text-[10px] text-amber-600">Sin ubicación</div>}
                    </td>
                    <td className={`p-2 text-right tabular-nums ${c.saldo > 0 ? "text-amber-700 font-semibold" : "text-green-700"}`}>{money(c.saldo)}</td>
                    <td className="p-2 text-slate-500 text-xs">{c.proxima_visita ? c.proxima_visita.slice(0, 10) : "—"}</td>
                    <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => setDetalle(c)} data-testid={`mi-cliente-ver-${c.id}`}><ChevronRight className="w-4 h-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mis ventas (solo las realizadas por mí) */}
        <div className="card-soft" data-testid="mi-ruta-ventas">
          <div className="text-xs uppercase tracking-wider text-slate-400 p-3 flex items-center gap-1.5"><TrendingUp className="w-4 h-4" /> Mis ventas recientes</div>
          <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
            {(dash?.actividad?.ultimas_ventas || []).length === 0 && <div className="p-4 text-center text-sm text-slate-400">Aún no registras ventas hoy.</div>}
            {dash?.actividad?.ultimas_ventas?.map((sv, i) => (
              <div key={i} className="flex items-center justify-between p-3">
                <div>
                  <div className="text-sm font-medium">{sv.cliente_nombre}</div>
                  <div className="text-xs text-slate-400">{df(sv.fecha)} · {sv.folio}</div>
                </div>
                <span className="font-semibold text-slate-900">{money(sv.total)}</span>
              </div>
            ))}
            {(dash?.actividad?.ultimos_cobros || [])?.length > 0 && (
              <>
                <div className="text-[11px] uppercase tracking-wider text-slate-400 px-3 pt-2">Mis cobros de hoy</div>
                {dash.actividad.ultimos_cobros.map((c, i) => (
                  <div key={`c${i}`} className="flex items-center justify-between p-3">
                    <div className="text-sm">{c.cliente_nombre || c.folio}</div>
                    <span className="font-semibold text-emerald-700">+{money(c.monto)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Detalle de cliente */}
      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent data-testid="mi-cliente-detalle">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><MapPin className="w-5 h-5 text-[#C1401E]" /> {detalle?.nombre}</DialogTitle></DialogHeader>
          {detalle && (
            <div className="text-sm space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3"><div className="text-[10px] uppercase tracking-wider text-slate-400">Teléfono</div><div className="font-medium">{detalle.telefono || "—"}</div></div>
                <div className="bg-slate-50 rounded-lg p-3"><div className="text-[10px] uppercase tracking-wider text-slate-400">Código</div><div className="font-medium">{detalle.codigo}</div></div>
                <div className="bg-slate-50 rounded-lg p-3"><div className="text-[10px] uppercase tracking-wider text-slate-400">Saldo</div><div className={`font-bold ${detalle.saldo > 0 ? "text-amber-700" : "text-green-700"}`}>{money(detalle.saldo)}</div></div>
                <div className="bg-slate-50 rounded-lg p-3"><div className="text-[10px] uppercase tracking-wider text-slate-400">Última compra</div><div className="font-medium">{detalle.ult_fecha_compra ? detalle.ult_fecha_compra.slice(0, 10) : "—"}</div></div>
              </div>
              {detalle.latitud != null && detalle.longitud != null ? (
                <div className="h-52 rounded-lg overflow-hidden border border-slate-200">
                  <MapContainer center={[Number(detalle.latitud), Number(detalle.longitud)]} zoom={15} style={{ height: "100%", width: "100%" }}>
                    <TileLayer url={MAP_THEME} attribution="&copy; OpenStreetMap" />
                    <Marker position={[Number(detalle.latitud), Number(detalle.longitud)]} icon={dotIcon("#C1401E")} />
                  </MapContainer>
                </div>
              ) : (
                <p className="text-xs text-amber-600">Este cliente aún no tiene ubicación registrada.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}