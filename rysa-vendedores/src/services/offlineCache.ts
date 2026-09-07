import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client, Product, Visit, SellerDashboardData } from '@/types';

const CACHE_KEYS = {
  CLIENTS: '@rysa_cache_clients',
  CLIENTS_META: '@rysa_cache_clients_meta',
  CATALOG: '@rysa_cache_catalog',
  CATALOG_META: '@rysa_cache_catalog_meta',
  VISITS: '@rysa_cache_visits',
  VISITS_META: '@rysa_cache_visits_meta',
  DASHBOARD: '@rysa_cache_dashboard',
  DASHBOARD_META: '@rysa_cache_dashboard_meta',
  LAST_GPS: '@rysa_cache_last_gps',
  OFFLINE_OUTBOX: '@rysa_cache_offline_outbox',
};

export interface CacheMetadata {
  savedAt: string; // ISO string
  itemCount: number;
}

export interface OfflineAction {
  id: string;
  type: 'create_visit' | 'checkin_visit' | 'location_ping' | 'create_client';
  payload: any;
  createdAt: string;
  attempts: number;
}

export interface CachedGpsPosition {
  latitud: number;
  longitud: number;
  precision: number;
  updatedAt: string;
}

// ----------------------------------------------------
// CLIENTS CACHE
// ----------------------------------------------------
export async function saveClientsCache(clients: Client[]): Promise<void> {
  try {
    const meta: CacheMetadata = {
      savedAt: new Date().toISOString(),
      itemCount: clients.length,
    };
    await AsyncStorage.setItem(CACHE_KEYS.CLIENTS, JSON.stringify(clients));
    await AsyncStorage.setItem(CACHE_KEYS.CLIENTS_META, JSON.stringify(meta));
  } catch (err) {
    console.warn('[OfflineCache] Error saving clients cache:', err);
  }
}

export async function getClientsCache(): Promise<{ clients: Client[]; meta: CacheMetadata | null }> {
  try {
    const clientsJson = await AsyncStorage.getItem(CACHE_KEYS.CLIENTS);
    const metaJson = await AsyncStorage.getItem(CACHE_KEYS.CLIENTS_META);
    if (clientsJson) {
      const clients: Client[] = JSON.parse(clientsJson);
      const meta: CacheMetadata | null = metaJson ? JSON.parse(metaJson) : null;
      return { clients, meta };
    }
  } catch (err) {
    console.warn('[OfflineCache] Error reading clients cache:', err);
  }
  return { clients: [], meta: null };
}

// ----------------------------------------------------
// CATALOG CACHE
// ----------------------------------------------------
export async function saveCatalogCache(products: Product[]): Promise<void> {
  try {
    const meta: CacheMetadata = {
      savedAt: new Date().toISOString(),
      itemCount: products.length,
    };
    await AsyncStorage.setItem(CACHE_KEYS.CATALOG, JSON.stringify(products));
    await AsyncStorage.setItem(CACHE_KEYS.CATALOG_META, JSON.stringify(meta));
  } catch (err) {
    console.warn('[OfflineCache] Error saving catalog cache:', err);
  }
}

export async function getCatalogCache(): Promise<{ products: Product[]; meta: CacheMetadata | null }> {
  try {
    const catalogJson = await AsyncStorage.getItem(CACHE_KEYS.CATALOG);
    const metaJson = await AsyncStorage.getItem(CACHE_KEYS.CATALOG_META);
    if (catalogJson) {
      const products: Product[] = JSON.parse(catalogJson);
      const meta: CacheMetadata | null = metaJson ? JSON.parse(metaJson) : null;
      return { products, meta };
    }
  } catch (err) {
    console.warn('[OfflineCache] Error reading catalog cache:', err);
  }
  return { products: [], meta: null };
}

// ----------------------------------------------------
// VISITS CACHE
// ----------------------------------------------------
export async function saveVisitsCache(visits: Visit[]): Promise<void> {
  try {
    const meta: CacheMetadata = {
      savedAt: new Date().toISOString(),
      itemCount: visits.length,
    };
    await AsyncStorage.setItem(CACHE_KEYS.VISITS, JSON.stringify(visits));
    await AsyncStorage.setItem(CACHE_KEYS.VISITS_META, JSON.stringify(meta));
  } catch (err) {
    console.warn('[OfflineCache] Error saving visits cache:', err);
  }
}

export async function getVisitsCache(): Promise<{ visits: Visit[]; meta: CacheMetadata | null }> {
  try {
    const visitsJson = await AsyncStorage.getItem(CACHE_KEYS.VISITS);
    const metaJson = await AsyncStorage.getItem(CACHE_KEYS.VISITS_META);
    if (visitsJson) {
      const visits: Visit[] = JSON.parse(visitsJson);
      const meta: CacheMetadata | null = metaJson ? JSON.parse(metaJson) : null;
      return { visits, meta };
    }
  } catch (err) {
    console.warn('[OfflineCache] Error reading visits cache:', err);
  }
  return { visits: [], meta: null };
}

// ----------------------------------------------------
// DASHBOARD CACHE
// ----------------------------------------------------
export async function saveDashboardCache(dashboard: SellerDashboardData): Promise<void> {
  try {
    const meta: CacheMetadata = {
      savedAt: new Date().toISOString(),
      itemCount: 1,
    };
    await AsyncStorage.setItem(CACHE_KEYS.DASHBOARD, JSON.stringify(dashboard));
    await AsyncStorage.setItem(CACHE_KEYS.DASHBOARD_META, JSON.stringify(meta));
  } catch (err) {
    console.warn('[OfflineCache] Error saving dashboard cache:', err);
  }
}

export async function getDashboardCache(): Promise<{ dashboard: SellerDashboardData | null; meta: CacheMetadata | null }> {
  try {
    const dbJson = await AsyncStorage.getItem(CACHE_KEYS.DASHBOARD);
    const metaJson = await AsyncStorage.getItem(CACHE_KEYS.DASHBOARD_META);
    if (dbJson) {
      const dashboard: SellerDashboardData = JSON.parse(dbJson);
      const meta: CacheMetadata | null = metaJson ? JSON.parse(metaJson) : null;
      return { dashboard, meta };
    }
  } catch (err) {
    console.warn('[OfflineCache] Error reading dashboard cache:', err);
  }
  return { dashboard: null, meta: null };
}

// ----------------------------------------------------
// LAST KNOWN GPS CACHE
// ----------------------------------------------------
export async function saveLastGpsCache(pos: CachedGpsPosition): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEYS.LAST_GPS, JSON.stringify(pos));
  } catch (err) {
    console.warn('[OfflineCache] Error saving last GPS:', err);
  }
}

export async function getLastGpsCache(): Promise<CachedGpsPosition | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEYS.LAST_GPS);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------
// OFFLINE OUTBOX (Acciones en cola cuando no hay red)
// ----------------------------------------------------
export async function getOfflineOutbox(): Promise<OfflineAction[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEYS.OFFLINE_OUTBOX);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function queueOfflineAction(action: Omit<OfflineAction, 'id' | 'createdAt' | 'attempts'>): Promise<OfflineAction> {
  const fullAction: OfflineAction = {
    ...action,
    id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  try {
    const current = await getOfflineOutbox();
    current.push(fullAction);
    await AsyncStorage.setItem(CACHE_KEYS.OFFLINE_OUTBOX, JSON.stringify(current));
  } catch (err) {
    console.warn('[OfflineCache] Error queueing action:', err);
  }
  return fullAction;
}

export async function removeOfflineAction(id: string): Promise<void> {
  try {
    const current = await getOfflineOutbox();
    const filtered = current.filter((a) => a.id !== id);
    await AsyncStorage.setItem(CACHE_KEYS.OFFLINE_OUTBOX, JSON.stringify(filtered));
  } catch (err) {
    console.warn('[OfflineCache] Error removing action:', err);
  }
}

export async function clearAllOfflineCache(): Promise<void> {
  try {
    const keysToRemove = Object.values(CACHE_KEYS);
    for (const key of keysToRemove) {
      await AsyncStorage.removeItem(key);
    }
  } catch (err) {
    console.warn('[OfflineCache] Error clearing cache:', err);
  }
}
