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
import { Loader2, Receipt, Eye, RefreshCw, Search, ArrowRightCircle, FileText } from "lucide-react";

const ESTADOS = {
  cotizacion: ["bg-blue-100 text-blue-700", "Vigente"],
  convertida: ["bg-green-100 text-green-700", "Convertida"],
  cancelada: ["bg-red-100 text-red-700", "Cancelada"],
};

const METODOS = [["efectivo", "Efectivo"], ["tarjeta", "Tarjeta"], ["transferencia", "Transferencia"], ["spei", "SPEI"], ["deposito", "Depósito"], ["otros", "Otro"]];

export default function Cotizaciones() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("todos");
  const [det, setDet] = useState(null);
  const [conv, setConv] = useState(null);
  const [convForm, setConvForm] = useState({ condicion: "contado", metodo: "efectivo", monto: "", vendedor_id: "" });
  const [convSaving, setConvSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    const params = {};
    if (fEstado !== "todos") params.estado = fEstado;
    if (q) params.q = q;
    try {
      const { data } = await api.get("/cotizaciones", { params });
      setRows(data || []);
    } catch (e) {
      setErr(formatApiError(e.response?.data?.detail) || "No se pudieron cargar las cotizaciones.");
      setRows([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fEstado]);

  const convertir = async () => {
    if (!conv) return;
    const condicion = convForm.condicion;
    const monto = Number(convForm.monto || 0);
    if (condicion === "contado" && monto <= 0) return toast.error("Indica el monto cobrado (efectivo/cobro)");
    setConvSaving(true);
    try {
      const pagos = condicion === "credito" ? [] : [{ metodo: convForm.metodo, monto }];
      const { data } = await api.post(`/cotizaciones/${conv.id}/convertir`, {
        condicion,
        pagos,
        vendedor_id: convForm.vendedor_id || null,
      });
      toast.success(`Cotización convertida a venta ${data.folio}`);
      setConv(null);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setConvSaving(false); }
  };

  const filtradas = rows.filter((r) => !q || `${r.folio} ${r.cliente_nombre || ""} ${r.vendedor_nombre || ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5" data-testid="cotizaciones-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><Receipt className="w-6 h-6 text-[#C1401E]" /> Cotizaciones</h1>
          <p className="text-slate-500 text-sm">Cotizaciones creadas desde el punto de venta · conviértelas a venta</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-9" onClick={load}><RefreshCw className="w-4 h-4 mr-1" /> Actualizar</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 card-soft p-3">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-[10px] uppercase text-slate-400">Buscar</Label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Folio, cliente o vendedor..." className="mt-1 h-9" data-testid="cotizaciones-q" />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Estado</Label>
          <Select value={fEstado} onValueChange={setFEstado}>
            <SelectTrigger className="w-40 mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="cotizacion">Vigentes</SelectItem>
              <SelectItem value="convertida">Convertidas</SelectItem>
              <SelectItem value="cancelada">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {err && <div className="card-soft p-6 text-center text-red-600"><p className="mb-3">{err}</p><Button variant="outline" onClick={load}>Reintentar</Button></div>}
      {!err && loading && <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>}

      {!err && !loading && (
        <div className="card-soft overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="p-2">Folio</th><th className="p-2">Cliente</th><th className="p-2">Vendedor</th><th className="p-2">Fecha</th>
              <th className="p-2 text-right">Total</th><th className="p-2">Estado</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {filtradas.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">Sin cotizaciones.</td></tr>}
              {filtradas.map((c) => {
                const [cls, label] = ESTADOS[c.estado] || ["bg-slate-100 text-slate-600", c.estado];
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`cot-${c.folio}`}>
                    <td className="p-2 font-medium text-[#C1401E]">{c.folio}</td>
                    <td className="p-2">{c.cliente_nombre || "—"}</td>
                    <td className="p-2 text-slate-500">{c.vendedor_nombre || "—"}</td>
                    <td className="p-2 text-slate-500">{(c.fecha || "").slice(0, 10)}</td>
                    <td className="p-2 text-right font-semibold">{money(c.total)}</td>
                    <td className="p-2"><Badge className={cls}>{label}</Badge>{c.convertida_folio && <span className="ml-1 text-[10px] text-green-600">→ {c.convertida_folio}</span>}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setDet(c)}><Eye className="w-4 h-4" /></Button>
                      {c.estado === "cotizacion" && can("venta.crear") && (
                        <Button size="sm" className="bg-[#C1401E] hover:bg-[#A03316]" onClick={() => { setConv(c); setConvForm({ condicion: "contado", metodo: "efectivo", monto: "", vendedor_id: "" }); }} data-testid={`convertir-${c.folio}`}>
                          <ArrowRightCircle className="w-3.5 h-3.5 mr-1" /> Vender
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalle */}
      <Dialog open={!!det} onOpenChange={(o) => !o && setDet(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><FileText className="w-5 h-5 text-[#C1401E]" /> Cotización {det?.folio}</DialogTitle></DialogHeader>
          {det && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-slate-400">Cliente</Label><div className="font-semibold">{det.cliente_nombre || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Vendedor</Label><div>{det.vendedor_nombre || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Fecha</Label><div>{(det.fecha || "").slice(0, 16).replace("T", " ")}</div></div>
                <div><Label className="text-xs text-slate-400">Estado</Label><div className="capitalize">{det.estado}</div></div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                    <th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2 text-right">Cant.</th><th className="p-2 text-right">Precio</th><th className="p-2 text-right">Importe</th>
                  </tr></thead>
                  <tbody>
                    {(det.items || []).map((i, k) => (
                      <tr key={k} className="border-t border-slate-100">
                        <td className="p-2 font-mono text-[10px]">{i.codigo}</td>
                        <td className="p-2">{i.descripcion}</td>
                        <td className="p-2 text-right">{i.cantidad}</td>
                        <td className="p-2 text-right">{money(i.precio)}</td>
                        <td className="p-2 text-right font-semibold">{money(i.importe_bruto ?? i.cantidad * i.precio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end"><div className="w-56 space-y-1">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(det.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">IVA</span><span>{money(det.iva_total)}</span></div>
                <div className="flex justify-between font-bold border-t pt-1"><span>TOTAL</span><span>{money(det.total)}</span></div>
              </div></div>
              <DialogFooter><Button variant="outline" onClick={() => setDet(null)}>Cerrar</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Convertir a venta */}
      <Dialog open={!!conv} onOpenChange={(o) => !o && setConv(null)}>
        <DialogContent className="max-w-md" data-testid="convertir-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><ArrowRightCircle className="w-5 h-5 text-[#C1401E]" /> Convertir {conv?.folio} a venta</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="card-soft p-3 bg-amber-50"><div className="text-xs text-slate-500">Total de la cotización</div><div className="font-display text-xl font-black text-[#C1401E]">{money(conv?.total)}</div></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Condición</Label>
              <Select value={convForm.condicion} onValueChange={(v) => setConvForm((s) => ({ ...s, condicion: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="contado">Contado</SelectItem><SelectItem value="credito">Crédito</SelectItem></SelectContent>
              </Select>
            </div>
            {convForm.condicion === "contado" ? (
              <>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Método de pago</Label>
                  <Select value={convForm.metodo} onValueChange={(v) => setConvForm((s) => ({ ...s, metodo: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{METODOS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Monto cobrado</Label>
                  <Input type="number" value={convForm.monto} onChange={(e) => setConvForm((s) => ({ ...s, monto: e.target.value }))} className="mt-1" placeholder={String(conv?.total || 0)} />
                  <p className="text-[11px] text-slate-400 mt-1">Si es efectivo, entrará a tu caja abierta.</p>
                </div>
              </>
            ) : (
              <p className="text-xs text-amber-700 rounded-lg bg-amber-50 border border-amber-200 p-3">Se generará la venta a crédito del cliente {conv?.cliente_nombre} (requiere crédito autorizado).</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConv(null)}>Cancelar</Button>
              <Button onClick={convertir} disabled={convSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="confirmar-convertir">
                {convSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <><ArrowRightCircle className="w-4 h-4 mr-1" /> Convertir a venta</>}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}