import { useEffect, useMemo, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Loader2, MapPinned, Plus, CalendarDays, CheckCircle2, Clock3, UserCircle2, XCircle,
  Store, Map as MapIcon, ListChecks, Eye,
} from "lucide-react";

const ESTADOS = {
  programada: ["bg-blue-100 text-blue-700"],
  en_camino: ["bg-amber-100 text-amber-700"],
  realizada: ["bg-green-100 text-green-700"],
  cancelada: ["bg-red-100 text-red-700"],
  no_localizado: ["bg-slate-200 text-slate-600"],
};
const ESTADOS_LABEL = { programada: "Programada", en_camino: "En camino", realizada: "Realizada", cancelada: "Cancelada", no_localizado: "No localizado" };
const TIPOS_LABEL = { visita: "Visita", cobro: "Cobro", nueva: "Nueva", seguimiento: "Seguimiento" };

const dotIcon = (bg) =>
  L.divIcon({
    className: "rysa-map-dot",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });

const MAP_THEME = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export default function Visitas() {
  const { user, can } = useAuth();
  const isSup = can("supervision.mapa") || can("supervision.ver");
  const puedeEditar = can("visita.editar");

  const [tab, setTab] = useState("lista");
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState([]);
  const [mapData, setMapData] = useState(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [mapLive, setMapLive] = useState(false);
  const [mapLast, setMapLast] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clienteQuery, setClienteQuery] = useState("");
  const [form, setForm] = useState({ cliente_id: "", cliente_nombre: "", fecha_programada: "", hora: "", tipo_visita: "visita", estado: "programada", comentarios: "", vendedor_id: "" });
  const [vendedores, setVendedores] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadVisits = async () => {
    setLoading(true);
    const params = {};
    if (fEstado) params.estado = fEstado;
    if (fTipo) params.tipo_visita = fTipo;
    try {
      const { data } = await api.get("/visits", { params });
      setVisits(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setLoading(false); }
  };

  const loadMap = async () => {
    if (!can("supervision.mapa") && !can("supervision.ver") && !can("visita.ver")) return;
    setMapLoading(true);
    try {
      const url = isSup ? "/supervision/map" : "/seller/map";
      const { data } = await api.get(url);
      setMapData(data);
    } catch (e) { /* role sin mapa */ setMapData(null); }
    finally { setMapLoading(false); }
  };

  const loadMeta = async () => {
    try {
      const c = await api.get("/clients", { params: { estado: "activo" } });
      setClientes(c.data || []);
      const v = await api.get("/vendedores");
      setVendedores(v.data || []);
    } catch {}
  };

  useEffect(() => { loadVisits(); /* eslint-disable-next-line */ }, [fEstado, fTipo]);
  useEffect(() => { loadMap(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadMeta(); }, []);

  // Mapa en vivo: refresca posiciones cada 10s mientras esté activado.
  useEffect(() => {
    if (!mapLive) return;
    const tick = async () => { await loadMap(); setMapLast(Date.now()); };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, [mapLive]);

  const filteredClientes = useMemo(() => {
    const q = clienteQuery.toLowerCase();
    return q
      ? clientes.filter((c) => `${c.codigo} ${c.nombre} ${c.rfc || ""}`.toLowerCase().includes(q)).slice(0, 50)
      : clientes.slice(0, 50);
  }, [clienteQuery, clientes]);

  const openNew = () => {
    setEditing(null);
    setForm({ cliente_id: "", cliente_nombre: "", fecha_programada: new Date().toISOString().slice(0, 10), hora: new Date().toTimeString().slice(0, 5), tipo_visita: "visita", estado: "programada", comentarios: "", vendedor_id: "" });
    setClienteQuery("");
    setFormOpen(true);
  };
  const openEdit = (v) => {
    setEditing(v);
    setForm({
      cliente_id: v.cliente_id, cliente_nombre: v.cliente_nombre || "",
      fecha_programada: (v.fecha_programada || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      hora: (v.hora || "").slice(0, 5) || new Date().toTimeString().slice(0, 5),
      tipo_visita: v.tipo_visita || "visita", estado: v.estado || "programada",
      comentarios: v.comentarios || "", vendedor_id: v.vendedor_id || "",
    });
    setClienteQuery(v.cliente_nombre || "");
    setFormOpen(true);
  };

  const guardar = async () => {
    const payload = {
      cliente_id: form.cliente_id,
      cliente_nombre: form.cliente_nombre,
      fecha_programada: form.fecha_programada,
      hora: form.hora,
      tipo_visita: form.tipo_visita,
      estado: editing ? undefined : form.estado,
      comentarios: form.comentarios,
      vendedor_id: form.vendedor_id || undefined,
    };
    if (!payload.cliente_id) return toast.error("Selecciona un cliente");
    setSaving(true);
    try {
      if (editing) await api.put(`/visits/${editing.id}`, payload);
      else await api.post("/visits", payload);
      toast.success(editing ? "Visita actualizada" : "Visita creada");
      setFormOpen(false);
      loadVisits(); loadMap();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const reselectCliente = (c) => {
    setForm((s) => ({ ...s, cliente_id: c?.id || "publico", cliente_nombre: c?.nombre || "" }));
    setClienteQuery(c ? `${c.codigo || ""} ${c.nombre}`.trim() : "Público General");
    setClienteOpen(false);
  };

  const sellers = mapData?.vendedores || [];
  const clientesMap = mapData?.clientes || [];
  const mapPts = clientesMap.length + sellers.length;
  const bounds = useMemo(() => {
    const pts = [
      ...clientesMap.map((c) => [Number(c.latitud), Number(c.longitud)]),
      ...sellers.filter((s) => s.ultima_ubicacion).map((s) => [Number(s.ultima_ubicacion.latitud), Number(s.ultima_ubicacion.longitud)]),
    ].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    return pts.length ? pts : [[20.59, -100.39]];
  }, [clientesMap, sellers]);

  const center = useMemo(() => {
    const lats = bounds.map((p) => p[0]), lngs = bounds.map((p) => p[1]);
    const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    return [lat, lng];
  }, [bounds]);

  const visitasHoy = visits.filter((v) => (v.fecha || "").slice(0, 10) === new Date().toISOString().slice(0, 10));
  const realizadas = visits.filter((v) => v.estado === "realizada");
  const programadas = visits.filter((v) => v.estado === "programada" || v.estado === "en_camino");

  return (
    <div className="space-y-5" data-testid="visitas-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><MapPinned className="w-6 h-6 text-[#C1401E]" /> Visitas Comerciales</h1>
          <p className="text-slate-500 text-sm">{visits.length} visitas registradas</p>
        </div>
        {puedeEditar && <Button onClick={openNew} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="nueva-visita"><Plus className="w-4 h-4 mr-1" /> Nueva visita</Button>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          [CalendarDays, "Programadas / en camino", programadas.length, "text-blue-700"],
          [CheckCircle2, "Realizadas", realizadas.length, "text-green-700"],
          [Clock3, "De hoy", visitasHoy.length, "text-[#C1401E]"],
          [UserCircle2, "Clientes en mapa", mapPts, "text-slate-500"],
        ].map(([Ic, l, v, cls], i) => (
          <div key={i} className="card-soft p-4">
            <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-slate-400">{l}</span><Ic className={`w-4 h-4 ${cls}`} /></div>
            <div className={`font-display font-black text-2xl mt-1 ${cls}`}>{v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex rounded-md overflow-hidden border border-slate-200 w-fit">
        <button onClick={() => setTab("lista")} data-testid="vtab-lista" className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${tab === "lista" ? "bg-[#C1401E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}><ListChecks className="w-4 h-4" /> Visitas</button>
        <button onClick={() => setTab("mapa")} data-testid="vtab-mapa" className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${tab === "mapa" ? "bg-[#C1401E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}><MapIcon className="w-4 h-4" /> Mapa</button>
      </div>

      {tab === "lista" ? (
        <div className="card-soft overflow-x-auto">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <Select value={fEstado} onValueChange={(v) => setFEstado(v === "all" ? "" : v)}>
              <SelectTrigger className="w-44 h-9" data-testid="filtro-estado-visita"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.keys(ESTADOS).map((k) => <SelectItem key={k} value={k}>{ESTADOS_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fTipo} onValueChange={(v) => setFTipo(v === "all" ? "" : v)}>
              <SelectTrigger className="w-40 h-9" data-testid="filtro-tipo-visita"><SelectValue placeholder="Tipo de visita" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {Object.entries(TIPOS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="p-3">Estado</th><th className="p-3">Fecha</th><th className="p-3">Cliente</th><th className="p-3">Tipo</th><th className="p-3">Vendedor</th><th className="p-3">Comentarios</th><th className="p-3 text-right"></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
              {!loading && visits.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-slate-400">Sin visitas registradas.</td></tr>}
              {!loading && visits.map((v) => (
                <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`visita-${v.id}`}>
                  <td className="p-3"><Badge className={ESTADOS[v.estado]?.[0]}>{ESTADOS_LABEL[v.estado] || v.estado}</Badge></td>
                  <td className="p-3 text-slate-500">{v.fecha_programada?.slice(0, 10)} {v.hora && <span className="text-slate-400">{v.hora}</span>}</td>
                  <td className="p-3 font-medium">{v.cliente_nombre}</td>
                  <td className="p-3"><Badge variant="outline">{TIPOS_LABEL[v.tipo_visita] || v.tipo_visita}</Badge></td>
                  <td className="p-3 text-slate-500">{v.vendedor_nombre}</td>
                  <td className="p-3 text-slate-500 max-w-[200px] truncate" title={v.comentarios || ""}>{v.comentarios || "—"}</td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(v)} disabled={!puedeEditar} title="Ver / editar" data-testid={`ver-visita-${v.id}`}><Eye className="w-4 h-4" /></Button>
                      {v.estado !== "realizada" && v.estado !== "cancelada" && (
                        <Button size="sm" variant="outline" onClick={async () => { try { await api.post(`/visits/${v.id}/checkin`, { comentarios: v.comentarios }); toast.success("Visita marcada como realizada"); loadVisits(); loadMap(); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } }} data-testid={`checkin-${v.id}`}><CheckCircle2 className="w-4 h-4 mr-1" /> Realizada</Button>
                      )}
                      {puedeEditar && v.estado === "programada" && (
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={async () => { try { await api.put(`/visits/${v.id}`, { estado: "cancelada" }); loadVisits(); loadMap(); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } }} data-testid={`cancelar-visita-${v.id}`}><XCircle className="w-4 h-4" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-soft p-4" data-testid="visitas-mapa">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><MapPinned className="w-4 h-4" /> Mapa {isSup ? "de supervisión" : "de mis clientes"}</span>
            <div className="flex items-center gap-3">
              {mapLive && mapLast && <span className="text-[11px] text-slate-400">Actualizado hace {Math.max(0, Math.round((Date.now() - mapLast) / 1000))}s</span>}
              <Button size="sm" variant={mapLive ? "default" : "outline"} onClick={() => setMapLive((v) => !v)} className={mapLive ? "bg-[#C1401E] hover:bg-[#A03316]" : ""} data-testid="v-mapa-live">
                {mapLive ? <><MapPinned className="w-4 h-4 mr-1 animate-pulse" /> En vivo ON</> : <><MapPinned className="w-4 h-4 mr-1" /> Activar en vivo</>}
              </Button>
            </div>
          </div>
          {mapLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div>
          ) : !mapData ? (
            <div className="py-16 text-center text-slate-400">Sin mapa disponible para tu rol.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#C1401E]" />{" "}Cliente</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500" />{" "}En ruta</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500" />{" "}Activo</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-slate-400" />{" "}Sin actividad</span>
              </div>
              <div className="h-[480px] rounded-lg overflow-hidden border border-slate-200">
                <MapContainer center={center} zoom={13} bounds={bounds} boundsOptions={{ padding: [40, 40] }} style={{ height: "100%", width: "100%" }}>
                  <TileLayer url={MAP_THEME} attribution="&copy; OpenStreetMap" />
                  {clientesMap.map((c) => (
                    <Marker key={c.id} position={[Number(c.latitud), Number(c.longitud)]} icon={dotIcon("#C1401E")}>
                      <Popup>
                        <div className="text-xs"><b>{c.nombre}</b><br />{c.vencido > 0 ? <span className="text-red-600">Vencido: {money(c.vencido)}</span> : c.saldo > 0 ? `Saldo: ${money(c.saldo)}` : "Sin saldo"}<br />{c.ultima_visita ? `Última visita: ${c.ultima_visita.slice(0, 10)}` : "Sin visitas"}</div>
                      </Popup>
                    </Marker>
                  ))}
                  {sellers.map((s) => {
                    if (!s.ultima_ubicacion) return null;
                    const bg = s.estado === "en_ruta" ? "green" : s.estado === "activo" ? "blue" : "silver";
                    const color = { green: "#22c55e", blue: "#3b82f6", silver: "#94a3b8" }[bg];
                    return (
                      <Marker key={s.id} position={[Number(s.ultima_ubicacion.latitud), Number(s.ultima_ubicacion.longitud)]} icon={dotIcon(color)}>
                        <Popup>
                          <div className="text-xs"><b>{s.name}</b> · {s.estado}<br />Ventas hoy: {money(s.ventas_hoy?.monto)} · Cobros: {money(s.cobros_hoy)}<br />Últ. ubicación: {(s.ultima_ubicacion.fecha || "").slice(0, 16).replace("T", " ")}</div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
              </div>
            </>
          )}
        </div>
      )}

      {/* Crear / editar visita */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg" data-testid="visita-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing ? `Visita ${editing.cliente_nombre || ""}` : "Nueva visita"}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            <div className="relative">
              <Label className="text-xs text-slate-500">Cliente</Label>
              <Input
                value={clienteQuery} onChange={(e) => { setClienteQuery(e.target.value); setClienteOpen(true); }}
                onFocus={() => setClienteOpen(true)}
                onBlur={() => setTimeout(() => setClienteOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (filteredClientes[0]) reselectCliente(filteredClientes[0]); } }}
                placeholder="Buscar cliente por nombre, código o RFC…" className="mt-1" data-testid="visita-cliente" />
              {clienteOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                  {filteredClientes.map((c) => (
                    <button key={c.id} type="button" onMouseDown={() => reselectCliente(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2">
                      <span><span className="font-medium">{c.codigo}</span> · {c.nombre}</span>
                      <Store className="w-3.5 h-3.5 text-slate-300" />
                    </button>
                  ))}
                  {filteredClientes.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">Sin resultados</div>}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-slate-500">Fecha programada</Label><Input type="date" value={form.fecha_programada} onChange={(e) => setForm((s) => ({ ...s, fecha_programada: e.target.value }))} className="mt-1" data-testid="visita-fecha" /></div>
              <div><Label className="text-xs text-slate-500">Hora</Label><Input type="time" value={form.hora} onChange={(e) => setForm((s) => ({ ...s, hora: e.target.value }))} className="mt-1" data-testid="visita-hora" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-slate-500">Tipo</Label>
                <Select value={form.tipo_visita} onValueChange={(v) => setForm((s) => ({ ...s, tipo_visita: v }))}>
                  <SelectTrigger className="mt-1" data-testid="visita-tipo"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TIPOS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {!editing && (
                <div><Label className="text-xs text-slate-500">Estado</Label>
                  <Select value={form.estado} onValueChange={(v) => setForm((s) => ({ ...s, estado: v }))}>
                    <SelectTrigger className="mt-1" data-testid="visita-estado"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(ESTADOS).map((k) => <SelectItem key={k} value={k}>{ESTADOS_LABEL[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {isSup && vendedores.length > 0 && (
              <div><Label className="text-xs text-slate-500">Vendedor asignado</Label>
                <Select value={form.vendedor_id} onValueChange={(v) => setForm((s) => ({ ...s, vendedor_id: v }))}>
                  <SelectTrigger className="mt-1" data-testid="visita-vendedor"><SelectValue placeholder="Yo (autenticado)" /></SelectTrigger>
                  <SelectContent><SelectItem value="">Yo (autenticado)</SelectItem>{vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label className="text-xs text-slate-500">Comentarios</Label><Input value={form.comentarios} onChange={(e) => setForm((s) => ({ ...s, comentarios: e.target.value }))} className="mt-1" data-testid="visita-comentario" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="visita-guardar">{saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}