import { apiFetch, getBackendUrl } from '@/lib/api';

export interface CajaInfo {
  id: string;
  caja_nombre: string;
  caja_numero: number;
  fondo_inicial: number;
  estado: 'abierta' | 'cerrada';
  fecha_apertura: string;
  fecha_cierre?: string;
}

export interface CajaResumen {
  fondo_inicial: number;
  ventas_efectivo: number;
  ventas_otros: number;
  total_ventas: number;
  entradas: number;
  retiros: number;
  efectivo_esperado: number;
}

export interface CajaActualResponse {
  caja: CajaInfo | null;
  resumen?: CajaResumen;
  movimientos?: any[];
}

export interface CajaCierreResult {
  ok: boolean;
  caja_id: string;
  cierre: {
    fondo_inicial: number;
    ventas_efectivo: number;
    total_ventas: number;
    efectivo_esperado: number;
    efectivo_contado: number;
    diferencia: number;
    num_ventas: number;
  };
  reporte_pdf_url: string;
}

export async function getCajaActual(): Promise<CajaActualResponse> {
  try {
    return await apiFetch<CajaActualResponse>('/seller/caja/actual');
  } catch (err) {
    console.warn('[cajaService] Error consultando caja actual:', err);
    return { caja: null };
  }
}

export async function abrirCaja(fondoInicial: number, nombre?: string): Promise<any> {
  return await apiFetch<any>('/seller/caja/abrir', {
    method: 'POST',
    body: JSON.stringify({
      fondo_inicial: Number(fondoInicial || 0),
      caja_nombre: nombre || undefined,
    }),
  });
}

export async function cerrarCaja(efectivoContado: number): Promise<CajaCierreResult> {
  return await apiFetch<CajaCierreResult>('/seller/caja/cerrar', {
    method: 'POST',
    body: JSON.stringify({
      efectivo_contado: Number(efectivoContado || 0),
    }),
  });
}

export function getCajaReportePdfUrl(cajaId: string): string {
  const base = getBackendUrl();
  return `${base}/api/caja/${cajaId}/reporte.pdf`;
}