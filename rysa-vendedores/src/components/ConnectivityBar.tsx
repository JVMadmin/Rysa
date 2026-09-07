import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { testServerConnection } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';
import { syncManager } from '@/services/syncManager';

interface ConnectivityBarProps {
  onManualSync?: () => Promise<void> | void;
  lastSyncTime?: string;
  sucursal?: string;
}

export const ConnectivityBar: React.FC<ConnectivityBarProps> = ({
  onManualSync,
  lastSyncTime,
  sucursal,
}) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [online, setOnline] = useState<boolean>(true);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [lastSyncFormatted, setLastSyncFormatted] = useState<string>(
    lastSyncTime || new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  );

  const sucursalNombre = sucursal || (user as any)?.sucursal || 'Sucursal Matriz (Palenque)';

  useEffect(() => {
    const unsubscribe = syncManager.subscribeStatus((status) => {
      setOnline(status.isOnline);
      setSyncing(status.isSyncing);
      setPendingCount(status.pendingOutboxCount);
      if (status.lastSyncAt) {
        setLastSyncFormatted(
          status.lastSyncAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
        );
      }
    });
    return () => unsubscribe();
  }, []);

  const checkHealth = useCallback(async () => {
    const t0 = Date.now();
    const res = await testServerConnection();
    const elapsed = Date.now() - t0;

    if (res.ok) {
      setOnline(true);
      setLatencyMs(elapsed);
    } else {
      setOnline(false);
      setLatencyMs(null);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 20000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const handlePressSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncManager.triggerAutoSync();
      await checkHealth();
      if (onManualSync) {
        await onManualSync();
      }
      setLastSyncFormatted(
        new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      );
    } finally {
      setSyncing(false);
    }
  };

  const getSignalBadge = () => {
    if (!online) {
      return {
        icon: 'signal-wifi-bad' as const,
        label: 'Sin Red',
        color: '#E53935',
        bg: 'rgba(229, 57, 53, 0.15)',
      };
    }
    if (latencyMs === null || latencyMs < 120) {
      return {
        icon: 'signal-cellular-alt' as const,
        label: `${latencyMs ?? 35}ms • Óptima`,
        color: '#00E676',
        bg: 'rgba(0, 230, 118, 0.12)',
      };
    }
    if (latencyMs < 350) {
      return {
        icon: 'signal-cellular-alt-2-bar' as const,
        label: `${latencyMs}ms • Estable`,
        color: '#FFB300',
        bg: 'rgba(255, 179, 0, 0.12)',
      };
    }
    return {
      icon: 'signal-cellular-alt-1-bar' as const,
      label: `${latencyMs}ms • Lenta`,
      color: '#FF7043',
      bg: 'rgba(255, 112, 67, 0.12)',
    };
  };

  const signal = getSignalBadge();

  return (
    <View style={styles.outerContainer}>
      {/* 1. Margen superior que protege la barra de estado de Android (Hora, Batería, Señal) */}
      <View style={{ height: Math.max(insets.top, 0), backgroundColor: '#121820' }} />

      {/* 2. Barra de Conexión y Sucursal */}
      <View style={styles.barContainer}>
        {/* Indicador de Sucursal Conectada */}
        <View style={styles.itemGroup}>
          <View style={[styles.statusDot, { backgroundColor: online ? '#00E676' : '#E53935' }]} />
          <MaterialIcons name="business" size={13} color="#90CDF4" style={{ marginRight: 2 }} />
          <Text style={styles.statusText} numberOfLines={1}>
            {online ? sucursalNombre : 'Modo Offline (Caché)'}
          </Text>
        </View>

        {/* Calidad de Señal / Latencia */}
        <View style={[styles.signalPill, { backgroundColor: signal.bg }]}>
          <MaterialIcons name={signal.icon} size={13} color={signal.color} />
          <Text style={[styles.signalText, { color: signal.color }]}>{signal.label}</Text>
        </View>

        {/* Botón de Sincronización con contador de pendientes */}
        <TouchableOpacity
          style={[styles.syncBtn, pendingCount > 0 && { backgroundColor: 'rgba(255, 179, 0, 0.2)' }]}
          onPress={handlePressSync}
          activeOpacity={0.7}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 4 }} />
          ) : (
            <MaterialIcons
              name={pendingCount > 0 ? "cloud-upload" : "sync"}
              size={14}
              color={pendingCount > 0 ? "#FFB300" : "#CBD5E0"}
              style={{ marginRight: 3 }}
            />
          )}
          <Text style={[styles.syncText, pendingCount > 0 && { color: '#FFB300', fontWeight: '700' }]}>
            {syncing ? 'Sync...' : pendingCount > 0 ? `${pendingCount} pend.` : `Sync ${lastSyncFormatted}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  barContainer: {
    backgroundColor: '#18202A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  itemGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 130,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
  },
  signalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  signalText: {
    fontSize: 10,
    fontWeight: '700',
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  syncText: {
    color: '#CBD5E0',
    fontSize: 10,
    fontWeight: '600',
  },
  outerContainer: {
    backgroundColor: '#121820',
  },
});
