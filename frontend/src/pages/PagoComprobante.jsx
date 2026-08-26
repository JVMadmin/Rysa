import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, MessageCircle, Upload, FileText } from "lucide-react";

/**
 * PÁGINA PÚBLICA (sin login): recepción de comprobante de pago de una
 * cotización vía QR (§4-6, §21-22). Mobile-first, branding RYSA.
 * Solo revela folio/cliente/importe; valida token en cada paso.
 */
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const METODOS = [
  ["transferencia", "Transferencia"],
  ["deposito", "Depósito"],
  ["tarjeta", "Tarjeta"],
  ["otros", "Otro"],
];

export default function PagoComprobante() {
  const { token } = useParams();
  const [estado, setEstado] = useState("cargando"); // cargando|listo|error|enviado
  const [data, setData] = useState(null);
  const [errMsj, setErrMsj] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [metodo, setMetodo] = useState("transferencia");
  const [referencia, setReferencia] = useState("");
  const [comentarios, setComentarios] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [waUrl, setWaUrl] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/public/pago-comprobante/${token}`);
        if (!r.ok) {
          setEstado("error");
          setErrMsj(r.status === 410 ? "Este enlace ya no está disponible." :
            r.status === 429 ? "Demasiados intentos; espera un momento." : "Enlace no válido.");
          return;
        }
        setData(await r.json());
        setEstado("listo");
      } catch { setEstado("error"); setErrMsj("No se pudo conectar."); }
    })();
  }, [token]);

  const enviar = async () => {
    if (!archivo) return;
    setEnviando(true); setErrMsj("");
    try {
      const fd = new FormData();
      fd.append("comprobante", archivo);
      fd.append("metodo", metodo);
      fd.append("referencia", referencia);
      fd.append("comentarios", comentarios);
      const r = await fetch(`${API}/public/pago-comprobante/${token}`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErrMsj(d.detail || "No se pudo enviar el comprobante."); return; }
      // Enlace wa.me hacia el número configurado de la EMPRESA (§9/§11).
      const tel = String(d.whatsapp_empresa || "").replace(/\D/g, "");
      const txt = encodeURIComponent(d.wa_texto || "");
      if (tel) setWaUrl(`https://wa.me/${tel.length === 10 ? "52" + tel : tel}?text=${txt}`);
      else if (navigator.share) setWaUrl("#share");
      setEstado("enviado");
    } catch { setErrMsj("Error de red al enviar."); }
    finally { setEnviando(false); }
  };

  return (
    <div className="min-h-screen bg-[#F7F2ED] flex flex-col items-center px-4 py-8" data-testid="pago-public-page">
      <img src="/brand/logotipo-Photoroom.png" alt="Grupo RYSA"
           className="h-14 object-contain mb-4" onError={(e) => { e.currentTarget.style.display = "none"; }} />

      {estado === "cargando" && <Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" />}

      {estado === "error" && (
        <div className="card-soft p-8 max-w-md w-full text-center">
          <XCircle className="w-12 h-12 mx-auto text-red-500 mb-3" />
          <h1 className="font-display font-bold text-lg">Enlace no disponible</h1>
          <p className="text-sm text-slate-500 mt-1">{errMsj}</p>
          <p className="text-xs text-slate-400 mt-4">Si crees que es un error, contacta a tu asesor de ventas.</p>
        </div>
      )}

      {estado === "listo" && data && (
        <div className="card-soft p-6 max-w-md w-full space-y-4">
          <div className="text-center border-b-2 border-[#C1401E] pb-3">
            <div className="font-display font-black text-[#C1401E] tracking-wide">COMPROBANTE DE PAGO</div>
            <div className="text-xs text-slate-400">{data.empresa}</div>
          </div>
          <dl className="text-sm space-y-1.5">
            <Row k="Cotización" v={data.folio} />
            <Row k="Cliente" v={data.cliente || "—"} />
            <Row k="Importe" v={`$${Number(data.importe).toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${data.moneda}`} destacado />
            <Row k="Vence" v={data.vence || "—"} />
          </dl>

          <p className="text-sm font-semibold text-[#C1401E] pt-1">¿Ya realizaste tu pago?</p>

          <label className="block cursor-pointer rounded-xl border-2 border-dashed border-[#C1401E]/40 bg-white hover:bg-[#F4ECE7]/40 transition-colors p-5 text-center">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" capture="environment" className="hidden"
                   onChange={(e) => { setArchivo(e.target.files?.[0] || null); }} data-testid="pc-file" />
            <Upload className="w-6 h-6 mx-auto text-[#C1401E] mb-1" />
            <span className="text-sm font-medium">{archivo ? archivo.name : "SELECCIONAR COMPROBANTE"}</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">PDF, JPG, PNG o WEBP · máx. 10 MB · puedes tomar foto</span>
          </label>

          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Método de pago</div>
            <div className="grid grid-cols-2 gap-2">
              {METODOS.map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMetodo(k)}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${metodo === k ? "border-[#C1401E] bg-[#C1401E]/5 text-[#C1401E]" : "border-slate-200 bg-white text-slate-600"}`}
                        data-testid={`pc-met-${k}`}>
                  {metodo === k && <CheckCircle2 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}
                  {l}
                </button>
              ))}
            </div>
          </div>

          <input value={referencia} onChange={(e) => setReferencia(e.target.value)}
                 placeholder="Referencia bancaria (opcional)" className="w-full h-10 rounded-md border border-slate-200 px-3 text-sm" data-testid="pc-ref" />
          <textarea value={comentarios} onChange={(e) => setComentarios(e.target.value)} rows={2}
                    placeholder="Comentarios (opcional)" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />

          {errMsj && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{errMsj}</p>}

          <button onClick={enviar} disabled={!archivo || enviando}
                  className="w-full h-12 rounded-xl bg-[#C1401E] hover:bg-[#A03316] disabled:opacity-40 text-white font-semibold flex items-center justify-center gap-2"
                  data-testid="pc-enviar">
            {enviando ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
            ENVIAR COMPROBANTE
          </button>
        </div>
      )}

      {estado === "enviado" && (
        <div className="card-soft p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-500" />
          <h1 className="font-display font-bold text-xl">Comprobante recibido correctamente.</h1>
          <p className="text-sm text-slate-500">Nuestro equipo lo revisará y te contactará. Gracias por tu pago puntual.</p>
          {waUrl && (
            <a href={waUrl} target="_blank" rel="noreferrer"
               className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-[#25D366] hover:bg-[#1ebe57] text-white font-semibold"
               data-testid="pc-wa">
              <MessageCircle className="w-5 h-5" /> ENVIAR POR WHATSAPP
            </a>
          )}
          <p className="text-[11px] text-slate-400">Si el botón no adjunta automáticamente, comparte el archivo desde tu galería al chat de ventas.</p>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-6 text-center max-w-sm">
        Este enlace es personal y seguro. Grupo RYSA jamás te pedirá datos de tu tarjeta por este medio.
      </p>
    </div>
  );
}

function Row({ k, v, destacado }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400 shrink-0">{k}</dt>
      <dd className={`text-right truncate ${destacado ? "font-display font-bold text-[#C1401E]" : "font-medium text-slate-700"}`}>{v}</dd>
    </div>
  );
}
