import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  FileText, Printer, Save, RefreshCw, Eye, EyeOff, Plus, Trash2, ArrowUp, ArrowDown,
  Sliders, Code, CheckCircle, HelpCircle, Layers, ZoomIn, Download
} from "lucide-react";

const API_BASE = "/api";

export default function MachotesEditor() {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [currentTemplate, setCurrentTemplate] = useState(null);
  const [config, setConfig] = useState(null);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modo Simulador
  const [simMode, setSimMode] = useState("sintetico"); // "sintetico" | "real"
  const [numItems, setNumItems] = useState(4);
  const [realDocId, setRealDocId] = useState("");
  const [simContext, setSimContext] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  useEffect(() => {
    cargarPlantillas();
  }, []);

  async function cargarPlantillas() {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/templates`);
      setTemplates(res.data || []);
      if (res.data && res.data.length > 0) {
        seleccionarPlantilla(res.data[0].id);
      }
    } catch (e) {
      toast.error("Error al cargar plantillas de machotes");
    } finally {
      setLoading(false);
    }
  }

  async function seleccionarPlantilla(id) {
    try {
      setSelectedTemplateId(id);
      const res = await axios.get(`${API_BASE}/templates/${id}`);
      setCurrentTemplate(res.data);
      const cfg = res.data.configuracion || { formato_fisico: "80mm", elementos: [] };
      setConfig(cfg);
      if (cfg.elementos && cfg.elementos.length > 0) {
        setSelectedElementId(cfg.elementos[0].id);
      }
      ejecutarSimulacion(id, cfg, simMode, numItems, realDocId);
    } catch (e) {
      toast.error("Error al obtener detalle de plantilla");
    }
  }

  async function ejecutarSimulacion(tid, customCfg, mode, itemsCount, docId) {
    try {
      setSimLoading(true);
      const payload = {
        configuracion: customCfg || config,
        num_items: itemsCount || numItems,
        documento_id: mode === "real" ? docId : null,
      };
      const res = await axios.post(`${API_BASE}/templates/${tid || selectedTemplateId}/simulate`, payload);
      setSimContext(res.data.context);
    } catch (e) {
      console.warn("Fallo simulación", e);
    } finally {
      setSimLoading(false);
    }
  }

  function moverElemento(index, direccion) {
    if (!config || !config.elementos) return;
    const nuevos = [...config.elementos];
    const target = index + direccion;
    if (target < 0 || target >= nuevos.length) return;
    const temp = nuevos[index];
    nuevos[index] = nuevos[target];
    nuevos[target] = temp;
    const updated = { ...config, elementos: nuevos };
    setConfig(updated);
    ejecutarSimulacion(selectedTemplateId, updated, simMode, numItems, realDocId);
  }

  function toggleVisibilidad(id) {
    const nuevos = config.elementos.map((el) =>
      el.id === id ? { ...el, visible: !el.visible } : el
    );
    const updated = { ...config, elementos: nuevos };
    setConfig(updated);
    ejecutarSimulacion(selectedTemplateId, updated, simMode, numItems, realDocId);
  }

  function eliminarElemento(id) {
    const nuevos = config.elementos.filter((el) => el.id !== id);
    const updated = { ...config, elementos: nuevos };
    setConfig(updated);
    if (selectedElementId === id) setSelectedElementId(nuevos[0]?.id || null);
    ejecutarSimulacion(selectedTemplateId, updated, simMode, numItems, realDocId);
  }

  function agregarElemento(tipo) {
    const id = `el_${Date.now()}`;
    let nuevo = { id, tipo, visible: true };
    if (tipo === "texto" || tipo === "campo") {
      nuevo.contenido = "Nuevo texto personalizado";
      nuevo.font_size = 9;
      nuevo.align = "left";
      nuevo.bold = false;
    } else if (tipo === "separador") {
      // linea
    } else if (tipo === "espaciador") {
      nuevo.altura = 8;
    } else if (tipo === "qr") {
      nuevo.contenido = "{{doc.qr_url}}";
    }
    const nuevos = [...(config.elementos || []), nuevo];
    const updated = { ...config, elementos: nuevos };
    setConfig(updated);
    setSelectedElementId(id);
    ejecutarSimulacion(selectedTemplateId, updated, simMode, numItems, realDocId);
  }

  function actualizarElemento(id, campo, valor) {
    const nuevos = config.elementos.map((el) =>
      el.id === id ? { ...el, [campo]: valor } : el
    );
    const updated = { ...config, elementos: nuevos };
    setConfig(updated);
    ejecutarSimulacion(selectedTemplateId, updated, simMode, numItems, realDocId);
  }

  async function guardarNuevaVersion() {
    try {
      setSaving(true);
      const res = await axios.put(`${API_BASE}/templates/${selectedTemplateId}`, {
        configuracion: config,
        formato_fisico: config.formato_fisico,
      });
      toast.success(`Plantilla guardada como versión ${res.data.version}`);
      seleccionarPlantilla(selectedTemplateId);
    } catch (e) {
      toast.error("Error al guardar versión de plantilla");
    } finally {
      setSaving(false);
    }
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
    } catch (e) {
      toast.error("Error al generar PDF");
    }
  }

  const elementoSeleccionado = config?.elementos?.find((e) => e.id === selectedElementId);

  return (
    <div className="flex flex-col h-[calc(100vh-65px)] bg-slate-100 text-slate-800">
      {/* BARRA SUPERIOR / ACCIONES */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <select
                value={selectedTemplateId}
                onChange={(e) => seleccionarPlantilla(e.target.value)}
                className="font-bold text-slate-800 bg-transparent text-base border-b border-dashed border-slate-400 focus:outline-none focus:border-indigo-600"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} ({t.tipo})
                  </option>
                ))}
              </select>
              <span className="text-xs bg-indigo-100 text-indigo-800 font-semibold px-2 py-0.5 rounded-full">
                v{currentTemplate?.version_actual || 1}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Constructor visual de documentos · Formato {config?.formato_fisico?.toUpperCase()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={descargarPdf}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
          >
            <Download className="w-4 h-4" />
            Descargar PDF Oficial
          </button>
          <button
            onClick={guardarNuevaVersion}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Guardando..." : "Guardar Versión"}
          </button>
        </div>
      </header>

      {/* ÁREA DE TRABAJO EN 3 COLUMNAS */}
      <div className="flex-1 flex overflow-hidden">
        {/* COLUMNA IZQUIERDA: PALETA DE BLOQUES Y CAPAS */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col">
          <div className="p-3 border-b border-slate-200 bg-slate-50 font-semibold text-xs text-slate-600 flex items-center justify-between">
            <span>COMPONENTES DEL LIENZO</span>
            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
              {config?.elementos?.length || 0}
            </span>
          </div>

          {/* Lista de capas */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {config?.elementos?.map((el, idx) => {
              const isSelected = el.id === selectedElementId;
              return (
                <div
                  key={el.id}
                  onClick={() => setSelectedElementId(el.id)}
                  className={`p-2 rounded-lg border text-xs flex items-center justify-between cursor-pointer transition ${
                    isSelected
                      ? "bg-indigo-50 border-indigo-400 text-indigo-900 font-medium"
                      : "bg-white border-slate-200 hover:border-slate-300 text-slate-700"
                  } ${!el.visible ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-[10px] text-slate-400 font-mono w-4">{idx + 1}</span>
                    <span className="capitalize">{el.tipo.replace("_", " ")}</span>
                  </div>

                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => moverElemento(idx, -1)}
                      disabled={idx === 0}
                      className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-20"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => moverElemento(idx, 1)}
                      disabled={idx === config.elementos.length - 1}
                      className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-20"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => toggleVisibilidad(el.id)}
                      className="p-1 text-slate-400 hover:text-slate-600"
                    >
                      {el.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-amber-500" />}
                    </button>
                    <button
                      onClick={() => eliminarElemento(el.id)}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Botones de agregar elemento */}
          <div className="p-3 border-t border-slate-200 bg-slate-50">
            <p className="text-[11px] font-bold text-slate-500 mb-2">AGREGAR AL DOCUMENTO</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => agregarElemento("campo")}
                className="px-2 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded text-xs text-left text-slate-700 flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3 text-indigo-600" /> Campo / Texto
              </button>
              <button
                onClick={() => agregarElemento("separador")}
                className="px-2 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded text-xs text-left text-slate-700 flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3 text-indigo-600" /> Separador
              </button>
              <button
                onClick={() => agregarElemento("espaciador")}
                className="px-2 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded text-xs text-left text-slate-700 flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3 text-indigo-600" /> Espaciador
              </button>
              <button
                onClick={() => agregarElemento("qr")}
                className="px-2 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded text-xs text-left text-slate-700 flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3 text-indigo-600" /> Código QR
              </button>
            </div>
          </div>
        </div>

        {/* COLUMNA CENTRAL: LIENZO INTERACTIVO WYSIWYG */}
        <div className="flex-1 bg-slate-200 overflow-y-auto p-8 flex justify-center items-start">
          <div
            className={`bg-white shadow-2xl transition-all duration-300 ${
              config?.formato_fisico === "58mm"
                ? "w-[240px] p-3 text-[11px]"
                : config?.formato_fisico === "80mm"
                ? "w-[320px] p-5 text-xs font-mono"
                : "w-[620px] min-h-[800px] p-10 text-sm"
            }`}
          >
            {/* Header del lienzo */}
            <div className="text-center pb-2 border-b border-dashed border-slate-300 mb-4 text-[10px] text-slate-400">
              VISTA PREVIA EN VIVO ({config?.formato_fisico?.toUpperCase()})
            </div>

            {/* Renderizado simulado de bloques */}
            {config?.elementos?.map((el) => {
              if (!el.visible) return null;
              const isSelected = el.id === selectedElementId;

              return (
                <div
                  key={el.id}
                  onClick={() => setSelectedElementId(el.id)}
                  className={`relative group cursor-pointer transition p-1 rounded my-0.5 ${
                    isSelected ? "ring-2 ring-indigo-500 bg-indigo-50/50" : "hover:bg-slate-50"
                  }`}
                >
                  {el.tipo === "empresa" && (
                    <div className="text-center font-bold text-sm">
                      {simContext?.empresa?.nombre || "GRUPO RYSA"}
                    </div>
                  )}

                  {el.tipo === "campo" && (
                    <div
                      style={{
                        textAlign: el.align || "left",
                        fontSize: `${el.font_size || 9}pt`,
                        fontWeight: el.bold ? "bold" : "normal",
                      }}
                    >
                      {el.contenido
                        ? el.contenido.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
                            const p = k.split(".");
                            return simContext?.[p[0]]?.[p[1]] || `[${k}]`;
                          })
                        : "Texto vacío"}
                    </div>
                  )}

                  {el.tipo === "separador" && (
                    <div className="border-b border-slate-400 my-2" />
                  )}

                  {el.tipo === "espaciador" && (
                    <div style={{ height: `${el.altura || 8}px` }} />
                  )}

                  {el.tipo === "tabla_productos" && (
                    <div className="my-2">
                      <div className="flex justify-between font-bold border-b border-slate-400 pb-1 text-[10px]">
                        <span>CANT</span>
                        <span className="flex-1 px-2">DESCRIPCIÓN</span>
                        <span>TOTAL</span>
                      </div>
                      <div className="divide-y divide-slate-100 text-[10px]">
                        {(simContext?.doc?.items || []).map((it, idx) => (
                          <div key={idx} className="flex justify-between py-1">
                            <span className="font-semibold">{it.cantidad} {it.presentacion}</span>
                            <span className="flex-1 px-2 truncate">{it.descripcion}</span>
                            <span>${it.importe?.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {el.tipo === "totales_linea" && (
                    <div className="flex justify-between py-0.5 text-[11px]">
                      <span className="text-slate-600">{el.etiqueta}:</span>
                      <span className={el.bold ? "font-bold text-slate-900" : ""}>
                        ${simContext?.doc?.[el.etiqueta?.toLowerCase()] || "0.00"}
                      </span>
                    </div>
                  )}

                  {el.tipo === "encabezado_empresa" && (
                    <div className="flex justify-between border-b pb-4 mb-4">
                      <div>
                        <h2 className="font-bold text-lg text-slate-900">
                          {simContext?.empresa?.nombre}
                        </h2>
                        <p className="text-xs text-slate-500">{simContext?.empresa?.direccion}</p>
                        <p className="text-xs text-slate-500">RFC: {simContext?.empresa?.rfc}</p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-indigo-700 text-base">
                          {simContext?.doc?.folio}
                        </span>
                        <p className="text-xs text-slate-500">{simContext?.doc?.fecha}</p>
                      </div>
                    </div>
                  )}

                  {el.tipo === "datos_cliente" && (
                    <div className="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs mb-3">
                      <p><b>Cliente:</b> {simContext?.cliente?.nombre}</p>
                      <p className="text-slate-500">RFC: {simContext?.cliente?.rfc} · Tel: {simContext?.cliente?.telefono}</p>
                    </div>
                  )}

                  {el.tipo === "bloque_totales" && (
                    <div className="w-48 ml-auto text-xs space-y-1 my-3 text-right">
                      <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <b>${simContext?.doc?.subtotal?.toFixed(2)}</b>
                      </div>
                      <div className="flex justify-between">
                        <span>IVA (16%):</span>
                        <b>${simContext?.doc?.iva?.toFixed(2)}</b>
                      </div>
                      <div className="flex justify-between text-indigo-800 text-sm font-bold border-t pt-1">
                        <span>Total:</span>
                        <span>${simContext?.doc?.total?.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  {el.tipo === "bloque_firmas" && (
                    <div className="flex justify-around pt-12 mt-6 border-t text-center text-xs">
                      <div>
                        <div className="w-40 border-b border-slate-400 mb-1" />
                        <p className="font-bold">Firma de Conformidad</p>
                      </div>
                      <div>
                        <div className="w-40 border-b border-slate-400 mb-1" />
                        <p className="font-bold">Entrega Almacén</p>
                      </div>
                    </div>
                  )}

                  {el.tipo === "qr" && (
                    <div className="flex flex-col items-center justify-center my-3 p-2 bg-slate-50 border rounded">
                      <div className="w-16 h-16 bg-slate-900 flex items-center justify-center text-white text-[9px] font-bold">
                        QR CÓDIGO
                      </div>
                      <span className="text-[9px] text-slate-400 mt-1">Verificación Oficial</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* COLUMNA DERECHA: INSPECTOR DE PROPIEDADES & SIMULADOR */}
        <div className="w-96 bg-white border-l border-slate-200 flex flex-col">
          {/* Tabs Inspector vs Simulador */}
          <div className="p-2 border-b border-slate-200 bg-slate-50 flex gap-2">
            <button
              onClick={() => {}}
              className="flex-1 py-1.5 text-xs font-bold text-indigo-700 border-b-2 border-indigo-600 text-center"
            >
              PROPIEDADES
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {elementoSeleccionado ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="font-bold text-xs text-slate-700 uppercase">
                    {elementoSeleccionado.tipo}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ID: {elementoSeleccionado.id}
                  </span>
                </div>

                {/* Contenido / Texto con variables */}
                {elementoSeleccionado.contenido !== undefined && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Contenido (soporta variables)
                    </label>
                    <textarea
                      rows={3}
                      value={elementoSeleccionado.contenido}
                      onChange={(e) =>
                        actualizarElemento(elementoSeleccionado.id, "contenido", e.target.value)
                      }
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                    />

                    {/* Botones de inserción de variables comunes */}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {[
                        "{{doc.folio}}",
                        "{{doc.total}}",
                        "{{cliente.nombre}}",
                        "{{empresa.telefono}}",
                        "{{doc.fecha}}",
                      ].map((v) => (
                        <button
                          key={v}
                          onClick={() =>
                            actualizarElemento(
                              elementoSeleccionado.id,
                              "contenido",
                              `${elementoSeleccionado.contenido || ""} ${v}`
                            )
                          }
                          className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono"
                        >
                          + {v}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Alineación */}
                {elementoSeleccionado.align !== undefined && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Alineación
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {["left", "center", "right"].map((al) => (
                        <button
                          key={al}
                          onClick={() => actualizarElemento(elementoSeleccionado.id, "align", al)}
                          className={`py-1 text-xs capitalize rounded border ${
                            elementoSeleccionado.align === al
                              ? "bg-indigo-50 border-indigo-500 text-indigo-700 font-bold"
                              : "bg-white border-slate-200 text-slate-600"
                          }`}
                        >
                          {al}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tamaño de fuente y negrita */}
                {elementoSeleccionado.font_size !== undefined && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Tamaño (pt): {elementoSeleccionado.font_size}
                      </label>
                      <input
                        type="range"
                        min={7}
                        max={16}
                        value={elementoSeleccionado.font_size}
                        onChange={(e) =>
                          actualizarElemento(
                            elementoSeleccionado.id,
                            "font_size",
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-4">
                      <input
                        type="checkbox"
                        id="bold_chk"
                        checked={!!elementoSeleccionado.bold}
                        onChange={(e) =>
                          actualizarElemento(elementoSeleccionado.id, "bold", e.target.checked)
                        }
                      />
                      <label htmlFor="bold_chk" className="text-xs font-semibold text-slate-700">
                        Negrita (Bold)
                      </label>
                    </div>
                  </div>
                )}

                {/* Condición de visibilidad */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Condición de Visibilidad (Opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="ej. doc.saldo > 0"
                    value={elementoSeleccionado.condicion || ""}
                    onChange={(e) =>
                      actualizarElemento(elementoSeleccionado.id, "condicion", e.target.value)
                    }
                    className="w-full text-xs p-2 border border-slate-300 rounded font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Se mostrará solo cuando la expresión se cumpla.
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-slate-400 text-xs">
                Selecciona un bloque en el lienzo para ajustar sus propiedades.
              </div>
            )}

            {/* SECCIÓN DEL SIMULADOR FUNCIONAL */}
            <div className="pt-4 border-t border-slate-200 mt-6">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                  SIMULADOR DE DATOS
                </span>
                <div className="flex bg-slate-100 p-0.5 rounded text-[10px]">
                  <button
                    onClick={() => {
                      setSimMode("sintetico");
                      ejecutarSimulacion(selectedTemplateId, config, "sintetico", numItems, "");
                    }}
                    className={`px-2 py-0.5 rounded ${
                      simMode === "sintetico" ? "bg-white font-bold text-indigo-700 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    Sintético
                  </button>
                  <button
                    onClick={() => {
                      setSimMode("real");
                    }}
                    className={`px-2 py-0.5 rounded ${
                      simMode === "real" ? "bg-white font-bold text-indigo-700 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    Venta Real
                  </button>
                </div>
              </div>

              {simMode === "sintetico" ? (
                <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-600">Partidas simuladas:</span>
                      <b className="text-indigo-600">{numItems}</b>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={numItems}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setNumItems(val);
                        ejecutarSimulacion(selectedTemplateId, config, "sintetico", val, "");
                      }}
                      className="w-full"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Calcula automáticamente totales, desglose de IVA y formato con datos realistas.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <label className="block text-slate-600">ID / Folio de Venta Real:</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="ej. V-00124"
                      value={realDocId}
                      onChange={(e) => setRealDocId(e.target.value)}
                      className="flex-1 p-1.5 border rounded text-xs"
                    />
                    <button
                      onClick={() =>
                        ejecutarSimulacion(selectedTemplateId, config, "real", numItems, realDocId)
                      }
                      className="px-2.5 py-1.5 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-700"
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
