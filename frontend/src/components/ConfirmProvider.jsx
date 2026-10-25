import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";

// Confirmación con el diseño del ERP (en lugar de window.confirm/prompt, que
// muestran el cuadro gris del navegador). Uso:
//   const confirmar = useConfirm();
//   if (!(await confirmar({ titulo: "¿Dar de baja?", mensaje: "…", accion: "Dar de baja", peligro: true }))) return;
//   const r = await confirmar({ titulo: "Cancelar venta", pedirMotivo: true });  // r = { motivo } o false
const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null);
  const [motivo, setMotivo] = useState("");
  const resolver = useRef(null);

  const confirmar = useCallback((o) => new Promise((resolve) => {
    resolver.current = resolve;
    setMotivo(o?.motivoInicial || "");
    setOpts({ accion: "Confirmar", cancelar: "Cancelar", ...o });
  }), []);

  const cerrar = (valor) => {
    const r = resolver.current;
    resolver.current = null;
    setOpts(null);
    r?.(valor);
  };
  const aceptar = () => {
    if (opts?.pedirMotivo) {
      if (opts.motivoObligatorio && !motivo.trim()) return;
      cerrar({ motivo: motivo.trim() });
    } else {
      cerrar(true);
    }
  };

  return (
    <ConfirmCtx.Provider value={confirmar}>
      {children}
      <AlertDialog open={!!opts} onOpenChange={(o) => { if (!o) cerrar(false); }}>
        <AlertDialogContent data-testid="confirmar-dialogo">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {opts?.peligro && <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />}
              {opts?.titulo}
            </AlertDialogTitle>
            {opts?.mensaje && <AlertDialogDescription className="whitespace-pre-line">{opts.mensaje}</AlertDialogDescription>}
          </AlertDialogHeader>
          {opts?.pedirMotivo && (
            <div className="space-y-1.5">
              <label htmlFor="confirmar-motivo" className="text-sm font-medium text-slate-700">
                {opts.etiquetaMotivo || "Motivo"}{opts.motivoObligatorio ? "" : " (opcional)"}
              </label>
              <Textarea id="confirmar-motivo" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)}
                placeholder={opts.placeholderMotivo || ""} rows={3} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => cerrar(false)}>{opts?.cancelar}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); aceptar(); }}
              disabled={!!(opts?.pedirMotivo && opts?.motivoObligatorio && !motivo.trim())}
              className={opts?.peligro ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-brand-600 text-white hover:bg-brand-700"}
              data-testid="confirmar-aceptar">
              {opts?.accion}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(ConfirmCtx);
  // Fuera del ERP (sin proveedor) se cae al cuadro del navegador.
  return c || (async (o) => (o?.pedirMotivo ? (window.prompt(o?.titulo || "") ?? false) && { motivo: "" } : window.confirm(o?.titulo || "¿Continuar?")));
}
