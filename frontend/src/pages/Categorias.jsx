import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Tags, Pencil, PackageSearch, ImageIcon, Plus, Trash2, Download, Upload, FileDown, CheckCircle2, AlertTriangle, Search } from "lucide-react";
import { ImageUpload } from "@/components/ImageUpload";
import { fileUrl } from "@/lib/api";

const BLANK = { nombre: "", clave: "", descripcion: "", ficha_tecnica: "", imagen_url: "" };

export default function Categorias() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [f, setF] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [importMode, setImportMode] = useState("ambos");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef();
  const editable = can("producto.editar");
  const canImport = can("importar");
  const canExport = can("exportar");

  const load = async () => { setLoading(true); const { data } = await api.get("/categories"); setRows(data); setLoading(false); };
  useEffect(() => { load(); }, []);

  const openNew = () => { setF({ ...BLANK }); setIsNew(true); setEdit("__new__"); };
  const openEdit = (c) => { setF({ ...c }); setIsNew(false); setEdit(c.nombre); };
  const close = () => { setEdit(null); setIsNew(false); setF({ ...BLANK }); };

  const save = async () => {
    if (!f.nombre?.trim()) return toast.error("El nombre es obligatorio");
    setSaving(true);
    try { await api.post("/categories", f); toast.success(isNew ? "Categoría creada" : "Categoría guardada"); close(); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const remove = async (c) => {
    if (!window.confirm(`¿Eliminar la categoría "${c.nombre}"? Los productos que la usan no se borran, pero pierden el registro de esta categoría.`)) return;
    try {
      await api.delete(`/categories/${encodeURIComponent(c.nombre)}`);
      toast.success("Categoría eliminada"); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
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

  const exportExcel = async () => {
    setExporting(true);
    try { await download("/categories/export/excel", "categorias.xlsx"); }
    finally { setExporting(false); }
  };
  const downloadPlantilla = () => download("/categories/plantilla/excel", "plantilla_categorias.xlsx");

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/categories/import/preview", fd);
      setPreview(data); setImportOpen(true);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    e.target.value = "";
  };

  const confirmImport = async () => {
    const valid = preview.preview.filter((r) => !r.errores?.length);
    if (valid.length === 0) return toast.error("No hay filas válidas para importar");
    setImporting(true);
    try {
      const { data } = await api.post("/categories/import/confirm", { rows: valid, mode: importMode });
      toast.success(`${data.creados} creadas, ${data.actualizados} actualizadas, ${data.omitidos} omitidas`);
      setImportOpen(false); setPreview(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setImporting(false); }
  };

  const downloadErrors = () => {
    const lines = [["fila", "nombre", "campo", "valor", "motivo"]];
    preview.preview.forEach((r) => (r.errores || []).forEach((e2) => lines.push([r.fila, r.nombre, e2.campo, e2.valor, e2.motivo])));
    const csv = lines.map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "errores_importacion_categorias.csv"; a.click();
  };

  return (
    <div className="space-y-5" data-testid="categorias-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Categorías</h1>
          <p className="text-slate-500 text-sm">{rows.length} categorías · agrega, edita o elimina categorías y su información</p></div>
        <div className="flex flex-wrap gap-2">
          {canExport && <Button variant="outline" onClick={exportExcel} disabled={exporting} data-testid="cat-export"><Download className="w-4 h-4 mr-1" /> Exportar</Button>}
          {canImport && <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="cat-import"><Upload className="w-4 h-4 mr-1" /> Importar</Button>}
          {editable && <Button className="bg-[#C1401E] hover:bg-[#A03316]" onClick={openNew} data-testid="cat-new"><Plus className="w-4 h-4 mr-1" /> Nueva categoría</Button>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} data-testid="cat-import-file" />

      {loading ? <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div> : (
        <>
        <div className="card-soft p-3">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Buscar categoría por nombre, clave o descripción..." value={q}
              onChange={(e) => setQ(e.target.value)} className="pl-9" data-testid="cat-buscar" />
          </div>
        </div>
        {(() => {
          const ql = q.trim().toLowerCase();
          const visible = ql ? rows.filter((c) => `${c.nombre} ${c.clave || ""} ${c.descripcion || ""}`.toLowerCase().includes(ql)) : rows;
          return visible.length === 0 ? (
          <div className="card-soft p-12 text-center text-slate-400">
            <Tags className="w-10 h-10 mx-auto mb-3" />{ql ? "Sin categorías que coincidan con tu búsqueda." : "No hay categorías. Crea una nueva, importa un archivo o importa productos con la columna CATEGORIA."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visible.map((c) => (
              <div key={c.nombre} className="group card-soft overflow-hidden hover:shadow-md transition-all" data-testid={`cat-card-${c.nombre}`}>
                <div className="h-32 bg-slate-100 relative overflow-hidden">
                  {c.imagen_url
                    ? <img src={fileUrl(c.imagen_url)} alt={c.nombre} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#C1401E]/10 to-[#C1401E]/10"><ImageIcon className="w-8 h-8 text-slate-300" /></div>}
                  <Badge className="absolute top-2 right-2 bg-[#C1401E] text-white">{c.count}</Badge>
                </div>
                <div className="p-4">
                  <div className="font-display font-bold text-slate-800 truncate">{c.nombre}</div>
                  {c.clave && <div className="text-xs text-slate-400">Clave: {c.clave}</div>}
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 h-8">{c.descripcion || "Sin descripción."}</p>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => nav("/app/productos", { state: { categoria: c.nombre } })} data-testid={`cat-ver-${c.nombre}`}>
                      <PackageSearch className="w-4 h-4 mr-1" /> Ver ({c.count})
                    </Button>
                    {editable && <>
                      <Button size="sm" className="bg-[#C1401E] hover:bg-[#A03316]" onClick={() => openEdit(c)} data-testid={`cat-edit-${c.nombre}`}><Pencil className="w-4 h-4" /></Button>
                      <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => remove(c)} data-testid={`cat-del-${c.nombre}`}><Trash2 className="w-4 h-4" /></Button>
                    </>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
        })()}
        </>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-lg" data-testid="categoria-form">
          <DialogHeader><DialogTitle className="font-display">{isNew ? "Nueva categoría" : `Categoría · ${f.nombre}`}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Nombre *</Label>
              <Input value={f.nombre} onChange={(e) => setF((s) => ({ ...s, nombre: e.target.value }))} className="mt-1" data-testid="cat-nombre" disabled={!isNew} /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">Imagen de la categoría</Label>
              <ImageUpload value={f.imagen_url} onChange={(v) => setF((s) => ({ ...s, imagen_url: v }))} testid="cat-image-upload" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Clave</Label>
              <Input value={f.clave} onChange={(e) => setF((s) => ({ ...s, clave: e.target.value }))} className="mt-1" data-testid="cat-clave" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Información / Descripción</Label>
              <Textarea value={f.descripcion} onChange={(e) => setF((s) => ({ ...s, descripcion: e.target.value }))} className="mt-1" data-testid="cat-descripcion" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Ficha técnica</Label>
              <Textarea value={f.ficha_tecnica} onChange={(e) => setF((s) => ({ ...s, ficha_tecnica: e.target.value }))} className="mt-1" data-testid="cat-ficha" placeholder="Material, medidas, presentación..." /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={close}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="cat-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(o) => !o && setImportOpen(false)}>
        <DialogContent className="max-w-2xl" data-testid="cat-import-dialog">
          <DialogHeader><DialogTitle className="font-display">Importar categorías</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Button variant="outline" size="sm" onClick={downloadPlantilla} data-testid="cat-import-plantilla"><FileDown className="w-4 h-4 mr-1" /> Descargar plantilla</Button>
              <span className="inline-flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="w-4 h-4 text-green-600" /> Columnas: NOMBRE, CLAVE, DESCRIPCION, FICHA_TECNICA, IMAGEN_URL</span>
            </div>
            {preview && (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge className="bg-green-100 text-green-700">{preview.nuevos} nuevas</Badge>
                  <Badge className="bg-blue-100 text-blue-700">{preview.existentes} existentes</Badge>
                  {preview.con_errores > 0 && <Badge className="bg-red-100 text-red-700"><AlertTriangle className="w-3 h-3 mr-1" />{preview.con_errores} con errores</Badge>}
                </div>
                {preview.con_errores > 0 && <Button variant="outline" size="sm" onClick={downloadErrors} data-testid="cat-import-errors"><Download className="w-4 h-4 mr-1" /> Descargar errores</Button>}
                <div className="border rounded max-h-64 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-slate-500 uppercase"><th className="p-2">Fila</th><th className="p-2">Nombre</th><th className="p-2">Descripción</th><th className="p-2">Estado</th></tr></thead>
                    <tbody>
                      {preview.preview.map((r) => (
                        <tr key={r.fila} className="border-t">
                          <td className="p-2">{r.fila}</td>
                          <td className="p-2 font-medium">{r.nombre}</td>
                          <td className="p-2 text-slate-500">{r.descripcion}</td>
                          <td className="p-2">{r.errores?.length
                            ? <span className="text-red-600">{r.errores.map((e2) => e2.motivo).join("; ")}</span>
                            : <span className="text-green-600">{r.existe ? "Se actualizará" : "Nueva"}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Modo</Label>
                  <Select value={importMode} onValueChange={setImportMode}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ambos">Crear y actualizar</SelectItem>
                      <SelectItem value="nuevos">Solo nuevas</SelectItem>
                      <SelectItem value="actualizar">Solo actualizar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
            <Button onClick={confirmImport} disabled={!preview || importing} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="cat-import-confirm">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
