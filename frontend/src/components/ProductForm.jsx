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
import { Loader2 } from "lucide-react";

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
  { id: "clasif", label: "Clasificación", fields: ["clasifica", "categoria", "categocve", "deptocve", "linea"] },
  { id: "unid", label: "Unidades", fields: ["unimedida", "unimedcve", "empaque", "unimedempq"] },
  { id: "inv", label: "Inventario", fields: ["existencia", "ubicacion", "stockmin", "stockmax", "xentregar", "xrecibir", "porpedir"] },
  { id: "costos", label: "Costos", fields: ["ultfcosto", "ultcosto", "costo", "costodlls"] },
  { id: "precios", label: "Precios", custom: true },
  { id: "imp", label: "Impuestos", fields: ["cveproser", "satobjimp", "exento", "impuesto", "t_ieps", "ieps", "ish", "ret_isr", "ret_iva"] },
  { id: "prov", label: "Proveedor", fields: ["proveedor"] },
  { id: "hist", label: "Historial", fields: ["fechaalta", "ultfcompra", "ultccompra", "ultfdevcom", "ultcdevcom", "ultfdevven", "ultcdevven", "ultfventa", "ultcventa", "ultprecio", "vta_mes", "vta_anual"] },
  { id: "cfg", label: "Configuración", fields: ["insumo", "numseries", "factcoment", "integrado", "valexist", "modiprecio", "aplidescto", "topecosto", "inventario", "movkardex", "ventaweb", "lotes", "controlado", "bascula", "asociado", "flete"] },
  { id: "media", label: "Multimedia", fields: ["imagen", "foto", "fichatec"] },
  { id: "coment", label: "Comentarios", fields: ["comentario", "rotacion"] },
  { id: "comis", label: "Comisiones", fields: ["comision", "comitipo"] },
];
const ESTADO_TO_STATUS = { activo: "A", baja: "B", suspendido: "S" };
const STATUS_TO_ESTADO = { A: "activo", B: "baja", S: "suspendido" };

const blank = () => {
  const f = {};
  ALL.forEach((k) => (f[k] = T[k] === "L" ? false : ""));
  f.status = "A"; f.impuesto = 16; f.unimedida = "PZA";
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
  return f;
}

const num = (v) => (v === "" || v == null ? 0 : Number(v));

export default function ProductForm({ open, onClose, product, onSaved }) {
  const [f, setF] = useState(blank());
  const [saving, setSaving] = useState(false);
  const isEdit = !!product;

  useEffect(() => { if (open) setF(product ? toForm(product) : blank()); }, [open, product]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

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
          <Button onClick={save} disabled={saving} data-testid="prod-save" className="bg-[#0055A4] hover:bg-[#004385]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
