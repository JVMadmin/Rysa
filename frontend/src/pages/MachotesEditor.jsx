import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileText, Save, RefreshCw, Eye, EyeOff, Plus, Trash2, ArrowUp, ArrowDown, Copy, History,
  CheckCircle2, RotateCcw, Undo2, Redo2, Lock, Layers, Settings2, Image as ImageIcon, Type,
  Minus, MoveVertical, Table2, Sigma, QrCode, PenLine, Landmark, CreditCard, Columns2, ListTree,
  FileStack, ChevronRight, AlertTriangle, Upload, Sparkles,
} from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

// ════════════════════════════════════════════════════════════════════════
// Catálogos
// ════════════════════════════════════════════════════════════════════════
const COLORES = ["#C1401E", "#1F1F1F", "#6B7280", "#F4ECE7", "#E5E0DA", "#FFFFFF", "#000000", "#1E3A5F", "#15803D", "#DC2626", "#EA580C", "#FDF4F0"];

const TIPOS_BLOQUE = {
  texto: { label: "Texto", icon: Type, grupo: "Básicos" },
  separador: { label: "Separador", icon: Minus, grupo: "Básicos" },
  espacio: { label: "Espacio", icon: MoveVertical, grupo: "Básicos" },
  salto_pagina: { label: "Salto de página", icon: FileStack, grupo: "Básicos" },
  logo: { label: "Logotipo", icon: Sparkles, grupo: "Marca" },
  imagen: { label: "Imagen", icon: ImageIcon, grupo: "Marca" },
  campos: { label: "Campos (etiqueta: valor)", icon: ListTree, grupo: "Datos" },
  tabla_items: { label: "Tabla de productos", icon: Table2, grupo: "Datos" },
  totales: { label: "Totales", icon: Sigma, grupo: "Datos" },
  pagos: { label: "Formas de pago", icon: CreditCard, grupo: "Datos" },
  cuentas_bancarias: { label: "Cuentas bancarias", icon: Landmark, grupo: "Datos" },
  qr: { label: "Código QR", icon: QrCode, grupo: "Datos" },
  firmas: { label: "Firmas", icon: PenLine, grupo: "Datos" },
  columnas: { label: "Columnas", icon: Columns2, grupo: "Diseño" },
};

// Plantillas rápidas que se insertan desde la paleta.
const PRESETS = [
  { label: "Título del documento", grupo: "Básicos", bloque: { tipo: "texto", contenido: "<b>{{doc.titulo}}</b>", estilo: { tamano: 15, color: "#C1401E" } } },
  { label: "Importe con letra", grupo: "Datos", bloque: { tipo: "texto", contenido: "Son: <b>({{doc.total_letra}})</b>", estilo: { cursiva: true, color: "#6B7280" } } },
  { label: "Datos del cliente", grupo: "Datos", bloque: { tipo: "campos", titulo: "CLIENTE", titulo_fondo: "#F4ECE7", titulo_color: "#C1401E", columnas: 2, campos: [
    { etiqueta: "Nombre", valor: "{{cliente.nombre}}" }, { etiqueta: "RFC", valor: "{{cliente.rfc}}" },
    { etiqueta: "Teléfono", valor: "{{cliente.telefono}}" }, { etiqueta: "Dirección", valor: "{{cliente.direccion_completa}}" }],
    estilo: { borde: { ancho: 0.6, color: "#E5E0DA" } } } },
  { label: "Encabezado de empresa", grupo: "Marca", bloque: { tipo: "columnas", alinear_vertical: "centro", columnas: [
    { ancho: 30, bloques: [{ tipo: "logo", fuente: "oficial", ancho_mm: 48, alto_mm: 24, estilo: { align: "left" } }] },
    { ancho: 70, bloques: [
      { tipo: "texto", contenido: "<b>{{empresa.nombre}}</b>", estilo: { tamano: 14, color: "#C1401E", align: "right" } },
      { tipo: "texto", contenido: "RFC: {{empresa.rfc}}<br/>{{empresa.direccion_completa}}<br/>Tel: {{empresa.telefono}}", estilo: { tamano: 8.5, color: "#6B7280", align: "right" } }] }] } },
  { label: "Banda de título", grupo: "Diseño", bloque: { tipo: "texto", contenido: "<b>{{doc.titulo}}</b>", estilo: { align: "center", tamano: 14, color: "#FFFFFF", fondo: "#C1401E", padding: [2.5, 0, 2.5, 0] } } },
  { label: "Nota / condiciones", grupo: "Básicos", bloque: { tipo: "texto", contenido: "Precios sujetos a cambio sin previo aviso.", estilo: { tamano: 7.5, color: "#6B7280", align: "center" } } },
];

const CAMPOS_ITEM = { numero: "#", cantidad: "Cantidad", unidad: "Unidad", presentacion: "Presentación", codigo: "Código", descripcion: "Descripción", precio: "Precio", descuento: "Descuento", descuento_pct: "% Desc.", iva: "IVA", importe: "Importe", comentario: "Comentario" };
const CAMPOS_TOTAL = { subtotal: "Subtotal", descuento: "Descuento", iva: "IVA", total: "Total", recibido: "Recibido", cambio: "Cambio", saldo: "Saldo pendiente", articulos: "Artículos", monto: "Monto", saldo_anterior: "Saldo anterior", saldo_restante: "Saldo restante", otros_impuestos: "Otros impuestos", costos_adicionales: "Costos adicionales", efectivo_en_caja: "Efectivo en caja", custom: "Personalizado" };

const VARS_COMUNES = {
  Empresa: ["empresa.nombre", "empresa.razon_social", "empresa.rfc", "empresa.direccion", "empresa.direccion_completa", "empresa.ciudad", "empresa.estado", "empresa.cp", "empresa.telefono", "empresa.correo", "empresa.web", "empresa.whatsapp"],
};
const VARS_POR_TIPO = {
  venta: {
    Documento: ["doc.folio", "doc.titulo", "doc.fecha", "doc.hora", "doc.fecha_hora", "doc.fecha_vencimiento", "doc.condicion_txt", "doc.forma_pago", "doc.vendedor", "doc.cajero", "doc.sucursal", "doc.notas", "doc.articulos", "doc.qr_verificar", "doc.qr_pago"],
    Importes: ["doc.subtotal", "doc.descuento", "doc.iva", "doc.iva_tasas", "doc.total", "doc.total_letra", "doc.recibido", "doc.cambio", "doc.saldo"],
    Cliente: ["cliente.nombre", "cliente.codigo", "cliente.rfc", "cliente.telefono", "cliente.correo", "cliente.direccion", "cliente.colonia", "cliente.cp", "cliente.ciudad", "cliente.estado", "cliente.direccion_completa"],
  },
  abono: {
    Documento: ["doc.folio", "doc.titulo", "doc.fecha", "doc.hora", "doc.usuario", "doc.sucursal", "doc.documento", "doc.documentos", "doc.metodo", "doc.referencia", "doc.notas"],
    Importes: ["doc.monto", "doc.total_letra", "doc.saldo_anterior", "doc.saldo_restante"],
    Cliente: ["cliente.nombre", "cliente.rfc", "cliente.telefono", "cliente.correo"],
  },
  compra: {
    Documento: ["doc.folio", "doc.titulo", "doc.tipo", "doc.fecha", "doc.factura", "doc.usuario", "doc.notas", "doc.documentos"],
    Importes: ["doc.subtotal", "doc.descuento", "doc.iva", "doc.otros_impuestos", "doc.costos_adicionales", "doc.total", "doc.total_letra", "doc.saldo"],
    Proveedor: ["proveedor.nombre", "proveedor.rfc", "proveedor.telefono", "proveedor.correo", "proveedor.direccion"],
  },
  entrega: {
    Documento: ["doc.folio", "doc.titulo", "doc.fecha", "doc.hora", "doc.caja", "doc.usuario", "doc.concepto", "doc.referencia"],
    Importes: ["doc.monto", "doc.efectivo_en_caja"],
  },
};
const grupoVars = (tipo) => ({ ...(VARS_POR_TIPO[["ticket", "carta_venta", "cotizacion"].includes(tipo) ? "venta" : tipo] || {}), ...VARS_COMUNES });

const nid = () => "b_" + Math.random().toString(36).slice(2, 12);
const clone = (o) => JSON.parse(JSON.stringify(o));
const conIds = (b) => { const c = { ...b, id: nid(), visible: b.visible !== false }; if (Array.isArray(c.columnas) && c.columnas.some((x) => x && Array.isArray(x.bloques))) c.columnas = c.columnas.map((col) => ({ ...col, bloques: (col.bloques || []).map(conIds) })); return c; };

// ── Árbol de bloques: una ruta es [i] o [i, columna, j, ...] ────────────
const esContenedor = (b) => b?.tipo === "columnas" && Array.isArray(b.columnas);
function listaEn(bloques, pref) {
  if (!pref.length) return bloques;
  const [i, c, ...rest] = pref;
  return listaEn(bloques[i]?.columnas?.[c]?.bloques || [], rest);
}
function conLista(bloques, pref, fn) {
  if (!pref.length) return fn([...bloques]);
  const [i, c, ...rest] = pref;
  return bloques.map((b, k) => (k !== i ? b : { ...b, columnas: b.columnas.map((col, ci) => (ci !== c ? col : { ...col, bloques: conLista(col.bloques || [], rest, fn) })) }));
}
const bloqueEn = (bloques, ruta) => (ruta?.length ? listaEn(bloques, ruta.slice(0, -1))[ruta[ruta.length - 1]] : null);
const mismaRuta = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

function resumen(b) {
  const quitar = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  switch (b.tipo) {
    case "texto": return quitar(b.contenido).slice(0, 60) || "(vacío)";
    case "campos": return (b.titulo ? b.titulo + " · " : "") + (b.campos || []).map((c) => c.etiqueta).filter(Boolean).slice(0, 4).join(", ");
    case "tabla_items": return b.modo === "lista" ? "Lista estilo ticket" : (b.columnas || []).map((c) => c.titulo || CAMPOS_ITEM[c.campo]).join(" · ");
    case "totales": return (b.filas || []).map((f) => f.etiqueta || CAMPOS_TOTAL[f.campo]).join(", ");
    case "logo": return { oficial: "Logotipo oficial", isotipo: "Isotipo GR", configuracion: "Logo de Configuración", imagen: "Imagen subida" }[b.fuente || "oficial"];
    case "qr": return quitar(b.contenido) || "{{doc.qr_verificar}}";
    case "separador": return { solida: "Línea sólida", punteada: "Punteada", guiones: "Guiones", doble: "Doble" }[b.linea || "solida"];
    case "espacio": return `${b.alto_mm || 4} mm`;
    case "firmas": return (b.firmas || []).map(quitar).join(" · ");
    case "columnas": return `${(b.columnas || []).length} columnas`;
    default: return "";
  }
}

// ════════════════════════════════════════════════════════════════════════
// Controles reutilizables
// ════════════════════════════════════════════════════════════════════════
const Campo = ({ label, children, ayuda }) => (
  <div className="space-y-1">
    <Label className="text-[11px] uppercase tracking-wider text-slate-500">{label}</Label>
    {children}
    {ayuda && <p className="text-[11px] text-slate-400">{ayuda}</p>}
  </div>
);
const Sel = ({ value, onChange, opciones, disabled }) => (
  <select disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
    className="w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-sm disabled:bg-slate-50">
    {Object.entries(opciones).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);
const Num = ({ value, onChange, min, max, step = 0.5, disabled, placeholder }) => (
  <Input type="number" disabled={disabled} value={value ?? ""} min={min} max={max} step={step} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="h-9" />
);
function ColorIn({ value, onChange, disabled, permitirVacio = true }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input type="color" disabled={disabled} value={value || "#000000"} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 rounded border border-slate-200 bg-white p-0.5" />
        <Input disabled={disabled} value={value || ""} placeholder={permitirVacio ? "Sin color" : "#000000"} onChange={(e) => onChange(e.target.value || undefined)} className="h-9 font-mono text-xs" />
        {permitirVacio && value && !disabled && <button onClick={() => onChange(undefined)} className="text-xs text-slate-400 hover:text-red-600">Quitar</button>}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-1">
          {COLORES.map((c) => <button key={c} title={c} onClick={() => onChange(c)} className={`h-5 w-5 rounded border ${value === c ? "ring-2 ring-[#C1401E] ring-offset-1" : "border-slate-300"}`} style={{ background: c }} />)}
        </div>
      )}
    </div>
  );
}
const Interruptor = ({ label, checked, onChange, disabled }) => (
  <label className="flex items-center justify-between gap-3 py-1 text-sm text-slate-700">
    <span>{label}</span>
    <Switch disabled={disabled} checked={!!checked} onCheckedChange={onChange} />
  </label>
);

function InsertarVariable({ tipo, onInsert, disabled }) {
  const grupos = grupoVars(tipo);
  return (
    <select disabled={disabled} value="" onChange={(e) => { if (e.target.value) onInsert(`{{${e.target.value}}}`); }}
      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600">
      <option value="">+ Insertar variable…</option>
      {Object.entries(grupos).map(([g, vs]) => (
        <optgroup key={g} label={g}>{vs.map((v) => <option key={v} value={v}>{v}</option>)}</optgroup>
      ))}
    </select>
  );
}

function TextoConVariables({ value, onChange, tipo, disabled, rows = 3, placeholder }) {
  const ref = useRef(null);
  const insertar = (txt) => {
    const el = ref.current;
    const v = value || "";
    if (!el) return onChange(v + txt);
    const a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length;
    onChange(v.slice(0, a) + txt + v.slice(b));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + txt.length; });
  };
  const envolver = (tag) => {
    const el = ref.current; const v = value || "";
    const a = el?.selectionStart ?? v.length, b = el?.selectionEnd ?? v.length;
    onChange(v.slice(0, a) + `<${tag}>` + v.slice(a, b) + `</${tag}>` + v.slice(b));
  };
  return (
    <div className="space-y-1.5">
      <Textarea ref={ref} disabled={disabled} rows={rows} value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1">
          <InsertarVariable tipo={tipo} onInsert={insertar} />
          <button onClick={() => envolver("b")} className="h-8 w-8 rounded border border-slate-200 text-xs font-bold">B</button>
          <button onClick={() => envolver("i")} className="h-8 w-8 rounded border border-slate-200 text-xs italic">I</button>
          <button onClick={() => envolver("u")} className="h-8 w-8 rounded border border-slate-200 text-xs underline">U</button>
          <button onClick={() => insertar("<br/>")} className="h-8 rounded border border-slate-200 px-2 text-[11px]">salto</button>
        </div>
      )}
    </div>
  );
}

// Lista editable genérica (filas de campos, columnas, totales, firmas…)
function ListaEditable({ items, onChange, nuevo, render, disabled, etiquetaAgregar = "Agregar" }) {
  const set = (i, v) => onChange(items.map((x, k) => (k === i ? v : x)));
  const mover = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="rounded-md border border-slate-200 bg-slate-50/60 p-2">
          <div className="mb-1 flex items-center justify-end gap-1">
            {!disabled && <>
              <button onClick={() => mover(i, -1)} className="text-slate-400 hover:text-slate-700"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button onClick={() => mover(i, 1)} className="text-slate-400 hover:text-slate-700"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button onClick={() => onChange(items.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </>}
          </div>
          {render(it, (v) => set(i, v))}
        </div>
      ))}
      {!disabled && <Button size="sm" variant="outline" onClick={() => onChange([...(items || []), nuevo()])}><Plus className="mr-1 h-3.5 w-3.5" />{etiquetaAgregar}</Button>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Inspector: contenido por tipo de bloque
// ════════════════════════════════════════════════════════════════════════
function EditorContenido({ b, set, tipo, ro }) {
  const p = (k) => (v) => set({ ...b, [k]: v });
  const subirImagen = async (file) => {
    const fd = new FormData(); fd.append("file", file);
    try { const r = await api.post("/uploads/image", fd); set({ ...b, imagen_url: r.data.url, ...(b.tipo === "logo" ? { fuente: "imagen" } : {}) }); toast.success("Imagen cargada"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  switch (b.tipo) {
    case "texto":
      return <Campo label="Contenido" ayuda="Variables {{...}} y marcas <b> <i> <u> <br/>. Las variables vacías no imprimen nada.">
        <TextoConVariables value={b.contenido} onChange={p("contenido")} tipo={tipo} disabled={ro} rows={5} /></Campo>;
    case "logo":
    case "imagen":
      return <div className="space-y-3">
        {b.tipo === "logo" && <Campo label="Origen del logotipo"><Sel disabled={ro} value={b.fuente || "oficial"} onChange={p("fuente")} opciones={{ oficial: "Logotipo oficial Grupo RYSA", isotipo: "Isotipo GR", configuracion: "Logo de Configuración", imagen: "Imagen subida" }} /></Campo>}
        {(b.tipo === "imagen" || b.fuente === "imagen") && <Campo label="Imagen">
          {b.imagen_url && <img src={b.imagen_url} alt="" className="mb-2 max-h-24 rounded border" />}
          {!ro && <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
            <Upload className="h-4 w-4" />Subir imagen (JPG, PNG, WEBP)
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && subirImagen(e.target.files[0])} /></label>}
        </Campo>}
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Ancho máx. (mm)"><Num disabled={ro} value={b.ancho_mm} onChange={p("ancho_mm")} min={5} max={200} /></Campo>
          <Campo label="Alto máx. (mm)"><Num disabled={ro} value={b.alto_mm} onChange={p("alto_mm")} min={5} max={200} /></Campo>
        </div>
        <p className="text-[11px] text-slate-400">Se respeta siempre la proporción real de la imagen.</p>
      </div>;
    case "campos":
      return <div className="space-y-3">
        <Campo label="Título del recuadro (opcional)"><Input disabled={ro} value={b.titulo || ""} onChange={(e) => set({ ...b, titulo: e.target.value })} className="h-9" /></Campo>
        {b.titulo && <div className="grid grid-cols-2 gap-2">
          <Campo label="Fondo del título"><ColorIn disabled={ro} value={b.titulo_fondo} onChange={p("titulo_fondo")} /></Campo>
          <Campo label="Color del título"><ColorIn disabled={ro} value={b.titulo_color} onChange={p("titulo_color")} /></Campo>
        </div>}
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Columnas"><Sel disabled={ro} value={String(b.columnas || 1)} onChange={(v) => set({ ...b, columnas: Number(v) })} opciones={{ 1: "1", 2: "2", 3: "3", 4: "4" }} /></Campo>
          <Campo label="Separador"><Input disabled={ro} value={b.separador ?? ":"} onChange={(e) => set({ ...b, separador: e.target.value })} className="h-9" /></Campo>
        </div>
        <Interruptor disabled={ro} label="Etiquetas en negrita" checked={b.etiqueta_negrita !== false} onChange={p("etiqueta_negrita")} />
        <ListaEditable disabled={ro} items={b.campos || []} onChange={p("campos")} etiquetaAgregar="Agregar campo"
          nuevo={() => ({ etiqueta: "Nuevo", valor: "", ocultar_si_vacio: true })}
          render={(c, sc) => <div className="space-y-1.5">
            <Input disabled={ro} value={c.etiqueta || ""} placeholder="Etiqueta" onChange={(e) => sc({ ...c, etiqueta: e.target.value })} className="h-8 text-xs" />
            <div className="flex gap-1"><Input disabled={ro} value={c.valor || ""} placeholder="Valor / variable" onChange={(e) => sc({ ...c, valor: e.target.value })} className="h-8 font-mono text-xs" />
              {!ro && <InsertarVariable tipo={tipo} onInsert={(v) => sc({ ...c, valor: (c.valor || "") + v })} />}</div>
            <Interruptor disabled={ro} label="Ocultar si está vacío" checked={c.ocultar_si_vacio !== false} onChange={(v) => sc({ ...c, ocultar_si_vacio: v })} />
          </div>} />
      </div>;
    case "tabla_items": {
      const enc = b.encabezado || {};
      return <div className="space-y-3">
        <Campo label="Presentación"><Sel disabled={ro} value={b.modo || "tabla"} onChange={p("modo")} opciones={{ tabla: "Tabla con columnas", lista: "Lista estilo ticket" }} /></Campo>
        {b.modo === "lista" ? <>
          <Campo label="Título"><Input disabled={ro} value={b.titulo ?? "DESCRIPCIÓN"} onChange={(e) => set({ ...b, titulo: e.target.value })} className="h-9" /></Campo>
          <Campo label="Línea de importes" ayuda="Variables de la partida: {{cantidad}} {{unidad}} {{precio}} {{importe}} {{codigo}} {{descuento}}">
            <Input disabled={ro} value={b.plantilla_linea || ""} onChange={(e) => set({ ...b, plantilla_linea: e.target.value })} className="h-9 font-mono text-xs" /></Campo>
        </> : <>
          <Label className="text-[11px] uppercase tracking-wider text-slate-500">Columnas (el ancho es proporcional)</Label>
          <ListaEditable disabled={ro} items={b.columnas || []} onChange={p("columnas")} etiquetaAgregar="Agregar columna"
            nuevo={() => ({ campo: "codigo", titulo: "Código", ancho: 15 })}
            render={(c, sc) => <div className="grid grid-cols-2 gap-1.5">
              <Sel disabled={ro} value={c.campo} onChange={(v) => sc({ ...c, campo: v, titulo: c.titulo || CAMPOS_ITEM[v] })} opciones={CAMPOS_ITEM} />
              <Input disabled={ro} value={c.titulo || ""} placeholder="Título" onChange={(e) => sc({ ...c, titulo: e.target.value })} className="h-9 text-xs" />
              <Num disabled={ro} value={c.ancho} onChange={(v) => sc({ ...c, ancho: v })} min={1} step={1} placeholder="Ancho" />
              <Sel disabled={ro} value={c.align || ""} onChange={(v) => sc({ ...c, align: v || undefined })} opciones={{ "": "Alineación auto", left: "Izquierda", center: "Centro", right: "Derecha" }} />
            </div>} />
          <div className="rounded-md border border-slate-200 p-2 space-y-2">
            <Interruptor disabled={ro} label="Mostrar encabezado" checked={enc.visible !== false} onChange={(v) => set({ ...b, encabezado: { ...enc, visible: v } })} />
            <div className="grid grid-cols-2 gap-2">
              <Campo label="Fondo encabezado"><ColorIn disabled={ro} value={enc.fondo} onChange={(v) => set({ ...b, encabezado: { ...enc, fondo: v } })} /></Campo>
              <Campo label="Texto encabezado"><ColorIn disabled={ro} value={enc.color} onChange={(v) => set({ ...b, encabezado: { ...enc, color: v } })} /></Campo>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Bordes"><Sel disabled={ro} value={b.bordes || "cuadricula"} onChange={p("bordes")} opciones={{ cuadricula: "Cuadrícula", horizontal: "Solo horizontales", exterior: "Solo contorno", encabezado: "Bajo encabezado", ninguno: "Sin bordes" }} /></Campo>
            <Campo label="Grosor borde (pt)"><Num disabled={ro} value={b.grosor_borde} onChange={p("grosor_borde")} min={0.1} max={3} step={0.1} /></Campo>
            <Campo label="Color de borde"><ColorIn disabled={ro} value={b.color_borde} onChange={p("color_borde")} /></Campo>
            <Campo label="Filas alternas (cebra)"><ColorIn disabled={ro} value={b.zebra} onChange={p("zebra")} /></Campo>
            <Campo label="Relleno de celda (mm)"><Num disabled={ro} value={b.padding_celda} onChange={p("padding_celda")} min={0} max={6} step={0.2} /></Campo>
          </div>
          <Interruptor disabled={ro} label="Código bajo la descripción" checked={b.mostrar_codigo_bajo_descripcion} onChange={p("mostrar_codigo_bajo_descripcion")} />
        </>}
        <Interruptor disabled={ro} label="Mostrar descuento por partida" checked={b.mostrar_descuento !== false} onChange={p("mostrar_descuento")} />
        <Interruptor disabled={ro} label="Mostrar comentarios de partida" checked={b.mostrar_comentario !== false} onChange={p("mostrar_comentario")} />
      </div>;
    }
    case "totales": {
      const d = b.destacado || {};
      return <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Posición"><Sel disabled={ro} value={b.posicion || "derecha"} onChange={p("posicion")} opciones={{ derecha: "Derecha", izquierda: "Izquierda", centro: "Centro", completo: "Ancho completo" }} /></Campo>
          <Campo label="Ancho (%)"><Num disabled={ro} value={b.ancho_pct} onChange={p("ancho_pct")} min={20} max={100} step={1} /></Campo>
        </div>
        <Interruptor disabled={ro} label='Dos puntos tras la etiqueta (":")' checked={b.dos_puntos !== false} onChange={p("dos_puntos")} />
        <ListaEditable disabled={ro} items={b.filas || []} onChange={p("filas")} etiquetaAgregar="Agregar renglón"
          nuevo={() => ({ campo: "custom", etiqueta: "Concepto", valor: "" })}
          render={(f, sf) => <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <Sel disabled={ro} value={f.campo || "custom"} onChange={(v) => sf({ ...f, campo: v })} opciones={CAMPOS_TOTAL} />
              <Input disabled={ro} value={f.etiqueta || ""} placeholder={CAMPOS_TOTAL[f.campo] || "Etiqueta"} onChange={(e) => sf({ ...f, etiqueta: e.target.value })} className="h-9 text-xs" />
            </div>
            {f.campo === "custom" && <Input disabled={ro} value={f.valor || ""} placeholder="Valor, ej. {{doc.metodo}}" onChange={(e) => sf({ ...f, valor: e.target.value })} className="h-8 font-mono text-xs" />}
            <div className="grid grid-cols-2 gap-x-3">
              <Interruptor disabled={ro} label="Destacar" checked={f.destacar || f.campo === "total"} onChange={(v) => sf({ ...f, destacar: v })} />
              <Interruptor disabled={ro} label="Ocultar si es 0" checked={f.ocultar_si_cero ?? !["total", "subtotal"].includes(f.campo)} onChange={(v) => sf({ ...f, ocultar_si_cero: v })} />
            </div>
            <Campo label="Color del renglón"><ColorIn disabled={ro} value={f.color} onChange={(v) => sf({ ...f, color: v })} /></Campo>
          </div>} />
        <div className="rounded-md border border-slate-200 p-2 space-y-2">
          <p className="text-xs font-semibold text-slate-600">Renglones destacados (total)</p>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Tamaño (pt)"><Num disabled={ro} value={d.tamano} onChange={(v) => set({ ...b, destacado: { ...d, tamano: v } })} min={6} max={30} /></Campo>
            <Campo label="Color"><ColorIn disabled={ro} value={d.color} onChange={(v) => set({ ...b, destacado: { ...d, color: v } })} /></Campo>
            <Campo label="Fondo"><ColorIn disabled={ro} value={d.fondo} onChange={(v) => set({ ...b, destacado: { ...d, fondo: v } })} /></Campo>
          </div>
          <Interruptor disabled={ro} label="Línea superior" checked={d.linea_superior !== false} onChange={(v) => set({ ...b, destacado: { ...d, linea_superior: v } })} />
        </div>
      </div>;
    }
    case "qr":
      return <div className="space-y-3">
        <Campo label="Contenido del QR"><Sel disabled={ro} value={["{{doc.qr_verificar}}", "{{doc.qr_pago}}"].includes(b.contenido) ? b.contenido : "otro"}
          onChange={(v) => set({ ...b, contenido: v === "otro" ? "" : v })} opciones={{ "{{doc.qr_verificar}}": "Verificación del ticket", "{{doc.qr_pago}}": "Enviar comprobante de pago (cotización)", otro: "Texto o URL personalizada" }} /></Campo>
        {!["{{doc.qr_verificar}}", "{{doc.qr_pago}}"].includes(b.contenido) && <Input disabled={ro} value={b.contenido || ""} placeholder="https://… o texto con variables" onChange={(e) => set({ ...b, contenido: e.target.value })} className="h-9 font-mono text-xs" />}
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Tamaño (mm)"><Num disabled={ro} value={b.tamano_mm} onChange={p("tamano_mm")} min={10} max={80} /></Campo>
          <Campo label="Leyenda"><Sel disabled={ro} value={b.disposicion || "abajo"} onChange={p("disposicion")} opciones={{ abajo: "Debajo del QR", derecha: "A la derecha" }} /></Campo>
        </div>
        <Campo label="Texto de la leyenda (opcional)"><TextoConVariables value={b.leyenda} onChange={p("leyenda")} tipo={tipo} disabled={ro} rows={2} /></Campo>
      </div>;
    case "firmas":
      return <div className="space-y-3">
        <ListaEditable disabled={ro} items={b.firmas || []} onChange={p("firmas")} etiquetaAgregar="Agregar firma" nuevo={() => "Firma"}
          render={(f, sf) => <Input disabled={ro} value={f} onChange={(e) => sf(e.target.value)} className="h-8 text-xs" />} />
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Espacio para firmar (mm)"><Num disabled={ro} value={b.espacio_mm} onChange={p("espacio_mm")} min={2} max={60} /></Campo>
          <Campo label="Ancho de línea (%)"><Num disabled={ro} value={b.ancho_linea_pct} onChange={p("ancho_linea_pct")} min={10} max={100} step={5} /></Campo>
        </div>
      </div>;
    case "cuentas_bancarias":
      return <div className="space-y-3">
        <Campo label="Título (opcional)"><Input disabled={ro} value={b.titulo || ""} onChange={(e) => set({ ...b, titulo: e.target.value })} className="h-9" /></Campo>
        <Interruptor disabled={ro} label="Mostrar logo del banco" checked={b.mostrar_logo !== false} onChange={p("mostrar_logo")} />
        <p className="text-[11px] text-slate-400">Usa las cuentas activas de Configuración → Cuentas bancarias.</p>
      </div>;
    case "pagos":
      return <Campo label="Título (opcional)"><Input disabled={ro} value={b.titulo || ""} onChange={(e) => set({ ...b, titulo: e.target.value })} className="h-9" /></Campo>;
    case "separador":
      return <div className="grid grid-cols-2 gap-2">
        <Campo label="Tipo de línea"><Sel disabled={ro} value={b.linea || "solida"} onChange={p("linea")} opciones={{ solida: "Sólida", punteada: "Punteada", guiones: "Guiones", doble: "Doble" }} /></Campo>
        <Campo label="Grosor (pt)"><Num disabled={ro} value={b.grosor} onChange={p("grosor")} min={0.1} max={6} step={0.1} /></Campo>
        <Campo label="Ancho (%)"><Num disabled={ro} value={b.ancho_pct} onChange={p("ancho_pct")} min={5} max={100} step={5} /></Campo>
        <Campo label="Color"><ColorIn disabled={ro} value={b.color} onChange={p("color")} /></Campo>
        <Campo label="Espacio antes (mm)"><Num disabled={ro} value={b.espacio_antes} onChange={p("espacio_antes")} min={0} max={30} /></Campo>
        <Campo label="Espacio después (mm)"><Num disabled={ro} value={b.espacio_despues} onChange={p("espacio_despues")} min={0} max={30} /></Campo>
      </div>;
    case "espacio":
      return <Campo label="Alto (mm)"><Num disabled={ro} value={b.alto_mm} onChange={p("alto_mm")} min={0.5} max={200} /></Campo>;
    case "salto_pagina":
      return <p className="text-sm text-slate-500">Lo que sigue empieza en una hoja nueva (no aplica en térmico).</p>;
    case "columnas":
      return <div className="space-y-3">
        <ListaEditable disabled={ro} items={b.columnas || []} onChange={p("columnas")} etiquetaAgregar="Agregar columna"
          nuevo={() => ({ ancho: 50, bloques: [] })}
          render={(c, sc) => <div className="flex items-center gap-2 text-xs"><span className="text-slate-500">Ancho relativo</span>
            <Num disabled={ro} value={c.ancho} onChange={(v) => sc({ ...c, ancho: v })} min={1} step={1} />
            <span className="whitespace-nowrap text-slate-400">{(c.bloques || []).length} bloques</span></div>} />
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Separación (mm)"><Num disabled={ro} value={b.separacion_mm} onChange={p("separacion_mm")} min={0} max={40} /></Campo>
          <Campo label="Alineación vertical"><Sel disabled={ro} value={b.alinear_vertical || "arriba"} onChange={p("alinear_vertical")} opciones={{ arriba: "Arriba", centro: "Centro", abajo: "Abajo" }} /></Campo>
        </div>
        <p className="text-[11px] text-slate-400">Agrega bloques dentro de cada columna desde el panel de estructura.</p>
      </div>;
    default:
      return null;
  }
}

function EditorEstilo({ b, set, ro }) {
  const e = b.estilo || {};
  const s = (k) => (v) => set({ ...b, estilo: { ...e, [k]: v } });
  const pad = Array.isArray(e.padding) ? e.padding : [0, 0, 0, 0];
  const borde = e.borde || {};
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Fuente"><Sel disabled={ro} value={e.fuente || ""} onChange={(v) => s("fuente")(v || undefined)} opciones={{ "": "Heredar de la página", Helvetica: "Helvetica (sans)", Times: "Times (serif)", Courier: "Courier (mono)" }} /></Campo>
        <Campo label="Tamaño (pt)"><Num disabled={ro} value={e.tamano} onChange={s("tamano")} min={4} max={60} /></Campo>
      </div>
      <div className="flex flex-wrap gap-1">
        {[["negrita", "B", "font-bold"], ["cursiva", "I", "italic"], ["subrayado", "U", "underline"], ["mayusculas", "AA", ""]].map(([k, t, cls]) => (
          <button key={k} disabled={ro} onClick={() => s(k)(!e[k])} className={`h-8 min-w-8 rounded border px-2 text-xs ${cls} ${e[k] ? "border-[#C1401E] bg-[#C1401E]/10 text-[#C1401E]" : "border-slate-200"}`}>{t}</button>
        ))}
        <span className="mx-1 border-l" />
        {[["left", "Izq"], ["center", "Centro"], ["right", "Der"], ["justify", "Just"]].map(([v, t]) => (
          <button key={v} disabled={ro} onClick={() => s("align")(v)} className={`h-8 rounded border px-2 text-xs ${(e.align || "left") === v ? "border-[#C1401E] bg-[#C1401E]/10 text-[#C1401E]" : "border-slate-200"}`}>{t}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Color de texto"><ColorIn disabled={ro} value={e.color} onChange={s("color")} /></Campo>
        <Campo label="Fondo"><ColorIn disabled={ro} value={e.fondo} onChange={s("fondo")} /></Campo>
        <Campo label="Interlineado"><Num disabled={ro} value={e.interlineado} onChange={s("interlineado")} min={0.8} max={3} step={0.05} /></Campo>
      </div>
      <Campo label="Relleno interior (mm): arriba · derecha · abajo · izquierda">
        <div className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <Num key={i} disabled={ro} value={pad[i]} min={0} max={40} onChange={(v) => { const n = [...pad]; n[i] = v || 0; s("padding")(n); }} />)}</div>
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Margen arriba (mm)"><Num disabled={ro} value={e.margen_arriba} onChange={s("margen_arriba")} min={0} max={60} /></Campo>
        <Campo label="Margen abajo (mm)"><Num disabled={ro} value={e.margen_abajo} onChange={s("margen_abajo")} min={0} max={60} /></Campo>
      </div>
      <div className="rounded-md border border-slate-200 p-2">
        <p className="mb-2 text-xs font-semibold text-slate-600">Borde del bloque</p>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Grosor (pt)"><Num disabled={ro} value={borde.ancho} onChange={(v) => s("borde")({ ...borde, ancho: v })} min={0} max={6} step={0.1} /></Campo>
          <Campo label="Esquinas redondeadas"><Num disabled={ro} value={borde.radio} onChange={(v) => s("borde")({ ...borde, radio: v })} min={0} max={20} /></Campo>
          <Campo label="Color"><ColorIn disabled={ro} value={borde.color} onChange={(v) => s("borde")({ ...borde, color: v })} /></Campo>
        </div>
      </div>
    </div>
  );
}

function EditorVisibilidad({ b, set, tipo, ro }) {
  const c = typeof b.condicion === "object" && b.condicion ? b.condicion : null;
  const vars = Object.values(grupoVars(tipo)).flat().concat(["cuentas", "doc.subtotal_num", "doc.descuento_num", "doc.iva_num", "doc.total_num", "doc.saldo_num", "doc.condicion"]);
  return (
    <div className="space-y-3">
      <Interruptor disabled={ro} label="Bloque visible" checked={b.visible !== false} onChange={(v) => set({ ...b, visible: v })} />
      <Interruptor disabled={ro} label="Mostrar solo si se cumple una condición" checked={!!c} onChange={(v) => set({ ...b, condicion: v ? { variable: "doc.descuento_num", op: ">", valor: "0" } : undefined })} />
      {c && <div className="space-y-2 rounded-md border border-slate-200 p-2">
        <Campo label="Variable"><select disabled={ro} value={c.variable} onChange={(e) => set({ ...b, condicion: { ...c, variable: e.target.value } })} className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs font-mono">
          {[...new Set([c.variable, ...vars])].map((v) => <option key={v} value={v}>{v}</option>)}</select></Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Condición"><Sel disabled={ro} value={c.op} onChange={(v) => set({ ...b, condicion: { ...c, op: v } })} opciones={{ no_vacio: "tiene valor", vacio: "está vacío", ">": "mayor que", "<": "menor que", ">=": "mayor o igual", "<=": "menor o igual", "==": "igual a", "!=": "distinto de", contiene: "contiene" }} /></Campo>
          {!["vacio", "no_vacio"].includes(c.op) && <Campo label="Valor"><Input disabled={ro} value={c.valor ?? ""} onChange={(e) => set({ ...b, condicion: { ...c, valor: e.target.value } })} className="h-9" /></Campo>}
        </div>
        <p className="text-[11px] text-slate-400">Ej.: mostrar "Saldo pendiente" solo si doc.condicion es igual a credito.</p>
      </div>}
    </div>
  );
}

function EditorPagina({ pg, set, ro }) {
  const s = (k) => (v) => set({ ...pg, [k]: v });
  const mg = pg.margenes || {};
  const ma = pg.marca_agua || {};
  const pie = pg.pie_pagina || {};
  const termico = ["80mm", "58mm"].includes(pg.formato);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Papel"><Sel disabled={ro} value={pg.formato || "carta"} onChange={s("formato")} opciones={{ "80mm": "Térmico 80 mm", "58mm": "Térmico 58 mm", carta: "Carta", oficio: "Oficio", media_carta: "Media carta" }} /></Campo>
        {!termico && <Campo label="Orientación"><Sel disabled={ro} value={pg.orientacion || "vertical"} onChange={s("orientacion")} opciones={{ vertical: "Vertical", horizontal: "Horizontal" }} /></Campo>}
        <Campo label="Copias"><Sel disabled={ro} value={String(pg.copias || 1)} onChange={(v) => s("copias")(Number(v))} opciones={{ 1: "1", 2: "2", 3: "3" }} /></Campo>
      </div>
      <Campo label="Márgenes (mm)">
        <div className="grid grid-cols-4 gap-1">{["arriba", "derecha", "abajo", "izquierda"].map((k) => (
          <div key={k}><Num disabled={ro} value={mg[k]} min={0} max={60} onChange={(v) => s("margenes")({ ...mg, [k]: v ?? 0 })} /><p className="text-center text-[10px] text-slate-400">{k}</p></div>))}</div>
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Fuente base"><Sel disabled={ro} value={pg.fuente || "Helvetica"} onChange={s("fuente")} opciones={{ Helvetica: "Helvetica (sans)", Times: "Times (serif)", Courier: "Courier (mono)" }} /></Campo>
        <Campo label="Tamaño base (pt)"><Num disabled={ro} value={pg.tamano_base} onChange={s("tamano_base")} min={4} max={20} /></Campo>
        <Campo label="Interlineado"><Num disabled={ro} value={pg.interlineado} onChange={s("interlineado")} min={0.8} max={3} step={0.05} /></Campo>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Color de texto"><ColorIn disabled={ro} value={pg.color_texto} onChange={s("color_texto")} permitirVacio={false} /></Campo>
        <Campo label="Color principal"><ColorIn disabled={ro} value={pg.color_primario} onChange={s("color_primario")} permitirVacio={false} /></Campo>
      </div>
      {!termico && <>
        <div className="rounded-md border border-slate-200 p-2 space-y-2">
          <p className="text-xs font-semibold text-slate-600">Marca de agua</p>
          <Input disabled={ro} value={ma.texto || ""} placeholder="Ej. COPIA, PAGADO, BORRADOR…" onChange={(e) => s("marca_agua")({ ...ma, texto: e.target.value })} className="h-9" />
          {ma.texto && <div className="grid grid-cols-3 gap-2">
            <Campo label="Opacidad"><Num disabled={ro} value={ma.opacidad} onChange={(v) => s("marca_agua")({ ...ma, opacidad: v })} min={0.02} max={1} step={0.01} /></Campo>
            <Campo label="Tamaño"><Num disabled={ro} value={ma.tamano} onChange={(v) => s("marca_agua")({ ...ma, tamano: v })} min={10} max={200} step={2} /></Campo>
            <Campo label="Ángulo"><Num disabled={ro} value={ma.angulo} onChange={(v) => s("marca_agua")({ ...ma, angulo: v })} min={-90} max={90} step={5} /></Campo>
          </div>}
          {ma.texto && <ColorIn disabled={ro} value={ma.color} onChange={(v) => s("marca_agua")({ ...ma, color: v })} />}
        </div>
        <div className="rounded-md border border-slate-200 p-2 space-y-2">
          <p className="text-xs font-semibold text-slate-600">Pie de página (en cada hoja)</p>
          <Input disabled={ro} value={pie.texto || ""} placeholder="Ej. {{empresa.nombre}} · {{empresa.telefono}}" onChange={(e) => s("pie_pagina")({ ...pie, texto: e.target.value })} className="h-9 font-mono text-xs" />
          <Interruptor disabled={ro} label="Numerar páginas" checked={pie.numerar} onChange={(v) => s("pie_pagina")({ ...pie, numerar: v })} />
        </div>
      </>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Panel de estructura (árbol de bloques)
// ════════════════════════════════════════════════════════════════════════
function ArbolBloques({ bloques, pref = [], sel, onSel, onAccion, ro, nivel = 0 }) {
  return (
    <div className={nivel ? "ml-3 border-l border-dashed border-slate-200 pl-2" : ""}>
      {bloques.map((b, i) => {
        const ruta = [...pref, i];
        const info = TIPOS_BLOQUE[b.tipo] || { label: b.tipo, icon: Layers };
        const Icon = info.icon;
        const activo = mismaRuta(sel, ruta);
        return (
          <div key={b.id || i}>
            <div onClick={() => onSel(ruta)}
              className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${activo ? "bg-[#C1401E]/10 ring-1 ring-[#C1401E]/40" : "hover:bg-slate-50"} ${b.visible === false ? "opacity-45" : ""}`}>
              <Icon className="h-4 w-4 shrink-0 text-slate-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-slate-700">{info.label}{b.condicion ? <span className="ml-1 text-[10px] text-amber-600">• condición</span> : null}</div>
                <div className="truncate text-[11px] text-slate-400">{resumen(b)}</div>
              </div>
              {!ro && <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <button title="Subir" onClick={(e) => { e.stopPropagation(); onAccion("mover", ruta, -1); }}><ArrowUp className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" /></button>
                <button title="Bajar" onClick={(e) => { e.stopPropagation(); onAccion("mover", ruta, 1); }}><ArrowDown className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" /></button>
                <button title={b.visible === false ? "Mostrar" : "Ocultar"} onClick={(e) => { e.stopPropagation(); onAccion("visible", ruta); }}>{b.visible === false ? <EyeOff className="h-3.5 w-3.5 text-slate-400" /> : <Eye className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" />}</button>
                <button title="Duplicar" onClick={(e) => { e.stopPropagation(); onAccion("duplicar", ruta); }}><Copy className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" /></button>
                <button title="Eliminar" onClick={(e) => { e.stopPropagation(); onAccion("eliminar", ruta); }}><Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-600" /></button>
              </div>}
            </div>
            {esContenedor(b) && b.columnas.map((col, ci) => (
              <div key={ci} className="ml-3 mt-0.5">
                <div className="flex items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <ChevronRight className="h-3 w-3" />Columna {ci + 1}
                  {!ro && <button onClick={() => onAccion("agregar_en", [...ruta, ci])} className="ml-auto text-[#C1401E] hover:underline normal-case font-medium">+ bloque</button>}
                </div>
                <ArbolBloques bloques={col.bloques || []} pref={[...ruta, ci]} sel={sel} onSel={onSel} onAccion={onAccion} ro={ro} nivel={nivel + 1} />
              </div>
            ))}
          </div>
        );
      })}
      {!bloques.length && <p className="px-2 py-1 text-[11px] italic text-slate-400">Sin bloques</p>}
    </div>
  );
}

function Paleta({ open, onClose, onElegir }) {
  const grupos = {};
  Object.entries(TIPOS_BLOQUE).forEach(([t, info]) => { (grupos[info.grupo] ||= []).push({ label: info.label, icon: info.icon, bloque: { tipo: t } }); });
  PRESETS.forEach((p) => (grupos[p.grupo] ||= []).push({ label: p.label, icon: Sparkles, bloque: p.bloque, preset: true }));
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Agregar bloque</DialogTitle></DialogHeader>
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2">
          {Object.entries(grupos).map(([g, items]) => (
            <div key={g}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g}</p>
              <div className="space-y-1">{items.map((it) => { const I = it.icon; return (
                <button key={it.label} onClick={() => onElegir(it.bloque)} className="flex w-full items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-[#C1401E] hover:bg-[#C1401E]/5">
                  <I className="h-4 w-4 text-slate-500" />{it.label}{it.preset && <span className="ml-auto text-[10px] text-[#C1401E]">plantilla</span>}</button>); })}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const BLOQUE_NUEVO = {
  texto: { contenido: "Texto nuevo" }, separador: { linea: "solida", grosor: 0.6, color: "#E5E0DA" }, espacio: { alto_mm: 4 },
  logo: { fuente: "oficial", ancho_mm: 50, alto_mm: 25, estilo: { align: "center" } }, imagen: { ancho_mm: 40 },
  campos: { columnas: 1, campos: [{ etiqueta: "Folio", valor: "{{doc.folio}}" }, { etiqueta: "Fecha", valor: "{{doc.fecha}}" }] },
  tabla_items: { modo: "tabla", bordes: "cuadricula", color_borde: "#E5E0DA", encabezado: { visible: true, fondo: "#C1401E", color: "#FFFFFF" },
    columnas: [{ campo: "cantidad", titulo: "Cant.", ancho: 12 }, { campo: "descripcion", titulo: "Descripción", ancho: 50 }, { campo: "precio", titulo: "Precio", ancho: 18 }, { campo: "importe", titulo: "Importe", ancho: 20 }] },
  totales: { posicion: "derecha", ancho_pct: 50, filas: [{ campo: "subtotal" }, { campo: "descuento" }, { campo: "iva" }, { campo: "total", destacar: true }] },
  qr: { contenido: "{{doc.qr_verificar}}", tamano_mm: 22, estilo: { align: "center" } }, firmas: { firmas: ["Entregó", "Recibió"], espacio_mm: 12 },
  cuentas_bancarias: { titulo: "Cuentas para depósito", mostrar_logo: true }, pagos: { titulo: "Formas de pago" },
  columnas: { columnas: [{ ancho: 50, bloques: [] }, { ancho: 50, bloques: [] }], alinear_vertical: "arriba" }, salto_pagina: {},
};

// ════════════════════════════════════════════════════════════════════════
// Página principal
// ════════════════════════════════════════════════════════════════════════
export default function MachotesEditor() {
  const [catalogo, setCatalogo] = useState([]);
  const [tipo, setTipo] = useState("ticket");
  const [seleccion, setSeleccion] = useState("sistema"); // "sistema" | template_id
  const [plantilla, setPlantilla] = useState(null);       // detalle de la plantilla personalizada
  const [cfg, setCfg] = useState(null);
  const [cfgGuardada, setCfgGuardada] = useState("");
  const [sel, setSel] = useState(null);                   // ruta del bloque o null (= página)
  const [tab, setTab] = useState("contenido");
  const [paleta, setPaleta] = useState(null);             // ruta de lista destino
  const [pdfUrl, setPdfUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [cargandoPrev, setCargandoPrev] = useState(false);
  const [origen, setOrigen] = useState("ejemplo");
  const [folio, setFolio] = useState("");
  const [recientes, setRecientes] = useState([]);
  const [dlg, setDlg] = useState(null);                   // {tipo:'nueva'|'guardar'|'historial'|'eliminar'}
  const [nombre, setNombre] = useState("");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const hist = useRef({ pila: [], idx: -1 });

  const infoTipo = catalogo.find((t) => t.tipo === tipo);
  const ro = seleccion === "sistema";
  const sucio = !ro && cfg && JSON.stringify(cfg) !== cfgGuardada;

  const cargarCatalogo = useCallback(async () => {
    try { const r = await api.get("/formatos"); setCatalogo(r.data.tipos); return r.data.tipos; }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); return []; }
  }, []);

  const resetHist = (c) => { hist.current = { pila: [JSON.stringify(c)], idx: 0 }; };
  const cambiar = useCallback((nueva) => {
    setCfg(nueva);
    const h = hist.current; const s = JSON.stringify(nueva);
    if (h.pila[h.idx] === s) return;
    h.pila = h.pila.slice(0, h.idx + 1).concat(s).slice(-60); h.idx = h.pila.length - 1;
  }, []);
  const deshacer = () => { const h = hist.current; if (h.idx > 0) { h.idx -= 1; setCfg(JSON.parse(h.pila[h.idx])); } };
  const rehacer = () => { const h = hist.current; if (h.idx < h.pila.length - 1) { h.idx += 1; setCfg(JSON.parse(h.pila[h.idx])); } };

  const abrir = useCallback(async (t, selId) => {
    setSel(null); setTab("contenido");
    try {
      if (selId === "sistema") {
        const r = await api.get(`/formatos/${t}/predeterminado`);
        setPlantilla(null); setCfg(r.data.configuracion); setCfgGuardada(JSON.stringify(r.data.configuracion)); resetHist(r.data.configuracion);
      } else {
        const r = await api.get(`/formatos/plantillas/${selId}`);
        setPlantilla(r.data); setCfg(r.data.configuracion); setCfgGuardada(JSON.stringify(r.data.configuracion)); resetHist(r.data.configuracion);
      }
      setSeleccion(selId);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  }, []);

  useEffect(() => { (async () => { const tipos = await cargarCatalogo(); const t = tipos[0]; if (t) { setTipo(t.tipo); abrir(t.tipo, t.activo?.template_id || "sistema"); } })(); }, [cargarCatalogo, abrir]);
  useEffect(() => { api.get(`/formatos/${tipo}/documentos-recientes`).then((r) => setRecientes(r.data)).catch(() => setRecientes([])); }, [tipo]);

  const confirmarSalir = () => !sucio || window.confirm("Tienes cambios sin guardar. ¿Descartarlos?");
  const elegirTipo = (t) => { if (t === tipo || !confirmarSalir()) return; const info = catalogo.find((x) => x.tipo === t); setTipo(t); setOrigen("ejemplo"); setFolio(""); abrir(t, info?.activo?.template_id || "sistema"); };
  const elegirPlantilla = (id) => { if (!confirmarSalir()) return; abrir(tipo, id); };

  // Atajos de teclado: deshacer / rehacer / guardar
  useEffect(() => {
    const h = (e) => {
      if (!(e.ctrlKey || e.metaKey) || ro) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); deshacer(); }
      else if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); rehacer(); }
      else if (e.key === "s") { e.preventDefault(); if (sucio) { setNota(""); setDlg({ tipo: "guardar" }); } }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  });

  // ── Vista previa (servidor, PDF real) con espera tras cada cambio ──
  const prevSeq = useRef(0);
  const actualizarVista = useCallback(async () => {
    if (!cfg) return;
    const seq = ++prevSeq.current; setCargandoPrev(true); setPreviewError("");
    try {
      const r = await api.post("/formatos/vista-previa", { tipo, configuracion: cfg, origen, folio }, { responseType: "blob" });
      if (seq !== prevSeq.current) return;
      setPdfUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(r.data); });
    } catch (e) {
      if (seq !== prevSeq.current) return;
      let msg = "No se pudo generar la vista previa";
      try { msg = formatApiError(JSON.parse(await e.response.data.text()).detail); } catch { /* respuesta no JSON */ }
      setPreviewError(msg);
    } finally { if (seq === prevSeq.current) setCargandoPrev(false); }
  }, [cfg, tipo, origen, folio]);
  useEffect(() => { if (origen === "documento" && !folio) return; const t = setTimeout(actualizarVista, 700); return () => clearTimeout(t); }, [actualizarVista, origen, folio]);

  // ── Edición de bloques ──
  const bloques = cfg?.bloques || [];
  const bloqueSel = sel ? bloqueEn(bloques, sel) : null;
  const setBloqueSel = (nuevo) => cambiar({ ...cfg, bloques: conLista(bloques, sel.slice(0, -1), (l) => { l[sel[sel.length - 1]] = nuevo; return l; }) });
  const accion = (que, ruta, dir) => {
    if (que === "agregar_en") { setPaleta(ruta); return; }
    const pref = ruta.slice(0, -1); const i = ruta[ruta.length - 1];
    if (que === "mover") {
      const j = i + dir; if (j < 0 || j >= listaEn(bloques, pref).length) return;
      cambiar({ ...cfg, bloques: conLista(bloques, pref, (l) => { [l[i], l[j]] = [l[j], l[i]]; return l; }) });
      if (mismaRuta(sel, ruta)) setSel([...pref, j]);
    } else if (que === "visible") {
      cambiar({ ...cfg, bloques: conLista(bloques, pref, (l) => { l[i] = { ...l[i], visible: l[i].visible === false }; return l; }) });
    } else if (que === "duplicar") {
      cambiar({ ...cfg, bloques: conLista(bloques, pref, (l) => { l.splice(i + 1, 0, conIds(clone(l[i]))); return l; }) });
      setSel([...pref, i + 1]);
    } else if (que === "eliminar") {
      cambiar({ ...cfg, bloques: conLista(bloques, pref, (l) => { l.splice(i, 1); return l; }) });
      setSel(null);
    }
  };
  const agregar = (base) => {
    const destino = paleta; setPaleta(null);
    const nuevo = conIds({ ...clone(BLOQUE_NUEVO[base.tipo] || {}), ...clone(base) });
    // Inserta en la columna elegida o debajo del bloque seleccionado.
    let pref = Array.isArray(destino) ? destino : (sel ? sel.slice(0, -1) : []);
    let pos = Array.isArray(destino) ? listaEn(bloques, pref).length : (sel ? sel[sel.length - 1] + 1 : bloques.length);
    cambiar({ ...cfg, bloques: conLista(bloques, pref, (l) => { l.splice(pos, 0, nuevo); return l; }) });
    setSel([...pref, pos]); setTab("contenido");
  };

  // ── Acciones de plantilla ──
  const ejecutar = async (fn, ok) => { setOcupado(true); try { const r = await fn(); if (ok) toast.success(ok); return r; } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); return null; } finally { setOcupado(false); } };
  const crearPersonalizado = async () => {
    const r = await ejecutar(() => api.post("/formatos/plantillas", { tipo, nombre: nombre.trim() }), "Formato personalizado creado (versión 1)");
    if (r) { setDlg(null); await cargarCatalogo(); abrir(tipo, r.data.id); }
  };
  const duplicar = async () => {
    const r = await ejecutar(() => api.post("/formatos/plantillas", { tipo, nombre: nombre.trim(), desde_plantilla: seleccion }), "Formato duplicado");
    if (r) { setDlg(null); await cargarCatalogo(); abrir(tipo, r.data.id); }
  };
  const guardar = async () => {
    const r = await ejecutar(() => api.put(`/formatos/plantillas/${seleccion}`, { configuracion: cfg, nota }), null);
    if (r) { toast.success(`Guardado como versión ${r.data.version}${plantilla?.en_uso ? " — ya se usa en los documentos nuevos" : ""}`); setDlg(null); await cargarCatalogo(); abrir(tipo, seleccion); }
  };
  const activar = async () => { if (sucio) return toast.error("Guarda los cambios antes de usar este formato"); if (await ejecutar(() => api.post(`/formatos/${tipo}/activar`, { template_id: seleccion }), "Este formato ya se usa en los documentos nuevos")) { await cargarCatalogo(); abrir(tipo, seleccion); } };
  const usarPredeterminado = async () => {
    if (!window.confirm("Los documentos nuevos volverán a generarse con el formato predeterminado del sistema. Tus formatos personalizados se conservan. ¿Continuar?")) return;
    if (await ejecutar(() => api.post(`/formatos/${tipo}/usar-predeterminado`), "Formato predeterminado restaurado")) { await cargarCatalogo(); if (plantilla) abrir(tipo, seleccion); }
  };
  const restaurar = async (v) => { if (!window.confirm(`Se creará una versión nueva con el contenido de la versión ${v}. El historial se conserva. ¿Continuar?`)) return; if (await ejecutar(() => api.post(`/formatos/plantillas/${seleccion}/restaurar/${v}`), `Versión ${v} restaurada`)) { setDlg(null); await cargarCatalogo(); abrir(tipo, seleccion); } };
  const verVersion = async (v) => { const r = await ejecutar(() => api.get(`/formatos/plantillas/${seleccion}/versiones/${v}`)); if (r) { cambiar(r.data.configuracion); setDlg(null); toast.info(`Cargada la versión ${v} en el editor (sin guardar). Guarda para conservarla como versión nueva.`); } };
  const eliminar = async () => { if (await ejecutar(() => api.delete(`/formatos/plantillas/${seleccion}`), "Formato eliminado")) { setDlg(null); await cargarCatalogo(); abrir(tipo, "sistema"); } };
  const descartar = () => { if (window.confirm("¿Descartar los cambios no guardados?")) { const c = JSON.parse(cfgGuardada); setCfg(c); resetHist(c); setSel(null); } };

  const enUsoNombre = infoTipo?.activo ? (infoTipo.plantillas.find((p) => p.id === infoTipo.activo.template_id)?.nombre || "Personalizado") : null;

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col gap-3" data-testid="machotes-editor">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800"><FileText className="h-6 w-6 text-[#C1401E]" />Editor de formatos</h1>
          <p className="text-sm text-slate-500">Diseña tickets, notas, cotizaciones y comprobantes. El formato predeterminado del sistema siempre se conserva y se puede restaurar.</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Tipos de documento */}
        <aside className="w-56 shrink-0 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Documentos</p>
          {catalogo.map((t) => (
            <button key={t.tipo} onClick={() => elegirTipo(t.tipo)} data-testid={`fmt-tipo-${t.tipo}`}
              className={`w-full rounded-lg px-3 py-2 text-left ${tipo === t.tipo ? "bg-[#C1401E]/10 ring-1 ring-[#C1401E]/40" : "hover:bg-slate-50"}`}>
              <div className="text-sm font-medium text-slate-700">{t.nombre}</div>
              <div className={`mt-0.5 text-[11px] ${t.activo ? "text-emerald-700" : "text-slate-400"}`}>
                {t.activo ? `En uso: ${t.plantillas.find((p) => p.id === t.activo.template_id)?.nombre || "personalizado"}` : "En uso: predeterminado"}
              </div>
            </button>
          ))}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Barra de formato */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5">
            <select value={seleccion} onChange={(e) => elegirPlantilla(e.target.value)} className="h-9 min-w-[16rem] rounded-md border border-slate-200 bg-white px-2 text-sm" data-testid="fmt-plantilla">
              <option value="sistema">🔒 Predeterminado del sistema{!infoTipo?.activo ? " — en uso" : ""}</option>
              {(infoTipo?.plantillas || []).map((p) => <option key={p.id} value={p.id}>{p.nombre} · v{p.version_actual}{infoTipo?.activo?.template_id === p.id ? " — en uso" : ""}</option>)}
            </select>
            {ro ? (
              <Button size="sm" onClick={() => { setNombre(`${infoTipo?.nombre || "Formato"} personalizado`); setDlg({ tipo: "nueva" }); }} className="bg-[#C1401E] hover:bg-[#a63519]" data-testid="fmt-personalizar">
                <PenLine className="mr-1 h-4 w-4" />Personalizar
              </Button>
            ) : <>
              <Button size="sm" disabled={!sucio || ocupado} onClick={() => { setNota(""); setDlg({ tipo: "guardar" }); }} className="bg-[#C1401E] hover:bg-[#a63519]" data-testid="fmt-guardar"><Save className="mr-1 h-4 w-4" />Guardar versión</Button>
              {!plantilla?.en_uso && <Button size="sm" variant="outline" disabled={ocupado} onClick={activar} data-testid="fmt-activar"><CheckCircle2 className="mr-1 h-4 w-4 text-emerald-600" />Usar en documentos</Button>}
              <Button size="sm" variant="ghost" disabled={hist.current.idx <= 0} onClick={deshacer} title="Deshacer (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" disabled={hist.current.idx >= hist.current.pila.length - 1} onClick={rehacer} title="Rehacer (Ctrl+Y)"><Redo2 className="h-4 w-4" /></Button>
              {sucio && <Button size="sm" variant="ghost" onClick={descartar}>Descartar</Button>}
              <Button size="sm" variant="outline" onClick={() => setDlg({ tipo: "historial" })}><History className="mr-1 h-4 w-4" />Versiones ({plantilla?.versiones?.length || 0})</Button>
              <Button size="sm" variant="ghost" onClick={() => { setNombre(`${plantilla?.nombre || "Formato"} (copia)`); setDlg({ tipo: "duplicar" }); }} title="Duplicar"><Copy className="h-4 w-4" /></Button>
              {!plantilla?.en_uso && <Button size="sm" variant="ghost" onClick={() => setDlg({ tipo: "eliminar" })} title="Eliminar"><Trash2 className="h-4 w-4 text-red-600" /></Button>}
            </>}
            <div className="ml-auto flex items-center gap-2">
              {sucio && <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" />Cambios sin guardar</span>}
              {infoTipo?.activo && <Button size="sm" variant="outline" onClick={usarPredeterminado} data-testid="fmt-usar-predeterminado"><RotateCcw className="mr-1 h-4 w-4" />Volver al predeterminado</Button>}
            </div>
          </div>

          {ro && <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Lock className="h-4 w-4 text-slate-400" />
            Estás viendo el <b>formato predeterminado del sistema</b> (solo lectura). Pulsa <b>Personalizar</b> para crear una copia editable con todas las opciones; el original se conserva siempre como respaldo.
            {enUsoNombre && <span className="ml-1">Actualmente los documentos usan <b>{enUsoNombre}</b>.</span>}
          </div>}

          <div className="flex min-h-0 flex-1 gap-3">
            {/* Estructura */}
            <div className="flex w-72 shrink-0 flex-col rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">Estructura</span>
                {!ro && <Button size="sm" variant="outline" onClick={() => setPaleta(true)} data-testid="fmt-agregar"><Plus className="mr-1 h-3.5 w-3.5" />Bloque</Button>}
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <div onClick={() => setSel(null)} className={`mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${sel === null ? "bg-[#C1401E]/10 ring-1 ring-[#C1401E]/40" : "hover:bg-slate-50"}`}>
                  <Settings2 className="h-4 w-4 text-slate-500" /><div><div className="text-[13px] font-medium text-slate-700">Página y estilo general</div>
                    <div className="text-[11px] text-slate-400">{cfg?.pagina?.formato} · {cfg?.pagina?.fuente} {cfg?.pagina?.tamano_base}pt</div></div>
                </div>
                {cfg && <ArbolBloques bloques={bloques} sel={sel} onSel={(r) => { setSel(r); }} onAccion={accion} ro={ro} />}
              </div>
            </div>

            {/* Inspector */}
            <div className="flex w-80 shrink-0 flex-col rounded-xl border border-slate-200 bg-white">
              <div className="border-b px-3 py-2 text-sm font-semibold text-slate-700">
                {bloqueSel ? (TIPOS_BLOQUE[bloqueSel.tipo]?.label || bloqueSel.tipo) : "Página y estilo general"}
              </div>
              {bloqueSel && <div className="flex border-b text-xs">
                {[["contenido", "Contenido"], ["estilo", "Estilo"], ["visibilidad", "Visibilidad"]].map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 ${tab === k ? "border-b-2 border-[#C1401E] font-semibold text-[#C1401E]" : "text-slate-500"}`}>{l}</button>))}
              </div>}
              <div className="flex-1 overflow-y-auto p-3">
                {cfg && !bloqueSel && <EditorPagina pg={cfg.pagina || {}} set={(pg) => cambiar({ ...cfg, pagina: pg })} ro={ro} />}
                {bloqueSel && tab === "contenido" && <EditorContenido b={bloqueSel} set={setBloqueSel} tipo={tipo} ro={ro} />}
                {bloqueSel && tab === "estilo" && <EditorEstilo b={bloqueSel} set={setBloqueSel} ro={ro} />}
                {bloqueSel && tab === "visibilidad" && <EditorVisibilidad b={bloqueSel} set={setBloqueSel} tipo={tipo} ro={ro} />}
              </div>
            </div>

            {/* Vista previa */}
            <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">Vista previa</span>
                <select value={origen} onChange={(e) => setOrigen(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs">
                  <option value="ejemplo">Datos de ejemplo</option><option value="documento">Documento real</option>
                </select>
                {origen === "documento" && <>
                  <Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Folio" className="h-8 w-32 text-xs" list="fmt-folios" />
                  <datalist id="fmt-folios">{recientes.map((d) => <option key={d.folio} value={d.folio}>{d.detalle}</option>)}</datalist>
                </>}
                <Button size="sm" variant="ghost" onClick={actualizarVista} disabled={cargandoPrev}><RefreshCw className={`h-4 w-4 ${cargandoPrev ? "animate-spin" : ""}`} /></Button>
              </div>
              <div className="relative flex-1 bg-slate-100">
                {previewError ? <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{previewError}</div>
                  : pdfUrl ? <iframe title="Vista previa del formato" src={`${pdfUrl}#toolbar=1&view=FitH`} className="h-full w-full" />
                  : <div className="flex h-full items-center justify-center text-sm text-slate-400">Generando vista previa…</div>}
              </div>
            </div>
          </div>
        </section>
      </div>

      <Paleta open={!!paleta} onClose={() => setPaleta(null)} onElegir={agregar} />

      {/* Diálogos */}
      <Dialog open={dlg?.tipo === "nueva" || dlg?.tipo === "duplicar"} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dlg?.tipo === "duplicar" ? "Duplicar formato" : "Personalizar formato"}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">{dlg?.tipo === "duplicar" ? "Se crea una copia independiente con su propio historial." : "Se crea una copia editable del formato predeterminado (versión 1). El predeterminado del sistema no cambia y podrás volver a él cuando quieras."}</p>
          <Campo label="Nombre del formato"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus data-testid="fmt-nombre" /></Campo>
          <DialogFooter><Button variant="outline" onClick={() => setDlg(null)}>Cancelar</Button>
            <Button disabled={!nombre.trim() || ocupado} onClick={dlg?.tipo === "duplicar" ? duplicar : crearPersonalizado} className="bg-[#C1401E] hover:bg-[#a63519]" data-testid="fmt-crear">Crear</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg?.tipo === "guardar"} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Guardar versión {(plantilla?.version_actual || 0) + 1}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">La versión anterior queda en el historial y se puede restaurar.{plantilla?.en_uso ? " Este formato está en uso: los documentos nuevos saldrán con esta versión." : ""}</p>
          <Campo label="Nota de la versión (opcional)"><Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. Logo más grande y QR al final" /></Campo>
          <DialogFooter><Button variant="outline" onClick={() => setDlg(null)}>Cancelar</Button>
            <Button disabled={ocupado} onClick={guardar} className="bg-[#C1401E] hover:bg-[#a63519]" data-testid="fmt-confirmar-guardar">Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg?.tipo === "historial"} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Versiones de “{plantilla?.nombre}”</DialogTitle></DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {(plantilla?.versiones || []).map((v) => (
              <div key={v.version} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-700">Versión {v.version}{v.version === plantilla.version_actual && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">actual</span>}</div>
                  <div className="text-[11px] text-slate-400">{v.fecha?.slice(0, 16).replace("T", " ")} · {v.creado_por}{v.nota ? ` · ${v.nota}` : ""}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => verVersion(v.version)}>Abrir</Button>
                {v.version !== plantilla.version_actual && <Button size="sm" variant="outline" onClick={() => restaurar(v.version)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Restaurar</Button>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg?.tipo === "eliminar"} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Eliminar formato</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">Se eliminará “{plantilla?.nombre}” con todas sus versiones. El formato predeterminado del sistema no se ve afectado.</p>
          <DialogFooter><Button variant="outline" onClick={() => setDlg(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={ocupado} onClick={eliminar}>Eliminar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
