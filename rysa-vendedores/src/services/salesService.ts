import { apiFetch } from '@/lib/api';
import { SellerDashboardData, Client, Product, SaleInput, AbonoInput, Visit, PedidoInput, PedidoCreatedResponse } from '@/types';
import { saveCatalogCache, getCatalogCache, saveClientHistoryCache, getClientHistoryCache, saveCategoriesCache, getCategoriesCache } from '@/services/offlineCache';

export async function getSellerDashboard(): Promise<SellerDashboardData> {
  return await apiFetch<SellerDashboardData>('/seller/dashboard');
}

export async function getSellerClients(q?: string, scope: 'cartera' | 'all' = 'all'): Promise<Client[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (scope) params.set('scope', scope);
  const queryParam = params.toString() ? `?${params.toString()}` : '';
  const data = await apiFetch<any>(`/seller/clients${queryParam}`);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.clientes)) return data.clientes;
  return [];
}

export async function getClientOrderHistory(clientId: string): Promise<any[]> {
  try {
    const data = await apiFetch<any[]>(`/seller/clients/${clientId}/history`);
    if (Array.isArray(data) && data.length > 0) {
      await saveClientHistoryCache(clientId, data);
      return data;
    }
  } catch {
    // Fallback a caché offline si no hay conexión
  }
  return await getClientHistoryCache(clientId);
}

export interface VentaDirectaPayload {
  cliente_id?: string;
  cliente_nombre?: string;
  cliente_codigo?: string;
  items: Array<{
    product_id: string;
    codigo?: string;
    descripcion?: string;
    unidad?: string;
    cantidad: number;
    precio: number;
    iva_tasa?: number;
  }>;
  condicion?: 'contado' | 'credito';
  forma_pago?: string;
  notas?: string;
  latitud?: number;
  longitud?: number;
  idempotency_key: string;
  fecha?: string;
}

export async function createVentaDirecta(payload: VentaDirectaPayload): Promise<any> {
  return await apiFetch<any>('/seller/venta-directa', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface FacturarSolicitudPayload {
  sale_id?: string;
  venta_id?: string;
  folio: string;
  rfc?: string;
  cliente_id?: string;
  cliente_rfc?: string;
  razon_social?: string;
  uso_cfdi?: string;
  regimen_fiscal?: string;
  correo?: string;
  email?: string;
  confirmado_no_propio?: boolean;
}

export async function solicitarFacturacion(payload: FacturarSolicitudPayload): Promise<any> {
  return await apiFetch<any>('/seller/facturar-solicitud', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getCategoriesList(): Promise<any[]> {
  try {
    const data = await apiFetch<any[]>('/categories');
    if (Array.isArray(data) && data.length > 0) {
      await saveCategoriesCache(data);
      return data;
    }
  } catch {
    // Fallback a caché local
  }
  return await getCategoriesCache();
}

export interface AbonoSolicitudPayload {
  cliente_id: string;
  monto: number;
  metodo: string;
  referencia?: string;
  nota?: string;
  evidencia_b64?: string;
  foto_url?: string;
}

export async function requestAbonoWithEvidence(payload: AbonoSolicitudPayload): Promise<any> {
  return await apiFetch<any>('/seller/abono-solicitud', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getClientCxC(clientId: string): Promise<any> {
  return await apiFetch<any>(`/cxc/${clientId}`);
}

export async function getSellerCxC(): Promise<any> {
  return await apiFetch<any>('/seller/cxc');
}

export async function getFullCatalog(): Promise<Product[]> {
  try {
    const data = await apiFetch<any[]>('/catalogo');
    if (Array.isArray(data) && data.length > 0) {
      const mapped: Product[] = data.map((p) => ({
        id: p.id,
        sku: p.codigo || p.sku || '',
        descripcion: p.descripcion || p.nombre || 'Sin descripción',
        nombre: p.nombre || p.descripcion || 'Sin descripción',
        precio: Number(p.precio ?? p.precio_publico ?? 0),
        precio1: Number(p.precio1 ?? p.precio ?? 0),
        precio2: Number(p.precio2 ?? p.precio1 ?? p.precio ?? 0),
        precios: p.precios || [],
        existencia: Number(p.existencia ?? 0),
        unidad_medida: p.unidad_medida || 'PZA',
        categoria: p.categoria || '',
        foto: p.imagen || '',
        imagen: p.imagen || '',
        iva_tasa: Number(p.iva_tasa ?? 16),
      }));
      await saveCatalogCache(mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('[salesService] Error fetching /catalogo, falling back to cache:', err);
  }
  const cached = await getCatalogCache();
  return cached.products;
}

export async function searchProducts(q: string = ''): Promise<Product[]> {
  const allProducts = await getFullCatalog();
  if (!q.trim()) return allProducts;
  const lower = q.toLowerCase().trim();
  return allProducts.filter(
    (p) =>
      p.sku?.toLowerCase().includes(lower) ||
      p.descripcion?.toLowerCase().includes(lower) ||
      p.categoria?.toLowerCase().includes(lower)
  );
}

export async function createOrder(order: PedidoInput): Promise<PedidoCreatedResponse> {
  const payload = {
    ...order,
    idempotency_key:
      order.idempotency_key ||
      `idem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
  };
  return await apiFetch<PedidoCreatedResponse>('/pedidos', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createSale(sale: SaleInput): Promise<any> {
  return await apiFetch<any>('/sales', {
    method: 'POST',
    body: JSON.stringify(sale),
  });
}

export async function registerAbono(clientId: string, abono: AbonoInput): Promise<any> {
  const payload = {
    monto: Number(abono.monto),
    metodo: abono.metodo || abono.forma_pago || 'efectivo',
    referencia: abono.referencia || '',
    nota: abono.nota || '',
  };
  return await apiFetch<any>(`/cxc/${clientId}/abono`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createClient(clientData: Partial<Client>): Promise<Client> {
  // Candado estricto: Todo cliente nuevo desde app móvil nace a CONTADO y SIN CRÉDITO
  const payload = {
    ...clientData,
    condicion_pago: 'contado',
    credito_autorizado: false,
    limite_credito: 0.0,
    dias_credito: 0,
    saldo: 0.0,
  };
  return await apiFetch<Client>('/clients', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function uploadClientDocument(
  clientId: string,
  tipo: 'ine_frontal' | 'ine_reverso' | 'csf',
  fileData: { name: string; type: string; uri: string; rawFile?: any }
): Promise<any> {
  const formData = new FormData();
  formData.append('tipo', tipo);

  if (fileData.rawFile) {
    formData.append('file', fileData.rawFile);
  } else {
    formData.append('file', {
      uri: fileData.uri,
      name: fileData.name,
      type: fileData.type,
    } as any);
  }

  return await apiFetch<any>(`/clients/${clientId}/documentos`, {
    method: 'POST',
    body: formData,
  });
}

export async function getClientFrequentProducts(clientId: string): Promise<any[]> {
  const data = await apiFetch<any>(`/clients/${clientId}/frecuentes`);
  return data?.frecuentes || [];
}

export async function getVisits(): Promise<Visit[]> {
  const data = await apiFetch<any>('/visits');
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.visits)) return data.visits;
  return [];
}

export async function createVisit(payload: {
  cliente_id: string;
  cliente_nombre?: string;
  cliente_codigo?: string;
  tipo_visita?: string;
  estado?: string;
  comentarios?: string;
  latitud?: number;
  longitud?: number;
  foto_evidencia?: string;
}): Promise<any> {
  return await apiFetch<any>('/visits', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function checkInVisit(
  visitId: string,
  payload: { comentarios?: string; resultado?: string; latitud?: number; longitud?: number; foto_evidencia?: string }
): Promise<any> {
  return await apiFetch<any>(`/visits/${visitId}/checkin`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function registerSellerLocation(payload: {
  latitud: number;
  longitud: number;
  precision?: number;
  fuente?: string;
}): Promise<any> {
  return await apiFetch<any>('/seller/location', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function registerClientLocation(
  clientId: string,
  payload: {
    latitud: number;
    longitud: number;
    precision?: number;
    fuente?: string;
  }
): Promise<any> {
  return await apiFetch<any>(`/clients/${clientId}/ubicacion`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
