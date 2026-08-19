import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { numeroALetras } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Search, Plus, Minus, Trash2, ShoppingCart, PauseCircle, PlayCircle, X, Package,
  Banknote, ArrowLeftRight, CreditCard,   Tag, Printer, Hash, Keyboard, FileText,
  Smartphone, Landmark, Gift, DollarSign, User as UserIcon, Check, Tags, MessageCircle, Loader2,
  Star, Flame, LayoutGrid, HandCoins,
} from "lucide-react";

const METODOS = [
  ["efectivo", "Efectivo", Banknote],
  ["tarjeta", "Tarjeta", CreditCard],
  ["transferencia", "Transferencia", Landmark],
  ["spei", "SPEI", Smartphone],
  ["deposito", "Depósito", ArrowLeftRight],
  ["otros", "Otro", Gift],
];

const LISTAS_PCT_DEFAULT = [40, 30, 20, 15, 10];
const UNIDADES_OPC = ["PZA", "PAQ", "KILO", "KG", "GR", "LT", "ML", "MTR", "CM", "CAJ", "BOT", "LATA", "DOC", "PAR", "ROLLO", "BULTO", "SERV"];

// Precio de una lista concreta. Usa el precio guardado del producto; si la lista
// no tiene precio configurado lo calcula aplicando el % de utilidad de la
// configuración (listas_precios_pct) sobre el costo, con IVA.
const calcListPrice = (p, l, pct) => {
  const n = pct?.length ?? LISTAS_PCT_DEFAULT.length;
  if (Number(l) === n + 1) return Number(p.precio_minimo ?? 0);
  const arr = p.precios || [];
  const lIdx = Number(l) - 1;
  const stored = arr[lIdx]?.precio_con_iva;
  if (stored) return stored;
  const costo = Number(p.costo ?? 0);
  if (costo > 0 && lIdx < n) {
    const pctLista = Number(pct[lIdx] ?? pct[0] ?? 0);
    const sin = costo * (1 + pctLista / 100);
    return +(sin * (1 + Number(p.iva_tasa ?? p.iva ?? 16) / 100)).toFixed(2);
  }
  return arr[0]?.precio_con_iva ?? 0;
};

const PRODUCT_EX_CLS = (ex) => {
  const n = Number(ex || 0);
  if (n <= 0) return "bg-red-100 text-red-700 border-red-300";
  if (n < 5) return "bg-orange-100 text-orange-700 border-orange-300";
  if (n < 10) return "bg-yellow-100 text-yellow-700 border-yellow-300";
  return "bg-green-100 text-green-700 border-green-300";
};

const ProductCard = ({ p, onAdd, priceOf, isFav, onFav, mostrarSold }) => {
  const neto = priceOf(p);
  const tasa = Number(p.iva_tasa || 16);
  const conIva = +(neto * (1 + tasa / 100)).toFixed(2);
  return (
  <div className="relative">
    <button onClick={onAdd} data-testid={`pos-prod-${p.codigo}`}
      className="w-full text-left border border-slate-200 rounded-md p-2 hover:border-[#C1401E] hover:bg-slate-50 transition-colors">
      {p.imagen_url && <img src={fileUrl(p.imagen_url)} alt="" className="h-10 w-10 object-contain mb-1 mx-auto" />}
      <div className="text-[10px] text-slate-400 truncate">{p.codigo}</div>
      <div className="text-xs font-medium line-clamp-2 h-7">{p.descripcion}</div>
      <div className="flex items-center justify-between mt-0.5">
        <div>
          <span className="font-display font-bold text-[#C1401E] text-xs">{money(neto)}</span>
          <span className="text-[9px] text-slate-400 ml-0.5">({money(conIva)})</span>
        </div>
        <span className="flex items-center gap-0.5">
          {mostrarSold && p.vendidas > 0 && <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300 h-4 leading-none">{p.vendidas}</Badge>}
          <Badge variant="outline" className={`text-[11px] h-5 leading-none px-1.5 font-bold ${PRODUCT_EX_CLS(p.existencia)}`} data-testid={`pos-ex-${p.codigo}`}>{p.existencia}</Badge>
        </span>
      </div>
    </button>
    <button onClick={onFav} title={isFav ? "Quitar de favoritos" : "Agregar a favoritos"} data-testid={`pos-fav-${p.codigo}`}
      className="absolute top-0.5 right-0.5 p-0.5 text-slate-300 hover:text-amber-400 transition-colors">
      <Star className={`w-[15px] h-[15px] ${isFav ? "fill-amber-400 text-amber-400" : ""}`} />
    </button>
  </div>
  );
};

export default function POS({ windowId, windowLabel }) {
  const location = useLocation();
  const nav = useNavigate();
  const { user, can } = useAuth();
  const {
    cart, setCart,
    descGlobal, setDescGlobal,
    descMode, setDescMode,
    descPct, setDescPct,
    clienteId, setClienteId,
    lista, setLista,
    tipoVenta, setTipoVenta,
    formaPago, setFormaPago,
    vendedorId, setVendedorId,
    pagos, setPagos,
  } = useCart(windowId);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [clients, setClients] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [incluyeIva, setIncluyeIva] = useState(true);
  const [clientQuery, setClientQuery] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [pubClientId, setPubClientId] = useState("");
  const [linePrice, setLinePrice] = useState(null);
  const [selProd, setSelProd] = useState(null);
  const [libreVal, setLibreVal] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [invOverride, setInvOverride] = useState(null); // {motivo} dialog de inventario insuficiente
  const [invReason, setInvReason] = useState("");
  const [suspended, setSuspended] = useState([]);
  const [suspOpen, setSuspOpen] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [waPhone, setWaPhone] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [settings, setSettings] = useState({});
  const [nextFolio, setNextFolio] = useState({ venta: "", cotizacion: "" });
  const [listaNames, setListaNames] = useState(["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"]);
  const [listasPct, setListasPct] = useState(LISTAS_PCT_DEFAULT);
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);
  const [pcQuery, setPcQuery] = useState("");
  const [pcResults, setPcResults] = useState([]);
  const searchRef = useRef();
  const pcRef = useRef();
  const qRef = useRef("");
  // --- Catálogo POS: categorías, favoritos, más vendidos ---
  const [categorias, setCategorias] = useState([]);
  const [categoriaSel, setCategoriaSel] = useState("");
  const [vista, setVista] = useState("todos"); // todos | favoritos | mas_vendidos
  const [catalogo, setCatalogo] = useState([]);
  const [favIds, setFavIds] = useState(new Set());
  const [catLoading, setCatLoading] = useState(false);
  // --- Abono de crédito desde POS ---
  const [abonoCli, setAbonoCli] = useState(null);
  const [abono, setAbono] = useState({ monto: "", metodo: "efectivo", referencia: "" });
  const [abonoSaving, setAbonoSaving] = useState(false);
  const [printMode, setPrintMode] = useState("thermal"); // thermal | invoice

  const injectPageSize = useCallback((size) => {
    let el = document.getElementById("print-page-size");
    if (!el) { el = document.createElement("style"); el.id = "print-page-size"; document.head.appendChild(el); }
    el.textContent = `@page { size: ${size}; margin: 0; }`;
  }, []);

  const printThermal = useCallback(() => {
    injectPageSize("80mm auto");
    document.body.classList.remove("print-mode-invoice");
    const src = document.getElementById("thermal-ticket");
    let wrap = document.getElementById("thermal-print-clone");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "thermal-print-clone"; document.body.appendChild(wrap); }
    if (src) {
      const clone = src.cloneNode(true);
      wrap.innerHTML = "";
      wrap.appendChild(clone);
    }
    setTimeout(() => { window.print(); }, 60);
  }, [injectPageSize]);

  const printInvoice = useCallback(() => {
    injectPageSize("Letter portrait");
    document.body.classList.add("print-mode-invoice");
    setTimeout(() => { window.print(); document.body.classList.remove("print-mode-invoice"); }, 50);
  }, [injectPageSize]);
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
      if (pub) { setPubClientId(pub.id); if (!clienteId) setClienteId(pub.id); }
    });
    api.get("/vendedores").then((r) => setVendedores(r.data));
    api.get("/settings").then((r) => { setSettings(r.data || {}); if (r.data?.listas_precios_nombres?.length) setListaNames(r.data.listas_precios_nombres); if (r.data?.listas_precios_pct?.length) setListasPct(r.data.listas_precios_pct); if (r.data && r.data.precios_incluyen_iva !== undefined) setIncluyeIva(!!r.data.precios_incluyen_iva); });
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

  // Carga las categorías + favoritos una vez
  const loadCatalogMeta = async () => {
    try {
      const [cats, favs] = await Promise.all([
        api.get("/categories").catch(() => ({ data: [] })),
        api.get("/favorites").catch(() => ({ data: [] })),
      ]);
      setCategorias(cats.data || []);
      setFavIds(new Set((favs.data || []).map((p) => p.id)));
    } catch {}
  };

  // Carga el catálogo según vista (todos/favoritos/más vendidos) y categoría
  const loadCatalogo = useCallback(async (vistaActual, catActual) => {
    setCatLoading(true);
    try {
      let data = [];
      if (vistaActual === "favoritos") {
        const { data: prods } = await api.get("/favorites");
        data = prods || [];
      } else if (vistaActual === "mas_vendidos") {
        const { data: prods } = await api.get("/products/bestsellers", { params: { estado: "activo", limit: 40 } });
        data = prods || [];
      } else {
        const params = { estado: "activo", skip: 0, limit: 200 };
        if (catActual) params.categoria = catActual;
        const { data: prods } = await api.get("/products", { params });
        data = prods || [];
      }
      setCatalogo(data);
    } catch {} finally { setCatLoading(false); }
  }, []);

  useEffect(() => { loadCatalogMeta(); }, []);
  useEffect(() => { loadCatalogo(vista, categoriaSel); }, [vista, categoriaSel, loadCatalogo]);

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

  const priceFromList = (p, l) => calcListPrice(p, l, listasPct);
  const priceOf = (p) => priceFromList(p, lista);

  const addToCart = (p) => {
    setSelProd(p);
    setCart((c) => {
      const ex = c.find((i) => i.product_id === p.id);
      if (ex) return c.map((i) => (i.product_id === p.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      return [...c, { product_id: p.id, codigo: p.codigo || "", descripcion: p.descripcion || "", cantidad: 1, unidad: p.unidad_medida || "PZA", precio: priceOf(p), iva_tasa: p.iva_tasa || 16, costo: Number(p.costo ?? 0), descuento: 0, comentario: "", precios: p.precios || [], precio_minimo: p.precio_minimo ?? 0, existencia: Number(p.existencia ?? 0) }];
    });
    setSelected(p.id);
    setQ(""); qRef.current = ""; setResults([]);
    searchRef.current?.focus();
  };

  // Agrega un producto al carrito con un precio elegido explícitamente
  const addToCartWithPrice = (p, precio) => {
    const pid = p.product_id || p.id;
    setSelProd(p);
    setCart((c) => {
      const ex = c.find((i) => i.product_id === pid);
      if (ex) return c.map((i) => (i.product_id === pid ? { ...i, precio: Number(precio) || 0 } : i));
      return [...c, { product_id: pid, codigo: p.codigo || "", descripcion: p.descripcion || "", cantidad: 1, unidad: p.unidad_medida || p.unidad || "PZA", precio: Number(precio) || 0, iva_tasa: p.iva_tasa || 16, costo: Number(p.costo ?? 0), descuento: 0, comentario: "", precios: p.precios || [], precio_minimo: p.precio_minimo ?? 0, existencia: Number(p.existencia ?? 0) }];
    });
    setSelected(pid);
    setQ(""); qRef.current = ""; setResults([]);
    searchRef.current?.focus();
  };
  // Al cambiar la lista de precios se actualizan automáticamente los precios del carrito
  const applyLista = (l) => {
    setLista(l);
    setCart((c) => c.map((i) => (i.precios?.length ? { ...i, precio: priceFromList({ precios: i.precios, precio_minimo: i.precio_minimo, costo: i.costo, iva_tasa: i.iva_tasa }, l) } : i)));
  };
  // Alterna un producto en los favoritos del usuario
  const toggleFav = async (e, pid) => {
    e.stopPropagation();
    const isFav = favIds.has(pid);
    setFavIds((prev) => { const n = new Set(prev); if (isFav) n.delete(pid); else n.add(pid); return n; });
    try {
      if (isFav) await api.delete(`/favorites/${pid}`);
      else await api.post(`/favorites/${pid}`);
    } catch { setFavIds((prev) => { const n = new Set(prev); if (isFav) n.add(pid); else n.delete(pid); return n; }); }
  };
  // Cliente searchable + aplica su lista de precios y descuento
  const pickClient = (c) => {
    setClienteId(c.id);
    setClientQuery(c.nombre);
    setClientOpen(false);
    const l = Number(c.precio_venta || c.lista_precios || 1);
    if (l >= 1 && l <= listaNames.length + 1) applyLista(l);
    setDescPct(Number(c.descuento_permanente || 0));
  };
  const filteredClients = clientQuery
    ? clients.filter((c) => `${c.nombre} ${c.codigo} ${c.rfc || ""}`.toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 100)
    : clients; // lista completa en orden alfabético (el backend ya ordena por nombre)
  const setLinePrecio = (item, precio) => {
    const inCart = cart.some((i) => i.product_id === item.product_id);
    if (inCart) setCart((c) => c.map((i) => (i.product_id === item.product_id ? { ...i, precio: Number(precio) || 0 } : i)));
    else addToCartWithPrice(item, precio);
    setLinePrice(null); setLibreVal("");
  };
  const updateQty = (id, d) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, cantidad: Math.max(0.001, +(i.cantidad + d).toFixed(3)) } : i)));
  const setQty = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, cantidad: Number(v) || 0 } : i)));
  const setLineDisc = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, descuento: Number(v) || 0 } : i)));
  const setLineComentario = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, comentario: v } : i)));
  const setUnidad = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, unidad: v } : i)));
  const remove = (id) => setCart((c) => c.filter((i) => i.product_id !== id));

  const totals = useMemo(() => {
    let brutoTotal = 0; // con IVA
    cart.forEach((i) => { brutoTotal += i.cantidad * i.precio - (i.descuento || 0); });
    if (brutoTotal < 0) brutoTotal = 0;

    // Descuento global: por monto ($) o por porcentaje (%) sobre el bruto
    const globalRaw = +(Number(descGlobal) || 0);
    const descGlobalAmount = descMode === "%"
      ? +(brutoTotal * globalRaw / 100).toFixed(2)
      : globalRaw;

    const pct = +(Number(descPct) || 0);
    const descPctAmount = +(brutoTotal * pct / 100).toFixed(2);

    const descGlobalTotal = Math.min(brutoTotal, +((descGlobalAmount || 0) + descPctAmount).toFixed(2));

    // Los precios del carrito son NETOS (sin IVA, tal como se guardan en la BD).
    // Si el toggle "Precios incluyen IVA" está activo se SUMA el IVA sobre el neto.
    let subtotal = 0, iva = 0;
    cart.forEach((i) => {
      const neto = i.cantidad * i.precio - (i.descuento || 0);
      subtotal += neto;
      if (incluyeIva) iva += neto * (i.iva_tasa / 100);
    });
    const sub = subtotal - descGlobalTotal;
    const granTotalIva = incluyeIva ? iva : 0;
    const total = Math.max(0, +(sub + granTotalIva).toFixed(2));
    return { subtotal: +sub.toFixed(2), iva: +iva.toFixed(2), total, descPctAmount, descGlobalAmount, descGlobalTotal };
  }, [cart, descGlobal, descPct, descMode, incluyeIva]);

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
      else if (e.key === "F6") {
        const t = target();
        const item = t ? cart.find((i) => i.product_id === t) : null;
        const prod = item || selProd;
        if (!prod) return toast.error("Selecciona un producto del carrito o de la búsqueda");
        if (!(prod.precios?.length || prod.precio_minimo != null)) return toast.error("El producto no tiene precios configurados");
        const precio = item ? item.precio : calcListPrice(prod, lista, listasPct);
        setLinePrice({ ...prod, product_id: prod.product_id || prod.id, precio });
        setLibreVal(String(precio));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, cart, selProd, lista, listasPct]);

  const pcSearch = async (val) => {
    setPcQuery(val);
    if (val.length < 1) return setPcResults([]);
    const { data } = await api.get("/products", { params: { q: val, estado: "activo" } });
    setPcResults(data.slice(0, 10));
  };

  const openPay = () => {
    if (cart.length === 0) return toast.error("Agrega productos");
    if (tipoVenta === "cotizacion") return confirmar();
    // Inventario insuficiente: solo se permite con autorización y motivo.
    const insuficiente = cart.filter((i) => {
      if (i.agotado) return false;
      const disp = Number(i.existencia ?? 0);
      return i.product_id && Number(i.cantidad) > disp;
    });
    if (insuficiente.length > 0 && can("inventario.autorizar_negativo")) {
      setInvOverride(insuficiente);
      setInvReason("");
      return;
    }
    if (formaPago === "credito") { setPayOpen(true); return; }
    const metodo = formaPago === "transferencia" ? "transferencia" : "efectivo";
    setPagos([{ metodo, monto: String(totals.total) }]);
    setPayOpen(true);
  };

  const confirmar = async () => {
    try {
      const payload = {
        cliente_id: clienteId || null,
        items: cart.map((i) => ({ product_id: i.product_id, codigo: i.codigo || "", descripcion: i.descripcion || "", cantidad: Number(i.cantidad), unidad: i.unidad || "PZA", precio: Number(i.precio) || 0, iva_tasa: Number(i.iva_tasa), descuento: Number(i.descuento || 0), comentario: i.comentario || "" })),
        descuento_global: totals.descGlobalTotal,
        condicion,
        pagos: (tipoVenta === "directa" && condicion === "contado") ? pagos.map((p) => ({ metodo: p.metodo, monto: Number(p.monto || 0) })) : [],
        lista_precios: Number(lista),
        tipo_venta: tipoVenta,
        precios_incluyen_iva: incluyeIva,
        // Operador: el backend fuerza vendedor_id = usuario autenticado salvo que el
        // rol tenga el permiso de cambiar operador. Solo se envía si el usuario lo tiene.
        vendedor_id: can("venta.cambiar_operador") ? (vendedorId || user.id) : null,
        // Override de inventario negativo (rol autorizado, con motivo).
        allow_negative_inventory: can("inventario.autorizar_negativo") && invReason !== "",
        override_reason: invReason || null,
      };
      const { data } = await api.post("/sales", payload);
      setTicket(data);
      setWaPhone(clienteSel?.whatsapp || clienteSel?.telefono || clienteSel?.celular || "");
      toast.success(`${tipoVenta === "cotizacion" ? "Cotización" : "Venta"} ${data.folio} registrada`);
      setCart([]); setDescGlobal(0); setDescPct(0); setPayOpen(false); setPagos([{ metodo: "efectivo", monto: "" }]); setSelected(null);
      // Tras finalizar la venta el cliente vuelve a Público General.
      if (pubClientId) { setClienteId(pubClientId); setClientQuery(""); }
      refreshFolio();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const suspender = async () => {
    if (cart.length === 0) return toast.error("Nada que suspender");
    await api.post("/sales/suspend", { cliente_id: clienteId, items: cart, descuento_global: totals.descGlobalAmount, condicion, pagos: [], lista_precios: Number(lista), tipo_venta: tipoVenta });
    toast.success("Venta suspendida"); setCart([]); setDescGlobal(0); loadSuspended();
  };
  const recuperar = async (s) => { setCart(s.payload.items); setDescGlobal(s.payload.descuento_global || 0); setClienteId(s.payload.cliente_id || clienteId); await api.delete(`/sales-suspended/${s.id}`); setSuspOpen(false); loadSuspended(); toast.info("Venta recuperada"); };

  // Registrar abono directo al saldo del cliente desde el POS
  const guardarAbono = async () => {
    const monto = Number(abono.monto);
    if (!monto || monto <= 0) return toast.error("Ingresa un monto válido");
    setAbonoSaving(true);
    try {
      const { data } = await api.post(`/cxc/${abonoCli.id}/abono`, { ...abono, monto });
      toast.success(`Abono ${data.folio} · saldo actual ${money(data.saldo_actual)}${data.caja_afectada ? " · entró a caja" : ""}`);
      setAbonoCli(null);
      // refresca clientes para actualizar saldo mostrado
      const { data: cl } = await api.get("/clients", { params: { estado: "activo" } });
      setClients(cl.data);
      const pub = cl.data.find((c) => c.codigo === "PUBLICO");
      if (pub && !clienteId) setClienteId(pub.id);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setAbonoSaving(false); }
  };

  const folioActual = tipoVenta === "cotizacion" ? nextFolio.cotizacion : nextFolio.venta;

  return (
    <div className="flex flex-col lg:flex-row gap-4 -m-6 p-6 h-[calc(100vh-4rem)]" data-testid="pos-page">
      {/* Izquierda: Cliente (sobre el ticket) + Ticket/Carrito */}
      <div className="lg:w-[68%] flex flex-col min-h-0">
        {/* Cliente */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3 shrink-0">
        <div className="relative flex-1">
          <UserIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
            value={clientQuery}
            onChange={(e) => { setClientQuery(e.target.value); setClientOpen(true); if (!e.target.value) setClienteId(""); }}
            onFocus={() => setClientOpen(true)}
            placeholder="Cliente: escribe para buscar por nombre, clave o RFC..."
            className="pl-10 h-12" data-testid="pos-cliente-search" />
          {clientOpen && filteredClients.length > 0 && (
            <div className="absolute z-30 mt-1 w-full card-soft shadow-lg max-h-64 overflow-y-auto" data-testid="pos-cliente-list">
              {filteredClients.map((c) => (
                <button key={c.id} onClick={() => pickClient(c)} data-testid={`pos-cliente-opt-${c.codigo}`}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                  <span className="truncate"><b className="text-[#C1401E] mr-1">{c.codigo}</b> {c.nombre}
                    {c.rfc && <span className="text-slate-400 font-mono text-xs ml-1">· {c.rfc}</span>}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {c.rfc && <span className="font-mono text-[10px] text-slate-400">{c.rfc}</span>}
                    {Number(c.descuento_permanente) > 0 && <Badge variant="outline" className="text-[10px] ml-2">-{c.descuento_permanente}%</Badge>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Select value={String(lista)} onValueChange={(v) => applyLista(Number(v))}>
          <SelectTrigger className="h-12 sm:w-44" data-testid="pos-lista"><Tags className="w-4 h-4 mr-1 text-slate-400" /><SelectValue /></SelectTrigger>
          <SelectContent>
            {listaNames.map((n, i) => <SelectItem key={i} value={String(i + 1)}>{n}</SelectItem>)}
            <SelectItem value={String(listaNames.length + 1)}>Precio mínimo</SelectItem>
          </SelectContent>
          </Select>
        </div>

        {/* Ticket / Carrito */}
        <div className="flex flex-col card-soft min-h-0 flex-1">
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-[#C1401E]" />
              <span className="font-display font-bold">Ticket</span>
              <Badge className="bg-[#C1401E]/10 text-[#C1401E] font-mono flex items-center gap-1" data-testid="pos-next-folio"><Hash className="w-3 h-3" />{folioActual}</Badge>
              <span className="ml-auto text-sm text-slate-400">{cart.length} items</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={tipoVenta} onValueChange={setTipoVenta}>
                <SelectTrigger className="h-9" data-testid="pos-tipo-venta"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="directa">Venta directa</SelectItem><SelectItem value="cotizacion">Cotización</SelectItem></SelectContent>
              </Select>
              {can("venta.cambiar_operador") ? (
                <Select value={vendedorId} onValueChange={setVendedorId}>
                  <SelectTrigger className="h-9" data-testid="pos-vendedor"><SelectValue placeholder="Vendedor" /></SelectTrigger>
                  <SelectContent>{vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <div className="flex items-center h-9 px-3 rounded-md border border-slate-200 text-sm text-slate-600" data-testid="pos-vendedor">
                  <UserIcon className="w-4 h-4 mr-2 text-slate-400" />
                  <span className="truncate">{user?.name || "Operador"}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <UserIcon className="w-3.5 h-3.5" />
              <span className="truncate">{clienteSel ? clienteSel.nombre : "Público General"}</span>
              <Badge variant="outline" className="ml-auto text-[10px]" data-testid="pos-lista-badge">{Number(lista) === listaNames.length + 1 ? "Precio mínimo" : listaNames[lista - 1]}</Badge>
              {Number(descPct) > 0 && <Badge className="bg-[#C1401E]/10 text-[#C1401E] text-[10px]" data-testid="pos-descpct">-{descPct}%</Badge>}
            </div>
            {credInfo && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" data-testid="pos-credito-indicador">
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
                {credInfo.sal > 0 && can("caja.entrada") && (
                  <Button size="sm" onClick={() => { setAbonoCli(clienteSel); setAbono({ monto: "", metodo: "efectivo", referencia: "" }); }}
                    className="w-full mt-2 bg-[#C1401E] hover:bg-[#A03316]" data-testid="pos-abonar-credito">
                    <HandCoins className="w-4 h-4 mr-1" /> Abonar a la cuenta ({money(credInfo.sal)})
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {cart.length === 0 && <div className="p-8 text-center text-slate-300 text-sm">Carrito vacío</div>}
            {cart.length > 0 && (
              <table className="w-full text-xs border-collapse" data-testid="cart-table">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="px-1.5 py-1.5 font-semibold">Código</th>
                    <th className="px-1.5 py-1.5 font-semibold">Cant.</th>
                    <th className="px-1.5 py-1.5 font-semibold">Unidad</th>
                    <th className="px-1.5 py-1.5 font-semibold">Descripción</th>
                    <th className="px-1.5 py-1.5 font-semibold text-right">IVA %</th>
                    <th className="px-1.5 py-1.5 font-semibold text-right">Precio</th>
                    <th className="px-1.5 py-1.5 font-semibold text-right">Importe</th>
                    <th className="px-1.5 py-1.5 font-semibold text-center">Comentario</th>
                    <th className="px-1.5 py-1.5 font-semibold text-center">+/-</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cart.map((i) => {
                    const importe = +(i.cantidad * i.precio).toFixed(2);
                    return (
                      <tr key={i.product_id} onClick={() => setSelected(i.product_id)}
                        className={`cursor-pointer align-middle ${selected === i.product_id ? "bg-[#C1401E]/[0.04]" : "hover:bg-slate-50"}`}
                        data-testid={`cart-item-${i.codigo}`}>
                        <td className="px-1.5 py-1 font-mono text-[10px] text-slate-500 whitespace-nowrap">{i.codigo}</td>
                        <td className="px-1.5 py-1">
                          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => updateQty(i.product_id, -1)} className="px-1 py-0.5 hover:bg-slate-100 rounded"><Minus className="w-3 h-3" /></button>
                            <Input value={i.cantidad} onChange={(e) => setQty(i.product_id, e.target.value)}
                              inputMode="decimal" type="number" step="any" min="0"
                              className="w-14 h-6 border-0 text-center p-0 text-xs" data-testid={`cart-qty-${i.codigo}`} />
                            <button onClick={() => updateQty(i.product_id, 1)} className="px-1 py-0.5 hover:bg-slate-100 rounded"><Plus className="w-3 h-3" /></button>
                          </div>
                        </td>
                        <td className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <Input value={i.unidad} onChange={(e) => setUnidad(i.product_id, e.target.value)}
                            list="pos-unidades" className="w-16 h-6 p-0 text-center text-xs" data-testid={`cart-unidad-${i.codigo}`} />
                          <datalist id="pos-unidades">
                            {UNIDADES_OPC.map((u) => <option key={u} value={u} />)}
                          </datalist>
                        </td>
                        <td className="px-1.5 py-1 text-[11px] text-slate-700 min-w-[130px]">
                          <div className="truncate max-w-[180px]">{i.descripcion}</div>
                          {i.descuento > 0 && <div className="text-[9px] text-[#C1401E]">Desc -{money(i.descuento)}</div>}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums text-slate-500 whitespace-nowrap">{i.iva_tasa}%</td>
                        <td className="px-1.5 py-1 text-right tabular-nums whitespace-nowrap">
                          <button onClick={(e) => { e.stopPropagation(); setLinePrice(i); setLibreVal(String(i.precio)); }}
                            className="underline decoration-dotted hover:text-[#C1401E]" data-testid={`cart-price-${i.codigo}`}>
                            {money(i.precio)}
                          </button>
                        </td>
                        <td className="px-1.5 py-1 text-right font-semibold tabular-nums whitespace-nowrap">
                          {!(i.descuento > 0) && money(importe)}
                          {i.descuento > 0 && <span className="line-through text-slate-400">{money(importe)}</span>}
                        </td>
                        <td className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <Input value={i.comentario || ""} onChange={(e) => setLineComentario(i.product_id, e.target.value)}
                            placeholder="…" className="w-24 h-6 p-0 text-[11px] justify-self-end" data-testid={`cart-comentario-${i.codigo}`} />
                        </td>
                        <td className="px-1.5 py-1 text-center whitespace-nowrap">
                          <button onClick={(e) => { e.stopPropagation(); remove(i.product_id); }} className="text-slate-400 hover:text-red-600" data-testid={`cart-remove-${i.codigo}`}><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="p-3 border-t border-slate-200 space-y-2">
            {tipoVenta === "directa" && (
              <div className="grid grid-cols-3 gap-2">
                {[["contado", "Contado", Banknote], ["transferencia", "Transferencia", ArrowLeftRight], ["credito", "Crédito", CreditCard]].map(([k, l, Ic]) => (
                  <button key={k} onClick={() => setFormaPago(k)} data-testid={`forma-pago-${k}`}
                    className={`flex flex-col items-center gap-1 py-2 rounded-md border text-xs font-medium transition-colors ${formaPago === k ? "border-[#C1401E] bg-[#C1401E]/5 text-[#C1401E]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                    <Ic className="w-4 h-4" /> {l}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Label className="text-xs text-slate-500 whitespace-nowrap">Desc. global</Label>
              <div className="flex items-center rounded-md border border-slate-200 overflow-hidden shrink-0">
                <button onClick={() => setDescMode("$")} data-testid="desc-mode-$"
                  className={`px-2 h-8 text-xs font-bold ${descMode === "$" ? "bg-ink text-white" : "text-slate-500 hover:bg-slate-100"}`}>$</button>
                <button onClick={() => setDescMode("%")} data-testid="desc-mode-%"
                  className={`px-2 h-8 text-xs font-bold border-l border-slate-200 ${descMode === "%" ? "bg-ink text-white" : "text-slate-500 hover:bg-slate-100"}`}>%</button>
              </div>
              <Input type="number" value={descGlobal} onChange={(e) => setDescGlobal(e.target.value)} className="h-8" data-testid="pos-desc-global" placeholder={descMode === "%" ? "0 %" : "0.00"} />
              <button
                onClick={() => { if (can("config") || can("producto.precio")) setIncluyeIva((v) => !v); else toast.error("Sin permiso para cambiar IVA"); }}
                className={`flex items-center gap-1 text-[11px] whitespace-nowrap px-2 py-1 rounded border ${incluyeIva ? "border-[#C1401E] text-[#C1401E] bg-[#C1401E]/5" : "border-slate-200 text-slate-400"}`}
                data-testid="pos-incluye-iva">
                <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${incluyeIva ? "bg-[#C1401E] border-[#C1401E]" : "border-slate-300"}`}>{incluyeIva && <Check className="w-3 h-3 text-white" />}</span>
                Precios incluyen IVA
              </button>
            </div>
            <div className="text-sm space-y-0.5">
              {incluyeIva && <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>}
              {incluyeIva && <div className="flex justify-between text-slate-500"><span>IVA ({settings.iva_tasa ?? 16}%)</span><span>{money(totals.iva)}</span></div>}
              {totals.descGlobalAmount > 0 && <div className="flex justify-between text-[#C1401E]"><span>Descuento global{descMode === "%" ? ` (${descGlobal}%)` : ""}</span><span>-{money(totals.descGlobalAmount)}</span></div>}
              {totals.descPctAmount > 0 && <div className="flex justify-between text-[#C1401E]"><span>Descuento cliente ({descPct}%)</span><span>-{money(totals.descPctAmount)}</span></div>}
              <div className="flex justify-between font-display text-2xl font-black pt-1"><span>Total</span><span data-testid="pos-total">{money(totals.total)}</span></div>
            </div>
            {creditoBloqueado && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="pos-credito-bloqueo">
                <CreditCard className="w-4 h-4" /> Este cliente no tiene crédito habilitado. Usa contado o habilita su crédito en Clientes.
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="h-12" onClick={suspender} data-testid="pos-suspend"><PauseCircle className="w-5 h-5" /></Button>
              <Button className="flex-1 h-12 bg-[#C1401E] hover:bg-[#A03316] text-base font-bold" onClick={openPay} disabled={creditoBloqueado} data-testid="pos-cobrar">
                {tipoVenta === "cotizacion" ? <><FileText className="w-5 h-5 mr-2" /> Guardar cotización</> : <>Cobrar · {money(totals.total)}</>}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Derecha: Productos / Catálogo */}
      <div className="lg:w-[32%] flex flex-col min-h-0">
        <div className="flex items-center gap-1.5 mb-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input ref={searchRef} autoFocus value={q} onChange={(e) => search(e.target.value)} onKeyDown={onSearchKey} placeholder="Buscar producto..." className="pl-8 h-9 text-sm" data-testid="pos-search-input" />
          </div>
          <Button variant="outline" className="h-9 text-xs px-2" onClick={() => { setPriceCheckOpen(true); setTimeout(() => pcRef.current?.focus(), 100); }} data-testid="verificar-precio-btn"><Tag className="w-3 h-3 mr-1" /> Precio <kbd className="ml-1 text-[9px] bg-slate-100 px-1 rounded">F7</kbd></Button>
          <Button variant="outline" className="h-9 text-xs px-2" onClick={() => setSuspOpen(true)} data-testid="ver-suspendidas"><PlayCircle className="w-3 h-3 mr-1" /> {suspended.length}</Button>
        </div>

        {/* Vista del catálogo: todos / favoritos / más vendidos */}
        {!q && (
          <div className="flex items-center gap-1.5 mb-2">
            {[["todos", "Todos", LayoutGrid], ["favoritos", "Favoritos", Star], ["mas_vendidos", "Más vendidos", Flame]].map(([k, l, Ic]) => (
              <button key={k} onClick={() => setVista(k)} data-testid={`pos-vista-${k}`}
                className={`flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium transition-colors ${vista === k ? "bg-[#C1401E] text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                <Ic className="w-4 h-4" /> {l}
              </button>
            ))}
          </div>
        )}

        {/* Filtro por categoría */}
        {!q && vista !== "favoritos" && categorias.length > 0 && (
          <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
            <button onClick={() => setCategoriaSel("")} data-testid="pos-cat-todas"
              className={`shrink-0 px-3 h-8 rounded-md text-xs font-medium ${categoriaSel === "" ? "bg-ink text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>Todas</button>
            {categorias.map((c) => (
              <button key={c.nombre} onClick={() => setCategoriaSel(c.nombre)} data-testid={`pos-cat-${c.nombre}`}
                className={`shrink-0 px-3 h-8 rounded-md text-xs font-medium ${categoriaSel === c.nombre ? "bg-ink text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                {c.nombre} <span className="opacity-60">({c.count})</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto card-soft">
          {catLoading && !q ? (
            <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#C1401E]" /></div>
          ) : q ? (
            results.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 p-10">
                <Package className="w-12 h-12 mb-2" /><p className="text-sm text-slate-400">Escribe para buscar productos</p>
                <div className="mt-6 flex flex-wrap gap-2 justify-center text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Keyboard className="w-3.5 h-3.5" /> Atajos:</span>
                  <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F8</kbd> +cantidad</span>
                  <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F9</kbd> −cantidad</span>
                  <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F7</kbd> verificar precio</span>
                  <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F6</kbd> precios del producto</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1 p-1">
                {results.map((p) => (
                  <ProductCard key={p.id} p={p} onAdd={() => addToCart(p)} priceOf={priceOf} isFav={favIds.has(p.id)} onFav={(e) => toggleFav(e, p.id)} />
                ))}
              </div>
            )
          ) : (
            catalogo.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 p-10">
                {vista === "favoritos" ? <Star className="w-12 h-12 mb-2" /> : <Package className="w-12 h-12 mb-2" />}
                <p className="text-sm text-slate-400">{vista === "favoritos" ? "Aún no tienes productos favoritos. Marca la estrella de un producto para guardarlo." : "Sin productos en esta vista."}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1 p-1">
                {catalogo.map((p) => (
                  <ProductCard key={p.id} p={p} onAdd={() => addToCart(p)} priceOf={priceOf} isFav={favIds.has(p.id)} onFav={(e) => toggleFav(e, p.id)} mostrarSold={vista === "mas_vendidos"} />
                ))}
              </div>
            )
          )}
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
          <DialogFooter><Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button><Button onClick={confirmar} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="confirmar-venta">Confirmar venta</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inventario insuficiente: autorización (solo rol con permiso) */}
      <Dialog open={!!invOverride} onOpenChange={(o) => { if (!o) setInvOverride(null); }}>
        <DialogContent data-testid="inv-override-dialog">
          <DialogHeader><DialogTitle className="font-display">Inventario insuficiente</DialogTitle></DialogHeader>
          <div className="text-sm space-y-2">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-800">
              Los siguientes productos tienen existencia insuficiente:
            </div>
            <ul className="text-slate-600 list-disc pl-5 text-sm">
              {(invOverride || []).map((i) => (
                <li key={i.product_id} data-testid="inv-override-item">
                  <b>{i.descripcion}</b> — disp {Number(i.existencia ?? 0)} · pedido {Number(i.cantidad)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">Si continúas, el inventario quedará <b>negativo</b>. Esta acción queda registrada con tu usuario y un motivo.</p>
            <Input placeholder="Motivo de la autorización (obligatorio)" value={invReason}
              onChange={(e) => setInvReason(e.target.value)} data-testid="inv-override-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setInvOverride(null); setInvReason(""); }}>Cancelar</Button>
            <Button disabled={!invReason.trim()} onClick={() => { setInvOverride(null); setPayOpen(true); }}
              className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="inv-override-continue">Continuar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selector de precio por línea */}
      <Dialog open={!!linePrice} onOpenChange={(o) => { if (!o) { setLinePrice(null); setLibreVal(""); } }}>
        <DialogContent data-testid="line-price-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Tag className="w-5 h-5" /> Precio · {linePrice?.descripcion}</DialogTitle></DialogHeader>
          {linePrice && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {listaNames.map((_, i) => {
                  const pr = priceFromList(linePrice, i + 1);
                  return (
                    <button key={i} onClick={() => setLinePrecio(linePrice, pr)} data-testid={`line-precio-${i + 1}`}
                      className={`flex items-center justify-between border rounded-md px-3 py-2 hover:border-[#C1401E] ${Math.abs(linePrice.precio - pr) < 0.001 ? "border-[#C1401E] bg-[#C1401E]/5" : "border-slate-200"}`}>
                      <span className="text-sm text-slate-500">{listaNames[i] || `Precio ${i + 1}`}</span>
                      <span className="font-display font-bold text-[#C1401E]">{money(pr)}</span>
                    </button>
                  );
                })}
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
                    <Button onClick={() => setLinePrecio(linePrice, libreVal)} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="line-precio-libre-apply">Aplicar</Button>
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
                  {listaNames.map((_, i) => (
                    <div key={i} className="bg-slate-50 rounded p-1.5 text-center"><div className="text-slate-400">{listaNames[i]}</div><div className="font-semibold text-[#C1401E]">{money(calcListPrice(p, i + 1, listasPct))}</div></div>
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
                <Button size="sm" onClick={() => recuperar(s)} className="bg-[#C1401E] hover:bg-[#A03316]"><PlayCircle className="w-4 h-4 mr-1" /> Recuperar</Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

{/* Ticket térmico + Factura/Cotización */}
      <Dialog open={!!ticket} onOpenChange={(o) => { if (!o) setTicket(null); }}>
        <DialogContent data-testid="ticket-dialog" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-center">
              {ticket?.tipo_venta === "cotizacion" ? "Cotización" : "Ticket de venta"}
            </DialogTitle>
          </DialogHeader>
          {ticket && (
            <>
              {/* Toggle vista */}
              <div className="flex justify-center gap-2 mb-3">
                <Button size="sm" variant={printMode === "thermal" ? "default" : "outline"}
                  onClick={() => setPrintMode("thermal")}
                  className={printMode === "thermal" ? "bg-[#C1401E]" : ""}>
                  Ticket térmico
                </Button>
                <Button size="sm" variant={printMode === "invoice" ? "default" : "outline"}
                  onClick={() => setPrintMode("invoice")}
                  className={printMode === "invoice" ? "bg-[#C1401E]" : ""}>
                  {ticket.tipo_venta === "cotizacion" ? "Cotización" : "Factura"}
                </Button>
              </div>

              {/* Thermal ticket (80mm) */}
              {printMode === "thermal" && (
              <div id="thermal-ticket" className="thermal font-mono text-[12px] text-black bg-white p-2 mx-auto">
                <div className="text-center">
                  <img src={settings.logo_url ? fileUrl(settings.logo_url) : "/brand/ISOTIPO-Photoroom.png"} alt="logo" className="h-12 mx-auto mb-1 object-contain" />
                  <div className="font-bold text-[11px]">RAYMUNDO GOMEZ DIAZ</div>
                  <div className="font-bold text-[14px]">{settings.empresa_nombre || "Grupo RYSA"}</div>
                  {[settings.direccion, [settings.ciudad, settings.estado, settings.cp].filter(Boolean).join(", ")].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                  {settings.telefono && <div>Tel: {settings.telefono}</div>}
                  {settings.rfc && <div>RFC: {settings.rfc}</div>}
                </div>
                <div className="border-t border-dashed border-black my-1" />
                <div>{ticket.tipo_venta === "cotizacion" ? "COTIZACIÓN" : "FOLIO"}: {ticket.folio}</div>
                <div>Fecha: {ticket.fecha?.slice(0, 16).replace("T", " ")}</div>
                <div>Cliente: {ticket.cliente_nombre}</div>
                <div className="border-t border-dashed border-black my-1" />
                <div className="text-center font-bold text-[11px]">DESCRIPCION</div>
                <div className="border-t border-t-2 border-black my-1" />
                {ticket.items.map((i, k) => {
                  const importe = i.cantidad * i.precio - (i.descuento || 0);
                  const descuento = i.descuento || 0;
                  return (
                    <div key={k}>
                      <div>{i.descripcion}</div>
                      {i.comentario && <div className="text-[11px] text-slate-600">• {i.comentario}</div>}
                      <div className="flex justify-between">
                        <span className="whitespace-pre">{String(i.cantidad).padEnd(2)}{i.unidad}</span>
                        <span>{money(i.cantidad * i.precio)}</span>
                        <span>{money(importe)}</span>
                      </div>
                      {descuento > 0 && <div className="flex justify-between text-[11px] text-slate-600"><span>Descuento</span><span>-{money(descuento)}</span></div>}
                    </div>
                  );
                })}
                <div className="border-t border-dashed border-black my-1" />
                {incluyeIva && <div className="flex justify-between"><span>Subtotal</span><span>{money(ticket.subtotal)}</span></div>}
                {incluyeIva && <div className="flex justify-between"><span>IVA</span><span>{money(ticket.iva_total)}</span></div>}
                {ticket.descuento_total > 0 && <div className="flex justify-between"><span>Descuento</span><span>-{money(ticket.descuento_total)}</span></div>}
                <div className="flex justify-between font-bold text-[14px]"><span>Total a pagar</span><span>{money(ticket.total)}</span></div>
                <div className="text-center font-bold text-[10px]">({numeroALetras(ticket.total)})</div>
                {ticket.tipo_venta === "directa" && ticket.condicion === "contado" && (<><div className="flex justify-between mt-1"><span>Recibido</span><span>{money((ticket.pagos || []).reduce((s, p) => s + p.monto, 0))}</span></div><div className="flex justify-between"><span>Cambio</span><span>{money(ticket.cambio)}</span></div></>)}
                {ticket.condicion === "credito" && <div className="text-center mt-1">** VENTA A CRÉDITO ** Saldo: {money(ticket.saldo)}</div>}
                <div className="flex justify-between"><span>Articulos vendidos</span><span>{ticket.items.reduce((s, i) => s + Number(i.cantidad || 0), 0)}</span></div>
                <div className="flex justify-between"><span>Atendido por</span><span>{ticket.vendedor_nombre}</span></div>
                <div className="text-center font-bold mt-1">Verifique su compra y cambio</div>
                <div className="border-t border-dashed border-black my-1" />
                {ticket.id && (
                  <div className="text-center">
                    <img src={`${process.env.REACT_APP_BACKEND_URL}/api/sales/${ticket.id}/qr?destino=${encodeURIComponent(`${window.location.origin}/verificar/${ticket.id}`)}`} alt="QR de verificación"
                      className="mx-auto w-24 h-24" data-testid="ticket-qr" />
                    <div className="text-[9px] text-slate-500">{window.location.origin}/verificar/{ticket.id}</div>
                  </div>
                )}
                <div className="text-center text-[11px]">¡Gracias por su compra!</div>
              </div>
              )}

              {/* Invoice/Quote letter-size template */}
              {printMode === "invoice" && (
              <div id="invoice-template" className="invoice-letter mx-auto" style={{ padding: "15mm 20mm" }}>
                {/* Header */}
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <img src={settings.logo_url ? fileUrl(settings.logo_url) : "/brand/ISOTIPO-Photoroom.png"} alt="logo" style={{ height: 60 }} className="object-contain" />
                  </div>
                  <div className="text-right" style={{ fontSize: "9pt", color: "#475569" }}>
                    <div style={{ fontSize: "14pt", fontWeight: 700, color: "#C1401E" }}>{settings.empresa_nombre || "Grupo RYSA"}</div>
                    <div>RAYMUNDO GOMEZ DIAZ</div>
                    {settings.rfc && <div>RFC: {settings.rfc}</div>}
                    {settings.direccion && <div>{settings.direccion}</div>}
                    {[settings.ciudad, settings.estado, settings.cp].filter(Boolean).join(", ")}
                    {settings.telefono && <div>Tel: {settings.telefono}</div>}
                    {settings.correo && <div>{settings.correo}</div>}
                  </div>
                </div>

                {/* Línea divisoria */}
                <div style={{ height: 3, background: "#C1401E", marginBottom: 12 }} />

                {/* Título */}
                <div className="text-center mb-5">
                  <div style={{ fontSize: "18pt", fontWeight: 800, color: "#C1401E", letterSpacing: 2 }}>
                    {ticket.tipo_venta === "cotizacion" ? "COTIZACIÓN" : "FACTURA"}
                  </div>
                  <div style={{ fontSize: "10pt", color: "#64748B" }}>Folio: {ticket.folio}</div>
                </div>

                {/* Fecha y cliente */}
                <div className="flex justify-between mb-4" style={{ fontSize: "9pt" }}>
                  <div>
                    <strong>Cliente:</strong> {ticket.cliente_nombre}<br />
                    <strong>Atendió:</strong> {ticket.vendedor_nombre}<br />
                    {ticket.condicion === "credito" && <><strong>Condición:</strong> Crédito<br /></>}
                  </div>
                  <div className="text-right">
                    <strong>Fecha:</strong> {ticket.fecha?.slice(0, 16).replace("T", " ")}<br />
                    <strong>Vencimiento:</strong> {ticket.fecha?.slice(0, 10)}<br />
                  </div>
                </div>

                {/* Tabla de productos */}
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "12%" }}>Código</th>
                      <th>Descripción</th>
                      <th className="text-right" style={{ width: "10%" }}>Cant.</th>
                      <th className="text-right" style={{ width: "15%" }}>Precio</th>
                      <th className="text-right" style={{ width: "10%" }}>IVA</th>
                      <th className="text-right" style={{ width: "13%" }}>Descuento</th>
                      <th className="text-right" style={{ width: "15%" }}>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticket.items.map((i, k) => {
                      const linBruto = i.cantidad * i.precio - (i.descuento || 0);
                      return (
                        <tr key={k}>
                          <td style={{ fontSize: "8pt" }}>{i.codigo}</td>
                          <td>{i.descripcion}{i.comentario ? <><br /><span style={{ fontSize: "7.5pt", color: "#C1401E" }}>• {i.comentario}</span></> : null}</td>
                          <td className="text-right">{i.cantidad}</td>
                          <td className="text-right">{money(i.precio)}</td>
                          <td className="text-right">{i.iva_tasa}%</td>
                          <td className="text-right">{i.descuento ? money(i.descuento) : "-"}</td>
                          <td className="text-right" style={{ fontWeight: 600 }}>{money(linBruto)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Totales */}
                <div className="flex justify-end mt-3" style={{ fontSize: "10pt" }}>
                  <div style={{ width: 250 }}>
                    {incluyeIva && (
                      <div className="flex justify-between py-1"><span>Subtotal</span><span>{money(ticket.subtotal)}</span></div>
                    )}
                    {incluyeIva && (
                      <div className="flex justify-between py-1"><span>IVA ({settings.iva_tasa ?? 16}%)</span><span>{money(ticket.iva_total)}</span></div>
                    )}
                    {ticket.descuento_total > 0 && (
                      <div className="flex justify-between py-1"><span>Descuento</span><span>-{money(ticket.descuento_total)}</span></div>
                    )}
                    <div className="flex justify-between py-1" style={{ fontWeight: 700, fontSize: "12pt", color: "#C1401E", borderTop: "2px solid #C1401E" }}>
                      <span>TOTAL</span><span>{money(ticket.total)}</span>
                    </div>
                    {!incluyeIva && <div style={{ fontSize: "8pt", color: "#94a3b8", textAlign: "right" }}>Precios sin IVA</div>}
                    {ticket.condicion === "credito" && (
                      <div style={{ fontSize: "9pt", color: "#dc2626", textAlign: "right", marginTop: 4 }}>
                        Saldo pendiente: {money(ticket.saldo)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ marginTop: 30, paddingTop: 10, borderTop: "1px solid #e2e8f0", fontSize: "8pt", color: "#94a3b8", textAlign: "center" }}>
                  {ticket.tipo_venta === "cotizacion" ? (
                    <p style={{ color: "#475569" }}>
                      Cotización válida por <strong>15 días</strong>. Precios sujetos a cambio sin previo aviso.
                    </p>
                  ) : (
                    <p>Esta factura es un comprobante fiscal. Conserve una copia para sus registros.</p>
                  )}
                  <p style={{ marginTop: 4 }}>{settings.empresa_nombre || "Grupo RYSA"} · {settings.rfc || ""}</p>
                  {ticket.id && (
                    <p style={{ marginTop: 4 }}>
                      Verifique su comprobante en: {window.location.origin}/verificar/{ticket.id}
                    </p>
                  )}
                </div>
              </div>
              )}
            </>
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
          <DialogFooter className="flex-wrap gap-2">
            <Button onClick={printThermal} variant="outline" data-testid="ticket-print">
              <Printer className="w-4 h-4 mr-1" /> Imprimir ticket
            </Button>
            <Button onClick={printInvoice} variant="outline" data-testid="invoice-print">
              <Printer className="w-4 h-4 mr-1" /> Imprimir {ticket?.tipo_venta === "cotizacion" ? "cotización" : "factura"}
            </Button>
            <Button onClick={() => setTicket(null)} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="ticket-nueva">Nueva venta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Abono directo a crédito del cliente desde el POS */}
      <Dialog open={!!abonoCli} onOpenChange={(o) => !o && setAbonoCli(null)}>
        <DialogContent data-testid="pos-abono-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><HandCoins className="w-5 h-5 text-[#C1401E]" /> Abonar a cuenta · {abonoCli?.nombre}</DialogTitle></DialogHeader>
          {abonoCli && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-md p-3 flex items-center justify-between">
                <div><div className="text-xs text-slate-400">{abonoCli.codigo}{abonoCli.rfc ? ` · ${abonoCli.rfc}` : ""}</div><div className="font-semibold">{abonoCli.nombre}</div></div>
                <div className="text-right"><div className="text-xs text-slate-400">Saldo actual</div><div className="font-display font-bold text-red-600">{money(abonoCli.saldo)}</div></div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Monto del abono</Label>
                <div className="flex gap-2 mt-1">
                  <Input type="number" value={abono.monto} onChange={(e) => setAbono((s) => ({ ...s, monto: e.target.value }))} placeholder="0.00" data-testid="pos-abono-monto" />
                  <Button variant="outline" onClick={() => setAbono((s) => ({ ...s, monto: String(abonoCli.saldo) }))} data-testid="pos-abono-saldo-total">Saldo total</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Método de pago</Label>
                <Select value={abono.metodo} onValueChange={(v) => setAbono((s) => ({ ...s, metodo: v }))}>
                  <SelectTrigger className="mt-1" data-testid="pos-abono-metodo"><SelectValue /></SelectTrigger>
                  <SelectContent>{METODOS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
                {abono.metodo === "efectivo" && <p className="text-[11px] text-slate-400 mt-1">El efectivo entrará a tu caja abierta (si tienes una).</p>}
              </div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Referencia</Label>
                <Input value={abono.referencia} onChange={(e) => setAbono((s) => ({ ...s, referencia: e.target.value }))} className="mt-1" placeholder="No. de recibo / operación" data-testid="pos-abono-referencia" /></div>
              <p className="text-xs text-slate-400">El abono se aplica automáticamente a las ventas a crédito más antiguas primero (FIFO).</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbonoCli(null)}>Cancelar</Button>
            <Button onClick={guardarAbono} disabled={abonoSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="pos-abono-guardar">{abonoSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Registrar abono"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
