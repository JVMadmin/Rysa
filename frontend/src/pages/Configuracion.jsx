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
import { fileUrl } from "@/lib/api";
import { Building2, MapPin, DollarSign, Store, UserCog, Loader2, Plus, Trash2, Save, Receipt } from "lucide-react";

export default function Configuracion() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get("/settings").then((r) => setS({ sucursales: [], listas_precios_nombres: ["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"], listas_precios_pct: [40, 30, 20, 15, 10], logo_url: "", ticket_config: {}, ...r.data, ticket_config: { tamano: "80mm", mostrar_rfc: true, mostrar_direccion: true, mostrar_telefono: true, encabezado: "", pie: "¡Gracias por su compra!", ...(r.data?.ticket_config || {}) } })); }, []);

  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const setTc = (k, v) => setS((x) => ({ ...x, ticket_config: { ...(x.ticket_config || {}), [k]: v } }));
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
          <TabsTrigger value="ticket" data-testid="tab-ticket"><Receipt className="w-4 h-4 mr-1" /> Diseño de ticket</TabsTrigger>
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

        <TabsContent value="ticket" className="pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-slate-200 rounded-md p-5 space-y-4">
              <div className="flex items-center gap-2 text-slate-700 font-semibold"><Receipt className="w-4 h-4 text-[#0055A4]" /> Diseño de ticket</div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">Logo del negocio</Label>
                <ImageUpload value={s.logo_url} onChange={(v) => set("logo_url", v)} testid="cfg-logo-upload" heightClass="h-28" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Tamaño de papel</Label>
                <div className="flex gap-2 mt-1">
                  {[["80mm", "Ticket 80mm"], ["carta", "Carta"]].map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setTc("tamano", v)} data-testid={`cfg-ticket-size-${v}`}
                      className={`flex-1 py-2 rounded-md border text-sm font-medium ${(s.ticket_config?.tamano || "80mm") === v ? "border-[#0055A4] bg-[#0055A4]/5 text-[#0055A4]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-slate-500">Campos a mostrar</Label>
                {[["mostrar_rfc", "RFC"], ["mostrar_direccion", "Dirección"], ["mostrar_telefono", "Teléfono"]].map(([k, l]) => (
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
                <div className="border-t border-dashed border-black my-1" />
                <div>FOLIO: V000123</div>
                <div>Cliente: Público General</div>
                <div className="border-t border-dashed border-black my-1" />
                <div className="flex justify-between"><span>2 x Producto demo</span><span>$100.00</span></div>
                <div className="flex justify-between"><span>1 x Otro artículo</span><span>$50.00</span></div>
                <div className="border-t border-dashed border-black my-1" />
                <div className="flex justify-between font-bold text-[13px]"><span>TOTAL</span><span>$150.00</span></div>
                <div className="border-t border-dashed border-black my-1" />
                <div className="text-center">{s.ticket_config?.pie || "¡Gracias por su compra!"}</div>
              </div>
              <p className="text-[11px] text-slate-400 mt-2 text-center max-w-xs">Así se verá el ticket/PDF que se imprime y se envía por WhatsApp. Guarda para aplicar los cambios.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="usuarios" className="pt-4">
          <Usuarios embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
