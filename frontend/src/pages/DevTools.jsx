import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bug, Loader2, Trash2, RefreshCw, AlertTriangle } from "lucide-react";

export default function DevTools() {
  const [info, setInfo] = useState(null);
  const [errores, setErrores] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const [i, e] = await Promise.all([
        api.get("/dev/info").then((r) => r.data),
        api.get("/dev/errores").then((r) => r.data.errores),
      ]);
      setInfo(i);
      setErrores(e);
    } catch {
      toast.error("No se pudo cargar la información de depuración");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);

  const limpiar = async () => {
    await api.delete("/dev/errores");
    setErrores([]);
    toast.success("Bitácora de errores limpiada");
  };

  return (
    <div className="space-y-6" data-testid="devtools-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Depuración y Mantenimiento</h1>
          <p className="text-slate-500 text-sm">Herramientas exclusivas del Administrador Desarrollador.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} data-testid="dev-reload"><RefreshCw className={`w-4 h-4 mr-1 ${busy ? "animate-spin" : ""}`} /> Refrescar</Button>
          <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={limpiar} data-testid="dev-clear"><Trash2 className="w-4 h-4 mr-1" /> Limpiar errores</Button>
        </div>
      </div>

      {busy && !info ? (
        <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card-soft p-5">
              <div className="text-xs uppercase tracking-wider text-slate-400">Entorno</div>
              <div className="font-display font-bold text-xl mt-1"><Badge variant="outline">{info?.entorno}</Badge></div>
            </div>
            <div className="card-soft p-5">
              <div className="text-xs uppercase tracking-wider text-slate-400">Python</div>
              <div className="font-display font-bold text-xl mt-1">{info?.python}</div>
            </div>
            <div className="card-soft p-5">
              <div className="text-xs uppercase tracking-wider text-slate-400">Servidor</div>
              <div className="font-display font-bold text-xl mt-1">{info?.fecha_servidor?.slice(0, 19)?.replace("T", " ")}</div>
            </div>
            <div className="card-soft p-5">
              <div className="text-xs uppercase tracking-wider text-slate-400">Errores en memoria</div>
              <div className={`font-display font-bold text-xl mt-1 ${errores.length ? "text-red-600" : ""}`}>{errores.length}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-soft p-6">
              <h3 className="font-display font-semibold text-lg text-slate-900 mb-4 flex items-center gap-2">
                <Bug className="w-5 h-5 text-terracota" /> Colecciones (conteo de documentos)
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {info?.colecciones && Object.entries(info.colecciones).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                    <span className="text-slate-500">{k}</span>
                    <span className="font-semibold text-slate-800">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-soft p-6">
              <h3 className="font-display font-semibold text-lg text-slate-900 mb-4">Roles del sistema</h3>
              <div className="space-y-2">
                {info?.roles && Object.entries(info.roles).map(([r, perms]) => (
                  <div key={r} className="text-sm">
                    <Badge variant="outline" className="uppercase mr-2">{r}</Badge>
                    <span className="text-xs text-slate-500">{perms.length} permisos{perms.includes("*") ? " · acceso total" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card-soft p-6">
            <h3 className="font-display font-semibold text-lg text-slate-900 mb-1 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-terracota" /> Bitácora de errores no controlados
            </h3>
            <p className="text-xs text-slate-400 mb-4">Últimos 200 errores del servidor. Limpiar para empezar a registrar de nuevo.</p>
            {errores.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">Sin errores registrados.</p>
            ) : (
              <div className="space-y-3">
                {errores.map((e) => (
                  <details key={e.id} className="border border-slate-200 rounded-lg px-3 py-2">
                    <summary className="cursor-pointer text-sm">
                      <span className="inline-flex items-center gap-2">
                        <Badge variant="destructive">{e.tipo}</Badge>
                        <span className="text-slate-400 text-xs">{e.fecha?.replace("T", " ")}</span>
                        <span className="text-slate-700 truncate">{e.ruta}</span>
                      </span>
                    </summary>
                    <div className="mt-2 text-xs text-slate-600">{e.mensaje}</div>
                    <pre className="mt-2 bg-slate-900 text-green-300 rounded-lg p-3 text-[11px] overflow-x-auto">{e.detalle}</pre>
                  </details>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}