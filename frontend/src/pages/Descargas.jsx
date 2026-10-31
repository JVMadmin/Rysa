import { useEffect, useState } from "react";
import { fmtFechaLarga } from "@/lib/fechas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, ExternalLink, Monitor, Smartphone } from "lucide-react";

// Sistema → Descargas: app de escritorio (Windows) y app de vendedores
// (Android). Los instaladores los sirve el nginx del servidor en /download/;
// la versión sale de sus manifiestos (latest.yml de la app de escritorio, que
// también usa su auto-actualización, y vendedores.json de la APK).
const ESCRITORIO = "/download/escritorio/";
const APK_ALIAS = "/download/rysa-vendedores.apk";

const mb = (bytes) => (bytes ? `${(Number(bytes) / 1048576).toFixed(0)} MB` : "");

function leerLatestYml(texto) {
  const campo = (k) => (texto.match(new RegExp(`^${k}:\\s*'?([^'\\n]+)'?`, "m")) || [])[1]?.trim();
  return { version: campo("version"), archivo: campo("path"), fecha: campo("releaseDate"),
    tamano: (texto.match(/^\s+size:\s*(\d+)/m) || [])[1] };
}

function Paso({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{n}</span>
      <span className="pt-0.5 text-sm text-slate-600">{children}</span>
    </li>
  );
}

export default function Descargas() {
  const [escritorio, setEscritorio] = useState(null);
  const [apk, setApk] = useState(null);

  useEffect(() => {
    fetch(`${ESCRITORIO}latest.yml`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => setEscritorio(leerLatestYml(t)))
      .catch(() => setEscritorio({}));
    fetch("/download/vendedores.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject())).then(setApk)
      .catch(() => setApk({}));
  }, []);

  const appActual = window.rysaEscritorio?.version;
  const urlInstalador = escritorio?.archivo ? ESCRITORIO + escritorio.archivo : ESCRITORIO;
  const urlApk = apk?.archivo ? `/download/${apk.archivo}` : APK_ALIAS;

  return (
    <div className="space-y-5" data-testid="descargas-page">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight">Descargas</h1>
        <p className="text-sm text-slate-500">Instaladores oficiales de RYSA. Comparte esta pantalla o el código QR con quien necesite instalarlas.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* App de escritorio */}
        <div className="card-soft space-y-4 p-5" data-testid="descarga-escritorio">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900 text-white"><Monitor className="h-5 w-5" /></div>
              <div>
                <h2 className="font-semibold text-slate-800">RYSA ERP para Windows</h2>
                <p className="text-xs text-slate-500">Para las cajas: imprime tickets y cartas directo, sin diálogo.</p>
              </div>
            </div>
            {escritorio?.version && <Badge variant="outline" className="tabular-nums">v{escritorio.version}</Badge>}
          </div>
          {escritorio?.version && (
            <p className="text-xs text-slate-500">{[mb(escritorio.tamano), escritorio.fecha && `Publicada el ${fmtFechaLarga(escritorio.fecha)}`].filter(Boolean).join(" · ")}</p>
          )}
          {appActual && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Esta PC tiene la v{appActual}{escritorio?.version && escritorio.version !== appActual ? " — se actualizará sola al reiniciar la app." : " (la más reciente)."}
            </p>
          )}
          <a href={urlInstalador} download>
            <Button className="w-full sm:w-auto" data-testid="descargar-escritorio"><Download className="mr-1.5 h-4 w-4" /> Descargar instalador</Button>
          </a>
          <ol className="space-y-2.5 border-t border-slate-100 pt-4">
            <Paso n={1}>Abre el instalador. Si Windows muestra «Windows protegió su PC», elige <b>Más información → Ejecutar de todas formas</b>.</Paso>
            <Paso n={2}>Abre <b>RYSA ERP</b> desde el escritorio e inicia sesión con tu usuario.</Paso>
            <Paso n={3}>En <b>Configuración → Impresoras</b>, «Impresoras de este equipo»: elige la de tickets y la de carta y haz una prueba.</Paso>
            <Paso n={4}>Listo. La app se actualiza sola cuando hay versión nueva.</Paso>
          </ol>
        </div>

        {/* App de vendedores */}
        <div className="card-soft space-y-4 p-5" data-testid="descarga-apk">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-600 text-white"><Smartphone className="h-5 w-5" /></div>
              <div>
                <h2 className="font-semibold text-slate-800">RYSA Vendedores para Android</h2>
                <p className="text-xs text-slate-500">Para el equipo de campo: ventas, cobranza, visitas y ubicación en ruta.</p>
              </div>
            </div>
            {apk?.version && <Badge variant="outline" className="tabular-nums">v{apk.version}</Badge>}
          </div>
          {apk?.version && (
            <p className="text-xs text-slate-500">{[mb(apk.tamano), apk.fecha && `Publicada el ${fmtFechaLarga(apk.fecha)}`].filter(Boolean).join(" · ")}</p>
          )}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <img src="/api/descargas/qr.png" alt="Código QR para descargar la app de vendedores" width={148} height={148}
              className="rounded-md border border-slate-200 bg-white p-1.5" data-testid="qr-apk" />
            <div className="space-y-2">
              <p className="text-sm text-slate-600">Escanéalo con la cámara del celular, o abre <b>gruporysa.com/download</b> desde el celular.</p>
              <a href={urlApk} download>
                <Button variant="outline" data-testid="descargar-apk"><Download className="mr-1.5 h-4 w-4" /> Descargar APK</Button>
              </a>
            </div>
          </div>
          <ol className="space-y-2.5 border-t border-slate-100 pt-4">
            <Paso n={1}>Abre el archivo descargado. Si Android lo pide, permite <b>Instalar apps desconocidas</b> para el navegador. Si ya tenía la app, se instala encima sin perder nada.</Paso>
            <Paso n={2}>Inicia sesión e <b>inicia la jornada</b>.</Paso>
            <Paso n={3}>Cuando pida la ubicación, elige <b>«Permitir todo el tiempo»</b>: así tu supervisor ve la ruta aunque el celular esté bloqueado.</Paso>
            <Paso n={4}>En <b>Ajustes → Apps → RYSA Vendedores → Batería</b>, elige <b>Sin restricciones</b> (o quita la optimización de batería). Sin esto, algunos celulares apagan la ubicación al bloquearse.</Paso>
            <Paso n={5}>Al terminar el día, <b>cierra la jornada</b>: deja de enviar la ubicación.</Paso>
          </ol>
        </div>
      </div>

      <a href="/download/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600">
        <ExternalLink className="h-4 w-4" /> Ver todas las versiones publicadas
      </a>
    </div>
  );
}
