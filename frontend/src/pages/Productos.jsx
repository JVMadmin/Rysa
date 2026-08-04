import { useEffect, useState, useRef } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import ProductForm from "@/components/ProductForm";
import { toast } from "sonner";
import { Plus, Search, Download, Upload, Pencil, History, Loader2, Boxes, FileDown } from "lucide-react";

const dot = (p) => {
  const ex = Number(p.existencia || 0), min = Number(p.stock_minimo || 0);
  if (ex <= 0) return ["bg-red-500", "Sin existencia"];
  if (ex <= min) return ["bg-amber-500", "Stock bajo"];
  return ["bg-green-500", "Stock normal"];
};
const estadoBadge = { activo: "bg-green-100 text-green-700", baja: "bg-slate-200 text-slate-600", suspendido: "bg-amber-100 text-amber-700" };

export default function Productos() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("all");
  const [filtro, setFiltro] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [movProd, setMovProd] = useState(null);
  const [movs, setMovs] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [importMode, setImportMode] = useState("ambos");
  const [actExist, setActExist] = useState(false);
  const [progress, setProgress] = useState(null);
  const fileRef = useRef();

  const load = async () => {
    setLoading(true);
    const params = {};
    if (q) params.q = q;
    if (estado !== "all") params.estado = estado;
    if (filtro !== "all") params.filtro = filtro;
    const { data } = await api.get("/products", { params });
    setRows(data);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [estado, filtro]);

  const openMovs = async (p) => {
    setMovProd(p);
    const { data } = await api.get(`/products/${p.id}/movimientos`);
    setMovs(data);
  };

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
      setImportOpen(false); setPreview(null); load();
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
          <p className="text-slate-500 text-sm">{rows.length} productos</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => download("/products/plantilla/excel", "plantilla_productos.xlsx")} data-testid="plantilla-btn"><FileDown className="w-4 h-4 mr-1" /> Plantilla</Button>
          {can("importar") && <Button variant="outline" onClick={() => fileRef.current.click()} data-testid="import-btn"><Upload className="w-4 h-4 mr-1" /> Importar</Button>}
          <Button variant="outline" onClick={exportExcel} data-testid="export-btn"><Download className="w-4 h-4 mr-1" /> Exportar</Button>
          {can("producto.crear") && <Button onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="nuevo-producto-btn" className="bg-[#0055A4] hover:bg-[#004385]"><Plus className="w-4 h-4 mr-1" /> Nuevo</Button>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFile} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center bg-white border border-slate-200 rounded-md p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar por código, descripción, SKU, línea..." value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
            className="pl-9" data-testid="buscar-producto" />
        </div>
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="w-40" data-testid="filtro-estado"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="activo">Activos</SelectItem>
            <SelectItem value="baja">Baja</SelectItem>
            <SelectItem value="suspendido">Suspendidos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-40" data-testid="filtro-stock"><SelectValue placeholder="Stock" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo stock</SelectItem>
            <SelectItem value="bajo_stock">Bajo stock</SelectItem>
            <SelectItem value="sin_existencia">Sin existencia</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}><Search className="w-4 h-4" /></Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="p-3">Estado</th><th className="p-3">Código</th><th className="p-3">Descripción</th>
              <th className="p-3">Línea</th><th className="p-3 text-right">Costo</th><th className="p-3 text-right">Exist.</th>
              <th className="p-3">U.M.</th><th className="p-3 text-right">Precio</th><th className="p-3 text-right">Min</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#0055A4]" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} className="p-10 text-center text-slate-400"><Boxes className="w-8 h-8 mx-auto mb-2" />Sin productos. Crea el primero.</td></tr>}
            {!loading && rows.map((p) => {
              const [color, label] = dot(p);
              return (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`prod-row-${p.codigo}`}>
                  <td className="p-3"><div className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${color}`} title={label} /><Badge className={estadoBadge[p.estado]}>{p.estado}</Badge></div></td>
                  <td className="p-3 font-medium text-[#0055A4]">{p.codigo}</td>
                  <td className="p-3 max-w-xs truncate">{p.descripcion}</td>
                  <td className="p-3 text-slate-500">{p.linea}</td>
                  <td className="p-3 text-right">{money(p.costo)}</td>
                  <td className="p-3 text-right font-semibold">{p.existencia}</td>
                  <td className="p-3">{p.unidad_medida}</td>
                  <td className="p-3 text-right">{money(p.precios?.[0]?.precio_con_iva)}</td>
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
      </div>

      <ProductForm open={formOpen} onClose={() => setFormOpen(false)} product={editing} onSaved={load} />

      {/* Movimientos / Kardex */}
      <Dialog open={!!movProd} onOpenChange={(o) => !o && setMovProd(null)}>
        <DialogContent className="max-w-2xl" data-testid="kardex-dialog">
          <DialogHeader><DialogTitle className="font-display">Kardex · {movProd?.descripcion}</DialogTitle></DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase text-slate-500">
                <th className="p-2">Fecha</th><th className="p-2">Movimiento</th><th className="p-2">Doc</th>
                <th className="p-2 text-right">Entrada</th><th className="p-2 text-right">Salida</th><th className="p-2 text-right">Exist.</th>
              </tr></thead>
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="p-2 text-slate-500">{m.fecha?.slice(0, 16).replace("T", " ")}</td>
                    <td className="p-2"><Badge variant="outline">{m.tipo}</Badge></td>
                    <td className="p-2">{m.documento}</td>
                    <td className="p-2 text-right text-green-600">{m.entrada || ""}</td>
                    <td className="p-2 text-right text-red-600">{m.salida || ""}</td>
                    <td className="p-2 text-right font-semibold">{m.existencia_resultante}</td>
                  </tr>
                ))}
                {movs.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">Sin movimientos.</td></tr>}
              </tbody>
            </table>
          </div>
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
              {progress && <p className="text-sm text-[#0055A4] font-medium" data-testid="import-progress">Importando... {progress.done} / {progress.total}</p>}
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={!!progress}>Cancelar</Button>
            <Button onClick={confirmImport} disabled={!!progress} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="confirm-import">
              {progress ? "Importando..." : "Confirmar importación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
