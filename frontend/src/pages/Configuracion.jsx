import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import Usuarios from "@/pages/Usuarios";
import { Building2, MapPin, DollarSign, Store, UserCog, Loader2, Plus, Trash2, Save } from "lucide-react";

export default function Configuracion() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get("/settings").then((r) => setS({ sucursales: [], listas_precios_nombres: ["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"], listas_precios_pct: [40, 30, 20, 15, 10], ...r.data })); }, []);

  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const setLista = (i, v) => setS((x) => ({ ...x, listas_precios_nombres: x.listas_precios_nombres.map((n, idx) => idx === i ? v : n) }));
  const setListaPct = (i, v) => setS((x) => ({ ...x, listas_precios_pct: (x.listas_precios_pct || [40, 30, 20, 15, 10]).map((n, idx) => idx === i ? v : n) }));
  const setSuc = (i, k, v) => setS((x) => ({ ...x, sucursales: x.sucursales.map((su, idx) => idx === i ? { ...su, [k]: v } : su) }));
  const addSuc = () => setS((x) => ({ ...x, sucursales: [...x.sucursales, { nombre: "", direccion: "", ciudad: "", estado: "", cp: "", telefono: "", activa: true }] }));
  const delSuc = (i) => setS((x) => ({ ...x, sucursales: x.sucursales.filter((_, idx) => idx !== i) }));

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

  if (!s) return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#0055A4]" /></div>;

  const I = (label, k, type = "text") => (
    <div><Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label>
      <Input type={type} value={s[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="mt-1" data-testid={`cfg-${k}`} /></div>
  );

  return (
    <div className="space-y-5" data-testid="configuracion-page">
      <div className="flex items-center justify-between">
        <div><h1 className="font-display text-2xl font-black tracking-tight">Configuración</h1><p className="text-slate-500 text-sm">Datos de la empresa, precios, sucursales y usuarios</p></div>
        <Button onClick={save} disabled={saving} className="bg-[#0055A4] hover:bg-[#004385]" data-testid="cfg-save"><Save className="w-4 h-4 mr-1" /> {saving ? "Guardando..." : "Guardar"}</Button>
      </div>

      <Tabs defaultValue="empresa">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="empresa" data-testid="tab-empresa"><Building2 className="w-4 h-4 mr-1" /> Empresa / Ubicación</TabsTrigger>
          <TabsTrigger value="precios" data-testid="tab-precios"><DollarSign className="w-4 h-4 mr-1" /> Precios</TabsTrigger>
          <TabsTrigger value="sucursales" data-testid="tab-sucursales"><Store className="w-4 h-4 mr-1" /> Sucursales</TabsTrigger>
          <TabsTrigger value="usuarios" data-testid="tab-usuarios"><UserCog className="w-4 h-4 mr-1" /> Usuarios</TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="pt-4">
          <div className="bg-white border border-slate-200 rounded-md p-5 grid grid-cols-2 gap-4 max-w-3xl">
            <div className="col-span-2 flex items-center gap-2 text-slate-700 font-semibold"><Building2 className="w-4 h-4 text-[#0055A4]" /> Datos generales</div>
            {I("Nombre de la empresa", "empresa_nombre")}
            {I("RFC", "rfc")}
            {I("Teléfono", "telefono")}
            {I("Correo", "correo")}
            <div className="col-span-2 flex items-center gap-2 text-slate-700 font-semibold mt-2"><MapPin className="w-4 h-4 text-[#0055A4]" /> Ubicación</div>
            <div className="col-span-2">{I("Dirección", "direccion")}</div>
            {I("Ciudad", "ciudad")}
            {I("Estado", "estado")}
            {I("Código Postal", "cp")}
          </div>
        </TabsContent>

        <TabsContent value="precios" className="pt-4">
          <div className="bg-white border border-slate-200 rounded-md p-5 max-w-lg space-y-4">
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
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">El % define la utilidad sugerida de cada lista sobre el costo (referencia para nuevos precios).</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sucursales" className="pt-4">
          <div className="space-y-3">
            {s.sucursales.map((su, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-md p-4 grid grid-cols-2 md:grid-cols-3 gap-3 relative">
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

        <TabsContent value="usuarios" className="pt-4">
          <Usuarios embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
