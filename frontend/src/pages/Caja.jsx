import { useEffect, useState } from "react";
import { api, formatApiError, money, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, Lock, Unlock, ArrowDownCircle, ArrowUpCircle, Loader2, History, Search, Users, ArrowUpDown, HandCoins, Printer, FileSpreadsheet, ClipboardCheck } from "lucide-react";

export default function Caja() {
  const { isAdminOrOwner } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fondo, setFondo] = useState("");
  const [movOpen, setMovOpen] = useState(false);
  const [mov, setMov] = useState({ tipo: "entrada", concepto: "", monto: "", referencia: "" });
  const [movFoto, setMovFoto] = useState(null);      // File del comprobante (§3.5)
  const [fotoSubiendo, setFotoSubiendo] = useState(false);
  const [bloqueoRetiro, setBloqueoRetiro] = useState(null); // {mensaje,disponible,puede_forzar}
  // Bandeja de evidencias (solo admin)
  const [evidencias, setEvidencias] = useState([]);
  const [compBusy, setCompBusy] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [contado, setContado] = useState("");
  const [cierre, setCierre] = useState(null);
  const [cierreMovs, setCierreMovs] = useState([]);
  const [cierreCajaId, setCierreCajaId] = useState("");
  // Reporte de verificación del corte (modal completo tras cerrar).
  const [repOpen, setRepOpen] = useState(false);
  const [repCaja, setRepCaja] = useState(null);   // {caja_nombre,usuario_nombre,fondo_inicial,fecha_apertura,fecha_cierre}
  const [repDesglose, setRepDesglose] = useState(null);
  const [hist, setHist] = useState([]);
  const [histDesde, setHistDesde] = useState("");
  const [histHasta, setHistHasta] = useState("");
  const [histEstado, setHistEstado] = useState("all");
  const [histOperador, setHistOperador] = useState("all");
  const [sort, setSort] = useState({ key: "fecha_apertura", dir: "desc" });
  const [detCaja, setDetCaja] = useState(null);
  const [detDesglose, setDetDesglose] = useState(null);
  const abrirDetalle = async (c) => {
    setDetCaja(c); setDetDesglose(null);
    try {
      const { data } = await api.get(`/caja/${c.id}/desglose`);
      setDetDesglose(data.desglose || null);
    } catch { /* el detalle básico sigue disponible */ }
  };
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sortedHist = [...hist];
  if (sort.key) {
    sortedHist.sort((a, b) => {
      const getV = (r) => {
        if (sort.key === "caja") return r.caja_nombre || "";
        if (sort.key === "cajero") return r.usuario_nombre || "";
        if (sort.key === "fondo") return Number(r.fondo_inicial || 0);
        if (sort.key === "esperado") return r.cierre ? Number(r.cierre.efectivo_esperado || 0) : -1;
        if (sort.key === "contado") return r.cierre ? Number(r.cierre.efectivo_contado || 0) : -1;
        if (sort.key === "diferencia") return r.cierre ? Number(r.cierre.diferencia || 0) : -1;
        return r[sort.key] || "";
      };
      let x = getV(a), y = getV(b);
      if (["fondo", "esperado", "contado", "diferencia"].includes(sort.key)) { x = Number(x || 0); y = Number(y || 0); return sort.dir === "asc" ? x - y : y - x; }
      let r;
      if (sort.key === "fecha_apertura" || sort.key === "fecha_cierre") { x = String(a[sort.key] || ""); y = String(b[sort.key] || ""); r = x.localeCompare(y); }
      else r = String(x).localeCompare(String(y), "es", { numeric: true });
      return sort.dir === "asc" ? r : -r;
    });
  }

  const [operadores, setOperadores] = useState([]);
  const [loadingOps, setLoadingOps] = useState(isAdminOrOwner);
  const [openTarget, setOpenTarget] = useState(null);
  const [openFondo, setOpenFondo] = useState("");
  const [closeTarget, setCloseTarget] = useState(null);
  const [closeContado, setCloseContado] = useState("");

  const loadHist = async () => {
    const params = {};
    if (histDesde) params.desde = histDesde;
    if (histHasta) params.hasta = histHasta;
    if (histEstado !== "all") params.estado = histEstado;
    if (histOperador !== "all") params.usuario_id = histOperador;
    const { data } = await api.get("/caja/historial", { params });
    setHist(data);
  };

  const loadOperadores = async () => {
    if (!isAdminOrOwner) return;
    try {
      const { data } = await api.get("/caja/operadores");
      setOperadores(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoadingOps(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/caja/actual");
      setData(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "No se pudo cargar la caja.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); loadHist(); loadOperadores(); loadEvidencias(); /* eslint-disable-next-line */ }, []);

  const refetch = () => { load(); loadHist(); loadOperadores(); };

  const abrir = async () => {
    try { await api.post("/caja/abrir", { fondo_inicial: Number(fondo || 0) }); toast.success("Caja abierta"); setFondo(""); refetch(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const registrarMov = async (forzar = false) => {
    if (!mov.concepto.trim() || !mov.monto) return toast.error("Concepto y monto requeridos");
    try {
      let evidencia_url = "";
      if (movFoto) {
        setFotoSubiendo(true);
        try {
          const fd = new FormData();
          fd.append("file", movFoto);
          const up = await api.post("/uploads/image", fd, { headers: { "Content-Type": "multipart/form-data" } });
          evidencia_url = up.data.url;
        } finally { setFotoSubiendo(false); }
      }
      const { data } = await api.post("/caja/movimiento", {
        ...mov, monto: Number(mov.monto), forzar, evidencia_url,
      });
      toast.success(mov.tipo === "retiro" ? "Entrega de efectivo registrada (descontada de caja)" : "Movimiento registrado");
      if (evidencia_url) toast.info("Evidencia fotográfica enviada a revisión.");
      setMovOpen(false);
      const creado = data?.movimiento;
      const fueRetiro = mov.tipo === "retiro";
      setMov({ tipo: "entrada", concepto: "", monto: "", referencia: "" });
      setMovFoto(null); setBloqueoRetiro(null);
      load();
      // El ticket de entrega se abre automáticamente al registrar el retiro.
      if (fueRetiro && creado?.id) abrirComprobante(creado);
    }
    catch (e) {
      const d = e?.response?.data?.detail;
      if (e?.response?.status === 409 && d && typeof d === "object") {
        setBloqueoRetiro(d); // §3.3 ventana bloqueante de excedente
      } else {
        toast.error(typeof d === "string" ? d : formatApiError(d));
      }
    }
  };

  const loadEvidencias = async () => {
    if (!isAdminOrOwner) return;
    try {
      const { data } = await api.get("/caja/evidencias?estado=pendiente");
      setEvidencias(data || []);
    } catch { setEvidencias([]); }
  };
  const revisarEvidencia = async (id) => {
    try {
      await api.patch(`/caja/movimientos/${id}/revisar`);
      toast.success("Evidencia marcada como revisada");
      loadEvidencias();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // Ticket 80mm del movimiento (entrega de efectivo con folio y firmas).
  const abrirComprobante = async (m) => {
    setCompBusy(m.id);
    try {
      const { data } = await api.post(`/caja/movimientos/${m.id}/comprobante`);
      window.open(fileUrl(data.url), "_blank");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "No se pudo generar el ticket"); }
    finally { setCompBusy(""); }
  };
  const descargarReporte = async (cajaId, fmt) => {
    if (!cajaId) return toast.error("No hay corte para descargar");
    try {
      const { data } = await api.get(`/caja/${cajaId}/reporte.${fmt}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url; a.download = `corte-caja.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Error al descargar el reporte"); }
  };

  const cerrar = async () => {
    const cajaId = data?.caja?.id;
    try {
      const { data: resp } = await api.post("/caja/cerrar", { efectivo_contado: Number(contado || 0) });
      setCierre(resp.cierre); setCierreMovs(resp.movimientos || []); setCierreCajaId(cajaId);
      setRepCaja(resp.caja || null); setRepDesglose(resp.desglose || null);
      setCloseOpen(false); setRepOpen(true); toast.success("Caja cerrada"); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const abrirPorUsuario = async () => {
    if (!openTarget) return;
    try {
      await api.post("/caja/abrir-por-usuario", { usuario_id: openTarget.usuario_id, fondo_inicial: Number(openFondo || 0) });
      toast.success(`Caja abierta para ${openTarget.usuario_nombre}`);
      setOpenTarget(null); setOpenFondo(""); refetch();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const cerrarPorUsuario = async () => {
    if (!closeTarget) return;
    try {
      const { data: resp } = await api.post("/caja/cerrar", { caja_id: closeTarget.caja.id, efectivo_contado: Number(closeContado || 0) });
      setCierre(resp.cierre); setCierreMovs(resp.movimientos || []); setCierreCajaId(closeTarget.caja.id);
      setRepCaja(resp.caja || null); setRepDesglose(resp.desglose || null);
      toast.success(`Caja ${closeTarget.caja.caja_nombre} de ${closeTarget.usuario_nombre} cerrada`);
      setCloseTarget(null); setCloseContado(""); setRepOpen(true); refetch();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // Descarga de ventas del turno o del día (Excel).
  const descargarVentas = async (cajaId, ambito) => {
    if (!cajaId) return toast.error("No hay corte para descargar");
    try {
      const { data } = await api.get(`/caja/${cajaId}/ventas.xlsx`, { params: { ambito }, responseType: "blob" });
      const url = window.URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url; a.download = `ventas_${ambito}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Error al descargar ventas"); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-[#C1401E]" /></div>;

  const caja = data?.caja;
  const res = data?.resumen;

  return (
    <div className="space-y-5" data-testid="caja-page">
      <h1 className="font-display text-2xl font-black tracking-tight">Caja</h1>

      {!caja ? (
        <div className="card-soft p-8 max-w-md">
          <div className="w-12 h-12 rounded-md bg-[#C1401E]/10 flex items-center justify-center mb-4"><Wallet className="w-6 h-6 text-[#C1401E]" /></div>
          <h2 className="font-display text-lg font-bold">No hay caja abierta</h2>
          <p className="text-slate-500 text-sm mb-4">Ingresa el fondo inicial para comenzar a operar.</p>
          <Label className="text-xs uppercase tracking-wider text-slate-500">Fondo inicial</Label>
          <Input type="number" value={fondo} onChange={(e) => setFondo(e.target.value)} className="mt-1 mb-4" data-testid="fondo-inicial" placeholder="0.00" />
          <Button onClick={abrir} className="w-full bg-[#C1401E] hover:bg-[#A03316]" data-testid="abrir-caja-btn"><Unlock className="w-4 h-4 mr-2" /> Abrir caja</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge className="bg-green-100 text-green-700 text-sm px-3 py-1">{caja.caja_nombre} abierta · {caja.usuario_nombre}</Badge>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setMov({ tipo: "retiro", concepto: "", monto: "", referencia: "" }); setMovOpen(true); }} data-testid="entregar-efectivo-btn"><HandCoins className="w-4 h-4 mr-1" /> Entregar efectivo</Button>
              <Button variant="outline" onClick={() => setMovOpen(true)} data-testid="mov-caja-btn"><ArrowDownCircle className="w-4 h-4 mr-1" /> Movimiento</Button>
              <Button onClick={() => setCloseOpen(true)} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="cerrar-caja-btn"><Lock className="w-4 h-4 mr-1" /> Cerrar caja</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[["Fondo inicial", res.fondo_inicial], ["Ventas efectivo", res.ventas_efectivo], ["Entradas", res.entradas], ["Retiros", res.retiros], ["Devoluciones", res.devoluciones], ["Efectivo esperado", res.efectivo_esperado]].map(([l, v], i) => (
              <div key={i} className={`card-soft border-slate-200 p-4 ${i === 5 ? "border-[#C1401E] ring-1 ring-[#C1401E]" : "border-slate-200"}`}>
                <div className="text-xs uppercase tracking-wider text-slate-500">{l}</div>
                <div className="font-display text-lg font-black mt-1">{money(v)}</div>
              </div>
            ))}
          </div>

          <div className="card-soft overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="p-3">Hora</th><th className="p-3">Tipo</th><th className="p-3">Concepto</th><th className="p-3">Ref</th><th className="p-3 text-right">Entrada</th><th className="p-3 text-right">Salida</th><th className="p-3 text-right">Saldo</th><th className="p-3 text-center">Ticket</th>
              </tr></thead>
              <tbody>
                {(data.movimientos || []).map((m, i) => {
                  const en = ["venta", "entrada"].includes(m.tipo) ? Number(m.monto) : 0;
                  const sa = ["retiro", "gasto", "devolucion"].includes(m.tipo) ? Number(m.monto) : 0;
                  const saldo = Number(res.fondo_inicial) + data.movimientos.slice(0, i + 1).reduce((acc, x) => acc + (["venta", "entrada"].includes(x.tipo) ? Number(x.monto) : 0) - (["retiro", "gasto", "devolucion"].includes(x.tipo) ? Number(x.monto) : 0), 0);
                  const imprimible = ["retiro", "entrada", "gasto", "devolucion"].includes(m.tipo);
                  return (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="p-3 text-slate-500">{m.fecha?.slice(11, 16)}</td>
                      <td className="p-3"><Badge variant="outline">{m.folio ? `${m.tipo} · ${m.folio}` : m.tipo}</Badge></td>
                      <td className="p-3">{m.concepto}</td><td className="p-3 text-slate-500">{m.referencia}</td>
                      <td className={`p-3 text-right font-semibold ${en > 0 ? "text-green-600" : "text-slate-300"}`}>{en > 0 ? money(en) : "—"}</td>
                      <td className={`p-3 text-right font-semibold ${sa > 0 ? "text-red-600" : "text-slate-300"}`}>{sa > 0 ? money(sa) : "—"}</td>
                      <td className="p-3 text-right font-medium tabular-nums">{money(saldo)}</td>
                      <td className="p-3 text-center">
                        {imprimible && (
                          <Button size="icon" variant="ghost" title={m.tipo === "retiro" ? "Ticket de entrega de efectivo" : "Comprobante"} disabled={compBusy === m.id} onClick={() => abrirComprobante(m)} data-testid={`ticket-${m.folio || m.id}`}>
                            {compBusy === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(data.movimientos || []).length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">Sin movimientos aún.</td></tr>}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold">
                  <td className="p-3" colSpan={2}>Totales</td>
                  <td className="p-3" colSpan={3}></td>
                  <td className="p-3 text-right text-green-600">{money(res.ventas_efectivo + res.entradas)}</td>
                  <td className="p-3 text-right text-red-600">{money(res.retiros + res.devoluciones)}</td>
                  <td className="p-3 text-right text-[#C1401E]">{money(res.efectivo_esperado)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {cierre && (
        <div className="card-soft p-5 max-w-3xl" data-testid="reporte-cierre">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-display font-bold flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-[#C1401E]" /> Reporte de cierre</h3>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setRepOpen(true)} data-testid="cierre-verificar">
                <ClipboardCheck className="w-4 h-4 mr-1" /> Verificar / reporte completo
              </Button>
              <Button size="sm" variant="outline" onClick={() => descargarReporte(cierreCajaId, "pdf")} data-testid="cierre-descargar-pdf"><ArrowDownCircle className="w-4 h-4 mr-1" /> PDF</Button>
              <Button size="sm" variant="outline" onClick={() => descargarReporte(cierreCajaId, "xlsx")} data-testid="cierre-descargar-excel"><ArrowDownCircle className="w-4 h-4 mr-1" /> Excel</Button>
              <Button size="sm" variant="ghost" onClick={() => { setCierre(null); setCierreMovs([]); }}>Ocultar</Button>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mb-4 max-w-md text-sm">
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Efectivo esperado</div><div className="font-semibold">{money(cierre.efectivo_esperado)}</div></div>
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Contado</div><div className="font-semibold">{money(cierre.efectivo_contado)}</div></div>
            <div className={`rounded-lg p-2 ${cierre.diferencia < 0 ? "bg-red-50" : "bg-green-50"}`}><div className="text-[10px] uppercase text-slate-400">Diferencia</div><div className={`font-black ${cierre.diferencia < 0 ? "text-red-600" : "text-green-700"}`}>{money(cierre.diferencia)}</div></div>
          </div>
          {(cierreMovs || []).length > 0 && (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50"><tr className="text-left text-slate-500 uppercase tracking-wider">
                  <th className="p-2">Hora</th><th className="p-2">Tipo</th><th className="p-2">Concepto</th><th className="p-2">Ref.</th>
                  <th className="p-2 text-right">Entrada</th><th className="p-2 text-right">Salida</th><th className="p-2 text-right">Saldo</th>
                </tr></thead>
                <tbody>
                  {(() => {
                    // Saldo corrido: fondo + entradas - salidas (mismo criterio que el backend).
                    let saldo = Number((data?.caja?.fondo_inicial ?? res?.fondo_inicial ?? 0));
                    return cierreMovs.map((m, i) => {
                      const monto = Number(m.monto || 0);
                      const entrada = ["venta", "entrada"].includes(m.tipo) ? monto : 0;
                      const salida = ["retiro", "gasto", "devolucion"].includes(m.tipo) ? monto : 0;
                      saldo = Math.round((saldo + entrada - salida) * 100) / 100;
                      const f = (m.fecha || "");
                      return (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="p-2 text-slate-500 whitespace-nowrap">{f.slice(11, 16)}</td>
                          <td className="p-2"><Badge variant="outline">{m.tipo}</Badge></td>
                          <td className="p-2">{m.concepto}</td>
                          <td className="p-2 text-slate-400">{m.referencia || "—"}</td>
                          <td className="p-2 text-right text-green-700">{entrada ? money(entrada) : ""}</td>
                          <td className="p-2 text-right text-red-600">{salida ? money(salida) : ""}</td>
                          <td className="p-2 text-right font-semibold">{money(saldo)}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============ REPORTE DE VERIFICACIÓN COMPLETA DEL CIERRE ============ */}
      <Dialog open={repOpen} onOpenChange={setRepOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="reporte-verificacion">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-[#C1401E]" /> Reporte de cierre · verificación
            </DialogTitle>
          </DialogHeader>

          {/* Encabezado del corte */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Caja</div><div className="font-semibold">{repCaja?.caja_nombre || "Caja"}</div></div>
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Cajero</div><div className="font-semibold">{repCaja?.usuario_nombre || "—"}</div></div>
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Apertura</div><div className="font-medium">{(repCaja?.fecha_apertura || "").slice(0, 16).replace("T", " ") || "—"}</div></div>
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Cierre</div><div className="font-medium">{(repCaja?.fecha_cierre || cierre?.fecha_cierre || "").slice(0, 16).replace("T", " ") || "—"}</div></div>
          </div>

          {/* Arqueo */}
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Arqueo (verificación de efectivo)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-sm">
              {[["Fondo inicial", repCaja?.fondo_inicial ?? res?.fondo_inicial],
                ["Ventas efectivo", cierre?.ventas_efectivo],
                ["Entradas", cierre?.entradas],
                ["Retiros + gastos", cierre?.retiros],
                ["Devoluciones", cierre?.devoluciones],
              ].map(([l, v], i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2">
                  <div className="text-[10px] uppercase text-slate-400">{l}</div>
                  <div className="font-semibold tabular-nums">{money(v)}</div>
                </div>
              ))}
              <div className="rounded-lg border-2 border-[#C1401E] p-2">
                <div className="text-[10px] uppercase text-slate-500 font-semibold">Esperado</div>
                <div className="font-black tabular-nums text-[#C1401E]">{money(cierre?.efectivo_esperado)}</div>
              </div>
              <div className={`rounded-lg p-2 ${Number(cierre?.diferencia) === 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                <div className="text-[10px] uppercase text-slate-400">Contado / Diferencia</div>
                <div className="font-semibold tabular-nums">{money(cierre?.efectivo_contado)}</div>
                <div className={`font-black tabular-nums ${Number(cierre?.diferencia) < 0 ? "text-red-600" : Number(cierre?.diferencia) > 0 ? "text-amber-600" : "text-green-700"}`}>
                  {cierre?.diferencia > 0 ? "+" : ""}{money(cierre?.diferencia)}
                </div>
              </div>
            </div>
          </div>

          {/* Desglose de ventas del turno */}
          {repDesglose && (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Ventas del turno</div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant="outline" className="h-7 px-3">{repDesglose.num_ventas} ventas</Badge>
                <span className="font-semibold">Total vendido: {money(repDesglose.total_vendido)}</span>
                {Object.entries(repDesglose.metodos || {}).map(([met, monto]) => (
                  <span key={met} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-xs">
                    <b className="capitalize">{met}</b> {money(monto)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Movimientos del turno */}
          {(cierreMovs || []).length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Movimientos del turno ({cierreMovs.length}) — con saldo corrido para verificar
              </div>
              <div className="overflow-x-auto border rounded-lg max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-slate-500 uppercase tracking-wider">
                    <th className="p-2">Hora</th><th className="p-2">Tipo</th><th className="p-2">Concepto</th><th className="p-2">Ref.</th><th className="p-2">Usuario</th>
                    <th className="p-2 text-right">Entrada</th><th className="p-2 text-right">Salida</th><th className="p-2 text-right">Saldo</th>
                  </tr></thead>
                  <tbody>
                    {(() => {
                      let saldo = Number(repCaja?.fondo_inicial ?? res?.fondo_inicial ?? 0);
                      return cierreMovs.map((m, i) => {
                        const monto = Number(m.monto || 0);
                        const entrada = ["venta", "entrada"].includes(m.tipo) ? monto : 0;
                        const salida = ["retiro", "gasto", "devolucion"].includes(m.tipo) ? monto : 0;
                        saldo = Math.round((saldo + entrada - salida) * 100) / 100;
                        const f = (m.fecha || "");
                        return (
                          <tr key={m.id || i} className="border-t border-slate-100">
                            <td className="p-2 text-slate-500 whitespace-nowrap">{f.slice(11, 16)}</td>
                            <td className="p-2"><Badge variant="outline">{m.folio ? `${m.tipo} ${m.folio}` : m.tipo}</Badge></td>
                            <td className="p-2 max-w-[180px] truncate" title={m.concepto}>{m.concepto}</td>
                            <td className="p-2 text-slate-400">{m.referencia || "—"}</td>
                            <td className="p-2 text-slate-400">{m.usuario_nombre || "—"}</td>
                            <td className="p-2 text-right text-green-700">{entrada ? money(entrada) : ""}</td>
                            <td className="p-2 text-right text-red-600">{salida ? money(salida) : ""}</td>
                            <td className="p-2 text-right font-semibold tabular-nums">{money(saldo)}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Descargas */}
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Descargar reportes</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => descargarReporte(cierreCajaId, "pdf")}>
                <ArrowDownCircle className="w-4 h-4 mr-1" /> Corte PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => descargarReporte(cierreCajaId, "xlsx")}>
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Corte Excel
              </Button>
              <Button size="sm" variant="outline" onClick={() => descargarVentas(cierreCajaId, "turno")} data-testid="descargas-ventas-turno">
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Ventas del turno (Excel)
              </Button>
              <Button size="sm" variant="outline" onClick={() => descargarVentas(cierreCajaId, "dia")} data-testid="descargas-ventas-dia">
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Ventas del día (Excel)
              </Button>
              <Button size="sm" variant="outline" onClick={() => descargarReporte(cierreCajaId, "pdf")}>
                <Printer className="w-4 h-4 mr-1" /> Imprimir reporte
              </Button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              El corte incluye el ledger completo con saldo corrido; las ventas incluyen folio, cliente, método y total.
            </p>
          </div>

          <DialogFooter>
            <Button onClick={() => setRepOpen(false)} data-testid="reporte-verificacion-cerrar">Listo, verificado</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isAdminOrOwner && (
        <div className="card-soft p-4 space-y-3" data-testid="caja-global">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display font-bold flex items-center gap-2"><Users className="w-5 h-5 text-[#C1401E]" /> Estado global de cajas</h3>
          </div>

          {loadingOps ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#C1401E]" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="p-2">Caja</th><th className="p-2">Operador</th><th className="p-2">Rol</th><th className="p-2">Estado</th>
                  <th className="p-2">Apertura</th><th className="p-2 text-right">Fondo</th><th className="p-2 text-right">Esperado</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {operadores.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">Sin usuarios activos.</td></tr>}
                  {operadores.map((o) => (
                    <tr key={o.usuario_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`caja-global-${o.usuario_id}`}>
                      <td className="p-2 font-semibold text-slate-800">{o.caja ? o.caja.caja_nombre : (o.caja_numero ? `Caja ${o.caja_numero}` : "—")}</td>
                      <td className="p-2">{o.usuario_nombre}</td>
                      <td className="p-2 text-slate-500">{o.role}</td>
                      <td className="p-2"><Badge className={o.estado === "abierta" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}>{o.estado}</Badge></td>
                      <td className="p-2 text-slate-500">{o.caja ? (o.caja.fecha_apertura || "").slice(0, 16).replace("T", " ") : "—"}</td>
                      <td className="p-2 text-right">{o.caja ? money(o.caja.fondo_inicial) : "—"}</td>
                      <td className="p-2 text-right">{o.resumen ? money(o.resumen.efectivo_esperado) : "—"}</td>
                      <td className="p-2 text-right">
                        {o.estado === "abierta" ? (
                          <Button size="sm" variant="outline" onClick={() => setCloseTarget(o)} data-testid={`caja-global-cerrar-${o.usuario_id}`}><Lock className="w-3.5 h-3.5 mr-1" /> Cerrar</Button>
                        ) : (
                          <Button size="sm" onClick={() => setOpenTarget(o)} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid={`caja-global-abrir-${o.usuario_id}`}><Unlock className="w-3.5 h-3.5 mr-1" /> Abrir</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Historial de aperturas y cortes de caja */}
      <div className="card-soft p-4 space-y-3" data-testid="caja-historial">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display font-bold flex items-center gap-2"><History className="w-5 h-5 text-[#C1401E]" /> {isAdminOrOwner ? "Historial global de cajas" : "Mi historial de cortes y aperturas"}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={histDesde} onChange={(e) => setHistDesde(e.target.value)} className="w-40 h-9" data-testid="hist-desde" />
            <span className="text-slate-400 text-sm">a</span>
            <Input type="date" value={histHasta} onChange={(e) => setHistHasta(e.target.value)} className="w-40 h-9" data-testid="hist-hasta" />
            <Select value={histEstado} onValueChange={setHistEstado}>
              <SelectTrigger className="w-36 h-9" data-testid="hist-estado"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas</SelectItem><SelectItem value="abierta">Abiertas</SelectItem><SelectItem value="cerrada">Cerradas</SelectItem></SelectContent>
            </Select>
            <Select value={histOperador} onValueChange={(v) => { setHistOperador(v); loadHist(); }}>
              <SelectTrigger className="w-44 h-9" data-testid="hist-operador"><SelectValue placeholder="Operador" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los operadores</SelectItem>
                {(operadores || []).map((o) => <SelectItem key={o.usuario_id} value={o.usuario_id}>{o.usuario_nombre}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" className="h-9" onClick={loadHist} data-testid="hist-buscar"><Search className="w-4 h-4" /></Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              {[{ key: "caja", label: "Caja" }, { key: "estado", label: "Estado", noSort: true }, { key: "cajero", label: "Cajero" }, { key: "fecha_apertura", label: "Apertura" }, { key: "fecha_cierre", label: "Cierre" },
                { key: "fondo", label: "Fondo", right: true }, { key: "esperado", label: "Esperado", right: true }, { key: "contado", label: "Contado", right: true }, { key: "diferencia", label: "Diferencia", right: true }].map((col) => (
                <th key={col.key} onClick={() => !col.noSort && toggleSort(col.key)} className={`p-2 ${col.noSort ? "" : "cursor-pointer select-none hover:text-[#C1401E]"} ${col.right ? "text-right" : "text-left"}`}>
                  <span className={`inline-flex items-center gap-1 ${col.right ? "flex-row-reverse" : ""}`}>
                    {col.label}
                    {sort.key === col.key ? (sort.dir === "asc" ? "↑" : "↓") : !col.noSort && <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </span>
                </th>
              ))}
              <th className="p-2"></th>
            </tr></thead>
            <tbody>
              {hist.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-slate-400">Sin registros en el rango.</td></tr>}
              {sortedHist.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`caja-hist-${c.id}`}>
                  <td className="p-2 font-semibold text-slate-800">{c.caja_nombre || "Caja"}</td>
                  <td className="p-2"><Badge className={c.estado === "abierta" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}>{c.estado}</Badge></td>
                  <td className="p-2">{c.usuario_nombre}</td>
                  <td className="p-2 text-slate-500">{(c.fecha_apertura || "").slice(0, 16).replace("T", " ")}</td>
                  <td className="p-2 text-slate-500">{c.fecha_cierre ? c.fecha_cierre.slice(0, 16).replace("T", " ") : "—"}</td>
                  <td className="p-2 text-right">{money(c.fondo_inicial)}</td>
                  <td className="p-2 text-right">{c.cierre ? money(c.cierre.efectivo_esperado) : "—"}</td>
                  <td className="p-2 text-right">{c.cierre ? money(c.cierre.efectivo_contado) : "—"}</td>
                  <td className={`p-2 text-right font-semibold ${c.cierre && c.cierre.diferencia < 0 ? "text-red-600" : "text-green-600"}`}>{c.cierre ? money(c.cierre.diferencia) : "—"}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => abrirDetalle(c)} data-testid={`caja-hist-ver-${c.id}`}>Ver</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bandeja de evidencias fotográficas (solo admin) */}
      {isAdminOrOwner && evidencias.length > 0 && (
        <div className="card-soft p-4 space-y-3" data-testid="caja-evidencias">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold flex items-center gap-2">📷 Evidencias por revisar ({evidencias.length})</h3>
            <Button size="sm" variant="ghost" onClick={loadEvidencias}><Search className="w-4 h-4" /></Button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {evidencias.map((ev) => (
              <div key={ev.id} className="border border-slate-200 rounded-lg p-3 flex gap-3">
                <a href={fileUrl(ev.evidencia_url)} target="_blank" rel="noreferrer">
                  <img src={fileUrl(ev.evidencia_url)} alt="comprobante" className="w-16 h-16 object-cover rounded-md border" loading="lazy" />
                </a>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold capitalize">{ev.tipo} {ev.folio ? `· ${ev.folio}` : ""}</div>
                  <div className="text-slate-500 truncate">{ev.concepto}</div>
                  <div className="text-xs text-slate-400">{(ev.fecha || "").slice(0, 16).replace("T", " ")} · {ev.usuario_nombre} · {ev.caja_nombre}</div>
                  <Badge variant="outline" className="mt-1 text-[10px] uppercase">{ev.evidencia_estado}</Badge>
                </div>
                <Button size="sm" variant="outline" onClick={() => revisarEvidencia(ev.id)} data-testid={`evid-revisar-${ev.id}`}>
                  Revisada
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!detCaja} onOpenChange={(o) => !o && setDetCaja(null)}>
        <DialogContent data-testid="caja-hist-detalle">
          <DialogHeader><DialogTitle className="font-display">Corte de caja · {detCaja?.caja_nombre || "Caja"} · {detCaja?.usuario_nombre}</DialogTitle></DialogHeader>
          {detCaja && (
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span>Apertura</span><span>{(detCaja.fecha_apertura || "").slice(0, 16).replace("T", " ")}</span></div>
              <div className="flex justify-between"><span>Cierre</span><span>{detCaja.fecha_cierre ? detCaja.fecha_cierre.slice(0, 16).replace("T", " ") : "En operación"}</span></div>
              <div className="flex justify-between"><span>Fondo inicial</span><span>{money(detCaja.fondo_inicial)}</span></div>
              {detCaja.cierre && <>
                <div className="flex justify-between"><span>Efectivo esperado</span><span>{money(detCaja.cierre.efectivo_esperado)}</span></div>
                <div className="flex justify-between"><span>Efectivo contado</span><span>{money(detCaja.cierre.efectivo_contado)}</span></div>
                <div className="flex justify-between border-t pt-2 font-bold"><span>Diferencia</span><span className={detCaja.cierre.diferencia < 0 ? "text-red-600" : "text-green-600"}>{money(detCaja.cierre.diferencia)}</span></div>
              </>}
              {detDesglose && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Ventas del turno</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">{detDesglose.num_ventas} ventas</Badge>
                    <span className="font-semibold">Total: {money(detDesglose.total_vendido)}</span>
                    {Object.entries(detDesglose.metodos || {}).map(([met, monto]) => (
                      <span key={met} className="px-2 py-0.5 rounded-full bg-slate-100"><b className="capitalize">{met}</b> {money(monto)}</span>
                    ))}
                  </div>
                </div>
              )}
              {detCaja.movimientos?.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex justify-between font-semibold border-b border-slate-200 pb-1 mb-1"><span>Movimientos</span><span>Saldo</span></div>
                  <div className="max-h-56 overflow-y-auto">
                    {(detCaja.movimientos || []).map((m, i) => {
                      const en = ["venta", "entrada"].includes(m.tipo) ? Number(m.monto) : 0;
                      const sa = ["retiro", "gasto", "devolucion"].includes(m.tipo) ? Number(m.monto) : 0;
                      const saldo = Number(detCaja.fondo_inicial || 0) + detCaja.movimientos.slice(0, i + 1).reduce((acc, x) => acc + (["venta", "entrada"].includes(x.tipo) ? Number(x.monto) : 0) - (["retiro", "gasto", "devolucion"].includes(x.tipo) ? Number(x.monto) : 0), 0);
                      return (
                        <div key={m.id} className="flex justify-between py-1 text-xs text-slate-600 border-b border-slate-50">
                          <span className="truncate pr-2">{m.fecha?.slice(11, 16)} · {m.tipo} · {m.concepto}</span>
                          <span className={`whitespace-nowrap tabular-nums ${en > 0 ? "text-green-600" : sa > 0 ? "text-red-600" : "text-slate-400"}`}>{en > 0 ? `+${money(en)}` : sa > 0 ? `-${money(sa)}` : "—"} · {money(saldo)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => descargarReporte(detCaja?.id, "pdf")} data-testid="detalle-descargar-pdf"><ArrowDownCircle className="w-4 h-4 mr-1" /> Corte PDF</Button>
              <Button size="sm" variant="outline" onClick={() => descargarReporte(detCaja?.id, "xlsx")} data-testid="detalle-descargar-excel"><FileSpreadsheet className="w-4 h-4 mr-1" /> Corte Excel</Button>
              <Button size="sm" variant="outline" onClick={() => descargarVentas(detCaja?.id, "turno")}><FileSpreadsheet className="w-4 h-4 mr-1" /> Ventas turno</Button>
              <Button size="sm" variant="outline" onClick={() => descargarVentas(detCaja?.id, "dia")}><FileSpreadsheet className="w-4 h-4 mr-1" /> Ventas del día</Button>
            </div>
            <Button variant="outline" onClick={() => setDetCaja(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={movOpen} onOpenChange={(o) => { setMovOpen(o); if (!o) { setBloqueoRetiro(null); setMovFoto(null); } }}>
        <DialogContent data-testid="mov-dialog">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><HandCoins className="w-5 h-5 text-[#C1401E]" /> {mov.tipo === "retiro" ? "Entrega de efectivo" : mov.tipo === "gasto" ? "Registrar gasto" : "Movimiento de caja"}</DialogTitle></DialogHeader>
          {mov.tipo === "retiro" && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              El monto se <b>descontará del efectivo en caja</b> y se generará un ticket de entrega con folio RET y firmas.
            </p>
          )}
          <div className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Tipo</Label>
              <Select value={mov.tipo} onValueChange={(v) => setMov((s) => ({ ...s, tipo: v }))}>
                <SelectTrigger className="mt-1" data-testid="mov-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada manual</SelectItem>
                  <SelectItem value="retiro">Retiro</SelectItem>
                  <SelectItem value="gasto">Gasto</SelectItem>
                  <SelectItem value="ajuste">Ajuste</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Concepto / Motivo</Label><Input value={mov.concepto} onChange={(e) => setMov((s) => ({ ...s, concepto: e.target.value }))} className="mt-1" data-testid="mov-concepto" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Monto</Label><Input type="number" value={mov.monto} onChange={(e) => setMov((s) => ({ ...s, monto: e.target.value }))} className="mt-1" data-testid="mov-monto" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Referencia</Label><Input value={mov.referencia} onChange={(e) => setMov((s) => ({ ...s, referencia: e.target.value }))} className="mt-1" /></div>

            {/* §3.5 Evidencia fotográfica del comprobante (gasto/retiro) */}
            {(mov.tipo === "retiro" || mov.tipo === "gasto") && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-500">Foto del comprobante (opcional)</Label>
                <div className="mt-1 flex items-center gap-3">
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 h-9 rounded-md border border-slate-200 text-sm hover:bg-slate-50" data-testid="mov-foto-btn">
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                           onChange={(e) => { setMovFoto(e.target.files?.[0] || null); e.target.value = ""; }} />
                    {fotoSubiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <>📷 {movFoto ? "Cambiar foto" : "Tomar / elegir foto"}</>}
                  </label>
                  {movFoto && (
                    <>
                      <img src={URL.createObjectURL(movFoto)} alt="evidencia" className="w-10 h-10 object-cover rounded-md border" />
                      <button type="button" onClick={() => setMovFoto(null)} className="text-slate-400 hover:text-red-600 text-sm">Quitar</button>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">La evidencia llega a la bandeja de revisión de administración.</p>
              </div>
            )}

            {/* §3.3 Bloqueo por excedente */}
            {bloqueoRetiro && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm" data-testid="mov-bloqueo">
                <div className="font-semibold text-red-700 flex items-center gap-1.5">⚠️ Operación bloqueada</div>
                <p className="text-slate-700 mt-1">{bloqueoRetiro.mensaje}</p>
                {!bloqueoRetiro.puede_forzar && (
                  <p className="text-xs text-slate-500 mt-1">Solicita autorización a un encargado o administración.</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-between w-full">
            {bloqueoRetiro && bloqueoRetiro.puede_forzar ? (
              <>
                <Button variant="outline" onClick={() => setBloqueoRetiro(null)}>Ajustar monto</Button>
                <Button variant="destructive" onClick={() => registrarMov(true)} data-testid="mov-forzar">
                  Forzar retiro (autorizado)
                </Button>
              </>
            ) : bloqueoRetiro ? (
              <Button variant="outline" onClick={() => setBloqueoRetiro(null)}>Entendido</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setMovOpen(false)}>Cancelar</Button>
                <Button onClick={() => registrarMov(false)} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="mov-save">Registrar</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent data-testid="close-dialog">
          <DialogHeader><DialogTitle className="font-display">Cerrar caja</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Verifica contra el efectivo esperado antes de confirmar:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {[["Ventas efectivo", res?.ventas_efectivo], ["Entradas", res?.entradas], ["Retiros + gastos", res?.retiros], ["Devoluciones", res?.devoluciones]].map(([l, v], i) => (
              <div key={i} className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] uppercase text-slate-400">{l}</div>
                <div className="font-semibold tabular-nums">{money(v)}</div>
              </div>
            ))}
          </div>
          <div className="text-sm">Efectivo esperado: <b className="text-[#C1401E]">{money(res?.efectivo_esperado)}</b></div>
          <div><Label className="text-xs uppercase tracking-wider text-slate-500">Efectivo contado</Label><Input type="number" value={contado} onChange={(e) => setContado(e.target.value)} className="mt-1" data-testid="efectivo-contado" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setCloseOpen(false)}>Cancelar</Button><Button onClick={cerrar} className="bg-[#C1401E] hover:bg-[#A03316]" data-testid="confirm-cierre"><ArrowUpCircle className="w-4 h-4 mr-1" /> Confirmar cierre</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!openTarget} onOpenChange={(o) => !o && setOpenTarget(null)}>
        <DialogContent data-testid="abrir-por-usuario-dialog">
          <DialogHeader><DialogTitle className="font-display">Abrir caja para {openTarget?.usuario_nombre}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-slate-500">Fondo inicial</Label><Input type="number" value={openFondo} onChange={(e) => setOpenFondo(e.target.value)} className="mt-1" data-testid="abrir-por-usuario-fondo" placeholder="0.00" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => { setOpenTarget(null); setOpenFondo(""); }}>Cancelar</Button><Button onClick={abrirPorUsuario} className="bg-[#C1401E] hover:bg-[#A03316]"><Unlock className="w-4 h-4 mr-1" /> Abrir caja</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)}>
        <DialogContent data-testid="cerrar-por-usuario-dialog">
          <DialogHeader><DialogTitle className="font-display">Cerrar caja {closeTarget?.caja?.caja_nombre} de {closeTarget?.usuario_nombre}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Efectivo esperado: <b>{money(closeTarget?.resumen?.efectivo_esperado)}</b></p>
          <div><Label className="text-xs uppercase tracking-wider text-slate-500">Efectivo contado</Label><Input type="number" value={closeContado} onChange={(e) => setCloseContado(e.target.value)} className="mt-1" data-testid="cerrar-por-usuario-contado" /></div>
          <DialogFooter><Button variant="outline" onClick={() => { setCloseTarget(null); setCloseContado(""); }}>Cancelar</Button><Button onClick={cerrarPorUsuario} className="bg-[#C1401E] hover:bg-[#A03316]"><ArrowUpCircle className="w-4 h-4 mr-1" /> Confirmar cierre</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}