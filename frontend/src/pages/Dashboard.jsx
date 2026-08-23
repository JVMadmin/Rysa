import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from "recharts";
import {
  TrendingUp, ShoppingCart, Wallet, Users, AlertTriangle, PackageX, Package, Loader2,
  Receipt, Settings, ArrowRight, ArrowUpRight, Boxes,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const Kpi = ({ icon: Icon, label, value, color, testid, featured = false }) => (
  <div
    data-testid={testid}
    className={featured
      ? "rounded-[1.25rem] bg-terracota p-6 text-white shadow-card-lg"
      : "card-soft p-6 text-slate-900"}
  >
    <div className="flex items-center justify-between">
      <span className={`text-xs uppercase tracking-wider font-medium ${featured ? "text-white/80" : "text-slate-400"}`}>{label}</span>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${featured ? "bg-white/20" : ""}`} style={!featured ? { background: color + "1a" } : undefined}>
        <Icon className="w-5 h-5" style={featured ? { color: "#fff" } : { color }} />
      </div>
    </div>
    <div className={`font-display font-black mt-3 ${featured ? "text-4xl" : "text-3xl"} tracking-tight`}>{value}</div>
    {featured && (
      <div className="flex items-center gap-1.5 mt-2 text-white/85 text-xs font-semibold">
        <ArrowUpRight className="w-4 h-4" /> Principal indicador del día
      </div>
    )}
  </div>
);

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const { can, isAdminOrOwner } = useAuth();

  const load = () => {
    setErr("");
    api.get("/dashboard")
      .then((r) => setD(r.data))
      .catch((e) => setErr(e?.response?.data?.detail || "No se pudo cargar el dashboard."));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (err) {
    return (
      <div className="card-soft p-8 text-center" data-testid="dashboard-error">
        <p className="text-red-600 mb-4">{err}</p>
        <button className="px-4 py-2 rounded-xl bg-terracota text-white font-semibold" onClick={load}>Reintentar</button>
      </div>
    );
  }

  if (!d) return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-terracota" /></div>;

  const global = d.mode === "global" || isAdminOrOwner;

  const MODULES = [
    { to: "/app/pos", label: "Punto de Venta", desc: "Cobrar rápido", icon: ShoppingCart, color: "#C1401E", perm: "venta.crear" },
    { to: "/app/productos", label: "Productos", desc: "Inventario", icon: Package, color: "#C1401E" },
    { to: "/app/clientes", label: "Clientes", desc: "Directorio", icon: Users, color: "#16A34A" },
    { to: "/app/caja", label: "Caja", desc: "Cortes y movimientos", icon: Wallet, color: "#FF5A00", perm: "caja.ver" },
    { to: "/app/cxc", label: "Cuentas por Cobrar", desc: "Cartera", icon: Receipt, color: "#8B5CF6", perm: "cxc.ver" },
    { to: "/app/ventas", label: "Ventas", desc: "Historial", icon: Receipt, color: "#8B5CF6" },
    { to: "/app/configuracion", label: "Configuración", desc: "Empresa y precios", icon: Settings, color: "#6B7280", perm: "config" },
  ].filter((m) => !m.perm || can(m.perm));

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm">{global ? "Resumen general de la operación." : "Resumen de tu caja y ventas."}</p>
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
        {MODULES.map((m) => (
          <Link key={m.to} to={m.to} data-testid={`quick-${m.to.split("/").pop()}`}
            className="group card-soft p-4 hover:shadow-card-lg hover:-translate-y-px transition-all">
            <div className="w-11 h-11 rounded-full flex items-center justify-center mb-3" style={{ background: m.color + "1a" }}>
              <m.icon className="w-5 h-5" style={{ color: m.color }} strokeWidth={2} />
            </div>
            <div className="font-display font-semibold text-sm text-slate-800 flex items-center gap-1">
              {m.label}
              <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="text-xs text-slate-400">{m.desc}</div>
          </Link>
        ))}
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={TrendingUp} label={global ? "Ventas del día" : "Mis ventas del día"} value={money(d.ventas_hoy)} color="#C1401E" testid="kpi-ventas-hoy" featured />
        <Kpi icon={TrendingUp} label={global ? "Ventas del mes" : "Mis ventas del mes"} value={money(d.ventas_mes)} color="#16A34A" testid="kpi-ventas-mes" />
        <Kpi icon={ShoppingCart} label={global ? "N° ventas hoy" : "Mis N° ventas hoy"} value={d.num_ventas_hoy} color="#C1401E" testid="kpi-num-ventas" />
        <Kpi icon={Wallet} label={global ? "Total en cajas abiertas" : "Total en mi caja"} value={money(d.total_caja)} color="#FF5A00" testid="kpi-caja" />
      </div>

      {/* Vista global: cajas y ventas por usuario */}
      {global && d.por_caja && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card-soft p-6">
            <h3 className="font-display font-semibold text-lg text-slate-900 mb-4 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-terracota" /> Cajas y sus ventas
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-4 font-semibold">Caja</th><th className="py-2 pr-4 font-semibold">Responsable</th>
                    <th className="py-2 pr-4 font-semibold">Estado</th><th className="py-2 pr-4 text-right font-semibold">En caja</th>
                    <th className="py-2 text-right font-semibold">Ventas</th>
                  </tr>
                </thead>
                <tbody>
                  {d.por_caja.map((c) => (
                    <tr key={c.caja_id || "sin"} className="border-b border-slate-100 hover:bg-slate-50/70">
                      <td className="py-3 pr-4 font-semibold text-slate-800">{c.caja_nombre}</td>
                      <td className="py-3 pr-4 text-slate-500">{c.usuario_nombre}</td>
                      <td className="py-3 pr-4">{c.estado === "abierta" ? <span className="status-pill"><span className="dot dot-success" />Abierta</span> : <span className="status-pill"><span className="dot dot-muted" />Cerrada</span>}</td>
                      <td className="py-3 pr-4 text-right text-slate-700">{money(c.efectivo_esperado)}</td>
                      <td className="py-3 text-right font-semibold text-slate-900">{money(c.ventas_total)} <span className="text-xs font-normal text-slate-400">({c.num_ventas})</span></td>
                    </tr>
                  ))}
                  {d.por_caja.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Sin cajas registradas.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card-soft p-6">
            <h3 className="font-display font-semibold text-lg text-slate-900 mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-terracota" /> Ventas por usuario
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-4 font-semibold">Usuario</th><th className="py-2 text-right font-semibold">Ventas</th><th className="py-2 text-right font-semibold">N°</th>
                  </tr>
                </thead>
                <tbody>
                  {d.por_usuario.map((u) => (
                    <tr key={u.usuario_id} className="border-b border-slate-100 hover:bg-slate-50/70">
                      <td className="py-3 pr-4 font-medium text-slate-800">{u.usuario_nombre}</td>
                      <td className="py-3 pr-4 text-right text-slate-700">{money(u.total)}</td>
                      <td className="py-3 text-right text-slate-500">{u.num_ventas}</td>
                    </tr>
                  ))}
                  {d.por_usuario.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate-400">Sin ventas.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-3 text-sm">
              <Badge className="bg-terracota/10 text-terracota hover:bg-terracota/10"><Boxes className="w-3.5 h-3.5 mr-1" /> Global</Badge>
              <span className="text-slate-500">Ventas totales: <b className="text-slate-900">{money(d.totales_globales?.ventas)}</b> · {d.totales_globales?.num_ventas} ventas · {d.totales_globales?.cajas_abiertas} cajas abiertas</span>
            </div>
          </div>
        </div>
      )}

      {/* KPIs inventario */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Package} label="Productos activos" value={d.productos} color="#C1401E" testid="kpi-productos" />
        <Kpi icon={AlertTriangle} label="Stock bajo" value={d.bajo_stock} color="#D97706" testid="kpi-stock-bajo" />
        <Kpi icon={PackageX} label="Sin existencia" value={d.sin_existencia} color="#DC2626" testid="kpi-sin-existencia" />
        <Kpi icon={Users} label="Clientes" value={d.clientes} color="#16A34A" testid="kpi-clientes" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-soft p-6">
          <h3 className="font-display font-semibold text-lg text-slate-900 mb-4">Ventas últimos 7 días{global ? "" : " (tuyas)"}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.serie_ventas}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1eee9" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={(v) => money(v)} cursor={{ fill: "rgba(193,64,30,0.06)" }} />
              <Bar dataKey="total" fill="#C1401E" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card-soft p-6">
          <h3 className="font-display font-semibold text-lg text-slate-900 mb-4">Alertas de inventario</h3>
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {d.alertas_stock.length === 0 && <p className="text-sm text-slate-400">Sin alertas.</p>}
            {d.alertas_stock.map((a) => (
              <div key={a.codigo} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-700 truncate flex items-center gap-2">
                    <span className={`dot ${a.existencia <= 0 ? "dot-danger" : "dot-warning"}`} />
                    {a.descripcion}
                  </div>
                  <div className="text-xs text-slate-400 pl-4">{a.codigo}</div>
                </div>
                <Badge variant={a.existencia <= 0 ? "destructive" : "warning"}>
                  {a.existencia} / min {a.stock_minimo}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ventas recientes */}
      <div className="card-soft p-6">
        <h3 className="font-display font-semibold text-lg text-slate-900 mb-4">Ventas recientes{global ? "" : " (tuyas)"}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="py-2.5 pr-4 font-semibold">Folio</th><th className="py-2.5 pr-4 font-semibold">Cliente</th>
                <th className="py-2.5 pr-4 font-semibold">Fecha</th><th className="py-2.5 pr-4 font-semibold">Estado</th>
                <th className="py-2.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.ventas_recientes.map((v) => (
                <tr key={v.folio} className="border-b border-slate-100 hover:bg-slate-50/70">
                  <td className="py-3 pr-4 font-semibold text-terracota">{v.folio}</td>
                  <td className="py-3 pr-4 text-slate-700">{v.cliente}</td>
                  <td className="py-3 pr-4 text-slate-500">{v.fecha?.slice(0, 10)}</td>
                  <td className="py-3 pr-4">
                    {v.estado === "cancelada" ? (
                      <span className="status-pill"><span className="dot dot-danger" />Cancelada</span>
                    ) : (
                      <span className="status-pill"><span className="dot dot-success" />Completada</span>
                    )}
                  </td>
                  <td className="py-3 text-right font-semibold text-slate-900">{money(v.total)}</td>
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