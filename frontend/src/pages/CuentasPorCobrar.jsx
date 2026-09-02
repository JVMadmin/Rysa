import { useEffect, useState } from "react";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useBranding } from "@/hooks/useBranding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Search, HandCoins, Receipt, Wallet, AlertTriangle, Users, CheckCircle2, Clock, MessageCircle, FileText, ArrowUp, ArrowDown, ArrowUpDown, Download, Printer, Share2 } from "lucide-react";

const METODOS = [["efectivo", "Efectivo"], ["tarjeta", "Tarjeta"], ["transferencia", "Transferencia"], ["deposito", "Depósito"], ["otros", "Otros"]];

const Card = ({ label, value, icon: Ic, iconCls = "text-slate-500", valueCls = "text-slate-700", testid }) => (
  <div className="card-soft p-4" data-testid={testid}>
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <Ic className={`w-4 h-4 ${iconCls}`} />
    </div>
    <div className={`font-display font-black text-2xl mt-1 ${valueCls}`}>{value}</div>
  </div>
);

export default function CuentasPorCobrar() {
  const { can } = useAuth();
  const { logo, empresa_nombre } = useBranding();
  const [data, setData] = useState({ totales: {}, clientes: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [estado, setEstado] = useState("todos");
  const [facturada, setFacturada] = useState("todas");
  const [sort, setSort] = useState({ key: "saldo", dir: "desc" });
  const [legacyRes, setLegacyRes] = useState(null);
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sorted = [...(data.clientes || [])];
  if (sort.key) {
    sorted.sort((a, b) => {
      const getV = (r) => {
        if (["saldo", "vencido", "corriente"].includes(sort.key)) return r[sort.key];
        if (["b1_30", "b31_60", "b61_90", "b90"].includes(sort.key)) return r.aging?.[sort.key] ?? 0;
        if (sort.key === "dias") return r.max_dias ?? 0;
        if (sort.key === "cliente") return r.nombre || "";
        if (sort.key === "contacto") return r.telefono || r.celular || "";
        return r[sort.key];
      };
      let x = getV(a), y = getV(b);
      if (["saldo", "vencido", "corriente", "b1_30", "b31_60", "b61_90", "b90", "dias"].includes(sort.key)) { x = Number(x || 0); y = Number(y || 0); return sort.dir === "asc" ? x - y : y - x; }
      const r = String(x || "").localeCompare(String(y || ""), "es", { numeric: true });
      return sort.dir === "asc" ? r : -r;
    });
  }
  const puedeCobrar = can("caja.entrada");

  // Abono
  const [abonoCli, setAbonoCli] = useState(null);
  const [abono, setAbono] = useState({ monto: "", metodo: "efectivo", referencia: "", nota: "" });
  const [saving, setSaving] = useState(false);
  // Comprobante de abono (tras guardar / reimpresión)
  const [comp, setComp] = useState(null); // { abono, cliente }
  const [compBusy, setCompBusy] = useState(false);
  // Detalle
  // Detalle
  const [detCli, setDetCli] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [selVentas, setSelVentas] = useState([]);
  // Interés moratorio
  const [interesDlg, setInteresDlg] = useState(false);
  const [interes, setInteres] = useState({ tasa: "", nota: "", dias: "", calculo: "moratorio" });
  const [interesModo, setInteresModo] = useState("cliente"); // "cliente" | "seleccion"
  const [interesBusy, setInteresBusy] = useState(false);
  const puedeInteres = can("cxc.interes");

  const load = async () => {
    setLoading(true);
    const params = {};
    if (q) params.q = q;
    if (soloVencidos) params.solo_vencidos = true;
    if (estado && estado !== "todos") params.estado = estado;
    if (facturada && facturada !== "todas") params.facturada = facturada;
    const { data } = await api.get("/cxc", { params });
    setData(data); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [soloVencidos, estado, facturada]);
  // Resumen del histórico Legacy (agregado, sin datos técnicos)
  useEffect(() => { api.get("/legacy/public-summary").then((r) => setLegacyRes(r.data)).catch(() => setLegacyRes(null)); }, []);

  // Preselección desde "Mi Ruta" (botón Cobrar del mapa de campo).
  useEffect(() => {
    let pre = null;
    try { pre = JSON.parse(sessionStorage.getItem("preselect_cxc")); } catch { pre = null; }
    if (!pre?.id || loading) return;
    sessionStorage.removeItem("preselect_cxc");
    const row = (data.clientes || []).find((c) => c.cliente_id === pre.id);
    if (row && puedeCobrar) openAbono(row);
    else toast.info("Ese cliente no tiene saldos pendientes en CxC");
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [loading, data]);

  const openAbono = (c) => { setAbonoCli(c); setAbono({ monto: "", metodo: "efectivo", referencia: "", nota: "" }); };
  const guardarAbono = async () => {
    const monto = Number(abono.monto);
    if (!monto || monto <= 0) return toast.error("Ingresa un monto válido");
    setSaving(true);
    try {
      const { data } = await api.post(`/cxc/${abonoCli.cliente_id}/abono`, { ...abono, monto });
      toast.success("Abono registrado correctamente");
      setAbonoCli(null); load();
      if (detCli && detCli.cliente_id === abonoCli.cliente_id) openDetalle(abonoCli);
      setComp({ abono: data.abono || { folio: data.folio, cliente_nombre: abonoCli.nombre, monto, metodo: abono.metodo, referencia: abono.referencia, saldo_anterior: data.saldo_anterior, saldo_restante: data.saldo_actual }, cliente: abonoCli });
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  // Comprobante de abono: generar PDF real + acciones
  const genCompPdf = async (abono) => {
    setCompBusy(true);
    try { const { data } = await api.post(`/abonos/${abono.id}/pdf`); return data; }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); return null; }
    finally { setCompBusy(false); }
  };
  const descargarComp = async (abono) => { const d = await genCompPdf(abono); if (d) { const a = document.createElement("a"); a.href = fileUrl(d.url); a.download = d.filename; document.body.appendChild(a); a.click(); a.remove(); } };
  const compartirComp = async (abono) => {
    const d = await genCompPdf(abono); if (!d) return;
    const link = fileUrl(d.url);
    if (navigator.share) { try { await navigator.share({ title: `Comprobante ${abono.folio}`, text: `Comprobante ${abono.folio}`, url: link }); } catch {} }
    else { try { await navigator.clipboard.writeText(link); toast.success("Enlace copiado"); } catch { window.open(link, "_blank"); } }
  };
  const enviarCompWhatsApp = async (abono) => {
    const d = await genCompPdf(abono); if (!d) return;
    const link = fileUrl(d.url);
    const tel = (comp?.cliente?.whatsapp || comp?.cliente?.celular || comp?.cliente?.telefono || "").replace(/\D/g, "");
    const phone = tel ? (tel.length === 10 ? "52" + tel : tel) : "";
    const msg = `Hola ${abono.cliente_nombre || ""}, aquí está tu comprobante de abono ${abono.folio} de ${money(abono.monto)}. Descárgalo aquí: ${link}`;
    window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    toast.success("Comprobante listo, abriendo WhatsApp…");
  };
  const imprimirComp = () => { window.print(); };

  const openDetalle = async (c) => {
    setDetCli(c); setDetalle(null); setSelVentas([]);
    const { data } = await api.get(`/cxc/${c.cliente_id}`);
    setDetalle(data);
  };
  const toggleSelVenta = (id) => setSelVentas((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  const generarPdf = async () => {
    try {
      const root = `${process.env.REACT_APP_BACKEND_URL || ""}`;
      const url = `${root}/api/cxc/${detCli.cliente_id}/adeudo-pdf`;
      window.open(url, "_blank");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // ---- Interés moratorio / inmediato ----
  const previewInteres = (() => {
    const tasa = Number(interes.tasa);
    if (!tasa || tasa <= 0 || !detalle) return null;
    const diasOverride = Number(interes.dias) || null;
    const inmediato = interes.calculo === "inmediato";
    let total = 0;
    if (interesModo === "seleccion") {
      for (const v of detalle.ventas) {
        if (!selVentas.includes(v.id) || v.saldo <= 0) continue;
        const base = Math.max(0, v.saldo - (v.interes_acumulado || 0));
        if (base <= 0) continue;
        if (inmediato) { total += base * (tasa / 100); continue; }
        const diasCobrar = diasOverride || v.dias_vencido;
        if (!diasCobrar || diasCobrar <= 0) continue;
        total += base * (tasa / 100) * (diasCobrar / 30);
      }
    } else {
      for (const v of detalle.ventas) {
        if (v.saldo <= 0) continue;
        const base = Math.max(0, v.saldo - (v.interes_acumulado || 0));
        if (base <= 0) continue;
        if (inmediato) { total += base * (tasa / 100); continue; }
        if (v.dias_vencido <= 0) continue;
        total += base * (tasa / 100) * (v.dias_vencido / 30);
      }
    }
    return { total: Math.round(total * 100) / 100 };
  })();
  const aplicarInteres = async () => {
    const tasa = Number(interes.tasa);
    if (!tasa || tasa <= 0 || tasa > 100) return toast.error("Tasa inválida (0-100%)");
    const esSel = interesModo === "seleccion";
    if (esSel && selVentas.length === 0) return toast.error("Selecciona al menos un documento");
    const esInmediato = interes.calculo === "inmediato";
    let diasOverride = Number(interes.dias) || null;
    if (!esInmediato && esSel && !diasOverride) {
      const sinVencer = selVentas.filter((id) => {
        const v = (detalle?.ventas || []).find((x) => x.id === id);
        return v && v.saldo > 0 && v.dias_vencido <= 0;
      }).length;
      if (sinVencer > 0) {
        const d = window.prompt(
          `${sinVencer} documento(s) SIN VENCER seleccionado(s). El interés moratorio necesita días para prorratear; los sin vencer se omitirán si no indicas días.\n\nDías a cobrar (Enter para omitir los sin vencer, Cancelar para salir):`);
        if (d === null) return;
        diasOverride = Number(d) || null;
      }
    }
    setInteresBusy(true);
    try {
      const body = { tasa_pct: tasa, nota: interes.nota, calculo: interes.calculo };
      if (esSel) { body.sale_ids = selVentas; if (diasOverride) body.dias = diasOverride; }
      const { data } = await api.post(`/cxc/${detCli.cliente_id}/interes`, body);
      toast.success(`Interés aplicado: ${money(data.total_interes)} a ${data.ventas_afectadas} documento(s) (${data.folio})`
        + (data.documentos_omitidos ? ` · ${data.documentos_omitidos} omitido(s) sin saldo base` : ""));
      setInteresDlg(false); setInteres({ tasa: "", nota: "", dias: "", calculo: "moratorio" }); setSelVentas([]);
      openDetalle(detCli);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setInteresBusy(false); }
  };
  const cancelarCargo = async (cargo) => {
    const motivo = window.prompt(`Motivo de cancelación del cargo ${cargo.folio} (${money(cargo.total)}):`);
    if (!motivo) return;
    setInteresBusy(true);
    try {
      const { data } = await api.post(`/cxc/cargos/${cargo.id}/cancelar`, { motivo });
      toast.success(`Cargo revertido: ${money(data.interes_revertido)}`);
      openDetalle(detCli);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setInteresBusy(false); }
  };
  const recordarWhatsApp = async () => {
    try {
      const { data } = await api.post(`/cxc/${detCli.cliente_id}/recordatorio`);
      toast.success("Recordatorio generado");
      if (data.wa_url) window.open(data.wa_url, "_blank");
      else toast.warning("Cliente sin teléfono válido; el recordatorio quedó registrado");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
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

      {legacyRes?.disponible && (legacyRes.cxc_pendientes > 0 || legacyRes.tickets_legacy > 0) && (
        <div className="rounded-lg border border-[#C1401E]/30 bg-orange-50/60 px-4 py-3 flex items-center gap-2 text-sm text-slate-700" data-testid="cxc-legacy-banner">
          <Receipt className="w-4 h-4 text-[#C1401E]" />
          <span>La cartera incluye <b>{legacyRes.cxc_pendientes}</b> documento(s) histórico(s) <Badge className="bg-[#C1401E] text-white mx-1">LEGACY</Badge> por <b>{money(legacyRes.cxc_saldo)}</b> ({legacyRes.tickets_legacy} tickets históricos consultables). Los pagos se registran con el flujo normal (FIFO).</span>
        </div>
      )}

      {/* Antigüedad global */}
      <div className="card-soft p-4">
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

      <div className="flex flex-wrap gap-2 card-soft p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar por nombre, clave, RFC o teléfono..." value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="pl-9" data-testid="cxc-buscar" />
        </div>
        <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3">
          <span className="text-sm text-slate-600">Solo vencidos</span>
          <Switch checked={soloVencidos} onCheckedChange={setSoloVencidos} data-testid="cxc-solo-vencidos" />
        </div>
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="w-40" data-testid="cxc-estado"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="parcialmente_pagada">Parcialmente pagada</SelectItem>
            <SelectItem value="vencida">Vencida</SelectItem>
            <SelectItem value="liquidada">Liquidada</SelectItem>
          </SelectContent>
        </Select>
        <Select value={facturada} onValueChange={setFacturada}>
          <SelectTrigger className="w-40" data-testid="cxc-facturada"><SelectValue placeholder="Facturación" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="si">Solo facturadas</SelectItem>
            <SelectItem value="no">Solo no facturadas</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load} data-testid="cxc-refrescar"><Search className="w-4 h-4" /></Button>
      </div>

      <div className="card-soft overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            {[{ key: "cliente", label: "Cliente" }, { key: "contacto", label: "Contacto" },
              { key: "saldo", label: "Saldo", right: true }, { key: "vencido", label: "Vencido", right: true },
              { key: "corriente", label: "Corriente", right: true }, { key: "b1_30", label: "1-30", right: true },
              { key: "b31_60", label: "31-60", right: true }, { key: "b61_90", label: "61-90", right: true },
              { key: "b90", label: "+90", right: true }, { key: "dias", label: "Días", center: true }].map((col) => (
              <th key={col.key} onClick={() => toggleSort(col.key)} className={`p-3 cursor-pointer select-none hover:text-[#C1401E] ${col.right ? "text-right" : col.center ? "text-center" : "text-left"}`}>
                <span className={`inline-flex items-center gap-1 ${col.right ? "flex-row-reverse" : ""}`}>
                  {col.label}
                  {sort.key === col.key ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                </span>
              </th>
            ))}
            <th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={12} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
            {!loading && data.clientes.length === 0 && <tr><td colSpan={12} className="p-10 text-center text-slate-400"><CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />Sin cuentas por cobrar. ¡Todo al día!</td></tr>}
            {!loading && sorted.map((c) => (
              <tr key={c.cliente_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`cxc-row-${c.codigo}`}>
                <td className="p-3"><div className="font-medium text-[#C1401E]">{c.codigo}</div><div className="text-slate-700 max-w-[200px] truncate" title={c.nombre}>{c.nombre}</div></td>
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
                    {puedeCobrar && <Button size="sm" className="bg-[#C1401E] hover:bg-[#A03316]" onClick={() => openAbono(c)} data-testid={`cxc-abonar-${c.codigo}`}><HandCoins className="w-4 h-4 mr-1" /> Abonar</Button>}
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
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><HandCoins className="w-5 h-5 text-[#C1401E]" /> Registrar abono</DialogTitle></DialogHeader>
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
            <Button onClick={guardarAbono} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="abono-guardar">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Registrar abono"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de detalle / estado de cuenta */}
      <Dialog open={!!detCli} onOpenChange={(o) => !o && setDetCli(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="detalle-dialog">
          <DialogHeader><DialogTitle className="font-display">Estado de cuenta · {detCli?.nombre}</DialogTitle></DialogHeader>
          {!detalle ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div> : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Saldo</div><div className="font-display font-bold text-red-600">{money(detalle.cliente.saldo)}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Límite</div><div className="font-display font-bold">{money(detalle.cliente.limite_credito)}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Días crédito</div><div className="font-display font-bold">{detalle.cliente.dias_credito}</div></div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs uppercase tracking-wider text-slate-400">
                    Historial de documentos ({detalle.ventas.length}) · {detalle.ventas.filter((v) => v.saldo > 0).length} con saldo
                  </div>
                  {puedeInteres && detalle.ventas.length > 0 && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => {
                        const ids = detalle.ventas.map((v) => v.id);
                        setSelVentas(selVentas.length === ids.length ? [] : ids);
                      }} data-testid="cxc-sel-todas">
                        {selVentas.length === detalle.ventas.length ? "Quitar selección" : "Seleccionar todos"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        const conSaldo = detalle.ventas.filter((v) => v.saldo > 0).map((v) => v.id);
                        setSelVentas(selVentas.length === conSaldo.length ? [] : conSaldo);
                      }} data-testid="cxc-sel-saldo">
                        {selVentas.length === detalle.ventas.filter((v) => v.saldo > 0).length && detalle.ventas.some((v) => v.saldo > 0) ? "Quitar" : "Solo con saldo"}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="border border-slate-200 rounded-md overflow-hidden max-h-[45vh] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-slate-500 uppercase tracking-wider">
                      {puedeInteres && <th className="p-2 w-6"></th>}
                      <th className="p-2">Folio</th><th className="p-2">Fecha</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Saldo</th><th className="p-2 text-right">Interés</th><th className="p-2">Vence</th><th className="p-2 text-center">Estado</th>
                    </tr></thead>
                    <tbody>
                      {detalle.ventas.length === 0 && <tr><td colSpan={puedeInteres ? 8 : 7} className="p-4 text-center text-slate-400">Sin documentos.</td></tr>}
                      {detalle.ventas.map((v) => (
                        <tr key={v.id} className={`border-t border-slate-100 ${selVentas.includes(v.id) ? "bg-amber-50/60" : ""} ${v.pagada ? "opacity-60" : ""}`}>
                          {puedeInteres && (
                            <td className="p-2">
                              <input type="checkbox" checked={selVentas.includes(v.id)} onChange={() => toggleSelVenta(v.id)} data-testid={`cxc-sel-${v.folio}`} />
                            </td>
                          )}
                          <td className="p-2 font-medium">
                            {v.folio}
                            {v.source === "LEGACY" && <Badge className="ml-1 bg-[#C1401E] text-white">LEGACY</Badge>}
                            {v.condicion === "contado" && <span className="ml-1 text-[10px] text-slate-400">contado</span>}
                          </td>
                          <td className="p-2 text-slate-500">{(v.fecha || "").slice(0, 10)}</td>
                          <td className="p-2 text-right">{money(v.total)}</td>
                          <td className={`p-2 text-right font-semibold ${v.saldo > 0 ? "text-red-600" : "text-green-600"}`}>{money(v.saldo)}</td>
                          <td className="p-2 text-right text-amber-700">{v.interes_acumulado > 0 ? money(v.interes_acumulado) : "—"}</td>
                          <td className="p-2 text-slate-500">{v.vence}</td>
                          <td className="p-2 text-center">
                            {v.estado_cxc === "LEGACY_PAGADO" ? <Badge className="bg-slate-200 text-slate-700" title="Liquidado en el sistema legacy origen — el ERP no necesariamente tiene el comprobante de cobro">Legacy pagado</Badge>
                              : v.estado_cxc === "PAGADO" ? <Badge className="bg-green-100 text-green-700">Pagada</Badge>
                              : v.estado_cxc === "ACTIVO" ? <Badge className="bg-red-100 text-red-700">Vencida {v.dias_vencido}d</Badge>
                              : <Badge className="bg-blue-100 text-blue-700">Vigente</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs uppercase tracking-wider text-slate-400">Historial de abonos</div>
                </div>
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50"><tr className="text-left text-slate-500 uppercase tracking-wider">
                      <th className="p-2">Folio</th><th className="p-2">Fecha</th><th className="p-2 text-right">Monto</th><th className="p-2">Método</th><th className="p-2">Referencia</th><th className="p-2"></th>
                    </tr></thead>
                    <tbody>
                      {detalle.abonos.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Aún no hay abonos.</td></tr>}
                      {detalle.abonos.map((a) => (
                        <tr key={a.id} className="border-t border-slate-100">
                          <td className="p-2 font-medium">{a.folio}</td>
                          <td className="p-2 text-slate-500">{(a.fecha || "").slice(0, 10)}</td>
                          <td className="p-2 text-right font-semibold text-green-700">{money(a.monto)}</td>
                          <td className="p-2 capitalize">{a.metodo}</td>
                          <td className="p-2 text-slate-500">{a.referencia || "—"}</td>
                          <td className="p-2">
                            <Button size="sm" variant="ghost" onClick={() => setComp({ abono: a, cliente: detCli })} data-testid={`abono-comprobante-${a.folio}`}>
                              <FileText className="w-4 h-4 text-[#C1401E]" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cargos por interés moratorio */}
              {puedeInteres && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Cargos por interés moratorio</div>
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50"><tr className="text-left text-slate-500 uppercase tracking-wider">
                        <th className="p-2">Folio</th><th className="p-2">Fecha</th><th className="p-2 text-right">Tasa</th>
                        <th className="p-2 text-right">Interés</th><th className="p-2 text-center">Ventas</th>
                        <th className="p-2">Usuario</th><th className="p-2 text-center">Estado</th><th className="p-2"></th>
                      </tr></thead>
                      <tbody>
                        {(detalle.cargos || []).length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-400">Sin cargos de interés.</td></tr>}
                        {(detalle.cargos || []).map((cg) => (
                          <tr key={cg.id} className={`border-t border-slate-100 ${cg.estado === "cancelado" ? "opacity-50" : ""}`}>
                            <td className="p-2 font-medium">{cg.folio}</td>
                            <td className="p-2 text-slate-500">{(cg.fecha || "").slice(0, 10)}</td>
                            <td className="p-2 text-right">{cg.tasa_pct}%</td>
                            <td className="p-2 text-right font-semibold text-amber-700">{money(cg.total)}</td>
                            <td className="p-2 text-center">{(cg.detalle || []).length}</td>
                            <td className="p-2 text-slate-500">{cg.usuario_nombre}</td>
                            <td className="p-2 text-center">
                              {cg.estado === "cancelado" ? <Badge variant="outline" className="text-slate-500">Cancelado</Badge>
                                : <Badge className="bg-amber-100 text-amber-700">Confirmado</Badge>}
                            </td>
                            <td className="p-2 text-center">
                              {cg.estado === "confirmado" && cg.tipo === "interes_moratorio" && (
                                <Button size="sm" variant="ghost" disabled={interesBusy}
                                        onClick={() => cancelarCargo(cg)} title="Revertir cargo">
                                  <AlertTriangle className="w-4 h-4 text-red-500" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {detCli && detalle && <>
              {puedeInteres && detalle.cliente.saldo > 0 && selVentas.length === 0 &&
                <Button variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-50"
                        onClick={() => { setInteresModo("cliente"); setInteres({ tasa: "", nota: "", dias: "", calculo: "moratorio" }); setInteresDlg(true); }} data-testid="detalle-interes">
                  <ArrowUp className="w-4 h-4 mr-1 text-amber-600" /> Aplicar interés (todas las vencidas)
                </Button>}
              {puedeInteres && selVentas.length > 0 &&
                <Button variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-50"
                        onClick={() => { setInteresModo("seleccion"); setInteres({ tasa: "", nota: "", dias: "", calculo: "moratorio" }); setInteresDlg(true); }} data-testid="detalle-interes-seleccion">
                  <ArrowUp className="w-4 h-4 mr-1 text-amber-600" /> Cobrar interés a {selVentas.length} documento(s)
                </Button>}
              <Button variant="outline" onClick={recordarWhatsApp} data-testid="detalle-recordar"><MessageCircle className="w-4 h-4 mr-1 text-green-600" /> Recordar por WhatsApp</Button>
              <Button variant="outline" onClick={generarPdf} data-testid="detalle-pdf"><FileText className="w-4 h-4 mr-1" /> PDF de adeudo</Button>
            </>}
            {detCli && puedeCobrar && detalle && detalle.cliente.saldo > 0 &&
              <Button className="bg-[#C1401E] hover:bg-[#A03316]" onClick={() => { setDetCli(null); openAbono(detCli); }} data-testid="detalle-abonar"><HandCoins className="w-4 h-4 mr-1" /> Registrar abono</Button>}
            <Button variant="outline" onClick={() => setDetCli(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo aplicar interés moratorio */}
      <Dialog open={interesDlg} onOpenChange={(o) => !o && setInteresDlg(false)}>
        <DialogContent className="max-w-md" data-testid="interes-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><ArrowUp className="w-5 h-5 text-amber-600" /> Aplicar interés moratorio{interesModo === "seleccion" ? ` · ${selVentas.length} documento(s)` : ""}</DialogTitle></DialogHeader>
          {detCli && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <div><div className="text-xs text-slate-400">{detCli.codigo}</div><div className="font-semibold">{detCli.nombre}</div></div>
                <div className="text-right"><div className="text-xs text-slate-400">Saldo actual</div><div className="font-display font-bold text-red-600">{money(detalle?.cliente.saldo)}</div></div>
              </div>
              {interesModo === "seleccion" && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600" data-testid="interes-seleccion-info">
                  Se cobrará únicamente a los <b>{selVentas.length}</b> documento(s) marcados (LEGACY o nuevos,
                  vencidos o no). Los pagados o sin saldo base se omiten automáticamente; en moratorio,
                  los sin vencer requieren "Días a cobrar" o se omiten.
                </div>
              )}
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Tipo de interés</Label>
                <Select value={interes.calculo} onValueChange={(v) => setInteres((s) => ({ ...s, calculo: v }))}>
                  <SelectTrigger className="mt-1" data-testid="interes-calculo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="moratorio">Moratorio · prorrateo días/30</SelectItem>
                    <SelectItem value="inmediato">Inmediato · una sola vez sobre el saldo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Tasa de interés mensual (%)</Label>
                <Input type="number" min="0" max="100" step="0.01" value={interes.tasa}
                       onChange={(e) => setInteres((s) => ({ ...s, tasa: e.target.value }))}
                       placeholder="Ej. 2.5" className="mt-1" data-testid="interes-tasa" />
              </div>
              {interesModo === "seleccion" && interes.calculo === "moratorio" && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Días a cobrar (opcional)</Label>
                  <Input type="number" min="1" step="1" value={interes.dias}
                         onChange={(e) => setInteres((s) => ({ ...s, dias: e.target.value }))}
                         placeholder="Vacío = días vencidos reales" className="mt-1" data-testid="interes-dias" />
                  <p className="text-[11px] text-slate-400 mt-1">Necesario si alguno de los documentos aún no está vencido.</p>
                </div>
              )}
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Nota (opcional)</Label>
                <Textarea value={interes.nota} onChange={(e) => setInteres((s) => ({ ...s, nota: e.target.value }))}
                          placeholder="Ej. interés de agosto por atraso" className="mt-1" data-testid="interes-nota" />
              </div>
              {previewInteres && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">{interes.calculo === "inmediato" ? "Interés a cargar (inmediato, una sola vez)" : "Interés a cargar (prorrateo días vencido / 30)"}</span>
                    <b className="text-amber-700">{money(previewInteres.total)}</b>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Se suma al saldo de cada documento y al saldo total del cliente.
                    Queda registrado y es reversible una sola vez.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInteresDlg(false)}>Cancelar</Button>
            <Button onClick={aplicarInteres} disabled={interesBusy || !interes.tasa}
                    className="bg-amber-600 hover:bg-amber-700 text-white" data-testid="interes-aplicar">
              {interesBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar interés"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comprobante de abono */}
      <Dialog open={!!comp} onOpenChange={(o) => !o && setComp(null)}>
        <DialogContent className="max-w-md" data-testid="comprobante-abono-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Receipt className="w-5 h-5 text-[#C1401E]" /> Abono registrado correctamente</DialogTitle></DialogHeader>
          {comp && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#E5E0DA] overflow-hidden" data-testid="comprobante-abono-cuerpo">
                {/* Encabezado RYSA */}
                <div className="flex items-center gap-3 px-4 py-3 border-b-4 border-[#C1401E]">
                  <img src={logo} alt="logo" className="h-12 w-12 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  <div className="flex-1">
                    <div className="font-display font-extrabold text-[#C1401E] leading-none">{empresa_nombre}</div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mt-0.5">Comprobante de Abono</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-display font-black text-[#C1401E]">{comp.abono.folio}</div>
                    <div className="text-[11px] text-slate-500">{(comp.abono.fecha || new Date().toISOString()).slice(0, 10)} {(comp.abono.fecha || "").slice(11, 16)}</div>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="text-sm"><span className="text-slate-400 text-xs">Cliente:</span> <b>{comp.abono.cliente_nombre || comp.cliente?.nombre}</b></div>
                  <div className="rounded-lg bg-[#F4ECE7] p-3 space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Saldo anterior</span><span className="font-semibold">{money(comp.abono.saldo_anterior)}</span></div>
                    <div className="flex justify-between text-base font-bold text-[#C1401E] border-t border-[#E5D5CC] pt-2"><span>ABONO</span><span>{money(comp.abono.monto)}</span></div>
                    <div className="flex justify-between text-base font-black border-t-2 border-[#C1401E] pt-2"><span>SALDO RESTANTE</span><span>{money(comp.abono.saldo_restante)}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div><span className="text-slate-400">Método:</span> <span className="capitalize font-medium text-slate-700">{comp.abono.metodo}</span></div>
                    {comp.abono.referencia && <div><span className="text-slate-400">Referencia:</span> <span className="font-medium text-slate-700">{comp.abono.referencia}</span></div>}
                    {comp.abono.usuario_nombre && <div><span className="text-slate-400">Usuario:</span> <span className="font-medium text-slate-700">{comp.abono.usuario_nombre}</span></div>}
                    {comp.abono.documento && <div><span className="text-slate-400">Documento:</span> <span className="font-medium text-slate-700">{comp.abono.documento}</span></div>}
                  </div>
                  <div className="text-center font-bold text-[#C1401E] pt-1">¡GRACIAS POR SU PAGO!</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button size="sm" variant="outline" onClick={() => descargarComp(comp.abono)} disabled={compBusy} data-testid="abono-descargar-pdf">
                  {compBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />} PDF
                </Button>
                <Button size="sm" variant="outline" onClick={imprimirComp} data-testid="abono-imprimir"><Printer className="w-4 h-4 mr-1" /> Imprimir</Button>
                <Button size="sm" variant="outline" onClick={() => compartirComp(comp.abono)} disabled={compBusy} data-testid="abono-compartir"><Share2 className="w-4 h-4 mr-1" /> Compartir</Button>
                <Button size="sm" className="bg-[#25D366] hover:bg-[#1ebe57]" onClick={() => enviarCompWhatsApp(comp.abono)} disabled={compBusy} data-testid="abono-whatsapp">
                  <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" className="w-full" onClick={() => setComp(null)}>Cerrar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
