import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Eye, XCircle, Copy, Printer, Plus, Loader2, Receipt, FileText, Search, BarChart3, Send, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

const QUICK = [["hoy", "Hoy"], ["semana", "Esta semana"], ["mes", "Este mes"], ["mes_anterior", "Mes anterior"], ["all", "Todas"]];

export default function Ventas() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rango, setRango] = useState("all");
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
  const [factClienteQuery, setFactClienteQuery] = useState("");
  const [factClienteOpen, setFactClienteOpen] = useState(false);
  const [factBilling, setFactBilling] = useState({ rfc: "", razon_social: "", cp: "", reg_fiscal: "", uso_cfdi: "", direccion: "" });
  const [clientes, setClientes] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState([]);
  const [sort, setSort] = useState({ key: "fecha", dir: "desc" });
  const [origen, setOrigen] = useState("all"); // "rysa" oculta el histórico LEGACY
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const PAGE_SIZE = 50;
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sorted = [...rows];
  if (sort.key) {
    sorted.sort((a, b) => {
      const getV = (r) => {
        if (sort.key === "total") return Number(r.total || 0);
        if (sort.key === "cliente") return r.cliente_nombre || "";
        if (sort.key === "vendedor") return r.vendedor_nombre || r.usuario_nombre || "";
        return r[sort.key] || "";
      };
      let x = getV(a), y = getV(b);
      if (sort.key === "total") { x = Number(x || 0); y = Number(y || 0); return sort.dir === "asc" ? x - y : y - x; }
      const r = String(x || "").localeCompare(String(y || ""), "es", { numeric: true });
      return sort.dir === "asc" ? r : -r;
    });
  }

  const facturables = rows.filter((s) => s.estado === "confirmada" && !s.facturado && s.tipo_venta !== "cotizacion");
  const toggleSel = (id) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const selRows = rows.filter((r) => sel.includes(r.id));

  const facturarVarias = async () => {
    if (sel.length === 0) return toast.error("Selecciona al menos una venta");
    setBusy("multi");
    try {
      const { data } = await api.post("/facturacion/multi", { sale_ids: sel });
      toast.success(`CFDI emitido por ${data.ventas} ventas · ${data.uuid || "(sandbox)"}`);
      setSel([]); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  // Rango de fechas efectivo (espejo del filtro del backend) para cruzar abonos.
  const rangoFechas = () => {
    const hoy = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (rango === "rango") return { d: desde || null, h: hasta || null };
    if (rango === "hoy") return { d: iso(hoy), h: iso(hoy) };
    if (rango === "semana") { const x = new Date(hoy); x.setDate(x.getDate() - 6); return { d: iso(x), h: iso(hoy) }; }
    if (rango === "mes") return { d: iso(hoy).slice(0, 8) + "01", h: iso(hoy) };
    if (rango === "mes_anterior") {
      const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      return { d: iso(ini), h: iso(fin) };
    }
    return { d: null, h: null }; // all
  };

  const load = async (pg = page) => {
    setLoading(true);
    const params = { page: pg, page_size: PAGE_SIZE };
    if (rango === "rango") { if (desde) params.desde = desde; if (hasta) params.hasta = hasta; }
    else if (rango !== "all") params.rango = rango;
    if (estado !== "all") params.estado = estado;
    if (vendedorId !== "all") params.vendedor_id = vendedorId;
    if (origen !== "all") params.origen = origen;
    try {
      const { d, h } = rangoFechas();
      const abonosParams = {};
      if (d) abonosParams.desde = d;
      if (h) abonosParams.hasta = h;
      const [{ data }, abonosRes] = await Promise.all([
        api.get("/sales", { params }),
        api.get("/abonos", { params: abonosParams }).catch(() => ({ data: [] })),
      ]);
      // Abonos como concepto "Abono a cuenta": se muestran cronológicamente
      // junto a las ventas pero NO cuentan como ventas ni son facturables/
      // cancelables desde aquí (eso vive en Cuentas por cobrar).
      let abonoRows = [];
      if (estado === "all") {
        abonoRows = (Array.isArray(abonosRes.data) ? abonosRes.data : [])
          .filter((a) => a.estado !== "cancelado")
          .filter((a) => (!d || (a.fecha || "").slice(0, 10) >= d) && (!h || (a.fecha || "").slice(0, 10) <= h))
          .map((a) => ({
            id: "AB-" + a.id,
            folio: a.folio,
            tipo_venta: "abono_cuenta",
            concepto: "Abono a cuenta",
            cliente_id: a.cliente_id,
            cliente_nombre: a.cliente_nombre || "",
            usuario_nombre: a.usuario_nombre || "",
            fecha: a.fecha,
            hora: (a.fecha || "").slice(11, 16),
            condicion: a.metodo || "",
            total: Number(a.monto || 0),
            estado: "abono",
            facturado: false,
            _abono: true,
            _raw: a,
          }));
      }
      setRows([...(data.items || []), ...abonoRows]);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      if (pg > (data.pages || 1) && (data.pages || 1) >= 1 && pg !== 1) setPage(1);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
      setRows([]);
    } finally {
      setSel([]);
      setLoading(false);
    }
  };
  // Recarga al cambiar página o filtros; un cambio de filtro reinicia a la
  // página 1 con una sola petición.
  const filtrosKey = `${rango}|${estado}|${vendedorId}|${desde}|${hasta}|${origen}`;
  const lastKey = useRef(filtrosKey);
  useEffect(() => {
    if (lastKey.current !== filtrosKey) {
      lastKey.current = filtrosKey;
      if (page !== 1) setPage(1); else load(1);
      return;
    }
    load(page);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [page, filtrosKey]);

  // Búsqueda histórica: encuentra cualquier venta por folio/cliente, sin importar
  // la fecha ni el rango del listado (para reimprimir/reenviar tickets viejos).
  const buscarHistorica = async () => {
    if (!q.trim()) return load();
    setLoading(true);
    try {
      const { data } = await api.get("/sales/por-folio", { params: { folio: q } });
      setRows(data || []); setSel([]);
      setTotal((data || []).length); setPages(1);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    api.get("/vendedores").then((r) => setVendedores(r.data)).catch(() => {});
    api.get("/clients").then((r) => setClientes(r.data)).catch(() => {});
    api.get("/sucursales").then((r) => setSucursales(r.data || [])).catch(() => {});
  }, []);

  const cancelar = async () => {
    if (!motivo.trim()) return toast.error("Indica el motivo");
    try { await api.post(`/sales/${cancelSale.id}/cancelar`, { motivo }); toast.success("Venta cancelada y revertida"); setCancelSale(null); setMotivo(""); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const reimprimir = async (s) => {
    try {
      const { data } = await api.post(`/sales/${s.id}/ticket-pdf`);
      window.open(fileUrl(data.url), "_blank");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const descargarCarta = async (s) => {
    try {
      const { data } = await api.post(`/sales/${s.id}/letter-pdf`);
      window.open(fileUrl(data.url), "_blank");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const descargarBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  };

  const adjuntarPdf = async (pdfUrl, filename, titulo, texto) => {
    const resp = await api.get(pdfUrl.replace(/^.*\/api\/files\//, "/files/"), { responseType: "blob" });
    const file = new File([resp.data], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: titulo, text: texto, files: [file] });
      return "share";
    }
    descargarBlob(resp.data, filename);
    return "download";
  };

  const reenviar = async (s) => {
    setBusy(`wa-${s.id}`);
    try {
      const { data } = await api.post(`/sales/${s.id}/ticket-pdf`);
      const filename = `ticket-${s.folio}.pdf`;
      const msg = `Hola${s.cliente_nombre ? " " + s.cliente_nombre : ""}, aquí está tu ticket ${s.folio}. Total: ${money(s.total)}.`;
      const modo = await adjuntarPdf(data.url, filename, `Ticket ${s.folio}`, msg);
      if (modo === "share") toast.success("PDF adjuntado. Selecciona WhatsApp en el menú de compartir.");
      else toast.info("El PDF se descargó. Adjúntalo manualmente en WhatsApp.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(""); }
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

  const selectFactCliente = (v) => {
    setFactCliente(v);
    const c = clientes.find((x) => x.id === v);
    setFactClienteQuery(c ? `${c.codigo || ""} ${c.nombre}`.trim() : "Público General (XAXX010101000)");
    setFactClienteOpen(false);
    setFactBilling({
      rfc: c?.rfc || "",
      razon_social: c?.nombre || "",
      cp: c?.cp || "",
      reg_fiscal: c?.reg_fiscal || "",
      uso_cfdi: c?.uso_cfdi || "",
      direccion: [c?.calle, c?.numero_exterior, c?.colonia, c?.ciudad, c?.estado_geo].filter(Boolean).join(", "),
    });
  };
  const abrirFacturar = (s) => {
    setFacturarSale(s);
    selectFactCliente(s.cliente_id || "publico");
  };
  const filteredFactClientes = factClienteQuery
    ? clientes.filter((c) => `${c.codigo} ${c.nombre} ${c.rfc || ""}`.toLowerCase().includes(factClienteQuery.toLowerCase())).slice(0, 50)
    : clientes.slice(0, 50);
  const facturar = async () => {
    setBusy("fact");
    try {
      // Si cambió el cliente, se asigna a la venta antes de timbrar
      if (factCliente && factCliente !== "publico" && factCliente !== facturarSale.cliente_id) {
        const c = clientes.find((x) => x.id === factCliente);
        await api.put(`/sales/${facturarSale.id}/cliente`, { cliente_id: factCliente, cliente_nombre: c?.nombre || "" });
      }
      const { data } = await api.post(`/facturacion/sale/${facturarSale.id}`, factBilling);
      toast.success(`CFDI emitido · ${data.uuid || "(sandbox)"}`);
      setFacturarSale(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  return (
    <div className="space-y-5" data-testid="ventas-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Ventas</h1><p className="text-slate-500 text-sm">{total} registros</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => nav("/app/reportes")} data-testid="ir-reportes"><BarChart3 className="w-4 h-4 mr-1" /> Reportes</Button>
          {can("venta.facturar") && (
            <Button variant="outline" onClick={facturarVarias} disabled={busy === "multi" || sel.length === 0} data-testid="facturar-varias" title="Facturar las ventas seleccionadas en una sola factura">
              {busy === "multi" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileText className="w-4 h-4 mr-1" /> Facturar {sel.length || ""} seleccionadas</>}
            </Button>
          )}
          <Button onClick={() => nav("/app/pos")} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="nueva-venta-btn"><Plus className="w-4 h-4 mr-1" /> Nueva venta</Button>
        </div>
      </div>

      <div className="card-soft p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK.map(([k, l]) => (
            <Button key={k} size="sm" variant={rango === k ? "default" : "outline"} className={rango === k ? "bg-[#C1401E] hover:bg-[#A03316]" : ""} onClick={() => setRango(k)} data-testid={`quick-${k}`}>{l}</Button>
          ))}
          <Button size="sm" variant={rango === "rango" ? "default" : "outline"} className={rango === "rango" ? "bg-[#C1401E] hover:bg-[#A03316]" : ""} onClick={() => setRango("rango")} data-testid="quick-rango">Fecha a fecha</Button>
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
            <SelectContent><SelectItem value="all">Todos estados</SelectItem><SelectItem value="confirmada">Confirmadas</SelectItem><SelectItem value="cancelada">Canceladas</SelectItem><SelectItem value="cotizacion">Cotizaciones</SelectItem></SelectContent>
          </Select>
          <Select value={origen} onValueChange={setOrigen}>
            <SelectTrigger className="w-36" data-testid="filtro-origen"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos origen</SelectItem><SelectItem value="rysa">RYSA</SelectItem><SelectItem value="legacy">LEGACY</SelectItem></SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Buscar folio o cliente (incluye histórico)..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscarHistorica()} className="pl-9" data-testid="buscar-venta" />
          </div>
        </div>
      </div>

      <div className="card-soft overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3 w-8">{can("venta.facturar") ? <input type="checkbox" checked={sel.length === facturables.length && facturables.length > 0} onChange={(e) => setSel(e.target.checked ? facturables.map((f) => f.id) : [])} data-testid="sel-todas" /> : null}</th>
            {[{ key: "estado", label: "Estado" }, { key: "folio", label: "Folio" }, { key: "fecha", label: "Fecha" }, { key: "cliente", label: "Cliente" }, { key: "vendedor", label: "Vendedor" }].map((col) => (
              <th key={col.key} onClick={() => toggleSort(col.key)} className={`p-3 cursor-pointer select-none hover:text-[#C1401E] ${col.right ? "text-right" : "text-left"}`}>
                <span className={`inline-flex items-center gap-1 ${col.right ? "flex-row-reverse" : ""}`}>
                  {col.label}
                  {sort.key === col.key ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                </span>
              </th>
            ))}
            <th className="p-3 text-right cursor-pointer select-none hover:text-[#C1401E]" onClick={() => toggleSort("total")}>
              <span className="inline-flex items-center gap-1 flex-row-reverse">Total {sort.key === "total" ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}</span>
            </th>
            <th className="p-3">Cond.</th><th className="p-3 text-center">Factura</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
            {!loading && sorted.length === 0 && <tr><td colSpan={10} className="p-10 text-center text-slate-400"><Receipt className="w-8 h-8 mx-auto mb-2" />Sin ventas.</td></tr>}
            {!loading && sorted.map((s) => {
              const legacy = s.source === "LEGACY";
              const facturable = s.estado === "confirmada" && !s.facturado && s.tipo_venta !== "cotizacion" && !legacy;
              return (
              <tr key={s.id} className={`border-t border-slate-100 hover:bg-slate-50 ${s._abono ? "bg-blue-50/40" : ""}`} data-testid={`venta-row-${s.folio}`}>
                <td className="p-3">{can("venta.facturar") && facturable ? <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggleSel(s.id)} data-testid={`sel-${s.folio}`} /> : null}</td>
                <td className="p-3">
                  {s._abono
                    ? <Badge className="bg-blue-100 text-blue-700">Abono a cuenta</Badge>
                    : <Badge className={s.estado === "cancelada" ? "bg-red-100 text-red-700" : s.estado === "cotizacion" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}>{s.estado}</Badge>}
                  {legacy && <Badge className="ml-1 bg-[#C1401E] text-white">LEGACY</Badge>}
                </td>
                <td className="p-3 font-medium text-[#C1401E]">{s.folio}</td>
                <td className="p-3 text-slate-500">{s.fecha?.slice(0, 10)} {s.hora}</td>
                <td className="p-3">{s.cliente_nombre}</td>
                <td className="p-3 text-slate-500" data-testid={`venta-vendedor-${s.folio}`}>{s.vendedor_nombre || s.usuario_nombre}</td>
                <td className="p-3 text-right font-semibold">{money(s.total)}</td>
                <td className="p-3"><Badge variant="outline">{s.condicion}</Badge></td>
                <td className="p-3 text-center">{s.facturado ? <Badge className="bg-emerald-100 text-emerald-700">Facturada</Badge> : <span className="text-slate-300 text-xs">—</span>}</td>
                <td className="p-3">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" onClick={() => setDetalle(s)} data-testid={`ver-${s.folio}`}><Eye className="w-4 h-4" /></Button>
                    {!s._abono && !legacy && <>
                      <Button size="icon" variant="ghost" title="Reimprimir PDF (ticket)" onClick={() => reimprimir(s)} data-testid={`reimprimir-${s.folio}`}><Printer className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" title="Reenviar por WhatsApp" onClick={() => reenviar(s)} disabled={busy === `wa-${s.id}`} data-testid={`reenviar-${s.folio}`}>{busy === `wa-${s.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</Button>
                      {s.estado === "confirmada" && !s.facturado && s.tipo_venta !== "cotizacion" &&
                        <Button size="sm" variant="outline" onClick={() => abrirFacturar(s)} title="Facturar" data-testid={`facturar-venta-${s.folio}`}><FileText className="w-4 h-4 mr-1" /> Facturar</Button>}
                      <Button size="sm" variant="outline" onClick={() => setRemitirSale(s)} title="Remitir" data-testid={`remitir-${s.folio}`}><Copy className="w-4 h-4 mr-1" /> Remitir</Button>
                      {s.estado === "confirmada" && can("venta.cancelar") && <Button size="icon" variant="ghost" onClick={() => setCancelSale(s)} className="text-red-500" data-testid={`cancelar-${s.folio}`}><XCircle className="w-4 h-4" /></Button>}
                    </>}
                  </div>
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
        {!loading && total > 0 && (
          <div className="flex items-center justify-between p-3 text-sm border-t border-slate-100" data-testid="ventas-paginacion">
            <span className="text-slate-500">Página {page} de {pages} · {total} registros</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="ventas-pag-prev">Anterior</Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} data-testid="ventas-pag-next">Siguiente</Button>
            </div>
          </div>
        )}
      </div>

      {/* Detalle */}
      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-3xl" data-testid="venta-detalle">
          {detalle?._abono ? (
            <>
              <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Badge className="bg-blue-100 text-blue-700">Abono a cuenta</Badge> {detalle.folio}</DialogTitle></DialogHeader>
              <div className="text-sm space-y-3" data-testid="abono-detalle">
                <div className="text-slate-500">{detalle.fecha?.slice(0, 16).replace("T", " ")} · Cliente: <b className="text-slate-800">{detalle.cliente_nombre}</b>{detalle.usuario_nombre ? <> · Recibió: <b className="text-slate-800">{detalle.usuario_nombre}</b></> : null}</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Método</div><div className="font-semibold capitalize">{detalle.condicion || "—"}</div></div>
                  <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Monto</div><div className="font-display font-black text-green-700">{money(detalle.total)}</div></div>
                </div>
                {detalle._raw?.referencia && <p className="text-xs text-slate-500">Referencia: {detalle._raw.referencia}</p>}
                {(detalle._raw?.aplicaciones || []).length > 0 && (
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50"><tr className="text-left text-slate-500"><th className="p-2">Venta (FIFO)</th><th className="p-2 text-right">Aplicado</th></tr></thead>
                      <tbody>
                        {detalle._raw.aplicaciones.map((ap, k) => (
                          <tr key={k} className="border-t border-slate-100"><td className="p-2 font-medium">{ap.folio}</td><td className="p-2 text-right">{money(ap.monto)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">Para cancelar un abono ve a Cuentas por cobrar → estado de cuenta del cliente.</p>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setDetalle(null)}>Cerrar</Button></DialogFooter>
            </>
          ) : (
          <>
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2">Venta {detalle?.folio}
            {detalle?.source === "LEGACY" && <Badge className="bg-[#C1401E] text-white">DOCUMENTO HISTÓRICO · SOLO LECTURA</Badge>}
          </DialogTitle></DialogHeader>
          {detalle && (
            <div className="text-sm">
              {detalle.source === "LEGACY" && (
                <div className="mb-2 p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <b>Origen: Sistema Legacy</b> · Serie {detalle.legacy_serie} · Folio {detalle.legacy_folio} · Cliente legacy: {detalle.legacy_cliente}
                  {detalle.legacy_cancelado ? " · Cancelado en el sistema Legacy" : ""} · Este documento es histórico y no puede modificarse, cancelarse ni reimprimirse como venta actual.
                </div>
              )}
              <div className="text-slate-500 mb-2">{detalle.fecha?.slice(0, 16).replace("T", " ")} · Cliente: {detalle.cliente_nombre} · Vendedor: {detalle.vendedor_nombre || detalle.usuario_nombre}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-slate-600">
                <span>Condición: <b>{detalle.condicion === "credito" ? "Crédito" : "Contado"}</b></span>
                {sucursales.find((x) => x.id === detalle.sucursal_id)?.nombre && <span>Sucursal: <b>{sucursales.find((x) => x.id === detalle.sucursal_id).nombre}</b></span>}
                {(detalle.pagos || []).length > 0 && <span>Pago: <b>{(detalle.pagos || []).map((p) => { const base = ({ efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", deposito: "Depósito", spei: "SPEI", otros: "Otro" })[p.metodo] || p.metodo; return p.metodo === "tarjeta" && p.card_type ? `${base} ${p.card_type === "debito" ? "Débito" : "Crédito"}` : base; }).join(" + ")}</b></span>}
                {detalle.tipo_venta === "cotizacion" && <span className="text-amber-700"><b>Cotización</b></span>}
              </div>
              <table className="w-full mb-3">
                <thead><tr className="text-xs text-slate-400 text-left"><th>Cant</th><th>Und.</th><th>Producto</th><th className="text-right">Precio</th><th className="text-right">Desc.</th><th className="text-right">Importe</th></tr></thead>
                <tbody>{detalle.items.map((i, k) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="py-1">{i.cantidad}</td>
                    <td className="py-1 text-slate-400">{i.unidad || "—"}</td>
                    <td className="py-1">{i.descripcion}{i.codigo_legacy && i.codigo_legacy !== i.descripcion ? <span className="text-xs text-slate-400"> · Cod. {i.codigo_legacy}</span> : null}{i.comentario ? <span className="text-xs text-slate-400"> · {i.comentario}</span> : null}</td>
                    <td className="py-1 text-right tabular-nums">{money(i.precio_bruto ?? i.precio)}</td>
                    <td className="py-1 text-right tabular-nums text-slate-400">{i.descuento ? money(i.descuento) : "—"}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{money(i.importe_bruto ?? (i.cantidad * i.precio - (i.descuento || 0)))}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="space-y-1 text-sm">
                {detalle.descuento_total > 0 && <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money(detalle.subtotal)}</span></div>}
                {detalle.iva_total > 0 && <div className="flex justify-between text-slate-500"><span>IVA</span><span>{money(detalle.iva_total)}</span></div>}
                {detalle.descuento_total > 0 && <div className="flex justify-between text-slate-500"><span>Descuento</span><span>-{money(detalle.descuento_total)}</span></div>}
                <div className="flex justify-between font-bold text-lg pt-1 border-t border-slate-200"><span>Total</span><span>{money(detalle.total)}</span></div>
              </div>
              {detalle.cambio > 0 && <div className="flex justify-end text-xs text-slate-500 mt-1">Cambio: {money(detalle.cambio)}</div>}
              {detalle.cancelacion && <div className="mt-3 p-2 bg-red-50 text-red-700 rounded text-xs">Cancelada por {detalle.cancelacion.usuario}: {detalle.cancelacion.motivo}</div>}
            </div>
          )}
          <DialogFooter>
            {detalle?.source !== "LEGACY" && <>
              <Button variant="outline" onClick={() => reimprimir(detalle)}><Printer className="w-4 h-4 mr-1" /> Ticket PDF</Button>
              <Button variant="outline" onClick={() => descargarCarta(detalle)}><FileText className="w-4 h-4 mr-1" /> Carta PDF</Button>
              <Button variant="outline" onClick={() => reenviar(detalle)} disabled={busy === `wa-${detalle?.id}`}>{busy === `wa-${detalle?.id}` ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <><Send className="w-4 h-4 mr-1" /> Reenviar</>}</Button>
            </>}
            {detalle?.source === "LEGACY" && (
              <span className="text-xs text-slate-400">Histórico documental · pagos de deuda legacy: usar el flujo normal de CxC</span>
            )}
          </DialogFooter>
          </>
          )}
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
        <DialogContent className="max-w-lg" data-testid="facturar-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><FileText className="w-5 h-5" /> Facturar venta {facturarSale?.folio}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[65vh] overflow-y-auto">
            <div className="bg-slate-50 rounded p-3 text-sm flex justify-between"><span>Total</span><b>{money(facturarSale?.total)}</b></div>
            <div className="relative">
              <Label className="text-xs uppercase tracking-wider text-slate-500">Cliente receptor</Label>
              <Input
                value={factClienteQuery}
                onChange={(e) => { setFactClienteQuery(e.target.value); setFactClienteOpen(true); }}
                onFocus={() => setFactClienteOpen(true)}
                onBlur={() => setTimeout(() => setFactClienteOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (filteredFactClientes[0]) selectFactCliente(filteredFactClientes[0].id); } }}
                placeholder="Busca cliente por código, nombre o RFC..."
                className="mt-1" data-testid="facturar-cliente" />
              {factClienteOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                  <button type="button" onMouseDown={() => selectFactCliente("publico")} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${factCliente === "publico" ? "bg-slate-100 font-medium" : ""}`}>
                    Público General (XAXX010101000)
                  </button>
                  {filteredFactClientes.map((c) => (
                    <button key={c.id} type="button" onMouseDown={() => selectFactCliente(c.id)} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${factCliente === c.id ? "bg-slate-100 font-medium" : ""}`}>
                      <span className="font-medium">{c.codigo}</span> · {c.nombre}
                      {c.rfc && <span className="block text-[11px] text-slate-400 font-mono">RFC: {c.rfc}</span>}
                    </button>
                  ))}
                  {filteredFactClientes.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">Sin resultados</div>}
                </div>
              )}
            </div>
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Datos de facturación</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">RFC</Label>
                  <Input value={factBilling.rfc} onChange={(e) => setFactBilling((s) => ({ ...s, rfc: e.target.value }))} placeholder="XAXX010101000" className="mt-1 font-mono" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">Razón social</Label>
                  <Input value={factBilling.razon_social} onChange={(e) => setFactBilling((s) => ({ ...s, razon_social: e.target.value }))} placeholder="PUBLICO EN GENERAL" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Código Postal</Label>
                  <Input value={factBilling.cp} onChange={(e) => setFactBilling((s) => ({ ...s, cp: e.target.value }))} placeholder="CP" className="mt-1 font-mono" />
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Régimen fiscal</Label>
                  <Input value={factBilling.reg_fiscal} onChange={(e) => setFactBilling((s) => ({ ...s, reg_fiscal: e.target.value }))} placeholder="601" className="mt-1 font-mono" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">Uso CFDI</Label>
                  <Input value={factBilling.uso_cfdi} onChange={(e) => setFactBilling((s) => ({ ...s, uso_cfdi: e.target.value }))} placeholder="G03" className="mt-1 font-mono" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">Dirección fiscal</Label>
                  <Input value={factBilling.direccion} onChange={(e) => setFactBilling((s) => ({ ...s, direccion: e.target.value }))} placeholder="Calle, número, colonia, ciudad, estado" className="mt-1" />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFacturarSale(null)}>Cancelar</Button>
            <Button onClick={facturar} disabled={busy === "fact"} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="facturar-confirm">{busy === "fact" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Emitir CFDI"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
