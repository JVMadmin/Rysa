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
import { Eye, XCircle, Copy, Printer, Plus, Loader2, Receipt } from "lucide-react";

export default function Ventas() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rango, setRango] = useState("all");
  const [estado, setEstado] = useState("all");
  const [detalle, setDetalle] = useState(null);
  const [cancelSale, setCancelSale] = useState(null);
  const [motivo, setMotivo] = useState("");

  const load = async () => {
    setLoading(true);
    const params = {};
    if (rango !== "all") params.rango = rango;
    if (estado !== "all") params.estado = estado;
    const { data } = await api.get("/sales", { params });
    setRows(data); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rango, estado]);

  const cancelar = async () => {
    if (!motivo.trim()) return toast.error("Indica el motivo");
    try { await api.post(`/sales/${cancelSale.id}/cancelar`, { motivo }); toast.success("Venta cancelada y revertida"); setCancelSale(null); setMotivo(""); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const copiar = (s) => {
    const items = s.items.map((i) => ({ product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad, precio: i.precio, iva_tasa: i.iva_tasa, descuento: i.descuento }));
    nav("/app/pos", { state: { copyItems: items } });
  };

  return (
    <div className="space-y-5" data-testid="ventas-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Ventas</h1><p className="text-slate-500 text-sm">{rows.length} registros</p></div>
        <Button onClick={() => nav("/app/pos")} className="bg-[#FF5A00] hover:bg-[#E04F00]" data-testid="nueva-venta-btn"><Plus className="w-4 h-4 mr-1" /> Nueva venta</Button>
      </div>

      <div className="flex flex-wrap gap-2 bg-white border border-slate-200 rounded-md p-3">
        <Select value={rango} onValueChange={setRango}>
          <SelectTrigger className="w-36" data-testid="filtro-rango"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem><SelectItem value="hoy">Hoy</SelectItem>
            <SelectItem value="mes">Este mes</SelectItem><SelectItem value="anio">Este año</SelectItem>
          </SelectContent>
        </Select>
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos estados</SelectItem><SelectItem value="confirmada">Confirmadas</SelectItem><SelectItem value="cancelada">Canceladas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Estado</th><th className="p-3">Folio</th><th className="p-3">Fecha</th><th className="p-3">Cliente</th>
            <th className="p-3 text-right">Subtotal</th><th className="p-3 text-right">IVA</th><th className="p-3 text-right">Total</th>
            <th className="p-3">Cond.</th><th className="p-3 text-right">Saldo</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#0055A4]" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} className="p-10 text-center text-slate-400"><Receipt className="w-8 h-8 mx-auto mb-2" />Sin ventas.</td></tr>}
            {!loading && rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`venta-row-${s.folio}`}>
                <td className="p-3"><Badge className={s.estado === "cancelada" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>{s.estado}</Badge></td>
                <td className="p-3 font-medium text-[#0055A4]">{s.folio}</td>
                <td className="p-3 text-slate-500">{s.fecha?.slice(0, 10)} {s.hora}</td>
                <td className="p-3">{s.cliente_nombre}</td>
                <td className="p-3 text-right">{money(s.subtotal)}</td>
                <td className="p-3 text-right">{money(s.iva_total)}</td>
                <td className="p-3 text-right font-semibold">{money(s.total)}</td>
                <td className="p-3"><Badge variant="outline">{s.condicion}</Badge></td>
                <td className="p-3 text-right">{money(s.saldo)}</td>
                <td className="p-3">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" onClick={() => setDetalle(s)} data-testid={`ver-${s.folio}`}><Eye className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => copiar(s)} title="Copiar"><Copy className="w-4 h-4" /></Button>
                    {s.estado === "confirmada" && can("venta.cancelar") && <Button size="icon" variant="ghost" onClick={() => setCancelSale(s)} className="text-red-500" data-testid={`cancelar-${s.folio}`}><XCircle className="w-4 h-4" /></Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detalle / reimprimir */}
      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent data-testid="venta-detalle">
          <DialogHeader><DialogTitle className="font-display">Venta {detalle?.folio}</DialogTitle></DialogHeader>
          {detalle && (
            <div className="text-sm">
              <div className="text-slate-500 mb-2">{detalle.fecha?.slice(0, 16).replace("T", " ")} · {detalle.cliente_nombre} · {detalle.usuario_nombre}</div>
              <table className="w-full mb-3">
                <thead><tr className="text-xs text-slate-400 text-left"><th>Cant</th><th>Producto</th><th className="text-right">Importe</th></tr></thead>
                <tbody>{detalle.items.map((i, k) => <tr key={k} className="border-t border-slate-100"><td className="py-1">{i.cantidad}</td><td className="py-1">{i.descripcion}</td><td className="py-1 text-right">{money(i.cantidad * i.precio - (i.descuento || 0))}</td></tr>)}</tbody>
              </table>
              <div className="flex justify-between"><span>Subtotal</span><span>{money(detalle.subtotal)}</span></div>
              <div className="flex justify-between"><span>IVA</span><span>{money(detalle.iva_total)}</span></div>
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
    </div>
  );
}
