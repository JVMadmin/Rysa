import { useEffect, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, Search, Users, Wallet, FileText, Clock, Eye, Pencil, Power, Phone, Mail } from "lucide-react";

const blank = () => ({
  nombre: "", razon_social: "", rfc: "", telefono: "", email: "", direccion: "", cp: "",
  ciudad: "", estado: "", contacto: "", telefono_contacto: "", email_contacto: "",
  condiciones_pago: "", dias_credito: "0", limite_credito: "0", banco: "", cuenta: "",
  clabe: "", observaciones: "", activo: true, categoria: "",
});

export default function Proveedores() {
  const { can } = useAuth();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [ficha, setFicha] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/proveedores", { params: q ? { q } : {} });
      setList(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "No se pudieron cargar los proveedores.");
      setList([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openNew = () => { setForm(blank()); setEditing({ id: null }); };
  const openEdit = (p) => {
    setForm({ ...blank(), ...p, dias_credito: String(p.dias_credito ?? 0), limite_credito: String(p.limite_credito ?? 0), activo: p.activo !== false });
    setEditing({ id: p.id });
  };
  const guardar = async () => {
    if (!form.nombre.trim()) return toast.error("El nombre comercial es obligatorio");
    setSaving(true);
    try {
      const payload = { ...form, dias_credito: Number(form.dias_credito || 0), limite_credito: Number(form.limite_credito || 0) };
      if (editing?.id) await api.put(`/proveedores/${editing.id}`, payload);
      else await api.post("/proveedores", payload);
      toast.success(editing?.id ? "Proveedor actualizado" : "Proveedor creado");
      setEditing(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  const toggleEstado = async (p) => {
    try { await api.patch(`/proveedores/${p.id}/estado`, null, { params: { activo: !p.activo } }); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const verFicha = async (p) => {
    const { data } = await api.get(`/proveedores/${p.id}/ficha`);
    setFicha(data);
  };

  return (
    <div className="space-y-5" data-testid="proveedores-page">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight">Proveedores</h1>
        <p className="text-slate-500 text-sm">Catálogo de proveedores, compras, facturas, gastos y saldos</p>
      </div>

      <div className="flex flex-wrap gap-2 card-soft p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar por nombre, RFC, contacto..." value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="pl-9 h-10" />
        </div>
        <Button variant="outline" onClick={load} className="h-10"><Search className="w-4 h-4" /></Button>
        <Button className="h-10 bg-[#C1401E] hover:bg-[#A03316]" onClick={openNew} data-testid="nuevo-proveedor"><Plus className="w-4 h-4 mr-1" /> Nuevo proveedor</Button>
      </div>

      <div className="card-soft overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Clave</th><th className="p-3">Nombre</th><th className="p-3">RFC</th>
            <th className="p-3">Contacto</th><th className="p-3">Teléfono</th><th className="p-3 text-right">Límite</th>
            <th className="p-3 text-right">Días</th><th className="p-3">Estado</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-slate-400">Sin proveedores.</td></tr>}
            {!loading && list.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`prov-row-${p.codigo}`}>
                <td className="p-3 font-mono text-[#C1401E] text-xs">{p.codigo}</td>
                <td className="p-3 font-medium">{p.nombre}</td>
                <td className="p-3 text-slate-500 font-mono text-xs">{p.rfc || "—"}</td>
                <td className="p-3 text-slate-500">{p.contacto || "—"}</td>
                <td className="p-3 text-slate-500">{p.telefono || "—"}</td>
                <td className="p-3 text-right">{money(p.limite_credito)}</td>
                <td className="p-3 text-right">{p.dias_credito}</td>
                <td className="p-3">{p.activo !== false ? <Badge className="bg-green-100 text-green-700">Activo</Badge> : <Badge className="bg-slate-100 text-slate-500">Inactivo</Badge>}</td>
                <td className="p-3">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="outline" onClick={() => verFicha(p)} data-testid={`prov-ficha-${p.codigo}`}><Eye className="w-4 h-4 mr-1" /> Ver</Button>
                    {can("proveedor.editar") && <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="w-4 h-4" /></Button>}
                    {can("proveedor.editar") && <Button size="sm" variant="outline" onClick={() => toggleEstado(p)} className={p.activo !== false ? "text-amber-600" : "text-green-600"}><Power className="w-4 h-4" /></Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ficha */}
      <Dialog open={!!ficha} onOpenChange={(o) => !o && setFicha(null)}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">{ficha?.proveedor?.nombre}</DialogTitle></DialogHeader>
          {ficha && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Compras</div><div className="font-display font-bold text-blue-700">{money(ficha.resumen.compras_total)}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Facturas</div><div className="font-display font-bold">{ficha.resumen.facturas}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Pendiente</div><div className="font-display font-bold text-red-600">{money(ficha.resumen.pendiente)}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Última compra</div><div className="font-display font-bold">{ficha.resumen.ultima_compra || "—"}</div></div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Compras recientes</div>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                      <th className="p-2">Fecha</th><th className="p-2">Folio</th><th className="p-2">Factura</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Saldo</th><th className="p-2">Estado</th>
                    </tr></thead>
                    <tbody>
                      {ficha.compras.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Sin compras.</td></tr>}
                      {ficha.compras.map((c) => (
                        <tr key={c.id} className="border-t border-slate-100">
                          <td className="p-2 text-slate-500">{(c.fecha_recepcion || "").slice(0, 10)}</td>
                          <td className="p-2 font-medium text-[#C1401E]">{c.folio}</td>
                          <td className="p-2">{c.factura_numero || "—"}</td>
                          <td className="p-2 text-right">{money(c.total)}</td>
                          <td className={`p-2 text-right ${c.saldo_pendiente > 0 ? "text-red-600" : "text-slate-300"}`}>{money(c.saldo_pendiente)}</td>
                          <td className="p-2 capitalize">{c.estado}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Productos / historial de costos</div>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                      <th className="p-2">Producto</th><th className="p-2 text-right">Últ. costo</th><th className="p-2">Cantidad</th><th className="p-2">Factura</th><th className="p-2">Fecha</th>
                    </tr></thead>
                    <tbody>
                      {ficha.productos.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">Sin costos registrados.</td></tr>}
                      {ficha.productos.map((pg) => (
                        <tr key={pg.product_id} className="border-t border-slate-100 align-top">
                          <td className="p-2"><b>{pg.codigo}</b> {pg.descripcion}</td>
                          <td className="p-2 text-right font-semibold text-[#C1401E]">{money(pg.ultimo_costo)}</td>
                          <td className="p-2" colSpan={3}>
                            {pg.historial.map((h, k) => (
                              <div key={k} className="text-slate-500 flex gap-2">
                                <span>{(h.fecha || "").slice(0, 10)}</span><span>{h.factura}</span>
                                <span>{h.cantidad} unid</span><span><b>{money(h.costo)}</b></span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setFicha(null)}>Cerrar</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Alta / edición */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">{editing?.id ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Nombre comercial *</Label><Input value={form.nombre} onChange={(e) => setForm((s) => ({ ...s, nombre: e.target.value }))} className="mt-1" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Razón social</Label><Input value={form.razon_social} onChange={(e) => setForm((s) => ({ ...s, razon_social: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">RFC</Label><Input value={form.rfc} onChange={(e) => setForm((s) => ({ ...s, rfc: e.target.value }))} className="mt-1 font-mono" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Teléfono</Label><Input value={form.telefono} onChange={(e) => setForm((s) => ({ ...s, telefono: e.target.value }))} className="mt-1" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Email</Label><Input value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} className="mt-1" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Dirección</Label><Input value={form.direccion} onChange={(e) => setForm((s) => ({ ...s, direccion: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">CP</Label><Input value={form.cp} onChange={(e) => setForm((s) => ({ ...s, cp: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Ciudad</Label><Input value={form.ciudad} onChange={(e) => setForm((s) => ({ ...s, ciudad: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Estado</Label><Input value={form.estado} onChange={(e) => setForm((s) => ({ ...s, estado: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Contacto</Label><Input value={form.contacto} onChange={(e) => setForm((s) => ({ ...s, contacto: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Tel. contacto</Label><Input value={form.telefono_contacto} onChange={(e) => setForm((s) => ({ ...s, telefono_contacto: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Email contacto</Label><Input value={form.email_contacto} onChange={(e) => setForm((s) => ({ ...s, email_contacto: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Condiciones de pago</Label><Input value={form.condiciones_pago} onChange={(e) => setForm((s) => ({ ...s, condiciones_pago: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Días de crédito</Label><Input type="number" value={form.dias_credito} onChange={(e) => setForm((s) => ({ ...s, dias_credito: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Límite de crédito</Label><Input type="number" value={form.limite_credito} onChange={(e) => setForm((s) => ({ ...s, limite_credito: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Banco</Label><Input value={form.banco} onChange={(e) => setForm((s) => ({ ...s, banco: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Cuenta</Label><Input value={form.cuenta} onChange={(e) => setForm((s) => ({ ...s, cuenta: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">CLABE</Label><Input value={form.clabe} onChange={(e) => setForm((s) => ({ ...s, clabe: e.target.value }))} className="mt-1" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Observaciones</Label><Textarea value={form.observaciones} onChange={(e) => setForm((s) => ({ ...s, observaciones: e.target.value }))} className="mt-1" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
