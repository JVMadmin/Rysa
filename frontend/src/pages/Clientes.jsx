import { useEffect, useState, useRef } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Search, Download, Upload, Pencil, Loader2, Users } from "lucide-react";

const blank = () => ({ codigo: "", nombre: "", razon_social: "", rfc: "", telefono: "", whatsapp: "", correo: "", direccion: "", ciudad: "", estado_geo: "", cp: "", tipo: "publico", lista_precios: 1, condicion_pago: "contado", limite_credito: 0, estado: "activo" });
const tipoLabel = { publico: "Público General", menudeo: "Menudeo", mayoreo: "Mayoreo", especial: "Especial" };

export default function Clientes() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("all");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank());
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const load = async () => {
    setLoading(true);
    const params = {};
    if (q) params.q = q;
    if (tipo !== "all") params.tipo = tipo;
    const { data } = await api.get("/clients", { params });
    setRows(data); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tipo]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const openNew = () => { setF(blank()); setEditId(null); setOpen(true); };
  const openEdit = (c) => { setF({ ...blank(), ...c }); setEditId(c.id); setOpen(true); };

  const save = async () => {
    if (!f.nombre.trim()) return toast.error("El nombre es obligatorio");
    setSaving(true);
    try {
      const payload = { ...f, limite_credito: Number(f.limite_credito), lista_precios: Number(f.lista_precios) };
      if (editId) await api.put(`/clients/${editId}`, payload);
      else await api.post("/clients", payload);
      toast.success(editId ? "Cliente actualizado" : "Cliente creado");
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const exportExcel = async () => {
    const res = await api.get("/clients/export/excel", { responseType: "blob", params: q ? { q } : {} });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(res.data); link.download = "clientes.xlsx"; link.click();
  };

  const onFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try { const { data } = await api.post("/clients/import/confirm", fd); toast.success(`${data.creados} clientes importados`); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    e.target.value = "";
  };

  const I = (label, k, type = "text") => (
    <div><Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label>
      <Input type={type} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="mt-1" data-testid={`cli-${k}`} /></div>
  );

  return (
    <div className="space-y-5" data-testid="clientes-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Clientes</h1><p className="text-slate-500 text-sm">{rows.length} clientes</p></div>
        <div className="flex flex-wrap gap-2">
          {can("importar") && <Button variant="outline" onClick={() => fileRef.current.click()}><Upload className="w-4 h-4 mr-1" /> Importar</Button>}
          <Button variant="outline" onClick={exportExcel} data-testid="cli-export"><Download className="w-4 h-4 mr-1" /> Exportar</Button>
          {can("cliente.crear") && <Button onClick={openNew} data-testid="nuevo-cliente-btn" className="bg-[#0055A4] hover:bg-[#004385]"><Plus className="w-4 h-4 mr-1" /> Nuevo</Button>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={onFile} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 bg-white border border-slate-200 rounded-md p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar por nombre, código, RFC, teléfono..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="pl-9" data-testid="buscar-cliente" />
        </div>
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(tipoLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}><Search className="w-4 h-4" /></Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Código</th><th className="p-3">Nombre</th><th className="p-3">RFC</th><th className="p-3">Teléfono</th>
            <th className="p-3">Tipo</th><th className="p-3 text-right">Saldo</th><th className="p-3">Estado</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#0055A4]" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="p-10 text-center text-slate-400"><Users className="w-8 h-8 mx-auto mb-2" />Sin clientes.</td></tr>}
            {!loading && rows.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`cli-row-${c.codigo}`}>
                <td className="p-3 font-medium text-[#0055A4]">{c.codigo}</td>
                <td className="p-3">{c.nombre}</td><td className="p-3 text-slate-500">{c.rfc}</td>
                <td className="p-3">{c.telefono}</td><td className="p-3"><Badge variant="outline">{tipoLabel[c.tipo]}</Badge></td>
                <td className="p-3 text-right font-semibold">{money(c.saldo)}</td>
                <td className="p-3"><Badge className={c.estado === "activo" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}>{c.estado}</Badge></td>
                <td className="p-3 text-right">{can("cliente.editar") && <Button size="icon" variant="ghost" onClick={() => openEdit(c)} data-testid={`edit-cli-${c.codigo}`}><Pencil className="w-4 h-4" /></Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="cliente-form">
          <DialogHeader><DialogTitle className="font-display">{editId ? "Editar cliente" : "Nuevo cliente"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {I("Código (auto)", "codigo")}
            {I("Nombre", "nombre")}
            {I("Razón social", "razon_social")}
            {I("RFC", "rfc")}
            {I("Teléfono", "telefono")}
            {I("WhatsApp", "whatsapp")}
            {I("Correo", "correo")}
            {I("Dirección", "direccion")}
            {I("Ciudad", "ciudad")}
            {I("Estado", "estado_geo")}
            {I("C.P.", "cp")}
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Tipo</Label>
              <Select value={f.tipo} onValueChange={(v) => set("tipo", v)}>
                <SelectTrigger className="mt-1" data-testid="cli-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(tipoLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Lista de precios</Label>
              <Select value={String(f.lista_precios)} onValueChange={(v) => set("lista_precios", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>Precio {n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Condición de pago</Label>
              <Select value={f.condicion_pago} onValueChange={(v) => set("condicion_pago", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="contado">Contado</SelectItem><SelectItem value="credito">Crédito</SelectItem></SelectContent>
              </Select>
            </div>
            {I("Límite de crédito", "limite_credito", "number")}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="cli-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
