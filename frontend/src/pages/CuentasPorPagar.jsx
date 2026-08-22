import { useEffect, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, Search, Calendar, Filter, Download, FileDown, Loader2, ExternalLink, History } from "lucide-react";
import { format } from "date-fns";

export default function CuentasPorPagar() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ desde: "", hasta: "", proveedor: "", estado: "todos" });
  const [detOpen, setDetOpen] = useState(null);
  const [pagarOpen, setPagarOpen] = useState(null);
  const [pagoForm, setPagoForm] = useState({ monto: "", metodo_pago: "transferencia", referencia: "" });
  const [exporting, setExporting] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (f.desde) params.desde = f.desde;
      if (f.hasta) params.hasta = f.hasta;
      if (f.proveedor) params.proveedor = f.proveedor;
      const { data } = await api.get("/cxp", { params });
      setData(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [f.desde, f.hasta, f.proveedor, f.estado]);

  const handlePagar = async () => {
    if (!pagoForm.monto || Number(pagoForm.monto) <= 0) return toast.error("Ingresa un monto válido");
    try {
      const { data } = await api.post(`/cxp/${pagarOpen.id}/pagar`, {
        monto: Number(pagoForm.monto),
        metodo_pago: pagoForm.metodo_pago,
        referencia: pagoForm.referencia,
      });
      toast.success(`Pago registrado. Saldo: ${money(data.saldo_pendiente)}`);
      setPagarOpen(null);
      setPagoForm({ monto: "", metodo_pago: "transferencia", referencia: "" });
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const exportar = async (formato) => {
    setExporting(formato);
    try {
      const params = {};
      if (f.desde) params.desde = f.desde;
      if (f.hasta) params.hasta = f.hasta;
      const { data } = await api.get(`/cxp/exportar.${formato}`, { params, responseType: "blob" });
      const url = window.URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cxp_${format(new Date(), "yyyyMMdd_HHmmss")}.${formato}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error("Error al exportar"); }
    finally { setExporting(""); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>;

  const saldo = data?.saldo_total || 0;
  const pendientes = data?.facturas_pendientes || 0;
  const vencidas = data?.vencidas || [];
  const proximas = data?.proximas_vencer || [];

  return (
    <div className="space-y-5" data-testid="cxp-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Cuentas por pagar</h1>
          <p className="text-slate-500 text-sm">Gestión de facturas pendientes de proveedores</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportar("xlsx")} disabled={exporting === "xlsx"} className="h-9">
            {exporting === "xlsx" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <><FileDown className="w-4 h-4 mr-2" /> Excel</>}
          </Button>
          <Button variant="outline" onClick={() => exportar("pdf")} disabled={exporting === "pdf"} className="h-9">
            {exporting === "pdf" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <><Download className="w-4 h-4 mr-2" /> PDF</>}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-soft p-4">
          <div className="text-xs uppercase tracking-wider text-slate-400">Saldo total</div>
          <div className="font-display text-xl font-bold text-red-600">{money(saldo)}</div>
        </div>
        <div className="card-soft p-4">
          <div className="text-xs uppercase tracking-wider text-slate-400">Facturas pendientes</div>
          <div className="font-display text-2xl font-bold">{pendientes}</div>
        </div>
        <div className="card-soft p-4">
          <div className="text-xs uppercase tracking-wider text-slate-400">Vencidas</div>
          <div className="font-display text-xl font-bold text-red-600">{vencidas.length}</div>
        </div>
        <div className="card-soft p-4">
          <div className="text-xs uppercase tracking-wider text-slate-400">Próximas vencer</div>
          <div className="font-display text-xl font-bold text-amber-600">{proximas.length}</div>
        </div>
      </div>

      <div className="card-soft p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <Label className="text-xs uppercase text-slate-400">Desde</Label>
            <Input type="date" value={f.desde} onChange={(e) => setF(s => ({...s, desde: e.target.value}))} className="mt-1 h-9 w-36" />
          </div>
          <div>
            <Label className="text-xs uppercase text-slate-400">Hasta</Label>
            <Input type="date" value={f.hasta} onChange={(e) => setF(s => ({...s, hasta: e.target.value}))} className="mt-1 h-9 w-36" />
          </div>
          <div>
            <Label className="text-xs uppercase text-slate-400">Proveedor</Label>
            <Input value={f.proveedor} onChange={(e) => setF(s => ({...s, proveedor: e.target.value}))} placeholder="Nombre o ID" className="mt-1 h-9 w-48" />
          </div>
        </div>
      </div>

      {/* Facturas vencidas */}
      {vencidas.length > 0 && (
        <div className="card-soft p-4">
          <h2 className="font-display text-sm font-bold text-red-600 mb-3 flex items-center gap-2"><History className="w-4 h-4" /> Facturas vencidas</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-2">Folio</th><th className="p-2">Proveedor</th><th className="p-2">Factura</th><th className="p-2 text-right">Vencido</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Saldo</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {vencidas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 font-medium">{f.folio}</td>
                    <td className="p-2">{f.proveedor_nombre}</td>
                    <td className="p-2 text-slate-500">{f.factura_numero || "—"}</td>
                    <td className="p-2 text-right text-red-600">{f.fecha_vencimiento?.slice(0, 10)}</td>
                    <td className="p-2 text-right">{money(f.total)}</td>
                    <td className="p-2 text-right font-semibold text-red-600">{money(f.saldo)}</td>
                    <td className="p-2"><Button size="sm" variant="outline" onClick={() => setPagarOpen(f)} data-testid={`pagar-${f.id}`}>Pagar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Facturas próximas vencer */}
      {proximas.length > 0 && (
        <div className="card-soft p-4">
          <h2 className="font-display text-sm font-bold text-amber-600 mb-3">Próximos vencimientos</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-2">Folio</th><th className="p-2">Proveedor</th><th className="p-2">Factura</th><th className="p-2 text-right">Vence</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Saldo</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {proximas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 font-medium">{f.folio}</td>
                    <td className="p-2">{f.proveedor_nombre}</td>
                    <td className="p-2 text-slate-500">{f.factura_numero || "—"}</td>
                    <td className="p-2 text-right text-amber-600">{f.fecha_vencimiento?.slice(0, 10)}</td>
                    <td className="p-2 text-right">{money(f.total)}</td>
                    <td className="p-2 text-right font-semibold text-amber-600">{money(f.saldo)}</td>
                    <td className="p-2"><Button size="sm" variant="outline" onClick={() => setPagarOpen(f)} data-testid={`pagar-${f.id}`}>Pagar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Todas las facturas */}
      <div className="card-soft p-4">
        <h2 className="font-display text-sm font-bold mb-3">Todas las facturas</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="p-2">Folio</th><th className="p-2">Tipo</th><th className="p-2">Proveedor</th><th className="p-2">Factura</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Abonado</th><th className="p-2 text-right">Saldo</th><th className="p-2">Estado</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {(data?.facturas || []).map((f) => (
                <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-2 font-medium">{f.folio}</td>
                  <td className="p-2"><Badge variant="outline">{f.tipo}</Badge></td>
                  <td className="p-2">{f.proveedor_nombre}</td>
                  <td className="p-2 text-slate-500">{f.factura_numero || "—"}</td>
                  <td className="p-2 text-right">{money(f.total)}</td>
                  <td className="p-2 text-right text-green-600">{money(f.abonado)}</td>
                  <td className="p-2 text-right font-semibold">{money(f.saldo)}</td>
                  <td className="p-2"><Badge className={f.saldo > 0 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}>{f.saldo > 0 ? "Pendiente" : "Pagada"}</Badge></td>
                  <td className="p-2"><Button size="sm" variant="ghost" onClick={() => setDetOpen(f)} data-testid={`detalle-${f.id}`}>Ver</Button></td>
                </tr>
              ))}
              {(!loading && (data?.facturas || []).length === 0) && <tr><td colSpan={9} className="p-6 text-center text-slate-400">Sin facturas registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detalle factura */}
      <Dialog open={!!detOpen} onOpenChange={(o) => !o && setDetOpen(null)}>
        <DialogContent className="max-w-md" data-testid="cxp-detalle">
          <DialogHeader><DialogTitle className="font-display">Factura {detOpen?.folio}</DialogTitle></DialogHeader>
          {detOpen && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><Label className="text-xs text-slate-400">Proveedor</Label><div>{detOpen.proveedor_nombre}</div></div>
                <div><Label className="text-xs text-slate-400">Total</Label><div>{money(detOpen.total)}</div></div>
                <div><Label className="text-xs text-slate-400">Abonado</Label><div>{money(detOpen.abonado)}</div></div>
                <div><Label className="text-xs text-slate-400">Saldo</Label><div className="font-semibold">{money(detOpen.saldo)}</div></div>
                <div><Label className="text-xs text-slate-400">Factura</Label><div>{detOpen.factura_numero || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Fecha</Label><div>{detOpen.fecha_recepcion?.slice(0, 10)}</div></div>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDetOpen(null)}>Cerrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagar factura */}
      <Dialog open={!!pagarOpen} onOpenChange={(o) => !o && setPagarOpen(null)}>
        <DialogContent className="max-w-sm" data-testid="pagar-dialog">
          <DialogHeader><DialogTitle className="font-display">Pagar factura {pagarOpen?.folio}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="card-soft p-3 bg-amber-50">
              <div className="text-xs text-slate-500">Saldo a pagar</div>
              <div className="font-display text-xl font-bold text-amber-600">{money(pagarOpen?.saldo || 0)}</div>
            </div>
            <div><Label className="text-xs uppercase text-slate-400">Monto</Label><Input type="number" value={pagoForm.monto} onChange={(e) => setPagoForm(s => ({...s, monto: e.target.value}))} className="mt-1 h-9" data-testid="pago-monto" /></div>
            <div><Label className="text-xs uppercase text-slate-400">Método de pago</Label>
              <Select value={pagoForm.metodo_pago} onValueChange={(v) => setPagoForm(s => ({...s, metodo_pago: v}))}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="deposito">Depósito</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs uppercase text-slate-400">Referencia</Label><Input value={pagoForm.referencia} onChange={(e) => setPagoForm(s => ({...s, referencia: e.target.value}))} className="mt-1 h-9" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPagarOpen(null)}>Cancelar</Button><Button onClick={handlePagar} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="confirmar-pago">Pagar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}