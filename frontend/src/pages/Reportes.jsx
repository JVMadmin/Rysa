import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, DollarSign, Percent, Package, BarChart3, FileSpreadsheet, FileText, ArrowUpDown, SlidersHorizontal, Warehouse, Clock3, CalendarDays, Landmark } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";

const Card = ({ label, value, icon: Ic, cls, testid }) => (
  <div className="card-soft p-4" data-testid={testid}>
    <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-slate-400">{label}</span><Ic className={`w-4 h-4 ${cls}`} /></div>
    <div className={`font-display font-black text-2xl mt-1 ${cls}`}>{value}</div>
  </div>
);

// Secciones configurables del reporte (reporte "a tu gusto")
const SECCIONES = [
  ["totales", "Tarjetas de totales"],
  ["grafica", "Gráfica de ventas"],
  ["vendedores", "Desempeño por vendedor"],
  ["categorias", "Reporte por categoría"],
  ["top", "Top productos (gráficas)"],
  ["detalle", "Tabla por producto"],
];

const TABS = [
  ["ventas", "Ventas y Utilidad", BarChart3],
  ["inventario", "Inventario", Warehouse],
  ["centro", "Centro", Landmark],
];

const METODOS_NOMBRE = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", credito: "Crédito", otros: "Otros",
};

export default function Reportes() {
  const hoy = new Date().toISOString().slice(0, 10);
  const mes = hoy.slice(0, 8) + "01";
  const [tab, setTab] = useState("ventas");
  const [desde, setDesde] = useState(mes);
  const [hasta, setHasta] = useState(hoy);
  const [group, setGroup] = useState("dia");
  const [vendedor, setVendedor] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tipo, setTipo] = useState("");
  const [cliente, setCliente] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [condicion, setCondicion] = useState("");
  const [q, setQ] = useState("");
  const [orden, setOrden] = useState("utilidad");
  const [vendedores, setVendedores] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [secciones, setSecciones] = useState(new Set(SECCIONES.map(([k]) => k)));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Inventario
  const [invQ, setInvQ] = useState("");
  const [invEstado, setInvEstado] = useState("activo");
  const [inv, setInv] = useState(null);
  const [invLoading, setInvLoading] = useState(false);
  // Centro
  const [centro, setCentro] = useState(null);
  const [centroLoading, setCentroLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [v, c, cl, su] = await Promise.all([
          api.get("/vendedores").catch(() => ({ data: [] })),
          api.get("/categories").catch(() => ({ data: [] })),
          api.get("/clients", { params: { estado: "activo" } }).catch(() => ({ data: [] })),
          api.get("/sucursales").catch(() => ({ data: [] })),
        ]);
        setVendedores(v.data || []);
        setCategorias(c.data || []);
        setClientes(cl.data || []);
        setSucursales(su.data || []);
      } catch (_) {}
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await api.get("/reports/ventas", { params: {
      desde, hasta, group,
      vendedor_id: vendedor || undefined,
      categoria: categoria || undefined,
      tipo: tipo || undefined,
      q: q || undefined,
      cliente_id: cliente || undefined,
      sucursal_id: sucursal || undefined,
      condicion: condicion || undefined,
    } });
    setData(data); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [group]);

  useEffect(() => {
    if (data && data.productos) {
      const key = orden === "cantidad" ? "cantidad" : orden === "ingreso" ? "ingreso" : orden === "margen" ? "margen" : "utilidad";
      const newData = { ...data, productos: [...data.productos].sort((a, b) => b[key] - a[key]) };
      setData(newData);
    }
  }, [orden]);

  const exportar = (fmt) => {
    const params = new URLSearchParams({ desde, hasta, group, fmt });
    if (vendedor) params.append("vendedor_id", vendedor);
    if (categoria) params.append("categoria", categoria);
    if (tipo) params.append("tipo", tipo);
    if (q) params.append("q", q);
    if (cliente) params.append("cliente_id", cliente);
    if (sucursal) params.append("sucursal_id", sucursal);
    if (condicion) params.append("condicion", condicion);
    window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/ventas/export?${params.toString()}`, "_blank");
  };

  const toggleSeccion = (k) => setSecciones((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const t = data?.totales || {};
  const prods = data?.productos || [];

  // --- Inventario valorizado ---
  const loadInventario = async () => {
    setInvLoading(true);
    try {
      const { data } = await api.get("/reports/inventario", { params: { desde, hasta, q: invQ || undefined, estado: invEstado } });
      setInv(data);
    } finally { setInvLoading(false); }
  };

  const exportarInventario = () => {
    const params = new URLSearchParams({ desde, hasta, estado: invEstado, fmt: "excel" });
    if (invQ) params.append("q", invQ);
    window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/inventario/export?${params.toString()}`, "_blank");
  };

  // --- Centro de reportes ---
  const loadCentro = async () => {
    setCentroLoading(true);
    try {
      const { data } = await api.get("/reports/centro", { params: { desde, hasta } });
      setCentro(data);
    } finally { setCentroLoading(false); }
  };

  useEffect(() => {
    if (tab === "inventario" && !inv) loadInventario();
    if (tab === "centro" && !centro) loadCentro();
    /* eslint-disable-next-line */
  }, [tab]);

  const it = inv?.totales || {};
  const c = centro?.resumen || {};

  return (
    <div className="space-y-5" data-testid="reportes-page">
      {/* Pestañas del centro de reportes */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md overflow-hidden border border-slate-200">
          {TABS.map(([k, l, Ic]) => (
            <button key={k} onClick={() => setTab(k)} data-testid={`rep-tab-${k}`}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${tab === k ? "bg-[#C1401E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              <Ic className="w-4 h-4" /> {l}
            </button>
          ))}
        </div>
      </div>

      {tab === "ventas" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><BarChart3 className="w-6 h-6 text-[#C1401E]" /> Reportes de Ventas y Utilidad</h1></div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-36" data-testid="rep-desde" />
              <span className="text-slate-400">a</span>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-36" data-testid="rep-hasta" />
              <div className="flex rounded-md overflow-hidden border border-slate-200">
                <button onClick={() => setGroup("dia")} className={`px-3 py-2 text-sm ${group === "dia" ? "bg-[#C1401E] text-white" : "bg-white"}`} data-testid="rep-group-dia">Por día</button>
                <button onClick={() => setGroup("mes")} className={`px-3 py-2 text-sm ${group === "mes" ? "bg-[#C1401E] text-white" : "bg-white"}`} data-testid="rep-group-mes">Por mes</button>
              </div>
              <Button onClick={load} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="rep-aplicar">Aplicar</Button>
              <Button variant="outline" onClick={() => exportar("excel")} className="gap-1.5" data-testid="rep-export-excel"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel</Button>
              <Button variant="outline" onClick={() => exportar("pdf")} className="gap-1.5" data-testid="rep-export-pdf"><FileText className="w-4 h-4 text-red-600" /> PDF</Button>
            </div>
          </div>

          <div className="card-soft p-3 flex flex-wrap items-center gap-3">
            <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="rep-filtro-vendedor">
              <option value="">Todos los vendedores</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="rep-filtro-categoria">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
            </select>
            <select value={cliente} onChange={(e) => setCliente(e.target.value)} className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="rep-filtro-cliente">
              <option value="">Todos los clientes</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={condicion} onChange={(e) => setCondicion(e.target.value)} className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="rep-filtro-condicion">
              <option value="">Contado y crédito</option>
              <option value="contado">Solo contado</option>
              <option value="credito">Solo crédito</option>
            </select>
            <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="rep-filtro-sucursal">
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <Input placeholder="Buscar producto/código…" value={q} onChange={(e) => setQ(e.target.value)} className="w-52 h-9" data-testid="rep-filtro-q" />
            <Button variant="outline" onClick={load} className="h-9" data-testid="rep-filtrar">Filtrar</Button>
          </div>

          {/* Personalización del reporte: secciones a mostrar */}
          <div className="card-soft p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 mb-2">
              <SlidersHorizontal className="w-4 h-4" /> Arma tu reporte: selecciona qué secciones mostrar
            </div>
            <div className="flex flex-wrap gap-2">
              {SECCIONES.map(([k, l]) => (
                <button key={k} onClick={() => toggleSeccion(k)} data-testid={`rep-seccion-${k}`}
                  className={`px-3 h-8 rounded-md text-xs font-medium border ${secciones.has(k) ? "border-[#C1401E] bg-[#C1401E]/5 text-[#C1401E]" : "border-slate-200 text-slate-400 hover:bg-slate-50"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {loading ? <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div> : (
            <>
              {secciones.has("totales") && (
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                <Card label="Ventas" value={money(t.ventas || 0)} icon={DollarSign} cls="text-slate-800" testid="rep-ventas" />
                <Card label="Ingreso neto" value={money(t.ingreso_neto || 0)} icon={TrendingUp} cls="text-blue-700" testid="rep-ingreso" />
                <Card label="Costo" value={money(t.costo || 0)} icon={Package} cls="text-amber-700" testid="rep-costo" />
                <Card label="Utilidad" value={money(t.utilidad || 0)} icon={TrendingUp} cls="text-emerald-700" testid="rep-utilidad" />
                <Card label="Margen" value={`${t.margen || 0}%`} icon={Percent} cls="text-[#C1401E]" testid="rep-margen" />
                <Card label="Tickets" value={t.tickets || 0} icon={BarChart3} cls="text-slate-500" testid="rep-tickets" />
              </div>
              )}

              {secciones.has("grafica") && (
              <div className="card-soft p-4">
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Ventas por {group === "mes" ? "mes" : "día"} · {t.tickets || 0} tickets</div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Line type="monotone" dataKey="total" stroke="#C1401E" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              )}

              {secciones.has("vendedores") && data.vendedores && data.vendedores.length > 0 && (
                <div className="card-soft overflow-x-auto">
                  <div className="text-xs uppercase tracking-wider text-slate-400 p-3">Desempeño por vendedor</div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="p-3">Vendedor</th><th className="p-3 text-right">Tickets</th><th className="p-3 text-right">Ventas</th>
                      <th className="p-3 text-right">Ticket promedio</th><th className="p-3 text-right">Utilidad</th>
                    </tr></thead>
                    <tbody>
                      {data.vendedores.map((v) => (
                        <tr key={v.id} className="border-t border-slate-100">
                          <td className="p-3 font-medium">{v.nombre}</td>
                          <td className="p-3 text-right">{v.tickets}</td>
                          <td className="p-3 text-right">{money(v.ventas)}</td>
                          <td className="p-3 text-right text-slate-500">{money(v.ticket_promedio)}</td>
                          <td className="p-3 text-right font-semibold text-emerald-700">{money(v.utilidad)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {secciones.has("categorias") && data.categorias && data.categorias.length > 0 && (
                <div className="card-soft overflow-x-auto">
                  <div className="text-xs uppercase tracking-wider text-slate-400 p-3">Reporte por categoría</div>
                  <table className="w-full text-sm" data-testid="rep-categorias-table">
                    <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="p-3">Categoría</th><th className="p-3 text-right">Cantidad</th><th className="p-3 text-right">Ingreso</th>
                      <th className="p-3 text-right">Costo</th><th className="p-3 text-right">Utilidad</th><th className="p-3 text-center">Margen</th>
                    </tr></thead>
                    <tbody>
                      {data.categorias.map((c) => (
                        <tr key={c.categoria} className="border-t border-slate-100">
                          <td className="p-3 font-medium">{c.categoria}</td>
                          <td className="p-3 text-right">{c.cantidad}</td>
                          <td className="p-3 text-right">{money(c.ingreso)}</td>
                          <td className="p-3 text-right text-slate-500">{money(c.costo)}</td>
                          <td className="p-3 text-right font-semibold text-emerald-700">{money(c.utilidad)}</td>
                          <td className="p-3 text-center"><Badge className={c.margen >= 20 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{c.margen}%</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {secciones.has("top") && (
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="card-soft p-4">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Productos más vendidos</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={(data.top_vendidos || []).slice(0, 8)} layout="vertical" margin={{ left: 10 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="codigo" width={70} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="cantidad" fill="#C1401E" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="card-soft p-4">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Mayor utilidad</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={(data.top_utilidad || []).slice(0, 8)} layout="vertical" margin={{ left: 10 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="codigo" width={70} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v) => money(v)} />
                      <Bar dataKey="utilidad" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              )}

              {secciones.has("detalle") && (
              <div className="card-soft overflow-x-auto">
                <div className="flex items-center justify-between p-3">
                  <div className="text-xs uppercase tracking-wider text-slate-400">Utilidad por producto</div>
                  <select value={orden} onChange={(e) => setOrden(e.target.value)} className="h-8 border border-slate-200 rounded-md px-2 text-xs" data-testid="rep-orden">
                    <option value="utilidad">Ordenar por utilidad</option>
                    <option value="cantidad">Ordenar por cantidad</option>
                    <option value="ingreso">Ordenar por ingreso</option>
                    <option value="margen">Ordenar por margen</option>
                  </select>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="p-3">Código</th><th className="p-3">Producto</th><th className="p-3 text-right">Cant.</th>
                    <th className="p-3 text-right">Precio neto</th><th className="p-3 text-right">Precio bruto</th>
                    <th className="p-3 text-right">IVA</th><th className="p-3 text-right">Ingreso neto</th>
                    <th className="p-3 text-right">Costo</th><th className="p-3 text-right">Utilidad</th><th className="p-3 text-center">Margen</th>
                  </tr></thead>
                  <tbody>
                    {prods.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-slate-400">Sin resultados para el filtro seleccionado.</td></tr>}
                    {prods.slice(0, 200).map((p, i) => (
                      <tr key={i} className="border-t border-slate-100" data-testid={`rep-prod-${p.codigo}`}>
                        <td className="p-3 font-medium text-[#C1401E]">{p.codigo}</td>
                        <td className="p-3 max-w-[220px] truncate">{p.descripcion}</td>
                        <td className="p-3 text-right tabular-nums">{p.cantidad}</td>
                        <td className="p-3 text-right tabular-nums">{money(p.precio_neto)}</td>
                        <td className="p-3 text-right tabular-nums">{money(p.precio_bruto)}</td>
                        <td className="p-3 text-right tabular-nums">{money(p.iva)}</td>
                        <td className="p-3 text-right tabular-nums">{money(p.ingreso)}</td>
                        <td className="p-3 text-right text-slate-500 tabular-nums">{money(p.costo)}</td>
                        <td className="p-3 text-right font-semibold text-emerald-700 tabular-nums">{money(p.utilidad)}</td>
                        <td className="p-3 text-center"><Badge className={p.margen >= 20 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{p.margen}%</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "inventario" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><Warehouse className="w-6 h-6 text-[#C1401E]" /> Inventario Valorizado</h1></div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-36" data-testid="inv-desde" />
              <span className="text-slate-400">a</span>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-36" data-testid="inv-hasta" />
              <Input placeholder="Buscar producto/código…" value={invQ} onChange={(e) => setInvQ(e.target.value)} className="w-48 h-9" data-testid="inv-q" />
              <select value={invEstado} onChange={(e) => setInvEstado(e.target.value)} className="h-9 border border-slate-200 rounded-md px-2 text-sm" data-testid="inv-estado">
                <option value="activo">Solo activos</option>
                <option value="baja">Solo baja</option>
                <option value="todos">Todos los estados</option>
              </select>
              <Button onClick={loadInventario} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="inv-aplicar">Aplicar</Button>
              <Button variant="outline" onClick={exportarInventario} className="gap-1.5" data-testid="inv-export"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel</Button>
            </div>
          </div>

          {invLoading ? <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div> : (
            inv && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                  <Card label="Productos" value={it.productos || 0} icon={Package} cls="text-slate-700" testid="inv-productos" />
                  <Card label="Unidades" value={it.unidades || 0} icon={Package} cls="text-slate-500" testid="inv-unidades" />
                  <Card label="Valor inventario" value={money(it.valor_inventario || 0)} icon={DollarSign} cls="text-blue-700" testid="inv-valor" />
                  <Card label="Venta potencial" value={money(it.venta_potencial || 0)} icon={TrendingUp} cls="text-emerald-700" testid="inv-potencial" />
                  <Card label="Utilidad potencial" value={money(it.utilidad_potencial || 0)} icon={TrendingUp} cls="text-[#C1401E]" testid="inv-utilidad" />
                  <Card label="Margen prom." value={`${it.margen_promedio || 0}%`} icon={Percent} cls="text-amber-700" testid="inv-margen" />
                </div>

                <div className="card-soft overflow-x-auto">
                  <div className="text-xs uppercase tracking-wider text-slate-400 p-3">Existencia, costo y valor (unidades vendidas y rotación en el periodo)</div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="p-3">Código</th><th className="p-3">Producto</th><th className="p-3">Línea</th><th className="p-3 text-right">Exist.</th>
                      <th className="p-3 text-right">Min</th><th className="p-3 text-right">Costo</th><th className="p-3 text-right">Neto</th><th className="p-3 text-right">Bruto</th>
                      <th className="p-3 text-right">Valor inv.</th><th className="p-3 text-right">Venta pot.</th><th className="p-3 text-right">Util. pot.</th>
                      <th className="p-3 text-center">Margen</th><th className="p-3 text-right">Unid. vend.</th><th className="p-3 text-right">Rotación</th>
                    </tr></thead>
                    <tbody>
                      {inv.productos.length === 0 && <tr><td colSpan={14} className="p-8 text-center text-slate-400">Sin productos para los filtros seleccionados.</td></tr>}
                      {inv.productos.slice(0, 400).map((p, i) => (
                        <tr key={i} className="border-t border-slate-100" data-testid={`inv-fila-${p.codigo}`}>
                          <td className="p-3 font-medium text-[#C1401E]">{p.codigo}</td>
                          <td className="p-3 max-w-[220px] truncate">{p.descripcion}</td>
                          <td className="p-3 text-slate-500">{p.linea || "—"}</td>
                          <td className="p-3 text-right tabular-nums">{p.existencia}</td>
                          <td className="p-3 text-right text-slate-400">{p.stock_minimo}</td>
                          <td className="p-3 text-right tabular-nums">{money(p.costo)}</td>
                          <td className="p-3 text-right tabular-nums">{money(p.precio_sin_iva)}</td>
                          <td className="p-3 text-right tabular-nums">{money(p.precio_con_iva)}</td>
                          <td className="p-3 text-right font-semibold tabular-nums">{money(p.valor_inventario)}</td>
                          <td className="p-3 text-right tabular-nums">{money(p.venta_potencial)}</td>
                          <td className="p-3 text-right tabular-nums">{money(p.utilidad_potencial)}</td>
                          <td className="p-3 text-center"><Badge className={p.margen >= 20 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{p.margen}%</Badge></td>
                          <td className="p-3 text-right tabular-nums">{p.unidades_vendidas}</td>
                          <td className="p-3 text-right tabular-nums">{p.rotacion}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </>
      )}

      {tab === "centro" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><Landmark className="w-6 h-6 text-[#C1401E]" /> Centro de Reportes</h1></div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-36" data-testid="cen-desde" />
              <span className="text-slate-400">a</span>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-36" data-testid="cen-hasta" />
              <Button onClick={loadCentro} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="cen-aplicar">Aplicar</Button>
            </div>
          </div>

          {centroLoading ? <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div> : (
            centro && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <Card label="Ventas" value={money(c.ventas || 0)} icon={DollarSign} cls="text-slate-800" testid="cen-ventas" />
                  <Card label="Tickets" value={c.tickets || 0} icon={BarChart3} cls="text-slate-500" testid="cen-tickets" />
                  <Card label="Ticket promedio" value={money(c.ticket_promedio || 0)} icon={TrendingUp} cls="text-blue-700" testid="cen-ticket-prom" />
                  <Card label="Ingreso neto" value={money(c.ingreso_neto || 0)} icon={TrendingUp} cls="text-blue-700" testid="cen-ingreso" />
                  <Card label="Costo" value={money(c.costo || 0)} icon={Package} cls="text-amber-700" testid="cen-costo" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <Card label="Utilidad" value={money(c.utilidad || 0)} icon={TrendingUp} cls="text-emerald-700" testid="cen-utilidad" />
                  <Card label="Hoy" value={money(c.hoy || 0)} icon={CalendarDays} cls="text-slate-700" testid="cen-hoy" />
                  <Card label="Ayer" value={money(c.ayer || 0)} icon={CalendarDays} cls="text-slate-500" testid="cen-ayer" />
                  <Card label="Delta hoy/ayer" value={money(c.delta_hoy_ayer || 0)} icon={ArrowUpDown} cls={(c.delta_hoy_ayer || 0) >= 0 ? "text-emerald-700" : "text-red-600"} testid="cen-delta" />
                  <div className="card-soft p-4 flex flex-col justify-center">
                    <div className="text-xs uppercase tracking-wider text-slate-400">Hora / día pico</div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {centro.hora_pico != null && <Badge className="bg-[#C1401E]/10 text-[#C1401E]"><Clock3 className="w-3 h-3 mr-1" /> {String(centro.hora_pico).padStart(2, "0")}:00</Badge>}
                      {centro.dia_pico && <Badge className="bg-emerald-100 text-emerald-700"><CalendarDays className="w-3 h-3 mr-1" /> {centro.dia_pico}</Badge>}
                    </div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  <div className="card-soft p-4">
                    <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Ventas por hora</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={centro.por_hora || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                        <XAxis dataKey="hora" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="tickets" fill="#C1401E" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card-soft p-4">
                    <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Ventas por día de la semana</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={centro.por_dia_semana || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                        <XAxis dataKey="dia" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v) => money(v)} />
                        <Bar dataKey="total" fill="#10b981" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="card-soft overflow-x-auto">
                  <div className="text-xs uppercase tracking-wider text-slate-400 p-3">Métodos de pago</div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="p-3">Método</th><th className="p-3 text-right">Monto</th><th className="p-3">Distribución</th>
                    </tr></thead>
                    <tbody>
                      {(centro.por_metodo || []).map((m) => {
                        const totalMet = (centro.por_metodo || []).reduce((s, x) => s + x.monto, 0) || 1;
                        const pct = Math.round((m.monto / totalMet) * 100);
                        return (
                          <tr key={m.metodo} className="border-t border-slate-100">
                            <td className="p-3 font-medium">{METODOS_NOMBRE[m.metodo] || m.metodo}</td>
                            <td className="p-3 text-right tabular-nums">{money(m.monto)}</td>
                            <td className="p-3 w-1/3">
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#C1401E] rounded-full" style={{ width: `${pct}%` }} /></div>
                                <span className="text-xs text-slate-500 w-10 text-right">{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {(centro.por_metodo || []).length === 0 && <tr><td colSpan={3} className="p-8 text-center text-slate-400">Sin ventas en el periodo.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}