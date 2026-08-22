import { useEffect, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, UserCog, RefreshCw, MapPinned, TrendingUp, Wallet, ReceiptText } from "lucide-react";

const Card = ({ label, value, icon: Ic, valueCls = "text-slate-700" }) => (
  <div className="card-soft p-4">
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <Ic className="w-4 h-4 text-slate-400" />
    </div>
    <div className={`font-display font-black text-2xl mt-1 ${valueCls}`}>{value}</div>
  </div>
);

export default function Vendedores() {
  const { can } = useAuth();
  const esSup = can("supervision.cartera");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [orderBy, setOrderBy] = useState("ventas");

  const load = async () => {
    setLoading(true); setErr("");
    try {
      if (esSup) {
        const { data } = await api.get("/supervision/sellers", { params: { order_by: orderBy } });
        setRows(data?.vendedores || []);
      } else {
        const { data } = await api.get("/vendedores");
        setRows((data || []).map((x) => ({ id: x.id, name: x.name, role: x.role, estado: "activo" })));
      }
    } catch (e) {
      setErr(formatApiError(e.response?.data?.detail) || "No se pudieron cargar los vendedores.");
      setRows([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [esSup, orderBy]);

  const filtrados = rows.filter((v) => !q || `${v.name || ""} ${v.role || ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5" data-testid="vendedores-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Vendedores</h1>
          <p className="text-slate-500 text-sm">Fuerza de ventas · cartera asignada, ventas y cobranza</p>
        </div>
        <div className="flex gap-2">
          {esSup && (
            <Select value={orderBy} onValueChange={setOrderBy}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ventas">Mayores ventas</SelectItem>
                <SelectItem value="ventas_hoy">Ventas hoy</SelectItem>
                <SelectItem value="cartera">Mayor cartera</SelectItem>
                <SelectItem value="vencido">Mayor vencido</SelectItem>
                <SelectItem value="cobranza">Mayor cobranza</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" className="h-9" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <Card k="Total vendedores" value={rows.length} icon={UserCog} />
        <Card k="Clientes en cartera" value={rows.reduce((a, v) => a + Number(v.clientes_asignados || 0), 0)} icon={ReceiptText} />
        <Card k="Cartera total" value={money(rows.reduce((a, v) => a + Number(v.cartera_total || 0), 0))} icon={Wallet} valueCls="text-red-600" />
        <Card k="Ventas del mes" value={money(rows.reduce((a, v) => a + Number(v.ventas_mes || 0), 0))} icon={TrendingUp} valueCls="text-green-600" />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-md">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar vendedor por nombre o rol..." className="h-10" data-testid="vendedores-q" />
        </div>
      </div>

      {err && (
        <div className="card-soft p-6 text-center text-red-600">
          <p className="mb-3">{err}</p>
          <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" /> Reintentar</Button>
        </div>
      )}
      {!err && loading && <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>}

      {!err && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtrados.length === 0 && <div className="col-span-full card-soft p-12 text-center text-slate-400">Sin vendedores registrados.</div>}
          {filtrados.map((v) => (
            <div key={v.id} className="card-soft p-5 space-y-3" data-testid={`vendedor-${v.id}`}>
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
                <Badge className={v.estado === "en_ruta" ? "bg-green-100 text-green-700" : v.estado === "activo" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}>
                  {v.estado || "sin_datos"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] uppercase text-slate-400">Clientes</div>
                  <div className="font-semibold">{v.clientes_asignados || 0}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] uppercase text-slate-400">Con adeudo</div>
                  <div className="font-semibold">{v.clientes_con_adeudo || 0}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] uppercase text-slate-400">Cartera</div>
                  <div className="font-semibold text-red-600">{money(v.cartera_total)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] uppercase text-slate-400">Vto. vencido</div>
                  <div className="font-semibold text-red-600">{money(v.cxc_vencida)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] uppercase text-slate-400">Ventas mes</div>
                  <div className="font-semibold text-green-700">{money(v.ventas_mes)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] uppercase text-slate-400">Ventas hoy</div>
                  <div className="font-semibold">{money(v.ventas_hoy)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] uppercase text-slate-400">Cobros hoy</div>
                  <div className="font-semibold text-green-600">{money(v.cobros_hoy)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] uppercase text-slate-400">Visitas</div>
                  <div className="font-semibold">{v.visitas_realizadas || 0}</div>
                </div>
              </div>
              {v.ultima_actividad && (
                <div className="text-[11px] text-slate-400 flex items-center gap-1"><MapPinned className="w-3 h-3" /> Última actividad: {(v.ultima_actividad || "").slice(0, 16).replace("T", " ")}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}