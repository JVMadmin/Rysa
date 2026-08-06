import { useEffect, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Stamp, FileText, Download, Ban, Send, Settings2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL + "/api";
const REGIMENES = [["601", "601 General de Ley Personas Morales"], ["612", "612 PF Actividad Empresarial"], ["616", "616 Sin obligaciones fiscales"], ["621", "621 Incorporación Fiscal"], ["626", "626 RESICO"]];
const MOTIVOS = [["02", "02 - Comprobante con errores sin relación"], ["01", "01 - Con errores con relación (requiere UUID)"], ["03", "03 - No se llevó a cabo la operación"], ["04", "04 - Operación nominativa (factura global)"]];

export default function Facturacion() {
  const { can } = useAuth();
  const puedeConfig = can("config");
  const [tab, setTab] = useState("emitidas");
  const [timbres, setTimbres] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [facturables, setFacturables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const loadTimbres = () => api.get("/facturacion/timbres").then((r) => setTimbres(r.data)).catch(() => {});
  const loadAll = async () => {
    setLoading(true);
    const [f, v] = await Promise.all([api.get("/facturacion"), api.get("/facturacion/facturables")]);
    setFacturas(f.data); setFacturables(v.data);
    if (puedeConfig) { try { const c = await api.get("/facturacion/config"); setCfg(c.data); } catch { /* */ } }
    setLoading(false);
  };
  useEffect(() => { loadTimbres(); loadAll(); /* eslint-disable-next-line */ }, []);

  const guardarConfig = async () => {
    setBusy("cfg");
    try {
      await api.put("/facturacion/config", { ...cfg, folio: Number(cfg.folio) || 1, timbres_alerta: Number(cfg.timbres_alerta) || 20 });
      toast.success("Configuración guardada");
      loadTimbres();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  const facturar = async (sale) => {
    setBusy(sale.id);
    try {
      const { data } = await api.post(`/facturacion/sale/${sale.id}`);
      toast.success(`CFDI emitido · UUID ${data.uuid || "(sandbox)"}`);
      loadTimbres(); loadAll();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  const cancelar = async (f) => {
    const motivo = window.prompt("Motivo de cancelación (01/02/03/04):", "02");
    if (!motivo) return;
    let uuidRep = null;
    if (motivo === "01") uuidRep = window.prompt("UUID de reemplazo:", "") || null;
    setBusy(f.id);
    try {
      const params = new URLSearchParams({ motivo }); if (uuidRep) params.set("uuid_reemplazo", uuidRep);
      await api.post(`/facturacion/${f.id}/cancel?${params.toString()}`);
      toast.success("CFDI cancelado");
      loadAll();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  const descargar = (f, fmt) => window.open(`${API}/facturacion/${f.id}/${fmt}`, "_blank");
  const whatsapp = (f) => {
    const msg = encodeURIComponent(`Hola ${f.cliente_nombre}, aquí está su factura ${f.serie || ""}${f.folio || ""} (UUID: ${f.uuid || "pendiente"}) por ${money(f.total)}. Adjuntamos el PDF y XML.`);
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  return (
    <div className="space-y-5" data-testid="facturacion-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Facturación CFDI 4.0</h1>
          <p className="text-slate-500 text-sm">Timbrado de ventas mediante PAC (Facturama)</p></div>
        {timbres && (
          timbres.configurado ? (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${timbres.alerta ? "bg-red-50 border border-red-200" : "bg-emerald-50 border border-emerald-200"}`} data-testid="timbres-panel">
              <Stamp className={`w-5 h-5 ${timbres.alerta ? "text-red-600" : "text-emerald-600"}`} />
              <div><div className="text-xs text-slate-400">Timbres disponibles</div>
                <div className={`font-display font-bold text-lg ${timbres.alerta ? "text-red-700" : "text-emerald-700"}`}>{timbres.disponibles ?? "—"}</div></div>
              {timbres.plan && <span className="text-xs text-slate-400 ml-2">{timbres.plan}</span>}
              <Button size="icon" variant="ghost" onClick={loadTimbres} data-testid="timbres-refresh"><RefreshCw className="w-4 h-4" /></Button>
            </div>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-300" data-testid="pac-no-config"><AlertTriangle className="w-3.5 h-3.5 mr-1" /> PAC sin configurar</Badge>
          )
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="emitidas" data-testid="tab-emitidas">Facturas emitidas</TabsTrigger>
          <TabsTrigger value="facturar" data-testid="tab-facturar">Por facturar</TabsTrigger>
          {puedeConfig && <TabsTrigger value="config" data-testid="tab-config-pac"><Settings2 className="w-4 h-4 mr-1" /> Configuración</TabsTrigger>}
        </TabsList>

        {/* Facturas emitidas */}
        <TabsContent value="emitidas" className="pt-3">
          <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Folio venta</th><th className="p-3">Serie-Folio</th><th className="p-3">UUID</th><th className="p-3">Cliente</th><th className="p-3">RFC</th>
                <th className="p-3 text-right">Total</th><th className="p-3 text-center">Estado</th><th className="p-3">Fecha</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#0055A4]" /></td></tr>}
                {!loading && facturas.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-slate-400"><FileText className="w-8 h-8 mx-auto mb-2" />Sin facturas emitidas.</td></tr>}
                {!loading && facturas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`cfdi-row-${f.folio_venta}`}>
                    <td className="p-3 font-medium text-[#0055A4]">{f.folio_venta}</td>
                    <td className="p-3">{f.serie}{f.folio}</td>
                    <td className="p-3 text-xs text-slate-500 max-w-[180px] truncate" title={f.uuid}>{f.uuid || "—"}</td>
                    <td className="p-3 max-w-[180px] truncate">{f.cliente_nombre}</td>
                    <td className="p-3 text-slate-500">{f.rfc}</td>
                    <td className="p-3 text-right font-semibold">{money(f.total)}</td>
                    <td className="p-3 text-center">{f.status === "cancelado" ? <Badge className="bg-red-100 text-red-700">Cancelado</Badge> : <Badge className="bg-green-100 text-green-700">Vigente</Badge>}</td>
                    <td className="p-3 text-slate-500">{(f.fecha || "").slice(0, 10)}</td>
                    <td className="p-3">
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" onClick={() => descargar(f, "pdf")} title="PDF" data-testid={`cfdi-pdf-${f.folio_venta}`}><Download className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => descargar(f, "xml")} title="XML" data-testid={`cfdi-xml-${f.folio_venta}`}><FileText className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => whatsapp(f)} title="WhatsApp" data-testid={`cfdi-wa-${f.folio_venta}`}><Send className="w-4 h-4 text-emerald-600" /></Button>
                        {f.status !== "cancelado" && can("venta.cancelar") && <Button size="icon" variant="ghost" onClick={() => cancelar(f)} title="Cancelar" data-testid={`cfdi-cancel-${f.folio_venta}`}><Ban className="w-4 h-4 text-red-500" /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Por facturar */}
        <TabsContent value="facturar" className="pt-3">
          <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Folio</th><th className="p-3">Fecha</th><th className="p-3">Cliente</th><th className="p-3 text-right">Total</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={5} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#0055A4]" /></td></tr>}
                {!loading && facturables.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-slate-400"><CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />No hay ventas pendientes de facturar.</td></tr>}
                {!loading && facturables.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`facturable-${s.folio}`}>
                    <td className="p-3 font-medium text-[#0055A4]">{s.folio}</td>
                    <td className="p-3 text-slate-500">{(s.fecha || "").slice(0, 10)}</td>
                    <td className="p-3">{s.cliente_nombre || "Público General"}</td>
                    <td className="p-3 text-right font-semibold">{money(s.total)}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" className="bg-[#0055A4] hover:bg-[#004385]" disabled={busy === s.id} onClick={() => facturar(s)} data-testid={`facturar-${s.folio}`}>
                        {busy === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Stamp className="w-4 h-4 mr-1" /> Facturar</>}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Configuración PAC */}
        {puedeConfig && (
          <TabsContent value="config" className="pt-3">
            {!cfg ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-[#0055A4]" /></div> : (
              <div className="bg-white border border-slate-200 rounded-md p-5 max-w-3xl space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">PAC</Label>
                    <Select value={cfg.provider || "facturama"} onValueChange={(v) => setCfg({ ...cfg, provider: v })}>
                      <SelectTrigger className="mt-1" data-testid="cfg-provider"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="facturama">Facturama</SelectItem></SelectContent>
                    </Select></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Entorno</Label>
                    <Select value={cfg.environment || "sandbox"} onValueChange={(v) => setCfg({ ...cfg, environment: v })}>
                      <SelectTrigger className="mt-1" data-testid="cfg-env"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="sandbox">Sandbox (pruebas)</SelectItem><SelectItem value="produccion">Producción</SelectItem></SelectContent>
                    </Select></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Usuario API</Label>
                    <Input value={cfg.api_user || ""} onChange={(e) => setCfg({ ...cfg, api_user: e.target.value })} className="mt-1" data-testid="cfg-user" /></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Contraseña API {cfg.api_password_set && <span className="text-emerald-600">✓ guardada</span>}</Label>
                    <Input type="password" placeholder={cfg.api_password_set ? "•••••• (sin cambios)" : ""} onChange={(e) => setCfg({ ...cfg, api_password: e.target.value })} className="mt-1" data-testid="cfg-pass" /></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">RFC emisor</Label>
                    <Input value={cfg.rfc || ""} onChange={(e) => setCfg({ ...cfg, rfc: e.target.value.toUpperCase() })} className="mt-1" data-testid="cfg-rfc" /></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Razón social</Label>
                    <Input value={cfg.razon_social || ""} onChange={(e) => setCfg({ ...cfg, razon_social: e.target.value })} className="mt-1" data-testid="cfg-razon" /></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Régimen fiscal</Label>
                    <Select value={cfg.regimen_fiscal || "601"} onValueChange={(v) => setCfg({ ...cfg, regimen_fiscal: v })}>
                      <SelectTrigger className="mt-1" data-testid="cfg-regimen"><SelectValue /></SelectTrigger>
                      <SelectContent>{REGIMENES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Serie</Label>
                    <Input value={cfg.serie || ""} onChange={(e) => setCfg({ ...cfg, serie: e.target.value })} className="mt-1" data-testid="cfg-serie" /></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Folio inicial</Label>
                    <Input type="number" value={cfg.folio ?? 1} onChange={(e) => setCfg({ ...cfg, folio: e.target.value })} className="mt-1" data-testid="cfg-folio" /></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Lugar de expedición (CP)</Label>
                    <Input value={cfg.lugar_expedicion || ""} onChange={(e) => setCfg({ ...cfg, lugar_expedicion: e.target.value })} className="mt-1" data-testid="cfg-cp" /></div>
                  <div><Label className="text-xs uppercase tracking-wider text-slate-500">Alerta de timbres (mínimo)</Label>
                    <Input type="number" value={cfg.timbres_alerta ?? 20} onChange={(e) => setCfg({ ...cfg, timbres_alerta: e.target.value })} className="mt-1" data-testid="cfg-alerta" /></div>
                </div>
                <div className="text-xs text-slate-400 bg-slate-50 rounded p-3">
                  Los certificados CSD (.cer/.key) se cargan directamente en tu cuenta de Facturama. Aquí solo se guardan las credenciales de API. La contraseña se almacena de forma segura y no se muestra.
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={guardarConfig} disabled={busy === "cfg"} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="cfg-guardar">{busy === "cfg" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar configuración"}</Button>
                  {cfg.configurado ? <Badge className="bg-green-100 text-green-700"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> PAC listo</Badge> : <Badge variant="outline" className="text-amber-600 border-amber-300">Faltan credenciales</Badge>}
                </div>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
