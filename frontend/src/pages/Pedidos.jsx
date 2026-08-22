import { useEffect, useMemo, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, ShoppingCart, Eye, Trash2, RefreshCw, CheckCircle2, ArrowRightCircle } from "lucide-react";

const ESTADOS = {
  borrador: ["bg-slate-100 text-slate-600", "Borrador"],
  confirmado: ["bg-blue-100 text-blue-700", "Confirmado"],
  surtido: ["bg-amber-100 text-amber-700", "Surtido"],
  convertido: ["bg-green-100 text-green-700", "Convertido"],
  cancelado: ["bg-red-100 text-red-700", "Cancelado"],
};

const METODOS = [["efectivo", "Efectivo"], ["tarjeta", "Tarjeta"], ["transferencia", "Transferencia"], ["spei", "SPEI"], ["deposito", "Depósito"], ["otros", "Otro"]];

export default function Pedidos() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("todos");
  const [productos, setProductos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [det, setDet] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [conv, setConv] = useState(null);
  const [convForm, setConvForm] = useState({ condicion: "contado", metodo: "efectivo", monto: "" });
  const [convSaving, setConvSaving] = useState(false);

  const blank = () => ({ cliente_id: "", fecha_pedido: new Date().toISOString().slice(0, 10), fecha_entrega: "", notas: "", items: [] });
  const [form, setForm] = useState(blank());

  const load = async () => {
    setLoading(true); setErr("");
    const params = {};
    if (fEstado !== "todos") params.estado = fEstado;
    try {
      const { data } = await api.get("/pedidos", { params });
      setRows(data || []);
    } catch (e) {
      setErr(formatApiError(e.response?.data?.detail) || "No se pudieron cargar los pedidos.");
      setRows([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fEstado]);

  useEffect(() => {
    api.get("/products", { params: { limit: 5000 } }).then((r) => setProductos(Array.isArray(r.data) ? r.data : (r.data?.items || []))).catch(() => setProductos([]));
    api.get("/clients", { params: { estado: "activo" } }).then((r) => setClientes(r.data || [])).catch(() => setClientes([]));
  }, []);

  const itemsFiltrados = useMemo(() => {
    const x = itemSearch.toLowerCase().trim();
    if (!x) return productos;
    return productos.filter((p) => `${p.codigo} ${p.sku || ""} ${p.descripcion} ${p.categoria || ""}`.toLowerCase().includes(x)).slice(0, 20);
  }, [productos, itemSearch]);

  const addItem = (p) => {
    const existe = form.items.find((i) => i.product_id === p.id);
    if (existe) { setForm((s) => ({ ...s, items: s.items.map((i) => i.product_id === p.id ? { ...i, solicitado: String(Number(i.solicitado) + 1) } : i) })); return; }
    setForm((s) => ({ ...s, items: [...s.items, { product_id: p.id, codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad || "PZA", solicitado: "1", precio: String(p.precio || (p.precios?.[0]?.precio_con_iva) || 0), iva_tasa: String(p.iva_tasa ?? 8) }] }));
  };
  const upItem = (idx, key, val) => setForm((s) => ({ ...s, items: s.items.map((i, k) => k === idx ? { ...i, [key]: val } : i) }));
  const delItem = (idx) => setForm((s) => ({ ...s, items: s.items.filter((_, k) => k !== idx) }));

  const guardar = async () => {
    if (form.items.length === 0) return toast.error("Agrega al menos un producto");
    setSaving(true);
    const payload = {
      cliente_id: form.cliente_id || null,
      fecha_pedido: form.fecha_pedido, fecha_entrega: form.fecha_entrega || null, notas: form.notas,
      items: form.items.map((i) => ({ product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, solicitado: Number(i.solicitado), precio: Number(i.precio || 0), iva_tasa: Number(i.iva_tasa || 8) })),
    };
    try {
      if (editing) {
        const { data } = await api.put(`/pedidos/${editing.id}`, payload);
        toast.success(`Pedido ${data.folio} actualizado`);
      } else {
        const { data } = await api.post("/pedidos", payload);
        toast.success(`Pedido ${data.folio} creado`);
      }
      setOpen(false); setForm(blank()); setEditing(null); setItemSearch(""); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const cambiarEstado = async (p, estado) => {
    if (estado === "cancelado" && !window.confirm(`¿Cancelar el pedido ${p.folio}?`)) return;
    try { await api.post(`/pedidos/${p.id}/estado`, { estado }); toast.success(`Pedido ${p.folio}: ${estado}`); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const convertir = async () => {
    if (!conv) return;
    const monto = Number(convForm.monto || 0);
    if (convForm.condicion === "contado" && monto <= 0) return toast.error("Indica el monto cobrado");
    setConvSaving(true);
    try {
      const pagos = convForm.condicion === "credito" ? [] : [{ metodo: convForm.metodo, monto }];
      const { data } = await api.post(`/pedidos/${conv.id}/convertir`, { condicion: convForm.condicion, pagos });
      toast.success(`Pedido ${conv.folio} convertido a venta ${data.folio}`);
      setConv(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setConvSaving(false); }
  };

  const abrirEditar = (p) => {
    setEditing(p);
    setForm({
      cliente_id: p.cliente_id || "", fecha_pedido: (p.fecha_pedido || "").slice(0, 10), fecha_entrega: (p.fecha_entrega || "").slice(0, 10), notas: p.notas || "",
      items: (p.items || []).map((i) => ({ product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad || "PZA", solicitado: String(i.solicitado), precio: String(i.precio || 0), iva_tasa: String(i.iva_tasa || 8) })),
    });
    setItemSearch(""); setOpen(true);
  };

  const filtrados = rows.filter((p) => !q || `${p.folio} ${p.cliente_nombre || ""} ${p.vendedor_nombre || ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5" data-testid="pedidos-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><ShoppingCart className="w-6 h-6 text-[#C1401E]" /> Pedidos</h1>
          <p className="text-slate-500 text-sm">Órdenes de clientes · conviértelas a venta desde el POS</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-9" onClick={load}><RefreshCw className="w-4 h-4 mr-1" /> Actualizar</Button>
          <Button className="h-9 bg-[#C1401E] hover:bg-[#A03316]" onClick={() => { setEditing(null); setForm(blank()); setItemSearch(""); setOpen(true); }} data-testid="nuevo-pedido">
            <Plus className="w-4 h-4 mr-1" /> Nuevo pedido
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 card-soft p-3">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-[10px] uppercase text-slate-400">Buscar</Label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Folio, cliente o vendedor..." className="mt-1 h-9" data-testid="pedidos-q" />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Estado</Label>
          <Select value={fEstado} onValueChange={setFEstado}>
            <SelectTrigger className="w-40 mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {Object.keys(ESTADOS).map((k) => <SelectItem key={k} value={k}>{ESTADOS[k][1]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {err && <div className="card-soft p-6 text-center text-red-600"><p className="mb-3">{err}</p><Button variant="outline" onClick={load}>Reintentar</Button></div>}
      {!err && loading && <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>}

      {!err && !loading && (
        <div className="card-soft overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="p-2">Folio</th><th className="p-2">Cliente</th><th className="p-2">Fecha</th><th className="p-2">Entrega</th>
              <th className="p-2 text-right">Total</th><th className="p-2">Estado</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {filtrados.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">Sin pedidos.</td></tr>}
              {filtrados.map((p) => {
                const [cls, label] = ESTADOS[p.estado] || ["bg-slate-100 text-slate-600", p.estado];
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`pedido-${p.folio}`}>
                    <td className="p-2 font-medium text-[#C1401E]">{p.folio}</td>
                    <td className="p-2">{p.cliente_nombre || "—"}</td>
                    <td className="p-2 text-slate-500">{(p.fecha_pedido || "").slice(0, 10)}</td>
                    <td className="p-2 text-slate-500">{(p.fecha_entrega || "").slice(0, 10) || "—"}</td>
                    <td className="p-2 text-right font-semibold">{money(p.total)}</td>
                    <td className="p-2"><Badge className={cls}>{label}</Badge>{p.convertida_folio && <span className="ml-1 text-[10px] text-green-600">→ {p.convertida_folio}</span>}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setDet(p)}><Eye className="w-4 h-4" /></Button>
                      {["borrador", "confirmado", "surtido"].includes(p.estado) && (
                        <Button size="sm" variant="outline" onClick={() => abrirEditar(p)}><Plus className="w-3.5 h-3.5" /></Button>
                      )}
                      {["borrador", "confirmado", "surtido"].includes(p.estado) && can("venta.crear") && (
                        <Button size="sm" className="bg-[#C1401E] hover:bg-[#A03316] ml-1" onClick={() => { setConv(p); setConvForm({ condicion: "contado", metodo: "efectivo", monto: "" }); }} data-testid={`convertir-pedido-${p.folio}`}>
                          <ArrowRightCircle className="w-3.5 h-3.5 mr-1" /> Vender
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalle */}
      <Dialog open={!!det} onOpenChange={(o) => !o && setDet(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Pedido {det?.folio}</DialogTitle></DialogHeader>
          {det && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-slate-400">Cliente</Label><div className="font-semibold">{det.cliente_nombre || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Vendedor</Label><div>{det.vendedor_nombre || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Fecha pedido</Label><div>{(det.fecha_pedido || "").slice(0, 10)}</div></div>
                <div><Label className="text-xs text-slate-400">Entrega</Label><div>{(det.fecha_entrega || "").slice(0, 10) || "—"}</div></div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                    <th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2 text-right">Pedido</th><th className="p-2 text-right">Precio</th><th className="p-2 text-right">Importe</th>
                  </tr></thead>
                  <tbody>
                    {(det.items || []).map((i, k) => (
                      <tr key={k} className="border-t border-slate-100">
                        <td className="p-2 font-mono text-[10px]">{i.codigo}</td>
                        <td className="p-2">{i.descripcion}</td>
                        <td className="p-2 text-right">{i.solicitado}</td>
                        <td className="p-2 text-right">{money(i.precio)}</td>
                        <td className="p-2 text-right font-semibold">{money(i.importe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end"><div className="w-56 space-y-1">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(det.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">IVA</span><span>{money(det.iva)}</span></div>
                <div className="flex justify-between font-bold border-t pt-1"><span>TOTAL</span><span>{money(det.total)}</span></div>
              </div></div>
              {det.notas && <div><Label className="text-xs text-slate-400">Notas</Label><p className="text-slate-600">{det.notas}</p></div>}
              <DialogFooter><Button variant="outline" onClick={() => setDet(null)}>Cerrar</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Crear / editar pedido */}
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="pedido-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2">{editing ? <Eye className="w-5 h-5 text-[#C1401E]" /> : <Plus className="w-5 h-5 text-[#C1401E]" />} {editing ? `Editar ${editing.folio}` : "Nuevo pedido"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs uppercase tracking-wider text-slate-500">Cliente</Label>
                <Select value={form.cliente_id} onValueChange={(v) => setForm((s) => ({ ...s, cliente_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona cliente" /></SelectTrigger>
                  <SelectContent>{clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.codigo} · {c.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Fecha pedido</Label><Input type="date" value={form.fecha_pedido} onChange={(e) => setForm((s) => ({ ...s, fecha_pedido: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Fecha entrega</Label><Input type="date" value={form.fecha_entrega} onChange={(e) => setForm((s) => ({ ...s, fecha_entrega: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Notas</Label><Input value={form.notas} onChange={(e) => setForm((s) => ({ ...s, notas: e.target.value }))} className="mt-1" placeholder="Condiciones, instrucciones..." /></div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1">Agregar producto</Label>
              <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Buscar producto por código, nombre, categoría..." className="h-9" />
              {itemSearch && (
                <div className="border rounded-md mt-1 max-h-40 overflow-y-auto divide-y">
                  {itemsFiltrados.length === 0 && <div className="p-2 text-xs text-slate-400">Sin resultados</div>}
                  {itemsFiltrados.map((p) => (
                    <button key={p.id} type="button" onClick={() => addItem(p)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-xs">
                      <b className="text-[#C1401E]">{p.codigo}</b><span className="flex-1 truncate">{p.descripcion}</span>
                      <span className="text-slate-400">Precio: {money(p.precio || p.precios?.[0]?.precio_con_iva || 0)}</span><Plus className="w-3.5 h-3.5 text-[#C1401E]" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {form.items.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                    <th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2 text-right w-20">Cant.</th><th className="p-2 text-right w-24">Precio</th><th className="p-2 w-8"></th>
                  </tr></thead>
                  <tbody>{form.items.map((i, k) => (
                    <tr key={k} className="border-t border-slate-100">
                      <td className="p-2 font-mono text-[10px]">{i.codigo}</td>
                      <td className="p-2 max-w-[180px] truncate">{i.descripcion}</td>
                      <td className="p-2"><Input type="number" value={i.solicitado} onChange={(e) => upItem(k, "solicitado", e.target.value)} className="h-6 w-20 text-right p-1" /></td>
                      <td className="p-2"><Input type="number" value={i.precio} onChange={(e) => upItem(k, "precio", e.target.value)} className="h-6 w-24 text-right p-1" /></td>
                      <td className="p-2"><button type="button" onClick={() => delItem(k)}><Trash2 className="w-4 h-4 text-slate-400 hover:text-red-600" /></button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="guardar-pedido">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Guardar pedido</>}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Convertir pedido a venta */}
      <Dialog open={!!conv} onOpenChange={(o) => !o && setConv(null)}>
        <DialogContent className="max-w-md" data-testid="convertir-pedido-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><ArrowRightCircle className="w-5 h-5 text-[#C1401E]" /> Convertir {conv?.folio} a venta</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="card-soft p-3 bg-amber-50"><div className="text-xs text-slate-500">Total del pedido</div><div className="font-display text-xl font-black text-[#C1401E]">{money(conv?.total)}</div></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Condición</Label>
              <Select value={convForm.condicion} onValueChange={(v) => setConvForm((s) => ({ ...s, condicion: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="contado">Contado</SelectItem><SelectItem value="credito">Crédito</SelectItem></SelectContent>
              </Select>
            </div>
            {convForm.condicion === "contado" && (
              <>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Método de pago</Label>
                  <Select value={convForm.metodo} onValueChange={(v) => setConvForm((s) => ({ ...s, metodo: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{METODOS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Monto cobrado</Label>
                  <Input type="number" value={convForm.monto} onChange={(e) => setConvForm((s) => ({ ...s, monto: e.target.value }))} className="mt-1" placeholder={String(conv?.total || 0)} />
                </div>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConv(null)}>Cancelar</Button>
              <Button onClick={convertir} disabled={convSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="confirmar-convertir-pedido">
                {convSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <><ArrowRightCircle className="w-4 h-4 mr-1" /> Convertir a venta</>}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}