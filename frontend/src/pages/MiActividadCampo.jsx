import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2, Plus, CalendarDays, CheckCircle2, Clock3, UserCircle2,
  XCircle, Store, Route as RouteIcon, Phone, ListChecks,
  Crosshair, TrendingUp, Users, Wallet, Eye, LocateFixed, Search, Camera,
} from "lucide-react";

import MapaCampo from "@/components/campo/MapaCampo";
import { separarVendedores } from "@/lib/ubicaciones";

const TABS = [
  { id: "visitas", label: "Mis Visitas" },
  { id: "ruta", label: "Mi Ruta" },
  { id: "cartera", label: "Mi Cartera" },
];

const ESTADOS = {
  programada: ["bg-blue-100 text-blue-700"],
  en_camino: ["bg-amber-100 text-amber-700"],
  realizada: ["bg-green-100 text-green-700"],
  cancelada: ["bg-red-100 text-red-700"],
  no_localizado: ["bg-slate-200 text-slate-600"],
};
const ESTADOS_LABEL = { programada: "Programada", en_camino: "En camino", realizada: "Realizada", cancelada: "Cancelada", no_localizado: "No localizado" };
const TIPOS_LABEL = { visita: "Visita", cobro: "Cobro", nueva: "Nueva", seguimiento: "Seguimiento" };

// Ordena clientes por vecino más cercano (aproximación de ruta).
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

/**
 * ===========================================================================
 * MÓDULO 2 — MI ACTIVIDAD DE CAMPO (vendedor).
 * Fusiona Visitas + Rutas en pestañas internas. El backend ya limita los
 * datos al propio vendedor (/seller/* y /visits); aquí nunca se muestran
 * datos de otros. Usa el MISMO MapaCampo que Supervisión Comercial.
 * ===========================================================================
 */
export default function MiActividadCampo({ embedded = false }) {
  const { user, can } = useAuth();
  const puedeEditar = can("visita.editar");
  const [tab, setTab] = useState("visitas");

  const [dash, setDash] = useState(null);
  const [mapp, setMapp] = useState(null);
  const [cartera, setCartera] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [qCartera, setQCartera] = useState("");

  // Filtros de visitas
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [saving, setSaving] = useState(false);

  // Crear/editar visita
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clienteQuery, setClienteQuery] = useState("");
  const [form, setForm] = useState({ cliente_id: "", cliente_nombre: "", fecha_programada: "", hora: "", tipo_visita: "visita", estado: "programada", comentarios: "" });

  // GPS propio
  const [gpsOn, setGpsOn] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsPos, setGpsPos] = useState(null);
  const [gpsLast, setGpsLast] = useState(null);
  const gpsTimer = useRef(null);
  const [mapKey, setMapKey] = useState(0);
  const [subiendoFachada, setSubiendoFachada] = useState("");

  /* ------------------- foto de fachada del cliente ---------------------- */
  const subirFachada = async (cli, file) => {
    if (!file) return;
    setSubiendoFachada(cli.id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/clients/${cli.id}/fachada`, fd,
        { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Fachada de ${cli.nombre} guardada`);
      loadTodo();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "No se pudo subir la foto");
    } finally { setSubiendoFachada(""); }
  };

  /* ------------------------------- GPS ----------------------------------- */
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

  /* ------------------------------ carga ---------------------------------- */
  const loadVisitas = useCallback(async () => {
    const params = {};
    if (fEstado) params.estado = fEstado;
    if (fTipo) params.tipo_visita = fTipo;
    try { const { data } = await api.get("/visits", { params }); setVisits(data); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  }, [fEstado, fTipo]);

  const loadTodo = useCallback(async () => {
    setLoading(true);
    try {
      const [d, m, cl] = await Promise.all([
        api.get("/seller/dashboard").catch(() => ({ data: null })),
        api.get("/seller/map").catch(() => ({ data: null })),
        api.get("/seller/clients").catch(() => ({ data: [] })),
      ]);
      setDash(d.data); setMapp(m.data); setCartera(cl.data || []);
    } catch { toast.error("No se pudo cargar tu panel"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTodo(); }, [loadTodo]);
  useEffect(() => { loadVisitas(); }, [loadVisitas]);

  /* -------------------- derivados compartidos entre pestañas ------------- */
  const clientesMapa = useMemo(() => mapp?.clientes || [], [mapp]);
  const cliConPos = useMemo(
    () => clientesMapa.filter((c) => c.latitud != null && c.longitud != null),
    [clientesMapa]);
  const miFlota = useMemo(() => {
    const ub = gpsPos
      ? { latitud: gpsPos[0], longitud: gpsPos[1], fecha: new Date().toISOString() }
      : mapp?.ubicacion_actual || null;
    if (!ub) return { enMapa: [], sinGps: [] };
    return separarVendedores([{ id: user?.id, name: `${user?.name} (tú)`, estado: "activo", ultima_ubicacion: ub }]);
  }, [gpsPos, mapp, user]);

  const visitasHoy = visits.filter((v) => (v.fecha || "").slice(0, 10) === new Date().toISOString().slice(0, 10));
  const realizadas = visits.filter((v) => v.estado === "realizada");
  const programadas = visits.filter((v) => v.estado === "programada" || v.estado === "en_camino");

  // Clientes con visitas (para el mapa de la pestaña Mis Visitas).
  const clientesDeVisitas = useMemo(() => {
    const ids = new Set(visits.map((v) => v.cliente_id));
    return clientesMapa.filter((c) => ids.has(c.id));
  }, [visits, clientesMapa]);

  /* --------------------------- crear/editar visita ----------------------- */
  const loadMetaClientes = async () => {
    if (clientes.length) return;
    try { const c = await api.get("/clients", { params: { estado: "activo" } }); setClientes(c.data || []); } catch {}
  };
  const filteredClientes = useMemo(() => {
    const q = clienteQuery.toLowerCase();
    return q ? clientes.filter((c) => `${c.codigo} ${c.nombre} ${c.rfc || ""}`.toLowerCase().includes(q)).slice(0, 50)
             : clientes.slice(0, 50);
  }, [clienteQuery, clientes]);

  const openNew = async () => {
    setEditing(null);
    setForm({ cliente_id: "", cliente_nombre: "", fecha_programada: new Date().toISOString().slice(0, 10), hora: new Date().toTimeString().slice(0, 5), tipo_visita: "visita", estado: "programada", comentarios: "" });
    setClienteQuery(""); setClienteOpen(false);
    await loadMetaClientes();
    setFormOpen(true);
  };
  const openEdit = async (v) => {
    setEditing(v);
    setForm({
      cliente_id: v.cliente_id, cliente_nombre: v.cliente_nombre || "",
      fecha_programada: (v.fecha_programada || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      hora: (v.hora || "").slice(0, 5) || "",
      tipo_visita: v.tipo_visita || "visita", estado: v.estado || "programada",
      comentarios: v.comentarios || "",
    });
    setClienteQuery(v.cliente_nombre || "");
    await loadMetaClientes();
    setFormOpen(true);
  };
  const reselectCliente = (c) => {
    setForm((s) => ({ ...s, cliente_id: c?.id || "", cliente_nombre: c?.nombre || "" }));
    setClienteQuery(c ? `${c.codigo || ""} ${c.nombre}`.trim() : "");
    setClienteOpen(false);
  };
  const guardar = async () => {
    const payload = {
      cliente_id: form.cliente_id, cliente_nombre: form.cliente_nombre,
      fecha_programada: form.fecha_programada, hora: form.hora,
      tipo_visita: form.tipo_visita, estado: editing ? undefined : form.estado,
      comentarios: form.comentarios,
    };
    if (!payload.cliente_id) return toast.error("Selecciona un cliente");
    setSaving(true);
    try {
      if (editing) await api.put(`/visits/${editing.id}`, payload);
      else await api.post("/visits", payload);
      toast.success(editing ? "Visita actualizada" : "Visita creada");
      setFormOpen(false);
      loadVisitas(); loadTodo();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  /* ------------------------------- KPIs ---------------------------------- */
  const v = dash?.visitas || {};
  const ventasHoy = dash?.ventas_dia || {};
  const ventasMes = dash?.ventas_mes || {};
  const df = (f) => (f || "").slice(0, 16).replace("T", " ");
  const conUbicacion = cliConPos.length;

  const carteraFiltrada = useMemo(() => {
    const qq = qCartera.toLowerCase();
    return qq ? cartera.filter((c) => `${c.nombre} ${c.codigo} ${c.telefono || ""}`.toLowerCase().includes(qq)) : cartera;
  }, [qCartera, cartera]);

  const body = (
    <div className={embedded ? "space-y-4" : "space-y-5"} data-testid="mi-actividad-page">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2">
              <RouteIcon className="w-6 h-6 text-[#C1401E]" /> Mi Actividad de Campo
            </h1>
            <p className="text-slate-500 text-sm">{user?.name} · tus visitas, tu ruta y tu cartera</p>
          </div>
          <Button size="sm" variant={gpsOn ? "default" : "outline"} onClick={toggleGps}
                  className={gpsOn ? "bg-[#C1401E] hover:bg-[#A03316]" : ""}
                  data-testid="ma-gps">
            {gpsBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Crosshair className="w-4 h-4 mr-1" />}
            {gpsOn ? "GPS ON" : "Activar GPS"}
          </Button>
        </div>
      )}

      {embedded && (
        <div className="flex justify-end">
          <Button size="sm" variant={gpsOn ? "default" : "outline"} onClick={toggleGps}
                  className={gpsOn ? "bg-[#C1401E] hover:bg-[#A03316]" : ""}
                  data-testid="ma-gps">
            {gpsBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Crosshair className="w-4 h-4 mr-1" />}
            {gpsOn ? "GPS ON" : "Activar GPS"}
          </Button>
        </div>
      )}
      {gpsOn && gpsLast && (
        <span className="text-[11px] text-slate-500" data-testid="ma-gps-status">
          <b>{gpsPos ? `${gpsPos[0].toFixed(4)}, ${gpsPos[1].toFixed(4)}` : "Obteniendo…"}</b>
          {" "}· hace {Math.max(0, Math.round((Date.now() - gpsLast) / 1000))}s
        </span>
      )}

      {/* Pestañas */}
      <div className="flex rounded-md overflow-hidden border border-slate-200 w-fit">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} data-testid={`ma-tab-${t.id}`}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-[#C1401E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div>}

      {!loading && (
        <>
          {/* ============================= MIS VISITAS ============================ */}
          {tab === "visitas" && (
            <div className="space-y-4" data-testid="ma-visitas">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  [CalendarDays, "Programadas / en camino", programadas.length, "text-blue-700"],
                  [CheckCircle2, "Realizadas", realizadas.length, "text-green-700"],
                  [Clock3, "De hoy", visitasHoy.length, "text-[#C1401E]"],
                  [UserCircle2, "Clientes con visita", clientesDeVisitas.length, "text-slate-500"],
                ].map(([Ic, l, val, cls], i) => (
                  <div key={i} className="card-soft p-4">
                    <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-slate-400">{l}</span><Ic className={`w-4 h-4 ${cls}`} /></div>
                    <div className={`font-display font-black text-2xl mt-1 ${cls}`}>{val}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select value={fEstado} onValueChange={(v2) => setFEstado(v2 === "all" ? "" : v2)}>
                  <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los estados</SelectItem>
                    {Object.keys(ESTADOS).map((k) => <SelectItem key={k} value={k}>{ESTADOS_LABEL[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={fTipo} onValueChange={(v2) => setFTipo(v2 === "all" ? "" : v2)}>
                  <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Tipo de visita" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los tipos</SelectItem>
                    {Object.entries(TIPOS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="ml-auto">
                  <Button onClick={openNew} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="ma-nueva-visita">
                    <Plus className="w-4 h-4 mr-1" /> Nueva visita
                  </Button>
                </div>
              </div>

              <div className="card-soft overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="p-3">Estado</th><th className="p-3">Fecha</th><th className="p-3">Cliente</th>
                    <th className="p-3">Tipo</th><th className="p-3">Comentarios</th><th className="p-3 text-right"></th>
                  </tr></thead>
                  <tbody>
                    {visits.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-slate-400">Sin visitas registradas.</td></tr>}
                    {visits.map((vi) => (
                      <tr key={vi.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`ma-visita-${vi.id}`}>
                        <td className="p-3"><Badge className={ESTADOS[vi.estado]?.[0]}>{ESTADOS_LABEL[vi.estado] || vi.estado}</Badge></td>
                        <td className="p-3 text-slate-500">{vi.fecha_programada?.slice(0, 10)} {vi.hora}</td>
                        <td className="p-3 font-medium">{vi.cliente_nombre}</td>
                        <td className="p-3"><Badge variant="outline">{TIPOS_LABEL[vi.tipo_visita] || vi.tipo_visita}</Badge></td>
                        <td className="p-3 text-slate-500 max-w-[200px] truncate" title={vi.comentarios || ""}>{vi.comentarios || "—"}</td>
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-1">
                            {puedeEditar && (
                              <Button size="icon" variant="ghost" onClick={() => openEdit(vi)} title="Ver / editar"><Eye className="w-4 h-4" /></Button>
                            )}
                            {vi.estado !== "realizada" && vi.estado !== "cancelada" && (
                              <Button size="sm" variant="outline" onClick={async () => {
                                try { await api.post(`/visits/${vi.id}/checkin`, { comentarios: vi.comentarios }); toast.success("Visita marcada como realizada"); loadVisitas(); loadTodo(); }
                                catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
                              }}><CheckCircle2 className="w-4 h-4 mr-1" /> Realizada</Button>
                            )}
                            {vi.estado === "programada" && (
                              <Button size="sm" variant="ghost" className="text-red-500" title="Cancelar" onClick={async () => {
                                try { await api.put(`/visits/${vi.id}`, { estado: "cancelada" }); loadVisitas(); loadTodo(); }
                                catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
                              }}><XCircle className="w-4 h-4" /></Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {clientesDeVisitas.length > 0 && (
                <MapaCampo
                  clientes={clientesDeVisitas}
                  vendedores={miFlota.enMapa}
                  altura="380px"
                  autoFitKey={`${fEstado}|${fTipo}|${visits.length}|${mapKey}`}
                  vacio={{ titulo: "Sin ubicaciones de tus visitas", texto: "Los clientes visitados aparecerán cuando tengan coordenadas registradas." }}
                />
              )}
            </div>
          )}

          {/* ============================== MI RUTA =============================== */}
          {tab === "ruta" && (
            <div className="space-y-4" data-testid="ma-ruta">
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                {[
                  [TrendingUp, "Ventas hoy", money(ventasHoy.monto), "text-[#C1401E]", `${ventasHoy.numero ?? 0} ventas`],
                  [TrendingUp, "Ventas del mes", money(ventasMes.monto), "text-green-700", `${ventasMes.numero ?? 0} ventas`],
                  [Users, "Clientes asignados", cartera.length, "text-blue-700", `${conUbicacion} con ubicación`],
                  [CalendarDays, "Visitas programadas", v.programadas ?? 0, "text-slate-700", `${v.realizadas_hoy ?? 0} realizadas hoy`],
                  [CheckCircle2, "Visitas de hoy", v.total_hoy ?? 0, "text-emerald-700", ""],
                  [Wallet, "Cobros hoy", money(dash?.cobros_hoy?.monto ?? 0), "text-amber-600", `${dash?.cobros_hoy?.numero ?? 0} cobros`],
                ].map(([Ic, l, val, cls, sub], i) => (
                  <div key={i} className="card-soft p-4">
                    <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-slate-400">{l}</span><Ic className={`w-4 h-4 ${cls}`} /></div>
                    <div className={`font-display font-black text-2xl mt-1 ${cls}`}>{val}</div>
                    {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 card-soft p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><RouteIcon className="w-4 h-4" /> Ruta de tus clientes</span>
                    <Button size="sm" variant="ghost" onClick={() => setMapKey((k) => k + 1)} title="Reencuadrar"><Crosshair className="w-4 h-4" /></Button>
                  </div>
                  <MapaCampo
                    clientes={cliConPos}
                    vendedores={miFlota.enMapa}
                    altura="420px"
                    autoFitKey={`ruta|${cliConPos.length}|${mapKey}|${gpsPos ? gpsPos.join() : ""}`}
                    vacio={{ titulo: "Aún no tienes clientes con ubicación", texto: "Pide registrar las coordenadas de tus clientes para verlos en el mapa." }}
                  />
                </div>

                <div className="card-soft">
                  <div className="text-xs uppercase tracking-wider text-slate-400 p-3 flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> Visitas programadas</div>
                  <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                    {(mapp?.visitas_programadas || []).length === 0 && <div className="p-4 text-center text-sm text-slate-400">Sin visitas programadas.</div>}
                    {(mapp?.visitas_programadas || []).map((vi) => (
                      <div key={vi.id} className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{vi.cliente_nombre}</span>
                          <Badge className={ESTADOS[vi.estado]?.[0]}>{vi.estado}</Badge>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                          <CalendarDays className="w-3 h-3" /> {vi.fecha_programada?.slice(0, 10)} {vi.hora && `· ${vi.hora}`}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-slate-100 mt-2">
                    <div className="text-xs uppercase tracking-wider text-slate-400 p-3 flex items-center gap-1.5"><TrendingUp className="w-4 h-4" /> Mis ventas recientes</div>
                    <div className="divide-y divide-slate-100 max-h-[240px] overflow-y-auto">
                      {(dash?.actividad?.ultimas_ventas || []).length === 0 && <div className="p-4 text-center text-sm text-slate-400">Aún no registras ventas hoy.</div>}
                      {(dash?.actividad?.ultimas_ventas || []).map((sv, i) => (
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
                          {(dash.actividad.ultimos_cobros || []).map((cb, i) => (
                            <div key={`cb${i}`} className="flex items-center justify-between p-3">
                              <div className="text-sm">{cb.cliente_nombre || cb.folio}</div>
                              <span className="font-semibold text-emerald-700">+{money(cb.monto)}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================= MI CARTERA ============================= */}
          {tab === "cartera" && (
            <div className="space-y-4" data-testid="ma-cartera">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={qCartera} onChange={(e) => setQCartera(e.target.value)}
                         placeholder="Buscar cliente…" className="pl-9 h-9" />
                </div>
                <span className="text-sm text-slate-500">{carteraFiltrada.length} clientes · {conUbicacion} con ubicación</span>
              </div>
              <div className="card-soft overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="p-2">Cliente</th><th className="p-2">Teléfono</th>
                    <th className="p-2 text-right">Saldo</th><th className="p-2 text-right">Vencido</th>
                    <th className="p-2">Próx. visita</th><th className="p-2">GPS</th><th className="p-2">Fachada</th>
                  </tr></thead>
                  <tbody>
                    {carteraFiltrada.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">Sin clientes asignados.</td></tr>}
                    {carteraFiltrada.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="p-2 font-medium">
                          {c.nombre}
                          {(c.latitud == null || c.longitud == null) && <div className="text-[10px] text-amber-600">Sin ubicación</div>}
                        </td>
                        <td className="p-2 text-slate-500 text-xs flex items-center gap-1">{c.telefono ? <><Phone className="w-3 h-3" />{c.telefono}</> : "—"}</td>
                        <td className={`p-2 text-right font-semibold ${Number(c.saldo || 0) > 0 ? "text-amber-600" : "text-green-700"}`}>{money(c.saldo)}</td>
                        <td className="p-2 text-right text-slate-500">—</td>
                        <td className="p-2 text-slate-500 text-xs">{c.proxima_visita ? String(c.proxima_visita).slice(0, 10) : "—"}</td>
                        <td className="p-2">
                          {(c.latitud != null && c.longitud != null)
                            ? <Badge className="bg-green-100 text-green-700"><LocateFixed className="w-3 h-3 mr-1" /> Sí</Badge>
                            : <Badge variant="outline">No</Badge>}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5" data-testid={`fachada-${c.codigo}`}>
                            {c.foto_fachada ? (
                              <a href={fileUrl(c.foto_fachada)} target="_blank" rel="noreferrer"
                                 title="Ver foto de fachada">
                                <img src={fileUrl(c.foto_fachada)} alt={`Fachada de ${c.nombre}`}
                                     className="w-9 h-9 object-cover rounded-md border border-slate-200" loading="lazy" />
                              </a>
                            ) : (
                              <Camera className="w-4 h-4 text-slate-300" />
                            )}
                            <label
                              className={`cursor-pointer inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 ${
                                subiendoFachada === c.id ? "opacity-50 pointer-events-none" : ""}`}
                              title={c.foto_fachada ? "Reemplazar foto de fachada" : "Subir foto de fachada"}>
                              {subiendoFachada === c.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Camera className="w-3.5 h-3.5" />}
                              <input type="file" accept="image/*" capture="environment" className="hidden"
                                     onChange={(e) => {
                                       const f = e.target.files?.[0];
                                       e.target.value = "";
                                       subirFachada(c, f);
                                     }} />
                            </label>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Diálogo crear/editar visita */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg" data-testid="ma-visita-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing ? `Visita ${editing.cliente_nombre || ""}` : "Nueva visita"}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            <div className="relative">
              <Label className="text-xs text-slate-500">Cliente</Label>
              <Input value={clienteQuery}
                     onChange={(e) => { setClienteQuery(e.target.value); setClienteOpen(true); }}
                     onFocus={() => setClienteOpen(true)}
                     onBlur={() => setTimeout(() => setClienteOpen(false), 150)}
                     onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (filteredClientes[0]) reselectCliente(filteredClientes[0]); } }}
                     placeholder="Buscar cliente por nombre o código…" className="mt-1" />
              {clienteOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                  {filteredClientes.map((c) => (
                    <button key={c.id} type="button" onMouseDown={() => reselectCliente(c)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2">
                      <span><span className="font-medium">{c.codigo}</span> · {c.nombre}</span>
                      <Store className="w-3.5 h-3.5 text-slate-300" />
                    </button>
                  ))}
                  {filteredClientes.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">Sin resultados</div>}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-slate-500">Fecha programada</Label>
                <Input type="date" value={form.fecha_programada} onChange={(e) => setForm((s) => ({ ...s, fecha_programada: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs text-slate-500">Hora</Label>
                <Input type="time" value={form.hora} onChange={(e) => setForm((s) => ({ ...s, hora: e.target.value }))} className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-slate-500">Tipo</Label>
                <Select value={form.tipo_visita} onValueChange={(v2) => setForm((s) => ({ ...s, tipo_visita: v2 }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TIPOS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {!editing && (
                <div><Label className="text-xs text-slate-500">Estado</Label>
                  <Select value={form.estado} onValueChange={(v2) => setForm((s) => ({ ...s, estado: v2 }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(ESTADOS).map((k) => <SelectItem key={k} value={k}>{ESTADOS_LABEL[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div><Label className="text-xs text-slate-500">Comentarios</Label>
              <Input value={form.comentarios} onChange={(e) => setForm((s) => ({ ...s, comentarios: e.target.value }))} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="ma-visita-guardar">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  return body;
}
