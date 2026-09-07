import {
  saveClientsCache,
  saveCatalogCache,
  saveVisitsCache,
  saveDashboardCache,
  getOfflineOutbox,
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
    const outbox = await getOfflineOutbox();
    if (outbox.length === 0) return { processed: 0, failed: 0 };

    let processed = 0;
    let failed = 0;

    for (const action of outbox) {
      try {
        await this.executeOfflineAction(action);
        await removeOfflineAction(action.id);
        processed++;
      } catch (err) {
        console.warn(`[SyncManager] Failed to sync action ${action.id}:`, err);
        failed++;
        // Si falló por red, no continuar con el resto
        break;
      }
    }

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
    let clientsCount = 0;
    let catalogCount = 0;
    let visitsCount = 0;

    try {
      // 1. Clientes (Cartera y General)
      const clients = await getSellerClients(undefined, 'all').catch(() => null);
      if (clients && Array.isArray(clients)) {
        await saveClientsCache(clients);
        clientsCount = clients.length;

        // 1.1 Precargar historial de los clientes en cartera (primeros 30)
        const carteraClients = clients.filter((c: any) => c.en_cartera || (c.saldo || 0) > 0).slice(0, 30);
        for (const c of carteraClients) {
          if (c.id) {
            getClientOrderHistory(c.id).catch(() => {});
          }
        }
      }

      // 2. Catálogo completo de productos y categorías activas
      const [catalog, categories] = await Promise.all([
        getFullCatalog().catch(() => []),
        getCategoriesList().catch(() => []),
      ]);
      if (Array.isArray(catalog)) {
        catalogCount = catalog.length;
      }

      // 3. Visitas
      const visits = await getVisits().catch(() => null);
      if (visits && Array.isArray(visits)) {
        await saveVisitsCache(visits);
        visitsCount = visits.length;
      }

      // 4. Dashboard KPIs
      const dashboard = await getSellerDashboard().catch(() => null);
      if (dashboard) {
        await saveDashboardCache(dashboard);
      }

      this.lastSyncAt = new Date();
    } catch (err) {
      console.warn('[SyncManager] Preload partial error:', err);
    }

    return { clientsCount, catalogCount, visitsCount };
  }
}

export const syncManager = new SyncManager();
