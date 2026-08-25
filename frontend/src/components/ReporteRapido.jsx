import { useState } from "react";
import { api, money } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Zap, Loader2 } from "lucide-react";

/**
 * REPORTE RÁPIDO propio del día (§3.2): tickets, total vendido y desglose
 * por forma de pago. NUNCA muestra utilidad ni márgenes.
 */
export default function ReporteRapido() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rep, setRep] = useState(null);

  const abrir = async () => {
    setOpen(true); setLoading(true);
    try {
      const { data } = await api.get("/sales/mi-reporte-hoy");
      setRep(data);
    } catch { toast.error("No se pudo cargar tu reporte"); }
    finally { setLoading(false); }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={abrir} data-testid="reporte-rapido-btn">
        <Zap className="w-4 h-4 mr-1 text-[#C1401E]" /> Reporte rápido
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="reporte-rapido-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Zap className="w-5 h-5 text-[#C1401E]" /> Mi reporte del día
            </DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[#C1401E]" /></div>
          ) : rep ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Ventas de hoy</div>
                  <div className="font-display font-black text-2xl">{rep.num_ventas}</div>
                </div>
                <div className="rounded-lg bg-[#C1401E]/5 border border-[#C1401E]/20 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Total vendido</div>
                  <div className="font-display font-black text-2xl text-[#C1401E]">{money(rep.total)}</div>
                </div>
              </div>

              {Object.keys(rep.por_metodo || {}).length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Por forma de pago</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(rep.por_metodo).map(([met, monto]) => (
                      <span key={met} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-xs">
                        <b className="capitalize">{met}</b> {money(monto)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Tickets del día</div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
                  {(rep.tickets || []).length === 0 && (
                    <p className="p-4 text-center text-slate-400 text-sm">Aún no registras ventas hoy.</p>
                  )}
                  {(rep.tickets || []).map((t) => (
                    <div key={t.folio} className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-slate-500">{t.hora || ""} · <b className="text-slate-700">{t.folio}</b></span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize text-[10px]">{t.metodo}</Badge>
                        <span className="font-semibold tabular-nums">{money(t.total)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
