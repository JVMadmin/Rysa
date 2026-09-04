import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { api, formatApiError, money } from "@/lib/api";
import { toast } from "sonner";
import { Boxes, Plus, Trash2, Edit2, Check, X, Barcode, Package, Info, Loader2 } from "lucide-react";

const SUGERENCIAS = ["CAJA", "PAQUETE", "DISPLAY", "BULTO", "REJA", "DOCENA", "CIENTO", "SIX-PACK"];

export default function PresentacionesModal({ open, onClose, product, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [presentations, setPresentations] = useState([]);
  const [saving, setSaving] = useState(false);
  
  // Formulario nueva / editar presentación
  const [editingId, setEditingId] = useState(null);
  const [nombre, setNombre] = useState("");
  const [factor, setFactor] = useState("");
  const [precio, setPrecio] = useState("");
  const [costo, setCosto] = useState("");
  const [barcode, setBarcode] = useState("");

  const loadPresentations = async () => {
    if (!product?.id) return;
    setLoading(true);
    try {
      const res = await api.get(`/products/${product.id}/presentations`);
      setPresentations(res.data || []);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && product?.id) {
      loadPresentations();
      resetForm();
    }
  }, [open, product]);

  const resetForm = () => {
    setEditingId(null);
    setNombre("");
    setFactor("");
    setPrecio("");
    setCosto("");
    setBarcode("");
  };

  // Calcular precio sugerido cuando cambia el factor
  const handleFactorChange = (val) => {
    setFactor(val);
    const numFactor = parseFloat(val) || 0;
    if (numFactor > 0 && !editingId) {
      const basePrice = parseFloat(product?.precio_con_iva || product?.precios?.[0]?.precio_con_iva || 0);
      const baseCost = parseFloat(product?.costo || 0);
      if (basePrice > 0 && !precio) {
        setPrecio((basePrice * numFactor).toFixed(2));
      }
      if (baseCost > 0 && !costo) {
        setCosto((baseCost * numFactor).toFixed(2));
      }
    }
  };

  const handleEdit = (p) => {
    setEditingId(p.id);
    setNombre(p.nombre || "");
    setFactor(String(p.factor || 1));
    setPrecio(p.precio != null ? String(p.precio) : "");
    setCosto(p.costo != null ? String(p.costo) : "");
    setBarcode(p.codigo_barras || "");
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    const cleanNombre = nombre.trim().toUpperCase();
    const numFactor = parseFloat(factor);

    if (!cleanNombre) return toast.error("El nombre de la presentación es obligatorio (ej. CAJA)");
    if (!numFactor || numFactor <= 0) return toast.error("El factor debe ser un número mayor a 0");

    setSaving(true);
    try {
      const payload = {
        nombre: cleanNombre,
        factor: numFactor,
        precio: precio !== "" ? parseFloat(precio) : null,
        costo: costo !== "" ? parseFloat(costo) : null,
        codigo_barras: barcode.trim() || null,
        es_base: false,
      };

      if (editingId) {
        await api.put(`/products/${product.id}/presentations/${editingId}`, payload);
        toast.success(`Presentación ${cleanNombre} actualizada`);
      } else {
        await api.post(`/products/${product.id}/presentations`, payload);
        toast.success(`Presentación ${cleanNombre} agregada`);
      }

      resetForm();
      await loadPresentations();
      if (onUpdated) onUpdated();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p) => {
    if (p.es_base) {
      return toast.error("No se puede eliminar la unidad base del producto");
    }
    if (!window.confirm(`¿Seguro que deseas eliminar la presentación ${p.nombre}?`)) return;

    try {
      await api.delete(`/products/${product.id}/presentations/${p.id}`);
      toast.success(`Presentación ${p.nombre} eliminada`);
      await loadPresentations();
      if (onUpdated) onUpdated();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const basePrice = parseFloat(product?.precio_con_iva || product?.precios?.[0]?.precio_con_iva || 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="presentaciones-modal">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#C1401E]/10 flex items-center justify-center text-[#C1401E]">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-display text-lg">
                Presentaciones y Empaques (Cajas / Piezas)
              </DialogTitle>
              <p className="text-xs text-slate-500 font-mono">
                {product?.codigo} · <span className="font-sans font-medium text-slate-700">{product?.descripcion}</span>
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Banner didáctico sobre Inventario Canónico */}
        <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-950">
              Control Canónico de Existencias: Unidad Base = <span className="underline font-bold">{product?.unidad_medida || "PZA"}</span> (Factor 1.0)
            </p>
            <p className="text-amber-800">
              El inventario físico siempre se cuenta en <strong>{product?.unidad_medida || "PZA"}</strong>. Cuando vendes o compras una presentación (ej. <em>CAJA de 12</em>), el sistema multiplica automáticamente por el factor y descuenta las piezas del almacén.
            </p>
          </div>
        </div>

        {/* Lista de presentaciones existentes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Presentaciones Configuradas ({presentations.length})
            </h3>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase">
                <tr>
                  <th className="p-2.5 text-left">Presentación</th>
                  <th className="p-2.5 text-center">Tipo</th>
                  <th className="p-2.5 text-right">Factor (Unid. Base)</th>
                  <th className="p-2.5 text-left">Código de Barras</th>
                  <th className="p-2.5 text-right">Precio Venta</th>
                  <th className="p-2.5 text-right">Costo</th>
                  <th className="p-2.5 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {presentations.map((p) => {
                  const isBase = !!p.es_base || p.factor === 1.0;
                  return (
                    <tr key={p.id} className={isBase ? "bg-slate-50/40" : "hover:bg-slate-50"}>
                      <td className="p-2.5 font-bold text-slate-800 flex items-center gap-1.5">
                        <Package className={`w-3.5 h-3.5 ${isBase ? "text-emerald-600" : "text-[#C1401E]"}`} />
                        {p.nombre}
                      </td>
                      <td className="p-2.5 text-center">
                        {isBase ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px] font-medium">
                            Unidad Base
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-[10px] font-medium">
                            Empaque Comercial
                          </Badge>
                        )}
                      </td>
                      <td className="p-2.5 text-right font-mono font-semibold text-slate-700">
                        x{p.factor} {product?.unidad_medida || "PZA"}
                      </td>
                      <td className="p-2.5 font-mono text-slate-500">
                        {p.codigo_barras ? (
                          <span className="inline-flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            <Barcode className="w-3 h-3 text-slate-400" /> {p.codigo_barras}
                          </span>
                        ) : (
                          <span className="text-slate-300 italic">Sin código</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right font-semibold text-slate-800">
                        {p.precio != null ? money(p.precio) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2.5 text-right text-slate-500">
                        {p.costo != null ? money(p.costo) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2.5 text-center">
                        {isBase ? (
                          <span className="text-[10px] text-slate-400 italic">Canónica</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-slate-600 hover:text-blue-600"
                              onClick={() => handleEdit(p)}
                              title="Editar presentación"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-slate-400 hover:text-red-600"
                              onClick={() => handleDelete(p)}
                              title="Eliminar presentación"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Formulario de Alta / Edición de Presentación */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-[#C1401E]" />
              {editingId ? "Editar Presentación" : "Nueva Presentación Comercial (Caja, Paquete, etc.)"}
            </h4>
            {editingId && (
              <Button size="sm" variant="ghost" className="h-6 text-xs text-slate-500" onClick={resetForm}>
                <X className="w-3 h-3 mr-1" /> Cancelar edición
              </Button>
            )}
          </div>

          {/* Sugerencias rápidas */}
          {!editingId && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-slate-400 mr-1">Sugerencias:</span>
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setNombre(s)}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-white border border-slate-200 text-slate-600 hover:border-[#C1401E] hover:text-[#C1401E] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-slate-500">Nombre Empaque *</Label>
              <Input
                placeholder="Ej. CAJA"
                value={nombre}
                onChange={(e) => setNombre(e.target.value.toUpperCase())}
                className="mt-1 h-8 text-xs font-bold"
                data-testid="pres-nombre-input"
              />
            </div>

            <div>
              <Label className="text-[11px] uppercase tracking-wider text-slate-500">
                Factor ({product?.unidad_medida || "PZA"} por empaque) *
              </Label>
              <Input
                type="number"
                step="any"
                min="0.001"
                placeholder="Ej. 12"
                value={factor}
                onChange={(e) => handleFactorChange(e.target.value)}
                className="mt-1 h-8 text-xs font-semibold"
                data-testid="pres-factor-input"
              />
            </div>

            <div>
              <Label className="text-[11px] uppercase tracking-wider text-slate-500">
                Precio Venta (con IVA)
              </Label>
              <Input
                type="number"
                step="any"
                placeholder={basePrice > 0 && factor ? (basePrice * factor).toFixed(2) : "0.00"}
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                className="mt-1 h-8 text-xs font-semibold text-emerald-700"
                data-testid="pres-precio-input"
              />
            </div>

            <div>
              <Label className="text-[11px] uppercase tracking-wider text-slate-500">
                Código de Barras Empaque
              </Label>
              <Input
                placeholder="Escanea código de la caja"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="mt-1 h-8 text-xs font-mono"
                data-testid="pres-barcode-input"
              />
            </div>

            <div className="flex items-end">
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="w-full h-8 text-xs bg-[#C1401E] hover:bg-[#A03316]"
                data-testid="pres-save-btn"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : editingId ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1" /> Actualizar
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Agregar
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
