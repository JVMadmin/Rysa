import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, money } from "@/lib/api";
import { Loader2, ShieldCheck, ShieldX, CheckCircle2, Package } from "lucide-react";

export default function TicketVerificar() {
  const { saleId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!saleId) { setError(true); setLoading(false); return; }
    api.get(`/sales/${saleId}/public`).then((r) => {
      setData(r.data); setLoading(false);
    }).catch(() => { setError(true); setLoading(false); });
  }, [saleId]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4" data-testid="verificar-page">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md overflow-hidden">
        <div className={`p-6 text-center ${error ? "bg-red-50" : "bg-emerald-50"}`}>
          {loading ? <Loader2 className="w-10 h-10 animate-spin text-slate-400 mx-auto" /> : (
            error ? (
              <><ShieldX className="w-10 h-10 text-red-500 mx-auto mb-2" /><h1 className="font-display text-xl font-black text-red-700">Ticket no encontrado</h1>
                <p className="text-sm text-red-600 mt-1">El ticket no existe o no es válido.</p></>
            ) : (
              <><ShieldCheck className="w-10 h-10 text-emerald-600 mx-auto mb-2" /><h1 className="font-display text-xl font-black text-emerald-700 flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> Ticket verificable</h1>
                <p className="text-sm text-emerald-600 mt-1">Este folio corresponde a un ticket oficial de {data.empresa}.</p></>
            )
          )}
        </div>

        {data && !error && (
          <div className="p-6 space-y-4">
            <div className="text-center">
              <div className="font-display text-3xl font-black text-[#C1401E]">{data.folio}</div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">{data.empresa} · {data.rfc}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-400">Fecha</div><div className="font-medium">{(data.fecha || "").slice(0, 16).replace("T", " ")}</div></div>
              <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-400">Cliente</div><div className="font-medium truncate">{data.cliente}</div></div>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                <Package className="w-3.5 h-3.5" /> Productos
              </div>
              {(data.items || []).map((it, i) => (
                <div key={i} className="flex justify-between px-3 py-2 text-sm border-b border-slate-100 last:border-0">
                  <span className="truncate mr-2">{it.cantidad} x {it.descripcion}</span>
                  <span className="font-medium shrink-0">{money(it.importe)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between bg-slate-900 text-white rounded-lg px-4 py-3">
              <span className="text-sm">TOTAL</span>
              <span className="font-display font-black text-xl">{money(data.total)}</span>
            </div>
            <p className="text-center text-xs text-slate-400">Puedes usar este folio ({data.folio}) para facturar tu compra en Grupo RYSA.</p>
          </div>
        )}
      </div>
    </div>
  );
}