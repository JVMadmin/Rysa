import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmtFechaHora, fmtFechaLarga } from "@/lib/fechas";
import { NOVEDADES } from "@/lib/novedades";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

// Versión de esta pantalla (la compiló scripts/deploy.sh con VERSION y git).
export const VERSION_WEB = process.env.REACT_APP_VERSION || "dev";
export const COMMIT_WEB = process.env.REACT_APP_COMMIT || "dev";
const FECHA_WEB = process.env.REACT_APP_BUILD_DATE || "";
const REVISAR_MS = 5 * 60 * 1000;

// Pie del menú lateral: versión, «Acerca de RYSA» con novedades y aviso de
// versión nueva. Tras un despliegue, quien tenía el ERP abierto seguía con la
// pantalla vieja hasta recargar; ahora se le avisa (sin recargar solo, para no
// interrumpir una venta).
export default function VersionRysa({ contraido }) {
  const [abierto, setAbierto] = useState(false);
  const [servidor, setServidor] = useState(null);
  const avisada = useRef("");

  useEffect(() => {
    let vivo = true;
    const revisar = async () => {
      try {
        const { data } = await api.get("/version");
        if (!vivo) return;
        setServidor(data);
        const nueva = COMMIT_WEB !== "dev" && data?.commit && data.commit !== "dev" && data.commit !== COMMIT_WEB;
        if (nueva && avisada.current !== data.commit) {
          avisada.current = data.commit;
          toast("Hay una versión nueva de RYSA", {
            description: `Versión ${data.version}. Termina lo que estás haciendo y actualiza la pantalla.`,
            duration: Infinity,
            action: { label: "Actualizar", onClick: () => window.location.reload() },
          });
        }
      } catch { /* sin conexión: se revisa en el siguiente ciclo */ }
    };
    revisar();
    const t = setInterval(revisar, REVISAR_MS);
    const alVolver = () => { if (document.visibilityState === "visible") revisar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { vivo = false; clearInterval(t); document.removeEventListener("visibilitychange", alVolver); };
  }, []);

  const hayNueva = servidor?.commit && COMMIT_WEB !== "dev" && servidor.commit !== COMMIT_WEB;
  const escritorio = window.rysaEscritorio?.version;

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} title="Acerca de RYSA"
        className={`flex items-center gap-1.5 text-[11px] text-slate-500 transition-colors hover:text-slate-200 ${contraido ? "justify-center" : "px-5"} pb-2`}
        data-testid="version-rysa">
        {hayNueva && <span className="h-1.5 w-1.5 rounded-full bg-brand-400" aria-label="Versión nueva disponible" />}
        <span className="tabular-nums">{contraido ? `v${VERSION_WEB.split(".").slice(0, 2).join(".")}` : `RYSA v${VERSION_WEB}`}</span>
        {!contraido && COMMIT_WEB !== "dev" && <span className="font-mono text-slate-600">· {COMMIT_WEB}</span>}
      </button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-lg" data-testid="acerca-rysa">
          <DialogHeader><DialogTitle>Acerca de RYSA ERP</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Esta pantalla</dt>
              <dd className="tabular-nums">v{VERSION_WEB} <span className="font-mono text-slate-500">{COMMIT_WEB}</span>{FECHA_WEB && <span className="text-slate-500"> · {fmtFechaHora(FECHA_WEB)}</span>}</dd>
              <dt className="text-slate-500">Servidor</dt>
              <dd className="tabular-nums">{servidor ? <>v{servidor.version} <span className="font-mono text-slate-500">{servidor.commit}</span>{servidor.fecha && <span className="text-slate-500"> · {fmtFechaHora(servidor.fecha)}</span>}</> : "—"}</dd>
              {escritorio && (<><dt className="text-slate-500">App de escritorio</dt><dd className="tabular-nums">v{escritorio}</dd></>)}
            </dl>
            {hayNueva && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-brand-200 bg-brand-50 p-3 text-sm">
                <span>Hay una versión nueva publicada (v{servidor.version}).</span>
                <Button size="sm" onClick={() => window.location.reload()}>Actualizar</Button>
              </div>
            )}
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Sparkles className="h-4 w-4 text-brand-600" /> Novedades</h3>
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {NOVEDADES.map((n) => (
                  <div key={n.version}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">v{n.version} · {fmtFechaLarga(n.fecha)}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                      {n.cambios.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
