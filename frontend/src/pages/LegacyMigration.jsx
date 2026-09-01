import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
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
  AlertTriangle, CheckCircle2, Clock, Database, FileDown, History,
  Loader2, Lock, RefreshCw, RotateCcw, ShieldAlert, Sparkles, Upload,
} from "lucide-react";

const TERRACOTA = "#C1401E";
const nf = new Intl.NumberFormat("es-MX");
const money = (v) => "$" + new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2 }).format(v || 0);

/* ------------------------------ subcomponentes ----------------------------- */

function Etapa({ nombre, ok, nota }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          : nota === "pendiente" ? <Clock className="w-4 h-4 text-slate-400" />
          : <Lock className="w-4 h-4 text-amber-500" />}
      <span className={ok ? "text-slate-800 font-medium" : "text-slate-400"}>{nombre}</span>
      {ok && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">OK</Badge>}
      {!ok && nota === "pendiente" && <Badge variant="outline" className="text-[10px]">PENDIENTE</Badge>}
      {!ok && nota === "bloqueado" && <Badge className="bg-amber-100 text-amber-700 text-[10px]">BLOQUEADO</Badge>}
    </div>
  );
}

function Metrica({ valor, etiqueta, color }) {
  return (
    <div className="card-soft p-4 text-center">
      <div className="font-display text-2xl font-black" style={{ color: color || TERRACOTA }}>{valor}</div>
      <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">{etiqueta}</div>
    </div>
  );
}

function Barra({ etiqueta, pct }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-600 font-medium">{etiqueta}</span>
        <span className="text-slate-400">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: TERRACOTA }} />
      </div>
    </div>
  );
}

/* -------------------------------- pantalla -------------------------------- */

export default function LegacyMigration() {
  const [status, setStatus] = useState(null);
  const [validacion, setValidacion] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [busy, setBusy] = useState("");
  const [modal1, setModal1] = useState(false);
  const [modal2, setModal2] = useState(false);
  const [modalInc, setModalInc] = useState(false);
  const [textoConfirm, setTextoConfirm] = useState("");
  const [backupOk, setBackupOk] = useState(false);
  const [modalRollback, setModalRollback] = useState(false);
  const [txtRollback, setTxtRollback] = useState("");
  const [review, setReview] = useState(null);
  const [filtroReview, setFiltroReview] = useState("");
  const [recon, setRecon] = useState(null);
  const [filtroRecon, setFiltroRecon] = useState("");
  const [snapshots, setSnapshots] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataResult, setDataResult] = useState(null);
  const zipRef = useRef(null);
  const pollRef = useRef(null);

  const cargarDatos = useCallback(async () => {
    try {
      const { data } = await api.get("/legacy/data/status");
      setDataStatus(data);
    } catch { setDataStatus(null); }
  }, []);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const desplegarZip = useCallback(async () => {
    const f = zipRef.current?.files?.[0];
    if (!f) { toast.error("Selecciona el ZIP con los datos legacy (DBF/CDX/FPT)"); return; }
    setDataBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/legacy/data/deploy", fd);
      setDataResult(data);
      setDataStatus((s) => ({ ...s, ...data }));
      if (zipRef.current) zipRef.current.value = "";
      toast.success(`Desplegados ${nf.format(data.extraidos)} archivos en legacy_data`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudo desplegar el ZIP");
    } finally {
      setDataBusy(false);
    }
  }, []);

  const cargarSnapshots = useCallback(async () => {
    try {
      const { data } = await api.get("/legacy/snapshots");
      setSnapshots(data);
    } catch { setSnapshots(null); }
  }, []);

  useEffect(() => { cargarSnapshots(); }, [cargarSnapshots]);

  const cargar = useCallback(async () => {
    try {
      const { data } = await api.get("/legacy/status");
      setStatus(data);
      if (data.batch?.status === "RUNNING") {
        clearTimeout(pollRef.current);
        pollRef.current = setTimeout(cargar, 3000);
      }
    } catch { setStatus(null); }
  }, []);

  useEffect(() => { cargar(); return () => clearTimeout(pollRef.current); }, [cargar]);

  const cargarRecon = useCallback(async (estado = "") => {
    try {
      const { data } = await api.get("/legacy/reconciliation", { params: estado ? { estado } : {} });
      setRecon(data);
    } catch { setRecon(null); }
  }, []);

  useEffect(() => { cargarRecon(filtroRecon); }, [filtroRecon, cargarRecon]);

  const cargarReview = useCallback(async (motivo = "") => {
    try {
      const { data } = await api.get("/legacy/review", { params: motivo ? { motivo } : {} });
      setReview(data);
    } catch { toast.error("No se pudo cargar la cola de revisión"); }
  }, []);

  useEffect(() => { cargarReview(filtroReview); }, [filtroReview, cargarReview]);

  const validar = async () => {
    setBusy("validate");
    try {
      const { data } = await api.post("/legacy/validate");
      setValidacion(data);
      if (data.ok) toast.success("Validaciones pre-import: TODO OK");
      else toast.error(`IMPORTACIÓN BLOQUEADA: ${data.bloqueos.length} bloqueo(s)`);
    } catch { toast.error("No se pudo validar"); }
    finally { setBusy(""); }
  };

  const iniciarImport = async () => {
    setBusy("import");
    try {
      const { data } = await api.post("/legacy/import", {
        confirmacion: "IMPORTAR LEGACY", backup_confirmado: backupOk,
      });
      toast.success(`Importación iniciada (${data.batch_id})`);
      setModal1(false); setModal2(false);
      setTextoConfirm(""); setBackupOk(false);
      cargar();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "object" ? d?.mensaje || "Importación bloqueada" : d || "No se pudo iniciar");
    } finally { setBusy(""); }
  };

  const iniciarIncremental = async () => {
    setBusy("incremental");
    try {
      const { data } = await api.post("/legacy/import-incremental", {
        confirmacion: "IMPORTAR DELTA", backup_confirmado: backupOk,
      });
      if (data.sin_cambios) {
        toast.info("Sin cambios: staging y producción ya están sincronizados");
        setModal1(false);
        return;
      }
      toast.success(`Importación incremental iniciada (${data.batch_id})`);
      setModal1(false); setModal2(false);
      setTextoConfirm(""); setBackupOk(false);
      cargar();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "object" ? d?.mensaje || "Importación bloqueada" : d || "No se pudo iniciar");
    } finally { setBusy(""); }
  };

  const rollback = async () => {
    setBusy("rollback");
    try {
      const { data } = await api.post("/legacy/rollback", { confirmacion: "REVERTIR LEGACY" });
      toast.success(`Rollback completo: ${nf.format(data.ventas_eliminadas)} ventas eliminadas, ${data.clientes_revertidos} clientes revertidos`);
      setModalRollback(false); setTxtRollback("");
      cargar();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "No se pudo revertir");
    } finally { setBusy(""); }
  };

  if (!status) {
    return (
      <div className="card-soft p-10 text-center" data-testid="legacy-migracion">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-300" />
        <p className="text-sm text-slate-400 mt-2">Cargando estado de migración…</p>
      </div>
    );
  }

  const s = status.staging;
  const b = status.batch;
  const corriendo = b?.status === "RUNNING";
  const completado = b?.status === "COMPLETED";
  const etapas = status.etapas;

  return (
    <div className="space-y-6" data-testid="legacy-migracion">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-black tracking-tight flex items-center gap-2">
            <History className="w-5 h-5" style={{ color: TERRACOTA }} /> Migración Legacy
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            Importación controlada del histórico (DBF/BDF → staging → RYSA). Transaccional, idempotente y auditable.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={cargar} data-testid="legacy-reload">
            <RefreshCw className={`w-4 h-4 mr-1 ${corriendo ? "animate-spin" : ""}`} /> Refrescar
          </Button>
          <Button variant="outline" onClick={validar} disabled={busy === "validate"} data-testid="legacy-validate">
            {busy === "validate" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldAlert className="w-4 h-4 mr-1" />}
            Validar
          </Button>
        </div>
      </div>

      {!status.enabled && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-amber-900">
          <Lock className="w-4 h-4" /> LEGACY_MIGRATION_ENABLED=false · la importación está deshabilitada en este entorno
        </div>
      )}

      {/* Estado de etapas */}
      <div className="card-soft p-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Etapa nombre="Discovery" ok={etapas.discovery} nota={etapas.discovery ? "ok" : "bloqueado"} />
          <Etapa nombre="Analyze" ok={etapas.analyze} nota={etapas.analyze ? "ok" : "bloqueado"} />
          <Etapa nombre="Staging" ok={etapas.staging} nota={etapas.staging ? "ok" : "bloqueado"} />
          <Etapa nombre="Dry-Run" ok={etapas.dry_run} nota={etapas.dry_run ? "ok" : "bloqueado"} />
          <Etapa nombre="Import" ok={etapas.import} nota={etapas.import ? "ok" : "pendiente"} />
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Metrica valor={nf.format(s.tickets)} etiqueta="Tickets" />
        <Metrica valor={nf.format(s.detalles)} etiqueta="Detalles" />
        <Metrica valor={money(s.cxc_saldo)} etiqueta="CxC inicial" />
        <Metrica valor={nf.format(s.cxc_review)} etiqueta="Revisión CxC" color="#D97706" />
        <Metrica valor={nf.format(s.productos_pendientes)} etiqueta="Productos sin mapa" color="#D97706" />
        <Metrica valor={nf.format(s.cxc_excluded)} etiqueta="Excluidos (Serie F)" color="#64748B" />
      </div>

      {/* Validación */}
      {validacion && (
        <div className={`card-soft p-4 border ${validacion.ok ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`} data-testid="legacy-validacion">
          <div className="flex items-center gap-2 font-semibold text-sm mb-1">
            {validacion.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
            Validaciones pre-import: {validacion.ok ? "PASS" : "BLOQUEADA"}
          </div>
          {!validacion.ok && (
            <ul className="list-disc ml-5 text-sm text-red-700">
              {validacion.bloqueos.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Progreso de importación */}
      {b && (corriendo || completado || b.status === "FAILED" || b.status === "ROLLED_BACK") && (
        <div className="card-soft p-5" data-testid="legacy-progreso">
          <div className="flex items-center gap-2 mb-3 font-semibold text-sm">
            {corriendo && <Loader2 className="w-4 h-4 animate-spin" style={{ color: TERRACOTA }} />}
            Batch <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{b.batch_id}</code>
            <Badge className={corriendo ? "bg-blue-100 text-blue-700"
              : completado ? "bg-emerald-100 text-emerald-700"
              : b.status === "FAILED" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-700"}>
              {b.status}
            </Badge>
            {b.phase && <span className="text-xs text-slate-400">fase: {b.phase}</span>}
          </div>
          {corriendo && (
            <div className="space-y-2 mb-3">
              <Barra etiqueta={`Tickets (${nf.format(b.tickets_imported)} / ${nf.format(s.tickets)})`}
                     pct={Math.min(100, Math.round(100 * b.tickets_imported / Math.max(1, s.tickets)))} />
              <Barra etiqueta={`Detalles (${nf.format(b.details_imported)} / ${nf.format(s.detalles)})`}
                     pct={Math.min(100, Math.round(100 * b.details_imported / Math.max(1, s.detalles)))} />
              <Barra etiqueta={`CxC (${nf.format(b.cxc_imported)} / ${nf.format(s.cxc_ready)})`}
                     pct={Math.min(100, Math.round(100 * b.cxc_imported / Math.max(1, s.cxc_ready)))} />
            </div>
          )}
          {(completado || b.status === "ROLLED_BACK") && (
            <div className="text-sm text-slate-600 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><span className="text-slate-400 text-xs block">Tickets</span><b>{nf.format(b.tickets_imported)}</b></div>
              <div><span className="text-slate-400 text-xs block">Detalles</span><b>{nf.format(b.details_imported)}</b></div>
              <div><span className="text-slate-400 text-xs block">CxC</span><b>{nf.format(b.cxc_imported)} · {money(b.cxc_saldo_total)}</b></div>
              <div><span className="text-slate-400 text-xs block">Clientes con saldo</span><b>{nf.format(b.clientes_saldo_actualizados)}</b></div>
            </div>
          )}
          {b.status === "FAILED" && b.error_detail && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 font-mono">{b.error_detail}</div>
          )}
        </div>
      )}

      {/* Acción principal */}
      <div className="card-soft p-5 flex items-center justify-between gap-4 flex-wrap">
        {completado ? (
          <>
            <div className="text-sm">
              <div className="font-semibold text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> HISTÓRICO IMPORTADO
              </div>
              <div className="text-slate-500 text-xs mt-0.5">
                Batch {b.batch_id} · {nf.format(b.tickets_imported)} tickets · {nf.format(b.cxc_imported)} CxC · {money(b.cxc_saldo_total)}
              </div>
            </div>
            <Button variant="outline" className="text-red-600 border-red-300 hover:bg-red-50"
                    onClick={() => setModalRollback(true)} data-testid="legacy-rollback">
              <RotateCcw className="w-4 h-4 mr-1" /> Revertir importación
            </Button>
          </>
        ) : (
          <>
            <div className="text-sm text-slate-600">
              <div className="font-semibold text-slate-800">Importar histórico a producción</div>
              <div className="text-xs mt-0.5">
                {nf.format(s.tickets)} tickets · {nf.format(s.detalles)} detalles · {nf.format(s.cxc_ready)} CxC ({money(s.cxc_saldo)}). No se importan: revisión, negativos ni Serie F.
              </div>
            </div>
            <Button style={{ background: TERRACOTA }} className="hover:opacity-90 text-white"
                    disabled={!status.import_habilitado || corriendo}
                    onClick={() => setModal1(true)} data-testid="legacy-importar">
              <Upload className="w-4 h-4 mr-1" /> IMPORTAR HISTÓRICO
            </Button>
          </>
        )}
      </div>
      {!status.import_habilitado && !completado && (
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <Lock className="w-3 h-3" /> Importación bloqueada: se requiere staging válido, dry-run, LEGACY_MIGRATION_ENABLED y rol admin_desarrollador.
        </p>
      )}

      {/* Importación INCREMENTAL (delta) */}
      {status.importado && (
        <div className="card-soft p-5" data-testid="legacy-incremental">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-semibold text-slate-800 flex items-center gap-1">
                <Sparkles className="w-4 h-4" style={{ color: TERRACOTA }} /> Importación incremental
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Trae a producción la diferencia entre el staging vigente y lo ya importado:
                <b className="mx-1 text-emerald-700">{nf.format(status.delta?.nuevos || 0)} tickets nuevos</b>·
                <b className="text-amber-700">{nf.format(status.delta?.actualizables || 0)} modificados</b>
                (cancelados/ajustados en legacy; los que tengan abonos aplicados se dejan en revisión).
                El saldo de clientes NO se modifica (política V2).
              </div>
            </div>
            <Button style={{ background: TERRACOTA }} className="hover:opacity-90 text-white"
                    disabled={!status.import_incremental_habilitado || corriendo}
                    onClick={() => setModalInc(true)} data-testid="legacy-incremental-btn">
              <Upload className="w-4 h-4 mr-1" /> IMPORTAR INCREMENTAL
            </Button>
          </div>
          {!status.import_incremental_habilitado && (
            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Sin delta pendiente o entorno sin migración habilitada. Re-ejecuta STAGING tras desplegar datos nuevos.
            </p>
          )}
        </div>
      )}

      {/* Revisión y reportes */}
      <Tabs defaultValue="datos">
        <TabsList>
          <TabsTrigger value="datos">Datos</TabsTrigger>
          <TabsTrigger value="revision">Revisión ({nf.format((review?.documentos || []).length)})</TabsTrigger>
          <TabsTrigger value="conciliacion">Conciliación</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          <TabsTrigger value="clientes">Clientes sin match</TabsTrigger>
          <TabsTrigger value="productos">Productos Legacy</TabsTrigger>
        </TabsList>

        {/* Despliegue de datos legacy por ZIP */}
        <TabsContent value="datos" className="mt-4 space-y-3" data-testid="legacy-datos">
          <p className="text-xs text-slate-400">
            Sube un ZIP con los archivos legacy (DBF/CDX/FPT, máx
            {dataStatus?.zip_max_mb || 300} MB) y desplégalos en la carpeta
            <code className="mx-1 px-1 rounded bg-slate-100">legacy_data</code>
            para ejecutar las fases de migración cuando se requiera. El
            despliegue anterior se conserva como backup.
          </p>
          <div className="card-soft p-4 flex flex-wrap items-center gap-3">
            <input ref={zipRef} type="file" accept=".zip" data-testid="legacy-zip-input"
                   className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-slate-200" />
            <Button style={{ background: TERRACOTA }} className="hover:opacity-90 text-white"
                    disabled={dataBusy} onClick={desplegarZip} data-testid="legacy-zip-deploy">
              {dataBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              Desplegar ZIP
            </Button>
            <Button variant="outline" onClick={cargarDatos} disabled={dataBusy}
                    data-testid="legacy-datos-refresh">
              <RefreshCw className={`w-4 h-4 mr-1 ${dataBusy ? "animate-spin" : ""}`} /> Refrescar
            </Button>
          </div>

          {dataResult?.rechazados?.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <b>Archivos rechazados ({dataResult.rechazados.length}):</b>
              <div className="mt-1 max-h-32 overflow-auto">
                {dataResult.rechazados.map((r, i) => <div key={i}>{r}</div>)}
              </div>
            </div>
          )}

          {dataStatus ? (
            <div className="card-soft p-4 space-y-2" data-testid="legacy-datos-status">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Database className="w-4 h-4" style={{ color: TERRACOTA }} />
                {dataStatus.existe ? "Carpeta legacy_data desplegada" : "Sin datos desplegados"}
                <Badge className="bg-slate-100 text-slate-600 text-[10px] ml-1">
                  {nf.format(dataStatus.archivos || 0)} archivos
                </Badge>
              </div>
              <div className="text-xs text-slate-500">{dataStatus.ruta}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                {Object.entries(dataStatus.por_extension || {}).map(([ext, n]) => (
                  <Badge key={ext} variant="outline" className="text-[11px]">
                    {ext}: {nf.format(n)}
                  </Badge>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
                {Object.entries(dataStatus.tablas_clave || {}).map(([f, v]) => (
                  <div key={f} className="rounded-md border border-slate-200 p-2 text-xs">
                    <div className="font-medium text-slate-700">{f}</div>
                    <div className="text-slate-400">{nf.format(Math.round(v.bytes / 1024))} KB · {v.modificado?.slice(0, 16)}</div>
                  </div>
                ))}
              </div>
              {dataStatus.backup_previo && (
                <div className="text-[11px] text-slate-400">
                  Backup anterior: <code className="bg-slate-100 px-1 rounded">{dataStatus.backup_previo}</code>
                </div>
              )}
            </div>
          ) : (
            <div className="card-soft p-6 text-center text-slate-400 text-sm">
              No se pudo leer el estado de legacy_data (¿carpeta montada?).
            </div>
          )}
        </TabsContent>

        <TabsContent value="revision" className="mt-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            {["", "CASH_DOCUMENT_WITH_BALANCE", "CANCELLED_WITH_BALANCE", "CXC_MISMATCH", "NEGATIVE_BALANCE", "FACTURA_SERIE_F"].map((m) => (
              <Button key={m || "todos"} size="sm" variant={filtroReview === m ? "default" : "outline"}
                      onClick={() => setFiltroReview(m)}>
                {m || "Todos"}
              </Button>
            ))}
          </div>
          <div className="border rounded-lg overflow-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="p-2">Documento</th><th className="p-2">Cliente</th>
                  <th className="p-2">Condición</th><th className="p-2 text-right">Saldo</th>
                  <th className="p-2 text-right">Calculado</th><th className="p-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {(review?.documentos || []).map((d) => (
                  <tr key={d.legacy_key} className="border-t border-slate-100">
                    <td className="p-2 font-medium text-[#C1401E]">{d.serie}-{d.folio?.replace(/^0+/, "") || d.folio}</td>
                    <td className="p-2">{d.cliente}</td>
                    <td className="p-2">{d.condicion || "—"}</td>
                    <td className="p-2 text-right">{money(d.saldo)}</td>
                    <td className="p-2 text-right text-slate-400">{money(d.calculado)}</td>
                    <td className="p-2"><Badge className="bg-amber-100 text-amber-700 text-[10px]">{d.motivo}</Badge></td>
                  </tr>
                ))}
                {(review?.documentos || []).length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-slate-400 text-sm">Sin documentos en revisión para este filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="conciliacion" className="mt-4 space-y-3">
          <p className="text-xs text-slate-400">
            Conciliación del saldo por cliente para el snapshot más reciente: maestro legacy (CLIENTES.SALDO) vs documentos abiertos (CXCDOCS) vs ledger (CUENXCOB). Nada se corrige automáticamente.
          </p>
          {recon?.disponible ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metrica valor={money(recon.totales?.master)} etiqueta="Maestro legacy" />
                <Metrica valor={money(recon.totales?.docs)} etiqueta="Documentos abiertos" />
                <Metrica valor={money(recon.totales?.ledger)} etiqueta="Ledger C−A" />
              </div>
              <div className="flex gap-2 flex-wrap">
                {["", "MATCH", "DIFFERENCE", "REVIEW"].map((e) => (
                  <Button key={e || "todos"} size="sm" variant={filtroRecon === e ? "default" : "outline"}
                          onClick={() => setFiltroRecon(e)}>
                    {e || "Todos"}{(recon.resumen || []).find((r) => r.estado === e)
                      ? ` (${recon.resumen.find((r) => r.estado === e).clientes})` : ""}
                  </Button>
                ))}
              </div>
              <div className="border rounded-lg overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                      <th className="p-2">Clave</th><th className="p-2">Nombre</th>
                      <th className="p-2 text-right">Maestro</th>
                      <th className="p-2 text-right">Docs</th>
                      <th className="p-2 text-right">Ledger</th>
                      <th className="p-2 text-right">Δ Docs</th>
                      <th className="p-2 text-right">Δ Ledger</th>
                      <th className="p-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recon.clientes || []).map((c) => (
                      <tr key={c.clave} className="border-t border-slate-100">
                        <td className="p-2 font-mono text-xs">{c.clave}</td>
                        <td className="p-2">{c.nombre || "—"}</td>
                        <td className="p-2 text-right font-medium">{money(c.master)}</td>
                        <td className="p-2 text-right">{money(c.docs)}</td>
                        <td className="p-2 text-right text-slate-400">{money(c.ledger)}</td>
                        <td className={`p-2 text-right ${Math.abs(c.diff_docs || 0) > 0.02 ? "text-red-600 font-medium" : "text-slate-300"}`}>{money(c.diff_docs)}</td>
                        <td className={`p-2 text-right ${Math.abs(c.diff_ledger || 0) > 0.02 ? "text-amber-600 font-medium" : "text-slate-300"}`}>{money(c.diff_ledger)}</td>
                        <td className="p-2"><Badge className={`text-[10px] ${c.estado === "MATCH" ? "bg-emerald-100 text-emerald-700" : c.estado === "REVIEW" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{c.estado}</Badge></td>
                      </tr>
                    ))}
                    {(recon.clientes || []).length === 0 && (
                      <tr><td colSpan={8} className="p-6 text-center text-slate-400 text-sm">Sin clientes para este filtro.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">Aún no hay snapshot de conciliación. Ejecuta el staging para generarlo.</p>
          )}
        </TabsContent>

        <TabsContent value="snapshots" className="mt-4 space-y-3">
          <p className="text-xs text-slate-400">
            Cada carga de legacy_data genera un snapshot versionado con detección de cambios (CREATED / UNCHANGED / UPDATED / CANCELLED / MISSING). Los snapshots anteriores se conservan.
          </p>
          <div className="border rounded-lg overflow-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="p-2">Snapshot</th><th className="p-2">Batch</th>
                  <th className="p-2">Fecha</th><th className="p-2">Hash fuente</th>
                  <th className="p-2 text-right">Nuevos</th>
                  <th className="p-2 text-right">Sin cambios</th>
                  <th className="p-2 text-right">Modificados</th>
                  <th className="p-2 text-right">Cancelados</th>
                  <th className="p-2 text-right">Ausentes</th>
                </tr>
              </thead>
              <tbody>
                {(snapshots?.snapshots || []).map((s) => {
                  const t = s.cambios?.tickets || {}; const c = s.cambios?.cxc || {};
                  const aus = (t.ausentes || 0) + (c.ausentes || 0);
                  return (
                    <tr key={s.snapshot_id} className="border-t border-slate-100">
                      <td className="p-2 font-mono text-xs">{s.snapshot_id}</td>
                      <td className="p-2 font-mono text-xs">{s.batch_id || "—"}</td>
                      <td className="p-2">{(s.created_at || "").slice(0, 16).replace("T", " ")}</td>
                      <td className="p-2 font-mono text-[10px] text-slate-400">{s.source_hash || "—"}</td>
                      <td className="p-2 text-right text-emerald-600 font-medium">{nf.format((t.nuevos || 0) + (c.nuevos || 0))}</td>
                      <td className="p-2 text-right text-slate-400">{nf.format((t.sin_cambios || 0) + (c.sin_cambios || 0))}</td>
                      <td className="p-2 text-right text-amber-600">{nf.format((t.modificados || 0) + (c.modificados || 0))}</td>
                      <td className="p-2 text-right text-red-600">{nf.format((t.cancelados || 0) + (c.cancelados || 0))}</td>
                      <td className="p-2 text-right text-slate-500">{nf.format(aus)}</td>
                    </tr>
                  );
                })}
                {(snapshots?.snapshots || []).length === 0 && (
                  <tr><td colSpan={9} className="p-6 text-center text-slate-400 text-sm">Sin snapshots registrados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="clientes" className="mt-4">
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="p-2">Clave Legacy</th><th className="p-2">Nombre</th><th className="p-2">Estado</th></tr></thead>
              <tbody>
                {(review?.clientes || []).map((c) => (
                  <tr key={c.clave} className="border-t border-slate-100">
                    <td className="p-2 font-mono text-xs">{c.clave}</td>
                    <td className="p-2">{c.nombre || "—"}</td>
                    <td className="p-2"><Badge className="bg-amber-100 text-amber-700 text-[10px]">{c.status}</Badge></td>
                  </tr>
                ))}
                {(review?.clientes || []).length === 0 && <tr><td colSpan={3} className="p-6 text-center text-slate-400">Sin clientes sin mapear.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="productos" className="mt-4">
          <p className="text-xs text-slate-400 mb-2">Top productos Legacy sin equivalencia en RYSA (no se crean automáticamente).</p>
          <div className="border rounded-lg overflow-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="p-2">Código Legacy</th><th className="p-2">Estado Legacy</th><th className="p-2 text-right">Apariciones</th></tr></thead>
              <tbody>
                {(review?.productos || []).map((p) => (
                  <tr key={p.codigo} className="border-t border-slate-100">
                    <td className="p-2 font-mono text-xs">{p.codigo}</td>
                    <td className="p-2">{p.legacy_status}</td>
                    <td className="p-2 text-right">{nf.format(p.apariciones)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal 1: advertencia */}
      <AlertDialog open={modal1} onOpenChange={setModal1}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" /> ⚠ IMPORTACIÓN HISTÓRICA
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Estás a punto de importar:</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded bg-slate-50 p-2"><b>{nf.format(s.tickets)}</b> tickets históricos</div>
                  <div className="rounded bg-slate-50 p-2"><b>{nf.format(s.detalles)}</b> detalles</div>
                  <div className="rounded bg-slate-50 p-2"><b>{nf.format(s.cxc_ready)}</b> documentos CxC</div>
                  <div className="rounded bg-slate-50 p-2"><b>{money(s.cxc_saldo)}</b> de saldo inicial</div>
                </div>
                <p className="text-slate-500">No se importarán automáticamente:</p>
                <ul className="list-disc ml-5 text-slate-500">
                  <li>{nf.format(s.cxc_review)} documentos en revisión</li>
                  <li>{nf.format(s.cxc_negative)} saldos negativos</li>
                  <li>{nf.format(s.cxc_excluded)} documentos Serie F</li>
                  <li>{nf.format(s.productos_pendientes)} productos no mapeados</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setModal1(false); setModal2(true); }}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal 2: confirmación final */}
      <AlertDialog open={modal2} onOpenChange={setModal2}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-600" /> CONFIRMACIÓN FINAL
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>Esta operación modificará la base de datos de RYSA. Será transaccional y podrá revertirse (rollback) si se detecta un error.</p>
                <label className="flex items-center gap-2 text-xs text-slate-700 select-none">
                  <Checkbox checked={backupOk} onCheckedChange={(v) => setBackupOk(!!v)} />
                  Confirmo que existe backup de la base de datos
                </label>
                <div>
                  <div className="text-xs mb-1">Escribe <b className="text-red-700">IMPORTAR LEGACY</b> para habilitar:</div>
                  <Input value={textoConfirm} onChange={(e) => setTextoConfirm(e.target.value)}
                         placeholder="IMPORTAR LEGACY" autoFocus data-testid="legacy-confirm-input" />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setTextoConfirm(""); setBackupOk(false); }}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={textoConfirm.trim() !== "IMPORTAR LEGACY" || !backupOk || busy === "import"}
                    onClick={iniciarImport} data-testid="legacy-confirmar">
              {busy === "import" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              CONFIRMAR IMPORTACIÓN
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal incremental (una etapa) */}
      <AlertDialog open={modalInc} onOpenChange={setModalInc}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" style={{ color: TERRACOTA }} /> IMPORTACIÓN INCREMENTAL
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>Se importará la diferencia entre staging y producción:</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded bg-emerald-50 p-2 border border-emerald-200">
                    <b className="text-emerald-700">{nf.format(status.delta?.nuevos || 0)}</b>
                    <span className="text-xs text-slate-500"> tickets nuevos</span>
                  </div>
                  <div className="rounded bg-amber-50 p-2 border border-amber-200">
                    <b className="text-amber-700">{nf.format(status.delta?.actualizables || 0)}</b>
                    <span className="text-xs text-slate-500"> modificados en legacy</span>
                  </div>
                </div>
                <p className="text-slate-500 text-xs">
                  Los modificados SOLO se actualizan si ningún abono de producción ha tocado
                  su saldo; en caso contrario quedan en revisión. Los tickets nuevos son
                  revertibles con rollback; los actualizados conservan su batch original.
                </p>
                <label className="flex items-center gap-2 text-xs text-slate-700 select-none">
                  <Checkbox checked={backupOk} onCheckedChange={(v) => setBackupOk(!!v)} />
                  Confirmo que existe backup de la base de datos
                </label>
                <div>
                  <div className="text-xs mb-1">Escribe <b className="text-red-700">IMPORTAR DELTA</b> para habilitar:</div>
                  <Input value={textoConfirm} onChange={(e) => setTextoConfirm(e.target.value)}
                         placeholder="IMPORTAR DELTA" autoFocus data-testid="legacy-incremental-confirm" />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setTextoConfirm(""); setBackupOk(false); }}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={textoConfirm.trim() !== "IMPORTAR DELTA" || !backupOk || busy === "incremental"}
                    onClick={iniciarIncremental} data-testid="legacy-incremental-go">
              {busy === "incremental" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              CONFIRMAR DELTA
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal rollback */}
      <AlertDialog open={modalRollback} onOpenChange={setModalRollback}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-red-600" /> REVERTIR IMPORTACIÓN LEGACY
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>Se eliminarán los documentos LEGACY importados por el último batch y se revertirán los saldos de clientes. Los datos staging se conservan.</p>
                <div>
                  <div className="text-xs mb-1">Escribe <b className="text-red-700">REVERTIR LEGACY</b> para habilitar:</div>
                  <Input value={txtRollback} onChange={(e) => setTxtRollback(e.target.value)} placeholder="REVERTIR LEGACY" autoFocus />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTxtRollback("")}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={txtRollback.trim() !== "REVERTIR LEGACY" || busy === "rollback"} onClick={rollback}>
              {busy === "rollback" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />}
              REVERTIR
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
