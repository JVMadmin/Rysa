import { useEffect, useMemo, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, Loader2, Unlock, CheckCircle2, AlertTriangle, Coins, Banknote } from "lucide-react";

const BILLETES = [1000, 500, 200, 100, 50, 20];
const MONEDAS = [20, 10, 5, 2, 1, 0.5];

const DENOMINACIONES = (() => {
  const map = {};
  [...BILLETES, ...MONEDAS].forEach((v) => { map[v] = v; });
  return Object.keys(map).map(Number).sort((a, b) => b - a);
})();

export default function CajaAperturaModal({ open, onOpenChange, onAbierta }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [cajaActual, setCajaActual] = useState(null);
  const [fondo, setFondo] = useState("");
  const [usarDenom, setUsarDenom] = useState(true);
  const [cant, setCant] = useState(() => Object.fromEntries(DENOMINACIONES.map((v) => [String(v), ""])));
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setCajaActual(null);
    setFondo("");
    setCant(Object.fromEntries(DENOMINACIONES.map((v) => [String(v), ""])));
    setUsarDenom(true);
    setSaving(false);
    api.get("/caja/actual")
      .then((r) => setCajaActual(r.data?.caja || null))
      .catch(() => setCajaActual(null))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const totalDenom = useMemo(
    () => DENOMINACIONES.reduce((acc, v) => acc + Number(cant[String(v)] || 0) * v, 0),
    [cant]
  );
  const monto = Number(fondo || 0);
  const diff = usarDenom && Object.values(cant).some((v) => v !== "" && v !== 0)
    ? monto - totalDenom
    : null;

  const confirmar = async () => {
    if (!(monto > 0)) return toast.error("Ingresa un monto inicial válido");
    const denom = usarDenom
      ? Object.fromEntries(DENOMINACIONES.map((v) => [String(v), Number(cant[String(v)] || 0)]))
      : null;
    if (usarDenom && diff != null && Math.abs(diff) > 0.009) {
      return toast.error("El monto inicial no coincide con las denominaciones");
    }
    setSaving(true);
    try {
      await api.post("/caja/abrir", {
        fondo_inicial: monto,
        denominaciones: denom,
        metodo: usarDenom ? "denominaciones" : "solo_monto",
      });
      toast.success("Caja abierta correctamente");
      onOpenChange(false);
      onAbierta && onAbierta();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const sucursalNombre = cajaActual?.sucursal_id === user?.sucursal_id
    ? (cajaActual?.sucursal_nombre || user?.sucursal_nombre || "—") : (user?.sucursal_nombre || "—");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="caja-apertura-modal">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Wallet className="w-5 h-5 text-[#C1401E]" /> {cajaActual ? "CAJA ABIERTA" : "ABRIR CAJA"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>
        ) : cajaActual ? (
          <div className="space-y-4">
            <div className="card-soft p-5 space-y-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-700 px-3 py-1"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> {cajaActual.estado?.toUpperCase()}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><Label className="text-xs text-slate-400">Sesión</Label><div className="font-mono font-bold">{cajaActual.caja_nombre}</div></div>
                <div><Label className="text-xs text-slate-400">Usuario</Label><div>{cajaActual.usuario_nombre}</div></div>
                <div><Label className="text-xs text-slate-400">Sucursal</Label><div>{sucursalNombre}</div></div>
                <div><Label className="text-xs text-slate-400">Apertura</Label><div>{(cajaActual.fecha_apertura || "").slice(0, 16).replace("T", " ")}</div></div>
                <div className="col-span-2"><Label className="text-xs text-slate-400">Monto inicial</Label><div className="font-display text-xl font-black">{money(cajaActual.fondo_inicial)}</div></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Continuar</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Datos de usuario / sucursal / fecha / hora */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><Label className="text-xs text-slate-400">Usuario</Label><div className="font-semibold">{user?.name || "—"}</div></div>
              <div><Label className="text-xs text-slate-400">Sucursal</Label><div>{user?.sucursal_nombre || "—"}</div></div>
              <div><Label className="text-xs text-slate-400">Fecha</Label><div>{now.toLocaleDateString("es-MX")}</div></div>
              <div><Label className="text-xs text-slate-400">Hora</Label><div className="tabular-nums">{now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</div></div>
            </div>

            <div className="card-soft p-4">
              <Label className="text-xs uppercase tracking-wider text-slate-500">Efectivo inicial</Label>
              <div className="flex items-center mt-1">
                <span className="text-xl font-black text-slate-400 mr-1">$</span>
                <Input type="number" value={fondo} onChange={(e) => setFondo(e.target.value)} data-testid="caja-apertura-fondo" placeholder="2500.00" className="h-12 text-xl font-display" />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 card-soft p-4">
              <div className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-[#C1401E]" />
                <div>
                  <div className="font-semibold text-sm">Registrar denominaciones</div>
                  <div className="text-xs text-slate-400">Recomendado para controlar el conteo físico</div>
                </div>
              </div>
              <Switch checked={usarDenom} onCheckedChange={setUsarDenom} data-testid="caja-apertura-denom-toggle" />
            </div>

            {usarDenom && (
              <div className="card-soft p-4 space-y-4">
                <div>
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-500 mb-2"><Coins className="w-3.5 h-3.5" /> Billetes</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {BILLETES.map((v) => (
                      <div key={v} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2">
                        <span className="font-semibold">${v.toLocaleString("es-MX")}</span>
                        <Input type="number" value={cant[String(v)]} onChange={(e) => setCant((c) => ({ ...c, [String(v)]: e.target.value }))} className="h-8 w-20 text-right" data-testid={`denom-${v}`} placeholder="0" />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-500 mb-2"><Coins className="w-3.5 h-3.5" /> Monedas</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {MONEDAS.map((v) => (
                      <div key={v} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2">
                        <span className="font-semibold">${v.toLocaleString("es-MX")}</span>
                        <Input type="number" value={cant[String(v)]} onChange={(e) => setCant((c) => ({ ...c, [String(v)]: e.target.value }))} className="h-8 w-20 text-right" data-testid={`denom-${v}`} placeholder="0" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                  <div><div className="text-xs text-slate-400">Total por denominaciones</div><div className="font-display text-lg font-black">{money(totalDenom)}</div></div>
                  <div><div className="text-xs text-slate-400">Monto declarado</div><div className="font-display text-lg font-black">{money(monto)}</div></div>
                </div>
                {diff != null && Math.abs(diff) > 0.009 && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700" data-testid="caja-apertura-diff">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold">El monto inicial no coincide con las denominaciones</div>
                      <div className="text-xs">Diferencia: {money(diff >= 0 ? diff : Math.abs(diff))} {diff < 0 ? "de menos" : "de más"}</div>
                    </div>
                  </div>
                )}
                {diff != null && Math.abs(diff) <= 0.009 && (
                  <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700" data-testid="caja-apertura-ok">
                    <CheckCircle2 className="w-4 h-4" /> Monto correcto.
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="caja-apertura-cancel">Cancelar</Button>
              <Button
                onClick={confirmar}
                disabled={saving || !(monto > 0) || (usarDenom && diff != null && Math.abs(diff) > 0.009)}
                className="bg-[#C1401E] hover:bg-[#A03316]"
                data-testid="caja-apertura-confirm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <><Unlock className="w-4 h-4 mr-2" /> Confirmar apertura</>}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}