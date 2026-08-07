import { useEffect, useState } from "react";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Smartphone, ExternalLink, Loader2, Receipt, MessageCircle, Printer, CheckCircle2 } from "lucide-react";

const TAE_URL = "https://recargastae.com/Account/SignIn.aspx";
const COMPANIAS = ["Telcel", "Movistar", "AT&T", "Unefon", "Bait", "Pillofon", "Weex", "Otra"];
const METODOS = [["efectivo", "Efectivo"], ["tarjeta", "Tarjeta"], ["transferencia", "Transferencia"]];
const MONTOS = [10, 20, 30, 50, 100, 150, 200, 300, 500];
const blank = () => ({ compania: "Telcel", telefono: "", monto: "", metodo: "efectivo", referencia_tae: "", comision: "" });

export default function Recargas() {
  const [f, setF] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [waPhone, setWaPhone] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState({});
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const loadHistory = async () => {
    try {
      const { data } = await api.get("/sales", { params: { rango: "hoy" } });
      setHistory((data || []).filter((s) => s.tipo_venta === "recarga").slice(0, 20));
    } catch { /* noop */ }
  };
  useEffect(() => { loadHistory(); api.get("/settings").then((r) => setSettings(r.data || {})).catch(() => {}); }, []);

  const openPortal = () => window.open(TAE_URL, "_blank", "noopener,noreferrer");

  const registrar = async () => {
    const monto = Number(f.monto);
    if (!monto || monto <= 0) return toast.error("Selecciona o escribe un monto válido");
    if (!f.telefono.trim()) return toast.error("Captura el número de teléfono");
    setSaving(true);
    try {
      const { data } = await api.post("/recargas", {
        compania: f.compania, telefono: f.telefono.trim(), monto,
        metodo: f.metodo, referencia_tae: f.referencia_tae.trim(), comision: Number(f.comision) || 0,
      });
      setTicket(data);
      setWaPhone(f.telefono.trim());
      toast.success(`Recarga ${data.folio} registrada`);
      setF(blank());
      loadHistory();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const sendWhatsApp = async () => {
    if (!ticket?.id) return;
    setWaSending(true);
    try {
      const { data } = await api.post(`/sales/${ticket.id}/ticket-pdf`);
      const url = fileUrl(data.url);
      const digits = (waPhone || "").replace(/\D/g, "");
      const phone = digits ? (digits.length === 10 ? "52" + digits : digits) : "";
      const msg = `Comprobante de recarga ${ticket.folio} · ${ticket.compania} · ${ticket.telefono}. Monto: ${money(ticket.total)}. ${url}`;
      window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setWaSending(false); }
  };

  return (
    <div className="space-y-5" data-testid="recargas-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><Smartphone className="w-6 h-6 text-[#0055A4]" /> Recargas de celular</h1>
          <p className="text-slate-500 text-sm">Realiza la recarga en el portal TAE y regístrala aquí para que entre a Caja y Ventas.</p>
        </div>
        <Button onClick={openPortal} className="bg-[#8B3A1A] hover:bg-[#733015] h-11" data-testid="recargas-open-portal">
          <ExternalLink className="w-4 h-4 mr-2" /> Abrir portal TAE
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Formulario de registro */}
        <div className="bg-white border border-slate-200 rounded-md p-5 space-y-4" data-testid="recargas-form">
          <div className="flex items-center gap-2 text-slate-700 font-semibold"><Receipt className="w-4 h-4 text-[#0055A4]" /> Confirmar / registrar recarga</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Compañía</Label>
              <Select value={f.compania} onValueChange={(v) => set("compania", v)}>
                <SelectTrigger className="mt-1" data-testid="recarga-compania"><SelectValue /></SelectTrigger>
                <SelectContent>{COMPANIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Teléfono</Label>
              <Input value={f.telefono} onChange={(e) => set("telefono", e.target.value.replace(/[^\d]/g, ""))} maxLength={10} className="mt-1" placeholder="10 dígitos" data-testid="recarga-telefono" />
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Monto</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {MONTOS.map((m) => (
                <button key={m} type="button" onClick={() => set("monto", m)} data-testid={`recarga-monto-${m}`}
                  className={`px-3 py-1.5 rounded-md border text-sm font-medium ${Number(f.monto) === m ? "border-[#0055A4] bg-[#0055A4]/5 text-[#0055A4]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>${m}</button>
              ))}
            </div>
            <Input type="number" value={f.monto} onChange={(e) => set("monto", e.target.value)} className="mt-2 max-w-[160px]" placeholder="Otro monto" data-testid="recarga-monto-input" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Método de pago</Label>
              <Select value={f.metodo} onValueChange={(v) => set("metodo", v)}>
                <SelectTrigger className="mt-1" data-testid="recarga-metodo"><SelectValue /></SelectTrigger>
                <SelectContent>{METODOS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Comisión / ganancia</Label>
              <Input type="number" value={f.comision} onChange={(e) => set("comision", e.target.value)} className="mt-1" placeholder="0.00" data-testid="recarga-comision" />
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Referencia TAE (folio del portal)</Label>
            <Input value={f.referencia_tae} onChange={(e) => set("referencia_tae", e.target.value)} className="mt-1" placeholder="Folio/autorización que arroja TAE" data-testid="recarga-referencia" />
          </div>
          <Button onClick={registrar} disabled={saving} className="w-full h-11 bg-[#FF5A00] hover:bg-[#E04F00] font-bold" data-testid="recarga-registrar">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-2" /> Registrar recarga en Caja</>}
          </Button>
        </div>

        {/* Portal + historial */}
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-md p-5">
            <div className="flex items-center gap-2 text-slate-700 font-semibold mb-2"><ExternalLink className="w-4 h-4 text-[#8B3A1A]" /> Portal del proveedor (TAE)</div>
            <p className="text-sm text-slate-500 mb-3">El portal de TAE requiere inicio de sesión y no permite incrustarse por seguridad. Ábrelo en una pestaña nueva, realiza la recarga y regrésate a registrarla aquí.</p>
            <Button onClick={openPortal} variant="outline" className="w-full" data-testid="recargas-open-portal-2"><ExternalLink className="w-4 h-4 mr-2" /> Ir a recargastae.com</Button>
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-700 font-semibold"><Receipt className="w-4 h-4 text-[#0055A4]" /> Recargas de hoy</div>
              <Badge variant="outline" data-testid="recargas-count">{history.length}</Badge>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
              {history.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">Aún no hay recargas hoy.</p>}
              {history.map((r) => (
                <div key={r.id} className="py-2 flex items-center justify-between text-sm" data-testid={`recarga-row-${r.folio}`}>
                  <div>
                    <div className="font-medium">{r.compania} · {r.telefono}</div>
                    <div className="text-xs text-slate-400">{r.folio} · {r.hora}</div>
                  </div>
                  <span className="font-semibold text-[#0055A4]">{money(r.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ticket / comprobante */}
      <Dialog open={!!ticket} onOpenChange={(o) => !o && setTicket(null)}>
        <DialogContent data-testid="recarga-ticket-dialog">
          <DialogHeader><DialogTitle className="font-display text-center">Comprobante de recarga</DialogTitle></DialogHeader>
          {ticket && (
            <div id="thermal-ticket" className="thermal font-mono text-[12px] text-black bg-white p-2 mx-auto">
              <div className="text-center">
                <div className="font-bold text-[14px]">{settings.empresa_nombre || "Grupo RYSA"}</div>
                {settings.telefono && <div>Tel: {settings.telefono}</div>}
              </div>
              <div className="border-t border-dashed border-black my-1" />
              <div>FOLIO: {ticket.folio}</div>
              <div>Fecha: {ticket.fecha?.slice(0, 16).replace("T", " ")}</div>
              <div>Compañía: {ticket.compania}</div>
              <div>Teléfono: {ticket.telefono}</div>
              {ticket.referencia_tae && <div>Ref. TAE: {ticket.referencia_tae}</div>}
              <div className="border-t border-dashed border-black my-1" />
              <div className="flex justify-between font-bold text-[14px]"><span>MONTO</span><span>{money(ticket.total)}</span></div>
              <div className="border-t border-dashed border-black my-1" />
              <div className="text-center text-[11px]">¡Gracias por su compra!</div>
            </div>
          )}
          <div className="border-t border-slate-200 pt-3 space-y-2">
            <Label className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5 text-green-600" /> Enviar comprobante por WhatsApp</Label>
            <div className="flex gap-2">
              <Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="Teléfono (10 dígitos)" className="h-10" data-testid="recarga-wa-phone" />
              <Button onClick={sendWhatsApp} disabled={waSending} className="h-10 bg-[#25D366] hover:bg-[#1ebe57] text-white whitespace-nowrap" data-testid="recarga-wa-send">
                {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><MessageCircle className="w-4 h-4 mr-1" /> Enviar PDF</>}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => window.print()} variant="outline" data-testid="recarga-print"><Printer className="w-4 h-4 mr-1" /> Imprimir</Button>
            <Button onClick={() => setTicket(null)} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="recarga-nueva">Nueva recarga</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
