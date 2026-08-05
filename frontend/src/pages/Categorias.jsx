import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Tags, Pencil, PackageSearch, ImageIcon } from "lucide-react";

export default function Categorias() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [f, setF] = useState({ nombre: "", clave: "", descripcion: "", ficha_tecnica: "", imagen_url: "" });
  const [saving, setSaving] = useState(false);
  const editable = can("producto.editar");

  const load = async () => { setLoading(true); const { data } = await api.get("/categories"); setRows(data); setLoading(false); };
  useEffect(() => { load(); }, []);

  const openEdit = (c) => { setF({ ...c }); setEdit(c.nombre); };
  const save = async () => {
    setSaving(true);
    try { await api.post("/categories", f); toast.success("Categoría guardada"); setEdit(null); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5" data-testid="categorias-page">
      <div><h1 className="font-display text-2xl font-black tracking-tight">Categorías</h1>
        <p className="text-slate-500 text-sm">{rows.length} categorías · edítalas con imagen, información y ficha técnica</p></div>

      {loading ? <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#0055A4]" /></div> : (
        rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-md p-12 text-center text-slate-400">
            <Tags className="w-10 h-10 mx-auto mb-3" />No hay categorías. Importa productos con la columna CATEGORIA o edítalas aquí.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rows.map((c) => (
              <div key={c.nombre} className="group bg-white border border-slate-200 rounded-md overflow-hidden hover:shadow-md transition-all" data-testid={`cat-card-${c.nombre}`}>
                <div className="h-32 bg-slate-100 relative overflow-hidden">
                  {c.imagen_url
                    ? <img src={c.imagen_url} alt={c.nombre} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#0055A4]/10 to-[#FF5A00]/10"><ImageIcon className="w-8 h-8 text-slate-300" /></div>}
                  <Badge className="absolute top-2 right-2 bg-[#0055A4] text-white">{c.count}</Badge>
                </div>
                <div className="p-4">
                  <div className="font-display font-bold text-slate-800 truncate">{c.nombre}</div>
                  {c.clave && <div className="text-xs text-slate-400">Clave: {c.clave}</div>}
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 h-8">{c.descripcion || "Sin descripción."}</p>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => nav("/app/productos", { state: { categoria: c.nombre } })} data-testid={`cat-ver-${c.nombre}`}>
                      <PackageSearch className="w-4 h-4 mr-1" /> Ver ({c.count})
                    </Button>
                    {editable && <Button size="sm" className="bg-[#0055A4] hover:bg-[#004385]" onClick={() => openEdit(c)} data-testid={`cat-edit-${c.nombre}`}><Pencil className="w-4 h-4" /></Button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg" data-testid="categoria-form">
          <DialogHeader><DialogTitle className="font-display">Categoría · {f.nombre}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {f.imagen_url && <img src={f.imagen_url} alt="preview" className="w-full h-36 object-cover rounded-md border border-slate-200" />}
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">URL de imagen</Label>
              <Input value={f.imagen_url} onChange={(e) => setF((s) => ({ ...s, imagen_url: e.target.value }))} className="mt-1" data-testid="cat-imagen" placeholder="https://..." /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Clave</Label>
              <Input value={f.clave} onChange={(e) => setF((s) => ({ ...s, clave: e.target.value }))} className="mt-1" data-testid="cat-clave" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Información / Descripción</Label>
              <Textarea value={f.descripcion} onChange={(e) => setF((s) => ({ ...s, descripcion: e.target.value }))} className="mt-1" data-testid="cat-descripcion" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Ficha técnica</Label>
              <Textarea value={f.ficha_tecnica} onChange={(e) => setF((s) => ({ ...s, ficha_tecnica: e.target.value }))} className="mt-1" data-testid="cat-ficha" placeholder="Material, medidas, presentación..." /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="cat-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
