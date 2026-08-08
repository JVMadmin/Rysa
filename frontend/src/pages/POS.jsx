import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Search, Plus, Minus, Trash2, ShoppingCart, PauseCircle, PlayCircle, X, Package,
  Banknote, ArrowLeftRight, CreditCard, Tag, Printer, Hash, Keyboard, FileText,
  Smartphone, Landmark, Gift, DollarSign, User as UserIcon, Check, Tags, MessageCircle, Loader2,
} from "lucide-react";

const METODOS = [
  ["efectivo", "Efectivo", Banknote],
  ["tarjeta", "Tarjeta", CreditCard],
  ["transferencia", "Transferencia", Landmark],
  ["spei", "SPEI", Smartphone],
  ["deposito", "Depósito", ArrowLeftRight],
  ["otros", "Otro", Gift],
];

export default function POS() {
  const location = useLocation();
  const nav = useNavigate();
  const { user, can } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [selected, setSelected] = useState(null);
  const [clients, setClients] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [vendedores, setVendedores] = useState([]);
  const [vendedorId, setVendedorId] = useState("");
  const [lista, setLista] = useState(1);
  const [descGlobal, setDescGlobal] = useState(0);
  const [descPct, setDescPct] = useState(0);
  const [incluyeIva, setIncluyeIva] = useState(true);
  const [clientQuery, setClientQuery] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [linePrice, setLinePrice] = useState(null); // item para selector de precio
  const [libreVal, setLibreVal] = useState("");
  const [tipoVenta, setTipoVenta] = useState("directa");
  const [formaPago, setFormaPago] = useState("contado"); // contado | transferencia | credito
  const [payOpen, setPayOpen] = useState(false);
  const [pagos, setPagos] = useState([{ metodo: "efectivo", monto: "" }]);
  const [suspended, setSuspended] = useState([]);
  const [suspOpen, setSuspOpen] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [waPhone, setWaPhone] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [settings, setSettings] = useState({});
  const [nextFolio, setNextFolio] = useState({ venta: "", cotizacion: "" });
  const [listaNames, setListaNames] = useState(["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"]);
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);
  const [pcQuery, setPcQuery] = useState("");
  const [pcResults, setPcResults] = useState([]);
  const searchRef = useRef();
  const pcRef = useRef();
  const qRef = useRef("");
  const condicion = formaPago === "credito" ? "credito" : "contado";
  const clienteSel = useMemo(() => clients.find((c) => c.id === clienteId) || null, [clients, clienteId]);
  const credInfo = useMemo(() => {
    if (!clienteSel || clienteSel.codigo === "PUBLICO") return null;
    const lim = Number(clienteSel.limite_credito || 0), sal = Number(clienteSel.saldo || 0);
    const disp = Math.round((lim - sal) * 100) / 100;
    if (!clienteSel.credito_autorizado) return { dot: "bg-slate-800", label: "Sin crédito", lim, sal, disp, ok: false };
    if (clienteSel.estado === "suspendido" || (lim > 0 && sal >= lim)) return { dot: "bg-red-500", label: "Crédito suspendido / al límite", lim, sal, disp, ok: true };
    if (sal > 0) return { dot: "bg-amber-500", label: "Crédito activo con saldo pendiente", lim, sal, disp, ok: true };
    return { dot: "bg-green-500", label: "Crédito activo (disponible)", lim, sal, disp, ok: true };
  }, [clienteSel]);
  const creditoBloqueado = condicion === "credito" && !!clienteSel && !clienteSel.credito_autorizado && clienteSel.codigo !== "PUBLICO";

  useEffect(() => {
    api.get("/clients", { params: { estado: "activo" } }).then((r) => {
      setClients(r.data);
      const pub = r.data.find((c) => c.codigo === "PUBLICO");
      if (pub) setClienteId(pub.id);
    });
    api.get("/vendedores").then((r) => setVendedores(r.data));
    api.get("/settings").then((r) => { setSettings(r.data || {}); if (r.data?.listas_precios_nombres?.length) setListaNames(r.data.listas_precios_nombres); if (r.data && r.data.precios_incluyen_iva !== undefined) setIncluyeIva(!!r.data.precios_incluyen_iva); });
    loadSuspended();
    refreshFolio();
  }, []);

  useEffect(() => { if (user) setVendedorId(user.id); }, [user]);

  // Auto-actualización cada 10s (folio consecutivo + stock) para multi-computadora
  const refreshFolio = useCallback(async () => {
    try { const { data } = await api.get("/sales-next-folio"); setNextFolio(data); } catch {}
  }, []);
  useEffect(() => {
    const t = setInterval(async () => {
      await refreshFolio();
      if (qRef.current) {
        try { const { data } = await api.get("/products", { params: { q: qRef.current, estado: "activo" } }); setResults(data.slice(0, 20)); } catch {}
      }
    }, 10000);
    return () => clearInterval(t);
  }, [refreshFolio]);

  useEffect(() => {
    if (location.state?.copyItems) {
      const st = location.state;
      setCart(st.copyItems.map((it) => ({ ...it })));
      if (st.cliente_id) setClienteId(st.cliente_id);
      if (st.cliente_nombre) setClientQuery(st.cliente_nombre);
      if (st.descuento_global != null) setDescGlobal(st.descuento_global);
      if (st.lista_precios) setLista(Number(st.lista_precios));
      toast.info("Venta cargada en el POS");
      nav("/app/pos", { replace: true, state: {} });
    }
  }, [location.state]); // eslint-disable-line

  // Sincroniza el texto del buscador de cliente cuando cambia el clienteId por código
  useEffect(() => {
    if (clienteId && !clientQuery) {
      const c = clients.find((x) => x.id === clienteId);
      if (c) setClientQuery(c.nombre);
    }
  }, [clienteId, clients]); // eslint-disable-line

  const loadSuspended = async () => { const { data } = await api.get("/sales-suspended"); setSuspended(data); };

  const search = async (val) => {
    setQ(val); qRef.current = val;
    if (val.length < 1) return setResults([]);
    const { data } = await api.get("/products", { params: { q: val, estado: "activo" } });
    setResults(data.slice(0, 20));
  };

  // Lector de código de barras: al presionar Enter, agrega el producto exacto (código o código de barras).
  const onSearchKey = async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = q.trim();
    if (!val) return;
    const matches = (p) => p.codigo?.toLowerCase() === val.toLowerCase() || (p.codigos_barras || []).some((b) => String(b) === val);
    let hit = results.find(matches) || (results.length === 1 ? results[0] : null);
    if (!hit) {
      try {
        const { data } = await api.get("/products", { params: { q: val, estado: "activo" } });
        hit = data.find(matches) || (data.length === 1 ? data[0] : null);
      } catch {}
    }
    if (hit) addToCart(hit);
    else toast.error("Producto no encontrado");
  };

  const sendWhatsApp = async () => {
    if (!ticket?.id) return toast.error("Ticket no disponible");
    setWaSending(true);
    try {
      const { data } = await api.post(`/sales/${ticket.id}/ticket-pdf`);
      const url = fileUrl(data.url);
      const digits = (waPhone || "").replace(/\D/g, "");
      const phone = digits ? (digits.length === 10 ? "52" + digits : digits) : "";
      const msg = `Hola${ticket.cliente_nombre ? " " + ticket.cliente_nombre : ""}, aquí está tu ${ticket.tipo_venta === "cotizacion" ? "cotización" : "ticket"} ${ticket.folio} de ${settings.empresa_nombre || "Grupo RYSA"}. Total: ${money(ticket.total)}. Descárgalo aquí: ${url}`;
      const wa = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(wa, "_blank");
      toast.success("PDF generado, abriendo WhatsApp...");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setWaSending(false); }
  };

  const priceFromList = (p, l) => {
    if (Number(l) === 6) return p.precio_minimo ?? 0;
    const arr = p.precios || [];
    const idx = Math.min(Math.max(Number(l) - 1, 0), (arr.length || 1) - 1);
    return arr[idx]?.precio_con_iva ?? arr[0]?.precio_con_iva ?? 0;
  };
  const priceOf = (p) => priceFromList(p, lista);

  const addToCart = (p) => {
    setCart((c) => {
      const ex = c.find((i) => i.product_id === p.id);
      if (ex) return c.map((i) => (i.product_id === p.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      return [...c, { product_id: p.id, codigo: p.codigo, descripcion: p.descripcion, cantidad: 1, unidad: p.unidad_medida, precio: priceOf(p), iva_tasa: p.iva_tasa || 16, descuento: 0, precios: p.precios || [], precio_minimo: p.precio_minimo ?? 0 }];
    });
    setSelected(p.id);
    setQ(""); qRef.current = ""; setResults([]);
    searchRef.current?.focus();
  };
  // Al cambiar la lista de precios se actualizan automáticamente los precios del carrito
  const applyLista = (l) => {
    setLista(l);
    setCart((c) => c.map((i) => (i.precios?.length ? { ...i, precio: priceFromList({ precios: i.precios, precio_minimo: i.precio_minimo }, l) } : i)));
  };
  // Cliente searchable + aplica su lista de precios y descuento
  const pickClient = (c) => {
    setClienteId(c.id);
    setClientQuery(c.nombre);
    setClientOpen(false);
    const l = Number(c.precio_venta || c.lista_precios || 1);
    if (l >= 1 && l <= 6) applyLista(l);
    setDescPct(Number(c.descuento_permanente || 0));
  };
  const filteredClients = clientQuery
    ? clients.filter((c) => `${c.nombre} ${c.codigo}`.toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 30)
    : clients.slice(0, 30);
  const setLinePrecio = (item, precio) => {
    setCart((c) => c.map((i) => (i.product_id === item.product_id ? { ...i, precio: Number(precio) || 0 } : i)));
    setLinePrice(null); setLibreVal("");
  };
  const updateQty = (id, d) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, cantidad: Math.max(0.001, +(i.cantidad + d).toFixed(3)) } : i)));
  const setQty = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, cantidad: Number(v) || 0 } : i)));
  const setLineDisc = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, descuento: Number(v) || 0 } : i)));
  const remove = (id) => setCart((c) => c.filter((i) => i.product_id !== id));

  const totals = useMemo(() => {
    let brutoTotal = 0; // con IVA
    cart.forEach((i) => { brutoTotal += i.cantidad * i.precio - (i.descuento || 0); });
    const descPctAmount = +(brutoTotal * (Number(descPct) || 0) / 100).toFixed(2);
    const descGlobalTotal = +((Number(descGlobal) || 0) + descPctAmount).toFixed(2);
    let subtotal = 0, iva = 0;
    cart.forEach((i) => {
      const base = i.cantidad * i.precio - (i.descuento || 0);
      const neto = base / (1 + i.iva_tasa / 100);
      subtotal += neto; iva += base - neto;
    });
    const sub = subtotal - descGlobalTotal;
    const total = Math.max(0, +(sub + iva).toFixed(2));
    return { subtotal: +sub.toFixed(2), iva: +iva.toFixed(2), total, descPctAmount, descGlobalTotal };
  }, [cart, descGlobal, descPct]);

  const pagado = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
  const cambio = Math.max(0, +(pagado - totals.total).toFixed(2));

  // Atajos de teclado F6-F9
  useEffect(() => {
    const target = () => selected || (cart.length ? cart[cart.length - 1].product_id : null);
    const onKey = (e) => {
      if (["F6", "F7", "F8", "F9"].includes(e.key)) e.preventDefault();
      if (e.key === "F8") { const t = target(); if (t) { updateQty(t, 1); setSelected(t); } }
      else if (e.key === "F9") { const t = target(); if (t) { updateQty(t, -1); setSelected(t); } }
      else if (e.key === "F7") { setPriceCheckOpen(true); setTimeout(() => pcRef.current?.focus(), 100); }
      else if (e.key === "F6") { const n = lista >= 5 ? 1 : lista + 1; applyLista(n); toast.info(`Lista: ${listaNames[n - 1]}`); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, cart, listaNames, lista]);

  const pcSearch = async (val) => {
    setPcQuery(val);
    if (val.length < 1) return setPcResults([]);
    const { data } = await api.get("/products", { params: { q: val, estado: "activo" } });
    setPcResults(data.slice(0, 10));
  };

  const openPay = () => {
    if (cart.length === 0) return toast.error("Agrega productos");
    if (tipoVenta === "cotizacion") return confirmar();
    if (formaPago === "credito") { setPayOpen(true); return; }
    const metodo = formaPago === "transferencia" ? "transferencia" : "efectivo";
    setPagos([{ metodo, monto: String(totals.total) }]);
    setPayOpen(true);
  };

  const confirmar = async () => {
    try {
      const payload = {
        cliente_id: clienteId || null,
        items: cart.map((i) => ({ product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, cantidad: Number(i.cantidad), unidad: i.unidad, precio: Number(i.precio), iva_tasa: Number(i.iva_tasa), descuento: Number(i.descuento || 0) })),
        descuento_global: totals.descGlobalTotal,
        condicion,
        pagos: (tipoVenta === "directa" && condicion === "contado") ? pagos.map((p) => ({ metodo: p.metodo, monto: Number(p.monto || 0) })) : [],
        lista_precios: Number(lista),
        tipo_venta: tipoVenta,
        vendedor_id: vendedorId || null,
      };
      const { data } = await api.post("/sales", payload);
      setTicket(data);
      setWaPhone(clienteSel?.whatsapp || clienteSel?.telefono || clienteSel?.celular || "");
      toast.success(`${tipoVenta === "cotizacion" ? "Cotización" : "Venta"} ${data.folio} registrada`);
      setCart([]); setDescGlobal(0); setPayOpen(false); setPagos([{ metodo: "efectivo", monto: "" }]); setSelected(null);
      refreshFolio();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const suspender = async () => {
    if (cart.length === 0) return toast.error("Nada que suspender");
    await api.post("/sales/suspend", { cliente_id: clienteId, items: cart, descuento_global: Number(descGlobal || 0), condicion, pagos: [], lista_precios: Number(lista), tipo_venta: tipoVenta });
    toast.success("Venta suspendida"); setCart([]); setDescGlobal(0); loadSuspended();
  };
  const recuperar = async (s) => { setCart(s.payload.items); setDescGlobal(s.payload.descuento_global || 0); setClienteId(s.payload.cliente_id || clienteId); await api.delete(`/sales-suspended/${s.id}`); setSuspOpen(false); loadSuspended(); toast.info("Venta recuperada"); };

  const folioActual = tipoVenta === "cotizacion" ? nextFolio.cotizacion : nextFolio.venta;

  return (
    <div className="flex flex-col lg:flex-row gap-4 -m-6 p-6 h-[calc(100vh-4rem)]" data-testid="pos-page">
      {/* Izquierda */}
      <div className="lg:w-[58%] flex flex-col min-h-0">
        {/* Cliente (ancho completo, con búsqueda) + Lista de precios */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <div className="relative flex-1">
            <UserIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={clientQuery}
              onChange={(e) => { setClientQuery(e.target.value); setClientOpen(true); if (!e.target.value) setClienteId(""); }}
              onFocus={() => setClientOpen(true)}
              placeholder="Cliente: escribe para buscar por nombre o clave..."
              className="pl-10 h-12" data-testid="pos-cliente-search" />
            {clientOpen && filteredClients.length > 0 && (
              <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto" data-testid="pos-cliente-list">
                {filteredClients.map((c) => (
                  <button key={c.id} onClick={() => pickClient(c)} data-testid={`pos-cliente-opt-${c.codigo}`}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                    <span className="truncate"><b className="text-[#B95A3A] mr-1">{c.codigo}</b> {c.nombre}</span>
                    {Number(c.descuento_permanente) > 0 && <Badge variant="outline" className="text-[10px] ml-2">-{c.descuento_permanente}%</Badge>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Select value={String(lista)} onValueChange={(v) => applyLista(Number(v))}>
            <SelectTrigger className="h-12 sm:w-44" data-testid="pos-lista"><Tags className="w-4 h-4 mr-1 text-slate-400" /><SelectValue /></SelectTrigger>
            <SelectContent>
              {listaNames.map((n, i) => <SelectItem key={i} value={String(i + 1)}>{n}</SelectItem>)}
              <SelectItem value="6">Precio mínimo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input ref={searchRef} autoFocus value={q} onChange={(e) => search(e.target.value)} onKeyDown={onSearchKey} placeholder="Buscar producto por código, código de barras o descripción..." className="pl-10 h-12 text-base" data-testid="pos-search-input" />
          </div>
          <Button variant="outline" className="h-12" onClick={() => { setPriceCheckOpen(true); setTimeout(() => pcRef.current?.focus(), 100); }} data-testid="verificar-precio-btn"><Tag className="w-4 h-4 mr-1" /> Precio <kbd className="ml-1 text-[10px] bg-slate-100 px-1 rounded">F7</kbd></Button>
          <Button variant="outline" className="h-12" onClick={() => setSuspOpen(true)} data-testid="ver-suspendidas"><PlayCircle className="w-4 h-4 mr-1" /> {suspended.length}</Button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white border border-slate-200 rounded-md">
          {results.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 p-10">
              <Package className="w-12 h-12 mb-2" /><p className="text-sm text-slate-400">Escribe para buscar productos</p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center text-xs text-slate-400">
                <span className="flex items-center gap-1"><Keyboard className="w-3.5 h-3.5" /> Atajos:</span>
                <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F8</kbd> +cantidad</span>
                <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F9</kbd> −cantidad</span>
                <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F7</kbd> verificar precio</span>
                <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F6</kbd> lista de precios</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-2">
              {results.map((p) => (
                <button key={p.id} onClick={() => addToCart(p)} data-testid={`pos-prod-${p.codigo}`}
                  className="text-left border border-slate-200 rounded-md p-3 hover:border-[#B95A3A] hover:bg-slate-50 transition-colors">
                  <div className="text-xs text-slate-400">{p.codigo}</div>
                  <div className="text-sm font-medium line-clamp-2 h-10">{p.descripcion}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-display font-bold text-[#B95A3A]">{money(priceOf(p))}</span>
                    <Badge variant="outline" className="text-xs">{p.existencia}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Derecha: ticket */}
      <div className="lg:w-[42%] flex flex-col bg-white border border-slate-200 rounded-md min-h-0">
        <div className="p-3 border-b border-slate-200 space-y-2">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-[#B95A3A]" />
            <span className="font-display font-bold">Ticket</span>
            <Badge className="bg-[#B95A3A]/10 text-[#B95A3A] font-mono flex items-center gap-1" data-testid="pos-next-folio"><Hash className="w-3 h-3" />{folioActual}</Badge>
            <span className="ml-auto text-sm text-slate-400">{cart.length} items</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={tipoVenta} onValueChange={setTipoVenta}>
              <SelectTrigger className="h-9" data-testid="pos-tipo-venta"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="directa">Venta directa</SelectItem><SelectItem value="cotizacion">Cotización</SelectItem></SelectContent>
            </Select>
            <Select value={vendedorId} onValueChange={setVendedorId}>
              <SelectTrigger className="h-9" data-testid="pos-vendedor"><SelectValue placeholder="Vendedor" /></SelectTrigger>
              <SelectContent>{vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <UserIcon className="w-3.5 h-3.5" />
            <span className="truncate">{clienteSel ? clienteSel.nombre : "Público General"}</span>
            <Badge variant="outline" className="ml-auto text-[10px]" data-testid="pos-lista-badge">{Number(lista) === 6 ? "Precio mínimo" : listaNames[lista - 1]}</Badge>
            {Number(descPct) > 0 && <Badge className="bg-[#B95A3A]/10 text-[#B95A3A] text-[10px]" data-testid="pos-descpct">-{descPct}%</Badge>}
          </div>
          {credInfo && (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2" data-testid="pos-credito-indicador">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-semibold text-slate-700">
                  <span className={`w-2.5 h-2.5 rounded-full ${credInfo.dot}`} data-testid="pos-credito-dot" /> {credInfo.label}
                </span>
                <span className="text-slate-400">Límite {money(credInfo.lim)}</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-slate-500">Saldo: <b className={credInfo.sal > 0 ? "text-red-600" : "text-slate-700"}>{money(credInfo.sal)}</b></span>
                <span className="text-slate-500">Disponible: <b className={credInfo.disp <= 0 ? "text-red-600" : "text-green-700"}>{money(credInfo.disp)}</b></span>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {cart.length === 0 && <div className="p-8 text-center text-slate-300 text-sm">Carrito vacío</div>}
          {cart.map((i) => (
            <div key={i.product_id} onClick={() => setSelected(i.product_id)}
              className={`p-3 cursor-pointer ${selected === i.product_id ? "bg-[#B95A3A]/5 ring-1 ring-inset ring-[#B95A3A]/30" : ""}`} data-testid={`cart-item-${i.codigo}`}>
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{i.descripcion}</div>
                  <button onClick={(e) => { e.stopPropagation(); setLinePrice(i); setLibreVal(String(i.precio)); }}
                    className="text-xs text-slate-400 hover:text-[#B95A3A] flex items-center gap-1" data-testid={`cart-price-${i.codigo}`}>
                    {i.codigo} · <span className="underline decoration-dotted">{money(i.precio)}</span> <Tag className="w-3 h-3" />
                  </button>
                </div>
                <button onClick={(e) => { e.stopPropagation(); remove(i.product_id); }} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
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
          {tipoVenta === "directa" && (
            <div className="grid grid-cols-3 gap-2">
              {[["contado", "Contado", Banknote], ["transferencia", "Transferencia", ArrowLeftRight], ["credito", "Crédito", CreditCard]].map(([k, l, Ic]) => (
                <button key={k} onClick={() => setFormaPago(k)} data-testid={`forma-pago-${k}`}
                  className={`flex flex-col items-center gap-1 py-2 rounded-md border text-xs font-medium transition-colors ${formaPago === k ? "border-[#B95A3A] bg-[#B95A3A]/5 text-[#B95A3A]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                  <Ic className="w-4 h-4" /> {l}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-slate-500 whitespace-nowrap">Desc. global $</Label>
            <Input type="number" value={descGlobal} onChange={(e) => setDescGlobal(e.target.value)} className="h-8" data-testid="pos-desc-global" />
            <button
              onClick={() => { if (can("config") || can("producto.precio")) setIncluyeIva((v) => !v); else toast.error("Sin permiso para cambiar IVA"); }}
              className={`flex items-center gap-1 text-[11px] whitespace-nowrap px-2 py-1 rounded border ${incluyeIva ? "border-[#B95A3A] text-[#B95A3A] bg-[#B95A3A]/5" : "border-slate-200 text-slate-400"}`}
              data-testid="pos-incluye-iva">
              <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${incluyeIva ? "bg-[#B95A3A] border-[#B95A3A]" : "border-slate-300"}`}>{incluyeIva && <Check className="w-3 h-3 text-white" />}</span>
              Precios incluyen IVA
            </button>
          </div>
          <div className="text-sm space-y-0.5">
            {!incluyeIva && <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>}
            {!incluyeIva && <div className="flex justify-between text-slate-500"><span>IVA ({settings.iva_tasa ?? 16}%)</span><span>{money(totals.iva)}</span></div>}
            {totals.descPctAmount > 0 && <div className="flex justify-between text-[#B95A3A]"><span>Descuento cliente ({descPct}%)</span><span>-{money(totals.descPctAmount)}</span></div>}
            <div className="flex justify-between font-display text-2xl font-black pt-1"><span>Total</span><span data-testid="pos-total">{money(totals.total)}</span></div>
          </div>
          {creditoBloqueado && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="pos-credito-bloqueo">
              <CreditCard className="w-4 h-4" /> Este cliente no tiene crédito habilitado. Usa contado o habilita su crédito en Clientes.
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="h-12" onClick={suspender} data-testid="pos-suspend"><PauseCircle className="w-5 h-5" /></Button>
            <Button className="flex-1 h-12 bg-[#B95A3A] hover:bg-[#8B3A2A] text-base font-bold" onClick={openPay} disabled={creditoBloqueado} data-testid="pos-cobrar">
              {tipoVenta === "cotizacion" ? <><FileText className="w-5 h-5 mr-2" /> Guardar cotización</> : <>Cobrar · {money(totals.total)}</>}
            </Button>
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
                    <SelectTrigger className="w-44" data-testid={`pago-metodo-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{METODOS.map(([k, l, Ic]) => <SelectItem key={k} value={k}><span className="flex items-center gap-2"><Ic className="w-4 h-4" /> {l}</span></SelectItem>)}</SelectContent>
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
          <DialogFooter><Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button><Button onClick={confirmar} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="confirmar-venta">Confirmar venta</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selector de precio por línea */}
      <Dialog open={!!linePrice} onOpenChange={(o) => { if (!o) { setLinePrice(null); setLibreVal(""); } }}>
        <DialogContent data-testid="line-price-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Tag className="w-5 h-5" /> Precio · {linePrice?.descripcion}</DialogTitle></DialogHeader>
          {linePrice && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(linePrice.precios || []).map((pr, i) => (
                  <button key={i} onClick={() => setLinePrecio(linePrice, pr.precio_con_iva)} data-testid={`line-precio-${i + 1}`}
                    className={`flex items-center justify-between border rounded-md px-3 py-2 hover:border-[#B95A3A] ${Math.abs(linePrice.precio - pr.precio_con_iva) < 0.001 ? "border-[#B95A3A] bg-[#B95A3A]/5" : "border-slate-200"}`}>
                    <span className="text-sm text-slate-500">{listaNames[i] || `Precio ${i + 1}`}</span>
                    <span className="font-display font-bold text-[#B95A3A]">{money(pr.precio_con_iva)}</span>
                  </button>
                ))}
                <button onClick={() => setLinePrecio(linePrice, linePrice.precio_minimo)} data-testid="line-precio-min"
                  className="flex items-center justify-between border rounded-md px-3 py-2 hover:border-amber-500 border-slate-200">
                  <span className="text-sm text-slate-500">Precio mínimo</span>
                  <span className="font-display font-bold text-amber-600">{money(linePrice.precio_minimo || 0)}</span>
                </button>
              </div>
              <div className="border-t pt-3">
                <Label className="text-xs uppercase tracking-wider text-slate-500">Precio libre</Label>
                {can("producto.precio") ? (
                  <div className="flex gap-2 mt-1">
                    <Input type="number" value={libreVal} onChange={(e) => setLibreVal(e.target.value)} placeholder="0.00" data-testid="line-precio-libre-input" />
                    <Button onClick={() => setLinePrecio(linePrice, libreVal)} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="line-precio-libre-apply">Aplicar</Button>
                  </div>
                ) : <p className="text-xs text-slate-400 mt-1">No tienes permiso para capturar precio libre.</p>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Verificar precio */}
      <Dialog open={priceCheckOpen} onOpenChange={setPriceCheckOpen}>
        <DialogContent data-testid="price-check-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Tag className="w-5 h-5" /> Verificar precio</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input ref={pcRef} value={pcQuery} onChange={(e) => pcSearch(e.target.value)} placeholder="Buscar producto..." className="pl-9" data-testid="price-check-input" />
          </div>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {pcResults.map((p) => (
              <div key={p.id} className="border border-slate-200 rounded-md p-3">
                <div className="flex justify-between"><div className="font-medium text-sm">{p.descripcion}</div><Badge variant="outline">Exist: {p.existencia}</Badge></div>
                <div className="text-xs text-slate-400 mb-2">{p.codigo}</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {(p.precios || []).map((pr, i) => (
                    <div key={i} className="bg-slate-50 rounded p-1.5 text-center"><div className="text-slate-400">{listaNames[i]}</div><div className="font-semibold text-[#B95A3A]">{money(pr.precio_con_iva)}</div></div>
                  ))}
                </div>
              </div>
            ))}
            {pcQuery && pcResults.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Sin resultados.</p>}
          </div>
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
                <Button size="sm" onClick={() => recuperar(s)} className="bg-[#B95A3A] hover:bg-[#8B3A2A]"><PlayCircle className="w-4 h-4 mr-1" /> Recuperar</Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Ticket térmico */}
      <Dialog open={!!ticket} onOpenChange={(o) => !o && setTicket(null)}>
        <DialogContent data-testid="ticket-dialog">
          <DialogHeader><DialogTitle className="font-display text-center">{ticket?.tipo_venta === "cotizacion" ? "Cotización" : "Ticket de venta"}</DialogTitle></DialogHeader>
          {ticket && (
            <div id="thermal-ticket" className="thermal font-mono text-[12px] text-black bg-white p-2 mx-auto">
              <div className="text-center">
                <div className="font-bold text-[14px]">{settings.empresa_nombre || "Grupo RYSA"}</div>
                {settings.direccion && <div>{settings.direccion}</div>}
                {(settings.ciudad || settings.estado) && <div>{[settings.ciudad, settings.estado].filter(Boolean).join(", ")}</div>}
                {settings.telefono && <div>Tel: {settings.telefono}</div>}
                {settings.rfc && <div>RFC: {settings.rfc}</div>}
              </div>
              <div className="border-t border-dashed border-black my-1" />
              <div>{ticket.tipo_venta === "cotizacion" ? "COTIZACIÓN" : "FOLIO"}: {ticket.folio}</div>
              <div>Fecha: {ticket.fecha?.slice(0, 16).replace("T", " ")}</div>
              <div>Cliente: {ticket.cliente_nombre}</div>
              <div>Atendió: {ticket.vendedor_nombre}</div>
              <div className="border-t border-dashed border-black my-1" />
              <table className="w-full">
                <tbody>
                  {ticket.items.map((i, k) => (
                    <tr key={k}><td className="align-top">{i.cantidad} x {i.descripcion}<br /><span className="text-[10px]">{money(i.precio)} c/u</span></td><td className="text-right align-top">{money(i.cantidad * i.precio - (i.descuento || 0))}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-dashed border-black my-1" />
              {!incluyeIva && <div className="flex justify-between"><span>Subtotal</span><span>{money(ticket.subtotal)}</span></div>}
              {!incluyeIva && <div className="flex justify-between"><span>IVA</span><span>{money(ticket.iva_total)}</span></div>}
              <div className="flex justify-between font-bold text-[14px]"><span>TOTAL</span><span>{money(ticket.total)}</span></div>
              {incluyeIva && <div className="text-center text-[10px]">Precios con IVA incluido</div>}
              {ticket.tipo_venta === "directa" && ticket.condicion === "contado" && (<><div className="flex justify-between mt-1"><span>Pagado</span><span>{money((ticket.pagos || []).reduce((s, p) => s + p.monto, 0))}</span></div><div className="flex justify-between"><span>Cambio</span><span>{money(ticket.cambio)}</span></div></>)}
              {ticket.condicion === "credito" && <div className="text-center mt-1">** VENTA A CRÉDITO ** Saldo: {money(ticket.saldo)}</div>}
              <div className="border-t border-dashed border-black my-1" />
              <div className="text-center text-[11px]">¡Gracias por su compra!</div>
            </div>
          )}
          <div className="border-t border-slate-200 pt-3 space-y-2" data-testid="ticket-whatsapp-box">
            <Label className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5 text-green-600" /> Enviar por WhatsApp</Label>
            <div className="flex gap-2">
              <Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="Teléfono (10 dígitos)" className="h-10" data-testid="ticket-wa-phone" />
              <Button onClick={sendWhatsApp} disabled={waSending} className="h-10 bg-[#25D366] hover:bg-[#1ebe57] text-white whitespace-nowrap" data-testid="ticket-wa-send">
                {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><MessageCircle className="w-4 h-4 mr-1" /> Enviar PDF</>}
              </Button>
            </div>
          </div>
          <DialogFooter><Button onClick={() => window.print()} variant="outline" data-testid="ticket-print"><Printer className="w-4 h-4 mr-1" /> Imprimir</Button><Button onClick={() => setTicket(null)} className="bg-[#B95A3A] hover:bg-[#8B3A2A]" data-testid="ticket-nueva">Nueva venta</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
