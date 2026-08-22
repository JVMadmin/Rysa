import { useEffect, useMemo, useState, useRef } from "react";
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
import { Loader2, Plus, Search, ShoppingBag, ReceiptText, Wallet, Clock, FileCheck, Trash2, Eye, Ban, CheckCircle2, Boxes, ScanLine, UploadCloud, X, UserPlus, PackagePlus, Camera, ClipboardList, PackageCheck, Repeat, PieChart, BarChart3, Send, CircleDollarSign, ArrowRight } from "lucide-react";

const METODOS_PAGO = [
  ["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"],
  ["deposito", "Depósito"], ["credito", "Crédito"], ["otros", "Otros"],
];
const CATEGORIAS = ["Renta", "Luz", "Internet", "Gasolina", "Mantenimiento", "Papelería", "Servicios", "Publicidad", "Transporte", "Honorarios", "Otros"];

const prodBlank = () => ({ descripcion: "", codigo: "", categoria: "", costo: "0", iva_tasa: "16", unidad_medida: "PZA", existencia: "0" });

const ResumenReportes = ({ f }) => {
  const [rep, setRep] = useState(null);
  const [repLoading, setRepLoading] = useState(true);
  useEffect(() => {
    setRepLoading(true);
    const params = {};
    if (f.desde) params.desde = f.desde;
    if (f.hasta) params.hasta = f.hasta;
    if (f.tipo && f.tipo !== "todos") params.tipo = f.tipo;
    if (f.proveedor && f.proveedor !== "__all") params.proveedor = f.proveedor;
    api.get("/compras/reportes", { params }).then((r) => setRep(r.data)).catch(() => setRep(null)).finally(() => setRepLoading(false));
  }, [f.desde, f.hasta, f.tipo, f.proveedor]);
  if (repLoading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#C1401E]" /></div>;
  if (!rep) return <div className="card-soft p-10 text-center text-slate-400">No se pudo cargar el reporte.</div>;
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-500 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-[#C1401E]" /> Reporte de compras y gastos · {rep.registros} registros · {rep.desde || "inicio"} a {rep.hasta || "hoy"}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card-soft p-4"><div className="text-xs uppercase tracking-wider text-slate-400">Compras del periodo</div><div className="font-display font-black text-xl text-blue-700 mt-1">{money(rep.compras_periodo)}</div></div>
        <div className="card-soft p-4"><div className="text-xs uppercase tracking-wider text-slate-400">Gastos del periodo</div><div className="font-display font-black text-xl text-amber-700 mt-1">{money(rep.gastos_periodo)}</div></div>
        <div className="card-soft p-4"><div className="text-xs uppercase tracking-wider text-slate-400">Total</div><div className="font-display font-black text-xl mt-1">{money(rep.total_periodo)}</div></div>
        <div className="card-soft p-4"><div className="text-xs uppercase tracking-wider text-slate-400">CxP saldo / vencidas</div><div className="font-display font-black text-xl text-red-600 mt-1">{money(rep.cxp_saldo)} <span className="text-xs font-semibold text-slate-400">/ {money(rep.vencidas_total)}</span></div></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-soft p-4">
          <h3 className="font-display text-sm font-bold mb-2">Por proveedor</h3>
          <div className="space-y-1">
            {(rep.por_proveedor || []).map(([p, m]) => (
              <div key={p} className="flex justify-between text-sm border-b border-slate-50 py-1"><span className="truncate pr-2">{p}</span><span className="font-semibold whitespace-nowrap">{money(m)}</span></div>
            ))}
          </div>
        </div>
        <div className="card-soft p-4">
          <h3 className="font-display text-sm font-bold mb-2">Gastos por categoría</h3>
          <div className="space-y-1">
            {(rep.gastos_por_categoria || []).map(([c, m]) => (
              <div key={c} className="flex justify-between text-sm border-b border-slate-50 py-1"><span className="truncate pr-2">{c}</span><span className="font-semibold whitespace-nowrap">{money(m)}</span></div>
            ))}
          </div>
        </div>
      </div>
      <div className="card-soft p-4">
        <h3 className="font-display text-sm font-bold mb-2">Productos comprados</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2 text-right">Cantidad</th><th className="p-2 text-right">Costo total</th>
            </tr></thead>
            <tbody>
              {(rep.por_producto || []).map((r) => (
                <tr key={r.product_id || r.codigo} className="border-t border-slate-100">
                  <td className="p-2 font-mono text-[10px]">{r.codigo}</td>
                  <td className="p-2">{r.descripcion}</td>
                  <td className="p-2 text-right">{r.cantidad}</td>
                  <td className="p-2 text-right font-semibold">{money(r.costo_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const Card = ({ label, value, icon: Ic, iconCls = "text-slate-500", valueCls = "text-slate-700", testid }) => (
  <div className="card-soft p-4" data-testid={testid}>
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <Ic className={`w-4 h-4 ${iconCls}`} />
    </div>
    <div className={`font-display font-black text-2xl mt-1 ${valueCls}`}>{value}</div>
  </div>
);

const TIPO = { compra: ["Compra", "bg-blue-100 text-blue-700"], gasto: ["Gasto", "bg-amber-100 text-amber-700"], mixto: ["Mixta", "bg-purple-100 text-purple-700"] };
const ESTADO = { confirmada: ["Confirmada", "bg-green-100 text-green-700"], cancelada: ["Cancelada", "bg-red-100 text-red-700"] };

export default function Compras() {
  const { can } = useAuth();
  const [docs, setDocs] = useState([]);
  const [resumen, setResumen] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [proveedores, setProveedores] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [productos, setProductos] = useState([]);

  // Filtros
  const [f, setF] = useState({ desde: "", hasta: "", tipo: "todos", proveedor: "__all", categoria: "todos", estado: "todos", pagada: "todos", q: "" });

  // Alta
  const [open, setOpen] = useState(false);
  const blank = () => ({
    tipo: "compra", proveedor_id: "", factura_numero: "", fecha_recepcion: new Date().toISOString().slice(0, 10),
    fecha_factura: new Date().toISOString().slice(0, 10), fecha_vencimiento: "", concepto: "", categoria: "",
    subtotal: "0", descuento: "0", iva: "0", otros_impuestos: "0", total: "0", iva_tasa: "8",
    metodo_pago: "efectivo", forma_pago: "contado", cuenta_bancaria_id: "", observaciones: "",
    items: [], documentos: [],
  });
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  // Detalle
  const [det, setDet] = useState(null);

  // Factura / OCR
  const [facturaFile, setFacturaFile] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [ocrInfo, setOcrInfo] = useState(null);
  const [ocrProveedor, setOcrProveedor] = useState(null);

  // Proveedor nuevo inline (desde la ventana de compra)
  const [provOpen, setProvOpen] = useState(false);
  const [provForm, setProvForm] = useState({ nombre: "", rfc: "", telefono: "", email: "" });
  const [provSaving, setProvSaving] = useState(false);

  // Producto nuevo inline (desde la ventana de compra)
  const [prodOpen, setProdOpen] = useState(false);
  const [prodForm, setProdForm] = useState(prodBlank());
  const [prodSaving, setProdSaving] = useState(false);

  // ---- Navegación por tabs ----
  const [tab, setTab] = useState("compras");

  // Órdenes de compra
  const [ordenes, setOrdenes] = useState([]);
  const [ordLoading, setOrdLoading] = useState(false);
  const [ordOpen, setOrdOpen] = useState(false);
  const [ordSaving, setOrdSaving] = useState(false);
  const ordBlank = () => ({ proveedor_id: "", fecha_orden: new Date().toISOString().slice(0, 10), fecha_estimada: "", notas: "", items: [] });
  const [ordForm, setOrdForm] = useState(ordBlank());
  const [ordItemSearch, setOrdItemSearch] = useState("");

  // Recepciones
  const [recepciones, setRecepciones] = useState([]);
  const [rcpLoading, setRcpLoading] = useState(false);
  const [rcpOpen, setRcpOpen] = useState(false);
  const [rcpSaving, setRcpSaving] = useState(false);
  const [rcpOrden, setRcpOrden] = useState(null);
  const [rcpCant, setRcpCant] = useState({});
  const [rcpFactura, setRcpFactura] = useState("");
  const [rcpMetodo, setRcpMetodo] = useState("efectivo");
  const [rcpVencimiento, setRcpVencimiento] = useState("");

  // Recurrentes
  const [recurrentes, setRecurrentes] = useState([]);
  const [recOpen, setRecOpen] = useState(false);
  const [recSaving, setRecSaving] = useState(false);
  const recBlank = () => ({ tipo: "gasto", proveedor_id: "", concepto: "", categoria: "", importe: "", frecuencia: "mensual", dia: 1, cuenta_bancaria_id: "", recordatorio: true, activo: true });
  const [recForm, setRecForm] = useState(recBlank());

  // Presupuestos
  const [presupuestos, setPresupuestos] = useState([]);
  const [presOpen, setPresOpen] = useState(false);
  const [presSaving, setPresSaving] = useState(false);
  const presBlank = () => ({ categoria: "", periodo: new Date().toISOString().slice(0, 7), monto: "", notas: "" });
  const [presForm, setPresForm] = useState(presBlank());

  // Centros de costo
  const [centros, setCentros] = useState([]);

  const loadCentros = async () => { try { const { data } = await api.get("/centros-costo"); setCentros(Array.isArray(data) ? data : []); } catch { setCentros([]); } };
  const loadOrdenes = async () => { setOrdLoading(true); try { const { data } = await api.get("/compras/ordenes"); setOrdenes(Array.isArray(data) ? data : []); } finally { setOrdLoading(false); } };
  const loadRecepciones = async () => { setRcpLoading(true); try { const { data } = await api.get("/compras/recepciones"); setRecepciones(Array.isArray(data) ? data : []); } finally { setRcpLoading(false); } };
  const loadRecurrentes = async () => { try { const { data } = await api.get("/recurrentes"); setRecurrentes(Array.isArray(data) ? data : []); } catch { setRecurrentes([]); } };
  const loadPresupuestos = async () => { try { const { data } = await api.get("/presupuestos"); setPresupuestos(Array.isArray(data) ? data : []); } catch { setPresupuestos([]); } };

  const loadProveedores = async () => { const { data } = await api.get("/proveedores"); setProveedores(data); };
  const loadCuentas = async () => { try { const { data } = await api.get("/cuentas-bancarias"); setCuentas(data); } catch { setCuentas([]); } };
  const loadProductos = async () => { try { const { data } = await api.get("/products", { params: { limit: 5000 } }); const arr = Array.isArray(data) ? data : (data.items || data.products || []); setProductos(arr); } catch { setProductos([]); } };
  useEffect(() => { loadProveedores(); loadCuentas(); loadProductos(); /* eslint-disable-next-line */ }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    const params = {};
    if (f.desde) params.desde = f.desde;
    if (f.hasta) params.hasta = f.hasta;
    if (f.tipo !== "todos") params.tipo = f.tipo;
    if (f.proveedor && f.proveedor !== "__all") params.proveedor = f.proveedor;
    if (f.categoria !== "todos") params.categoria = f.categoria;
    if (f.estado !== "todos") params.estado = f.estado;
    if (f.pagada !== "todos") params.pagada = f.pagada;
    if (f.q) params.q = f.q;
    try {
      const [r1, r2] = await Promise.all([api.get("/compras", { params }), api.get("/compras/resumen", { params: { desde: f.desde, hasta: f.hasta } })]);
      setDocs(Array.isArray(r1.data) ? r1.data : []);
      setResumen(r2.data || {});
    } catch (e) {
      setDocs([]);
      setResumen({});
      setError(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [f.desde, f.hasta, f.tipo, f.proveedor, f.categoria, f.estado, f.pagada]);

  const buscar = () => load();
  const limpiar = () => setF({ desde: "", hasta: "", tipo: "todos", proveedor: "__all", categoria: "todos", estado: "todos", pagada: "todos", q: "" });

  // ---- Items de compra ----
  const addItem = (p) => {
    const existe = form.items.find((i) => i.product_id === p.id);
    if (existe) {
      setForm((s) => ({ ...s, items: s.items.map((i) => i.product_id === p.id ? { ...i, cantidad: String(Number(i.cantidad) + 1) } : i) }));
      return;
    }
    setForm((s) => ({ ...s, items: [...s.items, {
      product_id: p.id, codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad || "PZA",
      cantidad: "1", costo: String(p.costo || p.ultimo_costo || 0), iva_tasa: String(p.iva_tasa ?? 8),
      descuento: "0", afecta_inventario: true, importe: "",
    }] }));
  };
  const upItem = (idx, key, val) => {
    setForm((s) => {
      const items = s.items.map((i, k) => k === idx ? { ...i, [key]: val } : i);
      return { ...s, items };
    });
  };
  const delItem = (idx) => setForm((s) => ({ ...s, items: s.items.filter((_, k) => k !== idx) }));

  const recalc = () => {
    setForm((s) => {
      let subtotal = 0, desc = 0;
      s.items.forEach((i) => {
        const imp = Number(i.cantidad) * Number(i.costo) - Number(i.descuento || 0);
        subtotal += imp; desc += Number(i.descuento || 0);
      });
      const iva = subtotal * (Number(s.iva_tasa ?? 8) / 100);
      const totalGlobal = subtotal + iva + Number(s.otros_impuestos || 0);
      return { ...s, subtotal: subtotal.toFixed(2), iva: iva.toFixed(2), total: totalGlobal.toFixed(2), descuento: desc.toFixed(2), items: s.items.map((i) => ({ ...i, importe: String((Number(i.cantidad) * Number(i.costo) - Number(i.descuento || 0)).toFixed(2)) })) };
    });
  };

  const guardar = async () => {
    if (form.items.length === 0) return toast.error("Agrega al menos un concepto");
    if (!form.proveedor_id && form.tipo != null && form.tipo !== "gasto") return toast.error("Selecciona un proveedor");
    setSaving(true);
    try {
      const prov = proveedores.find((p) => p.id === form.proveedor_id);
      const payload = {
        tipo: form.items.some((i) => i.afecta_inventario) ? (form.items.every((i) => i.afecta_inventario) && form.tipo !== "mixto" ? "compra" : "mixto") : "gasto",
        proveedor_id: form.proveedor_id || null,
        proveedor_nombre: prov?.nombre || "",
        factura_numero: form.factura_numero, fecha_factura: form.fecha_factura,
        fecha_recepcion: form.fecha_recepcion, fecha_vencimiento: form.fecha_vencimiento,
        concepto: form.concepto, categoria: form.categoria === "__sin" ? "" : form.categoria,
        subtotal: Number(form.subtotal), descuento: Number(form.descuento),
        iva: Number(form.iva), otros_impuestos: Number(form.otros_impuestos), total: Number(form.total),
        metodo_pago: form.metodo_pago, forma_pago: form.forma_pago,
        cuenta_bancaria_id: form.cuenta_bancaria_id === "__none" ? null : (form.cuenta_bancaria_id || null), observaciones: form.observaciones,
        items: form.items.map((i) => ({ product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, cantidad: Number(i.cantidad), costo: Number(i.costo), iva_tasa: Number(i.iva_tasa || 0), descuento: Number(i.descuento || 0), afecta_inventario: i.afecta_inventario, importe: Number(i.importe || 0) })),
        documentos: (form.documentos || []).map((d) => ({ name: d.name, url: d.url })),
      };
      const { data } = await api.post("/compras", payload);
      toast.success(`Compra ${data.folio} registrada${data.items.some((i) => i.afecta_inventario) ? " · inventario actualizado" : ""}`);
      setOpen(false); setForm(blank()); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const cancelar = async (c) => {
    const mot = window.prompt("Motivo de cancelación:", "Cancelación manual");
    if (mot === null) return;
    setLoading(true);
    try { await api.post(`/compras/${c.id}/cancelar`, null, { params: { motivo: mot } }); toast.success("Compra cancelada"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); setLoading(false); }
  };

  // ---- Factura: adjuntar documento y/o leer con OCR ----
  const adjuntarFactura = async () => {
    if (!facturaFile) return;
    if (form.documentos.some((d) => d.name === facturaFile.name)) return toast.info("La factura ya está adjuntada");
    setDocBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", facturaFile);
      const { data } = await api.post("/uploads/document", fd);
      setForm((s) => ({ ...s, documentos: [...(s.documentos || []), { name: data.filename || facturaFile.name, url: data.url }] }));
      toast.success("Factura adjuntada");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setDocBusy(false); }
  };

  const quitarDocumento = (url) => setForm((s) => ({ ...s, documentos: (s.documentos || []).filter((d) => d.url !== url) }));

  const leerFactura = async () => {
    if (!facturaFile) return toast.error("Selecciona una foto o PDF de la factura");
    setOcrBusy(true); setOcrError(""); setOcrInfo(null); setOcrProveedor(null);
    try {
      const fd = new FormData();
      fd.append("file", facturaFile);
      const { data } = await api.post("/compras/ocr", fd);
      setOcrInfo(data);

      // Adjuntar el documento de la factura leída (si aún no está).
      if (!form.documentos.some((d) => d.name === facturaFile.name)) {
        try {
          const f2 = new FormData();
          f2.append("file", facturaFile);
          const { data: doc } = await api.post("/uploads/document", f2);
          setForm((s) => ({ ...s, documentos: [...(s.documentos || []), { name: doc.filename || facturaFile.name, url: doc.url }] }));
        } catch {}
      }

      // Aplicar datos detectados al formulario.
      setForm((s) => ({
        ...s,
        factura_numero: data.factura_numero || s.factura_numero,
        fecha_factura: data.fecha || s.fecha_factura,
        concepto: s.concepto || (data.proveedor_nombre ? `Compra a ${data.proveedor_nombre}` : s.concepto),
        subtotal: data.subtotal != null ? String(data.subtotal) : s.subtotal,
        iva: data.iva != null ? String(data.iva) : s.iva,
        total: data.total != null ? String(data.total) : s.total,
        items: data.items && data.items.length ? data.items.map((it) => ({
          product_id: it.product_id || null, codigo: it.codigo || "", descripcion: it.descripcion || "",
          unidad: it.unidad || "PZA", cantidad: String(it.cantidad ?? 1), costo: String(it.costo ?? 0),
          iva_tasa: String(it.iva_tasa ?? 8), descuento: "0",
          afecta_inventario: !!(it.matched && it.product_id), importe: String(it.importe ?? 0),
        })) : s.items,
      }));

      // Proveedor: buscar coincidencia por nombre o RFC; si no existe, proponer crearlo.
      if (data.proveedor_nombre || data.rfc) {
        const lowerN = (data.proveedor_nombre || "").toLowerCase();
        const lowerR = (data.rfc || "").toLowerCase();
        const found = proveedores.find((p) =>
          (lowerR && p.rfc && String(p.rfc).toLowerCase() === lowerR) ||
          (lowerN && p.nombre && String(p.nombre).toLowerCase() === lowerN)
        );
        if (found) setForm((s) => ({ ...s, proveedor_id: found.id, proveedor_nombre: found.nombre }));
        else setOcrProveedor({ nombre: data.proveedor_nombre || "", rfc: data.rfc || "" });
      }
      toast.success(`Factura leída${data.items ? ` · ${data.items.length} conceptos` : ""}. Revisa y ajusta antes de confirmar.`);
    } catch (e) { setOcrError(formatApiError(e.response?.data?.detail)); }
    finally { setOcrBusy(false); }
  };

  const crearProveedorOcr = async () => {
    if (!ocrProveedor?.nombre) return toast.error("No se pudo detectar el nombre del proveedor");
    setProvSaving(true);
    try {
      const { data } = await api.post("/proveedores", { nombre: ocrProveedor.nombre, rfc: ocrProveedor.rfc || "" });
      await loadProveedores();
      setOcrProveedor(null);
      setForm((s) => ({ ...s, proveedor_id: data.id, proveedor_nombre: data.nombre }));
      toast.success(`Proveedor "${data.nombre}" creado y seleccionado`);
    } catch (e) { setOcrError(formatApiError(e.response?.data?.detail)); }
    finally { setProvSaving(false); }
  };

  // ---- Proveedor nuevo inline ----
  const guardarProveedor = async () => {
    if (!provForm.nombre.trim()) return toast.error("El nombre del proveedor es obligatorio");
    setProvSaving(true);
    try {
      const { data } = await api.post("/proveedores", { ...provForm, nombre: provForm.nombre.trim() });
      await loadProveedores();
      setForm((s) => ({ ...s, proveedor_id: data.id, proveedor_nombre: data.nombre }));
      setProvOpen(false);
      setProvForm({ nombre: "", rfc: "", telefono: "", email: "" });
      toast.success(`Proveedor "${data.nombre}" creado y seleccionado`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setProvSaving(false); }
  };

  // ---- Producto nuevo inline ----
  const guardarProducto = async () => {
    if (!prodForm.descripcion.trim()) return toast.error("La descripción del producto es obligatoria");
    setProdSaving(true);
    try {
      const payload = {
        descripcion: prodForm.descripcion.trim(),
        codigo: prodForm.codigo.trim() || undefined,
        categoria: prodForm.categoria,
        costo: Number(prodForm.costo || 0),
        iva_tasa: Number(prodForm.iva_tasa || 8),
        unidad_medida: prodForm.unidad_medida || "PZA",
        existencia: Number(prodForm.existencia || 0),
        precios: [{ nombre: "Precio 1", utilidad_pct: 30, precio_con_iva: 0 }],
      };
      const { data } = await api.post("/products", payload);
      await loadProductos();
      addItem({ ...data, unidad: data.unidad_medida });
      setProdOpen(false);
      setProdForm(prodBlank());
      toast.success(`Producto "${data.descripcion}" creado y agregado a la compra`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setProdSaving(false); }
  };

  const itemsFiltrados = useMemo(() => {
    const q = itemSearch.toLowerCase().trim();
    if (!q) return productos;
    return productos.filter((p) => `${p.codigo} ${p.sku || ""} ${p.descripcion} ${p.categoria || ""} ${p.linea || ""} ${p.codigo_barras || ""}`.toLowerCase().includes(q)).slice(0, 30);
  }, [productos, itemSearch]);

  useEffect(() => { loadCentros(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (tab === "ordenes") loadOrdenes(); if (tab === "recepciones") { loadRecepciones(); loadOrdenes(); } }, [tab]);
  useEffect(() => { if (tab === "recurrentes") loadRecurrentes(); if (tab === "presupuestos") loadPresupuestos(); if (tab === "gastos") setF((s) => ({ ...s, tipo: "gasto" })); if (tab === "compras") setF((s) => ({ ...s, tipo: s.tipo === "gasto" ? "todos" : s.tipo })); }, [tab]);

  const ordItemsFiltrados = useMemo(() => {
    const q = ordItemSearch.toLowerCase().trim();
    if (!q) return productos;
    return productos.filter((p) => `${p.codigo} ${p.sku || ""} ${p.descripcion} ${p.categoria || ""}`.toLowerCase().includes(q)).slice(0, 20);
  }, [productos, ordItemSearch]);

  // ---- Órdenes de compra ----
  const addOrdItem = (p) => {
    const existe = ordForm.items.find((i) => i.product_id === p.id);
    if (existe) { setOrdForm((s) => ({ ...s, items: s.items.map((i) => i.product_id === p.id ? { ...i, solicitado: String(Number(i.solicitado) + 1) } : i) })); return; }
    setOrdForm((s) => ({ ...s, items: [...s.items, { product_id: p.id, codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad || "PZA", solicitado: "1", costo: String(p.costo || p.ultimo_costo || 0), iva_tasa: String(p.iva_tasa ?? 8) }] }));
  };
  const upOrdItem = (idx, key, val) => setOrdForm((s) => ({ ...s, items: s.items.map((i, k) => k === idx ? { ...i, [key]: val } : i) }));
  const delOrdItem = (idx) => setOrdForm((s) => ({ ...s, items: s.items.filter((_, k) => k !== idx) }));

  const guardarOrden = async () => {
    if (!ordForm.proveedor_id) return toast.error("Selecciona un proveedor");
    if (ordForm.items.length === 0) return toast.error("Agrega al menos un producto");
    setOrdSaving(true);
    try {
      const prov = proveedores.find((p) => p.id === ordForm.proveedor_id);
      await api.post("/compras/ordenes", {
        proveedor_id: ordForm.proveedor_id,
        proveedor_nombre: prov?.nombre || "",
        fecha_orden: ordForm.fecha_orden,
        fecha_estimada: ordForm.fecha_estimada || null,
        notas: ordForm.notas,
        estado: "borrador",
        items: ordForm.items.map((i) => ({ product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, solicitado: Number(i.solicitado), costo: Number(i.costo), iva_tasa: Number(i.iva_tasa || 0) })),
      });
      toast.success("Orden de compra creada");
      setOrdOpen(false); setOrdForm(ordBlank()); loadOrdenes();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setOrdSaving(false); }
  };

  const cambiarOrdenEstado = async (orden, estado) => {
    if (estado === "cancelada" && !window.confirm(`Cancelar la orden ${orden.folio}?`)) return;
    try { await api.post(`/compras/ordenes/${orden.id}/estado`, { estado }); toast.success(`Orden ${orden.folio}: ${estado}`); loadOrdenes(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // ---- Recepciones ----
  const abrirRecepcion = (orden) => {
    setRcpOrden(orden);
    const cant = {};
    (orden.items || []).forEach((i) => { cant[i.product_id || i.codigo] = String(i.pendiente || 0); });
    setRcpCant(cant);
    setRcpFactura(""); setRcpMetodo("efectivo"); setRcpVencimiento("");
    setRcpOpen(true);
  };

  const confirmarRecepcion = async () => {
    if (!rcpOrden) return;
    const items = (rcpOrden.items || []).filter((i) => i.product_id).map((i) => ({
      product_id: i.product_id, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad || "PZA",
      cantidad: Number(rcpCant[i.product_id] || 0) || 0, costo: Number(i.costo || 0), iva_tasa: Number(i.iva_tasa || 8),
    })).filter((i) => i.cantidad > 0);
    if (items.length === 0) return toast.error("Registra al menos una cantidad recibida");
    setRcpSaving(true);
    try {
      await api.post("/compras/recepciones", {
        orden_id: rcpOrden.id, fecha: new Date().toISOString().slice(0, 10),
        factura_numero: rcpFactura, metodo_pago: rcpMetodo,
        forma_pago: rcpMetodo === "credito" ? "credito" : "contado",
        fecha_vencimiento: rcpVencimiento || null,
        items, documentos: [],
      });
      toast.success("Recepción registrada · inventario actualizado");
      setRcpOpen(false); setRcpOrden(null);
      loadRecepciones(); loadOrdenes(); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setRcpSaving(false); }
  };

  // ---- Recurrentes ----
  const guardarRecurrente = async () => {
    if (!recForm.concepto.trim()) return toast.error("El concepto es obligatorio");
    if (!(Number(recForm.importe) > 0)) return toast.error("Ingresa un importe aproximado");
    setRecSaving(true);
    try {
      const prov = proveedores.find((p) => p.id === recForm.proveedor_id);
      await api.post("/recurrentes", {
        tipo: recForm.tipo, proveedor_id: recForm.proveedor_id || null,
        proveedor_nombre: prov?.nombre || "", concepto: recForm.concepto.trim(),
        categoria: recForm.categoria, importe: Number(recForm.importe),
        frecuencia: recForm.frecuencia, dia: Number(recForm.dia || 1),
        cuenta_bancaria_id: recForm.cuenta_bancaria_id === "__none" ? null : (recForm.cuenta_bancaria_id || null),
        recordatorio: recForm.recordatorio, activo: recForm.activo, notas: "",
      });
      toast.success("Operación recurrente guardada");
      setRecOpen(false); setRecForm(recBlank()); loadRecurrentes();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setRecSaving(false); }
  };

  // ---- Presupuestos ----
  const guardarPresupuesto = async () => {
    if (!presForm.categoria) return toast.error("Indica la categoría");
    if (!presForm.periodo) return toast.error("Indica el periodo (YYYY-MM)");
    if (!(Number(presForm.monto) > 0)) return toast.error("Ingresa el monto presupuestado");
    setPresSaving(true);
    try {
      await api.post("/presupuestos", { categoria: presForm.categoria, periodo: presForm.periodo, monto: Number(presForm.monto), notas: presForm.notas });
      toast.success("Presupuesto guardado");
      setPresOpen(false); setPresForm(presBlank()); loadPresupuestos();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setPresSaving(false); }
  };

  const r = resumen || {};

  return (
    <div className="space-y-5" data-testid="compras-page">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight">Compras y Gastos</h1>
        <p className="text-slate-500 text-sm">Compras de mercancía, facturas de proveedores, órdenes, recepciones y gastos operativos</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[["resumen", "Resumen", BarChart3], ["compras", "Compras", ShoppingBag], ["gastos", "Gastos", ReceiptText],
          ["ordenes", "Órdenes", ClipboardList], ["recepciones", "Recepciones", PackageCheck],
          ["recurrentes", "Recurrentes", Repeat], ["presupuestos", "Presupuestos", PieChart],
          ["reportes", "Reportes", BarChart3]].map(([k, l, Ic]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === k ? "bg-[#C1401E] text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"}`}
            data-testid={`compras-tab-${k}`}>
            <Ic className="w-4 h-4" /> {l}
          </button>
        ))}
      </div>

      {tab === "resumen" && (
      <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Compras del periodo" value={money(r.compras_periodo || 0)} icon={ShoppingBag} iconCls="text-blue-500" valueCls="text-blue-700" testid="compras-total" />
        <Card label="Gastos del periodo" value={money(r.gastos_periodo || 0)} icon={ReceiptText} iconCls="text-amber-500" valueCls="text-amber-700" testid="gastos-total" />
        <Card label="Total" value={money(r.total_periodo || 0)} icon={Wallet} iconCls="text-slate-600" valueCls="text-slate-800" testid="compras-total-gral" />
        <Card label="Pendientes (compras)" value={money(r.compras_pendientes || 0)} icon={Clock} iconCls="text-red-500" valueCls="text-red-700" testid="compras-pendientes" />
        <Card label="Pendientes (gastos)" value={money(r.gastos_pendientes || 0)} icon={Clock} iconCls="text-orange-500" valueCls="text-orange-700" testid="gastos-pendientes" />
        <Card label="Facturas" value={r.facturas || 0} icon={FileCheck} iconCls="text-green-500" valueCls="text-green-700" testid="compras-facturas" />
        <Card label="Mejor proveedor" value={r.mejor_proveedor || "—"} icon={Wallet} iconCls="text-purple-500" valueCls="text-sm text-purple-700 truncate" testid="compras-mejor-prov" />
        <Card label="Categoría mayor" value={r.mejor_categoria || "—"} icon={Wallet} iconCls="text-pink-500" valueCls="text-sm text-pink-700 truncate" testid="compras-mejor-cat" />
      </div>
      </>
      )}

      {(tab === "compras" || tab === "gastos") && (
      <>
      <div className="flex flex-wrap gap-2 card-soft p-3 items-end">
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Desde</Label>
          <Input type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} className="h-9" />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Hasta</Label>
          <Input type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} className="h-9" />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Tipo</Label>
          <Select value={f.tipo} onValueChange={(v) => setF((s) => ({ ...s, tipo: v }))}>
            <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="compra">Compras</SelectItem><SelectItem value="gasto">Gastos</SelectItem><SelectItem value="mixto">Mixtas</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Proveedor</Label>
          <Select value={f.proveedor} onValueChange={(v) => setF((s) => ({ ...s, proveedor: v }))}>
            <SelectTrigger className="w-48 h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos</SelectItem>
              {proveedores.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Estado</Label>
          <Select value={f.estado} onValueChange={(v) => setF((s) => ({ ...s, estado: v }))}>
            <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="confirmada">Confirmada</SelectItem><SelectItem value="cancelada">Cancelada</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-slate-400">Pago</Label>
          <Select value={f.pagada} onValueChange={(v) => setF((s) => ({ ...s, pagada: v }))}>
            <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="pagada">Pagada</SelectItem><SelectItem value="pendiente">Pendiente</SelectItem><SelectItem value="vencida">Vencida</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <Label className="text-[10px] uppercase text-slate-400">Buscar</Label>
          <Input value={f.q} onChange={(e) => setF((s) => ({ ...s, q: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Folio, factura, concepto, proveedor..." className="h-9" />
        </div>
        <Button variant="outline" onClick={buscar} className="h-9"><Search className="w-4 h-4" /></Button>
        <Button variant="ghost" onClick={limpiar} className="h-9 text-xs"><span className="underline">Limpiar filtros</span></Button>
        <Button className="h-9 bg-[#C1401E] hover:bg-[#A03316]" onClick={() => { const t = tab === "gastos" ? "gasto" : "compra"; setForm({ ...blank(), tipo: t }); setItemSearch(""); setFacturaFile(null); setOcrInfo(null); setOcrError(""); setOcrProveedor(null); setOpen(true); }} data-testid="nueva-compra">
          <Plus className="w-4 h-4 mr-1" /> {tab === "gastos" ? "Nuevo gasto" : "Nueva compra / gasto"}
        </Button>
      </div>

      <div className="card-soft overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Fecha</th><th className="p-3">Tipo</th><th className="p-3">Folio</th><th className="p-3">Factura</th>
            <th className="p-3">Proveedor</th><th className="p-3">Concepto</th><th className="p-3 text-right">Subtotal</th>
            <th className="p-3 text-right">IVA</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Saldo</th>
            <th className="p-3">Estado</th><th className="p-3">Método</th><th className="p-3">Usuario</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={14} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
            {!loading && error && <tr><td colSpan={14} className="p-10 text-center"><div className="inline-flex items-center gap-2 text-red-600"><CheckCircle2 className="w-8 h-8 text-red-500" /><div className="text-left"><b>Cargando compras…</b><div className="text-sm text-red-500">No se pudo conectar con el módulo de Compras. Verifica que el servidor esté activo y desplegado con el módulo de Compras (endpoint /compras).</div></div></div></td></tr>}
            {!loading && !error && docs.length === 0 && <tr><td colSpan={14} className="p-10 text-center text-slate-400"><CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />Sin movimientos.</td></tr>}
            {!loading && docs.map((c) => {
              const [tl, tc] = TIPO[c.tipo] || ["—", ""];
              const [el, ec] = ESTADO[c.estado] || ["—", ""];
              const afecta = c.items?.some((i) => i.afecta_inventario);
              return (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`compra-row-${c.folio}`}>
                  <td className="p-3 text-slate-500">{(c.fecha_recepcion || "").slice(0, 10)}</td>
                  <td className="p-3"><Badge className={`${tc}`}>{tl}</Badge></td>
                  <td className="p-3 font-medium text-[#C1401E]">{c.folio}</td>
                  <td className="p-3 text-slate-500">{c.factura_numero || "—"}{c.documentos?.length ? ` (${c.documentos.length})` : ""}</td>
                  <td className="p-3">{c.proveedor_nombre || "—"}</td>
                  <td className="p-3 text-slate-600 max-w-[180px] truncate" title={c.concepto}>{c.concepto || "—"}</td>
                  <td className="p-3 text-right">{money(c.subtotal)}</td>
                  <td className="p-3 text-right">{money(c.iva)}</td>
                  <td className="p-3 text-right font-semibold">{money(c.total)}</td>
                  <td className={`p-3 text-right font-semibold ${c.saldo_pendiente > 0 ? "text-red-600" : "text-slate-300"}`}>{money(c.saldo_pendiente)}</td>
                  <td className="p-3"><Badge className={`${ec}`}>{el}</Badge></td>
                  <td className="p-3 capitalize text-slate-500">{c.metodo_pago}</td>
                  <td className="p-3 text-slate-500 text-xs">{c.usuario_nombre}</td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      {afecta && <Badge className="bg-blue-50 text-blue-600"><Boxes className="w-3 h-3 mr-1" />Inv</Badge>}
                      <Button size="sm" variant="outline" onClick={() => setDet(c)}><Eye className="w-4 h-4" /></Button>
                      {c.estado === "confirmada" && can("compra.cancelar") && <Button size="sm" variant="outline" className="text-red-600" onClick={() => cancelar(c)}><Ban className="w-4 h-4" /></Button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}

      {/* ==================== ÓRDENES DE COMPRA ==================== */}
      {tab === "ordenes" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <ClipboardList className="w-4 h-4 text-[#C1401E]" /> Órdenes de compra · estados: borrador → enviada → recibida
            </div>
            <Button className="h-9 bg-[#C1401E] hover:bg-[#A03316]" onClick={() => { setOrdForm(ordBlank()); setOrdItemSearch(""); setOrdOpen(true); }} data-testid="nueva-orden">
              <Plus className="w-4 h-4 mr-1" /> Nueva orden
            </Button>
          </div>
          <div className="card-soft overflow-x-auto">
            {ordLoading ? <div className="flex justify-center py-14"><Loader2 className="w-6 h-6 animate-spin text-[#C1401E]" /></div> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Folio</th><th className="p-3">Proveedor</th><th className="p-3">Fecha</th>
                <th className="p-3">Estado</th><th className="p-3 text-right">Total</th><th className="p-3">Avance</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {ordenes.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">Sin órdenes registradas.</td></tr>}
                {ordenes.map((o) => {
                  const rec = o.items?.reduce((a, i) => a + Number(i.recibido || 0), 0) || 0;
                  const sol = o.items?.reduce((a, i) => a + Number(i.solicitado || 0), 0) || 0;
                  return (
                    <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-3 font-medium text-[#C1401E]">{o.folio}</td>
                      <td className="p-3">{o.proveedor_nombre || "—"}</td>
                      <td className="p-3 text-slate-500">{(o.fecha_orden || "").slice(0, 10)}</td>
                      <td className="p-3"><Badge className={{ borrador: "bg-slate-100 text-slate-600", enviada: "bg-blue-100 text-blue-700", parcialmente_recibida: "bg-amber-100 text-amber-700", recibida: "bg-green-100 text-green-700", cancelada: "bg-red-100 text-red-700" }[o.estado] || "bg-slate-100 text-slate-600"}>{o.estado?.replace("_", " ")}</Badge></td>
                      <td className="p-3 text-right font-semibold">{money(o.total)}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#C1401E]" style={{ width: `${sol ? (rec / sol) * 100 : 0}%` }} /></div>
                          <span className="text-[10px] text-slate-400">{Math.round(sol ? (rec / sol) * 100 : 0)}%</span>
                        </div>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {["enviada", "parcialmente_recibida"].includes(o.estado) && (
                          <Button size="sm" variant="outline" onClick={() => abrirRecepcion(o)} data-testid={`recibir-orden-${o.folio}`}><PackageCheck className="w-3.5 h-3.5 mr-1" /> Recibir</Button>
                        )}
                        {o.estado === "borrador" && <Button size="sm" variant="outline" className="ml-1" onClick={() => cambiarOrdenEstado(o, "enviada")}><Send className="w-3.5 h-3.5 mr-1" /> Enviar</Button>}
                        {["borrador", "enviada", "parcialmente_recibida"].includes(o.estado) && <Button size="sm" variant="ghost" className="text-red-600 ml-1" onClick={() => cambiarOrdenEstado(o, "cancelada")}><Ban className="w-3.5 h-3.5" /></Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        </div>
      )}

      {/* ==================== RECEPCIONES ==================== */}
      {tab === "recepciones" && (
        <div className="space-y-4">
          <div className="text-sm text-slate-500 flex items-center gap-2"><PackageCheck className="w-4 h-4 text-[#C1401E]" /> Recepciones de mercancía · solo la cantidad recibida afecta inventario</div>
          <div className="card-soft overflow-x-auto">
            {rcpLoading ? <div className="flex justify-center py-14"><Loader2 className="w-6 h-6 animate-spin text-[#C1401E]" /></div> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Folio</th><th className="p-3">Orden</th><th className="p-3">Proveedor</th><th className="p-3">Fecha</th><th className="p-3">Factura</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Conceptos</th>
              </tr></thead>
              <tbody>
                {recepciones.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">Sin recepciones registradas.</td></tr>}
                {recepciones.map((rc) => (
                  <tr key={rc.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-3 font-medium text-[#C1401E]">{rc.folio}</td>
                    <td className="p-3">{rc.orden_folio || "—"}</td>
                    <td className="p-3">{rc.proveedor_nombre || "—"}</td>
                    <td className="p-3 text-slate-500">{(rc.fecha || "").slice(0, 10)}</td>
                    <td className="p-3 text-slate-500">{rc.factura_numero || "—"}</td>
                    <td className="p-3 text-right font-semibold">{money(rc.total)}</td>
                    <td className="p-3 text-right">{rc.items?.length || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </div>
      )}

      {/* ==================== RECURRENTES ==================== */}
      {tab === "recurrentes" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-500 flex items-center gap-2"><Repeat className="w-4 h-4 text-[#C1401E]" /> Compras y gastos recurrentes</div>
            <Button className="h-9 bg-[#C1401E] hover:bg-[#A03316]" onClick={() => setRecOpen(true)} data-testid="nuevo-recurrente"><Plus className="w-4 h-4 mr-1" /> Nuevo recurrente</Button>
          </div>
          <div className="card-soft overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Tipo</th><th className="p-3">Concepto</th><th className="p-3">Categoría</th><th className="p-3 text-right">Importe</th><th className="p-3">Frecuencia</th><th className="p-3">Día</th><th className="p-3">Estado</th>
              </tr></thead>
              <tbody>
                {recurrentes.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">Sin operaciones recurrentes.</td></tr>}
                {recurrentes.map((rc) => (
                  <tr key={rc.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-3"><Badge variant="outline">{rc.tipo}</Badge></td>
                    <td className="p-3">{rc.concepto}</td>
                    <td className="p-3 text-slate-500">{rc.categoria || "—"}</td>
                    <td className="p-3 text-right font-semibold">{money(rc.importe)}</td>
                    <td className="p-3 capitalize text-slate-500">{rc.frecuencia}</td>
                    <td className="p-3 text-slate-500">{rc.dia}</td>
                    <td className="p-3"><Badge className={rc.activo ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}>{rc.activo ? "Activo" : "Inactivo"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== PRESUPUESTOS ==================== */}
      {tab === "presupuestos" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-500 flex items-center gap-2"><PieChart className="w-4 h-4 text-[#C1401E]" /> Presupuestos por categoría y periodo</div>
            <Button className="h-9 bg-[#C1401E] hover:bg-[#A03316]" onClick={() => setPresOpen(true)} data-testid="nuevo-presupuesto"><Plus className="w-4 h-4 mr-1" /> Nuevo presupuesto</Button>
          </div>
          <div className="card-soft overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Categoría</th><th className="p-3">Periodo</th><th className="p-3 text-right">Presupuesto</th><th className="p-3 text-right">Gastado</th><th className="p-3 text-right">Disponible</th><th className="p-3">Estado</th>
              </tr></thead>
              <tbody>
                {presupuestos.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">Sin presupuestos definidos.</td></tr>}
                {presupuestos.map((pr) => {
                  const gastado = Number(pr.gastado || 0) || 0;
                  const monto = Number(pr.monto || 0) || 0;
                  const disponible = monto - gastado;
                  const excedido = disponible < 0;
                  return (
                    <tr key={pr.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-3 font-medium uppercase text-slate-700">{pr.categoria || "—"}</td>
                      <td className="p-3 text-slate-500">{pr.periodo}</td>
                      <td className="p-3 text-right font-semibold">{money(monto)}</td>
                      <td className="p-3 text-right text-amber-600">{money(gastado)}</td>
                      <td className={`p-3 text-right font-semibold ${excedido ? "text-red-600" : "text-green-700"}`}>{excedido ? money(disponible) : money(disponible)}</td>
                      <td className="p-3">{excedido ? <Badge className="bg-red-100 text-red-700"><AlertTriangle className="w-3 h-3 mr-1" /> Excedido</Badge> : <Badge className="bg-green-100 text-green-700">OK</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== REPORTES ==================== */}
      {tab === "reportes" && <ResumenReportes f={f} />}

      {/* Detalle */}
      <Dialog open={!!det} onOpenChange={(o) => !o && setDet(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Compra {det?.folio}</DialogTitle></DialogHeader>
          {det && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-slate-400">Proveedor</Label><div className="font-semibold">{det.proveedor_nombre || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Factura</Label><div>{det.factura_numero || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Concepto</Label><div>{det.concepto || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Categoría</Label><div>{det.categoria || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Recepción</Label><div>{(det.fecha_recepcion || "").slice(0, 10)}</div></div>
                <div><Label className="text-xs text-slate-400">Vencimiento</Label><div>{(det.fecha_vencimiento || "").slice(0, 10) || "—"}</div></div>
                <div><Label className="text-xs text-slate-400">Método</Label><div className="capitalize">{det.metodo_pago}</div></div>
                <div><Label className="text-xs text-slate-400">Usuario</Label><div>{det.usuario_nombre}</div></div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                    <th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2 text-right">Cant.</th>
                    <th className="p-2 text-right">Costo</th><th className="p-2 text-right">Importe</th><th className="p-2 text-center">Inv.</th>
                  </tr></thead>
                  <tbody>
                    {det.items.map((i, k) => (
                      <tr key={k} className="border-t border-slate-100">
                        <td className="p-2 font-mono text-[10px]">{i.codigo}</td>
                        <td className="p-2">{i.descripcion}</td>
                        <td className="p-2 text-right">{i.cantidad}</td>
                        <td className="p-2 text-right">{money(i.costo)}</td>
                        <td className="p-2 text-right font-semibold">{money(i.importe || i.cantidad * i.costo)}</td>
                        <td className="p-2 text-center">{i.afecta_inventario ? <Badge className="bg-green-100 text-green-700">✓</Badge> : <Badge className="bg-slate-100 text-slate-500">—</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <div className="w-56 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(det.subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">IVA</span><span>{money(det.iva)}</span></div>
                  <div className="flex justify-between border-t font-bold pt-1"><span>TOTAL</span><span>{money(det.total)}</span></div>
                  {det.saldo_pendiente > 0 && <div className="flex justify-between text-red-600 font-semibold"><span>Saldo</span><span>{money(det.saldo_pendiente)}</span></div>}
                </div>
              </div>
              {det.observaciones && <div><Label className="text-xs text-slate-400">Observaciones</Label><p className="text-slate-600">{det.observaciones}</p></div>}
              <DialogFooter className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={async () => { try { const r = await api.get(`/compras/${det.id}/pdf`, { responseType: "blob" }); const url = window.URL.createObjectURL(r.data); const a = document.createElement("a"); a.href = url; a.download = `compra-${det.folio}.pdf`; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } }} data-testid="compra-pdf">
                  <FileText className="w-4 h-4 mr-1" /> Descargar PDF
                </Button>
                <Button variant="outline" onClick={() => setDet(null)}>Cerrar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Alta de compra / gasto */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="max-w-5xl max-h-[94vh] overflow-y-auto" data-testid="nueva-compra-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Plus className="w-5 h-5 text-[#C1401E]" /> Nueva compra / gasto</DialogTitle></DialogHeader>

          {/* Factura / OCR */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="file" accept=".pdf,image/*,.jpg,.jpeg,.png,.webp" className="h-9 flex-1 min-w-[200px]" onChange={(e) => setFacturaFile(e.target.files?.[0] || null)} data-testid="factura-file" />
              <Button type="button" size="sm" variant="outline" onClick={adjuntarFactura} disabled={!facturaFile || docBusy} className="h-9" data-testid="adjuntar-factura" title="Sube el documento de la factura como evidencia">
                {docBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-1" />} Adjuntar
              </Button>
              <Button type="button" size="sm" className="h-9 bg-[#C1401E] hover:bg-[#A03316]" onClick={leerFactura} disabled={!facturaFile || ocrBusy} data-testid="leer-factura" title="Lee la factura con OCR y precarga los datos">
                {ocrBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4 mr-1" />} Leer con OCR
              </Button>
            </div>
            {form.documentos?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {form.documentos.map((d, k) => (
                  <span key={k} className="inline-flex items-center gap-2 bg-white border rounded-md px-2 py-1 text-xs">
                    <FileCheck className="w-3.5 h-3.5 text-green-600" />
                    <span className="font-mono text-[11px] max-w-[220px] truncate">{d.url ? d.url.split("/").pop() : d.name}</span>
                    <button type="button" onClick={() => quitarDocumento(d.url)}><X className="w-3.5 h-3.5 text-slate-400 hover:text-red-600" /></button>
                  </span>
                ))}
              </div>
            )}
            {ocrBusy && <p className="text-xs text-slate-600 mt-2 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Leyendo factura…</p>}
            {ocrError && <p className="text-xs text-red-600 mt-2">{ocrError}</p>}
            {ocrInfo && !ocrBusy && (
              <div className="mt-2 rounded bg-white border border-slate-200 p-2 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-100 text-green-700"><ScanLine className="w-3 h-3 mr-1" /> Factura leída</Badge>
                  <span className="text-slate-400">Verifica los datos antes de confirmar</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-slate-600">
                  <span><b>RFC:</b> {ocrInfo.rfc || "—"}</span>
                  <span><b>Proveedor:</b> {ocrInfo.proveedor_nombre || "—"}</span>
                  <span><b>Folio:</b> {ocrInfo.factura_numero || "—"}</span>
                  <span><b>Fecha:</b> {ocrInfo.fecha || "—"}</span>
                  <span><b>Subtotal:</b> {money(Number(ocrInfo.subtotal) || 0)}</span>
                  <span><b>IVA:</b> {money(Number(ocrInfo.iva) || 0)}</span>
                  <span><b>Total:</b> {money(Number(ocrInfo.total) || 0)}</span>
                  <span><b>Conceptos:</b> {ocrInfo.items?.length ?? 0}</span>
                </div>
                {ocrProveedor && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                    <span className="text-slate-500">El proveedor no existe en el catálogo:</span>
                    <Badge className="bg-slate-100 text-slate-700">{ocrProveedor.nombre}{ocrProveedor.rfc ? ` · ${ocrProveedor.rfc}` : ""}</Badge>
                    <Button type="button" size="sm" variant="outline" onClick={crearProveedorOcr} disabled={provSaving} className="h-7 text-xs text-[#C1401E]">
                      {provSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <><UserPlus className="w-3 h-3 mr-1" /> Crear proveedor</>}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2 md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-slate-500 flex items-center justify-between">Proveedor <button type="button" onClick={() => setProvOpen(true)} className="inline-flex items-center gap-1 text-[#C1401E] text-[11px] font-semibold uppercase hover:underline"><UserPlus className="w-3.5 h-3.5" /> Nuevo</button></Label>
              <Select value={form.proveedor_id} onValueChange={(v) => setForm((s) => ({ ...s, proveedor_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona proveedor" /></SelectTrigger>
                <SelectContent>
                  {proveedores.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}{p.rfc ? ` · ${p.rfc}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">No. Factura</Label>
              <Input value={form.factura_numero} onChange={(e) => setForm((s) => ({ ...s, factura_numero: e.target.value }))} className="mt-1" placeholder="A12345" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Recepción</Label>
              <Input type="date" value={form.fecha_recepcion} onChange={(e) => setForm((s) => ({ ...s, fecha_recepcion: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Fecha factura</Label>
              <Input type="date" value={form.fecha_factura} onChange={(e) => setForm((s) => ({ ...s, fecha_factura: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Vencimiento</Label>
              <Input type="date" value={form.fecha_vencimiento} onChange={(e) => setForm((s) => ({ ...s, fecha_vencimiento: e.target.value }))} className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-slate-500">Concepto</Label>
              <Input value={form.concepto} onChange={(e) => setForm((s) => ({ ...s, concepto: e.target.value }))} className="mt-1" placeholder="Descripción general" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Categoría (gastos)</Label>
              <Select value={form.categoria} onValueChange={(v) => setForm((s) => ({ ...s, categoria: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sin categoría" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__sin">Sin categoría</SelectItem>
                  {CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Método de pago</Label>
              <Select value={form.metodo_pago} onValueChange={(v) => setForm((s) => ({ ...s, metodo_pago: v, forma_pago: v === "credito" ? "credito" : "contado" }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{METODOS_PAGO.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Cuenta bancaria</Label>
              <Select value={form.cuenta_bancaria_id} onValueChange={(v) => setForm((s) => ({ ...s, cuenta_bancaria_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sin cuenta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sin cuenta</SelectItem>
                  {cuentas.filter((c) => c.activa).map((c) => <SelectItem key={c.id} value={c.id}>{c.banco} · {c.numero_cuenta}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Productos */}
          <div className="mt-4">
            <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1">Agregar producto ✓ Afecta inventario / ☐ Gasto</Label>
            <div className="flex gap-2 items-center">
              <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Buscar producto por código, SKU, nombre, categoría, línea, código de barras..." className="h-9 flex-1" />
              <Button type="button" size="sm" variant="outline" onClick={() => { setProdForm(prodBlank()); setProdOpen(true); }} className="h-9 text-[#C1401E] whitespace-nowrap" title="Crear producto nuevo que no existe en el catálogo"><PackagePlus className="w-4 h-4 mr-1" /> Nuevo producto</Button>
            </div>
            {itemSearch && (
              <div className="border rounded-md mt-1 max-h-40 overflow-y-auto divide-y">
                {itemsFiltrados.length === 0 && <div className="p-2 text-xs text-slate-400">Sin resultados</div>}
                {itemsFiltrados.map((p) => (
                  <button key={p.id} type="button" onClick={() => addItem(p)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-xs">
                    <b className="text-[#C1401E]">{p.codigo}</b>
                    <span className="flex-1 truncate">{p.descripcion}</span>
                    <span className="text-slate-400">Exist: {p.existencia || 0}</span>
                    <span className="text-slate-400">Costo: {money(p.costo || 0)}</span>
                    <Plus className="w-3.5 h-3.5 text-[#C1401E]" />
                  </button>
                ))}
              </div>
            )}

            {form.items.length > 0 && (
              <div className="border rounded-md mt-2 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                    <th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2 text-right w-20">Cant.</th>
                    <th className="p-2 text-right w-24">Costo und.</th><th className="p-2 text-center w-24">✓ Inv.</th>
                    <th className="p-2 text-right w-24">Importe</th><th className="p-2 w-8"></th>
                  </tr></thead>
                  <tbody>
                    {form.items.map((i, k) => (
                      <tr key={k} className="border-t border-slate-100">
                        <td className="p-2 font-mono text-[10px]">{i.codigo}</td>
                        <td className="p-2 max-w-[220px] truncate">{i.descripcion}{!i.product_id && <Badge className="ml-1 bg-amber-100 text-amber-700">Sin producto</Badge>}</td>
                        <td className="p-2"><Input type="number" value={i.cantidad} onChange={(e) => { upItem(k, "cantidad", e.target.value); }} className="h-6 text-right p-1" /></td>
                        <td className="p-2"><Input type="number" value={i.costo} onChange={(e) => { upItem(k, "costo", e.target.value); }} className="h-6 text-right p-1" /></td>
                        <td className="p-2 text-center">
                          <button type="button" onClick={() => upItem(k, "afecta_inventario", !i.afecta_inventario)}
                            className={`px-2 py-1 rounded text-xs font-semibold ${i.afecta_inventario ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                            {i.afecta_inventario ? "✓ Inventario" : "☐ Gasto"}
                          </button>
                        </td>
                        <td className="p-2 text-right font-semibold">{money(Number(i.cantidad) * Number(i.costo) - Number(i.descuento || 0))}</td>
                        <td className="p-2"><button onClick={() => delItem(k)}><Trash2 className="w-4 h-4 text-slate-400 hover:text-red-600" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-2 border-t bg-slate-50 flex justify-end">
                  <Button size="sm" variant="outline" onClick={recalc} type="button">Recalcular totales</Button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mt-3">
            <div><Label className="text-xs text-slate-400">Subtotal</Label><Input value={form.subtotal} readOnly className="mt-1 text-right font-semibold" /></div>
            <div><Label className="text-xs text-slate-400">IVA</Label><Input value={form.iva} readOnly className="mt-1 text-right" /></div>
            <div><Label className="text-xs text-slate-400">Total</Label><Input value={form.total} readOnly className="mt-1 text-right font-bold text-[#C1401E]" /></div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Observaciones</Label>
            <Textarea value={form.observaciones} onChange={(e) => setForm((s) => ({ ...s, observaciones: e.target.value }))} className="mt-1" rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="guardar-compra">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Confirmar y registrar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proveedor nuevo */}
      <Dialog open={provOpen} onOpenChange={(o) => !o && setProvOpen(false)}>
        <DialogContent className="max-w-md" data-testid="nuevo-proveedor-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><UserPlus className="w-5 h-5 text-[#C1401E]" /> Nuevo proveedor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Nombre *</Label>
              <Input value={provForm.nombre} onChange={(e) => setProvForm((s) => ({ ...s, nombre: e.target.value }))} className="mt-1" placeholder="Nombre del proveedor" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">RFC</Label><Input value={provForm.rfc} onChange={(e) => setProvForm((s) => ({ ...s, rfc: e.target.value }))} className="mt-1" placeholder="RFC" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Teléfono</Label><Input value={provForm.telefono} onChange={(e) => setProvForm((s) => ({ ...s, telefono: e.target.value }))} className="mt-1" placeholder="Teléfono" /></div>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Email</Label><Input value={provForm.email} onChange={(e) => setProvForm((s) => ({ ...s, email: e.target.value }))} className="mt-1" placeholder="Email" /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setProvOpen(false)}>Cancelar</Button>
              <Button onClick={guardarProveedor} disabled={provSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="guardar-proveedor">
                {provSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Crear y seleccionar</>}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Producto nuevo */}
      <Dialog open={prodOpen} onOpenChange={(o) => !o && setProdOpen(false)}>
        <DialogContent className="max-w-md" data-testid="nuevo-producto-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><PackagePlus className="w-5 h-5 text-[#C1401E]" /> Nuevo producto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Descripción *</Label>
              <Input value={prodForm.descripcion} onChange={(e) => setProdForm((s) => ({ ...s, descripcion: e.target.value }))} className="mt-1" placeholder="Nombre del producto" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Código / Código de barras</Label><Input value={prodForm.codigo} onChange={(e) => setProdForm((s) => ({ ...s, codigo: e.target.value }))} className="mt-1" placeholder="Código (vacío = automático)" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Categoría</Label><Input value={prodForm.categoria} onChange={(e) => setProdForm((s) => ({ ...s, categoria: e.target.value }))} className="mt-1" placeholder="Categoría" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Costo</Label><Input type="number" value={prodForm.costo} onChange={(e) => setProdForm((s) => ({ ...s, costo: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">IVA %</Label><Input type="number" value={prodForm.iva_tasa} onChange={(e) => setProdForm((s) => ({ ...s, iva_tasa: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Unidad</Label><Input value={prodForm.unidad_medida} onChange={(e) => setProdForm((s) => ({ ...s, unidad_medida: e.target.value }))} className="mt-1" /></div>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Existencia inicial</Label><Input type="number" value={prodForm.existencia} onChange={(e) => setProdForm((s) => ({ ...s, existencia: e.target.value }))} className="mt-1" /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setProdOpen(false)}>Cancelar</Button>
              <Button onClick={guardarProducto} disabled={prodSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="guardar-producto">
                {prodSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Crear y agregar</>}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Nueva orden de compra */}
      <Dialog open={ordOpen} onOpenChange={(o) => !o && setOrdOpen(false)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="nueva-orden-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><ClipboardList className="w-5 h-5 text-[#C1401E]" /> Nueva orden de compra</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs uppercase tracking-wider text-slate-500">Proveedor *</Label>
                <Select value={ordForm.proveedor_id} onValueChange={(v) => setOrdForm((s) => ({ ...s, proveedor_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona proveedor" /></SelectTrigger>
                  <SelectContent>{proveedores.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Fecha orden</Label><Input type="date" value={ordForm.fecha_orden} onChange={(e) => setOrdForm((s) => ({ ...s, fecha_orden: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Fecha estimada</Label><Input type="date" value={ordForm.fecha_estimada} onChange={(e) => setOrdForm((s) => ({ ...s, fecha_estimada: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Notas</Label><Input value={ordForm.notas} onChange={(e) => setOrdForm((s) => ({ ...s, notas: e.target.value }))} className="mt-1" placeholder="Condiciones, instrucciones..." /></div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1">Agregar producto (cantidad solicitada)</Label>
              <Input value={ordItemSearch} onChange={(e) => setOrdItemSearch(e.target.value)} placeholder="Buscar producto por código, nombre, categoría..." className="h-9" />
              {ordItemSearch && (
                <div className="border rounded-md mt-1 max-h-40 overflow-y-auto divide-y">
                  {ordItemsFiltrados.length === 0 && <div className="p-2 text-xs text-slate-400">Sin resultados</div>}
                  {ordItemsFiltrados.map((p) => (
                    <button key={p.id} type="button" onClick={() => addOrdItem(p)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 text-xs">
                      <b className="text-[#C1401E]">{p.codigo}</b><span className="flex-1 truncate">{p.descripcion}</span>
                      <span className="text-slate-400">Costo: {money(p.costo || 0)}</span><Plus className="w-3.5 h-3.5 text-[#C1401E]" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {ordForm.items.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                    <th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2 text-right w-20">Solicitado</th><th className="p-2 text-right w-24">Costo</th><th className="p-2 w-8"></th>
                  </tr></thead>
                  <tbody>{ordForm.items.map((i, k) => (
                    <tr key={k} className="border-t border-slate-100">
                      <td className="p-2 font-mono text-[10px]">{i.codigo}</td>
                      <td className="p-2 max-w-[180px] truncate">{i.descripcion}</td>
                      <td className="p-2"><Input type="number" value={i.solicitado} onChange={(e) => upOrdItem(k, "solicitado", e.target.value)} className="h-6 w-20 text-right p-1" /></td>
                      <td className="p-2"><Input type="number" value={i.costo} onChange={(e) => upOrdItem(k, "costo", e.target.value)} className="h-6 w-20 text-right p-1" /></td>
                      <td className="p-2"><button type="button" onClick={() => delOrdItem(k)}><Trash2 className="w-4 h-4 text-slate-400 hover:text-red-600" /></button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOrdOpen(false)}>Cancelar</Button>
              <Button onClick={guardarOrden} disabled={ordSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="guardar-orden">
                {ordSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Crear orden</>}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recepción de mercancía */}
      <Dialog open={rcpOpen} onOpenChange={(o) => !o && setRcpOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="recepcion-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><PackageCheck className="w-5 h-5 text-[#C1401E]" /> Recepción · {rcpOrden?.folio}</DialogTitle></DialogHeader>
          {rcpOrden && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><Label className="text-xs text-slate-400">Proveedor</Label><div className="font-semibold">{rcpOrden.proveedor_nombre}</div></div>
                <div><Label className="text-xs text-slate-400">Nota</Label><div className="text-xs text-slate-400">Solo la cantidad recibida afectará inventario.</div></div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr className="text-left text-slate-500">
                    <th className="p-2">Producto</th><th className="p-2 text-right">Solicitado</th><th className="p-2 text-right">Recibido</th><th className="p-2 text-right">Pendiente</th><th className="p-2 text-center">Recibir</th>
                  </tr></thead>
                  <tbody>{(rcpOrden.items || []).map((i, k) => {
                    const key = i.product_id || i.codigo;
                    return (
                      <tr key={key} className="border-t border-slate-100">
                        <td className="p-2 max-w-[200px] truncate">{i.descripcion}</td>
                        <td className="p-2 text-right">{i.solicitado}</td>
                        <td className="p-2 text-right text-green-700">{i.recibido}</td>
                        <td className="p-2 text-right text-amber-700">{i.pendiente}</td>
                        <td className="p-2 text-center"><Input type="number" value={rcpCant[key] ?? ""} onChange={(e) => setRcpCant((c) => ({ ...c, [key]: e.target.value }))} className="h-7 w-20 text-right p-1 mx-auto" data-testid={`rcp-cant-${key}`} /></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Factura</Label><Input value={rcpFactura} onChange={(e) => setRcpFactura(e.target.value)} className="mt-1 h-9" placeholder="No. factura" /></div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Vencimiento</Label><Input type="date" value={rcpVencimiento} onChange={(e) => setRcpVencimiento(e.target.value)} className="mt-1 h-9" /></div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Método de pago</Label>
                  <Select value={rcpMetodo} onValueChange={setRcpMetodo}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{METODOS_PAGO.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRcpOpen(false)}>Cancelar</Button>
                <Button onClick={confirmarRecepcion} disabled={rcpSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="confirmar-recepcion">
                  {rcpSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Confirmar recepción</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Operación recurrente */}
      <Dialog open={recOpen} onOpenChange={(o) => !o && setRecOpen(false)}>
        <DialogContent className="max-w-lg" data-testid="nuevo-recurrente-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Repeat className="w-5 h-5 text-[#C1401E]" /> Operación recurrente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Tipo</Label>
                <Select value={recForm.tipo} onValueChange={(v) => setRecForm((s) => ({ ...s, tipo: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="gasto">Gasto</SelectItem><SelectItem value="compra">Compra</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Frecuencia</Label>
                <Select value={recForm.frecuencia} onValueChange={(v) => setRecForm((s) => ({ ...s, frecuencia: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{["semanal", "quincenal", "mensual", "bimestral", "trimestral", "anual"].map((fr) => <SelectItem key={fr} value={fr}>{fr}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Concepto *</Label><Input value={recForm.concepto} onChange={(e) => setRecForm((s) => ({ ...s, concepto: e.target.value }))} className="mt-1" placeholder="Ej. Renta, Internet, Gasolina..." /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Proveedor</Label>
                <Select value={recForm.proveedor_id} onValueChange={(v) => setRecForm((s) => ({ ...s, proveedor_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none">Sin proveedor</SelectItem>{proveedores.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Categoría</Label>
                <Select value={recForm.categoria} onValueChange={(v) => setRecForm((s) => ({ ...s, categoria: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Categoría" /></SelectTrigger>
                  <SelectContent>{CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Importe aproximado *</Label><Input type="number" value={recForm.importe} onChange={(e) => setRecForm((s) => ({ ...s, importe: e.target.value }))} className="mt-1" placeholder="0.00" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Día del periodo</Label><Input type="number" min={1} max={31} value={recForm.dia} onChange={(e) => setRecForm((s) => ({ ...s, dia: e.target.value }))} className="mt-1" /></div>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Cuenta bancaria</Label>
              <Select value={recForm.cuenta_bancaria_id} onValueChange={(v) => setRecForm((s) => ({ ...s, cuenta_bancaria_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sin cuenta" /></SelectTrigger>
                <SelectContent><SelectItem value="__none">Sin cuenta</SelectItem>{cuentas.filter((c) => c.activa).map((c) => <SelectItem key={c.id} value={c.id}>{c.banco} · {c.numero_cuenta}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRecOpen(false)}>Cancelar</Button>
              <Button onClick={guardarRecurrente} disabled={recSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="guardar-recurrente">
                {recSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Guardar</>}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Presupuesto */}
      <Dialog open={presOpen} onOpenChange={(o) => !o && setPresOpen(false)}>
        <DialogContent className="max-w-md" data-testid="nuevo-presupuesto-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><PieChart className="w-5 h-5 text-[#C1401E]" /> Nuevo presupuesto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Categoría *</Label>
              <Select value={presForm.categoria} onValueChange={(v) => setPresForm((s) => ({ ...s, categoria: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona categoría" /></SelectTrigger>
                <SelectContent>{CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Periodo (YYYY-MM) *</Label><Input value={presForm.periodo} onChange={(e) => setPresForm((s) => ({ ...s, periodo: e.target.value }))} className="mt-1" placeholder="2026-08" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Monto presupuestado *</Label><Input type="number" value={presForm.monto} onChange={(e) => setPresForm((s) => ({ ...s, monto: e.target.value }))} className="mt-1" placeholder="0.00" /></div>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Notas</Label><Input value={presForm.notas} onChange={(e) => setPresForm((s) => ({ ...s, notas: e.target.value }))} className="mt-1" /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPresOpen(false)}>Cancelar</Button>
              <Button onClick={guardarPresupuesto} disabled={presSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="guardar-presupuesto">
                {presSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4 mr-1" /> Guardar</>}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
