import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Eye, XCircle, Copy, Printer, Plus, Loader2, Receipt, FileText, Search, BarChart3, Send, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

const QUICK = [["hoy", "Hoy"], ["semana", "Esta semana"], ["mes", "Este mes"], ["mes_anterior", "Mes anterior"], ["all", "Todas"]];

export default function Ventas() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rango, setRango] = useState("mes");
  const [estado, setEstado] = useState("all");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [vendedorId, setVendedorId] = useState("all");
  const [q, setQ] = useState("");
  const [vendedores, setVendedores] = useState([]);
  const [detalle, setDetalle] = useState(null);
  const [cancelSale, setCancelSale] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [remitirSale, setRemitirSale] = useState(null);
  const [facturarSale, setFacturarSale] = useState(null);
  const [factCliente, setFactCliente] = useState("");
  const [factClienteQuery, setFactClienteQuery] = useState("");
  const [factClienteOpen, setFactClienteOpen] = useState(false);
  const [factBilling, setFactBilling] = useState({ rfc: "", razon_social: "", cp: "", reg_fiscal: "", uso_cfdi: "", direccion: "" });
  const [clientes, setClientes] = useState([]);
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState([]);
  const [sort, setSort] = useState({ key: "fecha", dir: "desc" });
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sorted = [...rows];
  if (sort.key) {
    sorted.sort((a, b) => {
      const getV = (r) => {
        if (sort.key === "total") return Number(r.total || 0);
        if (sort.key === "cliente") return r.cliente_nombre || "";
        if (sort.key === "vendedor") return r.vendedor_nombre || r.usuario_nombre || "";
        return r[sort.key] || "";
      };
      let x = getV(a), y = getV(b);
      if (sort.key === "total") { x = Number(x || 0); y = Number(y || 0); return sort.dir === "asc" ? x - y : y - x; }
      const r = String(x || "").localeCompare(String(y || ""), "es", { numeric: true });
      return sort.dir === "asc" ? r : -r;
    });
  }

  const facturables = rows.filter((s) => s.estado === "confirmada" && !s.facturado && s.tipo_venta !== "cotizacion");
  const toggleSel = (id) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const selRows = rows.filter((r) => sel.includes(r.id));

  const facturarVarias = async () => {
    if (sel.length === 0) return toast.error("Selecciona al menos una venta");
    setBusy("multi");
    try {
      const { data } = await api.post("/facturacion/multi", { sale_ids: sel });
      toast.success(`CFDI emitido por ${data.ventas} ventas · ${data.uuid || "(sandbox)"}`);
      setSel([]); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  const load = async () => {
    setLoading(true);
    const params = {};
    if (rango === "rango") { if (desde) params.desde = desde; if (hasta) params.hasta = hasta; }
    else if (rango !== "all") params.rango = rango;
    if (estado !== "all") params.estado = estado;
    if (vendedorId !== "all") params.vendedor_id = vendedorId;
    if (q) params.q = q;
    const { data } = await api.get("/sales", { params });
    setRows(data); setSel([]); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rango, estado, vendedorId, desde, hasta]);
  useEffect(() => {
    api.get("/vendedores").then((r) => setVendedores(r.data)).catch(() => {});
    api.get("/clients").then((r) => setClientes(r.data)).catch(() => {});
  }, []);

  const cancelar = async () => {
    if (!motivo.trim()) return toast.error("Indica el motivo");
    try { await api.post(`/sales/${cancelSale.id}/cancelar`, { motivo }); toast.success("Venta cancelada y revertida"); setCancelSale(null); setMotivo(""); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const irRemitir = (s, cancelarOriginal) => {
    const items = s.items.map((i) => ({ product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad, precio: i.precio, iva_tasa: i.iva_tasa, descuento: i.descuento, precios: i.precios || [], precio_minimo: i.precio_minimo ?? 0 }));
    const go = () => nav("/app/pos", { state: { copyItems: items, cliente_id: s.cliente_id, cliente_nombre: s.cliente_nombre, descuento_global: 0, lista_precios: s.lista_precios } });
    if (cancelarOriginal) {
      api.post(`/sales/${s.id}/cancelar`, { motivo: "Remitida a nueva venta" })
        .then(() => { toast.success(`Ticket ${s.folio} cancelado`); go(); })
        .catch((e) => toast.error(formatApiError(e.response?.data?.detail)));
    } else { go(); }
    setRemitirSale(null);
  };

  const selectFactCliente = (v) => {
    setFactCliente(v);
    const c = clientes.find((x) => x.id === v);
    setFactClienteQuery(c ? `${c.codigo || ""} ${c.nombre}`.trim() : "Público General (XAXX010101000)");
    setFactClienteOpen(false);
    setFactBilling({
      rfc: c?.rfc || "",
      razon_social: c?.nombre || "",
      cp: c?.cp || "",
      reg_fiscal: c?.reg_fiscal || "",
      uso_cfdi: c?.uso_cfdi || "",
      direccion: [c?.calle, c?.numero_exterior, c?.colonia, c?.ciudad, c?.estado_geo].filter(Boolean).join(", "),
    });
  };
  const abrirFacturar = (s) => {
    setFacturarSale(s);
    selectFactCliente(s.cliente_id || "publico");
  };
  const filteredFactClientes = factClienteQuery
    ? clientes.filter((c) => `${c.codigo} ${c.nombre} ${c.rfc || ""}`.toLowerCase().includes(factClienteQuery.toLowerCase())).slice(0, 50)
    : clientes.slice(0, 50);
  const facturar = async () => {
    setBusy("fact");
    try {
      // Si cambió el cliente, se asigna a la venta antes de timbrar
      if (factCliente && factCliente !== "publico" && factCliente !== facturarSale.cliente_id) {
        const c = clientes.find((x) => x.id === factCliente);
        await api.put(`/sales/${facturarSale.id}/cliente`, { cliente_id: factCliente, cliente_nombre: c?.nombre || "" });
      }
      const { data } = await api.post(`/facturacion/sale/${facturarSale.id}`, factBilling);
      toast.success(`CFDI emitido · ${data.uuid || "(sandbox)"}`);
      setFacturarSale(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  return (
    <div className="space-y-5" data-testid="ventas-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Ventas</h1><p className="text-slate-500 text-sm">{rows.length} registros</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => nav("/app/reportes")} data-testid="ir-reportes"><BarChart3 className="w-4 h-4 mr-1" /> Reportes</Button>
          {can("venta.facturar") && (
            <Button variant="outline" onClick={facturarVarias} disabled={busy === "multi" || sel.length === 0} data-testid="facturar-varias" title="Facturar las ventas seleccionadas en una sola factura">
              {busy === "multi" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileText className="w-4 h-4 mr-1" /> Facturar {sel.length || ""} seleccionadas</>}
            </Button>
          )}
          <Button onClick={() => nav("/app/pos")} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="nueva-venta-btn"><Plus className="w-4 h-4 mr-1" /> Nueva venta</Button>
        </div>
      </div>

      <div className="card-soft p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK.map(([k, l]) => (
            <Button key={k} size="sm" variant={rango === k ? "default" : "outline"} className={rango === k ? "bg-[#C1401E] hover:bg-[#A03316]" : ""} onClick={() => setRango(k)} data-testid={`quick-${k}`}>{l}</Button>
          ))}
          <Button size="sm" variant={rango === "rango" ? "default" : "outline"} className={rango === "rango" ? "bg-[#C1401E] hover:bg-[#A03316]" : ""} onClick={() => setRango("rango")} data-testid="quick-rango">Fecha a fecha</Button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {rango === "rango" && (
            <>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" data-testid="fecha-desde" />
              <span className="text-slate-400">a</span>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" data-testid="fecha-hasta" />
            </>
          )}
          <Select value={vendedorId} onValueChange={setVendedorId}>
            <SelectTrigger className="w-48" data-testid="filtro-vendedor"><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos los vendedores</SelectItem>{vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos estados</SelectItem><SelectItem value="confirmada">Confirmadas</SelectItem><SelectItem value="cancelada">Canceladas</SelectItem></SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Buscar folio o cliente..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="pl-9" data-testid="buscar-venta" />
          </div>
        </div>
      </div>

      <div className="card-soft overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3 w-8">{can("venta.facturar") ? <input type="checkbox" checked={sel.length === facturables.length && facturables.length > 0} onChange={(e) => setSel(e.target.checked ? facturables.map((f) => f.id) : [])} data-testid="sel-todas" /> : null}</th>
            {[{ key: "estado", label: "Estado" }, { key: "folio", label: "Folio" }, { key: "fecha", label: "Fecha" }, { key: "cliente", label: "Cliente" }, { key: "vendedor", label: "Vendedor" }].map((col) => (
              <th key={col.key} onClick={() => toggleSort(col.key)} className={`p-3 cursor-pointer select-none hover:text-[#C1401E] ${col.right ? "text-right" : "text-left"}`}>
                <span className={`inline-flex items-center gap-1 ${col.right ? "flex-row-reverse" : ""}`}>
                  {col.label}
                  {sort.key === col.key ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                </span>
              </th>
            ))}
            <th className="p-3 text-right cursor-pointer select-none hover:text-[#C1401E]" onClick={() => toggleSort("total")}>
              <span className="inline-flex items-center gap-1 flex-row-reverse">Total {sort.key === "total" ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}</span>
            </th>
            <th className="p-3">Cond.</th><th className="p-3 text-center">Factura</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
            {!loading && sorted.length === 0 && <tr><td colSpan={10} className="p-10 text-center text-slate-400"><Receipt className="w-8 h-8 mx-auto mb-2" />Sin ventas.</td></tr>}
            {!loading && sorted.map((s) => {
              const facturable = s.estado === "confirmada" && !s.facturado && s.tipo_venta !== "cotizacion";
              return (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`venta-row-${s.folio}`}>
                <td className="p-3">{can("venta.facturar") && facturable ? <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggleSel(s.id)} data-testid={`sel-${s.folio}`} /> : null}</td>
                <td className="p-3"><Badge className={s.estado === "cancelada" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>{s.estado}</Badge></td>
                <td className="p-3 font-medium text-[#C1401E]">{s.folio}</td>
                <td className="p-3 text-slate-500">{s.fecha?.slice(0, 10)} {s.hora}</td>
                <td className="p-3">{s.cliente_nombre}</td>
                <td className="p-3 text-slate-500" data-testid={`venta-vendedor-${s.folio}`}>{s.vendedor_nombre || s.usuario_nombre}</td>
                <td className="p-3 text-right font-semibold">{money(s.total)}</td>
                <td className="p-3"><Badge variant="outline">{s.condicion}</Badge></td>
                <td className="p-3 text-center">{s.facturado ? <Badge className="bg-emerald-100 text-emerald-700">Facturada</Badge> : <span className="text-slate-300 text-xs">—</span>}</td>
                <td className="p-3">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" onClick={() => setDetalle(s)} data-testid={`ver-${s.folio}`}><Eye className="w-4 h-4" /></Button>
                    {s.estado === "confirmada" && !s.facturado && s.tipo_venta !== "cotizacion" &&
                      <Button size="sm" variant="outline" onClick={() => abrirFacturar(s)} title="Facturar" data-testid={`facturar-venta-${s.folio}`}><FileText className="w-4 h-4 mr-1" /> Facturar</Button>}
                    <Button size="sm" variant="outline" onClick={() => setRemitirSale(s)} title="Remitir" data-testid={`remitir-${s.folio}`}><Copy className="w-4 h-4 mr-1" /> Remitir</Button>
                    {s.estado === "confirmada" && can("venta.cancelar") && <Button size="icon" variant="ghost" onClick={() => setCancelSale(s)} className="text-red-500" data-testid={`cancelar-${s.folio}`}><XCircle className="w-4 h-4" /></Button>}
                  </div>
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>

      {/* Detalle */}
      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent data-testid="venta-detalle">
          <DialogHeader><DialogTitle className="font-display">Venta {detalle?.folio}</DialogTitle></DialogHeader>
          {detalle && (
            <div className="text-sm">
              <div className="text-slate-500 mb-2">{detalle.fecha?.slice(0, 16).replace("T", " ")} · Cliente: {detalle.cliente_nombre} · Vendedor: {detalle.vendedor_nombre || detalle.usuario_nombre}</div>
              <table className="w-full mb-3">
                <thead><tr className="text-xs text-slate-400 text-left"><th>Cant</th><th>Producto</th><th className="text-right">Importe</th></tr></thead>
                <tbody>{detalle.items.map((i, k) => <tr key={k} className="border-t border-slate-100"><td className="py-1">{i.cantidad}</td><td className="py-1">{i.descripcion}</td><td className="py-1 text-right">{money(i.cantidad * i.precio - (i.descuento || 0))}</td></tr>)}</tbody>
              </table>
              <div className="flex justify-between font-bold text-lg"><span>Total</span><span>{money(detalle.total)}</span></div>
              {detalle.cancelacion && <div className="mt-3 p-2 bg-red-50 text-red-700 rounded text-xs">Cancelada por {detalle.cancelacion.usuario}: {detalle.cancelacion.motivo}</div>}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" /> Reimprimir</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelar */}
      <Dialog open={!!cancelSale} onOpenChange={(o) => !o && setCancelSale(null)}>
        <DialogContent data-testid="cancel-dialog">
          <DialogHeader><DialogTitle className="font-display">Cancelar venta {cancelSale?.folio}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Se revertirá el inventario, la caja y el saldo del cliente. Esta acción queda registrada.</p>
          <div><Label className="text-xs uppercase tracking-wider text-slate-500">Motivo</Label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1" data-testid="cancel-motivo" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setCancelSale(null)}>Volver</Button><Button onClick={cancelar} className="bg-red-600 hover:bg-red-700" data-testid="confirm-cancel">Cancelar venta</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remitir: copiar o cancelar original */}
      <Dialog open={!!remitirSale} onOpenChange={(o) => !o && setRemitirSale(null)}>
        <DialogContent data-testid="remitir-dialog">
          <DialogHeader><DialogTitle className="font-display">Remitir venta {remitirSale?.folio}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">Se abrirá el POS con los mismos productos y el cliente <b>{remitirSale?.cliente_nombre}</b>. ¿Qué deseas hacer con el ticket original?</p>
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Si eliges "Cancelar original", el ticket {remitirSale?.folio} se cancelará automáticamente (revierte inventario/caja/saldo).</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemitirSale(null)}>Volver</Button>
            <Button variant="outline" onClick={() => irRemitir(remitirSale, false)} data-testid="remitir-copiar"><Copy className="w-4 h-4 mr-1" /> Solo copiar</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => irRemitir(remitirSale, true)} data-testid="remitir-cancelar"><XCircle className="w-4 h-4 mr-1" /> Copiar y cancelar original</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

{/* Facturar directo */}
      <Dialog open={!!facturarSale} onOpenChange={(o) => !o && setFacturarSale(null)}>
        <DialogContent className="max-w-lg" data-testid="facturar-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><FileText className="w-5 h-5" /> Facturar venta {facturarSale?.folio}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[65vh] overflow-y-auto">
            <div className="bg-slate-50 rounded p-3 text-sm flex justify-between"><span>Total</span><b>{money(facturarSale?.total)}</b></div>
            <div className="relative">
              <Label className="text-xs uppercase tracking-wider text-slate-500">Cliente receptor</Label>
              <Input
                value={factClienteQuery}
                onChange={(e) => { setFactClienteQuery(e.target.value); setFactClienteOpen(true); }}
                onFocus={() => setFactClienteOpen(true)}
                onBlur={() => setTimeout(() => setFactClienteOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (filteredFactClientes[0]) selectFactCliente(filteredFactClientes[0].id); } }}
                placeholder="Busca cliente por código, nombre o RFC..."
                className="mt-1" data-testid="facturar-cliente" />
              {factClienteOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                  <button type="button" onMouseDown={() => selectFactCliente("publico")} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${factCliente === "publico" ? "bg-slate-100 font-medium" : ""}`}>
                    Público General (XAXX010101000)
                  </button>
                  {filteredFactClientes.map((c) => (
                    <button key={c.id} type="button" onMouseDown={() => selectFactCliente(c.id)} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${factCliente === c.id ? "bg-slate-100 font-medium" : ""}`}>
                      <span className="font-medium">{c.codigo}</span> · {c.nombre}
                      {c.rfc && <span className="block text-[11px] text-slate-400 font-mono">RFC: {c.rfc}</span>}
                    </button>
                  ))}
                  {filteredFactClientes.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">Sin resultados</div>}
                </div>
              )}
            </div>
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Datos de facturación</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">RFC</Label>
                  <Input value={factBilling.rfc} onChange={(e) => setFactBilling((s) => ({ ...s, rfc: e.target.value }))} placeholder="XAXX010101000" className="mt-1 font-mono" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">Razón social</Label>
                  <Input value={factBilling.razon_social} onChange={(e) => setFactBilling((s) => ({ ...s, razon_social: e.target.value }))} placeholder="PUBLICO EN GENERAL" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Código Postal</Label>
                  <Input value={factBilling.cp} onChange={(e) => setFactBilling((s) => ({ ...s, cp: e.target.value }))} placeholder="CP" className="mt-1 font-mono" />
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Régimen fiscal</Label>
                  <Input value={factBilling.reg_fiscal} onChange={(e) => setFactBilling((s) => ({ ...s, reg_fiscal: e.target.value }))} placeholder="601" className="mt-1 font-mono" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">Uso CFDI</Label>
                  <Input value={factBilling.uso_cfdi} onChange={(e) => setFactBilling((s) => ({ ...s, uso_cfdi: e.target.value }))} placeholder="G03" className="mt-1 font-mono" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">Dirección fiscal</Label>
                  <Input value={factBilling.direccion} onChange={(e) => setFactBilling((s) => ({ ...s, direccion: e.target.value }))} placeholder="Calle, número, colonia, ciudad, estado" className="mt-1" />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFacturarSale(null)}>Cancelar</Button>
            <Button onClick={facturar} disabled={busy === "fact"} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="facturar-confirm">{busy === "fact" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Emitir CFDI"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
