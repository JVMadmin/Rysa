import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import Usuarios from "@/pages/Usuarios";
import { ImageUpload } from "@/components/ImageUpload";
import { fileUrl, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Building2, MapPin, DollarSign, Store, UserCog, Loader2, Plus, Trash2, Save, Receipt, DatabaseZap } from "lucide-react";

export default function Configuracion() {
  const { can } = useAuth();
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => { api.get("/settings").then((r) => setS({ sucursales: [], listas_precios_nombres: ["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"], listas_precios_pct: [40, 30, 20, 15, 10], logo_url: "", ticket_config: {}, ...r.data, ticket_config: { tamano: "80mm", mostrar_rfc: true, mostrar_direccion: true, mostrar_telefono: true, encabezado: "", pie: "¡Gracias por su compra!", ...(r.data?.ticket_config || {}) } })); }, []);

  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const setTc = (k, v) => setS((x) => ({ ...x, ticket_config: { ...(x.ticket_config || {}), [k]: v } }));
  const setLista = (i, v) => setS((x) => ({ ...x, listas_precios_nombres: x.listas_precios_nombres.map((n, idx) => idx === i ? v : n) }));
  const setListaPct = (i, v) => setS((x) => ({ ...x, listas_precios_pct: (x.listas_precios_pct || [40, 30, 20, 15, 10]).map((n, idx) => idx === i ? v : n) }));
  const addLista = () => setS((x) => ({ ...x, listas_precios_nombres: [...(x.listas_precios_nombres || []), `Precio ${(x.listas_precios_nombres || []).length + 1}`], listas_precios_pct: [...(x.listas_precios_pct || [40, 30, 20, 15, 10]), 10] }));
  const delLista = (i) => setS((x) => ({ ...x, listas_precios_nombres: x.listas_precios_nombres.filter((_, idx) => idx !== i), listas_precios_pct: x.listas_precios_pct.filter((_, idx) => idx !== i) }));
  const setSuc = (i, k, v) => setS((x) => ({ ...x, sucursales: x.sucursales.map((su, idx) => idx === i ? { ...su, [k]: v } : su) }));
  const addSuc = () => setS((x) => ({ ...x, sucursales: [...x.sucursales, { nombre: "", direccion: "", ciudad: "", estado: "", cp: "", telefono: "", activa: true }] }));
  const delSuc = (i) => setS((x) => ({ ...x, sucursales: x.sucursales.filter((_, idx) => idx !== i) }));

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
          <TabsTrigger value="ticket" data-testid="tab-ticket"><Receipt className="w-4 h-4 mr-1" /> Diseño de ticket</TabsTrigger>
          <TabsTrigger value="usuarios" data-testid="tab-usuarios"><UserCog className="w-4 h-4 mr-1" /> Usuarios</TabsTrigger>
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
            {I("Ciudad", "ciudad")}
            {I("Estado", "estado")}
            {I("Código Postal", "cp")}
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
                  <Button variant="outline" size="sm" onClick={() => setElements(null)} data-testid="cfg-elt-default"
                    className="h-7 text-[11px]">Usar diseño estándar</Button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Ordena los bloques: cada uno con contenido, alineación, negrita y tamaño. Incluye logo y código QR.</p>
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

        <TabsContent value="usuarios" className="pt-4">
          <Usuarios embedded />
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
