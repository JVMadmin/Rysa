import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { registerSellerLocation } from './salesService';
import { queueOfflineAction, saveLastGpsCache, getLastGpsCache } from './offlineCache';
import { syncManager } from './syncManager';

const TRACKING_STORAGE_KEY = 'rysa_tracking_active';
const INTERVAL_MS = 15000;

export interface TrackingLocation {
  latitud: number;
  longitud: number;
  precision: number;
  timestamp: string;
}

export type TrackingListener = (active: boolean, location?: TrackingLocation) => void;

class TrackingService {
  private active = false;
  private watchSubscription: Location.LocationSubscription | null = null;
  private intervalTimer: any = null;
  private listeners: Set<TrackingListener> = new Set();
  private lastLocation: TrackingLocation | null = null;

  constructor() {
    this.init();
  }

  async init() {
    try {
      syncManager.subscribeReconnect(() => {
        if (this.active) {
          console.log('[trackingService] Conexión restaurada - transmitiendo posición GPS...');
          this.transmitCurrentPosition(true).catch(() => {});
        }
      });

      const stored = await AsyncStorage.getItem(TRACKING_STORAGE_KEY);
      if (stored === 'true') {
        await this.startTracking(true);
      }
    } catch (e) {
      console.warn('[trackingService] Error al inicializar:', e);
    }
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
    this.listeners.forEach((l) => l(this.active, this.lastLocation || undefined));
  }

  async startTracking(silent = false): Promise<boolean> {
    if (this.active) return true;

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[trackingService] Permisos de ubicación denegados');
        return false;
      }

      this.active = true;
      await AsyncStorage.setItem(TRACKING_STORAGE_KEY, 'true');

      // 1. Envío inmediato inicial
      await this.transmitCurrentPosition(silent);

      // 2. watchPositionAsync nativo continuo (se activa con movimiento o tiempo)
      if (Platform.OS !== 'web') {
        try {
          this.watchSubscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: INTERVAL_MS,
              distanceInterval: 10,
            },
            async (loc) => {
              await this.processCoords({
                latitud: loc.coords.latitude,
                longitud: loc.coords.longitude,
                precision: loc.coords.accuracy ? Math.round(loc.coords.accuracy) : 5,
              });
            }
          );
        } catch (watchErr) {
          console.warn('[trackingService] watchPositionAsync no disponible, usando interval:', watchErr);
        }
      }

      // 3. Intervalo de respaldo periódico por si el dispositivo está estático
      this.intervalTimer = setInterval(async () => {
        if (this.active) {
          await this.transmitCurrentPosition(true);
        }
      }, INTERVAL_MS);

      this.notify();
      return true;
    } catch (err) {
      console.warn('[trackingService] Error al iniciar tracking:', err);
      this.active = false;
      await AsyncStorage.removeItem(TRACKING_STORAGE_KEY);
      this.notify();
      return false;
    }
  }

  async stopTracking(): Promise<void> {
    this.active = false;
    await AsyncStorage.removeItem(TRACKING_STORAGE_KEY);

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

  private async processCoords(coords: { latitud: number; longitud: number; precision: number }) {
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
        fuente: 'gps_app_vendedores_live',
      });
    } catch {
      await queueOfflineAction({
        type: 'location_ping',
        payload: {
          latitud: coords.latitud,
          longitud: coords.longitud,
          precision: coords.precision,
          fuente: 'gps_app_vendedores_offline',
        },
      });
    }
    this.notify();
  }

  async transmitCurrentPosition(silent = false): Promise<TrackingLocation | null> {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        latitud: loc.coords.latitude,
        longitud: loc.coords.longitude,
        precision: loc.coords.accuracy ? Math.round(loc.coords.accuracy) : 5,
      };
      await this.processCoords(coords);
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
