import { useEffect, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, TrendingUp, Wallet, Receipt, HandCoins, RefreshCw, ArrowUpCircle, ArrowDownCircle, FileDown, FileSpreadsheet } from "lucide-react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, Legend } from "recharts";

const Card = ({ label, value, icon: Ic, valueCls = "text-slate-800", sub = "" }) => (
  <div className="card-soft p-4">
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <Ic className="w-4 h-4 text-slate-400" />
    </div>
    <div className={`font-display font-black text-2xl mt-1 ${valueCls}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
  </div>
);

export default function Finanzas() {
  const [r, setR] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [desde, setDesde] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState("");

  const load = async () => {
    setLoading(true); setErr("");
    const params = {};
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    try {
      const { data } = await api.get("/finanzas", { params });
      setR(data);
    } catch (e) {
      setErr(formatApiError(e.response?.data?.detail) || "No se pudieron cargar las finanzas.");
      setR(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const exportar = async (fmt) => {
    setExporting(fmt);
    try {
      const params = {};
      if (desde) params.desde = desde;
      if (hasta) params.hasta = hasta;
      const { data } = await api.get("/finanzas/export", { params: { fmt, ...params }, responseType: "blob" });
      const url = window.URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url; a.download = fmt === "pdf" ? "finanzas.pdf" : "finanzas.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Error al exportar"); }
    finally { setExporting(""); }
  };

  const muestra = [
    ["Ingresos (ventas)", money(r?.ventas_total), TrendingUp, "text-green-700"],
    ["Resultado neto", money(r?.resultado_neto), ArrowUpCircle, r?.resultado_neto < 0 ? "text-red-600" : "text-green-700"],
    ["Utilidad bruta", money(r?.utilidad_bruta), ArrowUpCircle, "text-green-700"],
    ["Efectivo recibido", money(r?.efectivo), Wallet, "text-[#C1401E]"],
    ["Compras de mercancía", money(r?.compras_total), ArrowDownCircle, "text-blue-700"],
    ["Gastos operativos", money(r?.gastos_total), ArrowDownCircle, "text-amber-700"],
    ["Cuentas por cobrar", money(r?.cartera_cxc), HandCoins, "text-purple-700"],
    ["Vencido CxC", money(r?.vencido_cxc), HandCoins, "text-red-600"],
    ["Cuentas por pagar", money(r?.cuentas_por_pagar), Receipt, "text-red-600"],
  ];

  return (
    <div className="space-y-5" data-testid="finanzas-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Finanzas</h1>
          <p className="text-slate-500 text-sm">Resumen financiero · ingresos, gastos, cartera y abastecimiento</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-9" onClick={() => exportar("xlsx")} disabled={!!exporting} data-testid="finanzas-excel">
            {exporting === "xlsx" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <><FileSpreadsheet className="w-4 h-4 mr-1" /> Exportar Excel</>}
          </Button>
          <Button variant="outline" className="h-9" onClick={() => exportar("pdf")} disabled={!!exporting} data-testid="finanzas-pdf">
            {exporting === "pdf" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <><FileDown className="w-4 h-4 mr-1" /> Exportar PDF</>}
          </Button>
          <Button variant="outline" className="h-9" onClick={load}><RefreshCw className="w-4 h-4 mr-1" /> Actualizar</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 card-soft p-3">
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Desde</Label>
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 h-9 w-40" data-testid="finanzas-desde" />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Hasta</Label>
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 h-9 w-40" data-testid="finanzas-hasta" />
        </div>
        <Button className="h-9 bg-[#C1401E] hover:bg-[#A03316]" onClick={load} data-testid="finanzas-aplicar">Aplicar filtro</Button>
      </div>

      {err && <div className="card-soft p-6 text-center text-red-600"><p className="mb-3">{err}</p><Button variant="outline" onClick={load}>Reintentar</Button></div>}
      {!err && loading && <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>}

      {!err && !loading && r && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {muestra.map(([l, v, Ic, cls]) => (
              <Card key={l} label={l} value={v} icon={Ic} valueCls={cls} />
            ))}
          </div>

          <div className="card-soft p-4">
            <h3 className="font-display text-sm font-bold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#C1401E]" /> Ingresos vs Egresos por mes</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={r.serie || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="mes" />
                <YAxis />
                <Tooltip formatter={(v) => money(v)} />
                <Legend />
                <Bar dataKey="ingresos" name="Ingresos" fill="#16A34A" radius={[4, 4, 0, 0]} />
                <Bar dataKey="egresos" name="Egresos" fill="#D97706" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}