import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { registerSellerLocation } from './salesService';
import { queueOfflineAction, saveLastGpsCache, getLastGpsCache } from './offlineCache';
import { syncManager } from './syncManager';
import { getAuthToken, getJornada, jornadaVigente } from '@/lib/api';

export const LOCATION_BACKGROUND_TASK = 'RYSA_BACKGROUND_LOCATION_TASK';
const TRACKING_STORAGE_KEY = 'rysa_tracking_active';
const INTERVAL_MS = 15000;

// Ya NO se detiene el servicio de fondo al cargar el módulo: eso apagaba el
// rastreo cada vez que Android o el vendedor reabrían la app. El servicio vive
// mientras la jornada esté vigente; la tarea de fondo se detiene sola cuando
// la sesión vence (23:59) o se cierra la jornada.

export interface TrackingLocation {
  latitud: number;
  longitud: number;
  precision: number;
  timestamp: string;
}

export type TrackingListener = (active: boolean, location?: TrackingLocation) => void;

class TrackingService {
  private active = false;
  private isStarting = false;
  private watchSubscription: Location.LocationSubscription | null = null;
  private intervalTimer: any = null;
  private listeners: Set<TrackingListener> = new Set();
  private lastLocation: TrackingLocation | null = null;

  constructor() {
    try {
      syncManager.subscribeReconnect(() => {
        if (this.active) {
          console.log('[trackingService] Conexión restaurada - transmitiendo posición GPS...');
          this.transmitCurrentPosition(true).catch(() => {});
        }
      });
    } catch {}
  }

  async init(): Promise<void> {
    // No-op defensivo para compatibilidad hacia atrás
  }

  isTracking(): boolean {
    return this.active;
  }

  getLastLocation(): TrackingLocation | null {
    return this.lastLocation;
  }

  addListener(listener: TrackingListener): () => void {
    this.listeners.add(listener);
    listener(this.active, this.lastLocation || undefined);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => {
      try {
        l(this.active, this.lastLocation || undefined);
      } catch {}
    });
  }

  async startTracking(silent = false): Promise<boolean> {
    if (this.active) return true;
    if (this.isStarting) return false;
    this.isStarting = true;

    try {
      // 1. VERIFICAR permisos en primer plano — NUNCA solicitarlos aquí.
      // Los permisos son gestionados exclusivamente por useForegroundPermissions()
      // en _layout.tsx. Llamar requestForegroundPermissionsAsync() desde aquí
      // puede generar solicitudes concurrentes que crashean la app en Android 12+.
      const { status: fgStatus } = await Location.getForegroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
      if (fgStatus !== 'granted') {
        console.warn('[trackingService] Permisos de ubicación en primer plano no concedidos aún');
        this.isStarting = false;
        return false;
      }

      this.active = true;
      await AsyncStorage.setItem(TRACKING_STORAGE_KEY, 'true').catch(() => {});

      // 2. Envío inmediato inicial no bloqueante
      this.transmitCurrentPosition(silent).catch(() => {});

      // 3. Listener en primer plano (watchPositionAsync) 100% seguro y estable
      if (Platform.OS !== 'web') {
        try {
          if (this.watchSubscription) {
            this.watchSubscription.remove();
            this.watchSubscription = null;
          }
          this.watchSubscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: INTERVAL_MS,
              distanceInterval: 10,
            },
            async (loc) => {
              try {
                await this.processCoords({
                  latitud: loc.coords.latitude,
                  longitud: loc.coords.longitude,
                  precision: loc.coords.accuracy ? Math.round(loc.coords.accuracy) : 5,
                }, 'gps_app_vendedores_live');
              } catch {}
            }
          );
        } catch (watchErr) {
          console.warn('[trackingService] watchPositionAsync complementario no disponible:', watchErr);
        }

        // NOTA: startLocationUpdatesAsync (Foreground Service) NO se llama automáticamente aquí.
        // Se llama SOLO cuando el usuario presiona explícitamente el botón "Activar Ruta" en la
        // pantalla de Visitas (toggleContinuousTracking → activateBackgroundService()).
        // Esto garantiza que siempre hay una interacción directa del usuario como contexto,
        // lo que Android requiere para permitir startForegroundService() en Android 12+.
      }

      this.notify();
      return true;
    } catch (err) {
      console.warn('[trackingService] Error al iniciar tracking:', err);
      this.active = false;
      await AsyncStorage.removeItem(TRACKING_STORAGE_KEY).catch(() => {});
      this.notify();
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Solicita el permiso de ubicación en segundo plano de forma segura.
   * Debe llamarse desde un contexto de UI visible (no desde startup).
   * En Android 11+ esto navega al usuario a los Ajustes del sistema.
   * Una vez que el usuario regresa a la app, el Foreground Service se activará
   * automáticamente gracias al listener de AppState.
   */
  async requestBackgroundPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      console.log('[trackingService] Permiso background solicitado manualmente, resultado:', status);
      // Si ya fue concedido y el tracking está activo, iniciar Foreground Service ahora
      if (status === 'granted' && this.active && AppState.currentState === 'active') {
        await this.tryStartForegroundService();
      }
      return status === 'granted';
    } catch (err) {
      console.warn('[trackingService] Error solicitando permiso background:', err);
      return false;
    }
  }

  /**
   * Verifica el permiso background actual sin solicitarlo.
   */
  async getBackgroundPermissionStatus(): Promise<string> {
    try {
      const perm = await Location.getBackgroundPermissionsAsync();
      return perm.status;
    } catch {
      return 'undetermined';
    }
  }

  /**
   * Intenta activar el Foreground Service de fondo si el permiso ya fue concedido.
   * Se llama automáticamente cuando la app vuelve al primer plano.
   */
  async tryStartForegroundService(): Promise<void> {
    if (!this.active || Platform.OS !== 'android') return;
    try {
      const bgPerm = await Location.getBackgroundPermissionsAsync().catch(() => null);
      if (bgPerm?.status !== 'granted') return;

      const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_BACKGROUND_TASK).catch(() => false);
      if (!hasStarted) {
        await Location.startLocationUpdatesAsync(LOCATION_BACKGROUND_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: INTERVAL_MS,
          distanceInterval: 10,
          deferredUpdatesInterval: INTERVAL_MS,
          foregroundService: {
            notificationTitle: 'Jornada activa · RYSA',
            notificationBody: 'Tu ubicación se envía a tu supervisor hasta que cierres la jornada.',
            notificationColor: '#CD0708',
            // Sigue enviando aunque el vendedor cierre la app desde recientes.
            killServiceOnDestroy: false,
          },
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
        });
        console.log('[trackingService] Foreground Service activado tras regreso de Ajustes');
      }
    } catch (err) {
      console.warn('[trackingService] tryStartForegroundService omitido:', err);
    }
  }

  /** Inicio de jornada: GPS en primer plano + servicio de fondo (si ya hay
   *  permiso "todo el tiempo"). Se llama justo después del login, con la app
   *  visible, que es cuando Android permite arrancar el servicio. */
  async iniciarJornada(): Promise<boolean> {
    const ok = await this.startTracking(true);
    if (ok) await this.tryStartForegroundService();
    return ok;
  }

  async stopTracking(): Promise<void> {
    this.active = false;
    await AsyncStorage.removeItem(TRACKING_STORAGE_KEY);

    if (Platform.OS !== 'web') {
      try {
        const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_BACKGROUND_TASK).catch(() => false);
        if (hasStarted) {
          await Location.stopLocationUpdatesAsync(LOCATION_BACKGROUND_TASK).catch(() => {});
        }
      } catch (e) {
        console.warn('[trackingService] Error deteniendo updates de fondo:', e);
      }
    }

    if (this.watchSubscription) {
      this.watchSubscription.remove();
      this.watchSubscription = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.notify();
  }

  private lastProcessedTime = 0;

  async processCoords(coords: { latitud: number; longitud: number; precision: number }, fuente = 'gps_app_vendedores_live') {
    const now = Date.now();
    // Limitar transmisiones a maximo una cada 8 segundos para no saturar hilo JS ni red
    if (now - this.lastProcessedTime < 8000) {
      return;
    }
    this.lastProcessedTime = now;

    const loc: TrackingLocation = {
      ...coords,
      timestamp: new Date().toISOString(),
    };
    this.lastLocation = loc;
    await saveLastGpsCache({
      latitud: coords.latitud,
      longitud: coords.longitud,
      precision: coords.precision,
      updatedAt: loc.timestamp,
    });

    try {
      await registerSellerLocation({
        latitud: coords.latitud,
        longitud: coords.longitud,
        precision: coords.precision,
        fuente,
      });
    } catch {
      // Telemetria efimera: no saturar la cola de salida con cientos de pings.
      // La posicion queda registrada en saveLastGpsCache y se enviara al reconectar.
    }
    this.notify();
  }

  async transmitCurrentPosition(silent = false): Promise<TrackingLocation | null> {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        latitud: Number(loc.coords.latitude.toFixed(6)),
        longitud: Number(loc.coords.longitude.toFixed(6)),
        precision: loc.coords.accuracy ? Math.round(loc.coords.accuracy) : 5,
      };
      await this.processCoords(coords, 'gps_app_vendedores_ping');
      return this.lastLocation;
    } catch {
      const cached = await getLastGpsCache();
      if (cached) {
        return {
          latitud: cached.latitud,
          longitud: cached.longitud,
          precision: cached.precision,
          timestamp: cached.updatedAt,
        };
      }
      return null;
    }
  }
}

export const trackingService = new TrackingService();

// Registro de la tarea global en segundo plano con TaskManager (se ejecuta a nivel de módulo)
if (Platform.OS !== 'web') {
  try {
    if (!TaskManager.isTaskDefined(LOCATION_BACKGROUND_TASK)) {
      TaskManager.defineTask(LOCATION_BACKGROUND_TASK, async ({ data, error }) => {
        if (error) {
          console.warn('[trackingService:BackgroundTask] Error en tarea de fondo:', error.message);
          return;
        }
        // Sin sesión o con la jornada vencida/cerrada: se apaga el servicio.
        const vigente = !!(await getAuthToken()) && jornadaVigente(await getJornada());
        if (!vigente) {
          await Location.stopLocationUpdatesAsync(LOCATION_BACKGROUND_TASK).catch(() => {});
          return;
        }
        if (data) {
          const { locations } = data as { locations: Location.LocationObject[] };
          if (locations && locations.length > 0) {
            const latest = locations[locations.length - 1];
            if (latest && latest.coords) {
              const coords = {
                latitud: Number(latest.coords.latitude.toFixed(6)),
                longitud: Number(latest.coords.longitude.toFixed(6)),
                precision: latest.coords.accuracy ? Math.round(latest.coords.accuracy) : 5,
              };
              await trackingService.processCoords(coords, 'gps_app_vendedores_background');
            }
          }
        }
      });
      console.log(`[trackingService] Tarea de fondo "${LOCATION_BACKGROUND_TASK}" registrada en TaskManager`);
    }
  } catch (tmErr) {
    console.warn('[trackingService] Error definiendo tarea en TaskManager:', tmErr);
  }
}
