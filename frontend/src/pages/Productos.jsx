import { useEffect, useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import ProductForm from "@/components/ProductForm";
import { TableScroller } from "@/components/TableScroller";
import { toast } from "sonner";
import { Plus, Search, Download, Upload, Pencil, History, Loader2, Boxes, FileDown, ArrowDownUp, ArrowUp, ArrowDown } from "lucide-react";
const dot = (p) => {
  const ex = Number(p.existencia || 0), min = Number(p.stock_minimo || 0);
  if (ex <= 0) return ["bg-red-500", "Sin existencia"];
  if (ex <= min) return ["bg-amber-500", "Stock bajo"];
  return ["bg-green-500", "Stock normal"];
};
const estadoBadge = { activo: "bg-green-100 text-green-700", baja: "bg-slate-200 text-slate-600", suspendido: "bg-amber-100 text-amber-700" };
const MOV_TIPOS = [
  { v: "entrada", label: "Entrada", cls: "bg-green-100 text-green-700" },
  { v: "salida", label: "Salida", cls: "bg-red-100 text-red-700" },
  { v: "ajuste", label: "Ajuste (+/-)", cls: "bg-blue-100 text-blue-700" },
  { v: "merma", label: "Merma", cls: "bg-orange-100 text-orange-700" },
  { v: "devolucion", label: "Devolución", cls: "bg-teal-100 text-teal-700" },
];
const movBadge = (t) => (MOV_TIPOS.find((x) => x.v === t)?.cls) || "bg-slate-100 text-slate-600";
const fmtFecha = (f) => (f || "").slice(0, 16).replace("T", " ");

export default function Productos() {
  const { can } = useAuth();
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("all");
  const [filtro, setFiltro] = useState("all");
  const [categoria, setCategoria] = useState(location.state?.categoria || "all");
  const [categorias, setCategorias] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [movProd, setMovProd] = useState(null);
  const [movs, setMovs] = useState([]);
  const [movForm, setMovForm] = useState({ tipo: "entrada", cantidad: "", costo: "", documento: "", motivo: "", observaciones: "" });
  const [savingMov, setSavingMov] = useState(false);
  const [gOpen, setGOpen] = useState(false);
  const [gMovs, setGMovs] = useState([]);
  const [gTotal, setGTotal] = useState(0);
  const [gLoading, setGLoading] = useState(false);
  const [gf, setGf] = useState({ tipo: "all", q: "", desde: "", hasta: "" });
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [importMode, setImportMode] = useState("ambos");
  const [actExist, setActExist] = useState(false);
  const [progress, setProgress] = useState(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [nonce, setNonce] = useState(0);
  const pageSize = 50;
  const [sort, setSort] = useState({ key: "", dir: "asc" });
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sorted = [...rows];
  if (sort.key) {
    const numFields = ["costo", "existencia", "stock_minimo"];
    sorted.sort((a, b) => {
      const getV = (r) => {
        if (sort.key === "precio") return r.precios?.[0]?.precio_con_iva ?? 0;
        if (sort.key === "utilidad") { const psi = r.precios?.[0]?.precio_sin_iva ?? 0; return psi - (r.costo || 0); }
        return r[sort.key];
      };
      let x = getV(a), y = getV(b);
      if (numFields.includes(sort.key) || sort.key === "precio" || sort.key === "utilidad") { x = Number(x || 0); y = Number(y || 0); return sort.dir === "asc" ? x - y : y - x; }
      const r = String(x || "").localeCompare(String(y || ""), "es", { numeric: true });
      return sort.dir === "asc" ? r : -r;
    });
  }
  const fileRef = useRef();

  const load = async () => {
    setLoading(true);
    const params = { skip: page * pageSize, limit: pageSize };
    if (q) params.q = q;
    if (estado !== "all") params.estado = estado;
    if (filtro !== "all") params.filtro = filtro;
    if (categoria !== "all") params.categoria = categoria;
    const res = await api.get("/products", { params });
    setRows(res.data);
    setTotal(Number(res.headers["x-total-count"] ?? res.data.length));
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [estado, filtro, categoria, page, nonce]);
  useEffect(() => {
    api.get("/categories").then(({ data }) => setCategorias(data)).catch(() => {});
  }, []);
  const doSearch = () => { setPage(0); setNonce((n) => n + 1); };

  const openMovs = async (p) => {
    setMovProd(p);
    setMovForm({ tipo: "entrada", cantidad: "", costo: p.costo ? String(p.costo) : "", documento: "", motivo: "", observaciones: "" });
    const { data } = await api.get(`/products/${p.id}/movimientos`);
    setMovs(data);
  };

  const submitMov = async () => {
    const cant = Number(movForm.cantidad);
    if (!cant || (movForm.tipo !== "ajuste" && cant <= 0)) return toast.error("Ingresa una cantidad válida");
    setSavingMov(true);
    try {
      await api.post(`/products/${movProd.id}/ajuste`, {
        tipo: movForm.tipo,
        cantidad: cant,
        concepto: movForm.observaciones || "",
        documento: movForm.documento || "",
        costo: Number(movForm.costo) || 0,
        motivo: movForm.motivo || "",
        observaciones: movForm.observaciones || "",
      });
      toast.success("Movimiento registrado");
      setMovForm({ tipo: "entrada", cantidad: "", costo: movProd.costo ? String(movProd.costo) : "", documento: "", motivo: "", observaciones: "" });
      const { data } = await api.get(`/products/${movProd.id}/movimientos`);
      setMovs(data);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingMov(false); }
  };

  const loadGlobal = async () => {
    setGLoading(true);
    try {
      const params = { limit: 300 };
      if (gf.tipo !== "all") params.tipo = gf.tipo;
      if (gf.q) params.q = gf.q;
      if (gf.desde) params.desde = gf.desde;
      if (gf.hasta) params.hasta = gf.hasta;
      const { data } = await api.get("/inventory/movements", { params });
      setGMovs(data.movimientos);
      setGTotal(data.total);
    } catch (e) { toast.error("Error al cargar movimientos"); }
    finally { setGLoading(false); }
  };
  const openGlobal = () => { setGOpen(true); loadGlobal(); };

  const changeEstado = async (p, e) => {
    await api.patch(`/products/${p.id}/estado`, null, { params: { estado: e } });
    toast.success("Estado actualizado");
    load();
  };

  const download = async (url, filename) => {
    try {
      const res = await api.get(url, { responseType: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(res.data);
      link.download = filename;
      link.click();
    } catch (e) { toast.error("Error al exportar"); }
  };

  const exportExcel = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (estado !== "all") params.set("estado", estado);
    download(`/products/export/excel?${params}`, "productos.xlsx");
  };

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/products/import/preview", fd);
      setPreview(data);
      setImportOpen(true);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    e.target.value = "";
  };

  const confirmImport = async () => {
    const valid = preview.preview.filter((r) => !r.errores?.length);
    if (valid.length === 0) return toast.error("No hay filas válidas para importar");
    const chunk = 500;
    let creados = 0, actualizados = 0, omitidos = 0;
    setProgress({ done: 0, total: valid.length });
    try {
      for (let i = 0; i < valid.length; i += chunk) {
        const part = valid.slice(i, i + chunk);
        const { data } = await api.post("/products/import/confirm", { rows: part, mode: importMode, actualizar_existencia: actExist });
        creados += data.creados; actualizados += data.actualizados; omitidos += data.omitidos;
        setProgress({ done: Math.min(i + chunk, valid.length), total: valid.length });
      }
      toast.success(`${creados} creados, ${actualizados} actualizados, ${omitidos} omitidos`);
      setImportOpen(false); setPreview(null); setPage(0); setNonce((n) => n + 1);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setProgress(null); }
  };

  const downloadErrors = () => {
    const lines = [["fila", "codigo", "campo", "valor", "motivo"]];
    preview.preview.forEach((r) => (r.errores || []).forEach((e) => lines.push([r.fila, r.codigo, e.campo, e.valor, e.motivo])));
    const csv = lines.map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "errores_importacion.csv"; a.click();
  };

  return (
    <div className="space-y-5" data-testid="productos-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Productos e Inventario</h1>
          <p className="text-slate-500 text-sm">{total} productos</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => download("/products/plantilla/excel", "plantilla_productos.xlsx")} data-testid="plantilla-btn"><FileDown className="w-4 h-4 mr-1" /> Plantilla</Button>
          {can("importar") && <Button variant="outline" onClick={() => fileRef.current.click()} data-testid="import-btn"><Upload className="w-4 h-4 mr-1" /> Importar</Button>}
          <Button variant="outline" onClick={exportExcel} data-testid="export-btn"><Download className="w-4 h-4 mr-1" /> Exportar</Button>
          <Button variant="outline" onClick={openGlobal} data-testid="movimientos-btn"><ArrowDownUp className="w-4 h-4 mr-1" /> Movimientos</Button>
          {can("producto.crear") && <Button onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="nuevo-producto-btn" className="bg-[#C1401E] hover:bg-[#A03316]"><Plus className="w-4 h-4 mr-1" /> Nuevo</Button>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFile} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center card-soft p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar por código, descripción, SKU, línea..." value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
            className="pl-9" data-testid="buscar-producto" />
        </div>
        <Select value={estado} onValueChange={(v) => { setEstado(v); setPage(0); }}>
          <SelectTrigger className="w-40" data-testid="filtro-estado"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="activo">Activos</SelectItem>
            <SelectItem value="baja">Baja</SelectItem>
            <SelectItem value="suspendido">Suspendidos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtro} onValueChange={(v) => { setFiltro(v); setPage(0); }}>
          <SelectTrigger className="w-40" data-testid="filtro-stock"><SelectValue placeholder="Stock" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo stock</SelectItem>
            <SelectItem value="bajo_stock">Bajo stock</SelectItem>
            <SelectItem value="sin_existencia">Sin existencia</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoria} onValueChange={(v) => { setCategoria(v); setPage(0); }}>
          <SelectTrigger className="w-48" data-testid="filtro-categoria"><SelectValue placeholder="Categoría" /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">Todas las categorías</SelectItem>
            {categorias.map((c) => (
              <SelectItem key={c.nombre} value={c.nombre}>{c.nombre} ({c.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={doSearch}><Search className="w-4 h-4" /></Button>
      </div>

      <div className="card-soft">
        <TableScroller testid="productos-scroller">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              {[{ key: "estado", label: "Estado", noSort: true }, { key: "codigo", label: "Código" }, { key: "descripcion", label: "Descripción" },
                { key: "linea", label: "Línea" }, { key: "clasificacion", label: "Clasifica" },
                { key: "costo", label: "Costo", right: true }, { key: "existencia", label: "Exist.", right: true },
                { key: "unidad_medida", label: "U.M." },
                { key: "precio", label: "Precio", right: true }, { key: "utilidad", label: "Utilidad", right: true },
                { key: "stock_minimo", label: "Min", right: true }].map((col) => (
                <th key={col.key} onClick={() => !col.noSort && toggleSort(col.key)} className={`p-3 select-none ${col.noSort ? "" : "cursor-pointer hover:text-[#C1401E]"} ${col.right ? "text-right" : "text-left"}`}>
                  <span className={`inline-flex items-center gap-1 ${col.right ? "flex-row-reverse" : ""}`}>
                    {col.label}
                    {sort.key === col.key ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : !col.noSort && <ArrowDownUp className="w-3 h-3 opacity-30" />}
                  </span>
                </th>
              ))}
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={12} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
            {!loading && sorted.length === 0 && <tr><td colSpan={12} className="p-10 text-center text-slate-400"><Boxes className="w-8 h-8 mx-auto mb-2" />Sin productos. Crea el primero.</td></tr>}
            {!loading && sorted.map((p) => {
              const [color, label] = dot(p);
              return (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`prod-row-${p.codigo}`}>
                  <td className="p-3"><div className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${color}`} title={label} /><Badge className={estadoBadge[p.estado]}>{p.estado}</Badge></div></td>
                  <td className="p-3 font-medium text-[#C1401E]">{p.codigo}</td>
                  <td className="p-3 max-w-xs truncate">{p.descripcion}</td>
                  <td className="p-3 text-slate-500">{p.linea}</td>
                  <td className="p-3 text-slate-500">{p.clasificacion || "—"}</td>
                  <td className="p-3 text-right">{money(p.costo)}</td>
                  <td className="p-3 text-right font-semibold">{p.existencia}</td>
                  <td className="p-3">{p.unidad_medida}</td>
                  <td className="p-3 text-right">{money(p.precios?.[0]?.precio_con_iva)}</td>
                  <td className="p-3 text-right" data-testid={`prod-utilidad-${p.codigo}`}>
                    {(() => { const psi = p.precios?.[0]?.precio_sin_iva ?? 0; const u = psi - (p.costo || 0); const m = psi ? (u / psi * 100) : 0; return (<span className={u > 0 ? "text-emerald-700 font-semibold" : "text-red-600"}>{money(u)} <span className="text-xs text-slate-400">({m.toFixed(0)}%)</span></span>); })()}
                  </td>
                  <td className="p-3 text-right text-slate-500">{p.stock_minimo}</td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" onClick={() => openMovs(p)} title="Movimientos" data-testid={`mov-${p.codigo}`}><History className="w-4 h-4" /></Button>
                      {can("producto.editar") && <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setFormOpen(true); }} data-testid={`edit-${p.codigo}`}><Pencil className="w-4 h-4" /></Button>}
                      {can("producto.baja") && (
                        <Select value={p.estado} onValueChange={(e) => changeEstado(p, e)}>
                          <SelectTrigger className="h-8 w-8 p-0 justify-center border-0"><span className="text-xs">···</span></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="activo">Activar</SelectItem>
                            <SelectItem value="suspendido">Suspender</SelectItem>
                            <SelectItem value="baja">Dar de baja</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </TableScroller>
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500" data-testid="prod-total">{total} productos · página {page + 1} de {Math.max(1, Math.ceil(total / pageSize))}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} data-testid="prev-page">Anterior</Button>
          <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)} data-testid="next-page">Siguiente</Button>
        </div>
      </div>

      <ProductForm open={formOpen} onClose={() => setFormOpen(false)} product={editing} onSaved={load} />

      {/* Movimientos / Kardex por producto */}
      <Dialog open={!!movProd} onOpenChange={(o) => !o && setMovProd(null)}>
        <DialogContent className="max-w-3xl" data-testid="kardex-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Kardex · {movProd?.descripcion}</DialogTitle>
            <p className="text-sm text-slate-500">Existencia actual: <span className="font-semibold text-slate-700" data-testid="kardex-existencia">{movProd?.existencia}</span> {movProd?.unidad_medida}</p>
          </DialogHeader>

          {can("inventario.ajuste") && (
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-3" data-testid="mov-form">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Tipo</Label>
                  <Select value={movForm.tipo} onValueChange={(v) => setMovForm((f) => ({ ...f, tipo: v }))}>
                    <SelectTrigger className="h-9" data-testid="mov-tipo"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MOV_TIPOS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Cantidad {movForm.tipo === "ajuste" && "(+/-)"}</Label>
                  <Input type="number" step="any" value={movForm.cantidad} onChange={(e) => setMovForm((f) => ({ ...f, cantidad: e.target.value }))} className="h-9" data-testid="mov-cantidad" placeholder="0" />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Costo unitario</Label>
                  <Input type="number" step="any" value={movForm.costo} onChange={(e) => setMovForm((f) => ({ ...f, costo: e.target.value }))} className="h-9" data-testid="mov-costo" placeholder="0.00" />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Documento</Label>
                  <Input value={movForm.documento} onChange={(e) => setMovForm((f) => ({ ...f, documento: e.target.value }))} className="h-9" data-testid="mov-documento" placeholder="Factura / Ref." />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Motivo</Label>
                  <Input value={movForm.motivo} onChange={(e) => setMovForm((f) => ({ ...f, motivo: e.target.value }))} className="h-9" data-testid="mov-motivo" placeholder="Compra, merma por daño, ajuste físico..." />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Observaciones</Label>
                  <Textarea rows={1} value={movForm.observaciones} onChange={(e) => setMovForm((f) => ({ ...f, observaciones: e.target.value }))} className="min-h-9" data-testid="mov-observaciones" placeholder="Notas adicionales..." />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={submitMov} disabled={savingMov} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="mov-guardar">
                  {savingMov ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />} Registrar movimiento
                </Button>
              </div>
            </div>
          )}

          <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-xs uppercase text-slate-500">
                <th className="p-2">Fecha</th><th className="p-2">Movimiento</th><th className="p-2">Doc</th><th className="p-2">Motivo</th>
                <th className="p-2 text-right">Entrada</th><th className="p-2 text-right">Salida</th><th className="p-2 text-right">Exist.</th>
              </tr></thead>
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="p-2 text-slate-500">{fmtFecha(m.fecha)}</td>
                    <td className="p-2"><Badge className={movBadge(m.tipo)}>{m.tipo}</Badge></td>
                    <td className="p-2">{m.documento}</td>
                    <td className="p-2 text-slate-500 truncate max-w-[140px]" title={m.motivo || m.observaciones}>{m.motivo || m.observaciones}</td>
                    <td className="p-2 text-right text-green-600">{m.entrada || ""}</td>
                    <td className="p-2 text-right text-red-600">{m.salida || ""}</td>
                    <td className="p-2 text-right font-semibold">{m.existencia_resultante}</td>
                  </tr>
                ))}
                {movs.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">Sin movimientos.</td></tr>}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Movimientos globales de inventario */}
      <Dialog open={gOpen} onOpenChange={setGOpen}>
        <DialogContent className="max-w-5xl" data-testid="movimientos-globales-dialog">
          <DialogHeader><DialogTitle className="font-display">Movimientos de Inventario</DialogTitle></DialogHeader>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input placeholder="Producto, código, documento, usuario..." value={gf.q}
                onChange={(e) => setGf((f) => ({ ...f, q: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && loadGlobal()}
                className="pl-9 h-9" data-testid="gmov-q" />
            </div>
            <Select value={gf.tipo} onValueChange={(v) => setGf((f) => ({ ...f, tipo: v }))}>
              <SelectTrigger className="w-40 h-9" data-testid="gmov-tipo"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {MOV_TIPOS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                <SelectItem value="venta">Venta</SelectItem>
                <SelectItem value="correccion">Corrección</SelectItem>
              </SelectContent>
            </Select>
            <div>
              <Label className="text-xs text-slate-500">Desde</Label>
              <Input type="date" value={gf.desde} onChange={(e) => setGf((f) => ({ ...f, desde: e.target.value }))} className="h-9 w-40" data-testid="gmov-desde" />
            </div>
            <div>
              <Label className="text-xs text-slate-500">Hasta</Label>
              <Input type="date" value={gf.hasta} onChange={(e) => setGf((f) => ({ ...f, hasta: e.target.value }))} className="h-9 w-40" data-testid="gmov-hasta" />
            </div>
            <Button variant="outline" onClick={loadGlobal} className="h-9" data-testid="gmov-buscar"><Search className="w-4 h-4" /></Button>
          </div>
          <div className="max-h-[26rem] overflow-y-auto border border-slate-200 rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-xs uppercase text-slate-500">
                <th className="p-2">Fecha</th><th className="p-2">Código</th><th className="p-2">Producto</th><th className="p-2">Tipo</th>
                <th className="p-2">Doc</th><th className="p-2">Motivo</th><th className="p-2">Usuario</th>
                <th className="p-2 text-right">Entrada</th><th className="p-2 text-right">Salida</th><th className="p-2 text-right">Exist.</th>
              </tr></thead>
              <tbody>
                {gLoading && <tr><td colSpan={10} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
                {!gLoading && gMovs.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`gmov-row-${m.id}`}>
                    <td className="p-2 text-slate-500 whitespace-nowrap">{fmtFecha(m.fecha)}</td>
                    <td className="p-2 font-medium text-[#C1401E]">{m.codigo}</td>
                    <td className="p-2 max-w-[200px] truncate" title={m.descripcion}>{m.descripcion}</td>
                    <td className="p-2"><Badge className={movBadge(m.tipo)}>{m.tipo}</Badge></td>
                    <td className="p-2">{m.documento}</td>
                    <td className="p-2 text-slate-500 max-w-[160px] truncate" title={m.motivo || m.observaciones}>{m.motivo || m.observaciones}</td>
                    <td className="p-2 text-slate-500">{m.usuario_nombre}</td>
                    <td className="p-2 text-right text-green-600">{m.entrada || ""}</td>
                    <td className="p-2 text-right text-red-600">{m.salida || ""}</td>
                    <td className="p-2 text-right font-semibold">{m.existencia_resultante}</td>
                  </tr>
                ))}
                {!gLoading && gMovs.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-slate-400">Sin movimientos.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400" data-testid="gmov-total">{gTotal} movimientos {gMovs.length < gTotal && `(mostrando ${gMovs.length})`}</p>
        </DialogContent>
      </Dialog>

      {/* Import preview */}
      <Dialog open={importOpen} onOpenChange={(o) => !progress && setImportOpen(o)}>
        <DialogContent className="max-w-3xl" data-testid="import-preview">
          <DialogHeader><DialogTitle className="font-display">Vista previa de importación (85 columnas)</DialogTitle></DialogHeader>
          {preview && (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-slate-50 rounded p-2"><div className="text-xs text-slate-400">Total</div><div className="font-display font-bold" data-testid="prev-total">{preview.total}</div></div>
                <div className="bg-green-50 rounded p-2"><div className="text-xs text-slate-400">Nuevos</div><div className="font-display font-bold text-green-700" data-testid="prev-nuevos">{preview.nuevos}</div></div>
                <div className="bg-blue-50 rounded p-2"><div className="text-xs text-slate-400">Existentes</div><div className="font-display font-bold text-blue-700" data-testid="prev-existentes">{preview.existentes}</div></div>
                <div className="bg-red-50 rounded p-2"><div className="text-xs text-slate-400">Con errores</div><div className="font-display font-bold text-red-600" data-testid="prev-errores">{preview.con_errores}</div></div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Modo</Label>
                  <Select value={importMode} onValueChange={setImportMode}>
                    <SelectTrigger className="w-56 h-9" data-testid="import-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nuevos">Solo crear nuevos</SelectItem>
                      <SelectItem value="actualizar">Solo actualizar existentes</SelectItem>
                      <SelectItem value="ambos">Crear nuevos y actualizar existentes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 rounded-md px-3 py-1.5">
                  <Switch checked={actExist} onCheckedChange={setActExist} data-testid="import-act-exist" />
                  <span className="text-xs text-amber-800">Actualizar existencia (genera ajuste en Kardex)</span>
                </div>
                {preview.con_errores > 0 && <Button variant="outline" size="sm" onClick={downloadErrors} data-testid="download-errors">Descargar errores</Button>}
              </div>

              <div className="max-h-72 overflow-auto border border-slate-200 rounded">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-xs uppercase text-slate-500">
                    <th className="p-2">Fila</th><th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2">Acción</th><th className="p-2">Errores</th>
                  </tr></thead>
                  <tbody>
                    {preview.preview.slice(0, 300).map((r) => (
                      <tr key={r.fila} className="border-t border-slate-100">
                        <td className="p-2">{r.fila}</td><td className="p-2">{r.codigo}</td>
                        <td className="p-2 truncate max-w-[180px]">{r.descripcion}</td>
                        <td className="p-2">{r.errores?.length
                          ? <Badge className="bg-red-100 text-red-700">error</Badge>
                          : <Badge className={r.accion === "crear" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>{r.accion}</Badge>}</td>
                        <td className="p-2 text-red-600 text-xs">{(r.errores || []).map((e) => `${e.campo}: ${e.motivo}`).join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.preview.length > 300 && <p className="text-xs text-slate-400">Mostrando 300 de {preview.total} filas.</p>}
              {progress && <p className="text-sm text-[#C1401E] font-medium" data-testid="import-progress">Importando... {progress.done} / {progress.total}</p>}
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={!!progress}>Cancelar</Button>
            <Button onClick={confirmImport} disabled={!!progress} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="confirm-import">
              {progress ? "Importando..." : "Confirmar importación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
