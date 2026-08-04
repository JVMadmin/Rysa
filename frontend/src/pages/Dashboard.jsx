import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  TrendingUp, ShoppingCart, Wallet, Users, AlertTriangle, PackageX, Package, Loader2,
  Receipt, Settings, ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const Kpi = ({ icon: Icon, label, value, color, testid }) => (
  <div className="bg-white border border-slate-200 rounded-md p-5" data-testid={testid}>
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-slate-500 font-medium">{label}</span>
      <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: color + "1a" }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
    </div>
    <div className="font-display text-2xl font-black text-slate-900 mt-3">{value}</div>
  </div>
);

export default function Dashboard() {
  const [d, setD] = useState(null);
  const { can } = useAuth();

  useEffect(() => { api.get("/dashboard").then((r) => setD(r.data)); }, []);

  if (!d) return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#0055A4]" /></div>;

  const MODULES = [
    { to: "/app/pos", label: "Punto de Venta", desc: "Cobrar rápido", icon: ShoppingCart, color: "#FF5A00", perm: "venta.crear" },
    { to: "/app/productos", label: "Productos", desc: "Inventario", icon: Package, color: "#0055A4" },
    { to: "/app/clientes", label: "Clientes", desc: "Directorio", icon: Users, color: "#22C55E" },
    { to: "/app/caja", label: "Caja", desc: "Cortes y movimientos", icon: Wallet, color: "#0F172A", perm: "caja.abrir" },
    { to: "/app/ventas", label: "Ventas", desc: "Historial", icon: Receipt, color: "#8B5CF6" },
    { to: "/app/configuracion", label: "Configuración", desc: "Empresa y precios", icon: Settings, color: "#64748B", perm: "config" },
  ].filter((m) => !m.perm || can(m.perm));

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm">Resumen general de la operación.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {MODULES.map((m) => (
          <Link key={m.to} to={m.to} data-testid={`quick-${m.to.split("/").pop()}`}
            className="group bg-white border border-slate-200 rounded-md p-4 hover:border-[#0055A4] hover:shadow-sm transition-all">
            <div className="w-10 h-10 rounded-md flex items-center justify-center mb-3" style={{ background: m.color + "1a" }}>
              <m.icon className="w-5 h-5" style={{ color: m.color }} strokeWidth={2} />
            </div>
            <div className="font-display font-bold text-sm text-slate-800 flex items-center gap-1">{m.label}<ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
            <div className="text-xs text-slate-400">{m.desc}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={TrendingUp} label="Ventas del día" value={money(d.ventas_hoy)} color="#0055A4" testid="kpi-ventas-hoy" />
        <Kpi icon={TrendingUp} label="Ventas del mes" value={money(d.ventas_mes)} color="#22C55E" testid="kpi-ventas-mes" />
        <Kpi icon={ShoppingCart} label="N° ventas hoy" value={d.num_ventas_hoy} color="#FF5A00" testid="kpi-num-ventas" />
        <Kpi icon={Wallet} label="Total en caja" value={money(d.total_caja)} color="#0F172A" testid="kpi-caja" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Package} label="Productos activos" value={d.productos} color="#0055A4" testid="kpi-productos" />
        <Kpi icon={AlertTriangle} label="Stock bajo" value={d.bajo_stock} color="#F59E0B" testid="kpi-stock-bajo" />
        <Kpi icon={PackageX} label="Sin existencia" value={d.sin_existencia} color="#EF4444" testid="kpi-sin-existencia" />
        <Kpi icon={Users} label="Clientes" value={d.clientes} color="#22C55E" testid="kpi-clientes" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-md p-5">
          <h3 className="font-display font-bold text-slate-800 mb-4">Ventas últimos 7 días</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={d.serie_ventas}>
              <defs>
                <linearGradient id="c" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0055A4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0055A4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 12, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
              <Tooltip formatter={(v) => money(v)} />
              <Area type="monotone" dataKey="total" stroke="#0055A4" strokeWidth={2} fill="url(#c)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border border-slate-200 rounded-md p-5">
          <h3 className="font-display font-bold text-slate-800 mb-4">Alertas de inventario</h3>
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {d.alertas_stock.length === 0 && <p className="text-sm text-slate-400">Sin alertas.</p>}
            {d.alertas_stock.map((a) => (
              <div key={a.codigo} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-700 truncate">{a.descripcion}</div>
                  <div className="text-xs text-slate-400">{a.codigo}</div>
                </div>
                <Badge className={a.existencia <= 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}>
                  {a.existencia} / min {a.stock_minimo}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-md p-5">
        <h3 className="font-display font-bold text-slate-800 mb-4">Ventas recientes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4">Folio</th><th className="py-2 pr-4">Cliente</th>
                <th className="py-2 pr-4">Fecha</th><th className="py-2 pr-4">Estado</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.ventas_recientes.map((v) => (
                <tr key={v.folio} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 pr-4 font-medium text-[#0055A4]">{v.folio}</td>
                  <td className="py-2 pr-4">{v.cliente}</td>
                  <td className="py-2 pr-4 text-slate-500">{v.fecha?.slice(0, 10)}</td>
                  <td className="py-2 pr-4">
                    <Badge className={v.estado === "cancelada" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>{v.estado}</Badge>
                  </td>
                  <td className="py-2 text-right font-semibold">{money(v.total)}</td>
                </tr>
              ))}
              {d.ventas_recientes.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Aún no hay ventas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
