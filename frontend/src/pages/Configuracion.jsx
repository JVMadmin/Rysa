import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import Usuarios from "@/pages/Usuarios";
import { ImageUpload } from "@/components/ImageUpload";
import { fileUrl, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Building2, MapPin, DollarSign, Store, UserCog, Loader2, Plus, Trash2, Save, Receipt, DatabaseZap, HardDrive, Printer as PrinterIcon, Search, RefreshCw, CheckCircle2, XCircle, Landmark, Star, Pencil, Power, AlertTriangle } from "lucide-react";

export default function Configuracion() {
  const { can } = useAuth();
  const [s, setS] = useState(null);
  const [sErr, setSErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => { api.get("/settings").then((r) => setS({ sucursales: [], listas_precios_nombres: ["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"], listas_precios_pct: [40, 30, 20, 15, 10], logo_url: "", ticket_config: {}, storage: { backend: "local", upload_dir: "" }, printers: { lista: [], predeterminadas: {}, bridge_url: "" }, ...r.data, ticket_config: { tamano: "80mm", mostrar_rfc: true, mostrar_direccion: true, mostrar_telefono: true, encabezado: "", pie: "¡Gracias por su compra!", auto_print: false, ...(r.data?.ticket_config || {}) }, storage: { backend: "local", upload_dir: "", ...(r.data?.storage || {}) }, printers: { lista: [], predeterminadas: {}, bridge_url: "", ...(r.data?.printers || {}) } })).catch((e) => setSErr(formatApiError(e.response?.data?.detail))); }, []);

  const setStorage = (k, v) => setS((x) => ({ ...x, storage: { ...(x.storage || {}), [k]: v } }));

  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const setTc = (k, v) => setS((x) => ({ ...x, ticket_config: { ...(x.ticket_config || {}), [k]: v } }));

  // --- Impresoras (configuración persistente por tipo de documento) ---
  const printers = s?.printers?.lista || [];
  const printerDefaults = s?.printers?.predeterminadas || {};
  const TIPOS_DOC = [
    ["ticket", "Ticket POS"],
    ["factura", "Facturas"],
    ["nota", "Notas de venta"],
    ["reporte", "Reportes"],
    ["admin", "Documentos administrativos"],
  ];
  const setPrinters = (lista) => setS((x) => ({ ...x, printers: { ...(x.printers || {}), lista } }));
  const setPrinterDefaults = (k, v) => setS((x) => ({ ...x, printers: { ...(x.printers || {}), predeterminadas: { ...(x.printers?.predeterminadas || {}), [k]: v } } }));
  const addPrinter = (preset) => setPrinters([...printers, { id: "p" + Date.now().toString(36), nombre: preset?.nombre || "", tipo_conexion: preset?.tipo_conexion || "browser", ip: preset?.ip || "", bridge_url: "", habilitada: true }]);
  const setPrinter = (i, k, v) => setPrinters(printers.map((p, idx) => idx === i ? { ...p, [k]: v } : p));
  const delPrinter = (i) => setPrinters(printers.filter((_, idx) => idx !== i));
  const setBridgeUrl = (v) => setS((x) => ({ ...x, printers: { ...(x.printers || {}), bridge_url: v } }));

  // --- Cuentas bancarias (pagos y cotizaciones) ---
  const [cuentas, setCuentas] = useState([]);
  const ctaBlank = () => ({ banco: "", nombre: "", numero_cuenta: "", clabe: "", titular: "", moneda: "MXN", tipo_cuenta: "debito", activa: true, alias: "", predeterminada: false });
  const [ctaForm, setCtaForm] = useState(ctaBlank());
  const [ctaEditId, setCtaEditId] = useState(null);
  const [ctaSaving, setCtaSaving] = useState(false);
  // Catálogo de bancos con logo (fuente única: /api/catalogo-bancos).
  const [catBancos, setCatBancos] = useState([]);
  useEffect(() => { api.get("/catalogo-bancos").then((r) => setCatBancos(r.data || [])).catch(() => {}); }, []);
  const normTxt = (t) => (t || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const bancoCat = (nombre) => {
    const n = normTxt(nombre);
    if (!n || !catBancos.length) return null;
    for (const b of catBancos) {
      const cands = [b.nombre, ...(b.aliases || [])].map(normTxt);
      if (cands.includes(n)) return b;
    }
    for (const b of catBancos)
      for (const c of [b.nombre, ...(b.aliases || [])]) {
        const cn = normTxt(c);
        if (cn.length >= 5 && n.includes(cn)) return b;
      }
    return null;
  };
  const logoBanco = (nombre) => bancoCat(nombre)?.logo_url || null;
  const loadCuentas = async () => { try { const { data } = await api.get("/cuentas-bancarias"); setCuentas(data); } catch { setCuentas([]); } };
  useEffect(() => { loadCuentas(); /* eslint-disable-next-line */ }, []);
  const guardarCuenta = async () => {
    if (!ctaForm.banco.trim() || !ctaForm.numero_cuenta.trim()) return toast.error("El banco y el número de cuenta son obligatorios");
    setCtaSaving(true);
    try {
      if (ctaEditId) await api.put(`/cuentas-bancarias/${ctaEditId}`, ctaForm);
      else await api.post("/cuentas-bancarias", ctaForm);
      toast.success("Cuenta guardada"); setCtaForm(ctaBlank()); setCtaEditId(null); loadCuentas();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setCtaSaving(false); }
  };
  const toggleCuenta = async (c) => { try { await api.patch(`/cuentas-bancarias/${c.id}/pagar`); loadCuentas(); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } };
  const editarCuenta = (c) => { setCtaForm({ ...ctaBlank(), ...c }); setCtaEditId(c.id); window.scrollTo({ top: 0, behavior: "smooth" }); };

  // Detección honesta de impresoras: API Web de impresión del navegador (si está
  // disponible) y/o puente local de impresión (app empaquetada). Sin inventar.
  const [scanState, setScanState] = useState({ estado: "idle", mensaje: "", resultados: [] });
  const [pruebaState, setPruebaState] = useState({});
  const buscarImpresoras = async () => {
    setScanState({ estado: "buscando", mensaje: "Buscando impresoras…", resultados: [] });
    const bridge = String(s?.printers?.bridge_url || "").trim() || "http://localhost:9731";
    let encontradas = [];
    const manual = [];
    if (navigator.printerList?.getPrinters) {
      try { (await navigator.printerList.getPrinters()).forEach((p) => { manual.push({ id: "web-" + manual.length, nombre: p.name || "Impresora", tipo_conexion: "browser", ip: "", estado: "disponible" }); }); } catch {}
    } else if (navigator.printerList) {
      try { for await (const p of navigator.printerList) manual.push({ id: "web-" + manual.length, nombre: p.name || "Impresora", tipo_conexion: "browser", ip: "", estado: "disponible" }); } catch {}
    }
    encontradas = manual;
    if (encontradas.length === 0) {
      try {
        const ctrl = new AbortController();
        const txx = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch(bridge + "/printers", { signal: ctrl.signal });
        clearTimeout(txx);
        if (r.ok) {
          const data = await r.json();
          const arr = Array.isArray(data) ? data : data.printers || [];
          encontradas = arr.map((p, i) => ({ id: "bridge-" + (p.id || i), nombre: p.nombre || p.name || `Impresora ${i + 1}`, tipo_conexion: p.tipo_conexion || "bridge", ip: p.ip || "", estado: p.estado || "disponible" }));
        }
      } catch {}
    }
    setScanState({
      estado: "hecho",
      mensaje: encontradas.length
        ? `Impresoras encontradas: ${encontradas.length}`
        : "No se encontraron impresoras detectables. Un navegador no tiene acceso directo a impresoras USB/red; para ellas se requiere el puente de impresión local (app empaquetada).",
      resultados: encontradas,
    });
  };

  const probarPrinter = async (p) => {
    setPruebaState((x) => ({ ...x, [p.id]: "probando" }));
    const bridge = String(s?.printers?.bridge_url || "").trim() || "http://localhost:9731";
    try {
      if (p.tipo_conexion === "browser") {
        const win = window.open("", "_blank", "width=520,height=360");
        if (!win) throw new Error("popup bloqueado");
        win.document.write('<html><head><title>Prueba de impresión RYSA</title></head><body style="font-family:sans-serif;font-size:14px;padding:24px"><h2 style="color:#C1401E">Prueba de impresión RYSA</h2><p>Si puedes imprimir esta página, la impresión por navegador funciona correctamente.</p><script>window.print();</' + 'script></body></html>');
        win.document.close();
        setPruebaState((x) => ({ ...x, [p.id]: "ok" }));
        toast.success("Prueba de impresión enviada correctamente.");
      } else {
        const r = await fetch(bridge + "/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printer: p.nombre, ip: p.ip, documento: "prueba", contenido: "Prueba de impresión RYSA" }), signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error("bridge");
        setPruebaState((x) => ({ ...x, [p.id]: "ok" }));
        toast.success("Prueba de impresión enviada correctamente.");
      }
    } catch {
      setPruebaState((x) => ({ ...x, [p.id]: "error" }));
      toast.error("No se pudo imprimir. Verifica que la impresora esté encendida, conectada y disponible.");
    }
  };
  const setLista = (i, v) => setS((x) => ({ ...x, listas_precios_nombres: x.listas_precios_nombres.map((n, idx) => idx === i ? v : n) }));
  const setListaPct = (i, v) => setS((x) => ({ ...x, listas_precios_pct: (x.listas_precios_pct || [40, 30, 20, 15, 10]).map((n, idx) => idx === i ? v : n) }));
  const addLista = () => setS((x) => ({ ...x, listas_precios_nombres: [...(x.listas_precios_nombres || []), `Precio ${(x.listas_precios_nombres || []).length + 1}`], listas_precios_pct: [...(x.listas_precios_pct || [40, 30, 20, 15, 10]), 10] }));
  const delLista = (i) => setS((x) => ({ ...x, listas_precios_nombres: x.listas_precios_nombres.filter((_, idx) => idx !== i), listas_precios_pct: x.listas_precios_pct.filter((_, idx) => idx !== i) }));
  const setSuc = (i, k, v) => setS((x) => ({ ...x, sucursales: x.sucursales.map((su, idx) => idx === i ? { ...su, [k]: v } : su) }));
  const addSuc = () => setS((x) => ({ ...x, sucursales: [...x.sucursales, { nombre: "", direccion: "", ciudad: "", estado: "", cp: "", telefono: "", activa: true }] }));
  const delSuc = (i) => setS((x) => ({ ...x, sucursales: x.sucursales.filter((_, idx) => idx !== i) }));

  // --- Unidades de medida (configurables; se ofrecen en productos) ---
  const UNIDADES_PREDETERMINADAS = ["PZA", "CAJA", "PAQUETE", "BOLSA", "SIX", "CUBETA", "PAR", "JUEGO", "KG", "GR", "LT", "ML", "MT", "ROL", "SERVICIO"];
  const [nuevaUnidad, setNuevaUnidad] = useState("");
  const addUnidad = () => {
    const v = nuevaUnidad.trim().toUpperCase();
    if (!v) return;
    setS((x) => ({ ...x, unidades_medida: [...(x.unidades_medida || []), v] }));
    setNuevaUnidad("");
  };
  const delUnidad = (i) => setS((x) => ({ ...x, unidades_medida: (x.unidades_medida || []).filter((_, idx) => idx !== i) }));
  const restoreUnidades = () => setS((x) => ({ ...x, unidades_medida: [...UNIDADES_PREDETERMINADAS] }));

  // --- Editor por bloques del ticket ---
  const TYPE_LABELS = {
    empresa: "Nombre empresa", campo: "Campo / texto", texto: "Texto libre", separador: "Separador",
    folio: "Folio", fecha: "Fecha", cliente: "Cliente", atendio: "Atendió por",
    items: "Productos", subtotal: "Subtotal", iva: "IVA", total: "Total",
    credito: "Aviso crédito", pie: "Mensaje al pie", pie2: "Mensaje al pie (2)", logo: "Logo", qr: "Código QR",
    encabezado: "Encabezado",
  };
  const elt = s?.ticket_config?.elements || [];
  const setEl = (i, k, v) => setS((x) => ({ ...x, ticket_config: { ...(x.ticket_config || {}), elements: (x.ticket_config?.elements || []).map((e, idx) => idx === i ? { ...e, [k]: v } : e) } }));
  const addEl = (tipo) => setS((x) => ({ ...x, ticket_config: { ...(x.ticket_config || {}), elements: [...(x.ticket_config?.elements || []), { tipo, contenido: tipo === "qr" ? "{verificar}" : "", visible: true, align: "left", bold: false }] } }));
  const moveEl = (i, dir) => setS((x) => { const e = [...(x.ticket_config?.elements || [])]; const j = i + dir; if (j < 0 || j >= e.length) return x; [e[i], e[j]] = [e[j], e[i]]; return { ...x, ticket_config: { ...(x.ticket_config || {}), elements: e } }; });
  const delEl = (i) => setS((x) => ({ ...x, ticket_config: { ...(x.ticket_config || {}), elements: (x.ticket_config?.elements || []).filter((_, idx) => idx !== i) } }));
  const setElements = (v) => setS((x) => ({ ...x, ticket_config: { ...(x.ticket_config || {}), elements: v } }));

  // --- Diseño predeterminado de ticket (plantilla de bloques) ---
  const aplicarDisenoPredeterminado = () => {
    setS((x) => ({
      ...x,
      ticket_config: {
        ...(x.ticket_config || {}), tamano: (x.ticket_config || {}).tamano || "80mm",
        encabezado: (x.ticket_config || {}).encabezado || "",
        pie: (x.ticket_config || {}).pie || "¡Gracias por su compra!",
        mostrar_rfc: true, mostrar_direccion: true, mostrar_telefono: true, mostrar_qr: true,
        elements: [
          { tipo: "logo", align: "center" },
          { tipo: "empresa", align: "center", bold: true, font_size: 11 },
          { tipo: "campo", contenido: "RFC: {empresa}", align: "center" },
          { tipo: "campo", contenido: "{direccion_completa}", align: "center" },
          { tipo: "separador", align: "left" },
          { tipo: "folio", align: "left", bold: true },
          { tipo: "fecha", align: "left" },
          { tipo: "cliente", align: "left" },
          { tipo: "separador", align: "left" },
          { tipo: "deschead", align: "left" },
          { tipo: "items", align: "left" },
          { tipo: "separador", align: "left" },
          { tipo: "subtotal", align: "right" },
          { tipo: "iva", align: "right" },
          { tipo: "total", align: "center", bold: true, font_size: 12 },
          { tipo: "letras", align: "center" },
          { tipo: "recibido", align: "right" },
          { tipo: "cambio", align: "right" },
          { tipo: "articulos", align: "left" },
          { tipo: "atendio", align: "left" },
          { tipo: "separador", align: "left" },
          { tipo: "pie", contenido: "Verifique su compra y cambio", align: "center" },
          { tipo: "pie2", contenido: "¡Gracias por su compra!", align: "center" },
          { tipo: "qr", contenido: "{verificar}", align: "center", qr_size: 18 },
        ],
      },
    }));
    toast.success("Diseño predeterminado aplicado. Revísalo y guarda.");
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...s, iva_tasa: Number(s.iva_tasa) };
      delete payload._id;
      await api.put("/settings", payload);
      toast.success("Configuración guardada");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const descargarExport = async () => {
    setExporting(true);
    try {
      const { data } = await api.get("/datos/export", { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url; a.download = "rysa_export.zip";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success("Respaldo exportado");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setExporting(false); }
  };
  const importarDatos = async () => {
    if (!importFile) return toast.error("Selecciona un ZIP de respaldo");
    if (!window.confirm("Restaurar datos desde respaldo. Esta acción es seria y solo la debe hacer un administrador. ¿Continuar?")) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      await api.post("/datos/import", fd);
      toast.success("Importación completada");
      setImportFile(null);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setImporting(false); }
  };

  if (sErr) return (
    <div className="max-w-lg mx-auto mt-20 text-center space-y-3" data-testid="cfg-error">
      <AlertTriangle className="w-12 h-12 mx-auto text-[#C1401E]" />
      <h1 className="font-display text-xl font-black tracking-tight text-slate-800">No se pudo cargar la Configuración</h1>
      <p className="text-sm text-slate-500">No se pudo conectar con el servidor para leer los ajustes (endpoint /settings). Verifica que el servidor esté activo.</p>
      {sErr && <p className="text-xs text-red-600">{sErr}</p>}
    </div>
  );
  if (!s) return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>;

  const I = (label, k, type = "text") => (
    <div><Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label>
      <Input type={type} value={s[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="mt-1" data-testid={`cfg-${k}`} /></div>
  );

  return (
    <div className="space-y-5" data-testid="configuracion-page">
      <div className="flex items-center justify-between">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Configuración</h1><p className="text-slate-500 text-sm">Datos de la empresa, precios, sucursales y usuarios</p></div>
        <Button onClick={save} disabled={saving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="cfg-save"><Save className="w-4 h-4 mr-1" /> {saving ? "Guardando..." : "Guardar"}</Button>
      </div>

      <Tabs defaultValue="empresa">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="empresa" data-testid="tab-empresa"><Building2 className="w-4 h-4 mr-1" /> Empresa / Ubicación</TabsTrigger>
          <TabsTrigger value="precios" data-testid="tab-precios"><DollarSign className="w-4 h-4 mr-1" /> Precios</TabsTrigger>
          <TabsTrigger value="sucursales" data-testid="tab-sucursales"><Store className="w-4 h-4 mr-1" /> Sucursales</TabsTrigger>
          <TabsTrigger value="cuentas" data-testid="tab-cuentas"><Landmark className="w-4 h-4 mr-1" /> Cuentas bancarias</TabsTrigger>
          <TabsTrigger value="ticket" data-testid="tab-ticket"><Receipt className="w-4 h-4 mr-1" /> Diseño de ticket</TabsTrigger>
          <TabsTrigger value="impresoras" data-testid="tab-impresoras"><PrinterIcon className="w-4 h-4 mr-1" /> Impresoras</TabsTrigger>
          <TabsTrigger value="usuarios" data-testid="tab-usuarios"><UserCog className="w-4 h-4 mr-1" /> Usuarios</TabsTrigger>
          <TabsTrigger value="storage" data-testid="tab-storage"><HardDrive className="w-4 h-4 mr-1" /> Almacenamiento</TabsTrigger>
          {can("config") && <TabsTrigger value="datos" data-testid="tab-datos"><DatabaseZap className="w-4 h-4 mr-1" /> Datos</TabsTrigger>}
        </TabsList>

        <TabsContent value="empresa" className="pt-4">
          <div className="card-soft p-5 grid grid-cols-2 gap-4 max-w-3xl">
            <div className="col-span-2 flex items-center gap-2 text-slate-700 font-semibold"><Building2 className="w-4 h-4 text-[#C1401E]" /> Datos generales</div>
            {I("Nombre de la empresa", "empresa_nombre")}
            {I("RFC", "rfc")}
            {I("Teléfono", "telefono")}
            {I("Correo", "correo")}
            <div className="col-span-2 flex items-center gap-2 text-slate-700 font-semibold mt-2"><MapPin className="w-4 h-4 text-[#C1401E]" /> Ubicación</div>
            <div className="col-span-2">{I("Dirección", "direccion")}</div>
            {I("Colonia", "colonia")}
            {I("Ciudad", "ciudad")}
            {I("Estado", "estado")}
            {I("Código Postal", "cp")}
            {I("País", "pais")}
          </div>
        </TabsContent>

        <TabsContent value="precios" className="pt-4">
          <div className="card-soft p-5 max-w-lg space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {I("IVA %", "iva_tasa", "number")}
              {I("Moneda", "moneda")}
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block">Listas de precios (nombre y % de utilidad sobre costo)</Label>
              <div className="space-y-2">
                {s.listas_precios_nombres.map((n, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm text-slate-400 w-16">Lista {i + 1}</span>
                    <Input value={n} onChange={(e) => setLista(i, e.target.value)} data-testid={`cfg-lista-${i}`} placeholder={`Precio ${i + 1}`} />
                    <div className="relative w-28">
                      <Input type="number" value={(s.listas_precios_pct || [])[i] ?? ""} onChange={(e) => setListaPct(i, Number(e.target.value))} className="pr-6" data-testid={`cfg-lista-pct-${i}`} placeholder="%" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
                    </div>
                    {s.listas_precios_nombres.length > 1 && (
                      <button type="button" onClick={() => delLista(i)} className="text-slate-400 hover:text-red-600" data-testid={`cfg-lista-del-${i}`}><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addLista} className="h-7 text-[11px]" data-testid="cfg-lista-add"><Plus className="w-3.5 h-3.5 mr-1" /> Agregar lista de precios</Button>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">El % define la utilidad sugerida de cada lista sobre el costo (referencia para nuevos precios).</p>
            </div>

            {/* Unidades de medida */}
            <div className="border-t border-slate-100 pt-4">
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block">Unidades de medida (disponibles al crear productos)</Label>
              <div className="flex flex-wrap gap-2 mb-3">
                {(s.unidades_medida || []).map((u, i) => (
                  <span key={`${u}-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-sm">
                    {u}
                    <button type="button" onClick={() => delUnidad(i)} className="text-slate-400 hover:text-red-600" data-testid={`cfg-unidad-del-${i}`}>
                      ×
                    </button>
                  </span>
                ))}
                {(s.unidades_medida || []).length === 0 && (
                  <span className="text-xs text-slate-400">Sin unidades configuradas.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={nuevaUnidad}
                  onChange={(e) => setNuevaUnidad(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUnidad(); } }}
                  placeholder="Nueva unidad (ej. BULTO, MT2…)"
                  className="h-9 w-56"
                  data-testid="cfg-unidad-nueva"
                />
                <Button variant="outline" size="sm" onClick={addUnidad} data-testid="cfg-unidad-add"><Plus className="w-3.5 h-3.5 mr-1" /> Agregar</Button>
                <Button variant="ghost" size="sm" onClick={restoreUnidades} data-testid="cfg-unidad-restore">
                  Restaurar predeterminadas
                </Button>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Se ofrecen en el formulario de productos (POS/Compras/Inventario). El IVA predeterminado de todo producto nuevo es 8%.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sucursales" className="pt-4">
          <div className="space-y-3">
            {s.sucursales.map((su, i) => (
              <div key={i} className="card-soft p-4 grid grid-cols-2 md:grid-cols-3 gap-3 relative">
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Nombre</Label><Input value={su.nombre} onChange={(e) => setSuc(i, "nombre", e.target.value)} className="mt-1" data-testid={`suc-nombre-${i}`} /></div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Dirección</Label><Input value={su.direccion} onChange={(e) => setSuc(i, "direccion", e.target.value)} className="mt-1" /></div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Teléfono</Label><Input value={su.telefono} onChange={(e) => setSuc(i, "telefono", e.target.value)} className="mt-1" /></div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Ciudad</Label><Input value={su.ciudad} onChange={(e) => setSuc(i, "ciudad", e.target.value)} className="mt-1" /></div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Estado</Label><Input value={su.estado} onChange={(e) => setSuc(i, "estado", e.target.value)} className="mt-1" /></div>
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">C.P.</Label><Input value={su.cp} onChange={(e) => setSuc(i, "cp", e.target.value)} className="mt-1" /></div>
                <button onClick={() => delSuc(i)} className="absolute top-2 right-2 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <Button variant="outline" onClick={addSuc} data-testid="add-sucursal"><Plus className="w-4 h-4 mr-1" /> Agregar sucursal</Button>
          </div>
        </TabsContent>

        <TabsContent value="ticket" className="pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card-soft p-5 space-y-4">
              <div className="flex items-center gap-2 text-slate-700 font-semibold"><Receipt className="w-4 h-4 text-[#C1401E]" /> Diseño de ticket</div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">Logo del negocio</Label>
                <ImageUpload value={s.logo_url} onChange={(v) => set("logo_url", v)} testid="cfg-logo-upload" heightClass="h-28" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Tamaño de papel</Label>
                <div className="flex gap-2 mt-1">
                  {[["80mm", "Ticket 80mm"], ["carta", "Carta"]].map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setTc("tamano", v)} data-testid={`cfg-ticket-size-${v}`}
                      className={`flex-1 py-2 rounded-md border text-sm font-medium ${(s.ticket_config?.tamano || "80mm") === v ? "border-[#C1401E] bg-[#C1401E]/5 text-[#C1401E]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-slate-500">Campos a mostrar</Label>
                {[["mostrar_rfc", "RFC"], ["mostrar_direccion", "Dirección"], ["mostrar_telefono", "Teléfono"], ["mostrar_qr", "QR verificable"]].map(([k, l]) => (
                  <div key={k} className="flex items-center justify-between border border-slate-200 rounded-md px-3 py-2">
                    <span className="text-sm">{l}</span>
                    <Switch checked={s.ticket_config?.[k] !== false} onCheckedChange={(v) => setTc(k, v)} data-testid={`cfg-ticket-${k}`} />
                  </div>
                ))}
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Texto de encabezado</Label>
                <Input value={s.ticket_config?.encabezado || ""} onChange={(e) => setTc("encabezado", e.target.value)} className="mt-1" data-testid="cfg-ticket-encabezado" placeholder="Ej. Sucursal Centro" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Mensaje al pie</Label>
                <Textarea value={s.ticket_config?.pie || ""} onChange={(e) => setTc("pie", e.target.value)} className="mt-1" data-testid="cfg-ticket-pie" placeholder="¡Gracias por su compra!" />
              </div>

              {/* Editor avanzado por bloques (elementos del ticket) */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Editor avanzado (bloques)</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={aplicarDisenoPredeterminado} data-testid="cfg-elt-default-design"
                      className="h-7 text-[11px]">Aplicar diseño predeterminado</Button>
                    <Button variant="outline" size="sm" onClick={() => setElements(null)} data-testid="cfg-elt-default"
                      className="h-7 text-[11px]">Usar diseño estándar</Button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">"Aplicar diseño predeterminado" carga una plantilla completa editable (logo, datos, items, total y QR). "Usar diseño estándar" reemplaza los bloques por los valores por defecto.</p>
                <div className="space-y-2 mt-3">
                  {elt.map((blk, i) => (
                    <div key={i} className="border border-slate-200 rounded-lg p-2 flex flex-col gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-[#C1401E] w-28">{TYPE_LABELS[blk.tipo] || blk.tipo}</span>
                        <button type="button" onClick={() => moveEl(i, -1)} className="text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} data-testid={`cfg-elt-up-${i}`}>↑</button>
                        <button type="button" onClick={() => moveEl(i, 1)} className="text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === elt.length - 1} data-testid={`cfg-elt-down-${i}`}>↓</button>
                        <div className="ml-auto flex items-center gap-2">
                          <select value={blk.align || "left"} onChange={(e) => setEl(i, "align", e.target.value)} className="text-[11px] border rounded px-1 py-0.5" data-testid={`cfg-elt-align-${i}`}>
                            <option value="left">Izq</option><option value="center">Centro</option><option value="right">Der</option>
                          </select>
                          <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={!!blk.bold} onChange={(e) => setEl(i, "bold", e.target.checked)} data-testid={`cfg-elt-bold-${i}`} />Neg</label>
                          <input type="checkbox" checked={blk.visible !== false} onChange={(e) => setEl(i, "visible", e.target.checked)} title="Visible" data-testid={`cfg-elt-vis-${i}`} />
                          <button type="button" onClick={() => delEl(i)} className="text-red-500 hover:text-red-700" data-testid={`cfg-elt-del-${i}`}><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                      {["campo", "texto", "pie", "pie2", "encabezado", "qr"].includes(blk.tipo) && (
                        <Input value={blk.contenido || ""} onChange={(e) => setEl(i, "contenido", e.target.value)} placeholder={blk.tipo === "qr" ? "URL, texto o {verificar} (folio único)" : blk.tipo === "encabezado" ? "Encabezado" : "Contenido"} className="h-8 text-sm" data-testid={`cfg-elt-content-${i}`} />
                      )}
                      {blk.tipo === "qr" && (
                        <Input type="number" value={blk.qr_size || 18} onChange={(e) => setEl(i, "qr_size", Number(e.target.value))} placeholder="Tamaño mm" className="h-8 w-32 text-sm" data-testid={`cfg-elt-qrsize-${i}`} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {[["encabezado", "Encabezado"], ["pie", "Pie de página"], ["campo", "Texto libre"], ["folio", "Folio"],
                    ["fecha", "Fecha"], ["cliente", "Cliente"], ["atendio", "Atendió"], ["items", "Productos"],
                    ["subtotal", "Subtotal"], ["iva", "IVA"], ["total", "Total"], ["credito", "Aviso crédito"],
                    ["separador", "Línea"], ["logo", "Logo"], ["qr", "QR"]].map(([t, l]) => (
                    <Button variant="outline" size="sm" key={t} onClick={() => addEl(t)} className="h-7 text-[11px]" data-testid={`cfg-elt-add-${t}`}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> {l}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Vista previa en vivo */}
            <div className="flex flex-col items-center">
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 self-start">Vista previa</Label>
              <div className={`bg-white border border-slate-300 shadow-sm rounded-md p-4 font-mono text-[11px] text-black ${(s.ticket_config?.tamano || "80mm") === "carta" ? "w-full" : "w-64"}`} data-testid="cfg-ticket-preview">
                <div className="text-center">
                  {s.logo_url && <img src={fileUrl(s.logo_url)} alt="logo" className="h-12 mx-auto mb-1 object-contain" />}
                  <div className="font-bold text-[13px]">{s.empresa_nombre || "Grupo RYSA"}</div>
                  {s.ticket_config?.mostrar_rfc !== false && s.rfc && <div>RFC: {s.rfc}</div>}
                  {s.ticket_config?.mostrar_direccion !== false && s.direccion && <div>{s.direccion}</div>}
                  {s.ticket_config?.mostrar_telefono !== false && s.telefono && <div>Tel: {s.telefono}</div>}
                  {s.ticket_config?.encabezado && <div>{s.ticket_config.encabezado}</div>}
                </div>
                {/* Bloques personalizados (vista previa) */}
                {(s.ticket_config?.elements || []).filter((e) => e.visible !== false).map((e, i) => {
                  const alignCls = e.align === "center" ? "text-center" : e.align === "right" ? "text-right" : "";
                  const w = e.bold ? " font-bold" : "";
                  if (e.tipo === "logo" && s.logo_url) return <div key={i} className="text-center"><img src={fileUrl(s.logo_url)} alt="logo" className="h-8 mx-auto object-contain" /></div>;
                  if (e.tipo === "qr") return <div key={i} className="text-center text-[16px] py-1">▦ QR</div>;
                  if (e.tipo === "separador") return <div key={i} className={`border-t border-dashed border-black my-1 ${alignCls}`} />;
                  const cont = (e.contenido || "").replace("{empresa}", s.empresa_nombre || "Grupo RYSA").replace("{cliente}", "Público General").replace("{total}", "$150.00");
                  if (e.tipo === "campo" || e.tipo === "texto" || e.tipo === "pie" || e.tipo === "pie2" || e.tipo === "encabezado") return <div key={i} className={`${alignCls}${w}`} style={e.font_size ? { fontSize: e.font_size } : {}}>{cont}</div>;
                  if (e.tipo === "total") return <div key={i} className={`flex justify-between font-bold ${alignCls}`}><span>TOTAL</span><span>$150.00</span></div>;
                  if (e.tipo === "subtotal") return <div key={i} className={alignCls}>Subtotal: $129.31</div>;
                  if (e.tipo === "iva") return <div key={i} className={alignCls}>IVA: $20.69</div>;
                  if (e.tipo === "folio") return <div key={i}>FOLIO: V000123</div>;
                  if (e.tipo === "fecha") return <div key={i}>Fecha: 2026-08-12</div>;
                  if (e.tipo === "cliente") return <div key={i}>Cliente: Público General</div>;
                  if (e.tipo === "atendio") return <div key={i}>Atendió: Operador</div>;
                  if (e.tipo === "credito") return <div key={i} className="text-center">** VENTA A CRÉDITO **</div>;
                  if (e.tipo === "items") return <div key={i}><div className="flex justify-between"><span>2 x Producto demo</span><span>$100.00</span></div><div className="flex justify-between"><span>1 x Otro artículo</span><span>$50.00</span></div></div>;
                  return null;
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-2 text-center max-w-xs">Así se verá el ticket/PDF que se imprime y se envía por WhatsApp. Guarda para aplicar los cambios.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="impresoras" className="pt-4">
          <div className="space-y-4">
            {s && (
              <div className="card-soft p-5 space-y-4">
                <div className="flex items-center gap-2 text-slate-700 font-semibold"><PrinterIcon className="w-4 h-4 text-[#C1401E]" /> Impresoras y salida de documentos</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between border border-slate-200 rounded-md px-3 h-12">
                    <div>
                      <div className="text-sm">Imprimir ticket automáticamente al finalizar una venta</div>
                      <div className="text-[11px] text-slate-400">Un error de impresión nunca cancela la venta.</div>
                    </div>
                    <Switch checked={!!s.ticket_config?.auto_print} onCheckedChange={(v) => setTc("auto_print", v)} data-testid="cfg-auto-print" />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-slate-500">Servicio / puente de impresión local (opcional)</Label>
                    <Input value={s.printers?.bridge_url || ""} onChange={(e) => setBridgeUrl(e.target.value)} className="mt-1 font-mono" placeholder="http://localhost:9731" data-testid="cfg-bridge-url" />
                    <p className="text-[11px] text-slate-400 mt-1">URL del puente que la app empaquetada expone para imprimir a impresoras USB/red (ej. <b>http://localhost:9731</b>). Con impresión por navegador no se requiere.</p>
                  </div>
                </div>

                {/* Detección */}
                <div className="border-t pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs uppercase tracking-wider text-slate-500">Detectar impresoras</Label>
                    <Button variant="outline" size="sm" onClick={buscarImpresoras} disabled={scanState.estado === "buscando"} data-testid="cfg-buscar-impresoras">
                      {scanState.estado === "buscando" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />} Buscar impresoras
                    </Button>
                  </div>
                  {scanState.estado !== "idle" && <p className="text-sm mt-2 text-slate-600" data-testid="cfg-scan-msg">{scanState.mensaje}</p>}
                  {scanState.resultados.length > 0 && (
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                      {scanState.resultados.map((r) => (
                        <div key={r.id} className="flex items-center justify-between border border-slate-200 rounded-md px-3 py-2">
                          <div>
                            <div className="text-sm font-medium">{r.nombre}</div>
                            <div className="text-[11px] text-slate-400">{r.tipo_conexion}{r.ip ? ` · ${r.ip}` : ""} · {r.estado}</div>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => addPrinter(r)} data-testid={`cfg-agregar-impresora-${r.id}`}><Plus className="w-3.5 h-3.5 mr-1" /> Agregar</Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400 mt-2">Un navegador no puede enumerar impresoras instaladas ni de red directamente. La detección usa la API Web de impresión del navegador (si existe) o el puente local configurado arriba. No se muestran impresoras ficticias.</p>
                </div>

                {/* Lista de impresoras configuradas */}
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wider text-slate-500">Impresoras configuradas ({printers.length})</Label>
                    <Button variant="outline" size="sm" onClick={() => addPrinter()} data-testid="cfg-agregar-impresora"><Plus className="w-3.5 h-3.5 mr-1" /> Agregar impresora</Button>
                  </div>
                  {printers.length === 0 && <p className="text-sm text-slate-400">Aún no hay impresoras configuradas. Agrega una o usa "Buscar impresoras".</p>}
                  {printers.map((p, i) => (
                    <div key={p.id} className="border border-slate-200 rounded-lg p-3 grid grid-cols-2 md:grid-cols-6 gap-3 items-end" data-testid={`cfg-printer-${i}`}>
                      <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Nombre</Label>
                        <Input value={p.nombre} onChange={(e) => setPrinter(i, "nombre", e.target.value)} className="mt-1" placeholder="Ej. EPSON TM-T20III" /></div>
                      <div><Label className="text-xs uppercase tracking-wider text-slate-500">Conexión</Label>
                        <select value={p.tipo_conexion} onChange={(e) => setPrinter(i, "tipo_conexion", e.target.value)} className="mt-1 h-9 w-full border border-slate-200 rounded-md px-2 text-sm" data-testid={`cfg-printer-tipo-${i}`}>
                          <option value="browser">Navegador (PDF/nativo)</option>
                          <option value="bridge">Puente local</option>
                          <option value="ip">IP de red (vía puente)</option>
                        </select></div>
                      {p.tipo_conexion !== "browser" && <div><Label className="text-xs uppercase tracking-wider text-slate-500">IP / Ruta</Label>
                        <Input value={p.ip} onChange={(e) => setPrinter(i, "ip", e.target.value)} className="mt-1 font-mono" placeholder="192.168.1.50" data-testid={`cfg-printer-ip-${i}`} /></div>}
                      <div className="flex items-center h-9 gap-2">
                        <Button variant="outline" size="sm" onClick={() => probarPrinter(p)} disabled={pruebaState[p.id] === "probando"} data-testid={`cfg-printer-test-${i}`}>
                          {pruebaState[p.id] === "probando" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <PrinterIcon className="w-3.5 h-3.5 mr-1" />} Imprimir prueba
                        </Button>
                        <button onClick={() => delPrinter(i)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <div className="text-right text-sm">
                        {pruebaState[p.id] === "ok" ? <span className="text-green-600 flex items-center justify-end gap-1"><CheckCircle2 className="w-4 h-4" /> Enviada</span>
                          : pruebaState[p.id] === "error" ? <span className="text-red-600 flex items-center justify-end gap-1"><XCircle className="w-4 h-4" /> Falló</span>
                          : <span className="text-slate-300 text-xs">Lista</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Predeterminadas por tipo de documento */}
                <div className="border-t pt-4">
                  <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block">Impresora predeterminada por tipo de documento</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {TIPOS_DOC.map(([k, l]) => (
                      <div key={k}>
                        <Label className="text-xs text-slate-500">{l}</Label>
                        <select value={printerDefaults[k] || ""} onChange={(e) => setPrinterDefaults(k, e.target.value)} className="mt-1 h-9 w-full border border-slate-200 rounded-md px-2 text-sm" data-testid={`cfg-default-${k}`}>
                          <option value="">Navegador (predeterminado)</option>
                          {printers.map((p) => <option key={p.id} value={p.id}>{p.nombre || `Impresora (${p.tipo_conexion})`}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">La configuración se guarda en el servidor y persiste tras cerrar sesión, reiniciar el navegador o el POS. La arquitectura permite después asignarla por usuario, caja, terminal o sucursal.</p>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="usuarios" className="pt-4">
          <Usuarios embedded />
        </TabsContent>

        <TabsContent value="storage" className="pt-4">
          <div className="card-soft p-5 max-w-xl space-y-5" data-testid="storage-panel">
            <div className="flex items-center gap-2 text-slate-700 font-semibold"><HardDrive className="w-4 h-4 text-[#C1401E]" /> Almacenamiento de archivos</div>
            <p className="text-sm text-slate-500">Este ERP guarda las imágenes de productos, categorías, logo y PDFs de ticket en un almacenamiento local. Aquí puedes seleccionar el directorio donde se guardarán (por ejemplo, al instalar en tu VPS).</p>

            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">Tipo de almacenamiento</Label>
              <div className="flex gap-2">
                {[["local", "Local (disco del servidor)"]].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setStorage("backend", v)} data-testid={`storage-backend-${v}`}
                    className={`flex-1 py-2 rounded-md border text-sm font-medium ${(s.storage?.backend || "local") === v ? "border-[#C1401E] bg-[#C1401E]/5 text-[#C1401E]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{l}</button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Directorio de almacenamiento (upload_dir)</Label>
              <Input value={s.storage?.upload_dir || ""} onChange={(e) => setStorage("upload_dir", e.target.value)} className="mt-1 font-mono" placeholder="Ej. /var/www/rysa/uploads" data-testid="storage-upload-dir" />
              <p className="text-[11px] text-slate-400 mt-1">Si se deja vacío, se usa el directorio definido por la variable de entorno <span className="font-mono">UPLOAD_DIR</span> del servidor.</p>
            </div>

            <div className="border border-slate-200 rounded-md p-3 bg-slate-50 text-sm" data-testid="storage-status">
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Directorio efectivo actual</div>
              <div className="font-mono text-slate-700">{s.storage?.upload_dir || "(UPLOAD_DIR del servidor)"}</div>
              <p className="text-[11px] text-slate-400 mt-1">Guardado y reinicio del servidor aplican el cambio. Los archivos ya subidos no se mueven automáticamente.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="cuentas" className="pt-4">
          <div className="card-soft p-5 max-w-2xl space-y-5" data-testid="cuentas-tab">
            <div className="flex items-center gap-2 text-slate-700 font-semibold"><Landmark className="w-4 h-4 text-[#C1401E]" /> Cuentas bancarias</div>
            <p className="text-sm text-slate-500">Cuentas para mostrar en cotizaciones y usar como forma de pago. Puedes marcarla como predeterminada.</p>

            {/* Alta / edición */}
            <div className="border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="text-xs uppercase tracking-wider text-slate-500">{ctaEditId ? "Editar cuenta" : "Nueva cuenta"}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-slate-500">Banco</Label>
                  <Select value={ctaForm.banco} onValueChange={(v) => setCtaForm((s) => ({ ...s, banco: v }))}>
                    <SelectTrigger className="mt-1" data-testid="cta-banco"><SelectValue placeholder="Selecciona un banco…" /></SelectTrigger>
                    <SelectContent>
                      {catBancos.map((b) => (
                        <SelectItem key={b.nombre} value={b.nombre} data-testid={`cta-banco-opt-${normTxt(b.nombre).replace(/\s+/g, "-")}`}>
                          <span className="flex items-center gap-2">
                            {b.logo_url && <img src={b.logo_url} alt="" className="h-4 w-4 object-contain" />}
                            {b.nombre}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {ctaForm.banco && logoBanco(ctaForm.banco) && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <img src={logoBanco(ctaForm.banco)} alt={ctaForm.banco}
                           className="h-7 w-auto max-w-[80px] object-contain" data-testid="cta-banco-preview" />
                      <span className="text-[11px] text-slate-400">Logo asignado automáticamente</span>
                    </div>
                  )}
                </div>
                <div><Label className="text-xs text-slate-500">Alias</Label><Input value={ctaForm.alias} onChange={(e) => setCtaForm((s) => ({ ...s, alias: e.target.value }))} className="mt-1" placeholder="Cuenta principal" data-testid="cta-alias" /></div>
                <div><Label className="text-xs text-slate-500">Número de cuenta</Label><Input value={ctaForm.numero_cuenta} onChange={(e) => setCtaForm((s) => ({ ...s, numero_cuenta: e.target.value }))} className="mt-1 font-mono" data-testid="cta-numero" /></div>
                <div><Label className="text-xs text-slate-500">CLABE</Label><Input value={ctaForm.clabe} onChange={(e) => setCtaForm((s) => ({ ...s, clabe: e.target.value }))} className="mt-1 font-mono" /></div>
                <div><Label className="text-xs text-slate-500">Nombre</Label><Input value={ctaForm.nombre} onChange={(e) => setCtaForm((s) => ({ ...s, nombre: e.target.value }))} className="mt-1" /></div>
                <div><Label className="text-xs text-slate-500">Titular</Label><Input value={ctaForm.titular} onChange={(e) => setCtaForm((s) => ({ ...s, titular: e.target.value }))} className="mt-1" /></div>
                <div><Label className="text-xs text-slate-500">Tipo</Label>
                  <Select value={ctaForm.tipo_cuenta} onValueChange={(v) => setCtaForm((s) => ({ ...s, tipo_cuenta: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="debito">Débito</SelectItem><SelectItem value="credito">Crédito</SelectItem><SelectItem value="nomina">Nómina</SelectItem><SelectItem value="otros">Otros</SelectItem></SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Predeterminada</Label>
                  <div className="flex items-center mt-2"><Switch checked={ctaForm.predeterminada} onCheckedChange={(v) => setCtaForm((s) => ({ ...s, predeterminada: v }))} data-testid="cta-predeterminada" /><span className="ml-2 text-sm text-slate-500">{ctaForm.predeterminada ? "Sí" : "No"}</span></div>
                </div>
              </div>
              <div className="flex gap-2">
                {ctaEditId && <Button variant="outline" onClick={() => { setCtaForm(ctaBlank()); setCtaEditId(null); }}>Cancelar</Button>}
                <Button onClick={guardarCuenta} disabled={ctaSaving} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="cta-guardar">
                  {ctaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Guardar</>}
                </Button>
              </div>
            </div>

            {/* Listado */}
            <div className="space-y-2">
              {cuentas.length === 0 && <p className="text-sm text-slate-400">Aún no tienes cuentas bancarias.</p>}
              {cuentas.map((c) => (
                <div key={c.id} className="border border-slate-200 rounded-lg p-3 flex items-center gap-3" data-testid={`cta-row-${c.id}`}>
                  {logoBanco(c.banco) ? (
                    <img src={logoBanco(c.banco)} alt={c.banco}
                         className="h-10 w-10 object-contain rounded-lg border border-slate-200 bg-white p-1 shrink-0"
                         data-testid={`cta-logo-${c.id}`} />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-[#C1401E]/10 text-[#C1401E] flex flex-col items-center justify-center shrink-0">
                      <Landmark className="w-5 h-5" />
                      {c.banco && <span className="text-[8px] leading-none mt-0.5">revisar</span>}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{c.banco}</span>
                      {!bancoCat(c.banco) && c.banco && (
                        <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700">Fuera de catálogo — editar para elegir banco</Badge>
                      )}
                      {c.predeterminada && <Star className="w-3.5 h-3.5 text-amber-500" data-testid={`cta-pred-${c.id}`} />}
                      <Badge className={c.activa ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}>{c.activa ? "Activa" : "Inactiva"}</Badge>
                    </div>
                    <div className="text-sm text-slate-500 font-mono">Cuenta: {c.numero_cuenta}</div>
                    {c.alias && <div className="text-xs text-slate-400">{c.alias}</div>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => editarCuenta(c)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="outline" onClick={() => toggleCuenta(c)} className={c.activa ? "text-amber-600" : "text-green-600"}><Power className="w-4 h-4" /></Button>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {can("config") && (
          <TabsContent value="datos" className="pt-4">
            <div className="card-soft p-5 max-w-xl space-y-5">
              <div className="flex items-center gap-2 text-slate-700 font-semibold"><DatabaseZap className="w-4 h-4 text-[#C1401E]" /> Exportar / Importar datos</div>
              <p className="text-sm text-slate-500">Genera un respaldo ZIP con los datos del ERP, o restaura desde un respaldo. Exclusivo para administradores. (Los usuarios y secretos no se exportan/restauran.)</p>
              <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Respaldo (exportar)</div>
                <Button onClick={descargarExport} disabled={exporting} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="datos-export">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><DatabaseZap className="w-4 h-4 mr-1" /> Exportar ZIP</>}
                </Button>
              </div>
              <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Restaurar (importar)</div>
                <Input type="file" accept=".zip" onChange={(e) => setImportFile(e.target.files[0] || null)} data-testid="datos-import-file" />
                <Button variant="outline" onClick={importarDatos} disabled={importing} data-testid="datos-import">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Importar ZIP"}
                </Button>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
