import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Loader2, Users, MapPinned, Activity as ActivityIcon, Wallet, TrendingUp, CheckCircle2, Clock3,
  ChevronRight, Filter, Radio, Pencil, MapPin, RefreshCw, Save, Search,
} from "lucide-react";

const MAP_THEME = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESTADO_BADGE = {
  activo: "bg-green-100 text-green-700",
  en_ruta: "bg-emerald-100 text-emerald-700",
  sin_actividad: "bg-red-100 text-red-700",
  sin_datos: "bg-slate-200 text-slate-600",
};
const ESTADO_DOT = { activo: "#22c55e", en_ruta: "#10b981", sin_actividad: "#ef4444", sin_datos: "#94a3b8" };
const ESTADO_LABEL = { activo: "Activo", en_ruta: "En ruta", sin_actividad: "Sin actividad", sin_datos: "Sin datos" };

const dotIcon = (bg) =>
  L.divIcon({
    className: "rysa-map-dot",
    html: `<div style="width:15px;height:15px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.12)"></div>`,
    iconSize: [17, 17],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });

const fmt = (f) => (f || "").slice(0, 16).replace("T", " ");
const PAGE_CARTERA = 100;

export default function Supervision() {
  const { can } = useAuth();
  const [kpi, setKpi] = useState(null);
  const [vendedores, setVendedores] = useState([]);
  const [actividad, setActividad] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState(null);
  const [detLoading, setDetLoading] = useState(false);
  const [sucursal, setSucursal] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [orden, setOrden] = useState("ventas");
  const [filtroVendedor, setFiltroVendedor] = useState("");

  // Cartera
  const [carOpen, setCarOpen] = useState(false);
  const [carVend, setCarVend] = useState(null);
  const [carClients, setCarClients] = useState([]);
  const [carSel, setCarSel] = useState(new Set());
  const [carQ, setCarQ] = useState("");
  const [carPage, setCarPage] = useState(0);
  const [carBusy, setCarBusy] = useState(false);

  // Mapa en vivo (GPS de vendedores)
  const [liveOn, setLiveOn] = useState(false);
  const [live, setLive] = useState(null);
  const [liveLast, setLiveLast] = useState(null);

  const puedeCartera = can("supervision.cartera");
  const puedeActividad = can("supervision.actividad");
  const puedeMapa = can("supervision.mapa");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (sucursal) params.sucursal_id = sucursal;
      if (filtroVendedor) params.vendedor_id = filtroVendedor;
      const [k, v] = await Promise.all([
        api.get("/supervision/dashboard", { params }).catch(() => ({ data: null })),
        puedeCartera || can("supervision.ver") ? api.get("/supervision/sellers", { params, order_by: orden }).catch(() => ({ data: { vendedores: [] } })) : Promise.resolve({ data: null }),
      ]);
      setKpi(k.data);
      if (v.data) setVendedores(v.data.vendedores || []);
    } finally { setLoading(false); }
  }, [sucursal, puedeCartera, can, orden, filtroVendedor]);

  const loadActividad = useCallback(async () => {
    if (!puedeActividad) return;
    try {
      const params = {};
      if (sucursal) params.sucursal_id = sucursal;
      if (filtroVendedor) params.vendedor_id = filtroVendedor;
      const { data } = await api.get("/supervision/activity", { params });
      setActividad(Array.isArray(data) ? data : []);
    } catch {}
  }, [sucursal, puedeActividad, filtroVendedor]);

  useEffect(() => {
    api.get("/sucursales").then((r) => setSucursales(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sucursal, orden, filtroVendedor]);
  useEffect(() => { loadActividad(); /* eslint-disable-next-line */ }, [sucursal, filtroVendedor]);

  useEffect(() => {
    if (!liveOn || !puedeMapa) return;
    const tick = async () => {
      try {
        const { data } = await api.get("/supervision/map", { params: sucursal ? { sucursal_id: sucursal } : {} });
        setLive(data);
        setLiveLast(Date.now());
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [liveOn, sucursal, puedeMapa]);

  const openDetalle = async (id) => {
    setDetalle(null);
    setDetLoading(true);
    try {
      const { data } = await api.get(`/supervision/sellers/${id}`);
      setDetalle(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setDetLoading(false); }
  };

  const openCartera = async (v) => {
    setCarOpen(true);
    setCarVend(v);
    setCarQ("");
    setCarPage(0);
    try {
      const { data } = await api.get("/clients", { params: { estado: "activo" } });
      setCarClients(data || []);
      setCarSel(new Set((data || []).filter((c) => c.vendedor_id === v.id).map((c) => c.id)));
    } catch { toast.error("No se pudieron cargar los clientes"); }
  };

  const carFiltrados = carQ
    ? carClients.filter((c) => `${c.codigo} ${c.nombre} ${c.rfc || ""}`.toLowerCase().includes(carQ.toLowerCase()))
    : carClients;
  const carPagina = carFiltrados.slice(carPage * PAGE_CARTERA, carPage * PAGE_CARTERA + PAGE_CARTERA);
  const carTotalPag = Math.max(1, Math.ceil(carFiltrados.length / PAGE_CARTERA));
  const toggleCar = (id) => setCarSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const guardarCartera = async () => {
    if (!carVend) return;
    setCarBusy(true);
    try {
      const { data } = await api.post("/supervision/cartera", {
        vendedor_id: carVend.id,
        cliente_ids: [...carSel],
        reemplazar: true,
      });
      toast.success(`Cartera de ${data.vendedor} actualizada (${data.asignados} clientes)`);
      setCarOpen(false);
      load(); loadActividad();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setCarBusy(false); }
  };

  const k = kpi || {};
  const kCards = [
    [Users, "Vendedores", k.vendedores?.total ?? 0, "text-slate-700"],
    [ActivityIcon, "Activos", k.vendedores?.activos ?? 0, "text-green-700"],
    [MapPinned, "En ruta", k.vendedores?.en_ruta ?? 0, "text-emerald-700"],
    [Clock3, "Sin actividad", k.vendedores?.sin_actividad ?? 0, "text-red-600"],
    [CheckCircle2, "Visitas hoy", k.visitas?.hoy ?? 0, "text-[#C1401E]"],
    [Wallet, "Cobranza hoy", money(k.cobranza_dia ?? 0), "text-blue-700"],
    [TrendingUp, "Ventas hoy", money(k.ventas_dia?.monto ?? 0), "text-slate-700"],
    [CheckCircle2, "Clientes visitados", k.clientes?.visitados_hoy ?? 0, "text-emerald-700"],
  ];

  const vendSeleccion = vendedores.find((v) => v.id === filtroVendedor);

  return (
    <div className="space-y-5" data-testid="supervision-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><Users className="w-6 h-6 text-[#C1401E]" /> Centro de Supervisión Comercial</h1>
          <p className="text-slate-500 text-sm">Monitoreo de vendedores de campo: actividad, cartera, visitas y GPS en vivo</p>
        </div>
        {(sucursales.length > 0 || vendedores.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            {sucursales.length > 0 && (
              <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="sup-filtro-sucursal">
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            )}
            <select value={filtroVendedor} onChange={(e) => setFiltroVendedor(e.target.value)} className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="sup-filtro-vendedor">
              <option value="">Todos los vendedores</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kCards.map(([Ic, l, v, cls], i) => (
              <div key={i} className="card-soft p-4" data-testid={`sup-kpi-${i}`}>
                <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-slate-400">{l}</span><Ic className={`w-4 h-4 ${cls}`} /></div>
                <div className={`font-display font-black text-2xl mt-1 ${cls}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            {/* Cartera por vendedor */}
            <div className="lg:col-span-2 card-soft overflow-x-auto" data-testid="sup-sellers">
              <div className="flex flex-wrap items-center justify-between p-3">
                <span className="text-xs uppercase tracking-wider text-slate-400">Cartera por vendedor {filtroVendedor && vendSeleccion ? `· ${vendSeleccion.name}` : ""}</span>
                <select value={orden} onChange={(e) => setOrden(e.target.value)} className="h-8 border border-slate-200 rounded-md px-2 text-xs" data-testid="sup-orden">
                  <option value="ventas">Por ventas (mes)</option>
                  <option value="vencido">Por CxC vencida</option>
                  <option value="cartera">Por cartera</option>
                  <option value="cobranza">Por cobranza hoy</option>
                  <option value="clientes">Por clientes asignados</option>
                  <option value="visitas">Por visitas realizadas</option>
                </select>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="p-2">Vendedor</th><th className="p-2">Estado</th><th className="p-2 text-right">Clientes</th>
                  <th className="p-2 text-right">Cartera</th><th className="p-2 text-right">Vencido</th>
                  <th className="p-2 text-right">Ventas mes</th><th className="p-2 text-right">Ventas hoy</th><th className="p-2 text-right">Cobros hoy</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {vendedores.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-slate-400">Sin vendedores de campo para este filtro.</td></tr>}
                  {vendedores.map((v) => (
                    <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`sup-seller-${v.id}`}>
                      <td className="p-2 font-medium">{v.name}</td>
                      <td className="p-2"><Badge className={ESTADO_BADGE[v.estado]}>{v.estado}</Badge></td>
                      <td className="p-2 text-right tabular-nums">{v.clientes_asignados}</td>
                      <td className="p-2 text-right tabular-nums">{money(v.cartera_total)}</td>
                      <td className={`p-2 text-right tabular-nums ${v.cxc_vencida > 0 ? "text-red-600 font-semibold" : "text-slate-400"}`}>{money(v.cxc_vencida)}</td>
                      <td className="p-2 text-right tabular-nums">{money(v.ventas_mes)}</td>
                      <td className="p-2 text-right tabular-nums">{money(v.ventas_hoy)}</td>
                      <td className="p-2 text-right font-semibold text-emerald-700 tabular-nums">{money(v.cobros_hoy)}</td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-1">
                          {puedeCartera && <Button size="sm" variant="outline" onClick={() => openCartera(v)} title="Asignar cartera" data-testid={`sup-cartera-${v.id}`}><Pencil className="w-3.5 h-3.5 mr-1" /> Cartera</Button>}
                          <Button size="icon" variant="ghost" onClick={() => openDetalle(v.id)} data-testid={`sup-detalle-${v.id}`}><ChevronRight className="w-4 h-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {kpi?.clientes_mayor_adeudo?.length > 0 && (
                <div className="border-t border-slate-100 p-3">
                  <span className="text-xs uppercase tracking-wider text-slate-400">Mayores adeudos</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {kpi.clientes_mayor_adeudo.map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs">
                        <span className="font-semibold">{c.nombre}</span> {money(c.saldo)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actividad reciente */}
            {puedeActividad && (
              <div className="card-soft" data-testid="sup-activity">
                <div className="text-xs uppercase tracking-wider text-slate-400 p-3">Actividad de vendedores</div>
                <div className="divide-y divide-slate-100">
                  {actividad.length === 0 && <div className="p-4 text-center text-sm text-slate-400">Sin actividad registrada.</div>}
                  {actividad.slice(0, 20).map((a, i) => (
                    <div key={i} className="flex items-center gap-2.5 p-3">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ESTADO_DOT[a.estado] || "#94a3b8" }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{a.name}</div>
                        <div className="text-xs text-slate-400 truncate">{a.ultima_actividad ? `Última actividad: ${fmt(a.ultima_actividad)}` : "Sin actividad"}</div>
                      </div>
                      <div className="text-xs text-slate-400 text-right shrink-0">
                        {a.ventas_hoy?.numero > 0 && <div>{a.ventas_hoy.numero} ventas</div>}
                        {a.cobros_hoy > 0 && <div className="text-emerald-600">{money(a.cobros_hoy)}</div>}
                        {a.visitas_hoy > 0 && <div className="text-[#C1401E]">{a.visitas_hoy} visitas</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Mapa en vivo: GPS de vendedores */}
          {puedeMapa && (
            <div className="card-soft p-4" data-testid="sup-mapa-en-vivo">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <span className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><MapPin className="w-4 h-4" /> Ubicación en tiempo real de vendedores (GPS)</span>
                <div className="flex items-center gap-3">
                  {liveLast && liveOn && <span className="text-[11px] text-slate-400">Actualizado hace {Math.max(0, Math.round((Date.now() - liveLast) / 1000))}s</span>}
                  <Button size="sm" variant={liveOn ? "default" : "outline"} onClick={() => setLiveOn((v) => !v)} className={liveOn ? "bg-[#C1401E] hover:bg-[#A03316]" : ""} data-testid="sup-live-toggle">
                    {liveOn ? <><Radio className="w-4 h-4 mr-1 animate-pulse" /> En vivo ON</> : <><Radio className="w-4 h-4 mr-1" /> Activar en vivo</>}
                  </Button>
                  {liveOn && <Button size="sm" variant="ghost" onClick={() => { setLive(null); setLiveLast(null); }} title="Limpiar"><RefreshCw className="w-4 h-4" /></Button>}
                </div>
              </div>
              {!liveOn ? (
                <div className="py-12 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                  Activa "En vivo" para ver a los vendedores moverse en el mapa cada 10s (requiere que tengan su GPS activo en Mi Ruta).
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-slate-500">
                    {Object.entries(ESTADO_DOT).map(([k, c]) => (
                      <span key={k} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c }} /> {ESTADO_LABEL[k]}</span>
                    ))}
                  </div>
                  {live ? (
                    (() => {
                      const sellers = live.vendedores || [];
                      const pts = sellers.filter((s) => s.ultima_ubicacion).map((s) => [Number(s.ultima_ubicacion.latitud), Number(s.ultima_ubicacion.longitud)]);
                      const b = pts.length ? pts : [[20.59, -100.39]];
                      const lats = b.map((p) => p[0]), lngs = b.map((p) => p[1]);
                          const center = pts.length ? [lats.reduce((a, x) => a + x, 0) /
                              lats.length, lngs.reduce((a, x) => a + x, 0) / lngs.length] : [17.5095, -91.9827];
                      const liveSellers = sellers.filter((s) => s.ultima_ubicacion);
                      return (
                        <div className="h-[440px] rounded-lg overflow-hidden border border-slate-200">
                          <MapContainer center={center} zoom={13} bounds={b} boundsOptions={{ padding: [40, 40] }} style={{ height: "100%", width: "100%" }}>
                            <TileLayer url={MAP_THEME} attribution="&copy; OpenStreetMap" />
                            {liveSellers.map((s) => (
                              <Marker key={s.id} position={[Number(s.ultima_ubicacion.latitud), Number(s.ultima_ubicacion.longitud)]} icon={dotIcon(ESTADO_DOT[s.estado] || "#94a3b8")}>
                                <Popup>
                                  <div className="text-xs">
                                    <b>{s.name}</b> · {ESTADO_LABEL[s.estado] || s.estado}<br />
                                    Ventas hoy: {money(s.ventas_hoy?.monto)} · Cobros: {money(s.cobros_hoy)}<br />
                                    Últ. ubicación: {fmt(s.ultima_ubicacion.fecha)}
                                  </div>
                                </Popup>
                              </Marker>
                            ))}
                            {liveSellers.length === 0 && <div className="sr-only">Sin ubicaciones</div>}
                          </MapContainer>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>
                  )}
                  <p className="text-[11px] text-slate-400 mt-2">
                    {(live?.vendedores || []).length} vendedores · {(live?.vendedores || []).filter((s) => s.ultima_ubicacion).length} con ubicación reciente. El vendedor activa su GPS desde "Mi Ruta".
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Asignar cartera */}
      <Dialog open={carOpen} onOpenChange={setCarOpen}>
        <DialogContent className="max-w-3xl" data-testid="sup-cartera-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Users className="w-5 h-5" /> Cartera de {carVend?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Marca los clientes que pertenecerán a {carVend?.name}. Los que dejes sin marcar y ya estaban en su cartera quedarán sin asignar.</p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input placeholder="Buscar por clave, nombre o RFC…" value={carQ} onChange={(e) => { setCarQ(e.target.value); setCarPage(0); }} className="pl-9 h-9" data-testid="sup-cartera-q" />
            </div>
            <Badge variant="outline" className="h-9">{carSel.size} seleccionados</Badge>
          </div>
          <div className="border border-slate-200 rounded-md max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-xs text-slate-500">
                <th className="p-2 w-10"></th><th className="p-2">Clave</th><th className="p-2">Cliente</th><th className="p-2">Asignado a</th>
              </tr></thead>
              <tbody>
                {carPagina.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400">Sin clientes para este filtro.</td></tr>}
                {carPagina.map((c) => {
                  const esOtro = c.vendedor_id && c.vendedor_id !== carVend?.id;
                  return (
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`sup-car-cli-${c.codigo}`}>
                      <td className="p-2 text-center"><input type="checkbox" checked={carSel.has(c.id)} onChange={() => toggleCar(c.id)} data-testid={`sup-car-check-${c.codigo}`} /></td>
                      <td className="p-2 font-medium text-[#C1401E]">{c.codigo}</td>
                      <td className="p-2">{c.nombre}</td>
                      <td className="p-2 text-xs">
                        {carSel.has(c.id) ? <span className="text-emerald-600 font-medium">← {carVend?.name}</span>
                          : esOtro ? <span className="text-amber-600">Otro vendedor</span>
                          : <span className="text-slate-300">Sin asignar</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>{carFiltrados.length} clientes {carQ && `(filtrados de ${carClients.length})`}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={carPage === 0} onClick={() => setCarPage((p) => p - 1)}>Anterior</Button>
              <span>Página {carPage + 1} de {carTotalPag}</span>
              <Button variant="outline" size="sm" disabled={carPage + 1 >= carTotalPag} onClick={() => setCarPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCarOpen(false)}>Cancelar</Button>
            <Button onClick={guardarCartera} disabled={carBusy} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="sup-cartera-guardar">
              {carBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Asignar cartera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle de vendedor */}
      <Dialog open={!!detalle || detLoading} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-3xl" data-testid="sup-detalle-dialog">
          <DialogHeader><DialogTitle className="font-display">{detalle?.vendedor?.name || "Cargando…"}</DialogTitle></DialogHeader>
          {detLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#C1401E]" /></div>
          ) : detalle && (
            <div className="text-sm space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ["Ventas hoy", money(detalle.vendedor.ventas_hoy.monto), "text-slate-700"],
                  ["Ventas mes", money(detalle.vendedor.ventas_mes.monto), "text-slate-700"],
                  ["Cobros hoy", money(detalle.vendedor.cobros_hoy), "text-emerald-700"],
                  ["Cartera", money(detalle.vendedor.cxc.saldo_total), "text-[#C1401E]"],
                ].map(([l, v, cls], i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">{l}</div>
                    <div className={`font-semibold ${cls}`}>{v}</div>
                  </div>
                ))}
              </div>
              {(detalle.clientes || []).length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Cartera de clientes ({detalle.clientes.length})</div>
                  <div className="border border-slate-200 rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50"><tr className="text-left text-xs text-slate-500"><th className="p-2">Cliente</th><th className="p-2 text-right">Saldo</th><th className="p-2 text-right">Vencido</th><th className="p-2">Próx. visita</th></tr></thead>
                      <tbody>
                        {detalle.clientes.slice(0, 30).map((c) => (
                          <tr key={c.id} className="border-t border-slate-100">
                            <td className="p-2">{c.nombre}</td>
                            <td className="p-2 text-right tabular-nums">{money(c.saldo)}</td>
                            <td className={`p-2 text-right tabular-nums ${c.vencido > 0 ? "text-red-600 font-semibold" : "text-slate-400"}`}>{money(c.vencido)}</td>
                            <td className="p-2 text-slate-500">{c.proxima_visita ? c.proxima_visita.slice(0, 10) : "—"}</td>
                          </tr>
                        ))}
                        {detalle.clientes.length > 30 && <tr><td colSpan={4} className="p-2 text-center text-xs text-slate-400">… y {detalle.clientes.length - 30} más</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}