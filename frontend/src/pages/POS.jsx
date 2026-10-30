import { useEffect, useState, useMemo, useRef, useCallback, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, formatApiError, money, fileUrl, fotoProducto } from "@/lib/api";
import { numeroALetras } from "@/lib/utils";
import { fmtFecha, fmtFechaHora } from "@/lib/fechas";
import { useConfirm } from "@/components/ConfirmProvider";
import { imprimirPdf } from "@/lib/impresion";
import { useAuth } from "@/context/AuthContext";
import { useCart, CartContext } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import CajaAperturaModal from "@/components/CajaAperturaModal";
import ReporteRapido from "@/components/ReporteRapido";
import CodigoAutorizacionInput from "@/components/CodigoAutorizacionInput";
import { toast } from "sonner";
import { LISTAS_PCT_DEFAULT, REDONDEO_DEFAULT, listasCapturadas, precioLista, tasaIva, precioNetoLista as calcListPrice } from "@/lib/precios";
import {
  Search, Plus, Minus, Trash2, ShoppingCart, PauseCircle, PlayCircle, X, Package,
  Banknote, ArrowLeftRight, CreditCard,   Tag, Printer, Hash, Keyboard, FileText,
  Smartphone, Landmark, Gift, DollarSign, User as UserIcon, Check, Tags, MessageCircle, Loader2,
  Star, Flame, LayoutGrid, HandCoins, UserPlus, AlertTriangle, Share2, Download, RefreshCw,
  Wallet as Wallet2, Mail, Send as SendIcon, PencilLine, Lock, ShieldCheck,
} from "lucide-react";

const METODOS = [
  ["efectivo", "Efectivo", Banknote],
  ["tarjeta", "Tarjeta", CreditCard],
  ["transferencia", "Transferencia", Landmark],
  ["spei", "SPEI", Smartphone],
  ["deposito", "Depósito", ArrowLeftRight],
  ["otros", "Otro", Gift],
];

const UNIDADES_OPC = ["PZA", "PAQ", "KILO", "KG", "GR", "LT", "ML", "MTR", "CM", "CAJ", "BOT", "LATA", "DOC", "PAR", "ROLLO", "BULTO", "SERV"];

const PRODUCT_EX_CLS = (ex) => {
  const n = Number(ex || 0);
  if (n <= 0) return "bg-red-100 text-red-700 border-red-300";
  if (n < 5) return "bg-orange-100 text-orange-700 border-orange-300";
  if (n < 10) return "bg-yellow-100 text-yellow-700 border-yellow-300";
  return "bg-green-100 text-green-700 border-green-300";
};

// Búsqueda predictiva en memoria: sin acentos ni mayúsculas, todas las palabras
// deben aparecer (en cualquier orden) en código, descripción, marca, sinónimos o
// códigos de barras.
const norm = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
// Grupo del chip de marca/categoría: misma regla que GET /categories.
const grupoDe = (p) => (String(p.categoria || "").trim() || String(p.linea || "").trim() || String(p.clasificacion || "").trim()).toUpperCase();
const indexar = (prods) => prods.map((p) => ({
  p,
  cod: norm(p.codigo),
  desc: norm(p.descripcion),
  barras: (p.codigos_barras || []).map((b) => String(b).trim()),
  grupo: grupoDe(p),
  h: norm([p.codigo, p.descripcion, p.sku, p.linea, p.clasificacion, p.categoria,
    ...(Array.isArray(p.sinonimos) ? p.sinonimos : [p.sinonimos]), ...(p.codigos_barras || [])].filter(Boolean).join(" ")),
}));
const buscarEnIndice = (val, indice, max = 30) => {
  const q = norm(val);
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const out = [];
  for (const it of indice) {
    if (!tokens.every((t) => it.h.includes(t))) continue;
    let r = 5;
    if (it.cod === q || it.barras.includes(val.trim())) r = 0;
    else if (it.cod.startsWith(q)) r = 1;
    else if (it.desc.startsWith(tokens[0])) r = 2;
    else if (tokens.every((t) => it.desc.includes(" " + t) || it.desc.startsWith(t))) r = 3;
    else if (it.desc.includes(tokens[0])) r = 4;
    out.push([r, it]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1].desc.localeCompare(b[1].desc));
  return out.slice(0, max).map(([, it]) => it.p);
};
const fmtEx = (ex) => { const n = Number(ex || 0); return Number.isInteger(n) ? n : +n.toFixed(2); };

const ProductCard = ({ p, onAdd, priceOf, isFav, onFav, mostrarSold, incluyeIva }) => {
  const neto = priceOf(p);
  const tasa = tasaIva(p);
  const conIva = +(neto * (1 + tasa / 100)).toFixed(2);
  // Precio destacado = el que realmente se cobra: con IVA cuando el toggle
  // "Precios incluyen IVA" está activo; neto cuando está desactivado.
  const principal = incluyeIva ? conIva : neto;
  const secundario = incluyeIva ? neto : conIva;
  const etiqueta = incluyeIva ? "sin IVA" : "con IVA";
  const foto = fotoProducto(p.imagen_url);
  // Unas 5 tarjetas por ventana: el alto sale del contenedor con scroll
  // (container-type: size → 100cqh), acotado entre 76 y 96 px. Foto cuadrada del alto de la tarjeta a la
  // izquierda; código, nombre, precio y existencia alineados a la derecha.
  return (
  <div className="relative">
    <button onClick={onAdd} data-testid={`pos-prod-${p.codigo}`}
      className="flex h-[clamp(76px,calc((100cqh-1.5rem)/5),96px)] w-full items-stretch gap-2.5 overflow-hidden text-left border border-slate-200 rounded-md bg-white hover:border-brand-600 hover:bg-slate-50 transition-colors">
      <span className="flex aspect-square h-full shrink-0 items-center justify-center border-r border-slate-100 bg-white">
        {foto
          ? <img src={foto} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
          : <Package className="h-7 w-7 text-slate-300" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-end justify-between py-1.5 pr-2.5 text-right">
        <span className="block max-w-full truncate pr-6 text-xs font-medium tracking-wide text-slate-500">{p.codigo}</span>
        <span className="block text-sm font-semibold leading-snug text-slate-900 line-clamp-2">{p.descripcion}</span>
        <span className="flex w-full items-end justify-end gap-3">
          {mostrarSold && p.vendidas > 0 && <Badge variant="outline" className="h-5 px-1.5 text-[11px] leading-none text-amber-600 border-amber-300">{p.vendidas} vend.</Badge>}
          <span className={`flex h-8 min-w-[3.25rem] shrink-0 flex-col items-center justify-center rounded-md border-2 px-2 leading-none ${PRODUCT_EX_CLS(p.existencia)}`} title="Existencia" data-testid={`pos-ex-${p.codigo}`}>
            <span className="text-[9px] font-semibold uppercase tracking-wider opacity-80">Exist.</span>
            <span className="text-base font-extrabold tabular-nums">{fmtEx(p.existencia)}</span>
          </span>
          <span className="flex items-baseline gap-2 text-right">
            <span className="text-[11px] tabular-nums text-slate-500">{etiqueta} {money(secundario)}</span>
            <span className="font-display text-base font-bold leading-none tabular-nums text-brand-600">{money(principal)}</span>
          </span>
        </span>
      </span>
    </button>
    <button onClick={onFav} title={isFav ? "Quitar de favoritos" : "Agregar a favoritos"} data-testid={`pos-fav-${p.codigo}`}
      className="absolute top-0.5 right-0.5 p-1 text-slate-300 hover:text-amber-400 transition-colors">
      <Star className={`w-4 h-4 ${isFav ? "fill-amber-400 text-amber-400" : ""}`} />
    </button>
  </div>
  );
};

export default function POS({ windowId, windowLabel, activo = true }) {
  // Solo la ventana visible atiende atajos y consulta al servidor; las ocultas
  // conservan su carrito sin generar tráfico. Tampoco con la pestaña oculta.
  const activoRef = useRef(activo);
  activoRef.current = activo;
  const enPantalla = () => activoRef.current && document.visibilityState === "visible";
  const cobroKeyRef = useRef(null);   // llave anti-duplicados del cobro en curso
  const pedirConfirmacion = useConfirm();
  const location = useLocation();
  const nav = useNavigate();
  const { user, can } = useAuth();
  // §3.1: datos sensibles de clientes solo para quien gestiona clientes.
  const puedeVerClientesFull = can("clientes.gestionar") || can("*");
  const esVendedorCampo = user?.role === "vendedor_campo";
  const { clearCartState } = useContext(CartContext);
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
  const [cajaModalOpen, setCajaModalOpen] = useState(false);
  const [cajaAbierta, setCajaAbierta] = useState(true);

  const loadCaja = useCallback(() => {
    api.get("/caja/actual").then((r) => setCajaAbierta(!!r.data?.caja)).catch(() => setCajaAbierta(false));
  }, []);
  useEffect(() => { loadCaja(); const id = setInterval(() => { if (enPantalla()) loadCaja(); }, 30000); return () => clearInterval(id); }, [loadCaja]); // eslint-disable-line
  const [linePrice, setLinePrice] = useState(null);
  const [selProd, setSelProd] = useState(null);
  const [libreVal, setLibreVal] = useState("");
  // Precio manual (F6): administradores/dueño lo aplican directo; los demás
  // necesitan el código de 6 dígitos de alguien autorizado.
  const [manualOpen, setManualOpen] = useState(false);
  const [autzPend, setAutzPend] = useState(null); // { vista, neto } esperando código
  const [autzCodigo, setAutzCodigo] = useState("");
  const [autzError, setAutzError] = useState("");
  const [autzBusy, setAutzBusy] = useState(false);
  const autzBusyRef = useRef(false);
  const [remota, setRemota] = useState(null);   // solicitud remota de precio manual en espera
  const precioManualDirecto = can("venta.precio_manual");
  const [payOpen, setPayOpen] = useState(false);
  const [invOverride, setInvOverride] = useState(null); // {motivo} dialog de inventario insuficiente
  const [invReason, setInvReason] = useState("");
  const [suspended, setSuspended] = useState([]);
  const [suspOpen, setSuspOpen] = useState(false);
  const [ticket, setTicket] = useState(null);
  // COTIZACIONES: flujo propio — sin ticket térmico; PDF carta con
  // Descargar/Enviar. `cotBusy` = "" | "pdf" | "wa" (spinner del botón).
  const [cotizacion, setCotizacion] = useState(null);
  const [cotBusy, setCotBusy] = useState("");
  const [waPhone, setWaPhone] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [settings, setSettings] = useState({});
  const [nextFolio, setNextFolio] = useState({ venta: "", cotizacion: "" });
  const [listaNames, setListaNames] = useState(["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"]);
  const [listasPct, setListasPct] = useState(LISTAS_PCT_DEFAULT);
  const [filaPrecio, setFilaPrecio] = useState(0);
  const [redondeo, setRedondeo] = useState(REDONDEO_DEFAULT);
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
  const [indice, setIndice] = useState(null);   // catálogo activo completo en memoria (búsqueda instantánea)
  const searchTimer = useRef();
  const [favIds, setFavIds] = useState(new Set());
  const [catLoading, setCatLoading] = useState(false);
  // --- Abono de crédito desde POS ---
  const [abonoCli, setAbonoCli] = useState(null);
  const [abono, setAbono] = useState({ monto: "", metodo: "efectivo", referencia: "" });
  const [abonoSaving, setAbonoSaving] = useState(false);
  const [posComp, setPosComp] = useState(null); // comprobante de abono desde el POS
  const [posCompBusy, setPosCompBusy] = useState(false);
  const [printMode, setPrintMode] = useState("thermal"); // thermal | letter | invoice
  // Generador aNICO: la carta comparte/descarga/imprime SIEMPRE este mismo PDF.
  const [cartaUrl, setCartaUrl] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const incluyeIvaDefault = useRef(true); // valor de settings.precios_incluyen_iva
  // Nuevo cliente desde el POS (modal, sin abandonar la venta)
  const [nuevoClienteOpen, setNuevoClienteOpen] = useState(false);
  const [nc, setNc] = useState({});
  const [ncBusy, setNcBusy] = useState(false);
  const [ncError, setNcError] = useState("");
  const [ncDup, setNcDup] = useState([]);
  // Impresión
  const [printFail, setPrintFail] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  // §3.7 aviso de venta directa (vendedor de campo)
  const [avisoCampoOpen, setAvisoCampoOpen] = useState(false);
  const [avisoCampoOk, setAvisoCampoOk] = useState(false);

  const injectPageSize = useCallback((size) => {
    let el = document.getElementById("print-page-size");
    if (!el) { el = document.createElement("style"); el.id = "print-page-size"; document.head.appendChild(el); }
    el.textContent = `@page { size: ${size}; margin: 0; }`;
  }, []);

  // Impresión por clonado: se copia SOLO la plantilla a un wrapper hijo directo
  // de <body> y el CSS oculta todo lo demás con display:none (sin conservar
  // espacio de layout). Esto evita las páginas en blanco del método anterior
  // (visibility:hidden mantenía la altura completa del POS ~14 pantallas).
  const printClone = useCallback((elementId, pageSpec, cls = "") => {
    injectPageSize(pageSpec);
    let wrap = document.getElementById("print-clone");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "print-clone"; document.body.appendChild(wrap); }
    wrap.className = cls;
    const src = document.getElementById(elementId);
    wrap.innerHTML = "";
    if (src) {
      const clone = src.cloneNode(true);
      // Los botones de acción nunca se imprimen.
      clone.querySelectorAll(".letter-actions").forEach((n) => n.remove());
      wrap.appendChild(clone);
    }
    setTimeout(() => { window.print(); }, 60);
  }, [injectPageSize]);

  const printThermal = useCallback(() => {
    try { printClone("thermal-ticket", "80mm auto", "thermal-width"); setPrintFail(false); return true; }
    catch { setPrintFail(true); return false; }
  }, [printClone]);

  const printInvoice = useCallback(() => {
    try { printClone("invoice-template", "letter portrait", "letter-width"); setPrintFail(false); return true; }
    catch { setPrintFail(true); return false; }
  }, [printClone]);

  const printLetter = useCallback(() => {
    try { printClone("letter-template", "letter portrait", "letter-width"); setPrintFail(false); return true; }
    catch { setPrintFail(true); return false; }
  }, [printClone]);

  // --- Impresoras configuradas: destino real por tipo de documento ---
  const ticketPdfRef = useRef(""); // PDF oficial de la venta actual (cache)

  // Obtiene (una vez por venta) la URL del ticket PDF oficial.
  const asegurarTicketPdf = async () => {
    if (!ticket?.id) return "";
    if (ticketPdfRef.current) return ticketPdfRef.current;
    try {
      const { data } = await api.post(`/sales/${ticket.id}/ticket-pdf`);
      ticketPdfRef.current = data.url || "";
    } catch { /* se reintenta en el siguiente intento de impresión */ }
    return ticketPdfRef.current;
  };

  // Ticket: el PDF oficial (el mismo que se comparte por WhatsApp) directo a la
  // impresora de tickets de este equipo (app de escritorio o su puente) o con el
  // diálogo del navegador; sin PDF, la plantilla 80 mm de la pantalla. Un fallo
  // de impresión NUNCA afecta la venta.
  const imprimirTicket = async () => {
    const pdfUrl = await asegurarTicketPdf();
    if (pdfUrl) {
      try {
        await imprimirPdf({ tipo: "ticket", pdfUrl, nombre: `ticket-${ticket?.folio || ""}.pdf`,
          mensaje: "Ticket enviado a la impresora." }, settings);
        setPrintFail(false); return true;
      } catch { /* sin PDF: plantilla de la pantalla */ }
    }
    return printThermal();
  };

  // --- Formato carta: PDF real del comprobante comercial RYSA ---
  // El backend es el GENERADOR ÚNICO: la primera llamada crea el archivo y
  // todas las siguientes devuelven EL MISMO PDF (vista previa incluida).
  const generarCartaPDF = async () => {
    if (!ticket?.id) { toast.error("Ticket no disponible"); return null; }
    if (cartaUrl) return cartaUrl;
    setPdfBusy(true);
    try { const { data } = await api.post(`/sales/${ticket.id}/letter-pdf`); setCartaUrl(data.url || data.path); return data.url || data.path; }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); return null; }
    finally { setPdfBusy(false); }
  };
  const descargarCarta = async () => { const url = await generarCartaPDF(); if (url) window.open(fileUrl(url), "_blank"); };
  // Carta: directo a la impresora de carta de este equipo; si no, el PDF con el diálogo.
  const imprimirCarta = async () => {
    const url = await generarCartaPDF();
    if (!url) return;
    try {
      await imprimirPdf({ tipo: "carta", pdfUrl: url, nombre: `comprobante-${ticket?.folio || ""}.pdf`,
        mensaje: "Comprobante enviado a la impresora." }, settings);
    } catch { printLetter(); }
  };
  const compartirCarta = async () => {
    const url = await generarCartaPDF();
    if (!url) return;
    const link = fileUrl(url);
    if (navigator.share) { try { await navigator.share({ title: `Comprobante ${ticket?.folio}`, text: `Comprobante ${ticket?.folio}`, url: link }); } catch {} }
    else { try { await navigator.clipboard.writeText(link); toast.success("Enlace copiado al portapapeles"); } catch { window.open(link, "_blank"); } }
  };
  const enviarCartaCorreo = () => {
    const link = cartaUrl ? fileUrl(cartaUrl) : `${window.location.origin}/verificar/${ticket?.id}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(`Comprobante ${ticket?.folio} · ${settings.empresa_nombre || "Grupo RYSA"}`)}&body=${encodeURIComponent(`Hola${ticket?.cliente_nombre ? " " + ticket.cliente_nombre : ""}:\n\nAdjuntamos tu comprobante ${ticket?.folio}. Total: ${money(ticket?.total)}.\nVerifícalo en: ${link}\n\n${settings.empresa_nombre || "Grupo RYSA"}`)}`;
  };
  // Al abrir la pestaña carta: carga (una vez) el PDF oficial de esta venta.
  useEffect(() => {
    if (ticket?.id && printMode === "letter") generarCartaPDF();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, printMode]);
  const enviarCartaWhatsApp = async () => {
    const url = await generarCartaPDF();
    if (!url) return;
    const msg = `Hola${ticket?.cliente_nombre ? " " + ticket.cliente_nombre : ""}, aquí está tu comprobante ${ticket?.folio} de ${settings.empresa_nombre || "Grupo RYSA"}. Total: ${money(ticket?.total)}.`;
    try {
      const modo = await adjuntarPdf(url, `comprobante-${ticket?.folio}.pdf`, `Comprobante ${ticket?.folio}`, msg);
      if (modo === "share") toast.success("PDF adjuntado. Selecciona WhatsApp en el menú de compartir.");
      else toast.info("El PDF se descargó. Adjúntalo manualmente en WhatsApp.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const condicion = formaPago === "credito" ? "credito" : "contado";
  const clienteSel = useMemo(() => clients.find((c) => c.id === clienteId) || null, [clients, clienteId]);
  // Datos frescos del cliente del ticket impreso (RFC, dirección, teléfono, razón social).
  const ticketCliente = useMemo(() => (ticket ? clients.find((c) => c.id === ticket.cliente_id) || null : null), [ticket, clients]);
  // Nombre de la sucursal donde se realizó la venta (por sucursal_id del ticket).
  const ticketSucursal = useMemo(() => (ticket ? sucursales.find((s) => s.id === ticket.sucursal_id) || null : null), [ticket, sucursales]);
  const credInfo = useMemo(() => {
    if (!clienteSel || clienteSel.codigo === "PUBLICO") return null;
    const lim = Number(clienteSel.limite_credito || 0), sal = Number(clienteSel.saldo || 0);
    const disp = Math.round((lim - sal) * 100) / 100;
    if (!clienteSel.credito_autorizado) return { dot: "bg-slate-400", label: "Sin crédito autorizado (contado)", nota: "", lim, sal, disp, ok: false };
    if (clienteSel.estado === "suspendido") return { dot: "bg-red-500", label: "Crédito suspendido", nota: "El crédito no puede usarse mientras esté suspendido.", lim, sal, disp, ok: true };
    if (lim > 0 && sal >= lim) return { dot: "bg-red-500", label: "Límite de crédito alcanzado", nota: "El crédito ya no puede usarse por el monto límite asignado.", lim, sal, disp, ok: true };
    if (sal > 0) return { dot: "bg-amber-500", label: "Crédito activo · con saldo pendiente", nota: "Puede seguir comprando; registra el abono abajo.", lim, sal, disp, ok: true };
    return { dot: "bg-green-500", label: "Crédito activo · disponible", nota: "", lim, sal, disp, ok: true };
  }, [clienteSel]);
  const creditoBloqueado = condicion === "credito" && !!clienteSel && !clienteSel.credito_autorizado && clienteSel.codigo !== "PUBLICO";

  useEffect(() => {
    // § Venta directa desde campo: preseleccionar cliente si viene del mapa
    try {
      const pre = JSON.parse(sessionStorage.getItem("preselect_pos"));
      if (pre) {
        sessionStorage.removeItem("preselect_pos");
        setTimeout(() => { setClienteId(pre.id); setClientQuery(pre.nombre || ""); }, 400);
      }
    } catch { /* noop */ }
    api.get("/clients", { params: { estado: "activo" } }).then((r) => {
      setClients(r.data);
      const pub = r.data.find((c) => c.codigo === "PUBLICO");
      if (pub) { setPubClientId(pub.id); if (!clienteId) setClienteId(pub.id); }
    });
    api.get("/vendedores").then((r) => setVendedores(r.data));
    api.get("/sucursales").then((r) => setSucursales(r.data || [])).catch(() => {});
    api.get("/settings").then((r) => {
      setSettings(r.data || {});
      if (r.data?.listas_precios_nombres?.length) setListaNames(r.data.listas_precios_nombres);
      if (r.data?.listas_precios_pct?.length) setListasPct(r.data.listas_precios_pct);
      if (r.data?.redondeo_precios) setRedondeo(r.data.redondeo_precios);
      setIncluyeIva(true);
      incluyeIvaDefault.current = true;
    });
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
      if (!enPantalla()) return;
      await refreshFolio();
      if (qRef.current) {
        try {
          const { data } = await api.get("/products", { params: { q: qRef.current, estado: "activo" } });
          const frescos = new Map((data || []).map((p) => [p.id, p]));
          setIndice((prev) => {
            if (!prev) { setResults((data || []).slice(0, 30)); return prev; }
            return prev.map((it) => (frescos.has(it.p.id) ? { ...it, p: frescos.get(it.p.id) } : it));
          });
        } catch {}
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

  // Carga todo el catálogo activo en una sola respuesta para buscar y filtrar
  // en memoria. El servidor responde 304 (sin volver a enviar nada) si el
  // catálogo no cambió desde la última carga; solo entonces se reindexa.
  const indiceVersion = useRef("");
  const cargarIndice = useCallback(async () => {
    try {
      const r = await api.get("/products/pos-index");
      const version = r.headers?.etag || "";
      if (version && version === indiceVersion.current) return;
      indiceVersion.current = version;
      setIndice(indexar(r.data || []));
    } catch {}
  }, []);
  // Existencias al día sin volver a bajar el catálogo: un mapa {id: existencia}
  // de ~60 KB cada minuto y justo después de cada venta.
  const refrescarExistencias = useCallback(async () => {
    try {
      const { data } = await api.get("/products/existencias");
      setIndice((prev) => (prev ? prev.map((it) => (
        data[it.p.id] !== undefined && data[it.p.id] !== it.p.existencia
          ? { ...it, p: { ...it.p, existencia: data[it.p.id] } } : it)) : prev));
    } catch {}
  }, []);
  useEffect(() => {
    cargarIndice();
    const t = setInterval(() => { if (enPantalla()) cargarIndice(); }, 180000);
    const e = setInterval(() => { if (enPantalla()) refrescarExistencias(); }, 60000);
    return () => { clearInterval(t); clearInterval(e); };
  }, [cargarIndice, refrescarExistencias]); // eslint-disable-line
  // Al recargar el índice (existencias nuevas) se rehace la búsqueda en pantalla.
  useEffect(() => { if (indice && qRef.current) setResults(buscarEnIndice(qRef.current, indice)); }, [indice]);

  const search = (val) => {
    setQ(val); qRef.current = val;
    clearTimeout(searchTimer.current);
    if (!val.trim()) return setResults([]);
    if (indice) return setResults(buscarEnIndice(val, indice));
    // Mientras carga el índice: servidor con espera corta, descartando respuestas viejas.
    searchTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get("/products", { params: { q: val, estado: "activo" } });
        if (qRef.current === val) setResults(data.slice(0, 30));
      } catch {}
    }, 180);
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
  const loadCatalogo = useCallback(async (vistaActual) => {
    setCatLoading(true);
    try {
      let data = [];
      if (vistaActual === "todos") {
        data = [];   // sale del índice en memoria (catalogoVisible)
      } else if (vistaActual === "favoritos") {
        const { data: prods } = await api.get("/favorites");
        data = prods || [];
      } else if (vistaActual === "mas_vendidos") {
        const { data: prods } = await api.get("/products/bestsellers", { params: { estado: "activo", limit: 40 } });
        data = prods || [];
      }
      setCatalogo(data);
    } catch {} finally { setCatLoading(false); }
  }, []);

  useEffect(() => { loadCatalogMeta(); }, []);
  useEffect(() => { loadCatalogo(vista); }, [vista, loadCatalogo]);
  // Lo que muestra el catálogo: "Todos" sale del índice; la marca/categoría se filtra en memoria.
  const CAT_MAX = 200;
  const catalogoFiltrado = useMemo(() => {
    const base = vista === "todos" ? (indice || []).map((it) => it.p) : catalogo;
    return categoriaSel && vista !== "favoritos" ? base.filter((p) => grupoDe(p) === categoriaSel.trim().toUpperCase()) : base;
  }, [vista, indice, catalogo, categoriaSel]);
  const catalogoVisible = catalogoFiltrado.slice(0, CAT_MAX);
  const catalogoCargando = catLoading || (vista === "todos" && !indice);

  // Lector de código de barras: al presionar Enter, agrega el producto exacto (código o código de barras).
  const onSearchKey = async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = q.trim();
    if (!val) return;
    const matches = (p) => p.codigo?.toLowerCase() === val.toLowerCase() || (p.codigos_barras || []).some((b) => String(b) === val);
    let hit = results.find(matches) || (indice || []).find((it) => matches(it.p))?.p || (results.length === 1 ? results[0] : null);
    if (!hit) {
      try {
        const { data } = await api.get("/products", { params: { q: val, estado: "activo" } });
        hit = data.find(matches) || (data.length === 1 ? data[0] : null);
      } catch {}
    }
    if (hit) addToCart(hit);
    else toast.error("Producto no encontrado");
  };

  const descargarBlob = (blob, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Descarga el PDF y lo adjunta directamente (Web Share API con archivos).
  // Así se envía el archivo real por WhatsApp, no un link. Si el navegador no
  // soporta compartir archivos, el PDF se descarga como respaldo para adjuntarlo.
  const blobCacheRef = useRef({});
  const prefetchBlob = async (pdfUrl) => {
    const key = fileUrl(pdfUrl);
    if (blobCacheRef.current[key]) return blobCacheRef.current[key];
    const resp = await api.get(pdfUrl.replace(/^.*\/api\/files\//, "/files/"), { responseType: "blob" });
    blobCacheRef.current[key] = resp.data;
    return resp.data;
  };
  const adjuntarPdf = async (pdfUrl, filename, titulo, texto) => {
    const blob = await prefetchBlob(pdfUrl);
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: titulo, text: texto, files: [file] });
      return "share";
    }
    descargarBlob(blob, filename);
    return "download";
  };

  const sendWhatsApp = async () => {
    if (!ticket?.id) return toast.error("Ticket no disponible");
    setWaSending(true);
    try {
      const { data } = await api.post(`/sales/${ticket.id}/ticket-pdf`);
      const filename = `ticket-${ticket.folio}.pdf`;
      const msg = `Hola${ticket.cliente_nombre ? " " + ticket.cliente_nombre : ""}, aquí está tu ${ticket.tipo_venta === "cotizacion" ? "cotización" : "ticket"} ${ticket.folio} de ${settings.empresa_nombre || "Grupo RYSA"}. Total: ${money(ticket.total)}.`;
      const modo = await adjuntarPdf(data.url, filename, `Ticket ${ticket.folio}`, msg);
      if (modo === "share") toast.success("PDF adjuntado. Selecciona WhatsApp en el menú de compartir.");
      else toast.info("El PDF se descargó. Adjúntalo manualmente en WhatsApp.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setWaSending(false); }
  };

  const priceFromList = (p, l) => calcListPrice(p, l, listasPct, redondeo);
  const priceOf = (p) => priceFromList(p, lista);

  // Aviso si un precio queda por debajo del costo (no debería pasar con las
  // listas del sistema anterior; protege contra configuraciones erróneas).
  const avisarBajoCosto = (p, neto) => {
    const costo = Number(p?.costo ?? 0);
    if (costo > 0 && Number(neto) > 0 && Number(neto) < costo) toast.warning(`${p.descripcion}: el precio queda por debajo del costo`);
  };
  const addToCart = (p) => {
    setSelProd(p);
    if (!cart.some((i) => i.product_id === p.id)) avisarBajoCosto(p, priceOf(p));
    setCart((c) => {
      const ex = c.find((i) => i.product_id === p.id);
      if (ex) return c.map((i) => (i.product_id === p.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      const basePres = (p.presentaciones || []).find((pr) => pr.es_base) || (p.presentaciones || [])[0] || { nombre: p.unidad_medida || "PZA", factor: 1.0, precio: priceOf(p) };
      // La unidad base entra con el MISMO precio que muestra la tarjeta (lista
      // activa). El precio guardado en la presentación base solía ser uno viejo
      // y cambiaba el precio al agregarlo; solo los empaques (factor ≠ 1) usan
      // su precio propio.
      const factorBase = Number(basePres.factor || 1.0);
      const precioInicial = factorBase === 1 ? priceOf(p) : Number(basePres.precio ?? priceOf(p) * factorBase);
      return [
        ...c,
        {
          product_id: p.id,
          codigo: p.codigo || "",
          descripcion: p.descripcion || "",
          cantidad: 1,
          unidad: basePres.nombre || p.unidad_medida || "PZA",
          presentacion: basePres.nombre || p.unidad_medida || "PZA",
          factor: factorBase,
          presentaciones: p.presentaciones || [basePres],
          precio: Number(precioInicial),
          iva_tasa: tasaIva(p),
          costo: Number(p.costo ?? 0),
          descuento: 0,
          comentario: "",
          precios: p.precios || [],
          precio_minimo: p.precio_minimo ?? 0,
          existencia: Number(p.existencia ?? 0),
        },
      ];
    });
    setSelected(p.id);
    setQ(""); qRef.current = ""; setResults([]);
    searchRef.current?.focus();
  };

  // Agrega un producto al carrito con un precio elegido explícitamente
  // (`marca`: datos de precio manual de la línea, ver setLinePrecio).
  const addToCartWithPrice = (p, precio, marca = {}) => {
    const pid = p.product_id || p.id;
    setSelProd(p);
    setCart((c) => {
      const ex = c.find((i) => i.product_id === pid);
      if (ex) return c.map((i) => (i.product_id === pid ? { ...i, precio: Number(precio) || 0, ...marca } : i));
      return [...c, { product_id: pid, codigo: p.codigo || "", descripcion: p.descripcion || "", cantidad: 1, unidad: p.unidad_medida || p.unidad || "PZA", precio: Number(precio) || 0, iva_tasa: tasaIva(p), costo: Number(p.costo ?? 0), descuento: 0, comentario: "", precios: p.precios || [], precio_minimo: p.precio_minimo ?? 0, existencia: Number(p.existencia ?? 0), ...marca }];
    });
    setSelected(pid);
    setQ(""); qRef.current = ""; setResults([]);
    searchRef.current?.focus();
  };
  // Al cambiar la lista de precios se actualizan automáticamente los precios del carrito
  const applyLista = (l) => {
    setLista(l);
    // También los productos sin precio capturado: su precio sale del costo y el % de la lista.
    // Las líneas con precio manual conservan el precio que se autorizó.
    setCart((c) => c.map((i) => (!i.precio_manual && (i.precios?.length || i.costo > 0) ? { ...i, precio: priceFromList({ precios: i.precios, precio_minimo: i.precio_minimo, costo: i.costo, iva_tasa: i.iva_tasa }, l) } : i)));
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

  // Nuevo cliente desde el POS: modal sobre la venta, sin perder el carrito.
  const ncBlank = () => ({ codigo: "", nombre: "", razon_social: "", telefono: "", whatsapp: "", celular: "", correo: "", rfc: "", direccion: "", colonia: "", ciudad: "", estado_geo: "", cp: "", referencias: "" });
  const openNuevoCliente = () => { setNc(ncBlank()); setNcError(""); setNcDup([]); setNuevoClienteOpen(true); };
  const seleccionarExistente = (c) => { pickClient(c); setNuevoClienteOpen(false); setNcDup([]); };

  const guardarNuevoCliente = async () => {
    if (!nc.nombre.trim()) return setNcError("El nombre es obligatorio");
    const q = nc.nombre.trim().toLowerCase();
    const candidatos = clients.filter((c) => c.nombre?.toLowerCase() === q || (nc.rfc && c.rfc && c.rfc.toLowerCase() === nc.rfc.toLowerCase()));
    if (candidatos.length > 0 && ncDup.length === 0) {
      setNcDup(candidatos);
      return setNcError("Ya existe uno o más clientes con este nombre/RFC. Selecciona el existente o registra de todos modos.");
    }
    setNcBusy(true);
    setNcError("");
    try {
      const payload = {
        ...nc, nombre: nc.nombre.trim(), codigo: nc.codigo.trim() || undefined,
        vendedor_id: user.id, lista_precios: 1, precio_venta: 1, estado: "activo", tipo: "publico",
      };
      const { data } = await api.post("/clients", payload);
      setClients((prev) => [...prev, data].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es")));
      pickClient(data);
      setNuevoClienteOpen(false);
      setNcDup([]);
      toast.success(`Cliente ${data.nombre} creado y seleccionado`);
    } catch (e) {
      setNcError(formatApiError(e.response?.data?.detail) || "No se pudo registrar el cliente");
    } finally { setNcBusy(false); }
  };
  // Búsqueda en vivo por TOKENS: cada palabra escrita debe aparecer en
  // nombre/código/RFC, sin importar el orden ni la posición (coincidencia parcial).
  const filteredClients = useMemo(() => {
    const base = clientQuery ? clients : clients; // lista ya ordenada por nombre
    if (!clientQuery.trim()) return base;
    const tokens = clientQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return base.filter((c) => {
      const hay = `${c.nombre} ${c.codigo} ${c.rfc || ""}`.toLowerCase();
      return tokens.every((tk) => hay.includes(tk));
    }).slice(0, 100);
  }, [clients, clientQuery]);
  // El carrito guarda SIEMPRE el precio neto (así se envía al backend con el
  // flag precios_incluyen_iva). Si el toggle "Precios incluyen IVA" está
  // activo, lo que el cajero ve y captura es precio CON IVA: aquí se
  // convierte a neto antes de guardar.
  const netoDeVista = (item, precioVista) => {
    const f = incluyeIva ? 1 + Number(item?.iva_tasa || 0) / 100 : 1;
    return +((Number(precioVista) || 0) / f).toFixed(4);
  };
  const cerrarLinePrice = () => {
    setLinePrice(null); setLibreVal(""); setManualOpen(false);
    setAutzPend(null); setAutzCodigo(""); setAutzError(""); setRemota(null);
  };
  // `manual`: { autorizacion_id, autorizado_por } cuando es precio manual.
  // Elegir un precio de la lista quita la marca de precio manual.
  const setLinePrecio = (item, precioVista, manual = null) => {
    const precio = netoDeVista(item, precioVista);
    avisarBajoCosto(item, precio);
    const marca = manual
      ? { precio_manual: true, autorizacion_id: manual.autorizacion_id || null, autorizado_por: manual.autorizado_por || "" }
      : { precio_manual: false, autorizacion_id: null, autorizado_por: "" };
    const inCart = cart.some((i) => i.product_id === item.product_id);
    if (inCart) setCart((c) => c.map((i) => (i.product_id === item.product_id ? { ...i, precio, ...marca } : i)));
    else addToCartWithPrice(item, precio, marca);
    cerrarLinePrice();
  };
  const aplicarPrecioManual = () => {
    const vista = Number(libreVal);
    if (!(vista > 0)) return toast.error("Escribe un precio mayor a cero");
    if (precioManualDirecto) return setLinePrecio(linePrice, vista, { autorizado_por: user?.name });
    setAutzPend({ vista, neto: netoDeVista(linePrice, vista) });
    setAutzCodigo(""); setAutzError("");
  };
  const autorizarPrecioManual = async (codigo) => {
    if (!autzPend || !linePrice || String(codigo).length !== 6 || autzBusyRef.current) return;
    autzBusyRef.current = true; setAutzBusy(true); setAutzError("");
    try {
      const { data } = await api.post("/autorizaciones", {
        codigo, accion: "precio_manual", product_id: linePrice.product_id,
        precio: autzPend.neto, precio_anterior: Number(linePrice.precio) || null,
        solicitud_id: remota?.estado === "pendiente" ? remota.id : null,
      });
      toast.success(`Precio manual autorizado por ${data.autorizador_nombre}`);
      setLinePrecio(linePrice, autzPend.vista, { autorizacion_id: data.id, autorizado_por: data.autorizador_nombre });
    } catch (e) {
      setAutzError(formatApiError(e.response?.data?.detail));
      setAutzCodigo("");
    } finally { autzBusyRef.current = false; setAutzBusy(false); }
  };
  // Autorización a distancia: la caja queda en espera (diálogo bloqueado) hasta
  // que alguien con permiso la aprueba o rechaza desde su pantalla, o teclea
  // aquí su código.
  const solicitarRemota = async () => {
    if (!autzPend || !linePrice) return;
    setAutzError("");
    try {
      const { data } = await api.post("/autorizaciones/solicitudes", {
        accion: "precio_manual", product_id: linePrice.product_id,
        precio: autzPend.neto, precio_anterior: Number(linePrice.precio) || null,
        precio_vista: autzPend.vista,
        precio_anterior_vista: +(Number(linePrice.precio || 0) * fDlg).toFixed(2),
        con_iva: !!incluyeIva, cantidad: Number(linePrice.cantidad) || null,
        cliente_nombre: clienteSel?.nombre || null, caja: windowLabel || null,
      });
      setRemota(data);
    } catch (e) {
      setAutzError(formatApiError(e.response?.data?.detail));
    }
  };
  const cancelarRemota = async () => {
    const id = remota?.id;
    setRemota(null);
    if (id) { try { await api.post(`/autorizaciones/solicitudes/${id}/cancelar`); } catch {} }
  };
  useEffect(() => {
    if (remota?.estado !== "pendiente") return undefined;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get(`/autorizaciones/solicitudes/${remota.id}`);
        if (data.estado === "pendiente") return;
        setRemota(null);
        if (data.estado === "aprobada") {
          toast.success(`Precio manual autorizado por ${data.autorizador_nombre}`);
          if (linePrice && autzPend) setLinePrecio(linePrice, autzPend.vista, { autorizacion_id: data.id, autorizado_por: data.autorizador_nombre });
        } else if (data.estado === "rechazada") {
          const msg = `${data.autorizador_nombre || "El autorizador"} rechazó el precio${data.motivo ? `: ${data.motivo}` : ""}`;
          toast.error(msg); setAutzError(msg);
        } else {
          setAutzError(data.estado === "vencida" ? "La solicitud venció sin respuesta. Vuelve a pedirla o usa un código." : "La solicitud se canceló.");
        }
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [remota, linePrice, autzPend]); // eslint-disable-line

  const updateQty = (id, d) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, cantidad: Math.max(0.001, +(i.cantidad + d).toFixed(3)) } : i)));
  const setQty = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, cantidad: Number(v) || 0 } : i)));
  const setLineDisc = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, descuento: Number(v) || 0 } : i)));
  const setLineComentario = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, comentario: v } : i)));
  const setUnidad = (id, v) => setCart((c) => c.map((i) => (i.product_id === id ? { ...i, unidad: v, presentacion: v } : i)));
  const setPresentacion = (id, presNombre) => {
    setCart((c) =>
      c.map((i) => {
        if (i.product_id !== id) return i;
        const pres = (i.presentaciones || []).find((p) => p.nombre === presNombre);
        if (!pres) return { ...i, presentacion: presNombre, unidad: presNombre };
        // Volver a la unidad base regresa al precio de la lista activa.
        const nuevoPrecio = Number(pres.factor || 1.0) === 1
          ? priceFromList({ precios: i.precios, precio_minimo: i.precio_minimo, costo: i.costo, iva_tasa: i.iva_tasa }, lista)
          : Number(pres.precio ?? i.precio);
        return {
          ...i,
          presentacion: pres.nombre,
          unidad: pres.nombre,
          factor: Number(pres.factor || 1.0),
          precio: nuevoPrecio,
          // El precio cambió: ya no es el precio manual que se autorizó.
          precio_manual: false, autorizacion_id: null, autorizado_por: "",
        };
      })
    );
  };
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
  // Factor de vista del diálogo de precio por línea (mismo toggle de IVA):
  const fDlg = incluyeIva && linePrice ? 1 + Number(linePrice.iva_tasa || 0) / 100 : 1;

  // Atajos de teclado F6-F9
  useEffect(() => {
    const target = () => selected || (cart.length ? cart[cart.length - 1].product_id : null);
    const onKey = (e) => {
      if (!activoRef.current) return;
      if (["F6", "F7", "F8", "F9"].includes(e.key)) e.preventDefault();
      if (e.key === "F8") { const t = target(); if (t) { updateQty(t, 1); setSelected(t); } }
      else if (e.key === "F9") { const t = target(); if (t) { updateQty(t, -1); setSelected(t); } }
      else if (e.key === "F7") { setPriceCheckOpen(true); setTimeout(() => pcRef.current?.focus(), 100); }
      else if (e.key === "F6") {
        // F6 con la lista de precios abierta = precio manual.
        if (linePrice) { if (!autzPend) setManualOpen(true); return; }
        const t = target();
        const item = t ? cart.find((i) => i.product_id === t) : null;
        const prod = item || selProd;
        if (!prod) return toast.error("Selecciona un producto del carrito o de la búsqueda");
        if (!(prod.precios?.length || Number(prod.costo) > 0 || Number(prod.precio_minimo) > 0)) return toast.error("El producto no tiene costo ni precios configurados");
        const precio = item ? item.precio : calcListPrice(prod, lista, listasPct, redondeo);
        setLinePrice({ ...prod, product_id: prod.product_id || prod.id, precio });
        setFilaPrecio(Math.max(0, Number(lista) - 1));
        const fv = incluyeIva ? 1 + Number(prod.iva_tasa ?? prod.iva ?? 8) / 100 : 1;
        setLibreVal(String(+(precio * fv).toFixed(2)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, cart, selProd, lista, listasPct, redondeo, incluyeIva, linePrice, autzPend]);

  const pcSearch = async (val) => {
    setPcQuery(val);
    if (val.length < 1) return setPcResults([]);
    const { data } = await api.get("/products", { params: { q: val, estado: "activo" } });
    setPcResults(data.slice(0, 10));
  };

  const openPay = () => {
    if (cart.length === 0) return toast.error("Agrega productos");
    if (tipoVenta === "cotizacion") return confirmar();
    // La caja es obligatoria para operar: si no hay sesión abierta, abre el
    // modal de apertura (el vendedor no debe salir del POS).
    if (!cajaAbierta) {
      setCajaModalOpen(true);
      toast.info("Abre una caja para continuar");
      return;
    }
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

  // Atajo de teclado: Ctrl+Enter abre el cobro (COBRAR) o guarda la cotización.
  useEffect(() => {
    const onKey = (e) => {
      if (!activoRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (creditoBloqueado || cart.length === 0) return;
        openPay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditoBloqueado, cart.length, tipoVenta, formaPago, totals.total, can]);

  // Reset completo del POS: la venta siguiente NO debe heredar nada de la
  // anterior (cliente Público General, carrito vacío, forma de pago contado,
  // tipo de venta directa, lista 1, sin descuentos ni notas ni modales).
  const resetPos = useCallback(() => {
    // Elimina por completo el estado persistente del carrito de esta ventana.
    clearCartState(windowId);
    // Estados locales temporales: modales, selecciones y filtros del catálogo.
    setIncluyeIva(incluyeIvaDefault.current);
    setClientQuery("");
    setClientOpen(false);
    setLinePrice(null);
    setSelProd(null);
    setLibreVal("");
    setManualOpen(false);
    setAutzPend(null);
    setAutzCodigo("");
    setAutzError("");
    setPayOpen(false);
    setInvOverride(null);
    setInvReason("");
    setVista("todos");
    setCategoriaSel("");
    setQ(""); qRef.current = ""; setResults([]);
    setSelected(null);
    setAbonoCli(null);
    setAbono({ monto: "", metodo: "efectivo", referencia: "" });
    setPrintMode("thermal");
    setTicket(null);
    setCotizacion(null);
    setPrintFail(false);
    setNuevoClienteOpen(false);
    setNcDup([]);
    setNcError("");
    // Cliente vuelve a Público General (el resto lo restaura CartContext).
    if (pubClientId) setClienteId(pubClientId);
    refreshFolio();
  }, [windowId, clearCartState, pubClientId, refreshFolio, setClienteId]);

  const confirmar = async () => {
    // §3.7 — Aviso obligatorio de venta directa desde campo (vendedor_campo):
    if (esVendedorCampo && !avisoCampoOk) {
      setAvisoCampoOpen(true);
      return;
    }
    // Llave anti-duplicados: la misma en los reintentos de este cobro (doble
    // clic, red lenta); el servidor devuelve la venta ya registrada en vez de
    // crear otra. Se renueva al terminar la venta.
    if (!cobroKeyRef.current) {
      cobroKeyRef.current = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    try {
      const payload = {
        idempotency_key: cobroKeyRef.current,
        cliente_id: clienteId || null,
        items: cart.map((i) => ({ product_id: i.product_id, codigo: i.codigo || "", descripcion: i.descripcion || "", cantidad: Number(i.cantidad), unidad: i.unidad || "PZA", presentacion: i.presentacion || i.unidad || "PZA", factor: Number(i.factor || 1.0), precio: Number(i.precio) || 0, iva_tasa: incluyeIva ? Number(i.iva_tasa ?? 8) : 0, descuento: Number(i.descuento || 0), comentario: i.comentario || "", precio_manual: !!i.precio_manual, autorizacion_id: i.precio_manual ? (i.autorizacion_id || null) : null })),
        descuento_global: totals.descGlobalTotal,
        condicion,
        pagos: (tipoVenta === "directa" && condicion === "contado") ? pagos.map((p) => ({ metodo: p.metodo, monto: Number(p.monto || 0), ...(p.metodo === "tarjeta" && p.card_type ? { card_type: p.card_type } : {}) })) : [],
        lista_precios: Number(lista),
        tipo_venta: tipoVenta,
        precios_incluyen_iva: false,
        // Operador: el backend fuerza vendedor_id = usuario autenticado salvo que el
        // rol tenga el permiso de cambiar operador. Solo se envía si el usuario lo tiene.
        vendedor_id: can("venta.cambiar_operador") ? (vendedorId || user.id) : null,
        // Override de inventario negativo (rol autorizado, con motivo).
        allow_negative_inventory: can("inventario.autorizar_negativo") && invReason !== "",
        override_reason: invReason || null,
      };
      const { data } = await api.post("/sales", payload);
      cobroKeyRef.current = null;
      refrescarExistencias();
      // Reset completo: la siguiente venta comienza limpia (Público General,
      // carrito vacío, contado, directa, sin descuentos ni modales abiertos).
      resetPos();
      setCartaUrl(""); // documento nuevo = archivos nuevos
      ticketPdfRef.current = "";
      blobCacheRef.current = {};
      setWaPhone(clienteSel?.whatsapp || clienteSel?.telefono || clienteSel?.celular || "");
      setPrintFail(false);
      if (data.tipo_venta === "cotizacion") {
        // Bifurcación COTIZACIÓN: modal propio con PDF carta (sin térmico).
        setCotizacion(data);
        toast.success(`Cotización ${data.folio} registrada`);
        loadCaja();
        return;
      }
      setTicket(data);
      // Precarga en segundo plano de ticket + carta (PDF y blob): así el
      // primer clic en WhatsApp/Descargar comparte INMEDIATAMENTE.
      setTimeout(() => {
        asegurarTicketPdf().then((u) => u && prefetchBlob(u)).catch(() => {});
        generarCartaPDF().then((u) => u && prefetchBlob(u)).catch(() => {});
      }, 50);
      toast.success(`Venta ${data.folio} registrada`);
      loadCaja();
      // Impresión automática: un error aquí NUNCA cancela ni revierte la venta.
      if (settings.ticket_config?.auto_print) {
        imprimirTicket();
      }
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const suspender = async () => {
    if (cart.length === 0) return toast.error("Nada que suspender");
    await api.post("/sales/suspend", { cliente_id: clienteId, items: cart, descuento_global: totals.descGlobalAmount, condicion, pagos: [], lista_precios: Number(lista), tipo_venta: tipoVenta });
    toast.success("Venta suspendida"); resetPos(); loadSuspended();
  };
  const recuperar = async (s) => {
    if (cart.length && !(await pedirConfirmacion({
      titulo: "¿Reemplazar el ticket actual?",
      mensaje: `El ticket tiene ${cart.length} ${cart.length === 1 ? "artículo" : "artículos"}. Al recuperar la venta suspendida se reemplazan. Si quieres conservarlo, suspéndelo primero o ábrelo en una ventana nueva.`,
      accion: "Reemplazar",
    }))) return;
    setCart(s.payload.items); setDescGlobal(s.payload.descuento_global || 0); setClienteId(s.payload.cliente_id || clienteId); await api.delete(`/sales-suspended/${s.id}`); setSuspOpen(false); loadSuspended(); toast.info("Venta recuperada"); };

  // Registrar abono directo al saldo del cliente desde el POS
  const guardarAbono = async () => {
    const monto = Number(abono.monto);
    if (!monto || monto <= 0) return toast.error("Ingresa un monto válido");
    setAbonoSaving(true);
    try {
      const { data } = await api.post(`/cxc/${abonoCli.id}/abono`, { ...abono, monto });
      toast.success("Abono registrado correctamente");
      setAbonoCli(null);
      // El comprobante siempre se abre, independientemente de que el refresco
      // de clientes falle. El refresco va por separado para no bloquearlo.
      setPosComp({ abono: data.abono || { folio: data.folio, cliente_nombre: abonoCli.nombre, monto, metodo: abono.metodo, referencia: abono.referencia, saldo_anterior: data.saldo_anterior, saldo_restante: data.saldo_actual }, cliente: abonoCli });
      try {
        // refresca clientes para actualizar saldo mostrado
        const { data: cl } = await api.get("/clients", { params: { estado: "activo" } });
        setClients(cl);
        const pub = (cl || []).find((c) => c.codigo === "PUBLICO");
        if (pub && !clienteId) setClienteId(pub.id);
      } catch { /* el refresco de clientes no debe impedir el comprobante */ }
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setAbonoSaving(false); }
  };

  // Comprobante de abono (PDF/Imprimir/WhatsApp) desde el POS
  const posGenCompPdf = async (abono) => {
    setPosCompBusy(true);
    try { const { data } = await api.post(`/abonos/${abono.id}/pdf`); return data; }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); return null; }
    finally { setPosCompBusy(false); }
  };
  const posDescargarComp = async (abono) => { const d = await posGenCompPdf(abono); if (d) { const a = document.createElement("a"); a.href = fileUrl(d.url); a.download = d.filename; document.body.appendChild(a); a.click(); a.remove(); } };
  const posCompartirComp = async (abono) => {
    const d = await posGenCompPdf(abono); if (!d) return;
    const link = fileUrl(d.url);
    if (navigator.share) { try { await navigator.share({ title: `Comprobante ${abono.folio}`, text: `Comprobante ${abono.folio}`, url: link }); } catch {} }
    else { try { await navigator.clipboard.writeText(link); toast.success("Enlace copiado"); } catch { window.open(link, "_blank"); } }
  };
  const posEnviarCompWhatsApp = async (abono) => {
    const d = await posGenCompPdf(abono); if (!d) return;
    const msg = `Hola ${abono.cliente_nombre || ""}, aquí está tu comprobante de abono ${abono.folio} de ${money(abono.monto)}.`;
    try {
      const modo = await adjuntarPdf(d.url, d.filename || `comprobante-${abono.folio}.pdf`, `Comprobante ${abono.folio}`, msg);
      if (modo === "share") toast.success("PDF adjuntado. Selecciona WhatsApp en el menú de compartir.");
      else toast.info("El PDF se descargó. Adjúntalo manualmente en WhatsApp.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // ===== COTIZACIONES: PDF tamaño carta (Descargar / Enviar) =====
  const cotGenPdf = async () => {
    const { data } = await api.post(`/sales/${cotizacion.id}/cotizacion-pdf`);
    return data; // {path, url}
  };
  const cotDescargar = async () => {
    setCotBusy("pdf");
    try {
      const d = await cotGenPdf();
      const a = document.createElement("a");
      a.href = fileUrl(d.url);
      a.download = `cotizacion-${cotizacion.folio}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      toast.success("Cotización descargada");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setCotBusy(""); }
  };
  const cotEnviarWhatsApp = async () => {
    setCotBusy("wa");
    try {
      const d = await cotGenPdf();
      const venc = String(cotizacion.fecha_vencimiento || "").slice(0, 10);
      const msg = `Hola${cotizacion.cliente_nombre ? " " + cotizacion.cliente_nombre : ""}, le compartimos su cotización ${cotizacion.folio}${venc ? ` (vigente hasta el ${venc})` : ""}. Total: ${money(cotizacion.total)}.`;
      const modo = await adjuntarPdf(d.url, `cotizacion-${cotizacion.folio}.pdf`, `Cotización ${cotizacion.folio}`, msg);
      if (modo === "share") toast.success("PDF adjuntado. Selecciona WhatsApp en el menú de compartir.");
      else toast.info("El PDF se descargó. Adjúntalo manualmente en WhatsApp.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setCotBusy(""); }
  };

  const folioActual = tipoVenta === "cotizacion" ? nextFolio.cotizacion : nextFolio.venta;

  return (
    <div className="flex flex-col lg:flex-row gap-4 -m-6 p-6 pb-28 min-h-0 lg:h-[calc(var(--erp-vh)-5rem)] lg:overflow-hidden" data-testid="pos-page">
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
            placeholder={puedeVerClientesFull ? "Cliente: escribe para buscar por nombre, clave o RFC..." : "Cliente: busca por nombre o clave..."}
            className="pl-10 h-12" data-testid="pos-cliente-search" />
          {clientOpen && filteredClients.length > 0 && (
            <div className="absolute z-30 mt-1 w-full card-soft shadow-lg max-h-64 overflow-y-auto" data-testid="pos-cliente-list">
              {filteredClients.map((c) => (
                 <button key={c.id} onClick={() => pickClient(c)} data-testid={`pos-cliente-opt-${c.codigo}`}
                   className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                   <span className="truncate"><b className="text-brand-600 mr-1">{c.codigo}</b> {c.nombre}
                     {puedeVerClientesFull && c.rfc && <span className="text-slate-400 font-mono text-xs ml-1">· {c.rfc}</span>}
                   </span>
                   <span className="flex items-center gap-1.5 shrink-0">
                     {puedeVerClientesFull && c.rfc && <span className="font-mono text-[10px] text-slate-400">{c.rfc}</span>}
                     {Number(c.descuento_permanente) > 0 && <Badge variant="outline" className="text-[10px] ml-2">-{c.descuento_permanente}%</Badge>}
                   </span>
                 </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {puedeVerClientesFull && (
            <Button variant="outline" onClick={openNuevoCliente} className="h-12 whitespace-nowrap" data-testid="pos-nuevo-cliente" title="Registrar un cliente nuevo sin salir del POS">
              <UserPlus className="w-4 h-4 mr-1 text-brand-600" /> Nuevo cliente
            </Button>
          )}
          <Button
            variant={cajaAbierta ? "outline" : "default"}
            onClick={() => setCajaModalOpen(true)}
            className={`h-12 whitespace-nowrap ${cajaAbierta ? "" : "bg-brand-600 hover:bg-brand-700"}`}
            data-testid="pos-caja-btn"
            title={cajaAbierta ? "Ver caja abierta" : "Abrir caja"}
          >
            <Wallet2 className={`w-4 h-4 mr-1 ${cajaAbierta ? "text-green-600" : "text-white"}`} />
            {cajaAbierta ? "Caja abierta" : "Abrir caja"}
          </Button>
          <Select value={String(lista)} onValueChange={(v) => applyLista(Number(v))}>
          <SelectTrigger className="h-12 sm:w-44" data-testid="pos-lista"><Tags className="w-4 h-4 mr-1 text-slate-400" /><SelectValue /></SelectTrigger>
          <SelectContent>
            {listaNames.map((n, i) => <SelectItem key={i} value={String(i + 1)}>{n}</SelectItem>)}
            <SelectItem value={String(listaNames.length + 1)}>Precio mínimo</SelectItem>
          </SelectContent>
          </Select>
          <ReporteRapido />
        </div>
        </div>

        {/* Ticket / Carrito */}
        <div className="flex flex-col card-soft min-h-0 flex-1">
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-brand-600" />
              <span className="font-display font-bold">Ticket</span>
              <Badge className="bg-brand-600/10 text-brand-600 font-mono flex items-center gap-1" data-testid="pos-next-folio"><Hash className="w-3 h-3" />{folioActual}</Badge>
              <span className="ml-auto text-sm text-slate-400">{cart.length} {cart.length === 1 ? "artículo" : "artículos"}</span>
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
              {Number(descPct) > 0 && <Badge className="bg-brand-600/10 text-brand-600 text-[10px]" data-testid="pos-descpct">-{descPct}%</Badge>}
            </div>
            {credInfo && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" data-testid="pos-credito-indicador">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-semibold text-slate-700">
                    <span className={`w-2.5 h-2.5 rounded-full ${credInfo.dot}`} data-testid="pos-credito-dot" /> {credInfo.label}
                  </span>
                  <span className="text-slate-400">Límite {money(credInfo.lim)}</span>
                </div>
                {credInfo.nota && (
                  <div className={`text-[11px] mt-1 ${credInfo.dot === "bg-red-500" ? "text-red-600" : "text-slate-500"}`}>{credInfo.nota}</div>
                )}
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-slate-500">Saldo pendiente: <b className={credInfo.sal > 0 ? "text-red-600" : "text-green-700"}>{money(credInfo.sal)}</b></span>
                  <span className="text-slate-500">Disponible: <b className={credInfo.disp <= 0 ? "text-red-600" : "text-green-700"}>{money(credInfo.disp)}</b></span>
                </div>
                {credInfo.sal > 0 && can("cxc.abono") && (
                  <Button size="sm" onClick={() => { setAbonoCli(clienteSel); setAbono({ monto: "", metodo: "efectivo", referencia: "" }); }}
                    className="w-full mt-2 bg-brand-600 hover:bg-brand-700" data-testid="pos-abonar-credito">
                    <HandCoins className="w-4 h-4 mr-1" /> Abonar a la cuenta ({money(credInfo.sal)})
                  </Button>
                )}
                {credInfo.sal > 0 && !can("cxc.abono") && (
                  <p className="text-[11px] text-slate-400 mt-1.5" title="El abono directo lo realiza administración o encargado">
                    Para abonar a esta cuenta, solicítalo a un encargado.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
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
                    <th className="px-1.5 py-1.5 font-semibold text-right">Precio{incluyeIva && <span className="text-[8px] font-normal normal-case text-slate-400"> c/IVA</span>}</th>
                    <th className="px-1.5 py-1.5 font-semibold text-right">Importe{incluyeIva && <span className="text-[8px] font-normal normal-case text-slate-400"> c/IVA</span>}</th>
                    <th className="px-1.5 py-1.5 font-semibold text-center">Comentario</th>
                    <th className="px-1.5 py-1.5 font-semibold text-center">+/-</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cart.map((i) => {
                    // Vista de la línea: cuando "Precios incluyen IVA" está
                    // activo, Precio e Importe se muestran CON IVA (el carrito
                    // sigue guardando neto internamente).
                    const fIva = incluyeIva ? 1 + Number(i.iva_tasa || 0) / 100 : 1;
                    const precioVista = +(i.precio * fIva).toFixed(2);
                    const brutoVista = +(i.cantidad * i.precio * fIva).toFixed(2);
                    const importeVista = +((i.cantidad * i.precio - (i.descuento || 0)) * fIva).toFixed(2);
                    return (
                      <tr key={i.product_id} onClick={() => setSelected(i.product_id)}
                        className={`cursor-pointer align-middle ${selected === i.product_id ? "bg-brand-600/[0.04]" : "hover:bg-slate-50"}`}
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
                          {i.presentaciones && i.presentaciones.length > 1 ? (
                            <select
                              value={i.presentacion || i.unidad}
                              onChange={(e) => setPresentacion(i.product_id, e.target.value)}
                              className="w-20 h-6 px-1 text-center text-[11px] font-bold bg-slate-50 border border-slate-300 rounded text-carbon-900 cursor-pointer shadow-sm"
                              data-testid={`cart-pres-${i.codigo}`}
                            >
                              {i.presentaciones.map((pr) => (
                                <option key={pr.id || pr.nombre} value={pr.nombre}>
                                  {pr.nombre} (x{pr.factor})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              <Input value={i.unidad} onChange={(e) => setUnidad(i.product_id, e.target.value)}
                                list="pos-unidades" className="w-16 h-6 p-0 text-center text-xs" data-testid={`cart-unidad-${i.codigo}`} />
                              <datalist id="pos-unidades">
                                {UNIDADES_OPC.map((u) => <option key={u} value={u} />)}
                              </datalist>
                            </>
                          )}
                        </td>
                        <td className="px-1.5 py-1 text-[11px] text-slate-700 min-w-[130px]">
                          <div className="truncate max-w-[180px]">{i.descripcion}</div>
                          {i.descuento > 0 && <div className="text-[9px] text-brand-600">Desc -{money(i.descuento)}</div>}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums text-slate-500 whitespace-nowrap">{i.iva_tasa}%</td>
                        <td className="px-1.5 py-1 text-right tabular-nums whitespace-nowrap">
                          <button onClick={(e) => { e.stopPropagation(); setLinePrice(i); setFilaPrecio(Math.max(0, Number(lista) - 1)); setLibreVal(String(precioVista)); }}
                            className="underline decoration-dotted hover:text-brand-600" data-testid={`cart-price-${i.codigo}`}>
                            {money(precioVista)}
                          </button>
                          {i.precio_manual && (
                            <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-700" data-testid={`cart-manual-${i.codigo}`}
                              title={i.autorizado_por ? `Precio manual · autorizó ${i.autorizado_por}` : "Precio manual"}>
                              Manual{i.autorizado_por ? ` · ${i.autorizado_por.split(" ")[0]}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-1.5 py-1 text-right font-semibold tabular-nums whitespace-nowrap">
                          {!(i.descuento > 0) && money(importeVista)}
                          {i.descuento > 0 && <>
                            <span className="line-through text-slate-400 font-normal">{money(brutoVista)}</span>
                            {" "}{money(importeVista)}
                          </>}
                        </td>
                        <td className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <Input value={i.comentario || ""} onChange={(e) => setLineComentario(i.product_id, e.target.value)}
                            placeholder="⬦" className="w-24 h-6 p-0 text-[11px] justify-self-end" data-testid={`cart-comentario-${i.codigo}`} />
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

          <div className="p-3 border-t border-slate-200 space-y-2 shrink-0">
            {tipoVenta === "directa" && (
              <div className="grid grid-cols-3 gap-2">
                {[["contado", "Contado", Banknote], ["transferencia", "Transferencia", ArrowLeftRight], ["credito", "Crédito", CreditCard]].map(([k, l, Ic]) => (
                  <button key={k} onClick={() => setFormaPago(k)} data-testid={`forma-pago-${k}`}
                    className={`flex flex-col items-center gap-1 py-2 rounded-md border text-xs font-medium transition-colors ${formaPago === k ? "border-brand-600 bg-brand-600/5 text-brand-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
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
                className={`flex items-center gap-1 text-[11px] whitespace-nowrap px-2 py-1 rounded border ${incluyeIva ? "border-brand-600 text-brand-600 bg-brand-600/5" : "border-slate-200 text-slate-400"}`}
                data-testid="pos-incluye-iva">
                <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${incluyeIva ? "bg-brand-600 border-brand-600" : "border-slate-300"}`}>{incluyeIva && <Check className="w-3 h-3 text-white" />}</span>
                IVA ({settings.iva_tasa ?? 8}%) aplicado
              </button>
            </div>
            {totals.descGlobalAmount > 0 && <div className="text-xs text-brand-600">Descuento global{descMode === "%" ? ` (${descGlobal}%)` : ""}: -{money(totals.descGlobalAmount)}</div>}
            {totals.descPctAmount > 0 && <div className="text-xs text-brand-600">Descuento cliente ({descPct}%): -{money(totals.descPctAmount)}</div>}
            {creditoBloqueado && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="pos-credito-bloqueo">
                <CreditCard className="w-4 h-4" /> Este cliente no tiene crédito habilitado. Usa contado o habilita su crédito en Clientes.
              </div>
            )}
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
          <Button variant="outline" className="h-9 text-xs px-2" onClick={() => setSuspOpen(true)} data-testid="ver-suspendidas"
            title="Ventas suspendidas" aria-label={`Ventas suspendidas: ${suspended.length}`}><PlayCircle className="w-3 h-3 mr-1" /> {suspended.length}</Button>
        </div>
        {/* Atajos siempre visibles (antes solo aparecían cuando una búsqueda no encontraba nada). */}
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500" data-testid="pos-atajos">
          <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono">Enter</kbd> agrega por código o lector</span>
          <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono">F6</kbd> precios</span>
          <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono">F7</kbd> verificar</span>
          <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono">F8</kbd>/<kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono">F9</kbd> cantidad</span>
          <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono">Ctrl+Enter</kbd> cobrar</span>
        </div>

        {/* Vista del catálogo: todos / favoritos / más vendidos */}
        {!q && (
          <div className="flex items-center gap-1.5 mb-2">
            {[["todos", "Todos", LayoutGrid], ["favoritos", "Favoritos", Star], ["mas_vendidos", "Más vendidos", Flame]].map(([k, l, Ic]) => (
              <button key={k} onClick={() => setVista(k)} data-testid={`pos-vista-${k}`}
                className={`flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium transition-colors ${vista === k ? "bg-brand-600 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
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

        <div className="flex-1 overflow-y-auto card-soft [container-type:size]">
          {catalogoCargando && !q ? (
            <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>
          ) : q ? (
            results.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 p-10">
                <Package className="w-12 h-12 mb-2" /><p className="text-sm text-slate-400">Escribe para buscar productos</p>
                <div className="mt-6 flex flex-wrap gap-2 justify-center text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Keyboard className="w-3.5 h-3.5" /> Atajos:</span>
                  <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F8</kbd> +cantidad</span>
                  <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F9</kbd> −cantidad</span>
                  <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F7</kbd> verificar precio</span>
                  <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">F6</kbd> precios del producto (otra vez: precio manual)</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1 p-1">
                {results.map((p) => (
                  <ProductCard key={p.id} p={p} onAdd={() => addToCart(p)} priceOf={priceOf} isFav={favIds.has(p.id)} onFav={(e) => toggleFav(e, p.id)} incluyeIva={incluyeIva} />
                ))}
              </div>
            )
          ) : (
            catalogoVisible.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 p-10">
                {vista === "favoritos" ? <Star className="w-12 h-12 mb-2" /> : <Package className="w-12 h-12 mb-2" />}
                <p className="text-sm text-slate-400">{vista === "favoritos" ? "Aún no tienes productos favoritos. Marca la estrella de un producto para guardarlo." : "Sin productos en esta vista."}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1 p-1">
                {catalogoVisible.map((p) => (
                  <ProductCard key={p.id} p={p} onAdd={() => addToCart(p)} priceOf={priceOf} isFav={favIds.has(p.id)} onFav={(e) => toggleFav(e, p.id)} mostrarSold={vista === "mas_vendidos"} incluyeIva={incluyeIva} />
                ))}
                {catalogoFiltrado.length > CAT_MAX && (
                  <p className="py-2 text-center text-xs text-slate-400">Mostrando {CAT_MAX} de {catalogoFiltrado.length}. Usa el buscador o elige una marca.</p>
                )}
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
                  <Select value={p.metodo} onValueChange={(v) => setPagos((s) => s.map((x, idx) => idx === i ? { ...x, metodo: v, card_type: v === "tarjeta" ? (x.card_type || "debito") : undefined } : x))}>
                    <SelectTrigger className="w-44" data-testid={`pago-metodo-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{METODOS.map(([k, l, Ic]) => <SelectItem key={k} value={k}><span className="flex items-center gap-2"><Ic className="w-4 h-4" /> {l}</span></SelectItem>)}</SelectContent>
                  </Select>
                  {p.metodo === "tarjeta" && (
                    <Select value={p.card_type || "debito"} onValueChange={(v) => setPagos((s) => s.map((x, idx) => idx === i ? { ...x, card_type: v } : x))}>
                      <SelectTrigger className="w-32" data-testid={`pago-cardtype-${i}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="debito"><span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Débito</span></SelectItem>
                        <SelectItem value="credito"><span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Crédito</span></SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Input type="number" value={p.monto} onChange={(e) => setPagos((s) => s.map((x, idx) => idx === i ? { ...x, monto: e.target.value } : x))} placeholder="0.00" data-testid={`pago-monto-${i}`} />
                  {pagos.length > 1 && <button onClick={() => setPagos((s) => s.filter((_, idx) => idx !== i))}><X className="w-4 h-4 text-slate-400" /></button>}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setPagos((s) => [...s, { metodo: "tarjeta", monto: "", card_type: "debito" }])} data-testid="add-pago"><Plus className="w-4 h-4 mr-1" /> Pago mixto</Button>
              <div className="flex justify-between text-sm pt-2 border-t"><span>Pagado</span><span className="font-semibold">{money(pagado)}</span></div>
              <div className="flex justify-between text-lg font-bold"><span>Cambio</span><span data-testid="pos-cambio" className="text-green-600">{money(cambio)}</span></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button><Button onClick={confirmar} className="bg-brand-600 hover:bg-brand-700" data-testid="confirmar-venta">Confirmar venta</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nuevo cliente desde el POS (el carrito y la venta NO se tocan) */}
      <Dialog open={nuevoClienteOpen} onOpenChange={setNuevoClienteOpen}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" data-testid="pos-nuevo-cliente-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><UserPlus className="w-5 h-5 text-brand-600" /> Nuevo cliente</DialogTitle></DialogHeader>
          {ncDup.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="pos-nc-duplicados">
              <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" /> Ya existe un cliente similar. Puedes seleccionarlo:</div>
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {ncDup.map((c) => (
                  <button key={c.id} onClick={() => seleccionarExistente(c)} data-testid={`pos-nc-usar-${c.codigo}`}
                    className="w-full text-left px-3 py-2 rounded-md bg-white border border-amber-200 hover:bg-amber-100 flex items-center justify-between">
                    <span><b className="text-brand-600">{c.codigo}</b> {c.nombre}{c.rfc ? ` · ${c.rfc}` : ""}</span>
                    <span className="text-xs font-semibold text-amber-700">Usar este</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setNcDup([])} className="mt-2 text-xs font-semibold text-amber-700 underline" data-testid="pos-nc-ignorar-dup">
                Registrar de todos modos
              </button>
            </div>
          )}
          {ncError && !ncDup.length && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="pos-nc-error">{ncError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Nombre / Razón social *</Label>
              <Input value={nc.nombre} onChange={(e) => setNc((s) => ({ ...s, nombre: e.target.value }))} className="mt-1" data-testid="pos-nc-nombre" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Clave (opcional)</Label>
              <Input value={nc.codigo} onChange={(e) => setNc((s) => ({ ...s, codigo: e.target.value }))} className="mt-1" placeholder="auto" data-testid="pos-nc-codigo" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">RFC</Label>
              <Input value={nc.rfc} onChange={(e) => setNc((s) => ({ ...s, rfc: e.target.value }))} className="mt-1 font-mono" data-testid="pos-nc-rfc" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Teléfono</Label>
              <Input value={nc.telefono} onChange={(e) => setNc((s) => ({ ...s, telefono: e.target.value }))} className="mt-1" data-testid="pos-nc-telefono" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">WhatsApp</Label>
              <Input value={nc.whatsapp} onChange={(e) => setNc((s) => ({ ...s, whatsapp: e.target.value }))} className="mt-1" data-testid="pos-nc-whatsapp" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Correo</Label>
              <Input value={nc.correo} onChange={(e) => setNc((s) => ({ ...s, correo: e.target.value }))} className="mt-1" data-testid="pos-nc-correo" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Dirección</Label>
              <Input value={nc.direccion} onChange={(e) => setNc((s) => ({ ...s, direccion: e.target.value }))} className="mt-1" data-testid="pos-nc-direccion" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Ciudad / Localidad</Label>
              <Input value={nc.ciudad} onChange={(e) => setNc((s) => ({ ...s, ciudad: e.target.value }))} className="mt-1" data-testid="pos-nc-ciudad" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Estado</Label>
              <Input value={nc.estado_geo} onChange={(e) => setNc((s) => ({ ...s, estado_geo: e.target.value }))} className="mt-1" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Referencias</Label>
              <Input value={nc.referencias} onChange={(e) => setNc((s) => ({ ...s, referencias: e.target.value }))} className="mt-1" data-testid="pos-nc-referencias" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNuevoClienteOpen(false); setNcError(""); setNcDup([]); }}>Cancelar</Button>
            <Button onClick={guardarNuevoCliente} disabled={ncBusy} className="bg-brand-600 hover:bg-brand-700" data-testid="pos-nc-guardar">
              {ncBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />} Guardar cliente
            </Button>
          </DialogFooter>
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
              className="bg-brand-600 hover:bg-brand-700" data-testid="inv-override-continue">Continuar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selector de precio por línea */}
      <Dialog open={!!linePrice} onOpenChange={(o) => { if (!o && !remota) cerrarLinePrice(); }}>
        <DialogContent data-testid="line-price-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Tag className="w-5 h-5" /> Precio · {linePrice?.descripcion}</DialogTitle></DialogHeader>
          {linePrice && autzPend && (
            // Paso 2 del precio manual: quien autoriza teclea su código aquí.
            <div className="space-y-4" data-testid="autorizacion-panel">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="w-4 h-4" /> Se necesita autorización</div>
                <div className="mt-1">
                  Precio manual: <b className="cifras">{money(autzPend.vista)}</b>{incluyeIva ? " con IVA" : ""}
                  <span className="text-amber-800/80"> · antes {money(Number(linePrice.precio || 0) * fDlg)}</span>
                </div>
              </div>
              <div className="space-y-2 text-center">
                <Label className="text-xs uppercase tracking-wider text-slate-500">Código de quien autoriza</Label>
                <CodigoAutorizacionInput value={autzCodigo} onChange={(v) => { setAutzCodigo(v); setAutzError(""); }}
                  onComplete={autorizarPrecioManual} autoFocus testId="autorizacion-codigo" />
                {autzError
                  ? <p className="text-sm text-red-600" data-testid="autorizacion-error">{autzError}</p>
                  : <p className="text-xs text-slate-400">Administrador, dueño o usuario con permiso para autorizar.</p>}
              </div>
              {remota ? (
                <div className="rounded-lg border-2 border-brand-600 bg-brand-50 p-4 text-center" data-testid="autorizacion-remota-espera">
                  <Loader2 className="mx-auto h-7 w-7 animate-spin text-brand-600" />
                  <p className="mt-2 font-display text-lg font-black text-slate-900">Esperando autorización remota…</p>
                  <p className="text-sm text-slate-600">Se avisó a quienes pueden autorizar. La venta queda detenida hasta que respondan o tecleen su código arriba.</p>
                  <p className="mt-1 text-xs tabular-nums text-slate-500">Vence a las {new Date(remota.responder_antes).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</p>
                  <Button variant="outline" className="mt-3" onClick={cancelarRemota} data-testid="autorizacion-remota-cancelar">Cancelar solicitud</Button>
                </div>
              ) : (
                <Button variant="outline" className="h-11 w-full border-dashed text-sm" onClick={solicitarRemota} data-testid="autorizacion-remota-solicitar">
                  <SendIcon className="mr-1.5 h-4 w-4" /> Solicitar autorización remota
                </Button>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={!!remota} onClick={() => { setAutzPend(null); setAutzCodigo(""); setAutzError(""); }} data-testid="autorizacion-regresar">Regresar</Button>
                <Button onClick={() => autorizarPrecioManual(autzCodigo)} disabled={autzCodigo.length !== 6 || autzBusy}
                  className="bg-brand-600 hover:bg-brand-700" data-testid="autorizacion-confirmar">
                  {autzBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Autorizar"}
                </Button>
              </div>
            </div>
          )}
          {linePrice && !autzPend && (
            <div className="space-y-3">
              {/* Lista de precios (F6): Precio 1…n y mínimo, sin y con IVA, ya
                  redondeados. Flechas para moverse, Enter o doble clic para elegir. */}
              {(() => {
                const ivaF = 1 + tasaIva(linePrice) / 100;
                // Solo las listas que el producto tiene capturadas (si tiene P1–P3,
                // no aparecen P4 ni P5) y el mínimo si existe.
                const caps = listasCapturadas(linePrice, listasPct);
                const filas = [
                  ...(caps.length ? caps : [1]).map((l) => ({ id: `${l}`, nombre: listaNames[l - 1] || `Precio ${l}`, neto: priceFromList(linePrice, l) })),
                  ...(Number(linePrice.precio_minimo || 0) > 0 ? [{ id: "min", nombre: "Precio mínimo", neto: Number(linePrice.precio_minimo) }] : []),
                ];
                const elegir = (f) => f && f.neto > 0 && setLinePrecio(linePrice, f.neto * fDlg);
                const sel = Math.min(filaPrecio, filas.length - 1);
                return (
                  <div>
                    <div className="overflow-hidden rounded-md border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                      tabIndex={0} autoFocus data-testid="line-precios-tabla"
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") { e.preventDefault(); setFilaPrecio((x) => Math.min(x + 1, filas.length - 1)); }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setFilaPrecio((x) => Math.max(x - 1, 0)); }
                        else if (e.key === "Enter") { e.preventDefault(); elegir(filas[sel]); }
                      }}>
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500">
                          <tr><th className="px-3 py-2 text-left font-semibold">Lista</th><th className="px-3 py-2 text-right font-semibold">Sin IVA</th><th className="px-3 py-2 text-right font-semibold">Con IVA</th></tr>
                        </thead>
                        <tbody>
                          {filas.map((f, idx) => {
                            const actual = Math.abs(Number(linePrice.precio) - f.neto) < 0.0001 && f.neto > 0;
                            return (
                              <tr key={f.id} data-testid={`line-precio-${f.id}`} onClick={() => setFilaPrecio(idx)} onDoubleClick={() => elegir(f)}
                                className={`cursor-pointer border-t border-slate-100 ${idx === sel ? "bg-carbon-900 text-white" : "hover:bg-slate-50"} ${f.neto > 0 ? "" : "opacity-50"}`}>
                                <td className="px-3 py-2">{f.nombre}{actual && <span className={`ml-2 text-2xs ${idx === sel ? "text-brand-300" : "text-brand-600"}`}>actual</span>}</td>
                                <td className="cifras px-3 py-2 text-right">{f.neto.toFixed(4)}</td>
                                <td className="cifras px-3 py-2 text-right font-semibold">{money(f.neto * ivaF)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button variant="outline" onClick={() => setManualOpen((v) => !v)} data-testid="line-precio-manual-btn"
                        title={precioManualDirecto ? "Capturar un precio distinto a la lista" : "Capturar un precio distinto a la lista (requiere autorización)"}
                        className={manualOpen ? "border-brand-600 text-brand-600" : ""}>
                        <PencilLine className="w-4 h-4 mr-1" /> Precio manual
                        {!precioManualDirecto && <Lock className="w-3 h-3 ml-1 text-slate-400" />}
                        <kbd className="ml-1.5 text-[9px] bg-slate-100 text-slate-500 px-1 rounded">F6</kbd>
                      </Button>
                      <Button variant="outline" onClick={cerrarLinePrice} className="ml-auto" data-testid="line-precio-cancelar">Cancelar</Button>
                      <Button onClick={() => elegir(filas[sel])} disabled={!(filas[sel]?.neto > 0)} className="bg-brand-600 hover:bg-brand-700" data-testid="line-precio-seleccionar">Seleccionar</Button>
                    </div>
                  </div>
                );
              })()}
              {manualOpen && (
                <div className="border-t pt-3" data-testid="line-precio-manual">
                  <Label className="text-xs uppercase tracking-wider text-slate-500">{incluyeIva ? "Precio manual (con IVA)" : "Precio manual (sin IVA)"}</Label>
                  <div className="flex gap-2 mt-1">
                    <Input type="number" inputMode="decimal" step="any" min="0" autoFocus value={libreVal}
                      onChange={(e) => setLibreVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aplicarPrecioManual(); } }}
                      onFocus={(e) => e.target.select()} placeholder="0.00" data-testid="line-precio-manual-input" />
                    <Button onClick={aplicarPrecioManual} className="bg-brand-600 hover:bg-brand-700 shrink-0" data-testid="line-precio-manual-aplicar">
                      {precioManualDirecto ? "Aplicar" : <><Lock className="w-4 h-4 mr-1" /> Pedir autorización</>}
                    </Button>
                  </div>
                  {!precioManualDirecto && (
                    <p className="text-xs text-slate-500 mt-1.5">Después teclea su código un administrador, el dueño o alguien con permiso para autorizar.</p>
                  )}
                </div>
              )}
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
                  {(listasCapturadas(p, listasPct).length ? listasCapturadas(p, listasPct) : [1]).map((l) => (
                    <div key={l} className="bg-slate-50 rounded p-1.5 text-center"><div className="text-slate-400">{listaNames[l - 1] || `Precio ${l}`}</div><div className="font-semibold text-brand-600">{money(precioLista(p, l, listasPct, redondeo))}</div></div>
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
                <div><div className="text-sm font-medium">{s.payload.items.length} productos</div><div className="text-xs text-slate-400">{fmtFechaHora(s.fecha)}</div></div>
                <Button size="sm" onClick={() => recuperar(s)} className="bg-brand-600 hover:bg-brand-700"><PlayCircle className="w-4 h-4 mr-1" /> Recuperar</Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

{/* Ticket térmico + Factura/Cotización */}
      <Dialog open={!!ticket} onOpenChange={(o) => { if (!o) setTicket(null); }}>
        <DialogContent data-testid="ticket-dialog" className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-center">
              {ticket?.tipo_venta === "cotizacion" ? "Cotización" : "Ticket de venta"}
            </DialogTitle>
          </DialogHeader>
          {ticket && (
            <>
              {/* Toggle vista */}
              <div className="flex justify-center gap-2 mb-3 flex-wrap">
                <Button size="sm" variant={printMode === "thermal" ? "default" : "outline"}
                  onClick={() => setPrintMode("thermal")}
                  className={printMode === "thermal" ? "bg-brand-600" : ""}>
                  Ticket térmico
                </Button>
                <Button size="sm" variant={printMode === "letter" ? "default" : "outline"}
                  onClick={() => setPrintMode("letter")}
                  className={printMode === "letter" ? "bg-brand-600" : ""}>
                  Formato carta
                </Button>
                <Button size="sm" variant={printMode === "invoice" ? "default" : "outline"}
                  onClick={() => setPrintMode("invoice")}
                  className={printMode === "invoice" ? "bg-brand-600" : ""}>
                  {ticket.tipo_venta === "cotizacion" ? "Cotización" : "Factura"}
                </Button>
              </div>

              {printFail && (
                <div className="text-center text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2" data-testid="pos-print-fail">
                  Venta realizada correctamente. No fue posible imprimir el ticket.
                  <Button size="sm" variant="outline" onClick={imprimirTicket} className="ml-2" data-testid="pos-reintentar-impresion">
                    <RefreshCw className="w-4 h-4 mr-1" /> Reintentar impresión
                  </Button>
                </div>
              )}

              {/* Thermal ticket (80mm) */}
              {printMode === "thermal" && (
              <div id="thermal-ticket" className="thermal font-mono text-[12px] text-black bg-white p-2 mx-auto">
                <div className="text-center">
                  <img src={settings.logo_url ? fileUrl(settings.logo_url) : "/brand/isotipo1.png"} alt="logo" className="h-12 mx-auto mb-1 object-contain" />
                  <div className="font-bold text-[11px]">{settings.razon_social || "RAYMUNDO GOMEZ DIAZ"}</div>
                  <div className="font-bold text-[14px]">{settings.empresa_nombre || "Grupo RYSA"}</div>
                  {settings.ticket_config?.mostrar_direccion !== false && [settings.direccion, [settings.ciudad, settings.estado, settings.cp].filter(Boolean).join(", ")].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                  {settings.ticket_config?.mostrar_telefono !== false && settings.telefono && <div>Tel: {settings.telefono}</div>}
                  {settings.ticket_config?.mostrar_rfc !== false && settings.rfc && <div>RFC: {settings.rfc}</div>}
                  {ticketSucursal && <div>{ticketSucursal.nombre}</div>}
                </div>
                {settings.ticket_config?.encabezado && <div className="text-center text-[11px]">{settings.ticket_config.encabezado}</div>}
                <div className="border-t border-dashed border-black my-1" />
                <div>{ticket.tipo_venta === "cotizacion" ? "COTIZACIÓN" : "FOLIO"}: {ticket.folio}</div>
                <div>Fecha: {fmtFechaHora(ticket.fecha)}</div>
                <div>Cliente: {ticket.cliente_nombre}</div>
                <div className="border-t border-dashed border-black my-1" />
                <div className="text-center font-bold text-[11px]">DESCRIPCIÓN</div>
                <div className="border-t border-t-2 border-black my-1" />
                {ticket.items.map((i, k) => {
                  const importe = i.cantidad * i.precio - (i.descuento || 0);
                  const descuento = i.descuento || 0;
                  return (
                    <div key={k}>
                      <div>{i.descripcion}</div>
                      {i.comentario && <div className="text-[11px] text-slate-600">⬢ {i.comentario}</div>}
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
                <div className="flex justify-between"><span>Artículos vendidos</span><span>{ticket.items.reduce((s, i) => s + Number(i.cantidad || 0), 0)}</span></div>
                <div className="flex justify-between"><span>Atendido por</span><span>{ticket.vendedor_nombre}</span></div>
                <div className="text-center font-bold mt-1">Verifique su compra y cambio</div>
                <div className="border-t border-dashed border-black my-1" />
                {ticket.id && (
                  <div className="text-center">
                    <img src={`${process.env.REACT_APP_BACKEND_URL || ""}/api/sales/${ticket.id}/qr?destino=${encodeURIComponent(`${window.location.origin}/verificar/${ticket.id}`)}`} alt="QR de verificación"
                      className="mx-auto w-24 h-24" data-testid="ticket-qr" />
                    <div className="text-[9px] text-slate-500">{window.location.origin}/verificar/{ticket.id}</div>
                  </div>
                )}
                <div className="text-center text-[11px]">{settings.ticket_config?.pie || "¡Gracias por su compra!"}</div>
              </div>
              )}

              {/* Formato carta RYSA — GENERADOR ÚNICO: se muestra el PDF real
                  persistido; lo que se ve aquí es EXACTAMENTE el archivo que
                  se descarga, imprime y comparte por WhatsApp/correo. */}
              {printMode === "letter" && (
                <div id="letter-pdf-wrap" className="mx-auto" data-testid="letter-template">
                  {!cartaUrl ? (
                    <div className="py-16 flex flex-col items-center gap-3">
                      {pdfBusy ? (
                        <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
                      ) : (
                        <Button onClick={generarCartaPDF} className="bg-brand-600 hover:bg-brand-700" data-testid="letter-cargar">
                          <FileText className="w-4 h-4 mr-1" /> Generar vista previa del PDF oficial
                        </Button>
                      )}
                      <p className="text-xs text-slate-400 max-w-sm text-center">
                        El documento se genera UNA sola vez por venta: la vista previa, la descarga,
                        la impresión y lo que llega por WhatsApp son siempre este mismo archivo.
                      </p>
                    </div>
                  ) : (
                    <>
                      <object data={fileUrl(cartaUrl)} type="application/pdf"
                              width="100%" style={{ height: "62vh", minHeight: 420 }}
                              data-testid="letter-pdf-frame">
                        <iframe title={`Comprobante ${ticket?.folio || ""}`} src={fileUrl(cartaUrl)}
                                style={{ width: "100%", height: "62vh", border: 0 }} />
                        <div className="text-center py-10">
                          <p className="text-sm text-slate-500 mb-2">Tu navegador no muestra el PDF integrado.</p>
                          <a href={fileUrl(cartaUrl)} target="_blank" rel="noreferrer"
                             className="text-brand-600 underline font-semibold">Abrir el PDF en una pestaña</a>
                        </div>
                      </object>
                      <p className="text-[11px] text-slate-400 text-center mt-1">
                        Vista previa del archivo oficial · {ticket?.folio} ·{" "}
                        <a href={fileUrl(cartaUrl)} target="_blank" rel="noreferrer" className="underline">abrir en pestaña</a>
                      </p>
                    </>
                  )}

                  <div className="letter-actions" style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    <Button size="sm" onClick={imprimirCarta} disabled={pdfBusy} data-testid="letter-imprimir">
                      <Printer className="w-4 h-4 mr-1" /> Imprimir
                    </Button>
                    <Button size="sm" variant="outline" onClick={descargarCarta} disabled={pdfBusy} data-testid="letter-descargar">
                      {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />} Descargar PDF
                    </Button>
                    <Button size="sm" variant="outline" onClick={compartirCarta} disabled={!cartaUrl} data-testid="letter-compartir">
                      <Share2 className="w-4 h-4 mr-1" /> Compartir
                    </Button>
                    <Button size="sm" className="bg-[#25D366] hover:bg-[#1ebe57]" onClick={enviarCartaWhatsApp} disabled={pdfBusy} data-testid="letter-whatsapp">
                      <MessageCircle className="w-4 h-4 mr-1" /> Enviar por WhatsApp
                    </Button>
                    <Button size="sm" variant="outline" onClick={enviarCartaCorreo} disabled={!cartaUrl} data-testid="letter-correo">
                      <Mail className="w-4 h-4 mr-1" /> Correo
                    </Button>
                    <Button size="sm" variant="outline"
                            onClick={() => cartaUrl && window.open(fileUrl(cartaUrl), "_blank")}
                            disabled={!cartaUrl} data-testid="letter-imprimir">
                      <Printer className="w-4 h-4 mr-1" /> Imprimir PDF
                    </Button>
                  </div>
                </div>
              )}

              {/* Invoice/Quote letter-size template */}
              {printMode === "invoice" && (
              <div id="invoice-template" className="invoice-letter mx-auto" style={{ padding: "15mm 20mm" }}>
                {/* Header */}
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <img src={settings.logo_url ? fileUrl(settings.logo_url) : "/brand/isotipo1.png"} alt="logo" style={{ height: 60 }} className="object-contain" />
                  </div>
                  <div className="text-right" style={{ fontSize: "9pt", color: "#475569" }}>
                    <div style={{ fontSize: "14pt", fontWeight: 700, color: "#CD0708" }}>{settings.empresa_nombre || "Grupo RYSA"}</div>
                    <div>{settings.razon_social || "RAYMUNDO GOMEZ DIAZ"}</div>
                    {settings.rfc && <div>RFC: {settings.rfc}</div>}
                    {settings.direccion && <div>{settings.direccion}</div>}
                    {[settings.ciudad, settings.estado, settings.cp].filter(Boolean).join(", ")}
                    {settings.telefono && <div>Tel: {settings.telefono}</div>}
                    {settings.correo && <div>{settings.correo}</div>}
                    {ticketSucursal && <div style={{ fontWeight: 600, marginTop: 2 }}>Sucursal: {ticketSucursal.nombre}{ticketSucursal.codigo ? ` (${ticketSucursal.codigo})` : ""}</div>}
                  </div>
                </div>

                {/* Línea divisoria */}
                <div style={{ height: 3, background: "#CD0708", marginBottom: 12 }} />

                {/* Título */}
                <div className="text-center mb-5">
                  <div style={{ fontSize: "18pt", fontWeight: 800, color: "#CD0708", letterSpacing: 2 }}>
                    {ticket.tipo_venta === "cotizacion" ? "COTIZACIÓN" : "FACTURA"}
                  </div>
                  <div style={{ fontSize: "10pt", color: "#64748B" }}>Folio: {ticket.folio}</div>
                </div>

                {/* Fecha y cliente */}
                <div className="flex justify-between mb-4" style={{ fontSize: "9pt" }}>
                  <div>
                    <strong>Cliente:</strong> {ticket.cliente_nombre}<br />
                    {ticketCliente?.rfc && <><strong>RFC:</strong> {ticketCliente.rfc}<br /></>}
                    {ticketCliente?.razon_social && ticketCliente.razon_social !== ticket.cliente_nombre && <><strong>Razón social:</strong> {ticketCliente.razon_social}<br /></>}
                    {ticketCliente?.direccion && <><strong>Dirección:</strong> {ticketCliente.direccion}{ticketCliente.ciudad ? `, ${ticketCliente.ciudad}` : ""}<br /></>}
                    {(ticketCliente?.telefono || ticketCliente?.whatsapp) && <><strong>Tel:</strong> {ticketCliente.telefono || ticketCliente.whatsapp}<br /></>}
                    <strong>Atendió:</strong> {ticket.vendedor_nombre}<br />
                    {ticketSucursal && <><strong>Sucursal:</strong> {ticketSucursal.nombre}<br /></>}
                  </div>
                  <div className="text-right">
                    <strong>Fecha:</strong> {fmtFechaHora(ticket.fecha)}<br />
                    <strong>Folio:</strong> {ticket.folio}<br />
                    <strong>Condición:</strong> {ticket.condicion === "credito" ? "Crédito" : "Contado"}<br />
                    {ticket.condicion === "credito" && <><strong>Vencimiento:</strong> {fmtFecha(ticket.fecha_vencimiento || ticket.fecha)}<br /></>}
                  </div>
                </div>

                {/* Tabla de productos */}
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "11%" }}>Código</th>
                      <th>Descripción</th>
                      <th style={{ width: "6%" }}>Und.</th>
                      <th className="text-right" style={{ width: "8%" }}>Cant.</th>
                      <th className="text-right" style={{ width: "13%" }}>Precio</th>
                      <th className="text-right" style={{ width: "11%" }}>IVA</th>
                      <th className="text-right" style={{ width: "11%" }}>Desc.</th>
                      <th className="text-right" style={{ width: "13%" }}>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticket.items.map((i, k) => {
                      const linImporte = i.importe_bruto ?? (i.cantidad * i.precio - (i.descuento || 0));
                      const linIva = i.iva_linea ?? (incluyeIva ? linImporte * ((i.iva_tasa ?? 8) / 100) : 0);
                      const uniPrecio = i.precio_bruto ?? i.precio;
                      return (
                        <tr key={k}>
                          <td style={{ fontSize: "8pt" }}>{i.codigo}</td>
                          <td>{i.descripcion}{i.comentario ? <><br /><span style={{ fontSize: "7.5pt", color: "#CD0708" }}>⬢ {i.comentario}</span></> : null}</td>
                          <td>{i.unidad}</td>
                          <td className="text-right">{i.cantidad}</td>
                          <td className="text-right">{money(uniPrecio)}</td>
                          <td className="text-right">{i.iva_tasa ? `${money(linIva)} (${i.iva_tasa}%)` : "-"}</td>
                          <td className="text-right">{i.descuento ? money(i.descuento) : "-"}</td>
                          <td className="text-right" style={{ fontWeight: 600 }}>{money(linImporte)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Forma de pago */}
                <div className="flex justify-between mt-2" style={{ fontSize: "9pt", color: "#475569" }}>
                  <span>
                    <strong>Forma de pago:</strong> {(ticket.pagos || []).map((p) => { const base = ({ efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", deposito: "Depósito" })[p.metodo] || p.metodo; const lbl = p.metodo === "tarjeta" && p.card_type ? `${base} ${p.card_type === "debito" ? "Débito" : "Crédito"}` : base; return `${lbl}${p.monto ? ` ${money(p.monto)}` : ""}`; }).join(" + ") || (ticket.condicion === "credito" ? "Crédito" : "Contado")}
                  </span>
                  {ticket.cambio > 0 && <span><strong>Cambio:</strong> {money(ticket.cambio)}</span>}
                </div>

                {/* Totales */}
                <div className="flex justify-end mt-3" style={{ fontSize: "10pt" }}>
                  <div style={{ width: 250 }}>
                    {incluyeIva && (
                      <div className="flex justify-between py-1"><span>Subtotal</span><span>{money(ticket.subtotal)}</span></div>
                    )}
                    {incluyeIva && (
                      <div className="flex justify-between py-1"><span>IVA ({settings.iva_tasa ?? 8}%)</span><span>{money(ticket.iva_total)}</span></div>
                    )}
                    {ticket.descuento_total > 0 && (
                      <div className="flex justify-between py-1"><span>Descuento</span><span>-{money(ticket.descuento_total)}</span></div>
                    )}
                    <div className="flex justify-between py-1" style={{ fontWeight: 700, fontSize: "12pt", color: "#CD0708", borderTop: "2px solid #CD0708" }}>
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
            <Button onClick={imprimirTicket} variant="outline" data-testid="ticket-print">
              <Printer className="w-4 h-4 mr-1" /> Imprimir ticket
            </Button>
            <Button onClick={printInvoice} variant="outline" data-testid="invoice-print">
              <Printer className="w-4 h-4 mr-1" /> Imprimir {ticket?.tipo_venta === "cotizacion" ? "cotización" : "factura"}
            </Button>
            <Button onClick={() => setTicket(null)} className="bg-brand-600 hover:bg-brand-700" data-testid="ticket-nueva">Nueva venta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* COTIZACION generada: PDF carta con Descargar/Enviar (sin ticket termico) */}
      <Dialog open={!!cotizacion} onOpenChange={(o) => { if (!o) setCotizacion(null); }}>
        <DialogContent className="max-w-md" data-testid="cotizacion-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <FileText className="w-5 h-5 text-brand-600" /> Cotización {cotizacion?.folio}
            </DialogTitle>
          </DialogHeader>
          {cotizacion && (
            <div className="space-y-3">
              <div className="rounded-lg bg-brand-50 p-3 text-sm space-y-1">
                <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Cliente</span><b className="truncate">{cotizacion.cliente_nombre || "Público General"}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Emisión</span><b>{fmtFecha(cotizacion.fecha)}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Vence (auto: emisión + 2 días)</span><b>{cotizacion.fecha_vencimiento ? fmtFecha(String(cotizacion.fecha_vencimiento).slice(0, 10)) : "—"}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Partidas</span><b>{(cotizacion.items || []).length}</b></div>
                <div className="flex justify-between border-t border-brand-100 pt-1">
                  <span className="font-bold text-brand-600">TOTAL (IVA incluido)</span>
                  <span className="font-display font-black text-brand-600">{money(cotizacion.total)}</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Las cotizaciones no imprimen ticket térmico. Se genera un PDF tamaño carta:
                hoja 1 la cotización y hoja 2 las cuentas bancarias para pago (si existen).
              </p>
              <Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)}
                     placeholder="Teléfono WhatsApp (10 dígitos)" data-testid="cot-wa-phone" />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={cotDescargar} disabled={!!cotBusy} data-testid="cot-descargar">
                  {cotBusy === "pdf" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />} Descargar
                </Button>
                <Button onClick={cotEnviarWhatsApp} disabled={!!cotBusy}
                        className="bg-[#25D366] hover:bg-[#1ebe57] text-white" data-testid="cot-enviar">
                  {cotBusy === "wa" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <SendIcon className="w-4 h-4 mr-1" />} Enviar
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCotizacion(null)} data-testid="cot-nueva">Nueva venta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Abono directo a crédito del cliente desde el POS */}
      <Dialog open={!!abonoCli} onOpenChange={(o) => !o && setAbonoCli(null)}>
        <DialogContent data-testid="pos-abono-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><HandCoins className="w-5 h-5 text-brand-600" /> Abonar a cuenta · {abonoCli?.nombre}</DialogTitle></DialogHeader>
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
            <Button onClick={guardarAbono} disabled={abonoSaving} className="bg-brand-600 hover:bg-brand-700" data-testid="pos-abono-guardar">{abonoSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Registrar abono"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comprobante de abono desde el POS */}
      <Dialog open={!!posComp} onOpenChange={(o) => !o && setPosComp(null)}>
        <DialogContent className="max-w-md" data-testid="pos-comprobante-abono-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><HandCoins className="w-5 h-5 text-brand-600" /> Abono registrado correctamente</DialogTitle></DialogHeader>
          {posComp && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#D9DADD] overflow-hidden" data-testid="pos-comprobante-abono-cuerpo">
                <div className="flex items-center gap-3 px-4 py-3 border-b-4 border-brand-600">
                  <img src={settings.logo_url ? fileUrl(settings.logo_url) : "/brand/isotipo1.png"} alt="logo" className="h-12 w-12 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  <div className="flex-1">
                    <div className="font-display font-extrabold text-brand-600 leading-none">{settings.empresa_nombre || "Grupo RYSA"}</div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mt-0.5">Comprobante de Abono</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-display font-black text-brand-600">{posComp.abono.folio}</div>
                    <div className="text-[11px] text-slate-500">{fmtFechaHora(posComp.abono.fecha || new Date().toISOString())}</div>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="text-sm"><span className="text-slate-400 text-xs">Cliente:</span> <b>{posComp.abono.cliente_nombre || posComp.cliente?.nombre}</b></div>
                  <div className="rounded-lg bg-brand-50 p-3 space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Saldo anterior</span><span className="font-semibold">{money(posComp.abono.saldo_anterior)}</span></div>
                    <div className="flex justify-between text-base font-bold text-brand-600 border-t border-brand-100 pt-2"><span>ABONO</span><span>{money(posComp.abono.monto)}</span></div>
                    <div className="flex justify-between text-base font-black border-t-2 border-brand-600 pt-2"><span>SALDO RESTANTE</span><span>{money(posComp.abono.saldo_restante)}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div><span className="text-slate-400">Método:</span> <span className="capitalize font-medium text-slate-700">{posComp.abono.metodo}</span></div>
                    {posComp.abono.referencia && <div><span className="text-slate-400">Referencia:</span> <span className="font-medium text-slate-700">{posComp.abono.referencia}</span></div>}
                    {posComp.abono.usuario_nombre && <div><span className="text-slate-400">Usuario:</span> <span className="font-medium text-slate-700">{posComp.abono.usuario_nombre}</span></div>}
                  </div>
                  <div className="text-center font-bold text-brand-600 pt-1">¡GRACIAS POR SU PAGO!</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button size="sm" variant="outline" onClick={() => posDescargarComp(posComp.abono)} disabled={posCompBusy} data-testid="pos-abono-descargar-pdf">
                  {posCompBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />} PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => posCompartirComp(posComp.abono)} disabled={posCompBusy} data-testid="pos-abono-compartir"><Share2 className="w-4 h-4 mr-1" /> Compartir</Button>
                <Button size="sm" className="bg-[#25D366] hover:bg-[#1ebe57]" onClick={() => posEnviarCompWhatsApp(posComp.abono)} disabled={posCompBusy} data-testid="pos-abono-whatsapp">
                  <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" className="w-full" onClick={() => setPosComp(null)}>Cerrar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Área de resumen + COBRAR sticky: SIEMPRE visible sin importar el scroll.
          Estructural: fija al fondo del viewport, con estados claro/deshabilitado/carga.
          El contenedor padre reserva el espacio con pb-28 para no ocultar contenido. */}
      {/* Empieza donde termina el menú lateral (ErpLayout publica --sidebar-w):
          antes cubría el menú y su botón para contraerlo. */}
      <div className="fixed bottom-0 right-0 left-[var(--sidebar-w,0px)] z-40 border-t border-slate-200 bg-white/95 backdrop-blur shadow-[0_-2px_14px_rgba(0,0,0,0.08)]" data-testid="pos-cobrar-bar">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-3 flex items-center gap-5 sm:gap-8 flex-wrap">
          {/* Resumen */}
          <div className="flex items-center gap-5 sm:gap-8 min-w-0 flex-1 flex-wrap" data-testid="pos-resumen">
            <div className="hidden sm:block">
              <div className="text-base uppercase tracking-wide text-slate-600 font-semibold">Subtotal</div>
              <div className="text-xl font-bold text-slate-800 leading-tight tabular-nums">{money(totals.subtotal)}</div>
            </div>
            <div className="hidden sm:block">
              <div className="text-base uppercase tracking-wide text-slate-600 font-semibold">IVA {settings.iva_tasa ?? 8}%</div>
              <div className="text-xl font-bold text-slate-800 leading-tight tabular-nums">{money(totals.iva)}</div>
            </div>
            <div>
              <div className="text-base uppercase tracking-wide text-slate-600 font-semibold">Descuento</div>
              <div className="text-xl font-bold text-brand-600 leading-tight tabular-nums">{(totals.descGlobalAmount + totals.descPctAmount) > 0 ? `−${money(totals.descGlobalAmount + totals.descPctAmount)}` : "—"}</div>
            </div>
            <div>
              <div className="text-base uppercase tracking-wide text-slate-600 font-semibold">Total</div>
              <div className="font-display font-black text-3xl text-brand-600 leading-none tabular-nums" data-testid="pos-total">{money(totals.total)}</div>
            </div>
          </div>

          {/* Acciones: suspender + COBRAR siempre accesibles */}
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" className="h-16 w-16" onClick={suspender} title="Suspender venta" data-testid="pos-suspend"><PauseCircle className="w-7 h-7" /></Button>
            <Button
              className="h-16 px-10 sm:px-20 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-lg sm:text-xl font-bold rounded-xl shadow-lg shadow-brand-600/25 transition-all active:scale-[0.98]"
              onClick={openPay} disabled={creditoBloqueado || cart.length === 0} data-testid="pos-cobrar">
              {tipoVenta === "cotizacion"
                ? <><FileText className="w-7 h-7 mr-2" /> Guardar cotización</>
                : <><HandCoins className="w-7 h-7 mr-2" /> COBRAR · {money(totals.total)}</>}
              <kbd className="ml-4 hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-white/20 text-sm font-bold border border-white/40" title="Atajo de teclado: Ctrl + Enter">Ctrl <span>+</span> Enter ↵</kbd>
            </Button>
          </div>
        </div>
      </div>
      {/* §3.7 Aviso de venta directa desde campo (vendedor_campo) */}
      <Dialog open={avisoCampoOpen} onOpenChange={setAvisoCampoOpen}>
        <DialogContent data-testid="aviso-venta-campo">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Venta directa desde campo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Estás realizando una <b>venta directa desde este dispositivo</b>. El inventario se
            descuenta al instante, a diferencia de un pedido normal que pasa por revisión.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvisoCampoOpen(false)}>Cancelar</Button>
            <Button className="bg-brand-600 hover:bg-brand-700" onClick={() => { setAvisoCampoOk(true); setAvisoCampoOpen(false); }} data-testid="aviso-venta-campo-confirmar">
              Entendido, vender ahora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CajaAperturaModal
        open={cajaModalOpen}
        onOpenChange={setCajaModalOpen}
        onAbierta={() => loadCaja()}
      />
    </div>
  );
}

