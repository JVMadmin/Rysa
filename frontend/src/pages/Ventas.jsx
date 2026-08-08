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
import { Eye, XCircle, Copy, Printer, Plus, Loader2, Receipt, FileText, Search, BarChart3, Send } from "lucide-react";

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
  const [clientes, setClientes] = useState([]);
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    const params = {};
    if (rango === "rango") { if (desde) params.desde = desde; if (hasta) params.hasta = hasta; }
    else if (rango !== "all") params.rango = rango;
    if (estado !== "all") params.estado = estado;
    if (vendedorId !== "all") params.vendedor_id = vendedorId;
    if (q) params.q = q;
    const { data } = await api.get("/sales", { params });
    setRows(data); setLoading(false);
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

  const abrirFacturar = (s) => { setFacturarSale(s); setFactCliente(s.cliente_id || "publico"); };
  const facturar = async () => {
    setBusy("fact");
    try {
      // Si cambió el cliente, se asigna a la venta antes de timbrar
      if (factCliente && factCliente !== "publico" && factCliente !== facturarSale.cliente_id) {
        const c = clientes.find((x) => x.id === factCliente);
        await api.put(`/sales/${facturarSale.id}/cliente`, { cliente_id: factCliente, cliente_nombre: c?.nombre || "" });
      }
      const { data } = await api.post(`/facturacion/sale/${facturarSale.id}`);
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
          <Button onClick={() => nav("/app/pos")} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="nueva-venta-btn"><Plus className="w-4 h-4 mr-1" /> Nueva venta</Button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-md p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK.map(([k, l]) => (
            <Button key={k} size="sm" variant={rango === k ? "default" : "outline"} className={rango === k ? "bg-[#B95A3A] hover:bg-[#8B3A2A]" : ""} onClick={() => setRango(k)} data-testid={`quick-${k}`}>{l}</Button>
          ))}
          <Button size="sm" variant={rango === "rango" ? "default" : "outline"} className={rango === "rango" ? "bg-[#B95A3A] hover:bg-[#8B3A2A]" : ""} onClick={() => setRango("rango")} data-testid="quick-rango">Fecha a fecha</Button>
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

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Estado</th><th className="p-3">Folio</th><th className="p-3">Fecha</th><th className="p-3">Cliente</th><th className="p-3">Vendedor</th>
            <th className="p-3 text-right">Total</th><th className="p-3">Cond.</th><th className="p-3 text-center">Factura</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#B95A3A]" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-slate-400"><Receipt className="w-8 h-8 mx-auto mb-2" />Sin ventas.</td></tr>}
            {!loading && rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`venta-row-${s.folio}`}>
                <td className="p-3"><Badge className={s.estado === "cancelada" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>{s.estado}</Badge></td>
                <td className="p-3 font-medium text-[#B95A3A]">{s.folio}</td>
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
            ))}
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
        <DialogContent data-testid="facturar-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><FileText className="w-5 h-5" /> Facturar venta {facturarSale?.folio}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-slate-50 rounded p-3 text-sm flex justify-between"><span>Total</span><b>{money(facturarSale?.total)}</b></div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Cliente receptor</Label>
              <Select value={factCliente} onValueChange={setFactCliente}>
                <SelectTrigger className="mt-1" data-testid="facturar-cliente"><SelectValue placeholder="Selecciona cliente" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="publico">Público General (XAXX010101000)</SelectItem>
                  {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.codigo} · {c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-400 mt-1">Se preselecciona el cliente de la venta; puedes cambiarlo antes de timbrar.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFacturarSale(null)}>Cancelar</Button>
            <Button onClick={facturar} disabled={busy === "fact"} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="facturar-confirm">{busy === "fact" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Emitir CFDI"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
