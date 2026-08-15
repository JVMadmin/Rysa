import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, formatApiError, money } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, Plus, X, Barcode } from "lucide-react";
import { ImageUpload } from "@/components/ImageUpload";

// Tipo por campo (C/M texto, N numero, D fecha, L booleano)
const T = {
  posicion: "C", codigo: "C", descrip: "C", descriplrg: "M", clasifica: "C", categoria: "C",
  categocve: "C", deptocve: "C", linea: "C", unimedida: "C", unimedcve: "C", cveproser: "C",
  satobjimp: "C", ubicacion: "C", empaque: "N", unimedempq: "C", existencia: "N", insumo: "L",
  proveedor: "C", fechaalta: "D", ultfcosto: "D", ultcosto: "N", costo: "N", costodlls: "N",
  utilminimo: "N", utilpreci1: "N", utilpreci2: "N", utilpreci3: "N", utilpreci4: "N", utilpreci5: "N",
  exento: "L", impuesto: "N", t_ieps: "N", ieps: "N", ish: "N", ret_isr: "N", ret_iva: "N",
  preciovta: "N", precvtactr: "N", precvtauso: "N", precio1: "N", precio2: "N", precio3: "N",
  precio4: "N", precio5: "N", preciomin: "N", ultfdevcom: "D", ultcdevcom: "N", ultfcompra: "D",
  ultccompra: "N", ultfdevven: "D", ultcdevven: "N", ultfventa: "D", ultcventa: "N", vta_mes: "N",
  vta_anual: "N", xentregar: "N", xrecibir: "N", stockmin: "N", stockmax: "N", porpedir: "L",
  imagen: "M", foto: "M", fichatec: "M", numseries: "L", factcoment: "L", integrado: "L",
  valexist: "L", modiprecio: "L", aplidescto: "L", topecosto: "L", inventario: "L", movkardex: "L",
  ventaweb: "L", lotes: "L", controlado: "L", bascula: "L", asociado: "L", flete: "L",
  comentario: "M", rotacion: "C", ultprecio: "D", comision: "N", comitipo: "C", status: "C",
};
const ALL = Object.keys(T);

const SECTIONS = [
  { id: "ident", label: "Identificación", fields: ["posicion", "codigo", "descrip", "descriplrg", "status"] },
  { id: "barras", label: "Códigos de barras", customBarras: true },
  { id: "clasif", label: "Clasificación", fields: ["clasifica", "categoria", "categocve", "deptocve", "linea"] },
  { id: "unid", label: "Unidades", fields: ["unimedida", "unimedcve", "empaque", "unimedempq"] },
  { id: "inv", label: "Inventario", fields: ["existencia", "ubicacion", "stockmin", "stockmax", "xentregar", "xrecibir", "porpedir"] },
  { id: "costos", label: "Costos", fields: ["ultfcosto", "ultcosto", "costo", "costodlls"] },
  { id: "precios", label: "Precios", custom: true },
  { id: "imp", label: "Impuestos", fields: ["cveproser", "satobjimp", "exento", "impuesto", "t_ieps", "ieps", "ish", "ret_isr", "ret_iva"] },
  { id: "prov", label: "Proveedor", fields: ["proveedor"] },
  { id: "hist", label: "Historial", fields: ["fechaalta", "ultfcompra", "ultccompra", "ultfdevcom", "ultcdevcom", "ultfdevven", "ultcdevven", "ultfventa", "ultcventa", "ultprecio", "vta_mes", "vta_anual"] },
  { id: "cfg", label: "Configuración", fields: ["insumo", "numseries", "factcoment", "integrado", "valexist", "modiprecio", "aplidescto", "topecosto", "inventario", "movkardex", "ventaweb", "lotes", "controlado", "bascula", "asociado", "flete"] },
  { id: "media", label: "Multimedia", customMedia: true },
  { id: "coment", label: "Comentarios", fields: ["comentario", "rotacion"] },
  { id: "comis", label: "Comisiones", fields: ["comision", "comitipo"] },
];
const ESTADO_TO_STATUS = { activo: "A", baja: "B", suspendido: "S" };
const STATUS_TO_ESTADO = { A: "activo", B: "baja", S: "suspendido" };

const blank = () => {
  const f = {};
  ALL.forEach((k) => (f[k] = T[k] === "L" ? false : ""));
  f.status = "A"; f.impuesto = 16; f.unimedida = "PZA";
  f.codigos_barras = [];
  return f;
};

function toForm(p) {
  const f = blank();
  ALL.forEach((k) => { if (p[k] !== undefined && p[k] !== null) f[k] = T[k] === "L" ? !!p[k] : p[k]; });
  if (!f.descrip) f.descrip = p.descripcion || "";
  if (!f.descriplrg) f.descriplrg = p.descripcion_larga || "";
  if (!f.clasifica) f.clasifica = p.clasificacion || "";
  if (!f.unimedida) f.unimedida = p.unidad_medida || "PZA";
  if (f.stockmin === "" && p.stock_minimo != null) f.stockmin = p.stock_minimo;
  if (f.costo === "" && p.costo != null) f.costo = p.costo;
  if (f.existencia === "" && p.existencia != null) f.existencia = p.existencia;
  if ((f.impuesto === "" || f.impuesto == null) && p.iva_tasa != null) f.impuesto = p.iva_tasa;
  if (!p[".status"] && p.estado && (!p.status)) f.status = ESTADO_TO_STATUS[p.estado] || "A";
  const pr = p.precios || [];
  for (let i = 1; i <= 5; i++) {
    if (f[`precio${i}`] === "" && pr[i - 1]) f[`precio${i}`] = pr[i - 1].precio_con_iva;
    if (f[`utilpreci${i}`] === "" && pr[i - 1]) f[`utilpreci${i}`] = pr[i - 1].utilidad_pct;
  }
  if (f.preciomin === "" && p.precio_minimo) f.preciomin = p.precio_minimo;
  if (!f.imagen) f.imagen = p.imagen_url || "";
  f.codigos_barras = Array.isArray(p.codigos_barras) ? p.codigos_barras : (p.codigos_barras ? [String(p.codigos_barras)] : []);
  return f;
}

const num = (v) => (v === "" || v == null ? 0 : Number(v));

export default function ProductForm({ open, onClose, product, onSaved }) {
  const [f, setF] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const isEdit = !!product;

  useEffect(() => { if (open) setF(product ? toForm(product) : blank()); }, [open, product]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const addBarcode = (code) => {
    const v = String(code ?? barcodeInput).trim();
    if (!v) return;
    setF((s) => (s.codigos_barras.includes(v) ? s : { ...s, codigos_barras: [...s.codigos_barras, v] }));
    setBarcodeInput("");
  };
  const removeBarcode = (v) => setF((s) => ({ ...s, codigos_barras: s.codigos_barras.filter((x) => x !== v) }));

  const setPrecio = (i, field, val) => {
    setF((s) => {
      const next = { ...s, [`${field}${i}`]: val };
      const iva = num(s.impuesto) || 16, costo = num(s.costo);
      if (field === "utilpreci") {
        const sin = costo * (1 + num(val) / 100);
        next[`precio${i}`] = +(sin * (1 + iva / 100)).toFixed(2);
      } else if (field === "precio") {
        const sin = num(val) / (1 + iva / 100);
        next[`utilpreci${i}`] = costo > 0 ? +((sin / costo - 1) * 100).toFixed(1) : 0;
      }
      return next;
    });
  };

  const save = async () => {
    if (!f.descrip?.trim()) return toast.error("La descripción (DESCRIP) es obligatoria");
    setSaving(true);
    try {
      const payload = { ...f };
      // Campos legacy DBF: el backend los tipa OPTIONAL[str], así que se envían siempre como texto
      ALL.forEach((k) => { if (T[k] !== "L" && payload[k] != null && typeof payload[k] !== "string") payload[k] = String(payload[k]); });
      // sincronizar campos usados por POS / inventario
      payload.descripcion = f.descrip;
      payload.descripcion_larga = f.descriplrg;
      payload.linea = f.linea;
      payload.clasificacion = f.clasifica;
      payload.unidad_medida = f.unimedida || "PZA";
      payload.costo = num(f.costo);
      payload.existencia = num(f.existencia);
      payload.stock_minimo = num(f.stockmin);
      payload.iva_tasa = num(f.impuesto) || 16;
      payload.estado = STATUS_TO_ESTADO[String(f.status).toUpperCase()] || "activo";
      payload.precio_minimo = num(f.preciomin);
      payload.imagen_url = f.imagen;
      payload.codigos_barras = (f.codigos_barras || []).map((x) => String(x).trim()).filter(Boolean);
      payload.precios = [1, 2, 3, 4, 5].map((i) => ({
        nombre: `Precio ${i}`, utilidad_pct: num(f[`utilpreci${i}`]),
        precio_sin_iva: 0, precio_con_iva: num(f[`precio${i}`]),
      }));
      payload.controles = {
        permitir_venta: true, controlar_inventario: !!f.inventario, permitir_inventario_negativo: false,
        mostrar_pos: !f.insumo, mostrar_catalogo: !!f.ventaweb,
      };
      payload.sat = { clave_sat: f.cveproser, unidad_sat: f.unimedcve, impuestos: f.exento ? "Exento" : "IVA" };
      if (isEdit) await api.put(`/products/${product.id}`, payload);
      else await api.post("/products", payload);
      toast.success(isEdit ? "Producto actualizado" : "Producto creado");
      onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const renderField = (k) => {
    const t = T[k];
    if (t === "L") return (
      <div key={k} className="flex items-center justify-between border border-slate-200 rounded-md px-3 py-2">
        <span className="text-xs font-medium">{k.toUpperCase()}</span>
        <Switch checked={!!f[k]} onCheckedChange={(v) => set(k, v)} data-testid={`prod-${k}`} />
      </div>
    );
    if (t === "M") return (
      <div key={k} className="col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">{k.toUpperCase()}</Label>
        <Textarea value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="mt-1" data-testid={`prod-${k}`} /></div>
    );
    return (
      <div key={k}><Label className="text-xs uppercase tracking-wider text-slate-500">{k.toUpperCase()}</Label>
        <Input type={t === "N" ? "number" : t === "D" ? "date" : "text"} value={f[k] ?? ""}
          onChange={(e) => set(k, e.target.value)} className="mt-1"
          disabled={isEdit && k === "existencia"} title={isEdit && k === "existencia" ? "La existencia cambia por movimientos" : ""}
          data-testid={`prod-${k}`} /></div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="product-form">
        <DialogHeader><DialogTitle className="font-display">{isEdit ? `Editar producto · ${product.codigo}` : "Nuevo producto"}</DialogTitle></DialogHeader>
        <Tabs defaultValue="ident">
          <TabsList className="flex flex-wrap h-auto gap-1">
            {SECTIONS.map((s) => <TabsTrigger key={s.id} value={s.id} className="text-xs">{s.label}</TabsTrigger>)}
          </TabsList>

          {SECTIONS.map((s) => (
            <TabsContent key={s.id} value={s.id} className="pt-3">
              {s.custom ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label className="text-xs uppercase tracking-wider text-slate-500">IMPUESTO (IVA %)</Label>
                      <Input type="number" value={f.impuesto} onChange={(e) => set("impuesto", e.target.value)} className="mt-1" data-testid="prod-impuesto" /></div>
                  </div>
                  <table className="w-full text-sm border border-slate-200 rounded">
                    <thead><tr className="bg-slate-50 text-xs uppercase text-slate-500">
                      <th className="p-2 text-left">Lista</th><th className="p-2">% Utilidad</th><th className="p-2">Precio (con IVA)</th></tr></thead>
                    <tbody>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="p-2 font-medium">PRECIO{i}</td>
                          <td className="p-1"><Input type="number" value={f[`utilpreci${i}`]} onChange={(e) => setPrecio(i, "utilpreci", e.target.value)} className="h-8" data-testid={`prod-utilpreci${i}`} /></td>
                          <td className="p-1"><Input type="number" value={f[`precio${i}`]} onChange={(e) => setPrecio(i, "precio", e.target.value)} className="h-8" data-testid={`prod-precio${i}`} /></td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200 bg-slate-50/50">
                        <td className="p-2 font-medium">PRECIOMIN</td>
                        <td className="p-1"><Input type="number" value={f.utilminimo} onChange={(e) => set("utilminimo", e.target.value)} className="h-8" /></td>
                        <td className="p-1"><Input type="number" value={f.preciomin} onChange={(e) => set("preciomin", e.target.value)} className="h-8" data-testid="prod-preciomin" /></td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-xs text-slate-400">Precio con IVA usado por el POS. UTILPRECIn ↔ PRECIOn.</p>
                </div>
              ) : s.customBarras ? (
                <div className="space-y-3 max-w-xl" data-testid="prod-barras-section">
                  <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm"><Barcode className="w-4 h-4 text-[#C1401E]" /> Códigos de barras del producto</div>
                  <p className="text-xs text-slate-400">Escanea con el lector o escribe el código y presiona Enter / Agregar. Puedes registrar varios códigos y sobreescribirlos.</p>
                  <div className="flex gap-2">
                    <Input
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBarcode(); } }}
                      placeholder="Escanea o escribe un código de barras"
                      data-testid="prod-barcode-input" />
                    <Button type="button" onClick={() => addBarcode()} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="prod-barcode-add"><Plus className="w-4 h-4 mr-1" /> Agregar</Button>
                  </div>
                  <div className="flex flex-wrap gap-2" data-testid="prod-barcode-list">
                    {(f.codigos_barras || []).length === 0 && <span className="text-xs text-slate-400">Sin códigos de barras.</span>}
                    {(f.codigos_barras || []).map((code) => (
                      <span key={code} className="inline-flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-full pl-3 pr-2 py-1 text-sm font-mono" data-testid={`prod-barcode-chip-${code}`}>
                        {code}
                        <button type="button" onClick={() => removeBarcode(code)} className="text-slate-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : s.customMedia ? (
                <div className="space-y-4 max-w-lg" data-testid="prod-media-section">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">Imagen del producto</Label>
                    <ImageUpload value={f.imagen} onChange={(v) => set("imagen", v)} testid="prod-image-upload" />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-slate-500">Ficha técnica</Label>
                    <Textarea value={f.fichatec ?? ""} onChange={(e) => set("fichatec", e.target.value)} className="mt-1" data-testid="prod-fichatec" placeholder="Material, medidas, presentación..." />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {s.fields.map((k) => renderField(k))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="prod-save" className="bg-[#C1401E] hover:bg-[#A03316]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
