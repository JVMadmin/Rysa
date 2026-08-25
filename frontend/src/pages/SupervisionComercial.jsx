import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2, Users, Activity as ActivityIcon, Wallet, TrendingUp, CheckCircle2,
  Clock3, ChevronRight, Filter, Radio, Pencil, RefreshCw, Search, Store,
  Crosshair, UserCog, ReceiptText, MapPin, Radar,
} from "lucide-react";

import SelectorVendedor from "@/components/campo/SelectorVendedor";
import MapaCampo from "@/components/campo/MapaCampo";
import FichaCliente from "@/components/campo/FichaCliente";
import { TarjetaInfoVendedor } from "@/components/campo/VendedoresMapa";
import { separarVendedores } from "@/lib/ubicaciones";
import MiActividadCampo from "@/pages/MiActividadCampo";

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "vendedores", label: "Vendedores" },
  { id: "mapa", label: "Mapa en vivo" },
  { id: "clientes", label: "Clientes" },
];

const ESTADO_BADGE = {
  activo: "bg-green-100 text-green-700",
  en_ruta: "bg-emerald-100 text-emerald-700",
  sin_actividad: "bg-red-100 text-red-700",
  sin_datos: "bg-slate-200 text-slate-600",
};
const fmt = (f) => (f || "").slice(0, 16).replace("T", " ");
const PAGE_CARTERA = 100;

/**
 * ===========================================================================
 * MÓDULO 1 — SUPERVISIÓN COMERCIAL (admin/dueño/supervisor).
 * Fusiona en un solo módulo con pestañas internas lo que antes eran
 * Seguimiento + Mapa + Clientes en campo + Vendedores.
 * Datos: MISMAS fuentes que ya existían (/supervision/*). Un solo componente
 * de mapa (MapaCampo) y un solo selector de vendedores compartidos.
 * ===========================================================================
 */
export default function SupervisionComercial() {
  const { can } = useAuth();
  const puedeCartera = can("supervision.cartera");
  const puedeActividad = can("supervision.actividad");
  // Toggle "actuar como vendedor" dentro del mismo panel (regla 2).
  const puedeCampo = can("visita.ver") || can("visita.crear");

  const [tab, setTab] = useState("resumen");
  const [comoVendedor, setComoVendedor] = useState(false);

  const [kpi, setKpi] = useState(null);
  const [vendedores, setVendedores] = useState([]);
  const [actividad, setActividad] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orden, setOrden] = useState("ventas");
  const [sucursal, setSucursal] = useState("");
  const [sucursales, setSucursales] = useState([]);

  // /supervision/map: UNA sola fuente para pestañas Mapa y Clientes.
  const [mapa, setMapa] = useState(null);
  const [mapaErr, setMapaErr] = useState("");
  const [liveOn, setLiveOn] = useState(false);
  const [liveLast, setLiveLast] = useState(null);

  // Selecciones de mapa
  const [selVen, setSelVen] = useState("");
  const [selCliId, setSelCliId] = useState("");
  const [enfocar, setEnfocar] = useState(0);

  // Filtros pestaña Clientes
  const [qCli, setQCli] = useState("");
  const [fVendCli, setFVendCli] = useState("all");
  const [fAdeudo, setFAdeudo] = useState("todos");

  // Búsqueda vendedores
  const [qVen, setQVen] = useState("");

  // Cartera (asignación)
  const [carOpen, setCarOpen] = useState(false);
  const [carVend, setCarVend] = useState(null);
  const [carClients, setCarClients] = useState([]);
  const [carSel, setCarSel] = useState(new Set());
  const [carQ, setCarQ] = useState("");
  const [carPage, setCarPage] = useState(0);
  const [carBusy, setCarBusy] = useState(false);
  const [detLoading, setDetLoading] = useState(false);
  const [detalle, setDetalle] = useState(null);

  /* ------------------------------- carga -------------------------------- */
  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (sucursal) params.sucursal_id = sucursal;
      const [k, v] = await Promise.all([
        api.get("/supervision/dashboard", { params }).catch(() => ({ data: null })),
        puedeCartera || can("supervision.ver")
          ? api.get("/supervision/sellers", { params: { ...params, order_by: orden } }).catch(() => ({ data: { vendedores: [] } }))
          : Promise.resolve({ data: null }),
      ]);
      setKpi(k.data);
      if (v.data) setVendedores(v.data.vendedores || []);
    } finally { setLoading(false); }
  }, [sucursal, orden, puedeCartera, can]);

  const loadActividad = useCallback(async () => {
    if (!puedeActividad) return;
    try {
      const params = {};
      if (sucursal) params.sucursal_id = sucursal;
      const { data } = await api.get("/supervision/activity", { params });
      setActividad(Array.isArray(data) ? data : []);
    } catch { /* silencioso */ }
  }, [sucursal, puedeActividad]);

  const loadMapa = useCallback(async () => {
    try {
      const params = {};
      if (sucursal) params.sucursal_id = sucursal;
      const { data } = await api.get("/supervision/map", { params });
      setMapa(data);
      setMapaErr("");
      setLiveLast(Date.now());
    } catch (e) {
      setMapa(null);
      setMapaErr(e?.response?.status === 403
        ? "No tienes permiso de supervisión de campo."
        : "No se pudo cargar el mapa.");
    }
  }, [sucursal]);

  useEffect(() => { api.get("/sucursales").then((r) => setSucursales(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => { loadActividad(); }, [loadActividad]);
  useEffect(() => { loadMapa(); }, [loadMapa]);
  useEffect(() => {
    if (!liveOn) return;
    const id = setInterval(loadMapa, 10000);
    return () => clearInterval(id);
  }, [liveOn, loadMapa]);

  /* --------------------------- normalización ---------------------------- */
  const flota = useMemo(() => separarVendedores(mapa?.vendedores), [mapa]);
  const selInfo = useMemo(() => flota.enMapa.find((v) => v.id === selVen) || null, [flota, selVen]);
  const elegirVen = (id) => { setSelVen(id); if (!id) setEnfocar((t) => t + 1); };

  /* ------------------------- pestaña Clientes --------------------------- */
  const cliFiltrados = useMemo(() => (mapa?.clientes || []).filter((c) => {
    if (qCli && !`${c.nombre} ${c.codigo} ${c.telefono || ""} ${c.ciudad || ""}`.toLowerCase().includes(qCli.toLowerCase())) return false;
    if (fVendCli !== "all" && c.vendedor_id !== fVendCli) return false;
    if (fAdeudo === "vencido" && !(Number(c.vencido || 0) > 0)) return false;
    if (fAdeudo === "saldo" && !(Number(c.saldo || 0) > 0)) return false;
    if (fAdeudo === "limpio" && Number(c.saldo || 0) > 0) return false;
    return true;
  }), [mapa, qCli, fVendCli, fAdeudo]);

  const ficha = useMemo(
    () => cliFiltrados.find((c) => c.id === selCliId) || (mapa?.clientes || []).find((c) => c.id === selCliId) || null,
    [cliFiltrados, mapa, selCliId]);
  const ubicar = (id) => { setSelCliId(id); setEnfocar((t) => t + 1); };

  /* ------------------------ pestaña Vendedores -------------------------- */
  const venFiltrados = useMemo(
    () => vendedores.filter((v) => !qVen || `${v.name || ""} ${v.role || ""}`.toLowerCase().includes(qVen.toLowerCase())),
    [vendedores, qVen]);

  /* ----------------------------- cartera -------------------------------- */
  const openCartera = async (v) => {
    setCarOpen(true); setCarVend(v); setCarQ(""); setCarPage(0);
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
  const toggleCar = (id) => setCarSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const guardarCartera = async () => {
    if (!carVend) return;
    setCarBusy(true);
    try {
      const { data } = await api.post("/supervision/cartera", {
        vendedor_id: carVend.id, cliente_ids: [...carSel], reemplazar: true,
      });
      toast.success(`Cartera de ${data.vendedor} actualizada (${data.asignados} clientes)`);
      setCarOpen(false); loadBase(); loadActividad(); loadMapa();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setCarBusy(false); }
  };

  const openDetalle = async (id) => {
    setDetalle(null); setDetLoading(true);
    try { const { data } = await api.get(`/supervision/sellers/${id}`); setDetalle(data); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setDetLoading(false); }
  };

  const k = kpi || {};
  const kCards = [
    [Users, "Vendedores", k.vendedores?.total ?? 0, "text-slate-700"],
    [ActivityIcon, "Activos", k.vendedores?.activos ?? 0, "text-green-700"],
    [Radio, "En ruta", k.vendedores?.en_ruta ?? 0, "text-emerald-700"],
    [Clock3, "Sin actividad", k.vendedores?.sin_actividad ?? 0, "text-red-600"],
    [CheckCircle2, "Visitas hoy", k.visitas?.hoy ?? 0, "text-[#C1401E]"],
    [Wallet, "Cobranza hoy", money(k.cobranza_dia ?? 0), "text-blue-700"],
    [TrendingUp, "Ventas hoy", money(k.ventas_dia?.monto ?? 0), "text-slate-700"],
    [CheckCircle2, "Clientes visitados", k.clientes?.visitados_hoy ?? 0, "text-emerald-700"],
  ];

  /* --------------------- modo "actuar como vendedor" -------------------- */
  if (comoVendedor && puedeCampo) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">Viendo el sistema como vendedor de campo.</p>
          <Button size="sm" variant="outline" onClick={() => { setComoVendedor(false); loadBase(); }}>
            <Crosshair className="w-4 h-4 mr-1" /> Volver a supervisión
          </Button>
        </div>
        <MiActividadCampo embedded />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="supervision-comercial-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2">
            <Radar className="w-6 h-6 text-[#C1401E]" /> Supervisión Comercial
          </h1>
          <p className="text-slate-500 text-sm">Fuerza de ventas: resumen, vendedores, GPS en vivo y clientes en campo</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          {sucursales.length > 0 && (
            <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}
                    className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="sc-filtro-sucursal">
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
          {puedeCampo && (
            <Button size="sm" variant="outline" onClick={() => setComoVendedor(true)}
                    title="Usar el panel del vendedor dentro de este módulo"
                    data-testid="sc-como-vendedor">
              <UserCog className="w-4 h-4 mr-1" /> Actuar como vendedor
            </Button>
          )}
        </div>
      </div>

      {/* Pestañas internas (sin rutas extra) */}
      <div className="flex flex-wrap rounded-md overflow-hidden border border-slate-200 w-fit">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} data-testid={`sc-tab-${t.id}`}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-[#C1401E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && tab === "resumen" ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div>
      ) : (
        <>
          {/* ============================== RESUMEN ============================== */}
          {tab === "resumen" && (
            <div className="space-y-4" data-testid="sc-resumen">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {kCards.map(([Ic, l, v, cls], i) => (
                  <div key={i} className="card-soft p-4" data-testid={`sc-kpi-${i}`}>
                    <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-slate-400">{l}</span><Ic className={`w-4 h-4 ${cls}`} /></div>
                    <div className={`font-display font-black text-2xl mt-1 ${cls}`}>{v}</div>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 card-soft overflow-x-auto">
                  <div className="flex flex-wrap items-center justify-between p-3 gap-2">
                    <span className="text-xs uppercase tracking-wider text-slate-400">Cartera por vendedor</span>
                    <Select value={orden} onValueChange={setOrden}>
                      <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ventas">Por ventas (mes)</SelectItem>
                        <SelectItem value="vencido">Por CxC vencida</SelectItem>
                        <SelectItem value="cartera">Por cartera</SelectItem>
                        <SelectItem value="cobranza">Por cobranza hoy</SelectItem>
                        <SelectItem value="clientes">Por clientes asignados</SelectItem>
                        <SelectItem value="visitas">Por visitas realizadas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="p-2">Vendedor</th><th className="p-2">Estado</th><th className="p-2 text-right">Clientes</th>
                      <th className="p-2 text-right">Cartera</th><th className="p-2 text-right">Vencido</th>
                      <th className="p-2 text-right">Ventas mes</th><th className="p-2 text-right">Hoy</th><th className="p-2 text-right">Cobros</th><th className="p-2"></th>
                    </tr></thead>
                    <tbody>
                      {vendedores.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-slate-400">Sin vendedores de campo para este filtro.</td></tr>}
                      {vendedores.map((v) => (
                        <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`sc-cartera-${v.id}`}>
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
                              {puedeCartera && (
                                <Button size="sm" variant="outline" onClick={() => openCartera(v)} data-testid={`sc-cartera-btn-${v.id}`}>
                                  <Pencil className="w-3.5 h-3.5 mr-1" /> Cartera
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" onClick={() => openDetalle(v.id)}><ChevronRight className="w-4 h-4" /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {k.clientes_mayor_adeudo?.length > 0 && (
                    <div className="border-t border-slate-100 p-3">
                      <span className="text-xs uppercase tracking-wider text-slate-400">Mayores adeudos</span>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {k.clientes_mayor_adeudo.map((c, i) => (
                          <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs">
                            <span className="font-semibold">{c.nombre}</span> {money(c.saldo)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {puedeActividad && (
                  <div className="card-soft">
                    <div className="text-xs uppercase tracking-wider text-slate-400 p-3">Actividad de vendedores</div>
                    <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                      {actividad.length === 0 && <div className="p-4 text-center text-sm text-slate-400">Sin actividad registrada.</div>}
                      {actividad.slice(0, 20).map((a, i) => (
                        <div key={i} className="flex items-center gap-2.5 p-3">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ESTADO_DOT_HEX[a.estado] || "#94a3b8" }} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{a.name}</div>
                            <div className="text-xs text-slate-400 truncate">{a.ultima_actividad ? `Última: ${fmt(a.ultima_actividad)}` : "Sin actividad"}</div>
                          </div>
                          <div className="text-xs text-slate-400 text-right shrink-0">
                            {a.visitas_hoy > 0 && <div className="text-[#C1401E]">{a.visitas_hoy} visitas</div>}
                            {a.cobros_hoy > 0 && <div className="text-emerald-600">{money(a.cobros_hoy)}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================= VENDEDORES ============================ */}
          {tab === "vendedores" && (
            <div className="space-y-4" data-testid="sc-vendedores">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex-1 max-w-md relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={qVen} onChange={(e) => setQVen(e.target.value)}
                         placeholder="Buscar vendedor por nombre o rol…" className="pl-9 h-9" data-testid="sc-vend-q" />
                </div>
                <Button variant="outline" className="h-9" onClick={loadBase}><RefreshCw className="w-4 h-4 mr-1" /> Actualizar</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {venFiltrados.length === 0 && <div className="col-span-full card-soft p-12 text-center text-slate-400">Sin vendedores registrados.</div>}
                {venFiltrados.map((v) => (
                  <div key={v.id} className="card-soft p-5 space-y-3" data-testid={`sc-vendedor-${v.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-[#C1401E]/10 flex items-center justify-center">
                          <UserCog className="w-5 h-5 text-[#C1401E]" />
                        </div>
                        <div>
                          <div className="font-display font-bold truncate">{v.name || "—"}</div>
                          <Badge variant="outline" className="capitalize">{v.role || "vendedor"}</Badge>
                        </div>
                      </div>
                      <Badge className={ESTADO_BADGE[v.estado] || ""}>{v.estado || "sin_datos"}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {[
                        ["Clientes", v.clientes_asignados || 0, ""],
                        ["Con adeudo", v.clientes_con_adeudo || 0, ""],
                        ["Cartera", money(v.cartera_total), "text-red-600"],
                        ["Vto. vencido", money(v.cxc_vencida), "text-red-600"],
                        ["Ventas mes", money(v.ventas_mes), "text-green-700"],
                        ["Ventas hoy", money(v.ventas_hoy), ""],
                        ["Cobros hoy", money(v.cobros_hoy), "text-green-600"],
                        ["Visitas", v.visitas_realizadas || 0, ""],
                      ].map(([l, val, cls], i) => (
                        <div key={i} className="rounded-lg bg-slate-50 p-2">
                          <div className="text-[10px] uppercase text-slate-400">{l}</div>
                          <div className={`font-semibold ${cls}`}>{val}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {v.ultima_actividad
                        ? <span className="text-[11px] text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> Últ. actividad: {fmt(v.ultima_actividad)}</span>
                        : <span />}
                      <Button size="sm" variant="ghost" onClick={() => openDetalle(v.id)}>
                        Detalle <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ============================ MAPA EN VIVO =========================== */}
          {tab === "mapa" && (
            <div className="space-y-4" data-testid="sc-mapa">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SelectorVendedor vendedores={flota.enMapa} valor={selVen} onChange={elegirVen}
                                  sinGpsCount={flota.sinGps.length} />
                <div className="flex items-center gap-3">
                  {liveOn && liveLast && (
                    <span className="text-[11px] text-slate-400">Actualizado hace {Math.max(0, Math.round((Date.now() - liveLast) / 1000))}s</span>
                  )}
                  <Button size="sm" variant={liveOn ? "default" : "outline"} onClick={() => setLiveOn((v) => !v)}
                          className={liveOn ? "bg-[#C1401E] hover:bg-[#A03316]" : ""}
                          data-testid="sc-live-toggle">
                    {liveOn ? <><Radio className="w-4 h-4 mr-1 animate-pulse" /> En vivo ON</> : <><Radio className="w-4 h-4 mr-1" /> Activar en vivo</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={loadMapa}><RefreshCw className="w-4 h-4" /></Button>
                </div>
              </div>

              {mapaErr ? (
                <div className="card-soft p-6 text-center text-slate-500">{mapaErr}</div>
              ) : !mapa ? (
                <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>
              ) : (
                <>
                  {selInfo && <TarjetaInfoVendedor v={selInfo} />}
                  {!selInfo && selVen && flota.sinGps.some((v) => v.id === selVen) && (
                    <TarjetaInfoVendedor v={flota.sinGps.find((v) => v.id === selVen)} sinGps />
                  )}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#EAB308]" /> Cliente</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500" /> En ruta</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500" /> Activo</span>
                    <span className="ml-auto">{flota.enMapa.length} vendedores con GPS · {(mapa.clientes || []).length} clientes · {flota.sinGps.length} sin ubicación</span>
                  </div>
                  <MapaCampo
                    clientes={mapa.clientes || []}
                    vendedores={flota.enMapa}
                    selVendedorId={selVen}
                    onSelectVendedor={elegirVen}
                    autoFitKey={liveLast || 0}
                    altura="560px"
                    vacio={{
                      titulo: "Aún no hay ubicaciones para mostrar",
                      texto: "Los vendedores comparten su GPS desde «Mi Actividad de Campo».",
                    }}
                  />
                  {flota.sinGps.length > 0 && (
                    <p className="text-[11px] text-slate-400">
                      Sin ubicación GPS ({flota.sinGps.length}): {flota.sinGps.map((v) => v.name).join(", ")}.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ============================== CLIENTES ============================= */}
          {tab === "clientes" && (
            <div className="space-y-4" data-testid="sc-clientes">
              <div className="flex flex-wrap items-end gap-3 card-soft p-3">
                <div className="flex-1 min-w-[200px]">
                  <span className="text-[10px] uppercase text-slate-400">Buscar</span>
                  <Input value={qCli} onChange={(e) => setQCli(e.target.value)}
                         placeholder="Nombre, código, teléfono, ciudad…" className="mt-1 h-9" data-testid="sc-cli-q" />
                </div>
                <div>
                  <span className="text-[10px] uppercase text-slate-400">Vendedor</span>
                  <select value={fVendCli} onChange={(e) => setFVendCli(e.target.value)}
                          className="mt-1 h-9 border border-slate-200 rounded-md px-2 text-sm w-44" data-testid="sc-cli-vendedor">
                    <option value="all">Todos</option>
                    {[...(mapa?.vendedores || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)))
                      .map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-slate-400">Estado</span>
                  <select value={fAdeudo} onChange={(e) => setFAdeudo(e.target.value)}
                          className="mt-1 h-9 border border-slate-200 rounded-md px-2 text-sm w-44" data-testid="sc-cli-adeudo">
                    <option value="todos">Todos</option>
                    <option value="vencido">Con saldo vencido</option>
                    <option value="saldo">Con saldo</option>
                    <option value="limpio">Sin saldo</option>
                  </select>
                </div>
                <Button variant="outline" className="h-9" onClick={loadMapa}><RefreshCw className="w-4 h-4 mr-1" /> Actualizar</Button>
              </div>

              <div className="grid lg:grid-cols-5 gap-4 items-start">
                {/* Listado */}
                <div className="lg:col-span-2 card-soft overflow-x-auto lg:max-h-[70vh] lg:overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="p-2">Cliente</th>
                      <th className="p-2">Fachada</th>
                      {can("supervision.ver") && <th className="p-2">Vendedor</th>}
                      <th className="p-2 text-right">Saldo</th><th className="p-2 text-right">Vencido</th><th className="p-2 text-right"></th>
                    </tr></thead>
                    <tbody>
                      {cliFiltrados.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">Sin clientes con esos filtros.</td></tr>}
                      {cliFiltrados.map((c) => (
                        <tr key={c.id} className={`border-t border-slate-100 cursor-pointer ${selCliId === c.id ? "bg-orange-50" : "hover:bg-slate-50"}`}
                            onClick={() => ubicar(c.id)} data-testid={`sc-cli-${c.codigo}`}>
                          <td className="p-2">
                            <div className="font-medium truncate max-w-[160px]">{c.nombre}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{c.codigo}</div>
                          </td>
                          <td className="p-2">
                            {c.foto_fachada ? (
                              <a href={fileUrl(c.foto_fachada)} target="_blank" rel="noreferrer"
                                 onClick={(e) => e.stopPropagation()} title="Ver foto de fachada">
                                <img src={fileUrl(c.foto_fachada)} alt={`Fachada de ${c.nombre}`}
                                     className="w-11 h-11 object-cover rounded-md border border-slate-200" loading="lazy" />
                              </a>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                          {can("supervision.ver") && <td className="p-2 text-slate-500 text-xs">{c.vendedor_nombre || "—"}</td>}
                          <td className={`p-2 text-right font-semibold ${Number(c.saldo || 0) > 0 ? "text-amber-600" : "text-slate-300"}`}>{money(c.saldo)}</td>
                          <td className={`p-2 text-right font-semibold ${Number(c.vencido || 0) > 0 ? "text-red-600" : "text-slate-300"}`}>{money(c.vencido)}</td>
                          <td className="p-2 text-right">
                            <Button size="icon" variant="ghost" title="Ubicar en el mapa y ver ficha"
                                    onClick={(e) => { e.stopPropagation(); ubicar(c.id); }}
                                    data-testid={`sc-cli-ubicar-${c.codigo}`}>
                              <Crosshair className="w-4 h-4 text-[#C1401E]" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mapa + ficha rápida */}
                <div className="lg:col-span-3 space-y-3">
                  {ficha && <FichaCliente c={ficha} onCerrar={() => setSelCliId("")} />}
                  <MapaCampo
                    clientes={cliFiltrados}
                    vendedores={[]}
                    selClienteId={selCliId}
                    onSelectCliente={ubicar}
                    enfocarTrigger={enfocar}
                    autoFitKey={`${qCli}|${fVendCli}|${fAdeudo}`}
                    altura={ficha ? "420px" : "520px"}
                    mostrarVendedores={false}
                    vacio={{ titulo: "Sin clientes con ubicación GPS", texto: "Registra coordenadas en la ficha del cliente para verlo aquí." }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Diálogo asignar cartera */}
      <Dialog open={carOpen} onOpenChange={setCarOpen}>
        <DialogContent className="max-w-3xl" data-testid="sc-cartera-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Users className="w-5 h-5" /> Cartera de {carVend?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Marca los clientes que pertenecerán a {carVend?.name}. Los que dejes sin marcar y ya estaban en su cartera quedarán sin asignar.</p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input placeholder="Buscar por clave, nombre o RFC…" value={carQ}
                     onChange={(e) => { setCarQ(e.target.value); setCarPage(0); }} className="pl-9 h-9" />
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
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2 text-center"><input type="checkbox" checked={carSel.has(c.id)} onChange={() => toggleCar(c.id)} /></td>
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
            <Button onClick={guardarCartera} disabled={carBusy} className="bg-[#C1401E] hover:bg-[#A03316]">
              {carBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Store className="w-4 h-4 mr-1" />} Asignar cartera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle de vendedor */}
      <Dialog open={!!detalle || detLoading} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="font-display">{detalle?.vendedor?.name || "Cargando…"}</DialogTitle></DialogHeader>
          {detLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#C1401E]" /></div>
          ) : detalle && (
            <div className="text-sm space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ["Ventas hoy", money(detalle.vendedor.ventas_hoy.monto)],
                  ["Ventas mes", money(detalle.vendedor.ventas_mes.monto)],
                  ["Cobros hoy", money(detalle.vendedor.cobros_hoy)],
                  ["Cartera", money(detalle.vendedor.cxc.saldo_total)],
                ].map(([l, v], i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">{l}</div>
                    <div className="font-semibold">{v}</div>
                  </div>
                ))}
              </div>
              {(detalle.clientes || []).length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5"><ReceiptText className="w-4 h-4" /> Cartera ({detalle.clientes.length})</div>
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

const ESTADO_DOT_HEX = {
  activo: "#22c55e", en_ruta: "#10b981", sin_actividad: "#ef4444", sin_datos: "#94a3b8",
};
