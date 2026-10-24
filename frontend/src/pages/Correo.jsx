import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, BLOB, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Archive, ArrowLeft, Download, Forward, Inbox, Loader2, Mail, MailOpen, Paperclip, PenSquare, RefreshCw, Reply,
  ReplyAll, Search, Send, Settings2, ShieldAlert, Star, Trash2, UserRound, X,
} from "lucide-react";

const ICONO_CARPETA = { inbox: Inbox, sent: Send, trash: Trash2, junk: ShieldAlert, archive: Archive, drafts: PenSquare };
const err = (e) => formatApiError(e?.response?.data?.detail) || "No se pudo completar la operación";

function fechaCorta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString()
    ? d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: d.getFullYear() !== hoy.getFullYear() ? "numeric" : undefined });
}
const nombreDe = (lista) => (lista?.[0]?.nombre || lista?.[0]?.email || "—");
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// HTML del correo en un iframe aislado: sin scripts ni formularios; solo
// imágenes https/data y estilos en línea (CSP).
function CuerpoHtml({ html }) {
  const ref = useRef(null);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:">
<style>body{font-family:Arial,sans-serif;font-size:14px;color:#1e293b;margin:0;padding:4px;word-wrap:break-word}img{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;
  const ajustar = () => {
    const f = ref.current;
    if (f?.contentDocument?.body) f.style.height = `${f.contentDocument.body.scrollHeight + 24}px`;
  };
  return <iframe ref={ref} title="Contenido del correo" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    srcDoc={doc} onLoad={ajustar} className="w-full min-h-[200px] border-0 bg-white" />;
}

function Redactar({ abierto, onClose, cuenta, base, onEnviado }) {
  const [f, setF] = useState({ para: "", cc: "", asunto: "", cuerpo: "" });
  const [archivos, setArchivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (abierto) { setF({ para: base?.para || "", cc: base?.cc || "", asunto: base?.asunto || "", cuerpo: base?.cuerpo || "" }); setArchivos([]); }
  }, [abierto, base]);
  const enviar = async () => {
    setEnviando(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      if (base?.responde) {
        fd.append("responde_uid", base.responde.uid); fd.append("responde_carpeta", base.responde.carpeta);
        fd.append("message_id", base.responde.message_id || ""); fd.append("references", base.responde.references || "");
      }
      archivos.forEach((a) => fd.append("adjuntos", a));
      await api.post(`/correo/${cuenta.id}/enviar`, fd);
      toast.success("Correo enviado");
      onEnviado?.();
      onClose();
    } catch (e) { toast.error(err(e)); }
    setEnviando(false);
  };
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !enviando && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="correo-redactar">
        <DialogHeader><DialogTitle className="font-display">{base?.titulo || "Nuevo correo"} <span className="text-sm font-normal text-slate-500">· desde {cuenta?.email}</span></DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs uppercase tracking-wider text-slate-500">Para</Label>
            <Input value={f.para} onChange={(e) => setF({ ...f, para: e.target.value })} placeholder="cliente@correo.com, otro@correo.com" data-testid="correo-para" /></div>
          <div><Label className="text-xs uppercase tracking-wider text-slate-500">CC</Label>
            <Input value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} /></div>
          <div><Label className="text-xs uppercase tracking-wider text-slate-500">Asunto</Label>
            <Input value={f.asunto} onChange={(e) => setF({ ...f, asunto: e.target.value })} data-testid="correo-asunto" /></div>
          <Textarea value={f.cuerpo} onChange={(e) => setF({ ...f, cuerpo: e.target.value })} rows={12} className="font-sans text-sm" data-testid="correo-cuerpo" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-3 h-9 text-sm text-slate-600 hover:bg-slate-50">
              <Paperclip className="h-4 w-4" /> Adjuntar
              <input type="file" multiple className="hidden" onChange={(e) => setArchivos([...archivos, ...Array.from(e.target.files || [])])} />
            </label>
            {archivos.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs">
                {a.name} · {kb(a.size)}
                <button onClick={() => setArchivos(archivos.filter((_, j) => j !== i))} aria-label={`Quitar ${a.name}`}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          {cuenta?.firma && <p className="text-xs text-slate-400">Se agrega tu firma al final del mensaje.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button onClick={enviar} disabled={enviando || !f.para.trim()} className="bg-brand-600 hover:bg-brand-700" data-testid="correo-enviar">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1.5 h-4 w-4" /> Enviar</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigCuentas({ abierto, onClose, onGuardado }) {
  const [cuentas, setCuentas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState("");
  useEffect(() => { if (abierto) api.get("/correo/cuentas").then((r) => setCuentas(r.data.map((c) => ({ ...c, password: "" })))).catch((e) => toast.error(err(e))); }, [abierto]);
  const set = (i, k, v) => setCuentas(cuentas.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const guardar = async () => {
    setGuardando(true);
    try {
      const { data } = await api.put("/correo/cuentas", { cuentas: cuentas.map((c) => ({ ...c, imap_port: Number(c.imap_port), smtp_port: Number(c.smtp_port) })) });
      setCuentas(data.map((c) => ({ ...c, password: "" })));
      toast.success("Cuentas guardadas");
      onGuardado?.();
    } catch (e) { toast.error(err(e)); }
    setGuardando(false);
  };
  const probar = async (c) => {
    setProbando(c.id);
    try { const { data } = await api.post(`/correo/cuentas/${c.id}/probar`); toast.success(`${c.email}: conexión correcta · ${data.no_leidos} sin leer`); }
    catch (e) { toast.error(err(e)); }
    setProbando("");
  };
  const campo = (i, k, label, props = {}) => (
    <div><Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label>
      <Input value={cuentas[i][k] ?? ""} onChange={(e) => set(i, k, e.target.value)} className="mt-1" {...props} /></div>
  );
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Cuentas de correo</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-500">Buzones de Hostinger (IMAP 993 / SMTP 465). La contraseña se guarda cifrada y no se vuelve a mostrar; déjala vacía para conservar la actual.</p>
        <div className="space-y-5">
          {cuentas.map((c, i) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="font-semibold">{c.nombre} <span className="font-normal text-slate-500">· {c.email}</span></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.activa !== false} onChange={(e) => set(i, "activa", e.target.checked)} /> Activa</label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {campo(i, "nombre", "Nombre de la bandeja")}
                {campo(i, "email", "Correo")}
                {campo(i, "usuario", "Usuario (normalmente el correo)")}
                <div><Label className="text-xs uppercase tracking-wider text-slate-500">Contraseña {c.password_guardada && <span className="normal-case text-emerald-600">✓ guardada</span>}</Label>
                  <Input type="password" value={c.password} onChange={(e) => set(i, "password", e.target.value)} placeholder={c.password_guardada ? "•••••• (sin cambios)" : "Contraseña del buzón"} className="mt-1" autoComplete="new-password" /></div>
                {campo(i, "imap_host", "Servidor IMAP")}
                {campo(i, "imap_port", "Puerto IMAP", { type: "number" })}
                {campo(i, "smtp_host", "Servidor SMTP")}
                {campo(i, "smtp_port", "Puerto SMTP", { type: "number" })}
                {campo(i, "nombre_remitente", "Nombre del remitente")}
                <div className="md:col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">Firma</Label>
                  <Textarea value={c.firma || ""} onChange={(e) => set(i, "firma", e.target.value)} rows={3} className="mt-1" placeholder={"Grupo RYSA · Ventas\n+52 916 141 29 42 · gruporysa.com"} /></div>
              </div>
              <div className="mt-3"><Button variant="outline" size="sm" onClick={() => probar(c)} disabled={!c.password_guardada || probando === c.id}>
                {probando === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Probar conexión"}</Button>
                {!c.password_guardada && <span className="ml-2 text-xs text-slate-400">Guarda la contraseña para poder probar.</span>}</div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button onClick={guardar} disabled={guardando} className="bg-brand-600 hover:bg-brand-700">{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Bandeja de ventas@ y contacto@: cuentas y carpetas · lista · lectura.
export default function Correo() {
  const { can } = useAuth();
  const [resumen, setResumen] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [cuentaId, setCuentaId] = useState("");
  const [carpetas, setCarpetas] = useState([]);
  const [carpeta, setCarpeta] = useState("INBOX");
  const [lista, setLista] = useState(null);
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [soloNoLeidos, setSoloNoLeidos] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [redactar, setRedactar] = useState(null);
  const [config, setConfig] = useState(false);

  const cuenta = useMemo(() => cuentas.find((c) => c.id === cuentaId), [cuentas, cuentaId]);
  const cargarCuentas = useCallback(async () => {
    try {
      const [{ data: cs }, { data: rs }] = await Promise.all([api.get("/correo/cuentas"), api.get("/correo/resumen")]);
      setCuentas(cs); setResumen(rs);
      setCuentaId((act) => act || (cs.find((c) => c.password_guardada && c.activa !== false) || cs[0])?.id || "");
    } catch (e) { setError(err(e)); }
  }, []);
  useEffect(() => { cargarCuentas(); }, [cargarCuentas]);

  const listo = cuenta && cuenta.password_guardada && cuenta.activa !== false;
  const cargarLista = useCallback(async () => {
    if (!listo) { setLista(null); return; }
    setCargando(true); setError("");
    try {
      const { data } = await api.get(`/correo/${cuenta.id}/mensajes`, { params: { carpeta, pagina, q: busqueda, no_leidos: soloNoLeidos } });
      setLista(data);
    } catch (e) { setError(err(e)); setLista(null); }
    setCargando(false);
  }, [listo, cuenta, carpeta, pagina, busqueda, soloNoLeidos]);
  useEffect(() => { cargarLista(); }, [cargarLista]);
  useEffect(() => {
    if (!listo) { setCarpetas([]); return; }
    api.get(`/correo/${cuenta.id}/carpetas`).then((r) => setCarpetas(r.data)).catch(() => setCarpetas([]));
  }, [listo, cuenta]);
  // Revisa correo nuevo cada 2 minutos mientras la pantalla está abierta.
  useEffect(() => { const t = setInterval(() => { cargarLista(); api.get("/correo/resumen").then((r) => setResumen(r.data)).catch(() => {}); }, 120000); return () => clearInterval(t); }, [cargarLista]);

  const abrir = async (m) => {
    setLeyendo(true); setAbierto({ ...m, cargando: true });
    try {
      const { data } = await api.get(`/correo/${cuenta.id}/mensajes/${m.uid}`, { params: { carpeta } });
      setAbierto(data);
      if (!m.leido) {
        setLista((l) => l && { ...l, mensajes: l.mensajes.map((x) => (x.uid === m.uid ? { ...x, leido: true } : x)) });
        setResumen((rs) => rs.map((r) => (r.id === cuenta.id && carpeta === "INBOX" && r.no_leidos ? { ...r, no_leidos: r.no_leidos - 1 } : r)));
      }
    } catch (e) { toast.error(err(e)); setAbierto(null); }
    setLeyendo(false);
  };

  const accion = async (uids, a) => {
    try {
      await api.post(`/correo/${cuenta.id}/acciones`, { uids, accion: a, carpeta });
      if (["papelera", "spam", "archivo"].includes(a)) { setAbierto(null); toast.success(a === "papelera" ? "Movido a la papelera" : a === "spam" ? "Marcado como spam" : "Archivado"); }
      cargarLista();
    } catch (e) { toast.error(err(e)); }
  };

  const citar = (m) => `\n\n\nEl ${new Date(m.fecha).toLocaleString("es-MX")}, ${nombreDe(m.de)} <${m.de?.[0]?.email}> escribió:\n` +
    (m.texto || (m.html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+\n/g, "\n")).split("\n").map((l) => `> ${l}`).join("\n");
  const responder = (todos) => {
    const m = abierto;
    const yo = cuenta.email.toLowerCase();
    const para = (m.responder_a?.length ? m.responder_a : m.de).map((d) => d.email);
    const cc = todos ? [...m.para, ...m.cc].map((d) => d.email).filter((e) => e !== yo && !para.includes(e)) : [];
    setRedactar({ titulo: todos ? "Responder a todos" : "Responder", para: para.join(", "), cc: cc.join(", "),
      asunto: /^re:/i.test(m.asunto) ? m.asunto : `Re: ${m.asunto}`, cuerpo: citar(m),
      responde: { uid: m.uid, carpeta, message_id: m.message_id, references: m.references } });
  };
  const reenviar = () => setRedactar({ titulo: "Reenviar", asunto: /^(rv|fwd?):/i.test(abierto.asunto) ? abierto.asunto : `RV: ${abierto.asunto}`, cuerpo: citar(abierto) });

  const totalPaginas = lista ? Math.max(1, Math.ceil(lista.total / lista.por_pagina)) : 1;

  return (
    <div className="space-y-4" data-testid="correo-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><Mail className="w-6 h-6 text-brand-600" /> Correo</h1>
          <p className="text-slate-500 text-sm">Bandejas de la empresa · los correos se leen directamente del servidor</p>
        </div>
        <div className="flex gap-2">
          {can("config") && <Button variant="outline" onClick={() => setConfig(true)} data-testid="correo-config"><Settings2 className="mr-1.5 h-4 w-4" /> Configurar cuentas</Button>}
          {listo && can("correo.enviar") && <Button onClick={() => setRedactar({})} className="bg-brand-600 hover:bg-brand-700" data-testid="correo-nuevo"><PenSquare className="mr-1.5 h-4 w-4" /> Redactar</Button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(320px,420px)_minmax(0,1fr)]">
        {/* Cuentas y carpetas */}
        <aside className="card-soft p-3 space-y-4 self-start">
          <div className="space-y-1">
            {cuentas.map((c) => {
              const r = resumen.find((x) => x.id === c.id);
              return (
                <button key={c.id} onClick={() => { setCuentaId(c.id); setCarpeta("INBOX"); setPagina(1); setAbierto(null); }}
                  className={`w-full rounded-md px-3 py-2 text-left transition-colors ${c.id === cuentaId ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{c.nombre}</span>
                    {r?.no_leidos > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{r.no_leidos}</span>}
                  </div>
                  <div className={`truncate text-xs ${c.id === cuentaId ? "text-white/70" : "text-slate-500"}`}>{c.email}</div>
                  {r?.error && <div className="mt-0.5 text-[11px] text-amber-600">{r.error}</div>}
                </button>
              );
            })}
          </div>
          {carpetas.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-0.5">
              {carpetas.map((f) => {
                const Ic = ICONO_CARPETA[f.especial] || Archive;
                return (
                  <button key={f.nombre} onClick={() => { setCarpeta(f.nombre); setPagina(1); setAbierto(null); }}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm ${carpeta === f.nombre ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}>
                    <Ic className="h-4 w-4 shrink-0" /> <span className="truncate">{f.etiqueta}</span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Lista */}
        <section className={`card-soft flex min-h-[60vh] flex-col overflow-hidden ${abierto ? "hidden xl:flex" : ""}`}>
          {!listo ? (
            <div className="m-auto max-w-sm p-8 text-center">
              <Mail className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm text-slate-600">{cuenta ? `Falta configurar la contraseña de ${cuenta.email}.` : "No hay cuentas de correo."}</p>
              {can("config") && <Button className="mt-4" variant="outline" onClick={() => setConfig(true)}>Configurar cuentas</Button>}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-slate-100 p-2">
                <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); setPagina(1); setBusqueda(q); }}>
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar remitente, asunto o texto…" className="h-9 pl-8" data-testid="correo-buscar" />
                </form>
                <button onClick={() => { setSoloNoLeidos((v) => !v); setPagina(1); }} title="Solo sin leer"
                  className={`h-9 rounded-md border px-2.5 text-xs font-medium ${soloNoLeidos ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 text-slate-600"}`}>Sin leer</button>
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={cargarLista} title="Actualizar"><RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /></Button>
              </div>
              {error && <p className="p-4 text-sm text-red-600">{error}</p>}
              <div className="flex-1 overflow-y-auto">
                {cargando && !lista && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>}
                {lista?.mensajes.length === 0 && <p className="p-10 text-center text-sm text-slate-400">Sin correos{busqueda ? " para esta búsqueda" : ""}.</p>}
                {lista?.mensajes.map((m) => (
                  <button key={m.uid} onClick={() => abrir(m)} data-testid={`correo-msg-${m.uid}`}
                    className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${abierto?.uid === m.uid ? "bg-brand-50/60" : ""}`}>
                    <div className="flex items-center gap-2">
                      {!m.leido && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Sin leer" />}
                      <span className={`flex-1 truncate text-sm ${m.leido ? "text-slate-600" : "font-bold text-slate-900"}`}>
                        {carpeta.toLowerCase().includes("sent") || carpetas.find((f) => f.nombre === carpeta)?.especial === "sent" ? `Para: ${nombreDe(m.para)}` : nombreDe(m.de)}
                      </span>
                      {m.adjuntos && <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                      {m.destacado && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                      <span className="shrink-0 text-xs text-slate-400">{fechaCorta(m.fecha)}</span>
                    </div>
                    <div className={`mt-0.5 truncate text-sm ${m.leido ? "text-slate-500" : "font-semibold text-slate-800"}`}>{m.asunto}</div>
                    {m.cliente && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><UserRound className="h-3 w-3" /> {m.cliente.nombre}</span>}
                  </button>
                ))}
              </div>
              {lista && lista.total > lista.por_pagina && (
                <div className="flex items-center justify-between border-t border-slate-100 p-2 text-xs text-slate-500">
                  <span>{(pagina - 1) * lista.por_pagina + 1}–{Math.min(pagina * lista.por_pagina, lista.total)} de {lista.total}</span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
                    <Button variant="outline" size="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina(pagina + 1)}>Siguiente</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* Lectura */}
        <section className={`card-soft min-h-[60vh] overflow-hidden ${abierto ? "" : "hidden xl:block"} lg:col-start-2 xl:col-start-auto`}>
          {!abierto ? (
            <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-slate-300"><MailOpen className="h-12 w-12" /><p className="mt-2 text-sm text-slate-400">Selecciona un correo para leerlo</p></div>
          ) : leyendo || abierto.cargando ? (
            <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 p-2">
                <Button variant="ghost" size="sm" className="xl:hidden" onClick={() => setAbierto(null)}><ArrowLeft className="mr-1 h-4 w-4" /> Volver</Button>
                {can("correo.enviar") && <>
                  <Button variant="ghost" size="sm" onClick={() => responder(false)} data-testid="correo-responder"><Reply className="mr-1 h-4 w-4" /> Responder</Button>
                  <Button variant="ghost" size="sm" onClick={() => responder(true)}><ReplyAll className="mr-1 h-4 w-4" /> A todos</Button>
                  <Button variant="ghost" size="sm" onClick={reenviar}><Forward className="mr-1 h-4 w-4" /> Reenviar</Button>
                </>}
                <span className="flex-1" />
                <Button variant="ghost" size="icon" title="Marcar como no leído" onClick={() => { accion([abierto.uid], "no_leido"); setAbierto(null); }}><Mail className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" title="Archivar" onClick={() => accion([abierto.uid], "archivo")}><Archive className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" title="Spam" onClick={() => accion([abierto.uid], "spam")}><ShieldAlert className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" title="Mover a la papelera" onClick={() => accion([abierto.uid], "papelera")}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <h2 className="font-display text-xl font-bold leading-snug text-slate-900">{abierto.asunto}</h2>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-2 text-sm">
                  <div>
                    <div><span className="font-semibold text-slate-900">{nombreDe(abierto.de)}</span> <span className="text-slate-500">&lt;{abierto.de?.[0]?.email}&gt;</span></div>
                    <div className="text-xs text-slate-500">Para: {abierto.para.map((d) => d.email).join(", ")}{abierto.cc.length > 0 && ` · CC: ${abierto.cc.map((d) => d.email).join(", ")}`}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    {abierto.fecha && new Date(abierto.fecha).toLocaleString("es-MX")}
                    {abierto.cliente && <div className="mt-1"><Link to="/app/clientes" className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 hover:underline"><UserRound className="h-3 w-3" /> Cliente: {abierto.cliente.nombre}</Link></div>}
                  </div>
                </div>
                {abierto.adjuntos.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {abierto.adjuntos.map((a) => (
                      <a key={a.indice} href={`${BLOB}/correo/${cuenta.id}/mensajes/${abierto.uid}/adjuntos/${a.indice}?carpeta=${encodeURIComponent(carpeta)}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                        <Download className="h-3.5 w-3.5" /> {a.nombre} <span className="text-slate-400">{kb(a.tamano)}</span>
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  {abierto.html ? <CuerpoHtml html={abierto.html} /> : <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{abierto.texto || "(sin contenido)"}</pre>}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {cuenta && <Redactar abierto={!!redactar} onClose={() => setRedactar(null)} cuenta={cuenta} base={redactar} onEnviado={cargarLista} />}
      <ConfigCuentas abierto={config} onClose={() => setConfig(false)} onGuardado={cargarCuentas} />
    </div>
  );
}
