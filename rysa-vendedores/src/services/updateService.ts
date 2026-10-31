import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

// Actualización de la app desde el servidor (no hay Play Store): el ERP publica
// la APK en gruporysa.com/download/ con el manifiesto vendedores.json. La app
// lo revisa al abrir y al volver al primer plano; si hay un versionCode mayor,
// la descarga y abre el instalador de Android (se instala encima, misma firma,
// sin perder datos).
const BASE = 'https://gruporysa.com/download/';

export interface VersionPublicada {
  version: string;
  versionCode: number;
  archivo: string;
  tamano?: number;
  fecha?: string;
  notas?: string[];
  obligatoria?: boolean;
}

export function versionInstalada(): { nombre: string; codigo: number } {
  return {
    nombre: Application.nativeApplicationVersion || '',
    codigo: Number(Application.nativeBuildVersion || 0),
  };
}

/** La versión publicada si es más nueva que la instalada; null si no. */
export async function buscarActualizacion(): Promise<VersionPublicada | null> {
  if (Platform.OS !== 'android') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(`${BASE}vendedores.json?t=${Date.now()}`, { signal: controller.signal });
    if (!r.ok) return null;
    const v = (await r.json()) as VersionPublicada;
    return v?.archivo && Number(v.versionCode) > versionInstalada().codigo ? v : null;
  } catch {
    return null; // sin señal: se revisa la siguiente vez
  } finally {
    clearTimeout(timer);
  }
}

/** Descarga la APK (avisando el avance de 0 a 1) y abre el instalador. */
export async function descargarEInstalar(v: VersionPublicada, onProgreso: (avance: number) => void): Promise<void> {
  const destino = `${FileSystem.cacheDirectory}rysa-vendedores-${v.versionCode}.apk`;
  await FileSystem.deleteAsync(destino, { idempotent: true });
  const tarea = FileSystem.createDownloadResumable(`${BASE}${encodeURIComponent(v.archivo)}`, destino, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onProgreso(p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });
  const res = await tarea.downloadAsync();
  if (!res || res.status !== 200) throw new Error('No se pudo descargar la actualización. Revisa tu conexión e intenta de nuevo.');
  if (v.tamano) {
    const info = await FileSystem.getInfoAsync(destino);
    if (!info.exists || info.size !== v.tamano) {
      await FileSystem.deleteAsync(destino, { idempotent: true });
      throw new Error('La descarga llegó incompleta. Intenta de nuevo.');
    }
  }
  const uri = await FileSystem.getContentUriAsync(destino);
  // flags 1 = FLAG_GRANT_READ_URI_PERMISSION: el instalador puede leer el archivo.
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: uri,
    flags: 1,
    type: 'application/vnd.android.package-archive',
  });
}
