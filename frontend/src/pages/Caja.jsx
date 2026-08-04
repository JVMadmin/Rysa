import { useEffect, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, Lock, Unlock, ArrowDownCircle, ArrowUpCircle, Loader2 } from "lucide-react";

export default function Caja() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fondo, setFondo] = useState("");
  const [movOpen, setMovOpen] = useState(false);
  const [mov, setMov] = useState({ tipo: "entrada", concepto: "", monto: "", referencia: "" });
  const [closeOpen, setCloseOpen] = useState(false);
  const [contado, setContado] = useState("");
  const [cierre, setCierre] = useState(null);

  const load = async () => { setLoading(true); const { data } = await api.get("/caja/actual"); setData(data); setLoading(false); };
  useEffect(() => { load(); }, []);

  const abrir = async () => {
    try { await api.post("/caja/abrir", { fondo_inicial: Number(fondo || 0) }); toast.success("Caja abierta"); setFondo(""); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const registrarMov = async () => {
    if (!mov.concepto.trim() || !mov.monto) return toast.error("Concepto y monto requeridos");
    try { await api.post("/caja/movimiento", { ...mov, monto: Number(mov.monto) }); toast.success("Movimiento registrado"); setMovOpen(false); setMov({ tipo: "entrada", concepto: "", monto: "", referencia: "" }); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const cerrar = async () => {
    try { const { data } = await api.post("/caja/cerrar", { efectivo_contado: Number(contado || 0) }); setCierre(data.cierre); setCloseOpen(false); toast.success("Caja cerrada"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#0055A4]" /></div>;

  const caja = data?.caja;
  const res = data?.resumen;

  return (
    <div className="space-y-5" data-testid="caja-page">
      <h1 className="font-display text-2xl font-black tracking-tight">Caja</h1>

      {!caja ? (
        <div className="bg-white border border-slate-200 rounded-md p-8 max-w-md">
          <div className="w-12 h-12 rounded-md bg-[#0055A4]/10 flex items-center justify-center mb-4"><Wallet className="w-6 h-6 text-[#0055A4]" /></div>
          <h2 className="font-display text-lg font-bold">No hay caja abierta</h2>
          <p className="text-slate-500 text-sm mb-4">Ingresa el fondo inicial para comenzar a operar.</p>
          <Label className="text-xs uppercase tracking-wider text-slate-500">Fondo inicial</Label>
          <Input type="number" value={fondo} onChange={(e) => setFondo(e.target.value)} className="mt-1 mb-4" data-testid="fondo-inicial" placeholder="0.00" />
          <Button onClick={abrir} className="w-full bg-[#0055A4] hover:bg-[#004385]" data-testid="abrir-caja-btn"><Unlock className="w-4 h-4 mr-2" /> Abrir caja</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge className="bg-green-100 text-green-700 text-sm px-3 py-1">Caja abierta · {caja.usuario_nombre}</Badge>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMovOpen(true)} data-testid="mov-caja-btn"><ArrowDownCircle className="w-4 h-4 mr-1" /> Movimiento</Button>
              <Button onClick={() => setCloseOpen(true)} className="bg-[#FF5A00] hover:bg-[#E04F00]" data-testid="cerrar-caja-btn"><Lock className="w-4 h-4 mr-1" /> Cerrar caja</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[["Fondo inicial", res.fondo_inicial], ["Ventas efectivo", res.ventas_efectivo], ["Entradas", res.entradas], ["Retiros", res.retiros], ["Devoluciones", res.devoluciones], ["Efectivo esperado", res.efectivo_esperado]].map(([l, v], i) => (
              <div key={i} className={`bg-white border rounded-md p-4 ${i === 5 ? "border-[#0055A4] ring-1 ring-[#0055A4]" : "border-slate-200"}`}>
                <div className="text-xs uppercase tracking-wider text-slate-500">{l}</div>
                <div className="font-display text-lg font-black mt-1">{money(v)}</div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Hora</th><th className="p-3">Tipo</th><th className="p-3">Concepto</th><th className="p-3">Ref</th><th className="p-3 text-right">Monto</th>
              </tr></thead>
              <tbody>
                {(data.movimientos || []).map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="p-3 text-slate-500">{m.fecha?.slice(11, 16)}</td>
                    <td className="p-3"><Badge variant="outline">{m.tipo}</Badge></td>
                    <td className="p-3">{m.concepto}</td><td className="p-3 text-slate-500">{m.referencia}</td>
                    <td className={`p-3 text-right font-semibold ${["retiro", "gasto", "devolucion"].includes(m.tipo) ? "text-red-600" : "text-green-600"}`}>{money(m.monto)}</td>
                  </tr>
                ))}
                {(data.movimientos || []).length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Sin movimientos aún.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cierre && (
        <div className="bg-white border border-slate-200 rounded-md p-5 max-w-md">
          <h3 className="font-display font-bold mb-3">Último corte</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Efectivo esperado</span><span className="font-semibold">{money(cierre.efectivo_esperado)}</span></div>
            <div className="flex justify-between"><span>Efectivo contado</span><span className="font-semibold">{money(cierre.efectivo_contado)}</span></div>
            <div className="flex justify-between text-base pt-2 border-t"><span>Diferencia</span><span className={`font-black ${cierre.diferencia < 0 ? "text-red-600" : "text-green-600"}`}>{money(cierre.diferencia)}</span></div>
          </div>
        </div>
      )}

      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent data-testid="mov-dialog">
          <DialogHeader><DialogTitle className="font-display">Movimiento de caja</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Tipo</Label>
              <Select value={mov.tipo} onValueChange={(v) => setMov((s) => ({ ...s, tipo: v }))}>
                <SelectTrigger className="mt-1" data-testid="mov-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada manual</SelectItem>
                  <SelectItem value="retiro">Retiro</SelectItem>
                  <SelectItem value="gasto">Gasto</SelectItem>
                  <SelectItem value="ajuste">Ajuste</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Concepto / Motivo</Label><Input value={mov.concepto} onChange={(e) => setMov((s) => ({ ...s, concepto: e.target.value }))} className="mt-1" data-testid="mov-concepto" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Monto</Label><Input type="number" value={mov.monto} onChange={(e) => setMov((s) => ({ ...s, monto: e.target.value }))} className="mt-1" data-testid="mov-monto" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Referencia</Label><Input value={mov.referencia} onChange={(e) => setMov((s) => ({ ...s, referencia: e.target.value }))} className="mt-1" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setMovOpen(false)}>Cancelar</Button><Button onClick={registrarMov} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="mov-save">Registrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent data-testid="close-dialog">
          <DialogHeader><DialogTitle className="font-display">Cerrar caja</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Efectivo esperado: <b>{money(res?.efectivo_esperado)}</b></p>
          <div><Label className="text-xs uppercase tracking-wider text-slate-500">Efectivo contado</Label><Input type="number" value={contado} onChange={(e) => setContado(e.target.value)} className="mt-1" data-testid="efectivo-contado" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setCloseOpen(false)}>Cancelar</Button><Button onClick={cerrar} className="bg-[#FF5A00] hover:bg-[#E04F00]" data-testid="confirm-cierre"><ArrowUpCircle className="w-4 h-4 mr-1" /> Confirmar cierre</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
