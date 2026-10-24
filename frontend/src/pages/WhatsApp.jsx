import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, BLOB, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  AlertTriangle, Bot, CheckCircle2, FlaskConical, Hand, Loader2, MessageCircle, QrCode, RefreshCw, Search, Send,
  Smartphone, UserRound, Unplug,
} from "lucide-react";

const err = (e) => formatApiError(e?.response?.data?.detail) || "No se pudo completar la operación";
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const hora = (iso) => (iso ? new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const ESTADOS = {
  WORKING: ["Conectado", "text-emerald-700 bg-emerald-50"], SCAN_QR_CODE: ["Esperando escaneo del QR", "text-amber-700 bg-amber-50"],
  STARTING: ["Iniciando…", "text-sky-700 bg-sky-50"], STOPPED: ["Detenido", "text-slate-600 bg-slate-100"],
  FAILED: ["Falló la conexión", "text-red-700 bg-red-50"], SIN_SESION: ["Sin vincular", "text-slate-600 bg-slate-100"],
  NO_INSTALADO: ["Servicio no instalado", "text-red-700 bg-red-50"], ERROR: ["Error", "text-red-700 bg-red-50"],
};

// ───────────────────────────── Bandeja ─────────────────────────────
function Bandeja({ puedeResponder }) {
  const [convs, setConvs] = useState([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [notas, setNotas] = useState("");
  const fin = useRef(null);

  const cargar = useCallback(() => api.get("/whatsapp/conversaciones", { params: { q } }).then((r) => setConvs(r.data)).catch(() => {}), [q]);
  const cargarMsgs = useCallback(async (id) => {
    const { data } = await api.get(`/whatsapp/conversaciones/${encodeURIComponent(id)}/mensajes`);
    setMsgs(data);
    setTimeout(() => fin.current?.scrollIntoView({ block: "end" }), 50);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  // Actualiza cada 8 s mientras la pantalla está abierta.
  useEffect(() => {
    const t = setInterval(() => { cargar(); if (sel) cargarMsgs(sel.id).catch(() => {}); }, 8000);
    return () => clearInterval(t);
  }, [cargar, cargarMsgs, sel]);

  const abrir = async (c) => { setSel(c); setNotas(c.notas || ""); try { await cargarMsgs(c.id); cargar(); } catch (e) { toast.error(err(e)); } };
  const actual = useMemo(() => convs.find((c) => c.id === sel?.id) || sel, [convs, sel]);

  const enviar = async () => {
    if (!texto.trim()) return;
    setEnviando(true);
    try { await api.post(`/whatsapp/conversaciones/${encodeURIComponent(sel.id)}/enviar`, { texto }); setTexto(""); await cargarMsgs(sel.id); cargar(); }
    catch (e) { toast.error(err(e)); }
    setEnviando(false);
  };
  const cambiar = async (cambios) => {
    try { const { data } = await api.patch(`/whatsapp/conversaciones/${encodeURIComponent(sel.id)}`, cambios); setSel(data); cargar(); toast.success("Guardado"); }
    catch (e) { toast.error(err(e)); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <section className={`card-soft flex min-h-[65vh] flex-col overflow-hidden ${sel ? "hidden lg:flex" : ""}`}>
        <div className="border-b border-slate-100 p-2">
          <div className="relative"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, teléfono o mensaje" className="h-9 pl-8" /></div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convs.length === 0 && <p className="p-8 text-center text-sm text-slate-400">Aún no hay conversaciones.</p>}
          {convs.map((c) => (
            <button key={c.id} onClick={() => abrir(c)} className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50 ${sel?.id === c.id ? "bg-emerald-50/60" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`flex-1 truncate text-sm ${c.no_leidos ? "font-bold text-slate-900" : "text-slate-700"}`}>{c.nombre || `+${c.telefono}`}</span>
                {c.atencion && <AlertTriangle className="h-4 w-4 text-amber-500" title="Requiere un asesor" />}
                {c.modo === "bot" ? <Bot className="h-3.5 w-3.5 text-emerald-600" title="Atiende el agente" /> : <Hand className="h-3.5 w-3.5 text-sky-600" title="Atiende una persona" />}
                <span className="text-[11px] text-slate-400">{hora(c.ultimo_fecha)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="flex-1 truncate text-xs text-slate-500">{c.ultimo}</span>
                {c.no_leidos > 0 && <span className="rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold text-white">{c.no_leidos}</span>}
              </div>
              {c.cliente_nombre && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"><UserRound className="h-3 w-3" /> {c.cliente_nombre}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className={`card-soft flex min-h-[65vh] flex-col overflow-hidden ${sel ? "" : "hidden lg:flex"}`}>
        {!actual ? (
          <div className="m-auto text-center text-slate-300"><MessageCircle className="mx-auto h-12 w-12" /><p className="mt-2 text-sm text-slate-400">Selecciona una conversación</p></div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
              <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSel(null)}>←</Button>
              <div className="flex-1 min-w-0">
                <div className="truncate font-semibold">{actual.nombre || `+${actual.telefono}`}</div>
                <div className="text-xs text-slate-500">+{actual.telefono}{actual.cliente_nombre ? ` · Cliente: ${actual.cliente_nombre}` : ""}</div>
              </div>
              {actual.modo === "bot"
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><Bot className="h-3.5 w-3.5" /> Atiende el agente</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700"><Hand className="h-3.5 w-3.5" /> Atiende una persona</span>}
              {puedeResponder && (actual.modo === "bot"
                ? <Button size="sm" variant="outline" onClick={() => cambiar({ modo: "humano" })}><Hand className="mr-1 h-4 w-4" /> Tomar conversación</Button>
                : <Button size="sm" variant="outline" onClick={() => cambiar({ modo: "bot" })}><Bot className="mr-1 h-4 w-4" /> Regresar al agente</Button>)}
            </div>
            {actual.atencion && <div className="flex items-center gap-2 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle className="h-4 w-4" /> Requiere un asesor: {actual.motivo_humano}</div>}
            {actual.ultimo_error && <div className="bg-red-50 px-3 py-2 text-xs text-red-700">Último error del agente: {actual.ultimo_error}</div>}
            <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-4">
              {msgs.map((m) => (
                <div key={m.id} className={`flex ${m.origen === "cliente" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.origen === "cliente" ? "bg-white" : m.origen === "bot" ? "bg-[#d9fdd3]" : "bg-[#cfe9ff]"}`}>
                    <div className="whitespace-pre-wrap break-words text-slate-800">{m.texto}</div>
                    <div className="mt-1 text-right text-[10px] text-slate-500">{m.origen === "bot" ? "Agente RYSA · " : m.origen === "humano" ? `${m.usuario || "Asesor"} · ` : ""}{hora(m.fecha)}</div>
                  </div>
                </div>
              ))}
              <div ref={fin} />
            </div>
            {puedeResponder && (
              <div className="flex gap-2 border-t border-slate-100 p-2">
                <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Escribe una respuesta (el agente se pausa en este chat)"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} className="min-h-[44px] resize-none" />
                <Button onClick={enviar} disabled={enviando || !texto.trim()} className="h-auto bg-emerald-600 hover:bg-emerald-700">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
              </div>
            )}
            {puedeResponder && (
              <details className="border-t border-slate-100 p-3 text-sm">
                <summary className="cursor-pointer text-slate-600">Memoria de este contacto (el agente la lee en cada respuesta)</summary>
                <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className="mt-2" placeholder="Ej. Tiene taquería en el centro; compra vasos térmicos 12 oz cada semana; prefiere entrega en sábado." />
                <Button size="sm" className="mt-2" variant="outline" onClick={() => cambiar({ notas })}>Guardar memoria</Button>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ───────────────────────────── Conexión ─────────────────────────────
function Conexion() {
  const [est, setEst] = useState(null);
  const [qrTs, setQrTs] = useState(0);
  const [busy, setBusy] = useState(false);
  const cargar = useCallback(() => api.get("/whatsapp/estado").then((r) => setEst(r.data)).catch((e) => setEst({ status: "ERROR", detalle: err(e) })), []);
  useEffect(() => { cargar(); const t = setInterval(() => { cargar(); setQrTs(Date.now()); }, 5000); return () => clearInterval(t); }, [cargar]);
  const conectar = async () => { setBusy(true); try { await api.post("/whatsapp/conectar"); toast.success("Iniciando… escanea el QR"); cargar(); } catch (e) { toast.error(err(e)); } setBusy(false); };
  const desconectar = async () => { if (!window.confirm("¿Desvincular el número de WhatsApp del ERP?")) return; setBusy(true); try { await api.post("/whatsapp/desconectar"); cargar(); } catch (e) { toast.error(err(e)); } setBusy(false); };
  const [txt, cls] = ESTADOS[est?.status] || [est?.status || "…", "text-slate-600 bg-slate-100"];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card-soft p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold flex items-center gap-2"><Smartphone className="h-5 w-5" /> Número vinculado</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{txt}</span>
        </div>
        {est?.status === "WORKING" && <p className="text-sm"><b>+{est.numero}</b> {est.nombre && `· ${est.nombre}`}</p>}
        {est?.detalle && <p className="text-sm text-red-600">{est.detalle}</p>}
        <div className="flex flex-wrap gap-2">
          {est?.status !== "WORKING" && est?.instalado && <Button onClick={conectar} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700"><QrCode className="mr-1.5 h-4 w-4" /> Vincular / mostrar QR</Button>}
          {est?.status === "WORKING" && <Button variant="outline" onClick={desconectar} disabled={busy}><Unplug className="mr-1.5 h-4 w-4" /> Desvincular</Button>}
          <Button variant="outline" onClick={cargar}><RefreshCw className="mr-1.5 h-4 w-4" /> Actualizar</Button>
        </div>
        <div className="rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <b>Importante:</b> esta conexión usa WhatsApp Web, no la API oficial de Meta. WhatsApp puede bloquear el número si detecta automatización.
          Usa un número dedicado (no el personal), deja que el agente solo responda a quien escribe y no envíes mensajes masivos.
        </div>
      </div>
      <div className="card-soft flex flex-col items-center justify-center p-5 text-center">
        {est?.status === "SCAN_QR_CODE" ? (
          <>
            <img src={`${BLOB}/whatsapp/qr?t=${qrTs}`} alt="Código QR de WhatsApp" className="h-64 w-64 rounded-md border border-slate-200 bg-white p-2" />
            <p className="mt-3 max-w-xs text-sm text-slate-600">En el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo, y escanea este código. Se renueva solo.</p>
          </>
        ) : est?.status === "WORKING" ? (
          <><CheckCircle2 className="h-14 w-14 text-emerald-500" /><p className="mt-2 text-sm text-slate-600">WhatsApp está conectado al ERP.</p></>
        ) : (
          <><QrCode className="h-14 w-14 text-slate-300" /><p className="mt-2 text-sm text-slate-500">El código QR aparece aquí al vincular.</p></>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── Agente ─────────────────────────────
function Agente() {
  const [c, setC] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [prueba, setPrueba] = useState([]);
  const [pTexto, setPTexto] = useState("");
  const [probando, setProbando] = useState(false);
  const [ultimaInfo, setUltimaInfo] = useState(null);
  useEffect(() => { api.get("/whatsapp/agente").then((r) => setC(r.data)).catch((e) => toast.error(err(e))); }, []);
  if (!c) return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></div>;
  const set = (k, v) => setC({ ...c, [k]: v });
  const guardar = async () => {
    setGuardando(true);
    try { const { data } = await api.put("/whatsapp/agente", { ...c, api_key: apiKey }); setC(data); setApiKey(""); toast.success("Agente guardado"); }
    catch (e) { toast.error(err(e)); }
    setGuardando(false);
  };
  const preset = (k) => { const p = c.presets[k]; setC({ ...c, proveedor_preset: k, proveedor: p.proveedor, base_url: p.base_url, modelo: p.modelo }); };
  const probar = async () => {
    if (!pTexto.trim()) return;
    const conv = [...prueba, { rol: "cliente", texto: pTexto }];
    setPrueba(conv); setPTexto(""); setProbando(true);
    try { const { data } = await api.post("/whatsapp/agente/probar", { mensajes: conv }); setPrueba([...conv, { rol: "agente", texto: data.respuesta + (data.pasa_a_humano ? "\n\n(→ pasaría a un asesor)" : "") }]); setUltimaInfo(data); }
    catch (e) { toast.error(err(e)); setPrueba(conv.slice(0, -1)); }
    setProbando(false);
  };
  const campo = (k, label, props = {}) => (
    <div><Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label><Input value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="mt-1" {...props} /></div>
  );
  const area = (k, label, rows = 4, ph = "") => (
    <div><Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label><Textarea value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} rows={rows} className="mt-1" placeholder={ph} /></div>
  );
  const check = (k, label) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c[k]} onChange={(e) => set(k, e.target.checked)} className="h-4 w-4 accent-emerald-600" /> {label}</label>;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <div className="card-soft p-5 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-3"><input type="checkbox" checked={!!c.activo} onChange={(e) => set("activo", e.target.checked)} className="h-5 w-5 accent-emerald-600" />
            <span><span className="font-semibold">Agente activo</span><span className="block text-xs text-slate-500">Apagado, los mensajes llegan a la bandeja y nadie contesta automáticamente.</span></span></label>
          <Button onClick={guardar} disabled={guardando} className="bg-emerald-600 hover:bg-emerald-700">{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar agente"}</Button>
        </div>

        <details open className="card-soft p-5"><summary className="cursor-pointer font-display text-lg font-bold">Personalidad y forma de contestar</summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {campo("nombre_agente", "Nombre del agente")}
            {campo("tono", "Tono")}
            <div className="md:col-span-2">{area("instrucciones", "Instrucciones principales (comportamiento)", 5)}</div>
            <div className="md:col-span-2">{area("reglas_extra", "Reglas adicionales", 3, "Ej. Nunca ofrezcas descuentos. Pide siempre la colonia para la entrega.")}</div>
            {campo("max_caracteres", "Máximo de caracteres por respuesta", { type: "number" })}
            {campo("link_catalogo", "Enlace del catálogo")}
          </div>
        </details>

        <details className="card-soft p-5"><summary className="cursor-pointer font-display text-lg font-bold">Memoria y conocimiento</summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">{area("conocimiento", "Información del negocio (preguntas frecuentes, políticas, entregas, pagos)", 8)}</div>
            {campo("historial_mensajes", "Mensajes de la conversación que recuerda", { type: "number" })}
            {campo("productos_contexto", "Productos del inventario que consulta por respuesta", { type: "number" })}
            {check("permitir_precios", "Puede dar precios del inventario (Precio 1 con IVA)")}
            {check("mostrar_existencias", "Puede decir si hay existencia")}
          </div>
          <p className="mt-3 text-xs text-slate-500">Cada contacto tiene además su propia memoria, editable en la bandeja.</p>
        </details>

        <details className="card-soft p-5"><summary className="cursor-pointer font-display text-lg font-bold">Comportamiento humano y límites</summary>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {campo("retraso_min", "Espera mínima antes de contestar (s)", { type: "number" })}
            {campo("retraso_max", "Espera máxima (s)", { type: "number" })}
            {campo("limite_por_hora", "Respuestas máximas por contacto por hora", { type: "number" })}
            <div className="md:col-span-3">{check("simular_escribiendo", "Mostrar \"escribiendo…\" antes de cada respuesta")}</div>
            <div className="md:col-span-3">{area("palabras_humano", "Palabras que pasan la conversación a un asesor (separadas por coma)", 2)}</div>
            <div className="md:col-span-2">{area("mensaje_humano", "Mensaje al pasar con un asesor", 2)}</div>
            {campo("horas_regreso_bot", "Horas para que el agente retome un chat atendido por una persona (0 = nunca)", { type: "number" })}
            <div className="md:col-span-3">{area("mensaje_error", "Mensaje si la IA no responde", 2)}</div>
            <div className="md:col-span-3">{area("bloqueados", "Números que el agente nunca contesta (uno por línea)", 2)}</div>
          </div>
        </details>

        <details className="card-soft p-5"><summary className="cursor-pointer font-display text-lg font-bold">Horario</summary>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">{DIAS.map((d, i) => {
              const on = (c.horario_dias || []).includes(i);
              return <button key={d} type="button" onClick={() => set("horario_dias", on ? c.horario_dias.filter((x) => x !== i) : [...(c.horario_dias || []), i].sort())}
                className={`h-9 w-14 rounded-md border text-sm ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 text-slate-600"}`}>{d}</button>;
            })}</div>
            <div className="grid gap-3 md:grid-cols-3">
              {campo("horario_inicio", "Abre", { type: "time" })}
              {campo("horario_fin", "Cierra", { type: "time" })}
              <div className="flex items-end">{check("responder_fuera_horario", "Contestar también fuera de horario")}</div>
            </div>
            {area("mensaje_fuera_horario", "Aviso fuera de horario", 2)}
          </div>
        </details>

        <details open className="card-soft p-5"><summary className="cursor-pointer font-display text-lg font-bold">Inteligencia artificial</summary>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">{Object.keys(c.presets || {}).map((k) => (
              <button key={k} type="button" onClick={() => preset(k)} className={`h-9 rounded-md border px-3 text-sm capitalize ${c.proveedor_preset === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{k}</button>
            ))}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label className="text-xs uppercase tracking-wider text-slate-500">Tipo de API</Label>
                <select value={c.proveedor} onChange={(e) => set("proveedor", e.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                  <option value="openai">Compatible con OpenAI (Groq, Gemini, OpenRouter, Ollama…)</option><option value="anthropic">Anthropic (Claude)</option></select></div>
              {campo("modelo", "Modelo")}
              <div className="md:col-span-2">{campo("base_url", "URL de la API")}</div>
              <div className="md:col-span-2"><Label className="text-xs uppercase tracking-wider text-slate-500">API key {c.api_key_guardada && <span className="normal-case text-emerald-600">✓ guardada</span>}</Label>
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={c.api_key_guardada ? "•••••• (sin cambios)" : "Pega aquí la llave del proveedor"} className="mt-1" autoComplete="new-password" /></div>
              {campo("temperatura", "Creatividad / temperatura (0 a 1)", { type: "number", step: "0.1", min: 0, max: 1 })}
              {campo("max_tokens", "Máximo de tokens por respuesta", { type: "number" })}
              {campo("top_p", "top_p (opcional)", { type: "number", step: "0.05", min: 0, max: 1 })}
            </div>
            <p className="text-xs text-slate-500">Los modelos sugeridos se pueden cambiar; revisa en el sitio del proveedor qué modelos y límites gratuitos tiene vigentes.</p>
          </div>
        </details>
        <div className="flex justify-end"><Button onClick={guardar} disabled={guardando} className="bg-emerald-600 hover:bg-emerald-700">{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar agente"}</Button></div>
      </div>

      <aside className="card-soft flex h-fit flex-col overflow-hidden xl:sticky xl:top-4">
        <div className="border-b border-slate-100 p-3 font-semibold flex items-center gap-2"><FlaskConical className="h-4 w-4 text-emerald-600" /> Probar el agente</div>
        <p className="px-3 pt-2 text-xs text-slate-500">Usa la configuración guardada y el inventario real; no envía nada por WhatsApp.</p>
        <div className="min-h-[300px] max-h-[55vh] flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-3 mt-2">
          {prueba.map((m, i) => (
            <div key={i} className={`flex ${m.rol === "cliente" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm ${m.rol === "cliente" ? "bg-[#d9fdd3]" : "bg-white"}`}>{m.texto}</div>
            </div>
          ))}
          {probando && <div className="text-xs text-slate-500">El agente está escribiendo…</div>}
        </div>
        {ultimaInfo && <div className="border-t border-slate-100 p-2 text-[11px] text-slate-500">Consultó {ultimaInfo.productos.length} producto(s) · {ultimaInfo.en_horario ? "en horario" : "fuera de horario"}</div>}
        <div className="flex gap-2 border-t border-slate-100 p-2">
          <Input value={pTexto} onChange={(e) => setPTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && probar()} placeholder="Escribe como cliente…" />
          <Button onClick={probar} disabled={probando} className="bg-emerald-600 hover:bg-emerald-700"><Send className="h-4 w-4" /></Button>
        </div>
        {prueba.length > 0 && <button onClick={() => { setPrueba([]); setUltimaInfo(null); }} className="p-2 text-xs text-slate-500 hover:underline">Reiniciar prueba</button>}
      </aside>
    </div>
  );
}

export default function WhatsApp() {
  const { can } = useAuth();
  const admin = can("config");
  return (
    <div className="space-y-4" data-testid="whatsapp-page">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2"><MessageCircle className="w-6 h-6 text-emerald-600" /> WhatsApp · Agente RYSA</h1>
        <p className="text-slate-500 text-sm">Conversaciones de WhatsApp atendidas por el agente con IA y por el equipo</p>
      </div>
      <Tabs defaultValue="bandeja">
        <TabsList>
          <TabsTrigger value="bandeja">Bandeja</TabsTrigger>
          {admin && <TabsTrigger value="agente">Agente RYSA</TabsTrigger>}
          {admin && <TabsTrigger value="conexion">Conexión</TabsTrigger>}
        </TabsList>
        <TabsContent value="bandeja" className="pt-3"><Bandeja puedeResponder={can("whatsapp.responder")} /></TabsContent>
        {admin && <TabsContent value="agente" className="pt-3"><Agente /></TabsContent>}
        {admin && <TabsContent value="conexion" className="pt-3"><Conexion /></TabsContent>}
      </Tabs>
    </div>
  );
}
