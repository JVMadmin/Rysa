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

  /* ========== MI RUTA: filtros, captura de ubicación y ruta sugerida ===== */
  const [filtroRuta, setFiltroRuta] = useState("todos");
  const [rutaSugerida, setRutaSugerida] = useState(false);
  const [capturando, setCapturando] = useState(null);
  const [capQ, setCapQ] = useState("");
  const [selCliCard, setSelCliCard] = useState(null);
  const hoyISO = new Date().toISOString().slice(0, 10);

  const cliEnriquecidos = useMemo(() => cartera.map((c) => {
    const pos = (c.latitud != null && c.longitud != null)
      ? [Number(c.latitud), Number(c.longitud)] : null;
    const extra = (mapp?.clientes || []).find((x) => x.id === c.id) || {};
    const visitadoHoy = visits.some((vi) => vi.cliente_id === c.id
      && vi.estado === "realizada" && String(vi.fecha || "").slice(0, 10) === hoyISO);
    return { ...c, pos,
      ultima_visita: c.ultima_visita || extra.ultima_visita || "", visitadoHoy };
  }), [cartera, mapp, visits, hoyISO]);

  const sinUbicacionCount = useMemo(
    () => cliEnriquecidos.filter((c) => !c.pos).length, [cliEnriquecidos]);

  const cliMapaFiltrados = useMemo(() => cliEnriquecidos
    .filter((c) => !!c.pos)
    .filter((c) => filtroRuta !== "hoy" || c.visitadoHoy)
    .filter((c) => filtroRuta !== "pend" || !c.visitadoHoy),
  [cliEnriquecidos, filtroRuta]);

  const rutaSugeridaPts = useMemo(() => {
    if (!rutaSugerida) return [];
    const pend = cliEnriquecidos.filter((c) => c.pos && !c.visitadoHoy);
    if (!pend.length) return [];
    let cur = gpsPos || miFlota.enMapa[0]?.pos || pend[0].pos.slice();
    const rest = [...pend];
    const out = [];
    while (rest.length) {
      let bi = 0, bd = Infinity;
      rest.forEach((p, i) => {
        const d = (p.pos[0] - cur[0]) ** 2 + (p.pos[1] - cur[1]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      const nx = rest.splice(bi, 1)[0];
      out.push({ id: nx.id, nombre: nx.nombre, pos: nx.pos });
      cur = nx.pos;
    }
    return out;
  }, [rutaSugerida, cliEnriquecidos, gpsPos, miFlota]);

  const guardarUbicacionCapturada = async (pos) => {
    if (!capturando?.cliente || !pos) return;
    try {
      await api.post("/clients/" + capturando.cliente.id + "/ubicacion", {
        latitud: pos[0], longitud: pos[1], fuente: "gps_mapa",
      });
      toast.success("Ubicación guardada para " + capturando.cliente.nombre);
      setCapturando(null); setCapQ(""); loadTodo();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const usarGpsParaCaptura = () => {
    if (!navigator.geolocation) return toast.error("GPS no disponible");
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGpsBusy(false);
        guardarUbicacionCapturada([
          +p.coords.latitude.toFixed(6), +p.coords.longitude.toFixed(6)]);
      },
      () => { setGpsBusy(false); toast.error("No se pudo obtener tu ubicación"); },
      { enableHighAccuracy: true, timeout: 15000 });
  };

  const iniciarVisitaDesde = async (cli) => {
    await openNew(cli);
    setTab("visitas");
  };

  // Alta de cliente nuevo tomando la ubicación actual
  const [nuevoMapaOpen, setNuevoMapaOpen] = useState(false);
  const [nuevoMapaForm, setNuevoMapaForm] = useState({ nombre: "", telefono: "" });
  const [nuevoMapaSaving, setNuevoMapaSaving] = useState(false);
  const guardarNuevoClienteMapa = async () => {
    if (!nuevoMapaForm.nombre.trim()) return toast.error("El nombre es obligatorio");
    setNuevoMapaSaving(true);
    try {
      let coords = null;
      if (gpsPos) coords = { latitud: gpsPos[0], longitud: gpsPos[1] };
      else {
        coords = await new Promise((res) => navigator.geolocation.getCurrentPosition(
          (p) => res({ latitud: +p.coords.latitude.toFixed(6), longitud: +p.coords.longitude.toFixed(6) }),
          () => res(null), { enableHighAccuracy: true, timeout: 12000 }));
      }
      const { data } = await api.post("/clients", {
        nombre: nuevoMapaForm.nombre.trim(),
        telefono: nuevoMapaForm.telefono || "",
        latitud: coords?.latitud, longitud: coords?.longitud,
      });
      toast.success("Cliente creado: " + data.nombre);
      setNuevoMapaOpen(false); setNuevoMapaForm({ nombre: "", telefono: "" });
      loadTodo();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setNuevoMapaSaving(false); }
  };

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

  const openNew = async (presetCliente = null) => {
    setEditing(null);
    setForm({ cliente_id: presetCliente ? presetCliente.id : "", cliente_nombre: presetCliente ? presetCliente.nombre : "", cliente_nombre: "", fecha_programada: new Date().toISOString().slice(0, 10), hora: new Date().toTimeString().slice(0, 5), tipo_visita: "visita", estado: "programada", comentarios: "" });
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
      // § Ofrecer capturar ubicación si el cliente visitado no la tiene
      if (!editing) {
        const cliSin = cartera.find((cc) => cc.id === payload.cliente_id
          && (cc.latitud == null || cc.longitud == null));
        if (cliSin) {
          setCapturando({ cliente: cliSin });
          toast.info("Este cliente no tiene ubicación. Captúrala ahora en el mapa.");
        }
      }
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

              {/* Filtros del mapa + captura de ubicación */}
              <div className="card-soft p-3 flex flex-wrap items-center gap-2">
                {[
                  ["todos", "Todos"], ["con", "Con ubicación"], ["sin", `Sin ubicación (${cartera.length - cliConPos.length})`],
                  ["hoy", "Visitados hoy"], ["pend", "Pendientes"],
                ].map(([k, label]) => (
                  <button key={k} onClick={() => setFiltroRuta(k)}
                    className={`px-3 py-1.5 rounded-full text-xs border font-medium ${filtroRuta === k ? "bg-[#C1401E] text-white border-[#C1401E]" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                    data-testid={`ruta-filtro-${k}`}>{label}</button>
                ))}
                <button onClick={() => setRutaSugerida((v) => !v)}
                  className={`ml-auto px-3 py-1.5 rounded-full text-xs border font-medium ${rutaSugerida ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  data-testid="ruta-sugerida">
                  🧭 Ruta sugerida
                </button>
                <Button size="sm" variant={capturando ? "default" : "outline"}
                  onClick={() => setCapturando(capturando ? null : { abrir: true })}
                  className={capturando ? "bg-[#C1401E] hover:bg-[#A03316]" : ""}
                  data-testid="ruta-capturar-btn">
                  <Crosshair className="w-4 h-4 mr-1" /> Agregar ubicación de cliente
                </Button>
              </div>

              {capturando && (
                <div className="card-soft p-4 border-2 border-dashed border-[#C1401E]/40" data-testid="ruta-captura-panel">
                  {!capturando.cliente ? (
                    <>
                      <p className="text-sm font-semibold mb-2">Selecciona el cliente al que quieres asignar ubicación:</p>
                      <Input value={capQ} onChange={(e) => setCapQ(e.target.value)} placeholder="Buscar cliente sin ubicación…" className="mb-2 h-9" />
                      <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border rounded-md">
                        {cartera.filter((c) => !(c.latitud != null && c.longitud != null))
                          .filter((c) => !capQ || c.nombre.toLowerCase().includes(capQ.toLowerCase()) || (c.codigo || "").toLowerCase().includes(capQ.toLowerCase()))
                          .slice(0, 30).map((c) => (
                          <button key={c.id} onClick={() => setCapturando({ cliente: c })}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex justify-between">
                            <span>{c.nombre}</span>
                            <Badge variant="outline" className="text-[10px]">{c.codigo}</Badge>
                          </button>
                        ))}
                        {cartera.filter((c) => !(c.latitud != null && c.longitud != null)).length === 0 && (
                          <p className="p-3 text-sm text-slate-400 text-center">¡Todos tus clientes tienen ubicación!</p>
                        )}
                      </div>
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => setNuevoMapaOpen(true)} data-testid="nuevo-mapa-btn">
                        ➕ Nuevo cliente aquí (usa tu GPS)
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">📍 {capturando.cliente.nombre}</span>
                      <Button size="sm" onClick={usarGpsParaCaptura} disabled={gpsBusy}>
                        {gpsBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Crosshair className="w-4 h-4 mr-1" />} Usar mi GPS actual
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setCapturando(null); setCapQ(""); }}>Cancelar</Button>
                      <span className="text-xs text-slate-400 ml-auto">Toca el punto exacto en el mapa ↓</span>
                    </div>
                  )}
                </div>
              )}

              {/* Tarjeta rápida del cliente seleccionado */}
              {selCliCard && (
                <div className="card-soft p-4 space-y-3" data-testid="ruta-card-cliente">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-display font-bold">{selCliCard.nombre}</span>
                      <span className="ml-2 text-xs text-slate-400 font-mono">{selCliCard.codigo}</span>
                    </div>
                    {Number(selCliCard.saldo || 0) > 0
                      ? <Badge className="bg-amber-100 text-amber-700">Saldo: {money(selCliCard.saldo)}</Badge>
                      : <Badge className="bg-green-100 text-green-700">Sin saldo</Badge>}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <button className="rounded-lg bg-slate-50 p-2 hover:bg-slate-100 text-left" onClick={() => iniciarVisitaDesde(selCliCard)}>
                      <ListChecks className="w-3.5 h-3.5 text-[#C1401E]" /> Registrar visita
                    </button>
                    {can("pedido.gestionar") && (
                      <button className="rounded-lg bg-slate-50 p-2 hover:bg-slate-100 text-left"
                        onClick={() => { sessionStorage.setItem("preselect_pedido", JSON.stringify({ id: selCliCard.id, nombre: selCliCard.nombre })); window.location.href = "/app/pedidos"; }}>
                        📋 Levantar pedido
                      </button>
                    )}
                    {(
                      <button className="rounded-lg bg-slate-50 p-2 hover:bg-slate-100 text-left"
                        onClick={() => {
                          sessionStorage.setItem("preselect_pos", JSON.stringify({ id: selCliCard.id, nombre: selCliCard.nombre }));
                          window.location.href = "/app/pos";
                        }}>
                        🛒 Venta directa
                      </button>
                    )}
                    {can("cxc.abono") && (
                      <button className="rounded-lg bg-slate-50 p-2 hover:bg-slate-100 text-left"
                        onClick={() => { sessionStorage.setItem("preselect_cxc", JSON.stringify({ id: selCliCard.id })); window.location.href = "/app/cxc"; }}>
                        💰 Cobrar
                      </button>
                    )}
                    {selCliCard.pos && (
                      <>
                        <a className="rounded-lg bg-blue-50 p-2 hover:bg-blue-100 text-left text-blue-700"
                          href={`https://www.google.com/maps/dir/?api=1&destination=${selCliCard.pos[0]},${selCliCard.pos[1]}`} target="_blank" rel="noreferrer">
                          🗺️ Google Maps
                        </a>
                        <a className="rounded-lg bg-blue-50 p-2 hover:bg-blue-100 text-left text-blue-700"
                          href={`https://waze.com/ul?ll=${selCliCard.pos[0]},${selCliCard.pos[1]}&navigate=yes`} target="_blank" rel="noreferrer">
                          🧭 Waze
                        </a>
                      </>
                    )}
                  </div>
                  {(selCliCard.ultima_visita || selCliCard.proxima_visita) && (
                    <div className="text-[11px] text-slate-400">
                      Últ. visita: {selCliCard.ultima_visita ? String(selCliCard.ultima_visita).slice(0, 10) : "—"} · Próxima: {selCliCard.proxima_visita ? String(selCliCard.proxima_visita).slice(0, 10) : "—"}
                    </div>
                  )}
                </div>
              )}

              <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 card-soft p-4 relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><RouteIcon className="w-4 h-4" /> Ruta de tus clientes</span>
                    <div className="flex items-center gap-2">
                      {rutaSugerida && <span className="text-[11px] text-amber-600 font-medium">🧭 Orden sugerido activo</span>}
                      <Button size="sm" variant="ghost" onClick={() => setMapKey((k) => k + 1)} title="Reencuadrar"><Crosshair className="w-4 h-4" /></Button>
                    </div>
                  </div>
                  <MapaCampo
                    clientes={cliMapaFiltrados}
                    vendedores={miFlota.enMapa}
                    rutaSugeridaPts={rutaSugeridaPts}
                    modoCaptura={!!capturando?.cliente}
                    onCapturaPunto={(pos) => guardarUbicacionCapturada(pos)}
                    selClienteId={selCliCard?.id || ""}
                    onSelectCliente={(id) => { const c = cliMapaFiltrados.find((x) => x.id === id); if (c) setSelCliCard(c); }}
                    altura="460px"
                    autoFitKey={`ruta|${cliConPos.length}|${mapKey}|${filtroRuta}|${gpsPos ? gpsPos.join() : ""}`}
                    vacio={{ titulo: filtroRuta === "sin" ? "¡Todos tus clientes tienen ubicación!" : "Aún no tienes clientes con ubicación", texto: "Usa «Agregar ubicación de cliente» para capturarla frente al negocio." }}
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

      {/* Alta de cliente nuevo desde el mapa */}
      <Dialog open={nuevoMapaOpen} onOpenChange={setNuevoMapaOpen}>
        <DialogContent data-testid="nuevo-mapa-dialog">
          <DialogHeader><DialogTitle className="font-display">Nuevo cliente en mi ubicación</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Nombre / Razón social *</Label>
              <Input value={nuevoMapaForm.nombre} onChange={(e) => setNuevoMapaForm((s) => ({ ...s, nombre: e.target.value }))} data-testid="nuevo-mapa-nombre" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Teléfono</Label>
              <Input value={nuevoMapaForm.telefono} onChange={(e) => setNuevoMapaForm((s) => ({ ...s, telefono: e.target.value.replace(/[^\d]/g, "") }))} maxLength={10} data-testid="nuevo-mapa-tel" /></div>
            <p className="text-xs text-slate-400">Se guardará con tu ubicación GPS actual como punto del negocio.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevoMapaOpen(false)}>Cancelar</Button>
            <Button onClick={guardarNuevoClienteMapa} disabled={nuevoMapaSaving} className="bg-[#C1401E] hover:bg-[#A03316]">
              {nuevoMapaSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />} Crear cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
