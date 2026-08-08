import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, DollarSign, Percent, Package, BarChart3 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";

const Card = ({ label, value, icon: Ic, cls, testid }) => (
  <div className="bg-white border border-slate-200 rounded-md p-4" data-testid={testid}>
    <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-slate-400">{label}</span><Ic className={`w-4 h-4 ${cls}`} /></div>
    <div className={`font-display font-black text-2xl mt-1 ${cls}`}>{value}</div>
  </div>
);

export default function Reportes() {
  const hoy = new Date().toISOString().slice(0, 10);
  const mes = hoy.slice(0, 8) + "01";
  const [desde, setDesde] = useState(mes);
  const [hasta, setHasta] = useState(hoy);
  const [group, setGroup] = useState("dia");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await api.get("/reports/ventas", { params: { desde, hasta, group } });
    setData(data); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [group]);

  const t = data?.totales || {};
  return (
    <div className="space-y-5" data-testid="reportes-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><BarChart3 className="w-6 h-6 text-[#B95A3A]" /> Reportes de Ventas y Utilidad</h1></div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" data-testid="rep-desde" />
          <span className="text-slate-400">a</span>
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" data-testid="rep-hasta" />
          <div className="flex rounded-md overflow-hidden border border-slate-200">
            <button onClick={() => setGroup("dia")} className={`px-3 py-2 text-sm ${group === "dia" ? "bg-[#B95A3A] text-white" : "bg-white"}`} data-testid="rep-group-dia">Por día</button>
            <button onClick={() => setGroup("mes")} className={`px-3 py-2 text-sm ${group === "mes" ? "bg-[#B95A3A] text-white" : "bg-white"}`} data-testid="rep-group-mes">Por mes</button>
          </div>
          <Button onClick={load} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="rep-aplicar">Aplicar</Button>
        </div>
      </div>

      {loading ? <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#B95A3A]" /></div> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Card label="Ventas" value={money(t.ventas || 0)} icon={DollarSign} cls="text-slate-800" testid="rep-ventas" />
            <Card label="Ingreso neto" value={money(t.ingreso_neto || 0)} icon={TrendingUp} cls="text-blue-700" testid="rep-ingreso" />
            <Card label="Costo" value={money(t.costo || 0)} icon={Package} cls="text-amber-700" testid="rep-costo" />
            <Card label="Utilidad" value={money(t.utilidad || 0)} icon={TrendingUp} cls="text-emerald-700" testid="rep-utilidad" />
            <Card label="Margen" value={`${t.margen || 0}%`} icon={Percent} cls="text-[#B95A3A]" testid="rep-margen" />
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Ventas por {group === "mes" ? "mes" : "día"} · {t.tickets || 0} tickets</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => money(v)} />
                <Line type="monotone" dataKey="total" stroke="#B95A3A" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-md p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Productos más vendidos</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.top_vendidos.slice(0, 8)} layout="vertical" margin={{ left: 10 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="codigo" width={70} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="cantidad" fill="#B95A3A" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white border border-slate-200 rounded-md p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Mayor utilidad</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.top_utilidad.slice(0, 8)} layout="vertical" margin={{ left: 10 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="codigo" width={70} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="utilidad" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
            <div className="text-xs uppercase tracking-wider text-slate-400 p-3">Utilidad por producto</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Código</th><th className="p-3">Producto</th><th className="p-3 text-right">Cant.</th>
                <th className="p-3 text-right">Ingreso</th><th className="p-3 text-right">Costo</th><th className="p-3 text-right">Utilidad</th><th className="p-3 text-center">Margen</th>
              </tr></thead>
              <tbody>
                {data.productos.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">Sin ventas en el rango.</td></tr>}
                {data.productos.slice(0, 200).map((p, i) => (
                  <tr key={i} className="border-t border-slate-100" data-testid={`rep-prod-${p.codigo}`}>
                    <td className="p-3 font-medium text-[#B95A3A]">{p.codigo}</td>
                    <td className="p-3 max-w-[280px] truncate">{p.descripcion}</td>
                    <td className="p-3 text-right">{p.cantidad}</td>
                    <td className="p-3 text-right">{money(p.ingreso)}</td>
                    <td className="p-3 text-right text-slate-500">{money(p.costo)}</td>
                    <td className="p-3 text-right font-semibold text-emerald-700">{money(p.utilidad)}</td>
                    <td className="p-3 text-center"><Badge className={p.margen >= 20 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{p.margen}%</Badge></td>
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
