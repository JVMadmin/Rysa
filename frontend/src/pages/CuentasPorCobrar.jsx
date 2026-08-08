import { useEffect, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Search, HandCoins, Receipt, Wallet, AlertTriangle, Users, CheckCircle2, Clock } from "lucide-react";

const METODOS = [["efectivo", "Efectivo"], ["tarjeta", "Tarjeta"], ["transferencia", "Transferencia"], ["deposito", "Depósito"], ["otros", "Otros"]];

const Card = ({ label, value, icon: Ic, iconCls = "text-slate-500", valueCls = "text-slate-700", testid }) => (
  <div className="bg-white border border-slate-200 rounded-md p-4" data-testid={testid}>
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <Ic className={`w-4 h-4 ${iconCls}`} />
    </div>
    <div className={`font-display font-black text-2xl mt-1 ${valueCls}`}>{value}</div>
  </div>
);

export default function CuentasPorCobrar() {
  const { can } = useAuth();
  const [data, setData] = useState({ totales: {}, clientes: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const puedeCobrar = can("caja.entrada");

  // Abono
  const [abonoCli, setAbonoCli] = useState(null);
  const [abono, setAbono] = useState({ monto: "", metodo: "efectivo", referencia: "", nota: "" });
  const [saving, setSaving] = useState(false);
  // Detalle
  const [detCli, setDetCli] = useState(null);
  const [detalle, setDetalle] = useState(null);

  const load = async () => {
    setLoading(true);
    const params = {};
    if (q) params.q = q;
    if (soloVencidos) params.solo_vencidos = true;
    const { data } = await api.get("/cxc", { params });
    setData(data); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [soloVencidos]);

  const openAbono = (c) => { setAbonoCli(c); setAbono({ monto: "", metodo: "efectivo", referencia: "", nota: "" }); };
  const guardarAbono = async () => {
    const monto = Number(abono.monto);
    if (!monto || monto <= 0) return toast.error("Ingresa un monto válido");
    setSaving(true);
    try {
      const { data } = await api.post(`/cxc/${abonoCli.cliente_id}/abono`, { ...abono, monto });
      toast.success(`Abono ${data.folio} · saldo actual ${money(data.saldo_actual)}${data.caja_afectada ? " · entró a caja" : ""}`);
      setAbonoCli(null); load();
      if (detCli && detCli.cliente_id === abonoCli.cliente_id) openDetalle(abonoCli);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const openDetalle = async (c) => {
    setDetCli(c); setDetalle(null);
    const { data } = await api.get(`/cxc/${c.cliente_id}`);
    setDetalle(data);
  };

  const t = data.totales || {};

  return (
    <div className="space-y-5" data-testid="cxc-page">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight">Cuentas por Cobrar</h1>
        <p className="text-slate-500 text-sm">Saldos de clientes a crédito, abonos y antigüedad de adeudos</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Cartera total" value={money(t.cartera || 0)} icon={Wallet} iconCls="text-slate-500" valueCls="text-slate-800" testid="cxc-cartera" />
        <Card label="Por vencer" value={money(t.por_vencer || 0)} icon={Clock} iconCls="text-blue-500" valueCls="text-blue-700" testid="cxc-porvencer" />
        <Card label="Vencido" value={money(t.vencido || 0)} icon={AlertTriangle} iconCls="text-red-500" valueCls="text-red-700" testid="cxc-vencido" />
        <Card label="Clientes con adeudo" value={t.clientes || 0} icon={Users} iconCls="text-amber-500" valueCls="text-amber-700" testid="cxc-nclientes" />
      </div>

      {/* Antigüedad global */}
      <div className="bg-white border border-slate-200 rounded-md p-4">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Antigüedad de saldos</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
          {[["corriente", "Corriente", "text-green-700"], ["b1_30", "1-30 días", "text-amber-600"],
            ["b31_60", "31-60 días", "text-orange-600"], ["b61_90", "61-90 días", "text-red-500"],
            ["b90", "+90 días", "text-red-700"]].map(([k, l, cls]) => (
            <div key={k} className="bg-slate-50 rounded-md p-3" data-testid={`cxc-aging-${k}`}>
              <div className="text-[11px] text-slate-400">{l}</div>
              <div className={`font-display font-bold ${cls}`}>{money(t[k] || 0)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 bg-white border border-slate-200 rounded-md p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar por nombre o clave de cliente..." value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="pl-9" data-testid="cxc-buscar" />
        </div>
        <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3">
          <span className="text-sm text-slate-600">Solo vencidos</span>
          <Switch checked={soloVencidos} onCheckedChange={setSoloVencidos} data-testid="cxc-solo-vencidos" />
        </div>
        <Button variant="outline" onClick={load} data-testid="cxc-refrescar"><Search className="w-4 h-4" /></Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Cliente</th><th className="p-3">Contacto</th>
            <th className="p-3 text-right">Saldo</th><th className="p-3 text-right">Vencido</th>
            <th className="p-3 text-right">Corriente</th><th className="p-3 text-right">1-30</th><th className="p-3 text-right">31-60</th>
            <th className="p-3 text-right">61-90</th><th className="p-3 text-right">+90</th><th className="p-3 text-center">Días</th>
            <th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={11} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#B95A3A]" /></td></tr>}
            {!loading && data.clientes.length === 0 && <tr><td colSpan={11} className="p-10 text-center text-slate-400"><CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />Sin cuentas por cobrar. ¡Todo al día!</td></tr>}
            {!loading && data.clientes.map((c) => (
              <tr key={c.cliente_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`cxc-row-${c.codigo}`}>
                <td className="p-3"><div className="font-medium text-[#B95A3A]">{c.codigo}</div><div className="text-slate-700 max-w-[200px] truncate" title={c.nombre}>{c.nombre}</div></td>
                <td className="p-3 text-slate-500 text-xs">{c.telefono || c.celular || "—"}</td>
                <td className="p-3 text-right font-semibold">{money(c.saldo)}</td>
                <td className={`p-3 text-right font-semibold ${c.vencido > 0 ? "text-red-600" : "text-slate-300"}`}>{money(c.vencido)}</td>
                <td className="p-3 text-right text-slate-500">{money(c.aging.corriente)}</td>
                <td className="p-3 text-right text-amber-600">{c.aging.b1_30 ? money(c.aging.b1_30) : "—"}</td>
                <td className="p-3 text-right text-orange-600">{c.aging.b31_60 ? money(c.aging.b31_60) : "—"}</td>
                <td className="p-3 text-right text-red-500">{c.aging.b61_90 ? money(c.aging.b61_90) : "—"}</td>
                <td className="p-3 text-right text-red-700">{c.aging.b90 ? money(c.aging.b90) : "—"}</td>
                <td className="p-3 text-center">{c.max_dias > 0 ? <Badge className="bg-red-100 text-red-700">{c.max_dias}d</Badge> : <Badge className="bg-green-100 text-green-700">al día</Badge>}</td>
                <td className="p-3">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="outline" onClick={() => openDetalle(c)} data-testid={`cxc-detalle-${c.codigo}`}><Receipt className="w-4 h-4 mr-1" /> Ver</Button>
                    {puedeCobrar && <Button size="sm" className="bg-[#B95A3A] hover:bg-[#8B3A2A]" onClick={() => openAbono(c)} data-testid={`cxc-abonar-${c.codigo}`}><HandCoins className="w-4 h-4 mr-1" /> Abonar</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Diálogo de abono */}
      <Dialog open={!!abonoCli} onOpenChange={(o) => !o && setAbonoCli(null)}>
        <DialogContent data-testid="abono-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><HandCoins className="w-5 h-5 text-[#B95A3A]" /> Registrar abono</DialogTitle></DialogHeader>
          {abonoCli && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-md p-3 flex items-center justify-between">
                <div><div className="text-xs text-slate-400">{abonoCli.codigo}</div><div className="font-semibold">{abonoCli.nombre}</div></div>
                <div className="text-right"><div className="text-xs text-slate-400">Saldo actual</div><div className="font-display font-bold text-red-600">{money(abonoCli.saldo)}</div></div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Monto del abono</Label>
                <div className="flex gap-2 mt-1">
                  <Input type="number" value={abono.monto} onChange={(e) => setAbono((s) => ({ ...s, monto: e.target.value }))} placeholder="0.00" data-testid="abono-monto" />
                  <Button variant="outline" onClick={() => setAbono((s) => ({ ...s, monto: String(abonoCli.saldo) }))} data-testid="abono-saldo-total">Saldo total</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Método de pago</Label>
                <Select value={abono.metodo} onValueChange={(v) => setAbono((s) => ({ ...s, metodo: v }))}>
                  <SelectTrigger className="mt-1" data-testid="abono-metodo"><SelectValue /></SelectTrigger>
                  <SelectContent>{METODOS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
                {abono.metodo === "efectivo" && <p className="text-[11px] text-slate-400 mt-1">El efectivo entrará a tu caja abierta (si tienes una).</p>}
              </div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Referencia</Label>
                <Input value={abono.referencia} onChange={(e) => setAbono((s) => ({ ...s, referencia: e.target.value }))} className="mt-1" placeholder="No. de recibo / operación" data-testid="abono-referencia" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Nota</Label>
                <Textarea value={abono.nota} onChange={(e) => setAbono((s) => ({ ...s, nota: e.target.value }))} className="mt-1" data-testid="abono-nota" /></div>
              <p className="text-xs text-slate-400">El abono se aplica automáticamente a las ventas más antiguas primero (FIFO).</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbonoCli(null)}>Cancelar</Button>
            <Button onClick={guardarAbono} disabled={saving} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="abono-guardar">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Registrar abono"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de detalle / estado de cuenta */}
      <Dialog open={!!detCli} onOpenChange={(o) => !o && setDetCli(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="detalle-dialog">
          <DialogHeader><DialogTitle className="font-display">Estado de cuenta · {detCli?.nombre}</DialogTitle></DialogHeader>
          {!detalle ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-[#B95A3A]" /></div> : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Saldo</div><div className="font-display font-bold text-red-600">{money(detalle.cliente.saldo)}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Límite</div><div className="font-display font-bold">{money(detalle.cliente.limite_credito)}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Días crédito</div><div className="font-display font-bold">{detalle.cliente.dias_credito}</div></div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Ventas a crédito</div>
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50"><tr className="text-left text-slate-500 uppercase tracking-wider">
                      <th className="p-2">Folio</th><th className="p-2">Fecha</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Saldo</th><th className="p-2">Vence</th><th className="p-2 text-center">Estado</th>
                    </tr></thead>
                    <tbody>
                      {detalle.ventas.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Sin ventas a crédito.</td></tr>}
                      {detalle.ventas.map((v) => (
                        <tr key={v.id} className="border-t border-slate-100">
                          <td className="p-2 font-medium">{v.folio}</td>
                          <td className="p-2 text-slate-500">{(v.fecha || "").slice(0, 10)}</td>
                          <td className="p-2 text-right">{money(v.total)}</td>
                          <td className={`p-2 text-right font-semibold ${v.saldo > 0 ? "text-red-600" : "text-green-600"}`}>{money(v.saldo)}</td>
                          <td className="p-2 text-slate-500">{v.vence}</td>
                          <td className="p-2 text-center">
                            {v.pagada ? <Badge className="bg-green-100 text-green-700">Pagada</Badge>
                              : v.dias_vencido > 0 ? <Badge className="bg-red-100 text-red-700">Vencida {v.dias_vencido}d</Badge>
                                : <Badge className="bg-blue-100 text-blue-700">Vigente</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Historial de abonos</div>
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50"><tr className="text-left text-slate-500 uppercase tracking-wider">
                      <th className="p-2">Folio</th><th className="p-2">Fecha</th><th className="p-2 text-right">Monto</th><th className="p-2">Método</th><th className="p-2">Referencia</th>
                    </tr></thead>
                    <tbody>
                      {detalle.abonos.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">Aún no hay abonos.</td></tr>}
                      {detalle.abonos.map((a) => (
                        <tr key={a.id} className="border-t border-slate-100">
                          <td className="p-2 font-medium">{a.folio}</td>
                          <td className="p-2 text-slate-500">{(a.fecha || "").slice(0, 10)}</td>
                          <td className="p-2 text-right font-semibold text-green-700">{money(a.monto)}</td>
                          <td className="p-2 capitalize">{a.metodo}</td>
                          <td className="p-2 text-slate-500">{a.referencia || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {detCli && puedeCobrar && detalle && detalle.cliente.saldo > 0 &&
              <Button className="bg-[#B95A3A] hover:bg-[#8B3A2A]" onClick={() => { setDetCli(null); openAbono(detCli); }} data-testid="detalle-abonar"><HandCoins className="w-4 h-4 mr-1" /> Registrar abono</Button>}
            <Button variant="outline" onClick={() => setDetCli(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
