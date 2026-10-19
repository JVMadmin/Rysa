import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  FileText, Printer, Save, RefreshCw, Eye, EyeOff, Plus, Trash2, ArrowUp, ArrowDown,
  Sliders, Code, CheckCircle, Layers, Download, GripVertical, Palette, Type,
  AlignLeft, AlignCenter, AlignRight, LayoutTemplate, ChevronDown, ChevronRight,
  HelpCircle, Building2, Store
} from "lucide-react";

const API_BASE = "/api";

// ═══════════════════════════════════════════════════════════════
// Colores institucionales RYSA
// ═══════════════════════════════════════════════════════════════
const RYSA_COLORS = [
  { label: "Rojo RYSA",    value: "#C1401E" },
  { label: "Azul RYSA",   value: "#1E3A5F" },
  { label: "Gris oscuro", value: "#374151" },
  { label: "Gris medio",  value: "#6B7280" },
  { label: "Gris claro",  value: "#D1D5DB" },
  { label: "Blanco",      value: "#FFFFFF" },
  { label: "Negro",       value: "#000000" },
  { label: "Naranja",     value: "#EA580C" },
  { label: "Verde",       value: "#15803D" },
];

// ═══════════════════════════════════════════════════════════════
// Variables disponibles por categoría
// ═══════════════════════════════════════════════════════════════
const VARIABLES = {
  "Documento": [
    "{{doc.folio}}", "{{doc.fecha}}", "{{doc.hora}}", "{{doc.total}}",
    "{{doc.subtotal}}", "{{doc.iva}}", "{{doc.iva_total}}", "{{doc.total_letra}}",
    "{{doc.condicion}}", "{{doc.forma_pago}}", "{{doc.estado}}", "{{doc.notas}}",
    "{{doc.vendedor_nombre}}", "{{doc.tipo_venta}}", "{{doc.saldo}}",
  ],
  "Cliente": [
    "{{cliente.nombre}}", "{{cliente.rfc}}", "{{cliente.telefono}}",
    "{{cliente.correo}}", "{{cliente.direccion}}", "{{cliente.codigo}}",
  ],
  "Empresa": [
    "{{empresa.nombre}}", "{{empresa.rfc}}", "{{empresa.telefono}}",
    "{{empresa.correo}}", "{{empresa.direccion}}", "{{empresa.ciudad}}",
    "{{empresa.cp}}", "{{empresa.estado}}", "{{empresa.web}}",
  ],
};

// ═══════════════════════════════════════════════════════════════
// Tipos de elementos disponibles en la paleta
// ═══════════════════════════════════════════════════════════════
const ELEMENT_TYPES = [
  { tipo: "empresa",           label: "Nombre empresa",   icon: "🏢", desc: "Nombre y datos de empresa" },
  { tipo: "campo",             label: "Campo / Texto",    icon: "T",  desc: "Texto libre con variables" },
  { tipo: "separador",         label: "Separador",        icon: "—",  desc: "Línea divisoria" },
  { tipo: "espaciador",        label: "Espaciador",       icon: "↕",  desc: "Espacio en blanco" },
  { tipo: "tabla_productos",   label: "Tabla productos",  icon: "📋", desc: "Listado de artículos vendidos" },
  { tipo: "totales_linea",     label: "Línea de total",   icon: "$",  desc: "Subtotal / IVA / Total" },
  { tipo: "qr",                label: "Código QR",        icon: "⬛", desc: "QR de verificación" },
  { tipo: "logo",              label: "Logo empresa",     icon: "🖼", desc: "Logotipo de la empresa" },
  { tipo: "bloque_totales",    label: "Bloque totales",   icon: "Σ",  desc: "Resumen completo de totales" },
  { tipo: "bloque_firmas",     label: "Bloque de firmas", icon: "✍",  desc: "Líneas de firma" },
  { tipo: "encabezado_empresa",label: "Encabezado carta", icon: "🏷", desc: "Encabezado de nota de venta carta" },
  { tipo: "datos_cliente",     label: "Datos del cliente",icon: "👤", desc: "Bloque de datos del cliente" },
  { tipo: "datos_documento",   label: "Datos del doc.",   icon: "📄", desc: "Folio, fecha, forma de pago" },
];

// ═══════════════════════════════════════════════════════════════
// Selector de color RYSA
// ═══════════════════════════════════════════════════════════════
function ColorPicker({ value, onChange, label }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 border border-slate-300 rounded text-xs w-full bg-white"
        title={label}
      >
        <span
          className="w-4 h-4 rounded border border-slate-400 inline-block flex-shrink-0"
          style={{ background: value || "#000" }}
        />
        <span className="flex-1 text-left truncate">{value || "Sin color"}</span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-48 right-0">
          <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Colores RYSA</p>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {RYSA_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                onClick={() => { onChange(c.value); setOpen(false); }}
                className={`w-full h-7 rounded border-2 transition ${value === c.value ? "border-indigo-500 scale-105 shadow-sm" : "border-transparent hover:border-slate-400"}`}
                style={{ background: c.value }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-100">
            <Palette className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <input
              type="color"
              value={value || "#000000"}
              onChange={(e) => onChange(e.target.value)}
              className="w-6 h-6 border-0 p-0 cursor-pointer rounded"
            />
            <input
              type="text"
              value={value || ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder="#C1401E"
              className="flex-1 text-[10px] border border-slate-200 rounded px-1.5 py-0.5 font-mono"
            />
          </div>
          <button
            type="button"
            onClick={() => { onChange(undefined); setOpen(false); }}
            className="mt-1.5 w-full text-[10px] text-slate-400 hover:text-slate-600 text-center"
          >
            Quitar color personalizado
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Renders del lienzo WYSIWYG
// ═══════════════════════════════════════════════════════════════
function renderElementPreview(el, simContext) {
  const style = {
    textAlign: el.align || "left",
    fontSize: `${el.font_size || 9}pt`,
    fontWeight: el.bold ? "bold" : "normal",
    color: el.color || undefined,
    background: el.bg_color || undefined,
  };

  switch (el.tipo) {
    case "empresa":
      return <div style={style} className="font-bold">{simContext?.empresa?.nombre || "GRUPO RYSA S.A. DE C.V."}</div>;

    case "campo":
      return (
        <div style={style}>
          {(el.contenido || "")
            .replace(/\{\{([^}]+)\}\}/g, (_, k) => {
              const p = k.trim().split(".");
              return simContext?.[p[0]]?.[p[1]] ?? `[${k}]`;
            })}
        </div>
      );

    case "separador":
      return <div className="border-b border-slate-400 my-1.5" style={{ borderColor: el.color || undefined }} />;

    case "espaciador":
      return <div style={{ height: `${el.altura || 8}px` }} />;

    case "logo":
      return (
        <div className="flex justify-center my-1.5">
          {simContext?.empresa?.logo_url
            ? <img src={simContext.empresa.logo_url} alt="Logo" className="max-h-12 max-w-full object-contain" />
            : <div className="w-20 h-10 bg-slate-200 flex items-center justify-center text-[9px] text-slate-500 rounded font-bold">LOGO RYSA</div>
          }
        </div>
      );

    case "tabla_productos":
      return (
        <div className="my-2">
          <div className="flex justify-between font-bold border-b pb-0.5 text-[9px]" style={{ color: el.color || undefined }}>
            <span className="w-8">CANT</span>
            <span className="flex-1 px-1">DESCRIPCIÓN</span>
            <span className="w-14 text-right">P. UNIT</span>
            <span className="w-14 text-right">TOTAL</span>
          </div>
          {(simContext?.doc?.items || []).map((it, idx) => (
            <div key={idx} className="flex justify-between py-0.5 text-[9px] border-b border-dashed border-slate-100">
              <span className="w-8">{it.cantidad}</span>
              <span className="flex-1 px-1 truncate">{it.descripcion}</span>
              <span className="w-14 text-right">${(it.precio_bruto ?? it.precio ?? 0).toFixed(2)}</span>
              <span className="w-14 text-right font-medium">${(it.importe_bruto ?? it.importe ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      );

    case "totales_linea":
      return (
        <div className="flex justify-between py-0.5 text-[10px]">
          <span style={{ color: el.color }}>{el.etiqueta}:</span>
          <span className={el.bold ? "font-bold" : ""} style={{ color: el.color }}>
            ${simContext?.doc?.[el.etiqueta?.toLowerCase()] ?? simContext?.doc?.["iva_total"] ?? "0.00"}
          </span>
        </div>
      );

    case "encabezado_empresa":
      return (
        <div className="flex justify-between border-b pb-3 mb-3">
          <div>
            <h2 className="font-bold text-base" style={{ color: el.color || "#1E3A5F" }}>{simContext?.empresa?.nombre || "GRUPO RYSA"}</h2>
            <p className="text-xs text-slate-500">{simContext?.empresa?.direccion}</p>
            <p className="text-xs text-slate-500">RFC: {simContext?.empresa?.rfc}</p>
            <p className="text-xs text-slate-500">Tel: {simContext?.empresa?.telefono}</p>
          </div>
          <div className="text-right">
            <span className="font-bold text-lg" style={{ color: "#C1401E" }}>{simContext?.doc?.folio}</span>
            <p className="text-xs text-slate-500">{simContext?.doc?.fecha}</p>
          </div>
        </div>
      );

    case "datos_documento":
      return (
        <div className="grid grid-cols-2 gap-2 text-xs mb-3 bg-slate-50 p-2 rounded">
          <div><span className="text-slate-500">Fecha:</span> {simContext?.doc?.fecha}</div>
          <div><span className="text-slate-500">Condición:</span> {simContext?.doc?.condicion}</div>
          <div><span className="text-slate-500">Forma pago:</span> {simContext?.doc?.forma_pago}</div>
          <div><span className="text-slate-500">Vendedor:</span> {simContext?.doc?.vendedor_nombre}</div>
        </div>
      );

    case "datos_cliente":
      return (
        <div className="bg-slate-50 p-2 rounded border border-slate-200 text-xs mb-2">
          <p><b>Cliente:</b> {simContext?.cliente?.nombre}</p>
          <p className="text-slate-500">RFC: {simContext?.cliente?.rfc} · Tel: {simContext?.cliente?.telefono}</p>
          <p className="text-slate-500">{simContext?.cliente?.direccion}</p>
        </div>
      );

    case "bloque_totales":
      return (
        <div className="w-56 ml-auto text-xs space-y-1 my-2 text-right">
          <div className="flex justify-between"><span>Subtotal:</span><b>${simContext?.doc?.subtotal?.toFixed(2) ?? "0.00"}</b></div>
          <div className="flex justify-between"><span>IVA (8%):</span><b>${simContext?.doc?.iva_total?.toFixed(2) ?? simContext?.doc?.iva?.toFixed(2) ?? "0.00"}</b></div>
          <div className="flex justify-between text-base font-bold border-t pt-1" style={{ color: el.color || "#C1401E" }}>
            <span>TOTAL:</span><span>${simContext?.doc?.total?.toFixed(2) ?? "0.00"}</span>
          </div>
        </div>
      );

    case "bloque_firmas":
      return (
        <div className="flex justify-around pt-10 mt-4 border-t text-center text-xs">
          <div>
            <div className="w-36 border-b border-slate-400 mb-1" />
            <p className="font-bold">{el.leyenda || "Firma de Conformidad"}</p>
          </div>
          <div>
            <div className="w-36 border-b border-slate-400 mb-1" />
            <p className="font-bold">Entrega Almacén</p>
          </div>
        </div>
      );

    case "qr":
      return (
        <div className="flex flex-col items-center my-2">
          <div className="w-16 h-16 bg-slate-900 flex items-center justify-center text-white text-[9px] font-bold rounded">QR</div>
          <span className="text-[8px] text-slate-400 mt-0.5">Verificación Oficial</span>
        </div>
      );

    default:
      return <div className="text-[9px] text-slate-400 italic">[{el.tipo}]</div>;
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export default function MachotesEditor() {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [currentTemplate, setCurrentTemplate] = useState(null);
  const [config, setConfig] = useState(null);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [varOpen, setVarOpen] = useState({});

  // Simulador
  const [simMode, setSimMode] = useState("sintetico");
  const [numItems, setNumItems] = useState(4);
  const [realDocId, setRealDocId] = useState("");
  const [simContext, setSimContext] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  // Drag & drop
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);

  useEffect(() => { cargarPlantillas(); }, []);

  async function cargarPlantillas() {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/templates`);
      setTemplates(res.data || []);
      if (res.data?.length > 0) seleccionarPlantilla(res.data[0].id);
    } catch { toast.error("Error al cargar plantillas"); }
    finally { setLoading(false); }
  }

  async function seleccionarPlantilla(id) {
    try {
      setSelectedTemplateId(id);
      const res = await axios.get(`${API_BASE}/templates/${id}`);
      setCurrentTemplate(res.data);
      const cfg = res.data.configuracion || { formato_fisico: "80mm", elementos: [] };
      setConfig(cfg);
      setSelectedElementId(cfg.elementos?.[0]?.id || null);
      ejecutarSimulacion(id, cfg, simMode, numItems, realDocId);
    } catch { toast.error("Error al obtener plantilla"); }
  }

  async function ejecutarSimulacion(tid, customCfg, mode, itemsCount, docId) {
    try {
      setSimLoading(true);
      const res = await axios.post(`${API_BASE}/templates/${tid || selectedTemplateId}/simulate`, {
        configuracion: customCfg || config,
        num_items: itemsCount || numItems,
        documento_id: mode === "real" ? docId : null,
      });
      setSimContext(res.data.context);
    } catch (e) { console.warn("Fallo simulación", e); }
    finally { setSimLoading(false); }
  }

  function actualizarConfig(newCfg) {
    setConfig(newCfg);
    ejecutarSimulacion(selectedTemplateId, newCfg, simMode, numItems, realDocId);
  }

  function moverElemento(index, direccion) {
    if (!config?.elementos) return;
    const nuevos = [...config.elementos];
    const target = index + direccion;
    if (target < 0 || target >= nuevos.length) return;
    [nuevos[index], nuevos[target]] = [nuevos[target], nuevos[index]];
    actualizarConfig({ ...config, elementos: nuevos });
  }

  function toggleVisibilidad(id) {
    const nuevos = config.elementos.map((el) => el.id === id ? { ...el, visible: !el.visible } : el);
    actualizarConfig({ ...config, elementos: nuevos });
  }

  function eliminarElemento(id) {
    const nuevos = config.elementos.filter((el) => el.id !== id);
    actualizarConfig({ ...config, elementos: nuevos });
    if (selectedElementId === id) setSelectedElementId(nuevos[0]?.id || null);
  }

  function agregarElemento(tipo) {
    const id = `el_${Date.now()}`;
    const base = ELEMENT_TYPES.find((t) => t.tipo === tipo) || {};
    let nuevo = { id, tipo, visible: true };
    if (["campo", "texto"].includes(tipo)) {
      nuevo = { ...nuevo, contenido: "Nuevo texto", font_size: 9, align: "left", bold: false };
    } else if (tipo === "separador") {
      // solo línea
    } else if (tipo === "espaciador") {
      nuevo.altura = 8;
    } else if (tipo === "qr") {
      nuevo.contenido = "{{doc.qr_url}}";
    } else if (tipo === "totales_linea") {
      nuevo = { ...nuevo, etiqueta: "TOTAL", valor: "{{doc.total}}", bold: true, font_size: 10, color: "#C1401E" };
    } else if (tipo === "bloque_firmas") {
      nuevo.leyenda = "Recibí de conformidad";
    }
    const nuevos = [...(config.elementos || []), nuevo];
    actualizarConfig({ ...config, elementos: nuevos });
    setSelectedElementId(id);
  }

  function actualizarElemento(id, campo, valor) {
    const nuevos = config.elementos.map((el) => el.id === id ? { ...el, [campo]: valor } : el);
    actualizarConfig({ ...config, elementos: nuevos });
  }

  // Drag & drop handlers
  const onDragStart = (idx) => { dragIdx.current = idx; };
  const onDragOver = (e, idx) => { e.preventDefault(); dragOverIdx.current = idx; };
  const onDrop = () => {
    if (dragIdx.current === null || dragOverIdx.current === null) return;
    const nuevos = [...config.elementos];
    const [removed] = nuevos.splice(dragIdx.current, 1);
    nuevos.splice(dragOverIdx.current, 0, removed);
    dragIdx.current = null; dragOverIdx.current = null;
    actualizarConfig({ ...config, elementos: nuevos });
  };

  async function guardarNuevaVersion() {
    try {
      setSaving(true);
      const res = await axios.put(`${API_BASE}/templates/${selectedTemplateId}`, {
        configuracion: config, formato_fisico: config.formato_fisico,
      });
      toast.success(`Plantilla guardada como versión ${res.data.version}`);
      seleccionarPlantilla(selectedTemplateId);
    } catch { toast.error("Error al guardar versión"); }
    finally { setSaving(false); }
  }

  async function descargarPdf() {
    try {
      const res = await axios.post(
        `${API_BASE}/templates/${selectedTemplateId}/pdf`,
        { configuracion: config, num_items: numItems, documento_id: simMode === "real" ? realDocId : null },
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `machote-${currentTemplate?.tipo || "doc"}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch { toast.error("Error al generar PDF"); }
  }

  const elementoSeleccionado = config?.elementos?.find((e) => e.id === selectedElementId);

  if (loading) return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-slate-500 text-sm">Cargando editor de machotes...</div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-65px)] bg-slate-100 text-slate-800 overflow-hidden">
      {/* BARRA SUPERIOR */}
      <header className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg shadow-sm" style={{ background: "#1E3A5F" }}>
            <LayoutTemplate className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <select
                value={selectedTemplateId}
                onChange={(e) => seleccionarPlantilla(e.target.value)}
                className="font-bold text-slate-800 bg-transparent text-sm border-b border-dashed border-slate-400 focus:outline-none focus:border-[#C1401E]"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre} ({t.tipo})</option>
                ))}
              </select>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "#C1401E15", color: "#C1401E" }}>
                v{currentTemplate?.version_actual || 1}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Editor de formatos y machotes · Formato: <b>{config?.formato_fisico?.toUpperCase()}</b>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Selector de formato */}
          <select
            value={config?.formato_fisico || "80mm"}
            onChange={(e) => actualizarConfig({ ...config, formato_fisico: e.target.value })}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white font-medium"
          >
            <option value="58mm">Ticket 58mm</option>
            <option value="80mm">Ticket 80mm</option>
            <option value="carta">Carta</option>
            <option value="oficio">Oficio</option>
          </select>
          <button
            type="button"
            onClick={descargarPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
          >
            <Download className="w-3.5 h-3.5" /> PDF Oficial
          </button>
          <button
            type="button"
            onClick={guardarNuevaVersion}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white rounded-lg shadow-sm transition disabled:opacity-50"
            style={{ background: saving ? "#6B7280" : "#C1401E" }}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Guardando..." : "Guardar Versión"}
          </button>
        </div>
      </header>

      {/* ÁREA EN 3 COLUMNAS */}
      <div className="flex-1 flex overflow-hidden">

        {/* COL IZQUIERDA: CAPAS + PALETA */}
        <div className="w-72 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="font-bold text-xs text-slate-600 uppercase tracking-wider">Capas del documento</span>
            <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">
              {config?.elementos?.length || 0}
            </span>
          </div>

          {/* Lista de capas (drag & drop) */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {config?.elementos?.map((el, idx) => {
              const isSelected = el.id === selectedElementId;
              const typeInfo = ELEMENT_TYPES.find((t) => t.tipo === el.tipo) || {};
              return (
                <div
                  key={el.id}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={(e) => onDragOver(e, idx)}
                  onDrop={onDrop}
                  onClick={() => setSelectedElementId(el.id)}
                  className={`p-2 rounded-lg border text-xs flex items-center gap-2 cursor-pointer transition select-none ${
                    isSelected ? "border-[#C1401E] bg-red-50/50 text-[#C1401E] font-medium" : "bg-white border-slate-200 hover:border-slate-300 text-slate-700"
                  } ${!el.visible ? "opacity-40" : ""}`}
                >
                  <GripVertical className="w-3 h-3 text-slate-300 flex-shrink-0 cursor-grab" />
                  <span className="flex-shrink-0 text-sm">{typeInfo.icon || "⬜"}</span>
                  <span className="flex-1 truncate capitalize">{typeInfo.label || el.tipo}</span>
                  <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => moverElemento(idx, -1)} disabled={idx === 0} className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-20" title="Subir">
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => moverElemento(idx, 1)} disabled={idx === config.elementos.length - 1} className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-20" title="Bajar">
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => toggleVisibilidad(el.id)} className="p-0.5 text-slate-400 hover:text-slate-600" title="Visibilidad">
                      {el.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-amber-500" />}
                    </button>
                    <button type="button" onClick={() => eliminarElemento(el.id)} className="p-0.5 text-slate-400 hover:text-red-600" title="Eliminar">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Paleta de elementos */}
          <div className="p-3 border-t border-slate-200 bg-slate-50">
            <p className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Agregar al documento</p>
            <div className="grid grid-cols-2 gap-1">
              {ELEMENT_TYPES.map((t) => (
                <button
                  key={t.tipo}
                  type="button"
                  onClick={() => agregarElemento(t.tipo)}
                  title={t.desc}
                  className="flex items-center gap-1.5 px-2 py-1.5 bg-white border border-slate-200 hover:border-[#C1401E] hover:text-[#C1401E] rounded text-xs text-left text-slate-700 transition"
                >
                  <span className="text-sm">{t.icon}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* COL CENTRAL: LIENZO WYSIWYG */}
        <div className="flex-1 bg-slate-300 overflow-y-auto p-8 flex justify-center items-start">
          <div
            className={`bg-white shadow-2xl transition-all duration-300 ${
              config?.formato_fisico === "58mm" ? "w-[220px] p-2.5 text-[10px]"
              : config?.formato_fisico === "80mm" ? "w-[310px] p-4 text-xs font-mono"
              : "w-[640px] min-h-[900px] p-12 text-sm"
            }`}
          >
            <div className="text-center pb-2 mb-3 border-b border-dashed border-slate-200 text-[9px] text-slate-400 uppercase tracking-widest">
              Vista previa · {config?.formato_fisico?.toUpperCase()}
              {simLoading && <span className="ml-2 text-indigo-500">Actualizando...</span>}
            </div>

            {config?.elementos?.map((el) => {
              if (!el.visible) return null;
              const isSelected = el.id === selectedElementId;
              return (
                <div
                  key={el.id}
                  onClick={() => setSelectedElementId(el.id)}
                  className={`relative cursor-pointer transition rounded my-0.5 px-1 ${
                    isSelected ? "ring-2 ring-[#C1401E] bg-red-50/30" : "hover:bg-slate-50"
                  }`}
                >
                  {renderElementPreview(el, simContext)}
                </div>
              );
            })}
          </div>
        </div>

        {/* COL DERECHA: INSPECTOR DE PROPIEDADES */}
        <div className="w-80 bg-white border-l border-slate-200 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-slate-200 bg-slate-50">
            <span className="font-bold text-xs text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-[#C1401E]" />
              Propiedades del elemento
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {elementoSeleccionado ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b">
                  <span className="font-bold text-xs text-slate-700 uppercase">
                    {ELEMENT_TYPES.find((t) => t.tipo === elementoSeleccionado.tipo)?.label || elementoSeleccionado.tipo}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{elementoSeleccionado.id}</span>
                </div>

                {/* Contenido / texto */}
                {elementoSeleccionado.contenido !== undefined && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Contenido (soporta variables)</label>
                    <textarea
                      rows={3}
                      value={elementoSeleccionado.contenido}
                      onChange={(e) => actualizarElemento(elementoSeleccionado.id, "contenido", e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-[#C1401E] font-mono"
                    />
                    {/* Variables por categoría */}
                    <div className="mt-1 space-y-1">
                      {Object.entries(VARIABLES).map(([cat, vars]) => (
                        <div key={cat}>
                          <button
                            type="button"
                            onClick={() => setVarOpen((s) => ({ ...s, [cat]: !s[cat] }))}
                            className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-[#C1401E] uppercase"
                          >
                            {varOpen[cat] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {cat}
                          </button>
                          {varOpen[cat] && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5 pl-3">
                              {vars.map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => actualizarElemento(elementoSeleccionado.id, "contenido", `${elementoSeleccionado.contenido || ""} ${v}`.trim())}
                                  className="text-[9px] bg-slate-100 hover:bg-[#C1401E] hover:text-white text-slate-700 px-1 py-0.5 rounded font-mono transition"
                                >
                                  {v}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Etiqueta (para totales_linea) */}
                {elementoSeleccionado.tipo === "totales_linea" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Etiqueta</label>
                    <input
                      type="text"
                      value={elementoSeleccionado.etiqueta || ""}
                      onChange={(e) => actualizarElemento(elementoSeleccionado.id, "etiqueta", e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded"
                    />
                  </div>
                )}

                {/* Alineación */}
                {elementoSeleccionado.align !== undefined && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Alineación</label>
                    <div className="grid grid-cols-3 gap-1">
                      {["left", "center", "right"].map((al) => (
                        <button
                          key={al}
                          type="button"
                          onClick={() => actualizarElemento(elementoSeleccionado.id, "align", al)}
                          className={`py-1 text-xs capitalize rounded border flex items-center justify-center gap-1 transition ${
                            elementoSeleccionado.align === al ? "border-[#C1401E] bg-red-50 text-[#C1401E] font-bold" : "border-slate-200 text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          {al === "left" ? <AlignLeft className="w-3 h-3" /> : al === "center" ? <AlignCenter className="w-3 h-3" /> : <AlignRight className="w-3 h-3" />}
                          {al}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tamaño fuente + negrita */}
                {elementoSeleccionado.font_size !== undefined && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Tamaño: {elementoSeleccionado.font_size}pt</label>
                      <input
                        type="range" min={6} max={24}
                        value={elementoSeleccionado.font_size}
                        onChange={(e) => actualizarElemento(elementoSeleccionado.id, "font_size", parseInt(e.target.value))}
                        className="w-full accent-[#C1401E]"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-4">
                      <input
                        type="checkbox" id="bold_chk"
                        checked={!!elementoSeleccionado.bold}
                        onChange={(e) => actualizarElemento(elementoSeleccionado.id, "bold", e.target.checked)}
                        className="accent-[#C1401E]"
                      />
                      <label htmlFor="bold_chk" className="text-xs font-semibold text-slate-700 cursor-pointer">Negrita</label>
                    </div>
                  </div>
                )}

                {/* COLOR DE TEXTO */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Color de texto</label>
                  <ColorPicker
                    value={elementoSeleccionado.color}
                    onChange={(v) => actualizarElemento(elementoSeleccionado.id, "color", v)}
                    label="Color de texto"
                  />
                </div>

                {/* COLOR DE FONDO */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Color de fondo</label>
                  <ColorPicker
                    value={elementoSeleccionado.bg_color}
                    onChange={(v) => actualizarElemento(elementoSeleccionado.id, "bg_color", v)}
                    label="Color de fondo"
                  />
                </div>

                {/* Altura (para espaciador) */}
                {elementoSeleccionado.tipo === "espaciador" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Altura: {elementoSeleccionado.altura || 8}px</label>
                    <input
                      type="range" min={2} max={40}
                      value={elementoSeleccionado.altura || 8}
                      onChange={(e) => actualizarElemento(elementoSeleccionado.id, "altura", parseInt(e.target.value))}
                      className="w-full accent-[#C1401E]"
                    />
                  </div>
                )}

                {/* Leyenda firmas */}
                {elementoSeleccionado.tipo === "bloque_firmas" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Leyenda</label>
                    <input
                      type="text"
                      value={elementoSeleccionado.leyenda || ""}
                      onChange={(e) => actualizarElemento(elementoSeleccionado.id, "leyenda", e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded"
                    />
                  </div>
                )}

                {/* Condición de visibilidad */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Condición (opcional)</label>
                  <input
                    type="text"
                    placeholder="ej: doc.saldo > 0"
                    value={elementoSeleccionado.condicion || ""}
                    onChange={(e) => actualizarElemento(elementoSeleccionado.id, "condicion", e.target.value)}
                    className="w-full text-xs p-2 border border-slate-300 rounded font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Se muestra solo cuando la condición se cumple.</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs">
                <LayoutTemplate className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Selecciona un elemento para editar sus propiedades
              </div>
            )}

            {/* SIMULADOR */}
            <div className="pt-4 border-t border-slate-200">
              <span className="font-bold text-xs text-slate-700 flex items-center gap-1.5 mb-3">
                <Sliders className="w-3.5 h-3.5" style={{ color: "#C1401E" }} />
                SIMULADOR DE DATOS
              </span>
              <div className="flex bg-slate-100 p-0.5 rounded text-[10px] mb-3">
                {["sintetico", "real"].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setSimMode(m); if (m === "sintetico") ejecutarSimulacion(selectedTemplateId, config, m, numItems, ""); }}
                    className={`flex-1 py-1 rounded capitalize transition ${simMode === m ? "bg-white font-bold shadow-sm" : "text-slate-500"}`}
                    style={simMode === m ? { color: "#C1401E" } : {}}
                  >
                    {m === "sintetico" ? "Sintético" : "Venta Real"}
                  </button>
                ))}
              </div>
              {simMode === "sintetico" ? (
                <div className="bg-slate-50 p-3 rounded border text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Partidas:</span>
                    <b style={{ color: "#C1401E" }}>{numItems}</b>
                  </div>
                  <input
                    type="range" min={1} max={20} value={numItems}
                    onChange={(e) => { const v = parseInt(e.target.value); setNumItems(v); ejecutarSimulacion(selectedTemplateId, config, "sintetico", v, ""); }}
                    className="w-full accent-[#C1401E]"
                  />
                </div>
              ) : (
                <div className="bg-slate-50 p-3 rounded border text-xs space-y-2">
                  <label className="text-slate-600">Folio o ID de venta:</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text" placeholder="ej. V-00124"
                      value={realDocId}
                      onChange={(e) => setRealDocId(e.target.value)}
                      className="flex-1 p-1.5 border rounded text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => ejecutarSimulacion(selectedTemplateId, config, "real", numItems, realDocId)}
                      className="px-2.5 py-1 font-bold text-white rounded text-xs"
                      style={{ background: "#C1401E" }}
                    >
                      Cargar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
