import {
  saveClientsCache,
  saveCatalogCache,
  saveVisitsCache,
  saveDashboardCache,
  getOfflineOutbox,
  saveOfflineOutbox,
  removeOfflineAction,
  OfflineAction,
  removeOfflineSale,
} from './offlineCache';
import {
  getSellerClients,
  getVisits,
  getSellerDashboard,
  createVisit,
  checkInVisit,
  registerSellerLocation,
  getFullCatalog,
  createVentaDirecta,
  getCategoriesList,
  getClientOrderHistory,
} from './salesService';
import { apiFetch, testServerConnection } from '@/lib/api';
import { Product } from '@/types';

type ReconnectCallback = () => void;
type SyncStatusCallback = (status: {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  pendingOutboxCount: number;
}) => void;

class SyncManager {
  private isOnline = true;
  private isSyncing = false;
  private isPreloading = false;
  private lastSyncAt: Date | null = null;
  private reconnectListeners: Set<ReconnectCallback> = new Set();
  private statusListeners: Set<SyncStatusCallback> = new Set();
  private checkInterval: any = null;

  constructor() {
    this.startHeartbeat();
  }

  public subscribeReconnect(cb: ReconnectCallback): () => void {
    this.reconnectListeners.add(cb);
    return () => this.reconnectListeners.delete(cb);
  }

  public subscribeStatus(cb: SyncStatusCallback): () => void {
    this.statusListeners.add(cb);
    // Emit current status immediately
    this.emitStatus();
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus() {
    const status = {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      lastSyncAt: this.lastSyncAt,
      pendingOutboxCount: 0,
    };
    getOfflineOutbox().then((outbox) => {
      status.pendingOutboxCount = outbox.length;
      this.statusListeners.forEach((cb) => {
        try {
          cb(status);
        } catch {}
      });
    });
  }

  public getStatus() {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      lastSyncAt: this.lastSyncAt,
    };
  }

  public startHeartbeat(intervalMs = 12000) {
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = setInterval(() => {
      this.checkConnectivity();
    }, intervalMs);
    this.checkConnectivity();
  }

  public async checkConnectivity(): Promise<boolean> {
    const res = await testServerConnection().catch(() => ({ ok: false, message: '' }));
    const wasOffline = !this.isOnline;
    this.isOnline = res.ok;

    if (wasOffline && this.isOnline) {
      console.log('[SyncManager] Connection restored! Triggering auto-sync...');
      this.triggerAutoSync();
      this.reconnectListeners.forEach((cb) => {
        try {
          cb();
        } catch (err) {
          console.warn('[SyncManager] Reconnect listener error:', err);
        }
      });
    }

    this.emitStatus();
    return this.isOnline;
  }

  public async triggerAutoSync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.emitStatus();

    try {
      // 1. Despachar acciones pendientes en cola outbox
      await this.drainOutbox();

      // 2. Refrescar cachés principales
      await this.preloadAllData();

      this.lastSyncAt = new Date();
    } catch (err) {
      console.warn('[SyncManager] Error during auto sync:', err);
    } finally {
      this.isSyncing = false;
      this.emitStatus();
    }
  }

  /**
   * Procesa la cola outbox enviando las acciones registradas offline
   */
  public async drainOutbox(): Promise<{ processed: number; failed: number }> {
    const rawOutbox = await getOfflineOutbox();
    // Limpiar de forma definitiva cualquier ping de ubicacion
    const outbox = rawOutbox.filter((a) => a.type !== 'location_ping');
    if (outbox.length !== rawOutbox.length) {
      await saveOfflineOutbox(outbox);
    }

    if (outbox.length === 0) {
      this.emitStatus();
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;
    const remainingOutbox: OfflineAction[] = [];

    for (const action of outbox) {
      try {
        await this.executeOfflineAction(action);
        processed++;
      } catch (err: any) {
        console.warn(`[SyncManager] Error sincronizando acción ${action.id} (${action.type}):`, err);
        failed++;
        const attempts = (action.attempts || 0) + 1;
        const msg = String(err?.message || err || '');
        const isClientError = msg.includes('400') || msg.includes('404') || msg.includes('422');

        // Si es un error irrecuperable de validación o supera 3 intentos, no bloquear la cola
        if (attempts < 3 && !isClientError) {
          remainingOutbox.push({ ...action, attempts });
        } else {
          console.warn(`[SyncManager] Descartando acción ${action.id} tras superar reintentos o error fatal.`);
        }
      }
    }

    await saveOfflineOutbox(remainingOutbox);
    this.emitStatus();
    return { processed, failed };
  }

  private async executeOfflineAction(action: OfflineAction): Promise<void> {
    switch (action.type) {
      case 'create_visit':
        await createVisit(action.payload);
        break;
      case 'checkin_visit':
        await checkInVisit(action.payload.visita_id, action.payload);
        break;
      case 'location_ping':
        await registerSellerLocation(action.payload);
        break;
      case 'create_client':
        await apiFetch('/clients', {
          method: 'POST',
          body: JSON.stringify(action.payload),
        });
        break;
      case 'venta_directa':
        await createVentaDirecta(action.payload);
        if (action.payload.idempotency_key) {
          await removeOfflineSale(action.payload.idempotency_key);
        }
        break;
      default:
        console.warn('[SyncManager] Unknown action type:', action.type);
    }
  }

  /**
   * Precarga completa de Clientes, Históricos de Cartera, Catálogo,
   * Categorías, Visitas y Dashboard.
   * Guarda todo en AsyncStorage para navegación offline fluida.
   */
  public async preloadAllData(): Promise<{
    clientsCount: number;
    catalogCount: number;
    visitsCount: number;
  }> {
    if (this.isPreloading) {
      console.log('[SyncManager] preloadAllData ya en progreso, omitiendo...');
      return { clientsCount: 0, catalogCount: 0, visitsCount: 0 };
    }
    this.isPreloading = true;

    let clientsCount = 0;
    let catalogCount = 0;
    let visitsCount = 0;

    try {
      // 1. Dashboard (rápido y liviano)
      try {
        const dashboard = await getSellerDashboard();
        if (dashboard) {
          await saveDashboardCache(dashboard);
        }
      } catch (e) {
        console.warn('[SyncManager] Error precargando dashboard:', e);
      }

      // 2. Clientes (cartera y general)
      try {
        const clients = await getSellerClients(undefined, 'all');
        if (clients && Array.isArray(clients)) {
          await saveClientsCache(clients);
          clientsCount = clients.length;
        }
      } catch (e) {
        console.warn('[SyncManager] Error precargando clientes:', e);
      }

      // NOTA: Eliminamos la descarga masiva de 30 historiales individuales
      // para evitar saturación de red y bloqueo de SQLite en Android.
      // El historial se precarga bajo demanda al abrir cada cliente.

      // 3. Catálogo completo de productos
      try {
        const catalog = await getFullCatalog();
        if (Array.isArray(catalog)) {
          catalogCount = catalog.length;
        }
      } catch (e) {
        console.warn('[SyncManager] Error precargando catálogo:', e);
      }

      // 4. Categorías de productos
      try {
        await getCategoriesList();
      } catch (e) {
        console.warn('[SyncManager] Error precargando categorías:', e);
      }

      // 5. Visitas
      try {
        const visits = await getVisits();
        if (visits && Array.isArray(visits)) {
          await saveVisitsCache(visits);
          visitsCount = visits.length;
        }
      } catch (e) {
        console.warn('[SyncManager] Error precargando visitas:', e);
      }

      this.lastSyncAt = new Date();
    } catch (err) {
      console.warn('[SyncManager] Preload partial error:', err);
    } finally {
      this.isPreloading = false;
    }

    return { clientsCount, catalogCount, visitsCount };
  }
}

export const syncManager = new SyncManager();
