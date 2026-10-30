import { useEffect, useState } from "react";
import { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Monitor, Printer as PrinterIcon, RefreshCw, Receipt, FileText } from "lucide-react";
import {
  PERFILES, detectarModo, listarImpresoras, leerEquipo, guardarEquipo, imprimirPdf,
} from "@/lib/impresion";

// Impresoras de ESTE equipo: cada PC elige su impresora de tickets y la de
// carta (los nombres de Windows cambian de una PC a otra). Se guarda en el
// equipo; las predeterminadas generales de abajo quedan como respaldo.
const MODOS = {
  app: { titulo: "App de escritorio", tono: "success", texto: "Imprime directo, sin diálogo, a la impresora elegida para cada documento." },
  puente: { titulo: "Navegador con la app de escritorio abierta", tono: "success", texto: "Imprime directo a través de la app RYSA ERP de esta PC." },
  navegador: { titulo: "Solo navegador", tono: "warning", texto: "Cada impresión abre el diálogo del sistema. Elige ahí la impresora: Chrome recuerda la última que usaste. Para imprimir sin diálogo, instala la app RYSA ERP para escritorio en esta PC." },
};

const DESTINOS = [
  { clave: "ticket", titulo: "Tickets (80 mm)", icono: Receipt, perfil: "xprinter_n160ii" },
  { clave: "carta", titulo: "Carta, cotizaciones y reportes", icono: FileText, perfil: "brother_dcp_l2660dw" },
];

export default function ImpresorasEquipo({ settings }) {
  const [modo, setModo] = useState(null);
  const [impresoras, setImpresoras] = useState([]);
  const [equipo, setEquipo] = useState(leerEquipo);
  const [busy, setBusy] = useState("");

  const detectar = async () => {
    setBusy("detectar");
    try {
      const m = await detectarModo(settings, { forzar: true });
      setModo(m);
      if (m !== "navegador") {
        const lista = await listarImpresoras(settings);
        setImpresoras(lista);
        // Primera vez: sugiere la impresora que coincide con cada perfil.
        setEquipo((prev) => {
          const sig = { ...prev };
          for (const d of DESTINOS) {
            if (sig[d.clave]) continue;
            const perfil = PERFILES.find((p) => p.clave === d.perfil);
            const hit = lista.find((x) => perfil?.patron.test(x.nombre));
            if (hit) sig[d.clave] = hit.nombre;
          }
          guardarEquipo(sig);
          return sig;
        });
      }
    } catch {
      setImpresoras([]);
    } finally {
      setBusy("");
    }
  };
  useEffect(() => { detectar(); /* eslint-disable-next-line */ }, []);

  const elegir = (clave, nombre) => {
    const sig = { ...equipo, [clave]: nombre };
    setEquipo(sig);
    guardarEquipo(sig);
    toast.success(nombre ? `${clave === "ticket" ? "Tickets" : "Carta"}: ${nombre}` : "Se usará la predeterminada de Windows");
  };

  const probar = async (clave) => {
    setBusy("prueba-" + clave);
    const url = `/api/printers/prueba.pdf?tipo=${clave}`;
    try {
      await imprimirPdf({ tipo: clave, pdfUrl: url, nombre: `prueba-${clave}.pdf`,
        mensaje: "Prueba enviada a la impresora." }, settings);
    } catch (e) {
      toast.error(e?.message ? `No se pudo imprimir: ${e.message}` : formatApiError(e.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };

  const info = modo ? MODOS[modo] : null;
  return (
    <div className="card-soft p-5 space-y-4" data-testid="impresoras-equipo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-slate-700"><Monitor className="h-4 w-4 text-brand-600" /> Impresoras de este equipo</div>
          <p className="mt-0.5 text-[13px] text-slate-500">Se guardan solo en esta PC. Cada caja elige su impresora de tickets y la de carta.</p>
        </div>
        <Button variant="outline" size="sm" onClick={detectar} disabled={busy === "detectar"} data-testid="equipo-detectar">
          {busy === "detectar" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Volver a detectar
        </Button>
      </div>

      {info ? (
        <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <Badge variant={info.tono}>{info.titulo}</Badge>
          <p className="text-[13px] text-slate-600">{info.texto}</p>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Revisando cómo puede imprimir esta PC…</p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {DESTINOS.map((d) => {
          const perfil = PERFILES.find((p) => p.clave === d.perfil);
          const Icono = d.icono;
          return (
            <div key={d.clave} className="space-y-2 rounded-md border border-slate-200 p-3" data-testid={`equipo-${d.clave}`}>
              <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-500"><Icono className="h-3.5 w-3.5" /> {d.titulo}</Label>
              {modo && modo !== "navegador" ? (
                <select value={equipo[d.clave] || ""} onChange={(e) => elegir(d.clave, e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" data-testid={`equipo-select-${d.clave}`}>
                  <option value="">Predeterminada de Windows</option>
                  {impresoras.map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}{p.predeterminada ? " (predeterminada)" : ""}</option>)}
                </select>
              ) : (
                <p className="text-sm text-slate-600">Se elige en el diálogo de impresión.</p>
              )}
              <p className="text-[11px] leading-snug text-slate-500"><b>{perfil?.nombre}:</b> {perfil?.detalle}</p>
              <Button variant="outline" size="sm" onClick={() => probar(d.clave)} disabled={busy === "prueba-" + d.clave} data-testid={`equipo-probar-${d.clave}`}>
                {busy === "prueba-" + d.clave ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PrinterIcon className="mr-1 h-3.5 w-3.5" />} Imprimir prueba
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
