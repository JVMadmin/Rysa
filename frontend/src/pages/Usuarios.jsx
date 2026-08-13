import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Loader2, UserCog, Pencil } from "lucide-react";

const FALLBACK_ROLES = [
  ["admin", "Administrador"],
  ["admin_propietario", "Admin Propietario"],
  ["admin_desarrollador", "Admin Desarrollador"],
  ["encargado", "Encargado"],
  ["vendedor", "Vendedor"],
  ["cajero", "Cajero"],
];

const FALLBACK_MODULOS = [
  ["productos", "Productos e Inventario"],
  ["clientes", "Clientes"],
  ["ventas", "Ventas"],
  ["recargas", "Recargas"],
  ["caja", "Caja"],
  ["cxc", "Cuentas por Cobrar"],
  ["reportes", "Reportes"],
  ["usuarios", "Usuarios"],
  ["auditoria", "Auditoría"],
  ["configuracion", "Configuración"],
];

const ADMIN_ROLES = ["admin", "admin_propietario", "admin_desarrollador"];

export default function Usuarios({ embedded = false }) {
  const { can } = useAuth();
  const canAssign = can("usuarios.admin");
  const [catalog, setCatalog] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "vendedor", modulos: [] });
  const [saving, setSaving] = useState(false);

  const ROLES = catalog?.roles ? Object.keys(catalog.roles).map((k) => [k, k]) : FALLBACK_ROLES;
  const MODULOS = catalog?.modulos ? Object.entries(catalog.modulos) : FALLBACK_MODULOS;

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get("/users"); setRows(data); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    setLoading(false);
  };
  useEffect(() => {
    api.get("/roles").then((r) => setCatalog(r.data)).catch(() => {});
    load();
  }, []);

  const openNew = () => { setF({ name: "", email: "", password: "", role: "vendedor", modulos: [] }); setEditId(null); setOpen(true); };
  const openEdit = (u) => { setF({ name: u.name, email: u.email, password: "", role: u.role, modulos: u.modulos || [] }); setEditId(u.id); setOpen(true); };

  const toggleModulo = (mod) =>
    setF((s) => ({ ...s, modulos: s.modulos.includes(mod) ? s.modulos.filter((m) => m !== mod) : [...s.modulos, mod] }));

  const save = async () => {
    if (!f.name.trim() || !f.email.trim()) return toast.error("Completa nombre y correo");
    if (!editId && !f.password) return toast.error("La contraseña es obligatoria al crear");
    setSaving(true);
    const payload = { name: f.name, role: f.role };
    if (editId) {
      payload.active = rows.find((u) => u.id === editId)?.active;
      if (canAssign) payload.modulos = f.modulos;
      if (f.password) payload.password = f.password;
    } else {
      payload.email = f.email;
      payload.password = f.password;
      if (canAssign) payload.modulos = f.modulos;
    }
    try {
      if (editId) await api.put(`/users/${editId}`, payload);
      else await api.post("/users", payload);
      toast.success(editId ? "Usuario actualizado" : "Usuario creado");
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const toggleActive = async (u) => {
    try { await api.put(`/users/${u.id}`, { active: !u.active }); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const esAdminRole = (r) => ADMIN_ROLES.includes(r);

  return (
    <div className="space-y-5" data-testid="usuarios-page">
      <div className="flex items-center justify-between">
        <div>{!embedded && <><h1 className="font-display text-2xl font-black tracking-tight">Usuarios y Roles</h1><p className="text-slate-500 text-sm">{rows.length} usuarios</p></>}{embedded && <p className="text-slate-500 text-sm">{rows.length} usuarios</p>}</div>
        <Button onClick={openNew} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="nuevo-usuario-btn"><Plus className="w-4 h-4 mr-1" /> Nuevo usuario</Button>
      </div>

      {!canAssign && (
        <p className="text-xs text-slate-400 -mt-3">Solo Administrador / Propietario puede asignar roles privilegiados o módulos.</p>
      )}

      <div className="card-soft overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Nombre</th><th className="p-3">Correo</th><th className="p-3">Rol</th><th className="p-3">Módulos</th><th className="p-3">Activo</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
            {!loading && rows.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-3 font-medium">{u.name}</td><td className="p-3 text-slate-500">{u.email}</td>
                <td className="p-3">
                  <Badge variant={esAdminRole(u.role) ? "default" : "outline"} className="uppercase">
                    {ROLES.find(([k]) => k === u.role)?.[1] || u.role}
                  </Badge>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {(u.modulos || []).length === 0 && <span className="text-xs text-slate-400">—</span>}
                    {(u.modulos || []).map((m) => (
                      <span key={m} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {MODULOS.find(([k]) => k === m)?.[1] || m}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-3"><Switch checked={u.active !== false} onCheckedChange={() => toggleActive(u)} /></td>
                <td className="p-3 text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(u)} data-testid={`edit-user-${u.email}`}><Pencil className="w-4 h-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="usuario-form">
          <DialogHeader><DialogTitle className="font-display">{editId ? "Editar usuario" : "Nuevo usuario"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Nombre</Label><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} className="mt-1" data-testid="user-name-input" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Correo</Label><Input type="email" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} className="mt-1" data-testid="user-email-input" disabled={!!editId} /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">{editId ? "Contraseña (en blanco = no cambiar)" : "Contraseña"}</Label><Input type="text" value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} className="mt-1" data-testid="user-pass-input" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Rol</Label>
              <Select value={f.role} onValueChange={(v) => setF((s) => ({ ...s, role: v }))}>
                <SelectTrigger className="mt-1" data-testid="user-role-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(([k, l]) => (
                    <SelectItem key={k} value={k} disabled={esAdminRole(k) && !canAssign}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {esAdminRole(f.role) && !canAssign && <p className="text-[10px] text-slate-400 mt-1">Solo Administrador/Propietario asigna roles privilegiados.</p>}
            </div>
            {canAssign && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Módulos asignados (adicionales al rol)</Label>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {MODULOS.map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 border border-slate-200 rounded-md px-2.5 h-9 text-sm cursor-pointer">
                      <Checkbox checked={f.modulos.includes(k)} onCheckedChange={() => toggleModulo(k)} data-testid={`mod-${k}`} />
                      <span className="truncate">{l}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="user-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editId ? "Guardar" : "Crear"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}