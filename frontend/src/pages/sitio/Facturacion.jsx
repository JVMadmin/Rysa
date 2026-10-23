import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Download, FileText, Loader2, MessageCircle, Receipt, ShieldCheck } from "lucide-react";
import SitioLayout, { BOTON_CONTORNO, BOTON_PRIMARIO, useContacto } from "@/components/sitio/SitioLayout";
import { EASE, TitularPalabras } from "@/components/sitio/motion";
import { api, formatApiError, money } from "@/lib/api";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

// Catálogos SAT más usados por clientes de mostrador (CFDI 4.0).
const REGIMENES = [
  ["601", "601 · General de Ley Personas Morales"], ["603", "603 · Personas Morales con Fines no Lucrativos"],
  ["605", "605 · Sueldos y Salarios"], ["606", "606 · Arrendamiento"], ["612", "612 · Actividades Empresariales y Profesionales"],
  ["616", "616 · Sin obligaciones fiscales"], ["621", "621 · Incorporación Fiscal"], ["625", "625 · Plataformas Tecnológicas"],
  ["626", "626 · Régimen Simplificado de Confianza (RESICO)"],
];
const USOS = [
  ["G03", "G03 · Gastos en general"], ["G01", "G01 · Adquisición de mercancías"], ["I08", "I08 · Otra maquinaria y equipo"],
  ["S01", "S01 · Sin efectos fiscales"], ["CP01", "CP01 · Pagos"],
];

const CAMPO = "h-12 w-full rounded-sm border border-slate-300 bg-white px-3.5 text-[0.95rem] text-carbon-900 placeholder:text-slate-400 focus:border-carbon-900 focus:outline-none focus:ring-2 focus:ring-carbon-900/10";
const ETIQUETA = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-600";
const PASOS = ["Tu ticket", "Datos fiscales", "Factura"];

function Campo({ label, ayuda, children }) {
  return (
    <label className="block">
      <span className={ETIQUETA}>{label}</span>
      {children}
      {ayuda && <span className="mt-1.5 block text-xs leading-5 text-slate-500">{ayuda}</span>}
    </label>
  );
}

function Pasos({ paso }) {
  return (
    <ol className="flex items-center gap-3 text-xs sm:gap-4" aria-label="Pasos para facturar">
      {PASOS.map((p, i) => (
        <li key={p} className="flex items-center gap-3 sm:gap-4" aria-current={i === paso ? "step" : undefined}>
          <span className={`flex items-center gap-2 font-semibold uppercase tracking-[0.14em] ${i <= paso ? "text-white" : "text-slate-400"}`}>
            <span className={`flex h-7 w-7 items-center justify-center rounded-full border text-[0.7rem] ${i < paso ? "border-brand-500 bg-brand-500" : i === paso ? "border-white" : "border-white/25"}`}>
              {i < paso ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{p}</span>
          </span>
          {i < PASOS.length - 1 && <span className={`h-px w-6 sm:w-12 ${i < paso ? "bg-brand-500" : "bg-white/20"}`} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function Tarjeta({ children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.45, ease: EASE }} className="rounded-sm border border-slate-200 bg-white p-6 shadow-card-lg sm:p-9">
      {children}
    </motion.div>
  );
}

function Proximamente({ c }) {
  return (
    <Tarjeta>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Clock className="h-6 w-6" /></div>
      <h2 className="titular-fino mt-5 text-[1.8rem] text-carbon-900">Próximamente disponible</h2>
      <p className="mt-3 max-w-xl leading-7 text-slate-600">
        Muy pronto podrás generar la factura de tu compra aquí mismo, solo con el folio y el total de tu ticket.
        Mientras tanto, envíanos tu ticket y tu Constancia de Situación Fiscal y te la hacemos llegar.
      </p>
      {c.waUrl && (
        <a href={`${c.waUrl}?text=${encodeURIComponent("Hola, quiero facturar mi compra. Les comparto mi ticket y mis datos fiscales.")}`}
          target="_blank" rel="noreferrer" className={`${BOTON_PRIMARIO} mt-7`}>
          <MessageCircle className="h-4 w-4" /> Facturar por WhatsApp
        </a>
      )}
    </Tarjeta>
  );
}

// Autofacturación: el cliente identifica su compra con el folio y el total
// impresos en el ticket, captura sus datos fiscales y descarga su CFDI.
export default function Facturacion() {
  const c = useContacto();
  const [estado, setEstado] = useState(null);
  const [paso, setPaso] = useState(0);
  const [ticket, setTicket] = useState({ folio: "", total: "" });
  const [venta, setVenta] = useState(null);
  const [fiscal, setFiscal] = useState({ rfc: "", razon_social: "", cp: "", reg_fiscal: "", uso_cfdi: "G03", email: "" });
  const [factura, setFactura] = useState(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = "Facturación — Grupo RYSA";
    api.get("/publico/factura/estado").then((r) => setEstado(r.data)).catch(() => setEstado({ disponible: false }));
  }, []);

  const datosTicket = () => ({ folio: ticket.folio.trim(), total: Number(String(ticket.total).replace(/[$,\s]/g, "")) });
  const descarga = (id, fmt) => {
    const t = datosTicket();
    return `${API}/publico/factura/${id}/${fmt}?folio=${encodeURIComponent(venta?.folio || t.folio)}&total=${t.total}`;
  };

  const buscar = async (e) => {
    e.preventDefault();
    setError(""); setOcupado(true);
    try {
      const r = await api.post("/publico/factura/ticket", datosTicket());
      setVenta(r.data);
      if (r.data.facturado && r.data.cfdi) { setFactura({ cfdi_id: r.data.cfdi.id, uuid: r.data.cfdi.uuid, previa: true }); setPaso(2); }
      else setPaso(1);
    } catch (err) { setError(formatApiError(err)); }
    setOcupado(false);
  };

  const emitir = async (e) => {
    e.preventDefault();
    setError(""); setOcupado(true);
    try {
      const r = await api.post("/publico/factura/emitir", { ...datosTicket(), folio: venta.folio, ...fiscal });
      setFactura(r.data); setPaso(2);
    } catch (err) { setError(formatApiError(err)); }
    setOcupado(false);
  };

  const reiniciar = () => { setPaso(0); setVenta(null); setFactura(null); setError(""); setTicket({ folio: "", total: "" }); };
  const f = (k) => (e) => setFiscal({ ...fiscal, [k]: k === "rfc" ? e.target.value.toUpperCase() : e.target.value });

  return (
    <SitioLayout>
      <section aria-labelledby="fact-titulo" className="grafito grano relative text-white">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1240px] px-5 pb-24 pt-[7.5rem] sm:px-8 sm:pb-32 sm:pt-[8.5rem]">
          <nav aria-label="Ruta" className="text-sm text-slate-300">
            <Link to="/" className="hover:text-white">Inicio</Link> <span aria-hidden="true">/</span> <span className="text-white">Facturación</span>
          </nav>
          <TitularPalabras id="fact-titulo" texto="Factura tu compra" palabra="metal" className="titular-fino mt-8 text-[2.4rem] sm:text-[3.4rem]" />
          <p className="mt-4 max-w-xl text-[1.05rem] leading-7 text-slate-300">
            Genera tu CFDI 4.0 en minutos con el folio y el total de tu ticket. Tu factura se timbra al momento y la descargas en PDF y XML.
          </p>
          {estado?.disponible && <div className="mt-9"><Pasos paso={paso} /></div>}
        </div>
      </section>

      <section className="relative mx-auto -mt-14 max-w-[1240px] px-5 pb-20 sm:-mt-20 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            {!estado && <div className="flex justify-center rounded-sm border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>}
            {estado && !estado.disponible && <Proximamente c={c} />}
            {estado?.disponible && (
              <AnimatePresence mode="wait">
                {paso === 0 && (
                  <Tarjeta key="ticket">
                    <h2 className="titular-fino text-[1.6rem] text-carbon-900">Busca tu ticket</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">Los dos datos vienen impresos en tu ticket de compra.</p>
                    <form onSubmit={buscar} className="mt-7 grid gap-5 sm:grid-cols-2">
                      <Campo label="Folio del ticket" ayuda="Ejemplo: V000123">
                        <input required value={ticket.folio} onChange={(e) => setTicket({ ...ticket, folio: e.target.value.toUpperCase() })}
                          className={`${CAMPO} font-display tracking-wider`} placeholder="V000123" autoComplete="off" data-testid="fact-folio" />
                      </Campo>
                      <Campo label="Total pagado" ayuda="Con IVA, tal como aparece en el ticket">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                          <input required inputMode="decimal" value={ticket.total} onChange={(e) => setTicket({ ...ticket, total: e.target.value })}
                            className={`${CAMPO} pl-7 font-display`} placeholder="0.00" autoComplete="off" data-testid="fact-total" />
                        </div>
                      </Campo>
                      {error && <p role="alert" className="text-sm text-brand-700 sm:col-span-2">{error}</p>}
                      <div className="sm:col-span-2">
                        <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO} data-testid="fact-buscar">
                          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continuar <ArrowRight className="h-4 w-4" /></>}
                        </button>
                      </div>
                    </form>
                  </Tarjeta>
                )}

                {paso === 1 && venta && (
                  <Tarjeta key="fiscal">
                    <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Ticket {venta.folio}</div>
                        <div className="mt-1 text-sm text-slate-600">{venta.fecha ? new Date(venta.fecha).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : ""} · {venta.items.length} artículo{venta.items.length === 1 ? "" : "s"}</div>
                      </div>
                      <div className="font-display text-3xl font-bold text-carbon-900">{money(venta.total)}</div>
                    </div>
                    {!venta.del_mes ? (
                      <div className="mt-6 rounded-sm bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                        Este ticket es de un mes anterior. Por disposición del SAT ya no puede facturarse en línea; escríbenos y lo revisamos contigo.
                        {c.waUrl && <a href={c.waUrl} target="_blank" rel="noreferrer" className="ml-1 font-semibold underline">WhatsApp</a>}
                      </div>
                    ) : (
                      <form onSubmit={emitir} className="mt-7 grid gap-5 sm:grid-cols-2">
                        <Campo label="RFC" ayuda="12 caracteres (empresa) o 13 (persona física)">
                          <input required maxLength={13} value={fiscal.rfc} onChange={f("rfc")} className={`${CAMPO} font-display tracking-wider`} placeholder="Como en tu Constancia" autoComplete="off" data-testid="fact-rfc" />
                        </Campo>
                        <Campo label="Código postal fiscal" ayuda="El de tu Constancia de Situación Fiscal">
                          <input required inputMode="numeric" maxLength={5} value={fiscal.cp} onChange={(e) => setFiscal({ ...fiscal, cp: e.target.value.replace(/\D/g, "") })} className={CAMPO} placeholder="86000" data-testid="fact-cp" />
                        </Campo>
                        <div className="sm:col-span-2">
                          <Campo label="Nombre o razón social" ayuda="Exactamente como en tu Constancia, sin «S.A. de C.V.» ni el régimen societario">
                            <input required value={fiscal.razon_social} onChange={f("razon_social")} className={`${CAMPO} uppercase`} data-testid="fact-razon" />
                          </Campo>
                        </div>
                        <Campo label="Régimen fiscal">
                          <select required value={fiscal.reg_fiscal} onChange={f("reg_fiscal")} className={CAMPO} data-testid="fact-regimen">
                            <option value="" disabled>Selecciona…</option>
                            {REGIMENES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                        </Campo>
                        <Campo label="Uso del CFDI">
                          <select required value={fiscal.uso_cfdi} onChange={f("uso_cfdi")} className={CAMPO} data-testid="fact-uso">
                            {USOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                        </Campo>
                        <div className="sm:col-span-2">
                          <Campo label="Correo electrónico (opcional)" ayuda="Para enviarte una copia de tu factura">
                            <input type="email" value={fiscal.email} onChange={f("email")} className={CAMPO} placeholder="tucorreo@ejemplo.com" autoComplete="email" />
                          </Campo>
                        </div>
                        {error && <p role="alert" className="text-sm text-brand-700 sm:col-span-2">{error}</p>}
                        <div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:items-center">
                          <button type="button" onClick={reiniciar} className="inline-flex h-12 items-center gap-2 text-sm text-slate-600 hover:text-carbon-900">
                            <ArrowLeft className="h-4 w-4" /> Otro ticket
                          </button>
                          <button type="submit" disabled={ocupado} className={`${BOTON_PRIMARIO} sm:ml-auto`} data-testid="fact-emitir">
                            {ocupado ? <><Loader2 className="h-4 w-4 animate-spin" /> Timbrando…</> : <><Receipt className="h-4 w-4" /> Generar factura</>}
                          </button>
                        </div>
                      </form>
                    )}
                  </Tarjeta>
                )}

                {paso === 2 && factura && (
                  <Tarjeta key="lista">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-6 w-6" /></div>
                    <h2 className="titular-fino mt-5 text-[1.8rem] text-carbon-900">{factura.previa ? "Este ticket ya está facturado" : "¡Tu factura está lista!"}</h2>
                    {factura.uuid && <p className="mt-3 break-all text-sm text-slate-600">Folio fiscal (UUID): <span className="font-display text-carbon-900">{factura.uuid}</span></p>}
                    <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                      <a href={descarga(factura.cfdi_id, "pdf")} className={BOTON_PRIMARIO}><Download className="h-4 w-4" /> Descargar PDF</a>
                      <a href={descarga(factura.cfdi_id, "xml")} className={BOTON_CONTORNO}><span className="relative inline-flex items-center gap-2"><FileText className="h-4 w-4" /> Descargar XML</span></a>
                    </div>
                    <button type="button" onClick={reiniciar} className="mt-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-carbon-900">
                      <ArrowLeft className="h-4 w-4" /> Facturar otro ticket
                    </button>
                  </Tarjeta>
                )}
              </AnimatePresence>
            )}
          </div>

          <aside className="space-y-4 lg:pt-0">
            <div className="rounded-sm bg-[#F6F5F2] p-6">
              <h2 className="etiqueta text-carbon-900">Antes de empezar</h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
                <li className="flex gap-3"><span className="mt-2.5 h-px w-3 shrink-0 bg-brand-600" />Ten a la mano tu ticket y tu Constancia de Situación Fiscal.</li>
                <li className="flex gap-3"><span className="mt-2.5 h-px w-3 shrink-0 bg-brand-600" />Factura dentro del mismo mes de tu compra.</li>
                <li className="flex gap-3"><span className="mt-2.5 h-px w-3 shrink-0 bg-brand-600" />Nombre, RFC, régimen y código postal deben coincidir con el SAT.</li>
              </ul>
            </div>
            <div className="flex items-start gap-3 rounded-sm border border-slate-200 p-6 text-sm leading-6 text-slate-600">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-carbon-900" />
              <p>Facturas CFDI 4.0 timbradas por un proveedor autorizado por el SAT. Solo usamos tus datos para emitir tu factura.</p>
            </div>
            {c.waUrl && (
              <a href={c.waUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-sm border border-slate-200 p-6 text-sm text-slate-700 transition-colors hover:border-carbon-900">
                <MessageCircle className="h-5 w-5 text-brand-600" /> ¿Dudas con tu factura? Escríbenos por WhatsApp
              </a>
            )}
          </aside>
        </div>
      </section>
    </SitioLayout>
  );
}
