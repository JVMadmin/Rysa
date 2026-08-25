import { useEffect, useRef, useState } from "react";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Smartphone, ExternalLink, Loader2, Receipt, MessageCircle, Printer,
  CheckCircle2, Wrench,
} from "lucide-react";

const TAE_URL = "https://recargastae.com/Account/SignIn.aspx";
const TODOCELL_URL = "https://www.todocell.mx/";
const COMPANIAS = ["Telcel", "Movistar", "AT&T", "Unefon", "Bait", "Pillofon", "Weex", "Otra"];
const METODOS = [["efectivo", "Efectivo"], ["tarjeta", "Tarjeta"], ["transferencia", "Transferencia"]];
const MONTOS = [10, 20, 30, 50, 100, 150, 200, 300, 500];
const blank = () => ({ compania: "Telcel", telefono: "", monto: "", metodo: "efectivo", referencia_tae: "", comision: "" });

/**
 * RECARGAS Y SERVICIOS — dos submódulos:
 *  · Recargas: portal TAE + registro (entra a Caja/Ventas) con comprobante
 *    PDF oficial (mismo generador único) para imprimir en POS80 y WhatsApp.
 *  · Servicios: acceso al portal de TODOCELL para pago de servicios.
 */
export default function Recargas() {
  const [tab, setTab] = useState("recargas");

  const [f, setF] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [waPhone, setWaPhone] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState({});
  const ticketPdfRef = useRef("");   // URL del PDF oficial de la recarga actual
  const blobRef = useRef(null);      // blob precargado → 1 solo clic
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const loadHistory = async () => {
    try {
      const { data } = await api.get("/sales", { params: { rango: "hoy" } });
      setHistory((data || []).filter((s) => s.tipo_venta === "recarga").slice(0, 20));
    } catch { /* noop */ }
  };
  useEffect(() => {
    loadHistory();
    api.get("/settings").then((r) => setSettings(r.data || {})).catch(() => {});
  }, []);

  // Precarga del comprobante oficial (URL + blob): el clic en WhatsApp envía
  // INMEDIATAMENTE sin esperar generación (fix: antes pedía 2 clics).
  const warmComprobante = async (saleId) => {
    try {
      const { data } = await api.post(`/sales/${saleId}/ticket-pdf`);
      ticketPdfRef.current = data.url || "";
      const resp = await api.get(data.url.replace(/^.*\/api\/files\//, "/files/"), { responseType: "blob" });
      blobRef.current = resp.data;
    } catch { /* el envío reintenta bajo demanda */ }
  };

  const openPortal = (url, name) => {
    const w = window.open(url, name, "width=1000,height=760,left=80,top=60,resizable=yes,scrollbars=yes");
    if (w) w.focus();
  };

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
      warmComprobante(data.id); // segundo plano: listo para WhatsApp/Imprimir
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const descargarBlob = (blob, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  };

  const getBlob = async () => {
    if (blobRef.current) return blobRef.current;
    if (!ticketPdfRef.current && ticket?.id) await warmComprobante(ticket.id);
    if (!ticketPdfRef.current) throw new Error("sin_pdf");
    return prefetch(ticketPdfRef.current);
  };

  const prefetch = async (pdfUrl) => {
    const resp = await api.get(pdfUrl.replace(/^.*\/api\/files\//, "/files/"), { responseType: "blob" });
    blobRef.current = resp.data;
    return resp.data;
  };

  const sendWhatsApp = async () => {
    if (!ticket?.id) return;
    setWaSending(true);
    try {
      let blob = null;
      try { blob = await getBlob(); } catch { /* fallback a enlace */ }
      const digits = (waPhone || "").replace(/\D/g, "");
      const phone = digits ? (digits.length === 10 ? "52" + digits : digits) : "";
      const texto = `Comprobante de recarga ${ticket.folio} · ${ticket.compania} · ${ticket.telefono}. Monto: ${money(ticket.total)}.`;
      if (blob && navigator.canShare && navigator.share && navigator.canShare({ files: [new File([blob], `recarga-${ticket.folio}.pdf`, { type: "application/pdf" })] })) {
        await navigator.share({
          title: `Recarga ${ticket.folio}`, text: texto,
          files: [new File([blob], `recarga-${ticket.folio}.pdf`, { type: "application/pdf" })],
        });
        toast.success("PDF compartido. Selecciona WhatsApp si no se abrió directo.");
        return;
      }
      const link = ticketPdfRef.current ? fileUrl(ticketPdfRef.current) : `${window.location.origin}/verificar/${ticket.id}`;
      const msg = `${texto} ${link}`;
      window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
      if (blob) descargarBlob(blob, `recarga-${ticket.folio}.pdf`);
    } catch (e) {
      if (e?.name !== "AbortError") toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally { setWaSending(false); }
  };

  // Impresión POS80 del comprobante OFICIAL (vista @page 80mm auto-print).
  const imprimirPos80 = () => {
    if (!ticket?.id) return;
    const f = document.createElement("iframe");
    f.style.position = "fixed";
    f.style.right = "0"; f.style.bottom = "0";
    f.style.width = "1px"; f.style.height = "1px"; f.style.border = "0";
    f.src = `/api/sales/${ticket.id}/ticket-print`;
    document.body.appendChild(f);
  };

  const tabBtn = (id, label, Icono) => (
    <button onClick={() => setTab(id)} data-testid={`rs-tab-${id}`}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
        tab === id ? "bg-[#C1401E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
      <Icono className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <div className="space-y-5" data-testid="recargas-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-[#C1401E]" /> Recargas y Servicios
          </h1>
          <p className="text-slate-500 text-sm">Recargas de celular (TAE) y pago de servicios (TODOCELL)</p>
        </div>
      </div>

      {/* Submódulos */}
      <div className="flex rounded-md overflow-hidden border border-slate-200 w-fit">
        {tabBtn("recargas", "Recargas", Smartphone)}
        {tabBtn("servicios", "Servicios · TODOCELL", Wrench)}
      </div>

      {tab === "recargas" && (
        <>
          <div className="flex justify-end">
            <Button onClick={() => openPortal(TAE_URL, "taePortal")} className="bg-[#8B3A1A] hover:bg-[#733015] h-10" data-testid="recargas-open-portal">
              <ExternalLink className="w-4 h-4 mr-2" /> Abrir portal TAE
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Formulario de registro */}
            <div className="card-soft p-5 space-y-4" data-testid="recargas-form">
              <div className="flex items-center gap-2 text-slate-700 font-semibold"><Receipt className="w-4 h-4 text-[#C1401E]" /> Confirmar / registrar recarga</div>
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
                      className={`px-3 py-1.5 rounded-md border text-sm font-medium ${Number(f.monto) === m ? "border-[#C1401E] bg-[#C1401E]/5 text-[#C1401E]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>${m}</button>
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
              <Button onClick={registrar} disabled={saving} className="w-full h-11 bg-[#C1401E] hover:bg-[#A03316] font-bold" data-testid="recarga-registrar">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-2" /> Registrar recarga en Caja</>}
              </Button>
            </div>

            {/* Portal + historial */}
            <div className="space-y-5">
              <div className="card-soft p-5">
                <div className="flex items-center gap-2 text-slate-700 font-semibold mb-2"><ExternalLink className="w-4 h-4 text-[#8B3A1A]" /> Portal del proveedor (TAE)</div>
                <p className="text-sm text-slate-500 mb-3">El portal requiere inicio de sesión y no permite incrustarse por seguridad. Se abre en una ventana que puedes cerrar al terminar la recarga.</p>
                <Button onClick={() => openPortal(TAE_URL, "taePortal")} variant="outline" className="w-full" data-testid="recargas-open-portal-2"><ExternalLink className="w-4 h-4 mr-2" /> Ir a recargastae.com</Button>
              </div>

              <div className="card-soft p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-slate-700 font-semibold"><Receipt className="w-4 h-4 text-[#C1401E]" /> Recargas de hoy</div>
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
                      <span className="font-semibold text-[#C1401E]">{money(r.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "servicios" && (
        <div className="space-y-5" data-testid="servicios-tab">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card-soft p-6 space-y-3">
              <div className="flex items-center gap-2 text-slate-800 font-bold"><Wrench className="w-5 h-5 text-[#C1401E]" /> Pago de servicios con TODOCELL</div>
              <p className="text-sm text-slate-500">
                Luz, agua, internet, telefonía, televisión y más a través del portal de TODOCELL.
                Realiza el cobro en el portal y registra el ingreso en Caja para que quede en Ventas.
              </p>
              <ul className="text-sm text-slate-500 list-disc ml-5 space-y-1">
                <li>CFE, acueductos, internet y TV de pago</li>
                <li>Telefonía fija y planes adicionales</li>
                <li>Consultas de saldo y referencia</li>
              </ul>
              <Button onClick={() => openPortal(TODOCELL_URL, "todocellPortal")} className="w-full h-11 bg-[#C1401E] hover:bg-[#A03316] font-bold" data-testid="servicios-open-todocell">
                <ExternalLink className="w-4 h-4 mr-2" /> Abrir portal TODOCELL
              </Button>
            </div>

            <div className="card-soft p-5">
              <div className="flex items-center gap-2 text-slate-700 font-semibold mb-2"><ExternalLink className="w-4 h-4 text-[#8B3A1A]" /> Accesos rápidos</div>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start" onClick={() => openPortal(TODOCELL_URL, "todocellPortal")}>
                  <ExternalLink className="w-4 h-4 mr-2 text-[#C1401E]" /> todocell.mx — inicio de sesión
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={() => openPortal(TAE_URL, "taePortal")}>
                  <ExternalLink className="w-4 h-4 mr-2 text-[#8B3A1A]" /> recargastae.com — recargas
                </Button>
              </div>
              <p className="text-[11px] text-slate-400 mt-3">
                Ambos portales se abren en ventana independiente por políticas de seguridad de los proveedores.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Ticket / comprobante */}
      <Dialog open={!!ticket} onOpenChange={(o) => !o && setTicket(null)}>
        <DialogContent data-testid="recarga-ticket-dialog">
          <DialogHeader><DialogTitle className="font-display text-center">Comprobante de recarga</DialogTitle></DialogHeader>
          {ticket && (
            <div id="thermal-ticket" className="thermal font-mono text-[12px] text-black bg-white p-2 mx-auto">
              <div className="text-center">
                <img src={settings.logo_url ? fileUrl(settings.logo_url) : "/brand/isotipo1.png"} alt="logo" className="h-12 mx-auto mb-1 object-contain" />
                <div className="font-bold text-[11px]">RAYMUNDO GOMEZ DIAZ</div>
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
              {ticket.id && (
                <div className="text-center">
                  <img src={`${process.env.REACT_APP_BACKEND_URL}/api/sales/${ticket.id}/qr?destino=${encodeURIComponent(`${window.location.origin}/verificar/${ticket.id}`)}`} alt="QR de verificación"
                    className="mx-auto w-24 h-24" />
                  <div className="text-[9px] text-slate-500">{window.location.origin}/verificar/{ticket.id}</div>
                </div>
              )}
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
            <p className="text-[11px] text-slate-400">Se adjunta el PDF oficial del comprobante (un clic). Si tu equipo no permite adjuntar, se descarga y abre WhatsApp con el enlace.</p>
          </div>
          <DialogFooter>
            <Button onClick={imprimirPos80} variant="outline" data-testid="recarga-print"><Printer className="w-4 h-4 mr-1" /> Imprimir POS80</Button>
            <Button onClick={() => setTicket(null)} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="recarga-nueva">Nueva recarga</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
