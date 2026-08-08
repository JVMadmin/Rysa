import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Loader2, UserCog } from "lucide-react";

const ROLES = [["admin", "Administrador"], ["encargado", "Encargado"], ["vendedor", "Vendedor"], ["cajero", "Cajero"]];

export default function Usuarios({ embedded = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "vendedor" });
  const [saving, setSaving] = useState(false);

  const load = async () => { setLoading(true); const { data } = await api.get("/users"); setRows(data); setLoading(false); };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!f.name || !f.email || !f.password) return toast.error("Completa todos los campos");
    setSaving(true);
    try { await api.post("/users", f); toast.success("Usuario creado"); setOpen(false); setF({ name: "", email: "", password: "", role: "vendedor" }); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const toggleActive = async (u) => { await api.put(`/users/${u.id}`, { active: !u.active }); load(); };

  return (
    <div className="space-y-5" data-testid="usuarios-page">
      <div className="flex items-center justify-between">
        <div>{!embedded && <><h1 className="font-display text-2xl font-black tracking-tight">Usuarios y Roles</h1><p className="text-slate-500 text-sm">{rows.length} usuarios</p></>}{embedded && <p className="text-slate-500 text-sm">{rows.length} usuarios</p>}</div>
        <Button onClick={() => setOpen(true)} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="nuevo-usuario-btn"><Plus className="w-4 h-4 mr-1" /> Nuevo usuario</Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Nombre</th><th className="p-3">Correo</th><th className="p-3">Rol</th><th className="p-3">Activo</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#B95A3A]" /></td></tr>}
            {!loading && rows.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-3 font-medium">{u.name}</td><td className="p-3 text-slate-500">{u.email}</td>
                <td className="p-3"><Badge variant="outline" className="uppercase">{u.role}</Badge></td>
                <td className="p-3"><Switch checked={u.active !== false} onCheckedChange={() => toggleActive(u)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="usuario-form">
          <DialogHeader><DialogTitle className="font-display">Nuevo usuario</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Nombre</Label><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} className="mt-1" data-testid="user-name-input" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Correo</Label><Input type="email" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} className="mt-1" data-testid="user-email-input" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Contraseña</Label><Input type="text" value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} className="mt-1" data-testid="user-pass-input" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Rol</Label>
              <Select value={f.role} onValueChange={(v) => setF((s) => ({ ...s, role: v }))}>
                <SelectTrigger className="mt-1" data-testid="user-role-select"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save} disabled={saving} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="user-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crear"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
