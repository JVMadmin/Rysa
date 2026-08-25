import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Activity, AlertOctagon, AlertTriangle, Bug, CheckCircle2, Database,
  Eraser, FileDown, HardDrive, Layers, Loader2, RefreshCw, ScrollText,
  Server, ShieldCheck, Sparkles, Trash2, Wrench, XCircle,
} from "lucide-react";

const TERRACOTA = "#C1401E";
const nf = new Intl.NumberFormat("es-MX");

/* ============================ Componentes base ============================ */

function TarjetaEstado({ icono: Icono, titulo, ok, detalle, extra }) {
  return (
    <div className="card-soft p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icono className={`w-4 h-4 ${ok ? "text-emerald-600" : "text-red-600"}`} />
        <div className="text-xs uppercase tracking-wider text-slate-400">{titulo}</div>
      </div>
      <div className={`text-sm font-semibold ${ok ? "text-slate-800" : "text-red-600"}`}>
        {detalle}
      </div>
      {extra && <div className="text-[11px] text-slate-400 mt-1">{extra}</div>}
    </div>
  );
}

/**
 * Diálogo de doble confirmación para operaciones destructivas.
 * `palabra` debe escribirse exactamente para habilitar el botón.
 */
function DialogoPeligro({ abierto, onOpenChange, titulo, descripcion, palabra,
                         cargando, onConfirmar, permiteForzar, forzar, setForzar,
                         bloqueos }) {
  const [txt, setTxt] = useState("");
  useEffect(() => { if (!abierto) setTxt(""); }, [abierto]);
  const listo = txt.trim() === palabra;
  return (
    <AlertDialog open={abierto} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" /> {titulo}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{descripcion}</p>
              <p>Esta operación eliminará permanentemente los datos seleccionados
                 dentro de una transacción (si algo falla, se revierte todo).
                 Quedará registrada en auditoría.</p>
              {bloqueos && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  <b>Bloqueado:</b> {bloqueos.mensaje}
                  <ul className="list-disc ml-4 mt-1">
                    {Object.entries(bloqueos.bloqueos || {}).map(([k, v]) => (
                      <li key={k}>{k}: {nf.format(v)} registro(s)</li>
                    ))}
                  </ul>
                </div>
              )}
              {permiteForzar && (
                <label className="flex items-center gap-2 text-xs text-slate-700 select-none">
                  <Checkbox checked={!!forzar} onCheckedChange={(v) => setForzar(!!v)} />
                  Limpieza en cascada (eliminar también los documentos dependientes)
                </label>
              )}
              <div className="pt-1">
                <div className="text-xs mb-1">
                  Escribe <b className="text-red-700">{palabra}</b> para habilitar la acción:
                </div>
                <Input value={txt} onChange={(e) => setTxt(e.target.value)}
                       placeholder={palabra} autoFocus />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button variant="destructive" disabled={!listo || cargando}
                  onClick={() => onConfirmar && onConfirmar(txt)}>
            {cargando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
            Continuar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}


/* Panel de resultado antes/eliminados/después */
function ResultadoLimpieza({ res }) {
  if (!res) return null;
  const claves = Object.keys(res.eliminados || {});
  return (
    <div className="card-soft p-5 border border-emerald-200 bg-emerald-50/40" data-testid="dev-clean-result">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        <span className="font-semibold text-sm">
          {res.label || res.entidad} · completado en {res.duracion_ms} ms
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
            <th className="py-1">Tabla / concepto</th>
            <th className="py-1 text-right">Antes</th>
            <th className="py-1 text-right">Eliminados</th>
            <th className="py-1 text-right">Después</th>
          </tr>
        </thead>
        <tbody>
          {claves.map((k) => (
            <tr key={k} className="border-t border-slate-100">
              <td className="py-1.5 text-slate-700">{k}</td>
              <td className="py-1.5 text-right">{nf.format(res.antes?.[k] ?? 0)}</td>
              <td className="py-1.5 text-right font-semibold text-red-700">{nf.format(res.eliminados[k])}</td>
              <td className="py-1.5 text-right">{nf.format(res.despues?.[k] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(res.avisos || []).map((a, i) => (
        <p key={i} className="text-xs text-slate-500 mt-2">• {a}</p>
      ))}
    </div>
  );
}

/* ============================== Página ==================================== */

export default function DevTools() {
  const { can } = useAuth();
  const puedeInfo = can("dev.info");
  const puedeMant = can("dev.mantenimiento");
  const puedeErrores = can("dev.errores");
  const puedeDev = can("developer_tools");

  const [cargando, setCargando] = useState(true);
  const [status, setStatus] = useState(null);
  const [diagFull, setDiagFull] = useState(null);
  const [diag, setDiag] = useState(null);       // diagnóstico clásico (integridad)
  const [info, setInfo] = useState(null);       // colecciones clásicas
  const [checklist, setChecklist] = useState(null);
  const [errores, setErrores] = useState([]);
  const [catFiltro, setCatFiltro] = useState("");
  const [logs, setLogs] = useState(null);
  const [estadoFiltro, setEstadoFiltro] = useState(0);
  const [contadores, setContadores] = useState(null);
  const [migraciones, setMigraciones] = useState(null);
  const [plan, setPlan] = useState(null);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState("");

  // limpieza
  const [op, setOp] = useState(null);           // operación en diálogo
  const [forzar, setForzar] = useState(false);
  const [bloqueos, setBloqueos] = useState(null);
  const [busyClean, setBusyClean] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [busyBackup, setBusyBackup] = useState(false);
  const [backupRes, setBackupRes] = useState(null);

  // datos demo (funcionalidad previa conservada)
  const [busySeed, setBusySeed] = useState(false);
  const [seedRes, setSeedRes] = useState(null);
  const [busyPurge, setBusyPurge] = useState(false);
  const [purgeRes, setPurgeRes] = useState(null);

  const cargarChecklist = useCallback(async () => {
    try { setChecklist((await api.get("/dev/preproduccion")).data); } catch { /* silencioso */ }
  }, []);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      setStatus((await api.get("/dev/status")).data);
    } catch (e) {
      if (e?.response?.status !== 404) toast.error("No se pudo consultar el estado del sistema");
    }
    if (puedeInfo) {
      try { setDiagFull((await api.get("/dev/diagnostico-full")).data); } catch { /* */ }
      try { setDiag((await api.get("/dev/diagnostico")).data); } catch { /* */ }
      try { setInfo((await api.get("/dev/info")).data); } catch { /* */ }
      try { setContadores((await api.get("/dev/db/contadores")).data); } catch { /* */ }
      try { setMigraciones((await api.get("/dev/migraciones")).data); } catch { /* */ }
    }
    if (puedeErrores) {
      try { setErrores((await api.get("/dev/errores")).data.errores); } catch { /* */ }
      try { setLogs((await api.get("/dev/logs?limite=200")).data); } catch { /* */ }
    }
    if (puedeDev) {
      try { setPlan((await api.get("/dev/clean/plan")).data); } catch { /* */ }
    }
    if (puedeMant) await cargarChecklist();
    setCargando(false);
  }, [puedeInfo, puedeErrores, puedeDev, puedeMant, cargarChecklist]);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  const cargarAudit = useCallback(async () => {
    try {
      const { data } = await api.get("/audit");
      setAudit((data || []).filter((a) => (a.accion || "").startsWith("DEV")));
    } catch { toast.error("No se pudo cargar la auditoría"); }
  }, []);

  useEffect(() => { if (tab === "auditoria") cargarAudit(); }, [tab, cargarAudit]);

  /* ------------------------------ acciones ------------------------------- */
  const ejecutarLimpieza = async (txt) => {
    if (!op) return;
    setBusyClean(true);
    try {
      const { data } = await api.post(`/dev/clean/${op.key}`,
        { confirmar: (txt || "").trim(), forzar });
      setResultado(data);
      setBloqueos(null);
      toast.success(`${op.label}: limpieza completada`);
      try { setPlan((await api.get("/dev/clean/plan")).data); } catch { /* */ }
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (e?.response?.status === 409 && d && typeof d === "object") {
        setBloqueos(d);
        toast.warning("Operación bloqueada por dependencias");
      } else {
        toast.error(typeof d === "string" ? d : "No se pudo completar la limpieza");
      }
    } finally { setBusyClean(false); }
  };

  const ejecutarResetTotal = async (txt) => {
    setBusyClean(true);
    try {
      const { data } = await api.post("/dev/reset-pruebas", { confirmar: (txt || "").trim() });
      setResultado(data);
      toast.success("Reinicio total completado");
      try { setPlan((await api.get("/dev/clean/plan")).data); } catch { /* */ }
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "No se pudo completar el reinicio");
    } finally { setBusyClean(false); }
  };

  const crearBackup = async () => {
    setBusyBackup(true);
    try {
      const { data } = await api.post("/dev/backup");
      setBackupRes(data);
      if (data.ok) toast.success(`Backup creado: ${data.archivo}`);
      else toast.error(data.motivo || "No se pudo crear el backup");
    } catch { toast.error("No se pudo crear el backup"); }
    finally { setBusyBackup(false); }
  };

  const limpiarLogs = async () => {
    try { await api.delete("/dev/logs"); setLogs(null); toast.success("Bitácora limpiada"); }
    catch { toast.error("No se pudo limpiar la bitácora"); }
  };

  const generarDemo = async () => {
    setBusySeed(true);
    try {
      const { data } = await api.post("/dev/seed-campo?regenerar_track=true", {});
      setSeedRes(data);
      toast.success("Dataset de prueba generado");
    } catch { toast.error("No se pudieron generar los datos de prueba"); }
    finally { setBusySeed(false); }
  };

  const purgarDemos = async () => {
    setBusyPurge(true);
    try {
      const { data } = await api.delete("/dev/datos-prueba");
      setPurgeRes(data); setSeedRes(null);
      toast.success("Datos de prueba eliminados"); cargarTodo();
    } catch { toast.error("No se pudieron eliminar los datos de prueba"); }
    finally { setBusyPurge(false); }
  };

  const limpiarErroresMemoria = async () => {
    try { await api.delete("/dev/errores"); setErrores([]); toast.success("Bitácora limpiada"); }
    catch { toast.error("No se pudo limpiar la bitácora"); }
  };

  /* ------------------------------- acceso -------------------------------- */
  if (!puedeInfo && !puedeMant && !puedeErrores && !puedeDev) {
    return (
      <div className="card-soft p-10 text-center" data-testid="devtools-page">
        <Wrench className="w-8 h-8 mx-auto text-slate-300 mb-3" />
        <h1 className="font-display font-bold text-lg">Módulo Desarrollador</h1>
        <p className="text-sm text-slate-500 mt-1">
          No tienes permisos de desarrollador para acceder a estas herramientas.
        </p>
      </div>
    );
  }

  const tabsVisibles = [
    puedeInfo && { id: "diagnostico", label: "Diagnóstico" },
    puedeErrores && { id: "depuracion", label: "Depuración" },
    puedeInfo && { id: "basedatos", label: "Base de datos" },
    puedeDev && { id: "limpieza", label: "Limpieza de datos" },
    puedeMant && { id: "pruebas", label: "Datos de prueba" },
    puedeMant && { id: "preproduccion", label: "Pre-producción" },
    puedeInfo && { id: "auditoria", label: "Auditoría" },
  ].filter(Boolean);

  const enProduccion = status?.entorno === "production";
  const logsItems = (logs?.items || []).filter(
    (l) => !estadoFiltro || l.estado === estadoFiltro);
  const erroresFiltrados = errores.filter(
    (e) => !catFiltro || (e.categoria || "app") === catFiltro);
  const soportaForzar = ["clientes", "productos", "proveedores"].includes(op?.key);

  return (
    <div className="space-y-6" data-testid="devtools-page">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2">
            <Wrench className="w-6 h-6" style={{ color: TERRACOTA }} /> Desarrollador
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Herramientas exclusivas de desarrollo, pruebas y depuración. No forma parte de la operación normal del ERP.
          </p>
        </div>
        <Button variant="outline" onClick={cargarTodo} data-testid="dev-reload">
          <RefreshCw className={`w-4 h-4 mr-1 ${cargando ? "animate-spin" : ""}`} /> Refrescar
        </Button>
      </div>

      {/* Banner de entorno (§63) */}
      {enProduccion ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-red-800">
          <AlertOctagon className="w-4 h-4" /> 🔴 ENTORNO DE PRODUCCIÓN · herramientas destructivas deshabilitadas
        </div>
      ) : status && !status.destructivo_habilitado ? (
        <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 flex items-center gap-2 text-sm text-slate-700">
          <ShieldCheck className="w-4 h-4" /> DEVELOPER_MODE desactivado · solo diagnóstico disponible
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-amber-900">
          <AlertTriangle className="w-4 h-4" /> ⚠️ ENTORNO DE DESARROLLO · herramientas destructivas ACTIVAS · rol requerido: admin_desarrollador
        </div>
      )}

      {!status && cargando && <Loader2 className="w-5 h-5 animate-spin text-slate-300" />}

      <Tabs value={tab || tabsVisibles[0]?.id} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          {tabsVisibles.map((t) => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`dev-tab-${t.id}`}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {/* ============================ DIAGNÓSTICO ============================ */}
        {puedeInfo && (
          <TabsContent value="diagnostico" className="space-y-6 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card-soft p-5">
                <div className="text-xs uppercase tracking-wider text-slate-400">Entorno</div>
                <Badge variant="outline" className="uppercase mt-1">{status?.entorno || "?"}</Badge>
              </div>
              <div className="card-soft p-5">
                <div className="text-xs uppercase tracking-wider text-slate-400">Versión API</div>
                <div className="font-display font-bold text-xl mt-1">{status?.app_version || "—"} <span className="text-xs text-slate-400 font-normal">({status?.api_version})</span></div>
              </div>
              <div className="card-soft p-5">
                <div className="text-xs uppercase tracking-wider text-slate-400">Python</div>
                <div className="font-display font-bold text-xl mt-1">{status?.python || "?"}</div>
              </div>
              <div className="card-soft p-5">
                <div className="text-xs uppercase tracking-wider text-slate-400">Uptime</div>
                <div className="font-display font-bold text-xl mt-1">{status?.uptime_s != null ? `${Math.floor(status.uptime_s / 60)} min` : "—"}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {(diagFull?.componentes || []).map((c) => (
                <TarjetaEstado key={c.id} icono={c.id === "backend" ? Server : c.id === "postgresql" ? Database : c.id === "migraciones" ? Layers : c.id === "storage" ? HardDrive : Activity}
                  titulo={c.nombre} ok={c.ok}
                  detalle={c.detalle} />
              ))}
            </div>
            {diagFull && !diagFull.todo_ok && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
                <XCircle className="w-4 h-4" /> Hay componentes con problemas; revisa el detalle arriba.
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card-soft p-6">
                <h3 className="font-display font-semibold text-lg text-slate-900 mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" style={{ color: TERRACOTA }} /> Integridad referencial
                </h3>
                {diag?.integridad?.error ? (
                  <p className="text-sm text-red-600">{diag.integridad.error}</p>
                ) : diag?.integridad ? (
                  <>
                    <div className="space-y-1.5">
                      {[["ventas_sin_cliente", "Ventas sin cliente válido"],
                        ["visitas_sin_cliente", "Visitas sin cliente válido"],
                        ["visitas_sin_vendedor", "Visitas sin vendedor válido"],
                        ["clientes_sin_vendedor", "Clientes con vendedor inexistente"]].map(([k, label]) => (
                        <div key={k} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                          <span className="text-slate-500">{label}</span>
                          <span className={`font-semibold ${diag.integridad[k] > 0 ? "text-red-600" : "text-emerald-600"}`}>{diag.integridad[k]}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-3">
                      Muestra analizada: {diag.integridad.muestra?.ventas ?? 0} ventas · {diag.integridad.muestra?.visitas ?? 0} visitas
                    </p>
                  </>
                ) : <Loader2 className="w-5 h-5 animate-spin text-slate-300" />}
              </div>

              <div className="card-soft p-6">
                <h3 className="font-display font-semibold text-lg text-slate-900 mb-4 flex items-center gap-2">
                  <Database className="w-5 h-5" style={{ color: TERRACOTA }} /> Colecciones clave
                </h3>
                <div className="grid grid-cols-2 gap-x-4">
                  {info?.colecciones && Object.entries(info.colecciones).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                      <span className="text-slate-500 truncate">{k}</span>
                      <span className="font-semibold text-slate-800">{nf.format(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        )}

        {/* ============================= DEPURACIÓN ============================= */}
        {puedeErrores && (
          <TabsContent value="depuracion" className="space-y-6 mt-4">
            <div className="card-soft p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="font-display font-semibold text-lg text-slate-900 flex items-center gap-2">
                  <Bug className="w-5 h-5" style={{ color: TERRACOTA }} /> Requests fallidos (HTTP ≥ 400)
                </h3>
                <div className="flex items-center gap-2">
                  {[0, ...(Object.keys(logs?.resumen_por_estado || {}).map(Number))].sort((a, b) => a - b).map((est) => (
                    <button key={est} onClick={() => setEstadoFiltro(est)}
                      className={`px-2 py-0.5 rounded-full text-xs border transition ${
                        estadoFiltro === est ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                      {est === 0 ? "Todos" : est} ({logs?.resumen_por_estado?.[est] ?? 0})
                    </button>
                  ))}
                  <Button variant="outline" size="sm" onClick={limpiarLogs}>
                    <Trash2 className="w-4 h-4 mr-1" /> Limpiar
                  </Button>
                </div>
              </div>
              {logsItems.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">Sin requests fallidos registrados.</p>
              ) : (
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                  {logsItems.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 py-2 text-sm">
                      <Badge variant={l.estado >= 500 ? "destructive" : "outline"} className="w-14 justify-center">{l.estado}</Badge>
                      <span className="text-slate-400 text-xs w-40 shrink-0">{(l.fecha || "").slice(0, 19).replace("T", " ")}</span>
                      <span className="font-mono text-xs text-slate-700 truncate">{l.metodo} {l.ruta}</span>
                      <span className="ml-auto text-xs text-slate-400">{l.duracion_ms} ms{l.usuario ? ` · ${l.usuario}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-soft p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="font-display font-semibold text-lg text-slate-900 flex items-center gap-2">
                  <Bug className="w-5 h-5" style={{ color: TERRACOTA }} /> Errores no controlados (500)
                </h3>
                <div className="flex items-center gap-2">
                  {["", "app", "postgresql"].map((c) => (
                    <button key={c || "todas"} onClick={() => setCatFiltro(c)}
                      className={`px-2 py-0.5 rounded-full text-xs border transition ${
                        catFiltro === c ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                      {c === "" ? "Todas" : c === "app" ? "Aplicación" : "PostgreSQL"}
                    </button>
                  ))}
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={limpiarErroresMemoria}>
                    <Trash2 className="w-4 h-4 mr-1" /> Limpiar
                  </Button>
                </div>
              </div>
              {erroresFiltrados.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">Sin errores registrados.</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {erroresFiltrados.map((e) => (
                    <details key={e.id} className="border border-slate-200 rounded-lg px-3 py-2">
                      <summary className="cursor-pointer text-sm">
                        <span className="inline-flex items-center gap-2">
                          <Badge variant="destructive">{e.tipo}</Badge>
                          {(e.categoria === "postgresql") && <Badge variant="outline" className="text-blue-700 border-blue-300">PostgreSQL</Badge>}
                          <span className="text-slate-400 text-xs">{(e.fecha || "").replace("T", " ").slice(0, 19)}</span>
                          <span className="text-slate-700 truncate">{e.ruta}{e.usuario ? ` · ${e.usuario}` : ""}</span>
                        </span>
                      </summary>
                      <div className="mt-2 text-xs text-slate-600">{e.mensaje}</div>
                      <pre className="mt-2 bg-slate-900 text-green-300 rounded-lg p-3 text-[11px] overflow-x-auto">{e.detalle}</pre>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        )}

        {/* ============================ BASE DE DATOS =========================== */}
        {puedeInfo && (
          <TabsContent value="basedatos" className="space-y-6 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card-soft p-6">
                <h3 className="font-display font-semibold text-lg text-slate-900 mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5" style={{ color: TERRACOTA }} /> Migraciones (Alembic)
                </h3>
                {!migraciones ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between border-b border-slate-100 py-1.5"><span className="text-slate-500">Actual</span><span className="font-mono font-semibold">{migraciones.actual || "—"}</span></div>
                    <div className="flex justify-between border-b border-slate-100 py-1.5"><span className="text-slate-500">Head</span><span className="font-mono font-semibold">{migraciones.head || "—"}</span></div>
                    <div className="flex justify-between border-b border-slate-100 py-1.5"><span className="text-slate-500">Pendientes</span>
                      <Badge variant={migraciones.pendientes > 0 ? "destructive" : "outline"} className={migraciones.pendientes === 0 ? "text-emerald-700" : ""}>
                        {migraciones.pendientes}
                      </Badge>
                    </div>
                    <div className="flex justify-between py-1.5"><span className="text-slate-500">Revisiones totales</span><span className="font-semibold">{migraciones.total_revisiones}</span></div>
                    <p className="text-[11px] text-slate-400 pt-1">Las migraciones estructurales se aplican únicamente con Alembic desde el backend; esta vista es informativa.</p>
                  </div>
                )}
              </div>

              <div className="card-soft p-6 flex flex-col">
                <h3 className="font-display font-semibold text-lg text-slate-900 mb-2 flex items-center gap-2">
                  <FileDown className="w-5 h-5" style={{ color: TERRACOTA }} /> Backup previo a limpiezas
                </h3>
                <p className="text-sm text-slate-500 flex-1">
                  Se recomienda realizar un backup antes de ejecutar limpiezas importantes.
                  Intenta generar un volcado con <code className="text-xs bg-slate-100 rounded px-1">pg_dump</code>;
                  si no está disponible en el servidor se indicará cómo hacerlo manualmente.
                </p>
                <Button className="mt-4 self-start" onClick={crearBackup} disabled={busyBackup}>
                  {busyBackup ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
                  Crear backup
                </Button>
                {backupRes && backupRes.ok && (
                  <p className="text-xs text-emerald-700 mt-2">{backupRes.archivo} · {nf.format(backupRes.bytes)} bytes</p>
                )}
                {backupRes && !backupRes.ok && (
                  <p className="text-xs text-amber-700 mt-2">{backupRes.motivo}</p>
                )}
              </div>
            </div>

            <div className="card-soft p-6">
              <h3 className="font-display font-semibold text-lg text-slate-900 mb-4 flex items-center gap-2">
                <Database className="w-5 h-5" style={{ color: TERRACOTA }} /> Conteo de registros por tabla
              </h3>
              {!contadores ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-x-4">
                  {contadores.tablas.map((t) => (
                    <div key={t.tabla} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                      <span className="text-slate-500 truncate">{t.tabla}</span>
                      <span className={`font-semibold ${(t.registros ?? 0) > 0 ? "text-slate-800" : "text-slate-300"}`}>
                        {nf.format(t.registros)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        )}

        {/* ========================= LIMPIEZA DE DATOS ========================== */}
        {puedeDev && (
          <TabsContent value="limpieza" className="space-y-6 mt-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                Se recomienda crear un <b>backup</b> (pestaña Base de datos) antes de limpiar.
                Toda limpieza corre en una transacción: si algo falla, se revierte completa.
              </div>
            </div>

            {!plan ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {plan.plan.map((it) => {
                    const critica = it.peligro === "critica";
                    return (
                      <div key={it.key}
                        className={`card-soft p-5 flex flex-col ${critica ? "border border-red-200" : ""}`}
                        data-testid={`dev-clean-${it.key}`}>
                        <div className="flex items-center justify-between gap-2">
                          <h4 className={`font-semibold text-sm ${critica ? "text-red-800" : "text-slate-800"}`}>{it.label}</h4>
                          <Badge variant="outline" className={
                            it.peligro === "critica" ? "border-red-300 text-red-700"
                              : it.peligro === "alta" ? "border-amber-300 text-amber-700" : ""}>
                            {it.peligro}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 flex-1">{it.descripcion}</p>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-xs text-slate-400">{it.tabla_principal}: <b className="text-slate-700">{nf.format(it.registros)}</b></span>
                          <Button size="sm" variant={critica ? "destructive" : "outline"}
                            onClick={() => { setOp(it); setBloqueos(null); setForzar(false); setResultado(null); }}>
                            <Eraser className="w-3.5 h-3.5 mr-1" /> Limpiar
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {resultado && <ResultadoLimpieza res={resultado} />}

                {/* ☢️ Zona crítica */}
                <div className="rounded-xl border-2 border-dashed border-red-300 bg-red-50/60 p-6">
                  <h3 className="font-display font-bold text-lg text-red-800 flex items-center gap-2">
                    <AlertOctagon className="w-5 h-5" /> ☢️ REINICIAR DATOS DE PRUEBA (toda la base)
                  </h3>
                  <p className="text-sm text-red-900/80 mt-1 max-w-3xl">
                    Elimina <b>todos los datos operativos</b> (clientes, productos, ventas, cotizaciones,
                    pedidos, compras, gastos, caja, CxC/CxP, inventario, visitas, proveedores,
                    cuentas bancarias) y reinicia los folios. <b>NUNCA</b> borra estructura,
                    migraciones, usuarios, roles, configuración ni auditoría.
                    Requiere escribir <code className="bg-white border border-red-200 rounded px-1 text-xs">ELIMINAR TODO</code>.
                  </p>
                  <Button variant="destructive" className="mt-4"
                    onClick={() => { setOp({ key: "reset_total", label: "Reinicio total", confirmar: "ELIMINAR TODO", peligro: "critica" }); setResultado(null); }}
                    data-testid="dev-reset-total-btn">
                    <Trash2 className="w-4 h-4 mr-1" /> Reiniciar datos de prueba
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        )}

        {/* =========================== DATOS DE PRUEBA ========================== */}
        {puedeMant && (
          <TabsContent value="pruebas" className="space-y-6 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card-soft p-6 flex flex-col">
                <h3 className="font-display font-semibold text-lg text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5" style={{ color: TERRACOTA }} /> Generar dataset de fuerza de ventas
                </h3>
                <p className="text-sm text-slate-500 mt-2 flex-1">
                  Crea cuentas de vendedores demo, clientes con GPS en Palenque, Chiapas,
                  el track de ubicaciones de hoy y visitas de ejemplo. Es aditivo e idempotente.
                </p>
                <Button className="mt-4 self-start" onClick={generarDemo} disabled={busySeed} data-testid="dev-seed-btn">
                  {busySeed ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                  Generar datos de prueba
                </Button>
                {seedRes && (
                  <div className="mt-4 space-y-2" data-testid="dev-seed-resumen">
                    <ul className="text-xs text-slate-600 space-y-1">
                      {seedRes.vendedores?.map((v) => <li key={v}>• {v}</li>)}
                      <li>• Clientes creados: <b>{seedRes.clientes_creados}</b></li>
                      <li>• Ubicaciones GPS de hoy: <b>{seedRes.ubicaciones_hoy}</b></li>
                      <li>• Visitas creadas: <b>{seedRes.visitas_creadas}</b></li>
                    </ul>
                    {seedRes.login_demo?.length > 0 && (
                      <pre className="bg-slate-900 text-green-300 rounded-lg p-3 text-[11px] overflow-x-auto">
                        {seedRes.login_demo.map((l) => `${l.email} / ${l.password}`).join("\n")}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              <div className="card-soft p-6 flex flex-col border border-red-100">
                <h3 className="font-display font-semibold text-lg text-slate-900 flex items-center gap-2">
                  <Trash2 className="w-5 h-5 text-red-600" /> Purgar cuentas/clientes DEMO
                </h3>
                <p className="text-sm text-slate-500 mt-2 flex-1">
                  Elimina la información generada para pruebas: cuentas demo (@rysa.dev) con sus
                  sesiones y tracks GPS, clientes DEMO-* y sus visitas. Los datos reales no se tocan.
                </p>
                <Button variant="destructive" className="mt-4 self-start" onClick={purgarDemos}
                        disabled={busyPurge} data-testid="dev-purge-btn">
                  {busyPurge ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                  Purgar datos de prueba
                </Button>
                {purgeRes?.ok && (
                  <div className="mt-4 text-xs text-slate-600 space-y-1" data-testid="dev-purge-resumen">
                    <div>Usuarios eliminados: <b>{purgeRes.usuarios_eliminados}</b></div>
                    <div>Clientes eliminados: <b>{purgeRes.clientes_eliminados}</b></div>
                    <div>Visitas eliminadas: <b>{purgeRes.visitas_eliminadas}</b></div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        )}

        {/* =========================== PRE-PRODUCCIÓN =========================== */}
        {puedeMant && (
          <TabsContent value="preproduccion" className="space-y-6 mt-4">
            <div className="card-soft p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold text-lg text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" style={{ color: TERRACOTA }} /> Checklist antes de producción
                </h3>
                <Button variant="outline" size="sm" onClick={cargarChecklist} data-testid="dev-checklist-refresh">
                  <RefreshCw className="w-4 h-4 mr-1" /> Re-evaluar
                </Button>
              </div>
              {!checklist ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : (
                <>
                  <div className={`rounded-lg px-4 py-3 mb-4 flex items-center gap-2 text-sm font-semibold ${
                    checklist.listo ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      : "bg-amber-50 text-amber-800 border border-amber-200"}`}
                    data-testid="dev-checklist-banner">
                    {checklist.listo
                      ? <><CheckCircle2 className="w-4 h-4" /> Todo en orden: entorno listo para pasar a producción.</>
                      : <><AlertTriangle className="w-4 h-4" /> Hay pendientes antes de cambiar a ENVIRONMENT=production.</>}
                  </div>
                  <div className="space-y-2" data-testid="dev-checklist">
                    {checklist.checks.map((c) => {
                      const colorFalla = c.severidad === "alta" ? "text-red-600"
                        : c.severidad === "media" ? "text-amber-500" : "text-slate-400";
                      return (
                        <div key={c.id} className="flex items-start gap-3 border-b border-slate-100 py-2">
                          {c.ok
                            ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                            : <XCircle className={`w-5 h-5 shrink-0 mt-0.5 ${colorFalla}`} />}
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-800 flex items-center gap-2 flex-wrap">
                              {c.titulo}
                              <Badge variant="outline" className="text-[10px] uppercase">{c.severidad}</Badge>
                            </div>
                            <div className="text-xs text-slate-500 truncate">{c.detalle}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        )}

        {/* ============================== AUDITORÍA ============================= */}
        {puedeInfo && (
          <TabsContent value="auditoria" className="space-y-4 mt-4">
            <div className="card-soft p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-display font-semibold text-lg text-slate-900 flex items-center gap-2">
                  <ScrollText className="w-5 h-5" style={{ color: TERRACOTA }} /> Acciones del desarrollador
                </h3>
                <Button variant="outline" size="sm" onClick={cargarAudit}><RefreshCw className="w-4 h-4 mr-1" /> Actualizar</Button>
              </div>
              <p className="text-xs text-slate-400 mb-4">Registro completo de operaciones DEV_* (limpiezas, resets y mantenimiento).</p>
              {audit.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">Sin acciones registradas.</p>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto divide-y divide-slate-100">
                  {audit.map((a) => (
                    <div key={a.id} className="py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-slate-900">{a.accion}</Badge>
                        <span className="text-xs text-slate-400 w-40">{(a.fecha || "").replace("T", " ").slice(0, 19)}</span>
                        <span className="text-xs text-slate-600">{a.usuario_nombre || a.usuario_id || "—"}</span>
                      </div>
                      <pre className="text-[11px] text-slate-500 whitespace-pre-wrap mt-1 max-h-24 overflow-y-auto">{a.detalle}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Diálogos de confirmación */}
      <DialogoPeligro
        abierto={!!op && op.key !== "reset_total"}
        onOpenChange={(v) => !v && setOp(null)}
        titulo={`Limpiar ${op?.label || ""}`}
        descripcion={op?.descripcion}
        palabra={op?.confirmar || "LIMPIAR"}
        cargando={busyClean}
        onConfirmar={ejecutarLimpieza}
        permiteForzar={soportaForzar}
        forzar={forzar} setForzar={setForzar}
        bloqueos={bloqueos}
      />
      <DialogoPeligro
        abierto={!!op && op.key === "reset_total"}
        onOpenChange={(v) => !v && setOp(null)}
        titulo="☢️ REINICIAR TODA LA BASE DE DATOS DE PRUEBAS"
        descripcion="Se eliminarán TODOS los datos operativos del sistema. Los usuarios, la configuración y la estructura se conservan."
        palabra="ELIMINAR TODO"
        cargando={busyClean}
        onConfirmar={ejecutarResetTotal}
      />
    </div>
  );
}

