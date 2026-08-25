import { X, Phone, MapPin, Store, CalendarDays, Camera } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { money, fileUrl } from "@/lib/api";

/**
 * Ficha técnica rápida de un cliente (se abre al ubicarlo desde el listado
 * o al hacer click en su marcador). Compartida por las pestañas con mapa.
 */
export default function FichaCliente({ c, onCerrar }) {
  if (!c) return null;
  const vencido = Number(c.vencido || 0);
  const saldo = Number(c.saldo || 0);
  return (
    <div className="card-soft p-4 relative" data-testid="ficha-cliente">
      <button onClick={onCerrar}
              className="absolute top-3 right-3 text-slate-300 hover:text-slate-500"
              data-testid="ficha-cliente-cerrar">
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-2 pr-6">
        <Store className="w-5 h-5 text-[#C1401E] shrink-0 mt-0.5" />
        <div>
          <div className="font-display font-bold leading-tight">{c.nombre}</div>
          <div className="text-xs text-slate-400 font-mono">{c.codigo || "—"}</div>
        </div>
      </div>

      {/* Foto de fachada: ayuda a identificar el negocio físicamente */}
      {c.foto_fachada ? (
        <a href={fileUrl(c.foto_fachada)} target="_blank" rel="noreferrer" className="block mt-3 group relative"
           title="Ver foto de fachada en grande">
          <img src={fileUrl(c.foto_fachada)} alt={`Fachada de ${c.nombre}`}
               className="w-full h-44 object-cover rounded-lg border border-slate-200" loading="lazy" />
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">
            <Camera className="w-3 h-3" /> Fachada
          </span>
        </a>
      ) : (
        <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1">
          <Camera className="w-3.5 h-3.5" /> Sin foto de fachada — el vendedor puede subirla desde su cartera.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-[10px] uppercase text-slate-400">Saldo</div>
          <div className={`text-sm font-bold ${saldo > 0 ? "text-amber-600" : "text-green-700"}`}>{money(saldo)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-[10px] uppercase text-slate-400">Vencido</div>
          <div className={`text-sm font-bold ${vencido > 0 ? "text-red-600" : "text-slate-300"}`}>{money(vencido)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-[10px] uppercase text-slate-400">Últ. visita</div>
          <div className="text-sm font-semibold flex items-center gap-1"><CalendarDays className="w-3 h-3 text-slate-400" />{c.ultima_visita ? String(c.ultima_visita).slice(0, 10) : "—"}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-[10px] uppercase text-slate-400">Próx. visita</div>
          <div className="text-sm font-semibold">{c.proxima_visita ? String(c.proxima_visita).slice(0, 10) : "—"}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
        {c.telefono && (
          <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.telefono}</span>
        )}
        {(c.direccion || c.ciudad) && (
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {[c.direccion, c.ciudad].filter(Boolean).join(", ")}</span>
        )}
        {c.vendedor_nombre && <span>Vendedor: <b>{c.vendedor_nombre}</b></span>}
        <span className="font-mono text-[11px]">
          GPS: {Number.isFinite(Number(c.latitud)) ? `${Number(c.latitud).toFixed(5)}, ${Number(c.longitud).toFixed(5)}` : "sin ubicación"}
        </span>
      </div>

      {vencido > 0 && (
        <Badge className="mt-2 bg-red-100 text-red-700">Con saldo vencido — gestionar cobro</Badge>
      )}
    </div>
  );
}
