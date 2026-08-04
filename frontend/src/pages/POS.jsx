import { useEffect, useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, formatApiError, money } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, Plus, Minus, Trash2, ShoppingCart, PauseCircle, PlayCircle, X, Package } from "lucide-react";

const METODOS = [["efectivo", "Efectivo"], ["tarjeta", "Tarjeta"], ["transferencia", "Transferencia"], ["deposito", "Depósito"], ["otros", "Otros"]];

export default function POS() {
  const location = useLocation();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [clients, setClients] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [lista, setLista] = useState(1);
  const [descGlobal, setDescGlobal] = useState(0);
  const [condicion, setCondicion] = useState("contado");
  const [payOpen, setPayOpen] = useState(false);
  const [pagos, setPagos] = useState([{ metodo: "efectivo", monto: "" }]);
  const [suspended, setSuspended] = useState([]);
  const [suspOpen, setSuspOpen] = useState(false);
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    api.get("/clients", { params: { estado: "activo" } }).then((r) => {
      setClients(r.data);
      const pub = r.data.find((c) => c.codigo === "PUBLICO");
      if (pub) setClienteId(pub.id);
    });
    loadSuspended();
  }, []);

  // cargar venta a copiar
  useEffect(() => {
    if (location.state?.copyItems) {
      setCart(location.state.copyItems.map((it) => ({ ...it, cantidad: it.cantidad })));
      toast.info("Venta copiada al carrito");
      nav("/app/pos", { replace: true, state: {} });
    }
  }, [location.state]); // eslint-disable-line

  const loadSuspended = async () => { const { data } = await api.get("/sales-suspended"); setSuspended(data); };

  const search = async (val) => {
    setQ(val);
    if (val.length < 1) return setResults([]);
    const { data } = await api.get("/products", { params: { q: val, estado: "activo" } });
    setResults(data.slice(0, 20));
  };

  const priceOf = (p) => {
    const idx = Math.min(Math.max(lista - 1, 0), (p.precios?.length || 1) - 1);
    return p.precios?.[idx]?.precio_con_iva ?? p.precios?.[0]?.precio_con_iva ?? 0;
  };

  const addToCart = (p) => {
    setCart((c) => {
      const ex = c.find((i) => i.product_id === p.id);
      if (ex) return c.map((i) => (i.product_id === p.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      return [...c, { product_id: p.id, codigo: p.codigo, descripcion: p.descripcion, cantidad: 1, unidad: p.unidad_medida, precio: priceOf(p), iva_tasa: p.iva_tasa || 16, descuento: 0 }];
    });
    setQ(""); setResults([]);
  };
  const updateQty = (id, d) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, cantidad: Math.max(0.001, +(i.cantidad + d).toFixed(3)) } : i)));
  const setQty = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, cantidad: Number(v) || 0 } : i)));
  const setLineDisc = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, descuento: Number(v) || 0 } : i)));
  const remove = (id) => setCart((c) => c.filter((i) => i.product_id !== id));

  const totals = useMemo(() => {
    let subtotal = 0, iva = 0;
    cart.forEach((i) => {
      const base = i.cantidad * i.precio - (i.descuento || 0);
      const neto = base / (1 + i.iva_tasa / 100);
      subtotal += neto; iva += base - neto;
    });
    const sub = subtotal - Number(descGlobal || 0);
    const total = Math.max(0, +(sub + iva).toFixed(2));
    return { subtotal: +sub.toFixed(2), iva: +iva.toFixed(2), total };
  }, [cart, descGlobal]);

  const pagado = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
  const cambio = Math.max(0, +(pagado - totals.total).toFixed(2));

  const openPay = () => {
    if (cart.length === 0) return toast.error("Agrega productos");
    setPagos([{ metodo: "efectivo", monto: condicion === "contado" ? String(totals.total) : "" }]);
    setPayOpen(true);
  };

  const confirmar = async () => {
    try {
      const payload = {
        cliente_id: clienteId || null,
        items: cart.map((i) => ({ product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, cantidad: Number(i.cantidad), unidad: i.unidad, precio: Number(i.precio), iva_tasa: Number(i.iva_tasa), descuento: Number(i.descuento || 0) })),
        descuento_global: Number(descGlobal || 0),
        condicion,
        pagos: condicion === "contado" ? pagos.map((p) => ({ metodo: p.metodo, monto: Number(p.monto || 0) })) : [],
        lista_precios: Number(lista),
      };
      const { data } = await api.post("/sales", payload);
      setTicket(data);
      toast.success(`Venta ${data.folio} registrada`);
      setCart([]); setDescGlobal(0); setPayOpen(false); setPagos([{ metodo: "efectivo", monto: "" }]);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const suspender = async () => {
    if (cart.length === 0) return toast.error("Nada que suspender");
    await api.post("/sales/suspend", { cliente_id: clienteId, items: cart, descuento_global: Number(descGlobal || 0), condicion, pagos: [], lista_precios: Number(lista) });
    toast.success("Venta suspendida"); setCart([]); setDescGlobal(0); loadSuspended();
  };
  const recuperar = async (s) => { setCart(s.payload.items); setDescGlobal(s.payload.descuento_global || 0); setClienteId(s.payload.cliente_id || clienteId); await api.delete(`/sales-suspended/${s.id}`); setSuspOpen(false); loadSuspended(); toast.info("Venta recuperada"); };

  return (
    <div className="flex flex-col lg:flex-row gap-4 -m-6 p-6 h-[calc(100vh-4rem)]" data-testid="pos-page">
      {/* Izquierda: búsqueda + resultados */}
      <div className="lg:w-[60%] flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input autoFocus value={q} onChange={(e) => search(e.target.value)} placeholder="Buscar producto por código, descripción, SKU..." className="pl-10 h-12 text-base" data-testid="pos-search-input" />
          </div>
          <Button variant="outline" className="h-12" onClick={() => setSuspOpen(true)} data-testid="ver-suspendidas"><PlayCircle className="w-4 h-4 mr-1" /> {suspended.length}</Button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white border border-slate-200 rounded-md">
          {results.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 p-10">
              <Package className="w-12 h-12 mb-2" /><p className="text-sm text-slate-400">Escribe para buscar productos</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-2">
              {results.map((p) => (
                <button key={p.id} onClick={() => addToCart(p)} data-testid={`pos-prod-${p.codigo}`}
                  className="text-left border border-slate-200 rounded-md p-3 hover:border-[#0055A4] hover:bg-slate-50 transition-colors">
                  <div className="text-xs text-slate-400">{p.codigo}</div>
                  <div className="text-sm font-medium line-clamp-2 h-10">{p.descripcion}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-display font-bold text-[#0055A4]">{money(priceOf(p))}</span>
                    <Badge variant="outline" className="text-xs">{p.existencia}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Derecha: carrito */}
      <div className="lg:w-[40%] flex flex-col bg-white border border-slate-200 rounded-md min-h-0">
        <div className="p-3 border-b border-slate-200 space-y-2">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-[#0055A4]" />
            <span className="font-display font-bold">Ticket</span>
            <span className="ml-auto text-sm text-slate-400">{cart.length} items</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger className="h-9" data-testid="pos-cliente"><SelectValue placeholder="Cliente" /></SelectTrigger>
              <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(lista)} onValueChange={(v) => setLista(Number(v))}>
              <SelectTrigger className="h-9" data-testid="pos-lista"><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>Precio {n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {cart.length === 0 && <div className="p-8 text-center text-slate-300 text-sm">Carrito vacío</div>}
          {cart.map((i) => (
            <div key={i.product_id} className="p-3" data-testid={`cart-item-${i.codigo}`}>
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{i.descripcion}</div>
                  <div className="text-xs text-slate-400">{i.codigo} · {money(i.precio)}</div>
                </div>
                <button onClick={() => remove(i.product_id)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex items-center border border-slate-200 rounded">
                  <button onClick={() => updateQty(i.product_id, -1)} className="px-2 py-1 hover:bg-slate-100"><Minus className="w-3 h-3" /></button>
                  <Input value={i.cantidad} onChange={(e) => setQty(i.product_id, e.target.value)} className="w-14 h-8 border-0 text-center p-0" data-testid={`cart-qty-${i.codigo}`} />
                  <button onClick={() => updateQty(i.product_id, 1)} className="px-2 py-1 hover:bg-slate-100"><Plus className="w-3 h-3" /></button>
                </div>
                <Input type="number" value={i.descuento} onChange={(e) => setLineDisc(i.product_id, e.target.value)} placeholder="Desc $" className="w-20 h-8" title="Descuento" />
                <span className="ml-auto font-semibold">{money(i.cantidad * i.precio - (i.descuento || 0))}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-slate-500 whitespace-nowrap">Desc. global $</Label>
            <Input type="number" value={descGlobal} onChange={(e) => setDescGlobal(e.target.value)} className="h-8" data-testid="pos-desc-global" />
            <Select value={condicion} onValueChange={setCondicion}>
              <SelectTrigger className="h-8 w-32" data-testid="pos-condicion"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="contado">Contado</SelectItem><SelectItem value="credito">Crédito</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="text-sm space-y-0.5">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
            <div className="flex justify-between text-slate-500"><span>IVA</span><span>{money(totals.iva)}</span></div>
            <div className="flex justify-between font-display text-2xl font-black pt-1"><span>Total</span><span data-testid="pos-total">{money(totals.total)}</span></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-12" onClick={suspender} data-testid="pos-suspend"><PauseCircle className="w-5 h-5" /></Button>
            <Button className="flex-1 h-12 bg-[#FF5A00] hover:bg-[#E04F00] text-base font-bold" onClick={openPay} data-testid="pos-cobrar">Cobrar · {money(totals.total)}</Button>
          </div>
        </div>
      </div>

      {/* Pago */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent data-testid="pay-dialog">
          <DialogHeader><DialogTitle className="font-display">Cobrar · {money(totals.total)}</DialogTitle></DialogHeader>
          {condicion === "credito" ? (
            <p className="text-sm text-slate-600">Venta a <b>crédito</b>: se generará saldo pendiente al cliente por {money(totals.total)}.</p>
          ) : (
            <div className="space-y-3">
              {pagos.map((p, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={p.metodo} onValueChange={(v) => setPagos((s) => s.map((x, idx) => idx === i ? { ...x, metodo: v } : x))}>
                    <SelectTrigger className="w-40" data-testid={`pago-metodo-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{METODOS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" value={p.monto} onChange={(e) => setPagos((s) => s.map((x, idx) => idx === i ? { ...x, monto: e.target.value } : x))} placeholder="0.00" data-testid={`pago-monto-${i}`} />
                  {pagos.length > 1 && <button onClick={() => setPagos((s) => s.filter((_, idx) => idx !== i))}><X className="w-4 h-4 text-slate-400" /></button>}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setPagos((s) => [...s, { metodo: "tarjeta", monto: "" }])} data-testid="add-pago"><Plus className="w-4 h-4 mr-1" /> Pago mixto</Button>
              <div className="flex justify-between text-sm pt-2 border-t"><span>Pagado</span><span className="font-semibold">{money(pagado)}</span></div>
              <div className="flex justify-between text-lg font-bold"><span>Cambio</span><span data-testid="pos-cambio" className="text-green-600">{money(cambio)}</span></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button><Button onClick={confirmar} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="confirmar-venta">Confirmar venta</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspendidas */}
      <Dialog open={suspOpen} onOpenChange={setSuspOpen}>
        <DialogContent data-testid="susp-dialog">
          <DialogHeader><DialogTitle className="font-display">Ventas suspendidas</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {suspended.length === 0 && <p className="text-sm text-slate-400">No hay ventas suspendidas.</p>}
            {suspended.map((s) => (
              <div key={s.id} className="flex items-center justify-between border border-slate-200 rounded-md p-3">
                <div><div className="text-sm font-medium">{s.payload.items.length} productos</div><div className="text-xs text-slate-400">{s.fecha?.slice(0, 16).replace("T", " ")}</div></div>
                <Button size="sm" onClick={() => recuperar(s)} className="bg-[#0055A4] hover:bg-[#004385]"><PlayCircle className="w-4 h-4 mr-1" /> Recuperar</Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Ticket */}
      <Dialog open={!!ticket} onOpenChange={(o) => !o && setTicket(null)}>
        <DialogContent data-testid="ticket-dialog">
          <DialogHeader><DialogTitle className="font-display text-center">Grupo RYSA</DialogTitle></DialogHeader>
          {ticket && (
            <div className="text-sm">
              <div className="text-center text-slate-500 mb-2">Folio {ticket.folio} · {ticket.fecha?.slice(0, 16).replace("T", " ")}</div>
              <div className="text-center mb-3">Cliente: {ticket.cliente_nombre}</div>
              <table className="w-full mb-3">
                <tbody>{ticket.items.map((i, k) => (<tr key={k} className="border-b border-dashed border-slate-200"><td className="py-1">{i.cantidad}x {i.descripcion}</td><td className="py-1 text-right">{money(i.cantidad * i.precio - (i.descuento || 0))}</td></tr>))}</tbody>
              </table>
              <div className="flex justify-between"><span>Subtotal</span><span>{money(ticket.subtotal)}</span></div>
              <div className="flex justify-between"><span>IVA</span><span>{money(ticket.iva_total)}</span></div>
              <div className="flex justify-between font-display text-xl font-black"><span>TOTAL</span><span>{money(ticket.total)}</span></div>
              {ticket.condicion === "contado" && <div className="flex justify-between text-green-600 mt-1"><span>Cambio</span><span>{money(ticket.cambio)}</span></div>}
              {ticket.condicion === "credito" && <div className="text-center text-amber-600 mt-2">Venta a crédito · saldo {money(ticket.saldo)}</div>}
            </div>
          )}
          <DialogFooter><Button onClick={() => window.print()} variant="outline">Imprimir</Button><Button onClick={() => setTicket(null)} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="ticket-nueva">Nueva venta</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
