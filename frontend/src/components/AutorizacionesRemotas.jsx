import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatApiError, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { BellRing, Check, X, Loader2, AlertTriangle } from "lucide-react";

// Aviso a pantalla completa para quien puede autorizar (autorizacion.otorgar):
// cuando una caja pide un precio manual a distancia, cubre la pantalla con
// timbre hasta que alguien lo autoriza o lo rechaza. Ver autorizaciones.py.
// Cada 5 s con la pantalla a la vista; cada 15 s con la pestaña oculta (ahí
// avisa la notificación del sistema). Antes era cada 3 s siempre.
const INTERVALO_MS = 5000;
const INTERVALO_OCULTA_MS = 15000;
const TIMBRE_MS = 2500;

// Timbre de tres tonos con Web Audio (sin archivos). Los navegadores solo dejan
// sonar después de que el usuario tocó la página, así que se desbloquea con el
// primer clic o tecla.
let audioCtx = null;
const audio = () => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { return null; }
  return audioCtx;
};
const timbre = () => {
  const c = audio();
  if (!c) return;
  [[988, 0], [740, 0.2], [988, 0.4]].forEach(([f, t]) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "square";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, c.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.3, c.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t + 0.18);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + t);
    o.stop(c.currentTime + t + 0.2);
  });
};

const precioTxt = (s) => {
  const v = s.precio_vista ?? s.precio;
  return `${money(v)} ${s.con_iva ? "con IVA" : "sin IVA"}`;
};

// Notificación del sistema (escritorio o celular) y vibración, para cuando la
// pestaña está en segundo plano.
const avisarSistema = (s) => {
  try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch {}
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const titulo = "Autorización de precio manual";
  const opts = {
    body: `${s.solicitante_nombre || "Una caja"} pide ${s.codigo} a ${precioTxt(s)}`,
    tag: `autz-${s.id}`, requireInteraction: true, renotify: true,
  };
  try {
    const n = new Notification(titulo, opts);
    n.onclick = () => { window.focus(); n.close(); };
  } catch {
    // Android no permite `new Notification` en la página: va por el service worker si hay.
    navigator.serviceWorker?.getRegistration?.().then((r) => r?.showNotification(titulo, opts)).catch(() => {});
  }
};

const hora = (iso) => {
  try { return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
};

export default function AutorizacionesRemotas() {
  const { user, can } = useAuth();
  const habilitado = !!user && can("autorizacion.otorgar");
  const [pend, setPend] = useState([]);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [permiso, setPermiso] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const vistos = useRef(new Set());
  const panelRef = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const { data } = await api.get("/autorizaciones/pendientes");
      setPend(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    if (!habilitado) return undefined;
    let t;
    const ciclo = async () => {
      await cargar();
      t = setTimeout(ciclo, document.visibilityState === "visible" ? INTERVALO_MS : INTERVALO_OCULTA_MS);
    };
    ciclo();
    const onVis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", audio, { once: true });
    window.addEventListener("keydown", audio, { once: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", audio);
      window.removeEventListener("keydown", audio);
    };
  }, [habilitado, cargar]);

  // Una vez por sesión: ofrecer los avisos del sistema en este dispositivo.
  useEffect(() => {
    if (!habilitado || permiso !== "default") return;
    try { if (sessionStorage.getItem("rysa_autz_aviso")) return; sessionStorage.setItem("rysa_autz_aviso", "1"); } catch {}
    toast("Avisos de autorización", {
      description: "Activa las notificaciones para enterarte aunque esta pestaña esté en segundo plano.",
      duration: 15000,
      action: { label: "Activar", onClick: () => pedirPermiso() },
    });
  }, [habilitado]); // eslint-disable-line

  const pedirPermiso = async () => {
    try { setPermiso(await Notification.requestPermission()); } catch {}
  };

  // Solicitudes nuevas → notificación del sistema y vibración.
  useEffect(() => {
    for (const s of pend) {
      if (!vistos.current.has(s.id)) { vistos.current.add(s.id); avisarSistema(s); }
    }
  }, [pend]);

  // Timbre repetido y título parpadeante mientras haya alguna en espera.
  const hay = pend.length > 0;
  useEffect(() => {
    if (!hay) return undefined;
    timbre();
    const t = setInterval(timbre, TIMBRE_MS);
    const titulo = document.title;
    let on = false;
    const tt = setInterval(() => { on = !on; document.title = on ? "🔔 Autorización pendiente" : titulo; }, 1000);
    return () => { clearInterval(t); clearInterval(tt); document.title = titulo; };
  }, [hay]);

  // Mientras el aviso está abierto, el teclado no llega a la pantalla de atrás
  // (atajos del POS, búsquedas…).
  useEffect(() => {
    if (!hay) return undefined;
    const bloquear = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) { e.stopPropagation(); e.preventDefault(); }
    };
    window.addEventListener("keydown", bloquear, true);
    return () => window.removeEventListener("keydown", bloquear, true);
  }, [hay]);

  const actual = pend[0];
  useEffect(() => { setRechazando(false); setMotivo(""); }, [actual?.id]);

  if (!habilitado || !actual) return null;

  const responder = async (aprobar) => {
    setBusy(true);
    try {
      await api.post(`/autorizaciones/solicitudes/${actual.id}/responder`, { aprobar, motivo: aprobar ? null : motivo });
      toast.success(aprobar ? `Autorizaste ${actual.codigo} a ${precioTxt(actual)}` : `Rechazaste el precio de ${actual.codigo}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
      cargar();
    }
  };

  const neto = Number(actual.precio || 0);
  const costo = Number(actual.costo || 0);
  const bajoCosto = costo > 0 && neto < costo;
  const anterior = actual.precio_anterior_vista ?? actual.precio_anterior;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
      role="alertdialog" aria-modal="true" aria-labelledby="autz-remota-titulo" data-testid="autorizacion-remota">
      <div ref={panelRef} className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl ring-4 ring-brand-600/70">
        <div className="flex items-center gap-3 bg-brand-600 px-5 py-4 text-white">
          <BellRing className="h-8 w-8 shrink-0 animate-bounce" />
          <div className="min-w-0">
            <p id="autz-remota-titulo" className="font-display text-xl font-black leading-tight">Autorización de precio manual</p>
            <p className="text-sm text-white/85">
              {pend.length > 1 ? `${pend.length} solicitudes en espera` : "Una caja está detenida esperando tu respuesta"}
            </p>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-500">Solicita</span>
            <span className="text-right font-semibold text-slate-900">{actual.solicitante_nombre}{actual.caja ? ` · ${actual.caja}` : ""}</span>
            {actual.cliente_nombre && (<>
              <span className="text-slate-500">Cliente</span>
              <span className="text-right font-medium text-slate-900">{actual.cliente_nombre}</span>
            </>)}
            <span className="text-slate-500">Recibida</span>
            <span className="text-right tabular-nums text-slate-900">{hora(actual.fecha)} · vence {hora(actual.responder_antes)}</span>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium tracking-wide text-slate-500">{actual.codigo}{actual.cantidad ? ` · cantidad ${actual.cantidad}` : ""}</p>
            <p className="font-semibold leading-snug text-slate-900">{actual.descripcion}</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="text-sm text-slate-500">
                {anterior != null && <div>Precio de lista: <span className="tabular-nums line-through">{money(anterior)}</span></div>}
                {costo > 0 && <div>Costo sin IVA: <span className="tabular-nums">{money(costo)}</span></div>}
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Precio solicitado</p>
                <p className="font-display text-3xl font-black leading-none tabular-nums text-brand-600">{money(actual.precio_vista ?? actual.precio)}</p>
                <p className="text-xs text-slate-500">{actual.con_iva ? "con IVA" : "sin IVA"}</p>
              </div>
            </div>
            {bajoCosto && (
              <p className="mt-3 flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-sm font-semibold text-red-700">
                <AlertTriangle className="h-4 w-4" /> El precio queda por debajo del costo
              </p>
            )}
          </div>

          {rechazando && (
            <Input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300}
              placeholder="Motivo del rechazo (opcional)" data-testid="autorizacion-remota-motivo" />
          )}

          <div className="grid grid-cols-2 gap-3">
            {rechazando ? (
              <Button variant="outline" className="h-12 text-base" disabled={busy} onClick={() => setRechazando(false)}>Regresar</Button>
            ) : (
              <Button variant="outline" className="h-12 border-red-300 text-base text-red-700 hover:bg-red-50" disabled={busy}
                onClick={() => setRechazando(true)} data-testid="autorizacion-remota-rechazar">
                <X className="mr-1.5 h-5 w-5" /> Rechazar
              </Button>
            )}
            {rechazando ? (
              <Button className="h-12 bg-red-600 text-base hover:bg-red-700" disabled={busy} onClick={() => responder(false)}
                data-testid="autorizacion-remota-confirmar-rechazo">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirmar rechazo"}
              </Button>
            ) : (
              <Button className="h-12 bg-green-600 text-base hover:bg-green-700" disabled={busy} onClick={() => responder(true)}
                data-testid="autorizacion-remota-aprobar">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : (<><Check className="mr-1.5 h-5 w-5" /> Autorizar</>)}
              </Button>
            )}
          </div>

          {permiso === "default" && (
            <button type="button" onClick={pedirPermiso} className="w-full text-center text-xs text-slate-500 underline-offset-2 hover:underline">
              Activar notificaciones en este dispositivo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
