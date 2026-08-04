import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, formatApiError, money } from "@/lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const PRICE_LABELS = ["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"];
const emptyPrices = () => PRICE_LABELS.map((n, i) => ({ nombre: n, utilidad_pct: [30, 25, 20, 15, 10][i], precio_sin_iva: 0, precio_con_iva: 0 }));

const blank = () => ({
  codigo: "", sku: "", descripcion: "", descripcion_larga: "", estado: "activo",
  linea: "", clasificacion: "", unidad_medida: "PZA", empaque: "", costo: 0,
  existencia: 0, ubicacion: "", stock_minimo: 0, iva_tasa: 16,
  precios: emptyPrices(), precio_minimo: 0,
  sat: { clave_sat: "", unidad_sat: "", impuestos: "IVA" },
  controles: { permitir_venta: true, controlar_inventario: true, permitir_inventario_negativo: false, mostrar_pos: true, mostrar_catalogo: true },
  ficha_tecnica: { material: "", medidas: "", peso: "", capacidad: "", color: "", dimensiones: "", presentacion: "" },
  proveedores: [], sinonimos: [], imagen_url: "",
});

export default function ProductForm({ open, onClose, product, onSaved }) {
  const [f, setF] = useState(blank());
  const [saving, setSaving] = useState(false);
  const isEdit = !!product;

  useEffect(() => {
    if (open) {
      if (product) {
        const p = { ...blank(), ...product };
        p.precios = product.precios?.length ? PRICE_LABELS.map((n, i) => product.precios[i] || { nombre: n, utilidad_pct: 0, precio_sin_iva: 0, precio_con_iva: 0 }) : emptyPrices();
        setF(p);
      } else setF(blank());
    }
  }, [open, product]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setNested = (grp, k, v) => setF((s) => ({ ...s, [grp]: { ...s[grp], [k]: v } }));

  const setPrecio = (i, field, val) => {
    setF((s) => {
      const precios = s.precios.map((p, idx) => (idx === i ? { ...p, [field]: val } : p));
      if (field === "utilidad_pct") {
        const sin = +(s.costo * (1 + Number(val) / 100)).toFixed(2);
        precios[i].precio_sin_iva = sin;
        precios[i].precio_con_iva = +(sin * (1 + s.iva_tasa / 100)).toFixed(2);
      }
      if (field === "precio_sin_iva") {
        precios[i].precio_con_iva = +(Number(val) * (1 + s.iva_tasa / 100)).toFixed(2);
        precios[i].utilidad_pct = s.costo > 0 ? +(((Number(val) / s.costo) - 1) * 100).toFixed(1) : 0;
      }
      return { ...s, precios };
    });
  };

  const save = async () => {
    if (!f.descripcion.trim()) return toast.error("La descripción es obligatoria");
    setSaving(true);
    try {
      const payload = { ...f, costo: Number(f.costo), existencia: Number(f.existencia), stock_minimo: Number(f.stock_minimo), precio_minimo: Number(f.precio_minimo), iva_tasa: Number(f.iva_tasa) };
      if (isEdit) await api.put(`/products/${product.id}`, payload);
      else await api.post("/products", payload);
      toast.success(isEdit ? "Producto actualizado" : "Producto creado");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const I = (label, k, type = "text", extra = {}) => (
    <div>
      <Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label>
      <Input type={type} value={f[k] ?? ""} onChange={(e) => set(k, type === "number" ? e.target.value : e.target.value)}
        data-testid={`prod-${k}`} className="mt-1" {...extra} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="product-form">
        <DialogHeader><DialogTitle className="font-display">{isEdit ? "Editar producto" : "Nuevo producto"}</DialogTitle></DialogHeader>
        <Tabs defaultValue="ident">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="ident">Identificación</TabsTrigger>
            <TabsTrigger value="gen">Generales</TabsTrigger>
            <TabsTrigger value="precios">Precios</TabsTrigger>
            <TabsTrigger value="sat">SAT</TabsTrigger>
            <TabsTrigger value="ctrl">Controles</TabsTrigger>
            <TabsTrigger value="ficha">Ficha técnica</TabsTrigger>
            <TabsTrigger value="extra">Sinónimos / Imagen</TabsTrigger>
          </TabsList>

          <TabsContent value="ident" className="grid grid-cols-2 gap-4 pt-2">
            {I("Código (auto si vacío)", "codigo")}
            {I("SKU", "sku")}
            <div className="col-span-2">{I("Descripción", "descripcion")}</div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Estado</Label>
              <Select value={f.estado} onValueChange={(v) => set("estado", v)}>
                <SelectTrigger data-testid="prod-estado" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="activo">Activo</SelectItem>
                  <SelectItem value="baja">Baja</SelectItem>
                  <SelectItem value="suspendido">Suspendido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="gen" className="grid grid-cols-2 gap-4 pt-2">
            {I("Unidad de medida", "unidad_medida")}
            {I("Empaque", "empaque")}
            {I("Costo", "costo", "number")}
            {I("Existencia inicial", "existencia", "number", { disabled: isEdit, title: isEdit ? "La existencia cambia por movimientos" : "" })}
            {I("Línea", "linea")}
            {I("Clasificación", "clasificacion")}
            {I("Ubicación", "ubicacion")}
            {I("Stock mínimo", "stock_minimo", "number")}
          </TabsContent>

          <TabsContent value="precios" className="pt-2 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              {I("IVA %", "iva_tasa", "number")}
              {I("Precio mínimo", "precio_minimo", "number")}
            </div>
            <table className="w-full text-sm border border-slate-200 rounded">
              <thead><tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="p-2 text-left">Lista</th><th className="p-2">% Utilidad</th><th className="p-2">Sin IVA</th><th className="p-2">Con IVA</th>
              </tr></thead>
              <tbody>
                {f.precios.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 font-medium">{p.nombre}</td>
                    <td className="p-1"><Input type="number" value={p.utilidad_pct} onChange={(e) => setPrecio(i, "utilidad_pct", e.target.value)} className="h-8" data-testid={`precio-util-${i}`} /></td>
                    <td className="p-1"><Input type="number" value={p.precio_sin_iva} onChange={(e) => setPrecio(i, "precio_sin_iva", e.target.value)} className="h-8" /></td>
                    <td className="p-2 text-center font-semibold text-[#0055A4]">{money(p.precio_con_iva)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="sat" className="grid grid-cols-2 gap-4 pt-2">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Clave SAT</Label><Input value={f.sat.clave_sat} onChange={(e) => setNested("sat", "clave_sat", e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Unidad SAT</Label><Input value={f.sat.unidad_sat} onChange={(e) => setNested("sat", "unidad_sat", e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Impuestos</Label><Input value={f.sat.impuestos} onChange={(e) => setNested("sat", "impuestos", e.target.value)} className="mt-1" /></div>
          </TabsContent>

          <TabsContent value="ctrl" className="grid grid-cols-2 gap-4 pt-2">
            {[["permitir_venta", "Permitir venta"], ["controlar_inventario", "Controlar inventario"], ["permitir_inventario_negativo", "Permitir inventario negativo"], ["mostrar_pos", "Mostrar en POS"], ["mostrar_catalogo", "Mostrar en catálogo"]].map(([k, l]) => (
              <div key={k} className="flex items-center justify-between border border-slate-200 rounded-md px-3 py-2">
                <span className="text-sm">{l}</span>
                <Switch checked={!!f.controles[k]} onCheckedChange={(v) => setNested("controles", k, v)} data-testid={`ctrl-${k}`} />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="ficha" className="grid grid-cols-2 gap-4 pt-2">
            {["material", "medidas", "peso", "capacidad", "color", "dimensiones", "presentacion"].map((k) => (
              <div key={k}><Label className="text-xs uppercase tracking-wider text-slate-500 capitalize">{k}</Label><Input value={f.ficha_tecnica[k]} onChange={(e) => setNested("ficha_tecnica", k, e.target.value)} className="mt-1" /></div>
            ))}
          </TabsContent>

          <TabsContent value="extra" className="space-y-4 pt-2">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Sinónimos (separados por coma)</Label>
              <Input value={f.sinonimos.join(", ")} onChange={(e) => set("sinonimos", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">URL de imagen</Label>
              <Input value={f.imagen_url} onChange={(e) => set("imagen_url", e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Descripción larga</Label>
              <Textarea value={f.descripcion_larga} onChange={(e) => set("descripcion_larga", e.target.value)} className="mt-1" /></div>
          </TabsContent>
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
