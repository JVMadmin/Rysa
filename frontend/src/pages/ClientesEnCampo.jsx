import { useEffect, useMemo, useState } from "react";
import { api, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, Store, RefreshCw, LocateFixed } from "lucide-react";

const dotIcon = (bg) =>
  L.divIcon({
    className: "rysa-map-dot",
    html: `<div style="width:13px;height:13px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
    iconSize: [15, 15],
    iconAnchor: [7, 7],
    popupAnchor: [0, -9],
  });

const MAP_THEME = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
// Centro por defecto: Palenque, Chiapas.
const PALENQUE = [17.5095, -91.9827];

export default function ClientesEnCampo() {
  const { can } = useAuth();
  const isSup = can("supervision.mapa") || can("supervision.ver");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [fVend, setFVend] = useState("all");
  const [fAdeudo, setFAdeudo] = useState("todos");
  const [vendedores, setVendedores] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      if (isSup) {
        const { data } = await api.get("/supervision/map");
        setRows(data?.clientes || []);
        setVendedores(data?.vendedores || []);
      } else {
        const { data } = await api.get("/seller/clients");
        setRows(data || []);
      }
      setLastUpdate(new Date());
    } catch (e) {
      setErr("No se pudieron cargar los clientes en campo.");
      setRows([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [isSup]);
  // Auto-refresco cada 60 s para mantener saldos/GPS frescos sin tocar nada.
  useEffect(() => {
    const iv = setInterval(() => { load(); }, 60000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtrados = useMemo(() => rows.filter((c) => {
    if (q && !`${c.nombre} ${c.codigo} ${c.telefono || ""} ${c.ciudad || ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fVend !== "all" && c.vendedor_id !== fVend) return false;
    if (fAdeudo === "vencido" && !(Number(c.vencido || 0) > 0)) return false;
    if (fAdeudo === "saldo" && !(Number(c.saldo || 0) > 0)) return false;
    if (fAdeudo === "limpio" && (Number(c.saldo || 0) > 0)) return false;
    return true;
  }), [rows, q, fVend, fAdeudo]);

  const geoloc = useMemo(() => filtrados.filter((c) => c.latitud && c.longitud), [filtrados]);

  return (
    <div className="space-y-4" data-testid="clientes-campo-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><Store className="w-6 h-6 text-[#C1401E]" /> Clientes en campo</h1>
          <p className="text-slate-500 text-sm">Directorio con ubicación GPS · {filtrados.length} clientes</p>
        </div>
        <Button variant="outline" className="h-9" onClick={load}><RefreshCw className="w-4 h-4 mr-1" /> Actualizar</Button>
      </div>
      <p className="text-[11px] text-slate-400 -mt-3">
        {lastUpdate ? `Actualizado ${lastUpdate.toLocaleTimeString("es-MX")} · se refresca solo cada minuto` : "Cargando…"}
      </p>

      <div className="flex flex-wrap items-end gap-3 card-soft p-3">
        <div className="flex-1 min-w-[200px]">
          <span className="text-[10px] uppercase text-slate-400">Buscar</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código, teléfono, ciudad..." className="mt-1 h-9" data-testid="campo-q" />
        </div>
        {isSup && (
          <div>
            <span className="text-[10px] uppercase text-slate-400">Vendedor</span>
            <Select value={fVend} onValueChange={setFVend}>
              <SelectTrigger className="w-44 mt-1 h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <span className="text-[10px] uppercase text-slate-400">Estado</span>
          <Select value={fAdeudo} onValueChange={setFAdeudo}>
            <SelectTrigger className="w-40 mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="vencido">Con saldo vencido</SelectItem>
              <SelectItem value="saldo">Con saldo</SelectItem>
              <SelectItem value="limpio">Sin saldo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {err && <div className="card-soft p-6 text-center text-red-600">{err}</div>}
      {!err && loading && <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>}

      {!err && !loading && (
        <>
          {geoloc.length > 0 && (
            <div className="card-soft p-2">
              <div className="h-[300px] rounded-lg overflow-hidden border border-slate-200">
                <MapContainer center={geoloc[0] && [Number(geoloc[0].latitud), Number(geoloc[0].longitud)] || PALENQUE} zoom={13} style={{ height: "100%", width: "100%" }}>
                  <TileLayer url={MAP_THEME} attribution="&copy; OpenStreetMap" />
                  {geoloc.map((c) => (
                    <Marker key={c.id} position={[Number(c.latitud), Number(c.longitud)]} icon={dotIcon(Number(c.vencido || 0) > 0 ? "#DC2626" : Number(c.saldo || 0) > 0 ? "#D97706" : "#C1401E")}>
                      <Popup><div className="text-xs"><b>{c.nombre}</b><br />{c.direccion || ""}<br />{Number(c.vencido || 0) > 0 ? <span className="text-red-600">Vencido: {money(c.vencido)}</span> : Number(c.saldo || 0) > 0 ? `Saldo: ${money(c.saldo)}` : "Sin saldo"}</div></Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            </div>
          )}

          <div className="card-soft overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-2">Código</th><th className="p-2">Cliente</th><th className="p-2">Teléfono</th><th className="p-2">Ciudad</th>
                {isSup && <th className="p-2">Vendedor</th>}
                <th className="p-2">GPS</th><th className="p-2 text-right">Saldo</th><th className="p-2 text-right">Vencido</th><th className="p-2">Últ. visita</th>
              </tr></thead>
              <tbody>
                {filtrados.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-slate-400">Sin clientes con esos filtros.</td></tr>}
                {filtrados.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 font-mono text-[10px] text-[#C1401E]">{c.codigo}</td>
                    <td className="p-2 font-medium">{c.nombre}</td>
                    <td className="p-2 text-slate-500">{c.telefono || "—"}</td>
                    <td className="p-2 text-slate-500">{c.ciudad || "—"}</td>
                    {isSup && <td className="p-2 text-slate-500">{c.vendedor_nombre || "—"}</td>}
                    <td className="p-2">
                      {c.latitud && c.longitud ? <Badge className="bg-green-100 text-green-700"><LocateFixed className="w-3 h-3 mr-1" /> Sí</Badge> : <Badge variant="outline">No</Badge>}
                    </td>
                    <td className={`p-2 text-right font-semibold ${Number(c.saldo || 0) > 0 ? "text-amber-600" : "text-slate-300"}`}>{money(c.saldo)}</td>
                    <td className={`p-2 text-right font-semibold ${Number(c.vencido || 0) > 0 ? "text-red-600" : "text-slate-300"}`}>{money(c.vencido)}</td>
                    <td className="p-2 text-slate-500">{c.ultima_visita ? c.ultima_visita.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}