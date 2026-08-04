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
import { toast } from "sonner";
import { Plus, Search, Download, Upload, Pencil, Loader2, Users, CreditCard, ArrowUp, ArrowDown, MapPin, BadgeDollarSign } from "lucide-react";

const blank = () => ({
  codigo: "", nombre: "", razon_social: "", rfc: "", telefono: "", whatsapp: "", correo: "",
  calle: "", numero_exterior: "", numero_interior: "", colonia: "", localidad: "", municipio: "",
  ciudad: "", estado_geo: "", pais: "México", cp: "", referencias: "", direccion: "",
  tipo: "publico", lista_precios: 1, condicion_pago: "contado",
  credito_autorizado: false, limite_credito: 0, estado: "activo",
});
const tipoLabel = { publico: "Público General", menudeo: "Menudeo", mayoreo: "Mayoreo", especial: "Especial" };

export default function Clientes() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("all");
  const [sort, setSort] = useState({ key: null, dir: "desc" });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank());
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [credit, setCredit] = useState(null); // cliente para diálogo de crédito
  const [creditForm, setCreditForm] = useState({ credito_autorizado: false, limite_credito: 0 });
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

  const openCredit = (c) => {
    if (!can("credito.autorizar")) return;
    setCredit(c);
    setCreditForm({ credito_autorizado: !!c.credito_autorizado, limite_credito: c.limite_credito || 0 });
  };
  const saveCredit = async () => {
    try {
      await api.patch(`/clients/${credit.id}/credito`, { credito_autorizado: creditForm.credito_autorizado, limite_credito: Number(creditForm.limite_credito) });
      toast.success("Crédito actualizado"); setCredit(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
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

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      let x = a[sort.key], y = b[sort.key];
      if (sort.key === "credito") { x = a.credito_autorizado ? 1 : 0; y = b.credito_autorizado ? 1 : 0; }
      if (typeof x === "string" || typeof y === "string") {
        const r = String(x || "").localeCompare(String(y || ""));
        return sort.dir === "asc" ? r : -r;
      }
      x = Number(x || 0); y = Number(y || 0);
      return sort.dir === "asc" ? x - y : y - x;
    });
    return arr;
  }, [rows, sort]);

  const I = (label, k, type = "text") => (
    <div><Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label>
      <Input type={type} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="mt-1" data-testid={`cli-${k}`} /></div>
  );

  const Th = ({ label, k, right }) => (
    <th className={`p-3 cursor-pointer select-none hover:text-[#0055A4] ${right ? "text-right" : "text-left"}`} onClick={() => toggleSort(k)} data-testid={`sort-${k}`}>
      <span className={`inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>{label}
        {sort.key === k && (sort.dir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}</span>
    </th>
  );

  return (
    <div className="space-y-5" data-testid="clientes-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Clientes</h1><p className="text-slate-500 text-sm">{rows.length} clientes · doble clic para editar crédito</p></div>
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
          <thead className="bg-slate-50"><tr className="text-xs uppercase tracking-wider text-slate-500">
            <Th label="Código" k="codigo" /><Th label="Nombre" k="nombre" /><Th label="Tipo" k="tipo" />
            <Th label="Crédito" k="credito" /><Th label="Límite" k="limite_credito" right /><Th label="Adeudo" k="saldo" right />
            <Th label="Disponible" k="credito_disponible" right /><Th label="Compras mes" k="compras_mes" right /><Th label="Compras año" k="compras_anio" right />
            <th className="p-3 text-right"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#0055A4]" /></td></tr>}
            {!loading && sorted.length === 0 && <tr><td colSpan={10} className="p-10 text-center text-slate-400"><Users className="w-8 h-8 mx-auto mb-2" />Sin clientes.</td></tr>}
            {!loading && sorted.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onDoubleClick={() => openCredit(c)} data-testid={`cli-row-${c.codigo}`}>
                <td className="p-3 font-medium text-[#0055A4]">{c.codigo}</td>
                <td className="p-3">{c.nombre}</td>
                <td className="p-3"><Badge variant="outline">{tipoLabel[c.tipo]}</Badge></td>
                <td className="p-3">
                  {c.credito_autorizado
                    ? <Badge className="bg-green-100 text-green-700" data-testid={`credito-${c.codigo}`}>Sí</Badge>
                    : <Badge className="bg-slate-200 text-slate-600" data-testid={`credito-${c.codigo}`}>No</Badge>}
                </td>
                <td className="p-3 text-right">{money(c.limite_credito)}</td>
                <td className={`p-3 text-right font-semibold ${c.saldo > 0 ? "text-red-600" : ""}`}>{money(c.saldo)}</td>
                <td className="p-3 text-right text-green-700">{money(c.credito_disponible)}</td>
                <td className="p-3 text-right">{money(c.compras_mes)}</td>
                <td className="p-3 text-right">{money(c.compras_anio)}</td>
                <td className="p-3 text-right">
                  <div className="flex gap-1 justify-end">
                    {can("credito.autorizar") && <Button size="icon" variant="ghost" onClick={() => openCredit(c)} title="Crédito" data-testid={`credito-btn-${c.codigo}`}><CreditCard className="w-4 h-4" /></Button>}
                    {can("cliente.editar") && <Button size="icon" variant="ghost" onClick={() => openEdit(c)} data-testid={`edit-cli-${c.codigo}`}><Pencil className="w-4 h-4" /></Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Formulario cliente */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="cliente-form">
          <DialogHeader><DialogTitle className="font-display">{editId ? "Editar cliente" : "Nuevo cliente"}</DialogTitle></DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {I("Código (auto)", "codigo")}
            <div className="col-span-2 md:col-span-2">{I("Nombre", "nombre")}</div>
            {I("Razón social", "razon_social")}
            {I("RFC", "rfc")}
            {I("Teléfono", "telefono")}
            {I("WhatsApp", "whatsapp")}
            {I("Correo", "correo")}
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Tipo</Label>
              <Select value={f.tipo} onValueChange={(v) => set("tipo", v)}>
                <SelectTrigger className="mt-1" data-testid="cli-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(tipoLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-slate-700 font-semibold pt-2"><MapPin className="w-4 h-4 text-[#0055A4]" /> Domicilio</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="col-span-2">{I("Calle", "calle")}</div>
            {I("Núm. exterior", "numero_exterior")}
            {I("Núm. interior", "numero_interior")}
            {I("Colonia", "colonia")}
            {I("Localidad", "localidad")}
            {I("Municipio", "municipio")}
            {I("Ciudad", "ciudad")}
            {I("Estado", "estado_geo")}
            {I("País", "pais")}
            {I("Código postal", "cp")}
          </div>
          <div><Label className="text-xs uppercase tracking-wider text-slate-500">Referencias</Label>
            <Textarea value={f.referencias} onChange={(e) => set("referencias", e.target.value)} className="mt-1" data-testid="cli-referencias" placeholder="Entre calles, punto de referencia, etc." /></div>

          <div className="flex items-center gap-2 text-slate-700 font-semibold pt-2"><BadgeDollarSign className="w-4 h-4 text-[#0055A4]" /> Comercial y crédito</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 items-end">
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
            {can("credito.autorizar") ? (
              <>
                <div className="flex items-center justify-between border border-slate-200 rounded-md px-3 h-10">
                  <span className="text-sm">Autorizar crédito</span>
                  <Switch checked={f.credito_autorizado} onCheckedChange={(v) => set("credito_autorizado", v)} data-testid="cli-credito-autorizado" />
                </div>
                {I("Límite de crédito", "limite_credito", "number")}
              </>
            ) : (
              <div className="col-span-2 text-xs text-slate-400 self-center">Solo administrador/encargado puede autorizar crédito.</div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="cli-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de crédito (doble clic) */}
      <Dialog open={!!credit} onOpenChange={(o) => !o && setCredit(null)}>
        <DialogContent data-testid="credito-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><CreditCard className="w-5 h-5" /> Crédito · {credit?.nombre}</DialogTitle></DialogHeader>
          {credit && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Límite</div><div className="font-display font-bold">{money(creditForm.limite_credito)}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Adeudo</div><div className="font-display font-bold text-red-600">{money(credit.saldo)}</div></div>
                <div className="bg-slate-50 rounded p-3"><div className="text-xs text-slate-400">Disponible</div><div className="font-display font-bold text-green-700">{money(Number(creditForm.limite_credito) - Number(credit.saldo || 0))}</div></div>
              </div>
              <div className="flex items-center justify-between border border-slate-200 rounded-md px-3 py-2">
                <span className="text-sm font-medium">Crédito autorizado</span>
                <Switch checked={creditForm.credito_autorizado} onCheckedChange={(v) => setCreditForm((s) => ({ ...s, credito_autorizado: v }))} data-testid="credito-switch" />
              </div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Monto de crédito (límite total)</Label>
                <Input type="number" value={creditForm.limite_credito} onChange={(e) => setCreditForm((s) => ({ ...s, limite_credito: e.target.value }))} className="mt-1" data-testid="credito-limite" /></div>
              <p className="text-xs text-slate-400">El disponible se descuenta automáticamente conforme el cliente usa su crédito en ventas.</p>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setCredit(null)}>Cancelar</Button><Button onClick={saveCredit} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="credito-save">Guardar crédito</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
