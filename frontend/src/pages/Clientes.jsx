import { useEffect, useState, useRef, useMemo } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Search, Download, Upload, Pencil, Loader2, Users, FileDown, CheckCircle2, AlertTriangle, RefreshCw, X, ArrowUp, ArrowDown, ArrowUpDown, EyeOff, Eye, ChevronLeft, ChevronRight } from "lucide-react";

const blank = () => ({
  codigo: "", nombre: "", razon_social: "", status: "", estado: "activo", tipo: "publico",
  tipo_clave: "", fecha_alta: "", contrasena: "",
  representa: "", tel_oficina: "", tel_residencia: "", tel_fax: "", telefono: "", celular: "",
  whatsapp: "", correo: "", correos: "",
  direccion: "", numero_exterior: "", numero_interior: "", colonia: "", ciudad_edo: "",
  localidad: "", ciudad: "", estado_geo: "", pais: "México", cp: "", referencias: "",
  rfc: "", reg_fiscal: "", uso_cfdi: "", resfiscal: "", nregidtrib: "",
  vendedor: "", almacen: "", precio_venta: 1, lista_precios: 1, condicion_pago: "contado",
  descuento_permanente: 0,
  credito_autorizado: false, limite_credito: 0, lim_descuento: 0, dias_credito: 0, saldo: 0, venta_credito: 0,
  ret_isr: false, ret_iva: false, ret_isr_tasa: 0, ret_iva_tasa: 0,
  mensual: 0, anual: 0, ult_fecha_compra: "", ult_monto_compra: 0,
  comentario: "", ofertas: false,
});
const tipoLabel = { publico: "Público General", menudeo: "Menudeo", mayoreo: "Mayoreo", especial: "Especial" };
const estadoBadge = { activo: "bg-green-100 text-green-700", suspendido: "bg-amber-100 text-amber-700", inactivo: "bg-slate-200 text-slate-600" };

// Indicador financiero del crédito
const creditStatus = (c) => {
  if (!c.credito_autorizado) return { dot: "bg-slate-800", label: "Sin crédito" };
  const limite = Number(c.limite_credito || 0), saldo = Number(c.saldo || 0);
  if (c.estado === "suspendido" || (limite > 0 && saldo >= limite)) return { dot: "bg-red-500", label: "Crédito suspendido / al límite" };
  if (saldo > 0) return { dot: "bg-amber-500", label: "Crédito activo con saldo pendiente" };
  return { dot: "bg-green-500", label: "Crédito activo (disponible)" };
};

const FILTROS = [
  ["all", "Todos"], ["con_credito", "Con crédito"], ["sin_credito", "Sin crédito"],
  ["con_saldo", "Con saldo"], ["sin_saldo", "Sin saldo"], ["activo", "Activos"],
  ["suspendido", "Suspendidos"], ["inactivo", "Inactivos"], ["con_ofertas", "Con ofertas"], ["sin_ofertas", "Sin ofertas"],
];

// Configuración de columnas de la tabla (para orden y ocultar vacías)
const COLS = [
  { key: "codigo", label: "Clave", always: true },
  { key: "nombre", label: "Nombre", always: true },
  { key: "rfc", label: "RFC" },
  { key: "ciudad", label: "Ciudad" },
  { key: "telefono", label: "Teléfono" },
  { key: "celular", label: "Celular" },
  { key: "vendedor", label: "Vend." },
  { key: "precio_venta", label: "P.Vta", num: true, center: true },
  { key: "saldo", label: "Saldo", num: true, right: true, money: true },
  { key: "limite_credito", label: "Límite", num: true, right: true, money: true },
  { key: "credito_autorizado", label: "Crédito", center: true, special: "credito" },
  { key: "estado", label: "Estado", special: "estado" },
  { key: "fecha_alta", label: "Alta" },
];
const colVal = (c, key) => (key === "precio_venta" ? (c.precio_venta || c.lista_precios || 1) : c[key]);
const isEmptyVal = (v) => v === undefined || v === null || v === "" || v === 0 || v === false;

export default function Clientes() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("all");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank());
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();
  // Importación con preview
  const [impOpen, setImpOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [impMode, setImpMode] = useState("ambos");
  const [impSaldo, setImpSaldo] = useState(false);
  const [importing, setImporting] = useState(false);
  // Navegación / orden / columnas
  const [sort, setSort] = useState({ key: "nombre", dir: "asc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [hideEmpty, setHideEmpty] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = {};
    if (q) params.q = q;
    if (filtro !== "all") params.filtro = filtro;
    const { data } = await api.get("/clients", { params });
    setRows(data); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filtro]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const openNew = () => { setF(blank()); setEditId(null); setOpen(true); };
  const openEdit = (c) => { setF({ ...blank(), ...c }); setEditId(c.id); setOpen(true); };

  const save = async () => {
    if (!f.codigo.trim()) return toast.error("La CLAVE es obligatoria");
    if (!f.nombre.trim()) return toast.error("El nombre es obligatorio");
    setSaving(true);
    try {
      const payload = {
        ...f,
        precio_venta: Number(f.precio_venta) || 1,
        lista_precios: Number(f.precio_venta) || 1,
        limite_credito: Number(f.limite_credito) || 0,
        lim_descuento: Number(f.lim_descuento) || 0,
        dias_credito: Number(f.dias_credito) || 0,
        ret_isr_tasa: Number(f.ret_isr_tasa) || 0,
        ret_iva_tasa: Number(f.ret_iva_tasa) || 0,
        mensual: Number(f.mensual) || 0, anual: Number(f.anual) || 0,
        ult_monto_compra: Number(f.ult_monto_compra) || 0, venta_credito: Number(f.venta_credito) || 0,
        descuento_permanente: Number(f.descuento_permanente) || 0,
      };
      if (editId) await api.put(`/clients/${editId}`, payload);
      else await api.post("/clients", payload);
      toast.success(editId ? "Cliente actualizado" : "Cliente creado");
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  // Toggle rápido de crédito
  const toggleCredito = async (c, valor) => {
    setRows((rs) => rs.map((x) => (x.id === c.id ? { ...x, credito_autorizado: valor } : x)));
    try {
      await api.patch(`/clients/${c.id}/credito-toggle`, { valor });
      toast.success(valor ? "Crédito habilitado." : "Crédito deshabilitado.");
    } catch (e) {
      setRows((rs) => rs.map((x) => (x.id === c.id ? { ...x, credito_autorizado: !valor } : x)));
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };
  // Cambio rápido de estado
  const changeEstado = async (c, estado) => {
    setRows((rs) => rs.map((x) => (x.id === c.id ? { ...x, estado } : x)));
    try { await api.patch(`/clients/${c.id}/estado`, null, { params: { estado } }); toast.success("Estado actualizado"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); load(); }
  };

  const exportExcel = async () => {
    const params = {}; if (q) params.q = q; if (filtro !== "all") params.filtro = filtro;
    const res = await api.get("/clients/export/excel", { responseType: "blob", params });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(res.data); link.download = "clientes.xlsx"; link.click();
  };
  const downloadPlantilla = async () => {
    const res = await api.get("/clients/plantilla/excel", { responseType: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(res.data); link.download = "plantilla_clientes.xlsx"; link.click();
  };

  const onFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    setImpOpen(true); setPreview(null);
    try { const { data } = await api.post("/clients/import/preview", fd); setPreview(data); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); setImpOpen(false); }
    e.target.value = "";
  };
  const confirmImport = async () => {
    setImporting(true);
    try {
      const { data } = await api.post("/clients/import/confirm", { rows: preview.preview, mode: impMode, actualizar_saldo: impSaldo });
      toast.success(`${data.creados} creados · ${data.actualizados} actualizados · ${data.omitidos} omitidos`);
      setImpOpen(false); setPreview(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setImporting(false); }
  };
  const downloadErrores = () => {
    const errs = preview.preview.filter((r) => r.errores?.length);
    const lines = [["Fila", "Clave", "Nombre", "Campo", "Valor", "Motivo"].join("\t")];
    errs.forEach((r) => r.errores.forEach((e) => lines.push([r.fila, r.clave, r.nombre, e.campo, e.valor, e.motivo].join("\t"))));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "errores_importacion_clientes.csv"; link.click();
  };

  // Helpers de formulario
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const visibleCols = useMemo(() => {
    if (!hideEmpty) return COLS;
    return COLS.filter((c) => c.always || c.special || rows.some((r) => !isEmptyVal(colVal(r, c.key))));
  }, [hideEmpty, rows]);
  const sorted = useMemo(() => {
    const arr = [...rows];
    const col = COLS.find((c) => c.key === sort.key) || {};
    arr.sort((a, b) => {
      let x = colVal(a, sort.key), y = colVal(b, sort.key);
      if (col.num) { x = Number(x || 0); y = Number(y || 0); return sort.dir === "asc" ? x - y : y - x; }
      if (sort.key === "credito_autorizado") { x = a.credito_autorizado ? 1 : 0; y = b.credito_autorizado ? 1 : 0; return sort.dir === "asc" ? x - y : y - x; }
      const r = String(x || "").localeCompare(String(y || ""), "es", { numeric: true });
      return sort.dir === "asc" ? r : -r;
    });
    return arr;
  }, [rows, sort]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = useMemo(() => sorted.slice(page * pageSize, page * pageSize + pageSize), [sorted, page, pageSize]);
  useEffect(() => { setPage(0); }, [filtro, pageSize, rows.length]);


  const I = (label, k, type = "text", cls = "") => (
    <div className={cls}><Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label>
      <Input type={type} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="mt-1" data-testid={`cli-${k}`} /></div>
  );
  const SW = (label, k) => (
    <div className="flex items-center justify-between border border-slate-200 rounded-md px-3 h-10">
      <span className="text-sm">{label}</span>
      <Switch checked={!!f[k]} onCheckedChange={(v) => set(k, v)} data-testid={`cli-${k}`} />
    </div>
  );

  return (
    <div className="space-y-5" data-testid="clientes-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Clientes</h1>
          <p className="text-slate-500 text-sm">{rows.length} clientes · estructura completa (52 campos)</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadPlantilla} data-testid="cli-plantilla"><FileDown className="w-4 h-4 mr-1" /> Plantilla</Button>
          {can("importar") && <Button variant="outline" onClick={() => fileRef.current.click()} data-testid="cli-import-btn"><Upload className="w-4 h-4 mr-1" /> Importar</Button>}
          <Button variant="outline" onClick={exportExcel} data-testid="cli-export"><Download className="w-4 h-4 mr-1" /> Exportar</Button>
          {can("cliente.crear") && <Button onClick={openNew} data-testid="nuevo-cliente-btn" className="bg-[#0055A4] hover:bg-[#004385]"><Plus className="w-4 h-4 mr-1" /> Nuevo</Button>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFile} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 bg-white border border-slate-200 rounded-md p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar por clave, nombre, RFC, representante, teléfono, correo, ciudad..." value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="pl-9" data-testid="buscar-cliente" />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-44" data-testid="filtro-clientes"><SelectValue placeholder="Filtro" /></SelectTrigger>
          <SelectContent>{FILTROS.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={load} data-testid="cli-buscar"><Search className="w-4 h-4" /></Button>
        <Button variant={hideEmpty ? "default" : "outline"} onClick={() => setHideEmpty((v) => !v)}
          className={hideEmpty ? "bg-[#0055A4] hover:bg-[#004385]" : ""} data-testid="cli-hide-empty" title="Ocultar columnas sin datos">
          {hideEmpty ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />} Columnas vacías
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50"><tr className="text-xs uppercase tracking-wider text-slate-500">
            {visibleCols.map((col) => (
              <th key={col.key} onClick={() => toggleSort(col.key)} data-testid={`sort-${col.key}`}
                className={`p-3 cursor-pointer select-none hover:text-[#0055A4] ${col.right ? "text-right" : col.center ? "text-center" : "text-left"}`}>
                <span className={`inline-flex items-center gap-1 ${col.right ? "flex-row-reverse" : ""}`}>
                  {col.label}
                  {sort.key === col.key
                    ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                    : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                </span>
              </th>
            ))}
            <th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={visibleCols.length + 1} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#0055A4]" /></td></tr>}
            {!loading && pageRows.length === 0 && <tr><td colSpan={visibleCols.length + 1} className="p-10 text-center text-slate-400"><Users className="w-8 h-8 mx-auto mb-2" />Sin clientes.</td></tr>}
            {!loading && pageRows.map((c) => {
              const cs = creditStatus(c);
              return (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`cli-row-${c.codigo}`}>
                  {visibleCols.map((col) => {
                    if (col.special === "credito") return (
                      <td key={col.key} className="p-3">
                        <div className="flex items-center justify-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${cs.dot}`} title={cs.label} data-testid={`cli-credito-dot-${c.codigo}`} />
                          <Switch checked={!!c.credito_autorizado} disabled={!can("credito.autorizar")}
                            onCheckedChange={(v) => toggleCredito(c, v)} data-testid={`cli-credito-switch-${c.codigo}`} />
                        </div>
                      </td>
                    );
                    if (col.special === "estado") return (
                      <td key={col.key} className="p-3">
                        {can("cliente.editar") ? (
                          <Select value={c.estado || "activo"} onValueChange={(v) => changeEstado(c, v)}>
                            <SelectTrigger className="h-8 w-32" data-testid={`cli-estado-${c.codigo}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="activo">Activo</SelectItem>
                              <SelectItem value="suspendido">Suspendido</SelectItem>
                              <SelectItem value="inactivo">Inactivo</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : <Badge className={estadoBadge[c.estado]}>{c.estado}</Badge>}
                      </td>
                    );
                    const v = colVal(c, col.key);
                    const cls = col.key === "codigo" ? "font-medium text-[#0055A4]"
                      : col.key === "nombre" ? "max-w-[220px] truncate"
                      : col.key === "saldo" ? `font-semibold ${c.saldo > 0 ? "text-red-600" : ""}`
                      : (col.money || col.center) ? "" : "text-slate-500";
                    return (
                      <td key={col.key} className={`p-3 ${col.right ? "text-right" : col.center ? "text-center" : ""} ${cls}`}
                        title={col.key === "nombre" ? c.nombre : undefined}>
                        {col.money ? money(v) : v}
                      </td>
                    );
                  })}
                  <td className="p-3 text-right">
                    {can("cliente.editar") && <Button size="icon" variant="ghost" onClick={() => openEdit(c)} data-testid={`edit-cli-${c.codigo}`}><Pencil className="w-4 h-4" /></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Barra de navegación / paginación */}
      {!loading && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 text-slate-500">
            <span data-testid="cli-count">{sorted.length} clientes</span>
            <span className="text-slate-300">·</span>
            <span>Mostrar</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-20" data-testid="cli-page-size"><SelectValue /></SelectTrigger>
              <SelectContent>{[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(0)} data-testid="cli-first-page">«</Button>
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} data-testid="cli-prev-page"><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-slate-500 px-2" data-testid="cli-page-info">Página {page + 1} de {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} data-testid="cli-next-page"><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(totalPages - 1)} data-testid="cli-last-page">»</Button>
          </div>
        </div>
      )}

      {/* Formulario cliente con pestañas */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="cliente-form">
          <DialogHeader><DialogTitle className="font-display">{editId ? `Editar cliente · ${f.codigo}` : "Nuevo cliente"}</DialogTitle></DialogHeader>
          <Tabs defaultValue="general">
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
              <TabsTrigger value="contacto" data-testid="tab-contacto">Contacto</TabsTrigger>
              <TabsTrigger value="direccion" data-testid="tab-direccion">Dirección</TabsTrigger>
              <TabsTrigger value="fiscal" data-testid="tab-fiscal">Fiscales</TabsTrigger>
              <TabsTrigger value="comercial" data-testid="tab-comercial">Comercial</TabsTrigger>
              <TabsTrigger value="credito" data-testid="tab-credito">Crédito</TabsTrigger>
              <TabsTrigger value="retenciones" data-testid="tab-retenciones">Retenciones</TabsTrigger>
              <TabsTrigger value="stats" data-testid="tab-stats">Estadísticas</TabsTrigger>
              <TabsTrigger value="comentarios" data-testid="tab-comentarios">Comentarios</TabsTrigger>
              <TabsTrigger value="config" data-testid="tab-config">Configuración</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              {I("Clave *", "codigo")}
              <div className="col-span-1 md:col-span-2">{I("Nombre *", "nombre")}</div>
              {I("Razón social", "razon_social", "text", "col-span-2 md:col-span-2")}
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Tipo</Label>
                <Select value={f.tipo} onValueChange={(v) => set("tipo", v)}>
                  <SelectTrigger className="mt-1" data-testid="cli-tipo"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(tipoLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Estado</Label>
                <Select value={f.estado} onValueChange={(v) => set("estado", v)}>
                  <SelectTrigger className="mt-1" data-testid="cli-estado-form"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="activo">Activo</SelectItem><SelectItem value="suspendido">Suspendido</SelectItem><SelectItem value="inactivo">Inactivo</SelectItem></SelectContent>
                </Select></div>
              {I("Fecha de alta", "fecha_alta", "date")}
            </TabsContent>

            <TabsContent value="contacto" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              {I("Representante", "representa", "text", "col-span-2 md:col-span-3")}
              {I("Tel. oficina", "tel_oficina")}
              {I("Tel. residencia", "tel_residencia")}
              {I("Tel. / Fax", "tel_fax")}
              {I("Celular", "celular")}
              {I("WhatsApp", "whatsapp")}
              {I("Correos (separados por coma)", "correos", "text", "col-span-2 md:col-span-3")}
            </TabsContent>

            <TabsContent value="direccion" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              {I("Dirección / Calle", "direccion", "text", "col-span-2 md:col-span-3")}
              {I("Núm. exterior", "numero_exterior")}
              {I("Núm. interior", "numero_interior")}
              {I("Colonia", "colonia")}
              {I("Ciudad-Edo (legacy)", "ciudad_edo")}
              {I("Localidad", "localidad")}
              {I("Ciudad", "ciudad")}
              {I("Estado", "estado_geo")}
              {I("País", "pais")}
              {I("Código postal", "cp")}
              <div className="col-span-2 md:col-span-3"><Label className="text-xs uppercase tracking-wider text-slate-500">Referencia</Label>
                <Textarea value={f.referencias} onChange={(e) => set("referencias", e.target.value)} className="mt-1" data-testid="cli-referencias" /></div>
            </TabsContent>

            <TabsContent value="fiscal" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              {I("RFC", "rfc")}
              {I("Régimen fiscal", "reg_fiscal")}
              {I("Uso CFDI", "uso_cfdi")}
              {I("Res. fiscal", "resfiscal")}
              {I("Núm. reg. id. trib.", "nregidtrib", "text", "col-span-2")}
            </TabsContent>

            <TabsContent value="comercial" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              {I("Vendedor", "vendedor")}
              {I("Almacén", "almacen")}
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Lista de precios predeterminada</Label>
                <Select value={String(f.precio_venta || 1)} onValueChange={(v) => set("precio_venta", v)} disabled={!can("producto.precio")}>
                  <SelectTrigger className="mt-1" data-testid="cli-precio_venta"><SelectValue /></SelectTrigger>
                  <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>Precio {n}</SelectItem>)}<SelectItem value="6">Precio mínimo</SelectItem></SelectContent>
                </Select>
                {!can("producto.precio") && <p className="text-[10px] text-slate-400 mt-1">Solo Admin/Gerente puede cambiarla.</p>}</div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Descuento permanente (%)</Label>
                <Input type="number" value={f.descuento_permanente ?? 0} onChange={(e) => set("descuento_permanente", e.target.value)} className="mt-1" disabled={!can("producto.precio")} data-testid="cli-descuento_permanente" />
                {!can("producto.precio") && <p className="text-[10px] text-slate-400 mt-1">Solo Admin/Gerente puede cambiarlo.</p>}</div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Condición de pago</Label>
                <Select value={f.condicion_pago} onValueChange={(v) => set("condicion_pago", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="contado">Contado</SelectItem><SelectItem value="credito">Crédito</SelectItem></SelectContent>
                </Select></div>
            </TabsContent>

            <TabsContent value="credito" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2 items-end">
              {can("credito.autorizar")
                ? SW("Crédito autorizado", "credito_autorizado")
                : <div className="col-span-2 text-xs text-slate-400 self-center">Solo administrador/encargado autoriza crédito.</div>}
              {I("Límite de crédito", "limite_credito", "number")}
              {I("Límite de descuento (%)", "lim_descuento", "number")}
              {I("Días de crédito", "dias_credito", "number")}
              {I("Venta a crédito acumulada", "venta_credito", "number")}
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Saldo actual</Label>
                <Input value={money(f.saldo)} disabled className="mt-1 bg-slate-50" data-testid="cli-saldo-ro" />
                <p className="text-[10px] text-slate-400 mt-1">El saldo se controla por ventas, no se edita aquí.</p></div>
            </TabsContent>

            <TabsContent value="retenciones" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2 items-end">
              {SW("Retiene ISR", "ret_isr")}
              {SW("Retiene IVA", "ret_iva")}
              <div />
              {I("Tasa ret. ISR (%)", "ret_isr_tasa", "number")}
              {I("Tasa ret. IVA (%)", "ret_iva_tasa", "number")}
            </TabsContent>

            <TabsContent value="stats" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              {I("Compra mensual", "mensual", "number")}
              {I("Compra anual", "anual", "number")}
              {I("Última fecha compra", "ult_fecha_compra", "date")}
              {I("Último monto compra", "ult_monto_compra", "number")}
            </TabsContent>

            <TabsContent value="comentarios" className="pt-2">
              <Label className="text-xs uppercase tracking-wider text-slate-500">Comentario</Label>
              <Textarea value={f.comentario} onChange={(e) => set("comentario", e.target.value)} className="mt-1 min-h-[140px]" data-testid="cli-comentario" />
            </TabsContent>

            <TabsContent value="config" className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2 items-end">
              {SW("Recibe ofertas", "ofertas")}
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Estado</Label>
                <Select value={f.estado} onValueChange={(v) => set("estado", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="activo">Activo</SelectItem><SelectItem value="suspendido">Suspendido</SelectItem><SelectItem value="inactivo">Inactivo</SelectItem></SelectContent>
                </Select></div>
              {I("Contraseña (portal)", "contrasena")}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="cli-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Importación con preview */}
      <Dialog open={impOpen} onOpenChange={(o) => { if (!o) { setImpOpen(false); setPreview(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="import-dialog">
          <DialogHeader><DialogTitle className="font-display">Importar clientes</DialogTitle></DialogHeader>
          {!preview ? (
            <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-[#0055A4]" /></div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Total</div><div className="font-display font-bold text-lg" data-testid="imp-total">{preview.total}</div></div>
                <div className="bg-green-50 rounded p-3"><div className="text-xs text-slate-400">Nuevos</div><div className="font-display font-bold text-lg text-green-700" data-testid="imp-nuevos">{preview.nuevos}</div></div>
                <div className="bg-blue-50 rounded p-3"><div className="text-xs text-slate-400">A actualizar</div><div className="font-display font-bold text-lg text-[#0055A4]" data-testid="imp-existentes">{preview.existentes}</div></div>
                <div className="bg-red-50 rounded p-3"><div className="text-xs text-slate-400">Con errores</div><div className="font-display font-bold text-lg text-red-600" data-testid="imp-errores">{preview.con_errores}</div></div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Modo</Label>
                  <Select value={impMode} onValueChange={setImpMode}>
                    <SelectTrigger className="w-52" data-testid="imp-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ambos">Crear y actualizar</SelectItem>
                      <SelectItem value="nuevos">Solo crear nuevos</SelectItem>
                      <SelectItem value="actualizar">Solo actualizar existentes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 rounded-md px-3 py-1.5">
                  <Switch checked={impSaldo} onCheckedChange={setImpSaldo} data-testid="imp-saldo" />
                  <span className="text-xs text-amber-800">Importar/actualizar saldos desde el archivo</span>
                </div>
                {preview.con_errores > 0 && <Button variant="outline" size="sm" onClick={downloadErrores} data-testid="imp-download-errores"><FileDown className="w-4 h-4 mr-1" /> Descargar errores</Button>}
              </div>

              <div className="border border-slate-200 rounded-md max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-slate-500 uppercase tracking-wider">
                    <th className="p-2">Fila</th><th className="p-2">Clave</th><th className="p-2">Nombre</th><th className="p-2">Acción</th><th className="p-2">Detalle</th>
                  </tr></thead>
                  <tbody>
                    {preview.preview.slice(0, 300).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2">{r.fila}</td>
                        <td className="p-2 font-medium">{r.clave}</td>
                        <td className="p-2 max-w-[180px] truncate">{r.nombre}</td>
                        <td className="p-2">
                          {r.errores?.length
                            ? <span className="inline-flex items-center gap-1 text-red-600"><X className="w-3 h-3" /> omitir</span>
                            : r.existe
                              ? <span className="inline-flex items-center gap-1 text-[#0055A4]"><RefreshCw className="w-3 h-3" /> actualizar</span>
                              : <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="w-3 h-3" /> crear</span>}
                        </td>
                        <td className="p-2 text-slate-500">
                          {r.errores?.length ? <span className="inline-flex items-center gap-1 text-red-500"><AlertTriangle className="w-3 h-3" /> {r.errores.map((e) => e.motivo).join("; ")}</span> : "OK"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImpOpen(false); setPreview(null); }}>Cancelar</Button>
            <Button onClick={confirmImport} disabled={!preview || importing} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="imp-confirm">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar importación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
