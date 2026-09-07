import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { ConnectivityBar } from '@/components/ConnectivityBar';
import { getSellerDashboard } from '@/services/salesService';
import { SellerDashboardData } from '@/types';
import { getDashboardCache, saveDashboardCache } from '@/services/offlineCache';
import { syncManager } from '@/services/syncManager';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [dashboard, setDashboard] = useState<SellerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSyncStr, setLastSyncStr] = useState<string>('');

  const fetchDashboard = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const data = await getSellerDashboard();
      if (data) {
        setDashboard(data);
        await saveDashboardCache(data);
        setLastSyncStr(
          new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
        );
      }
    } catch {
      const cached = await getDashboardCache();
      if (cached.dashboard) {
        setDashboard(cached.dashboard);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // 1. Cargar caché inmediatamente (0ms)
    getDashboardCache().then((cached) => {
      if (cached.dashboard) {
        setDashboard(cached.dashboard);
        setLoading(false);
      }
      fetchDashboard(Boolean(cached.dashboard));
    });

    // 2. Disparar precarga integral en segundo plano de cartera, catálogo y visitas
    syncManager.preloadAllData().then((counts) => {
      console.log(`[Dashboard] Preload offline completado: ${counts.clientsCount} clientes, ${counts.catalogCount} productos.`);
    });

    // 3. Suscribirse a reconexión de red
    const unsubReconnect = syncManager.subscribeReconnect(() => {
      console.log('[Dashboard] Network reconnected - refreshing dashboard...');
      fetchDashboard(true);
    });

    const unsubStatus = syncManager.subscribeStatus((st) => {
      setIsOffline(!st.isOnline);
    });

    return () => {
      unsubReconnect();
      unsubStatus();
    };
  }, [fetchDashboard]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboard();
  };

  const formatCurrency = (val?: number) => {
    const num = Number(val || 0);
    return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Barra de Telemetría y Conectividad */}
      <ConnectivityBar onManualSync={fetchDashboard} lastSyncTime={lastSyncStr} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 40 },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#D32F2F']} />
        }
      >
        {/* Top Header Institucional */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/images/rysa-logo.png')}
              style={styles.logoBadge}
              resizeMode="contain"
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.advisorName} numberOfLines={1}>
                {user?.name || 'Asesor Comercial'}
              </Text>
              <Text style={styles.advisorRole}>
                RYSA • {user?.role ? user.role.toUpperCase() : 'VENTAS EN CAMPO'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={logout}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name="logout" size={20} color="#CBD5E0" />
          </TouchableOpacity>
        </View>

        {/* Banner Offline */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={14} color="#FFB300" />
            <Text style={styles.offlineBannerText}>
              Modo Sin Conexión • Mostrando métricas y metas guardadas en caché
            </Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#D32F2F" />
            <Text style={styles.loadingText}>Cargando resumen comercial...</Text>
          </View>
        ) : (
          <>
            {/* Quick Metrics Grid */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Métricas de Campo (Hoy)</Text>
              <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
                <MaterialIcons name="refresh" size={16} color="#D32F2F" />
                <Text style={styles.refreshBtnText}>Actualizar</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.grid}>
              {/* Ventas Hoy */}
              <View style={[styles.card, styles.cardRed]}>
                <View style={styles.cardHeader}>
                  <MaterialIcons name="point-of-sale" size={22} color="#D32F2F" />
                  <Text style={[styles.cardTag, styles.tagRed]}>Hoy</Text>
                </View>
                <Text style={[styles.cardValue, { color: '#D32F2F' }]}>
                  {formatCurrency(dashboard?.ventas_dia?.monto)}
                </Text>
                <Text style={styles.cardLabel}>
                  {dashboard?.ventas_dia?.numero || 0} pedidos levantados
                </Text>
              </View>

              {/* Cobranza Hoy */}
              <View style={[styles.card, styles.cardGreen]}>
                <View style={styles.cardHeader}>
                  <MaterialIcons name="payments" size={22} color="#2E7D32" />
                  <Text style={[styles.cardTag, styles.tagGreen]}>Cobrado</Text>
                </View>
                <Text style={[styles.cardValue, { color: '#2E7D32' }]}>
                  {formatCurrency(dashboard?.cxc?.cobrado_hoy)}
                </Text>
                <Text style={styles.cardLabel}>Abonos aplicados hoy</Text>
              </View>

              {/* Saldo Cartera */}
              <View style={[styles.card, styles.cardOrange]}>
                <View style={styles.cardHeader}>
                  <MaterialIcons name="account-balance-wallet" size={22} color="#E65100" />
                  <Text style={[styles.cardTag, styles.tagOrange]}>Cartera</Text>
                </View>
                <Text style={[styles.cardValue, { color: '#E65100' }]}>
                  {formatCurrency(dashboard?.cxc?.saldo_total)}
                </Text>
                <Text style={styles.cardLabel}>
                  Vencido: {formatCurrency(dashboard?.cxc?.vencido)}
                </Text>
              </View>

              {/* Acumulado Mes */}
              <View style={[styles.card, styles.cardDark]}>
                <View style={styles.cardHeader}>
                  <MaterialIcons name="trending-up" size={22} color="#1E293B" />
                  <Text style={[styles.cardTag, styles.tagDark]}>Mes</Text>
                </View>
                <Text style={[styles.cardValue, { color: '#1E293B' }]}>
                  {formatCurrency(dashboard?.ventas_mes?.monto)}
                </Text>
                <Text style={styles.cardLabel}>
                  {dashboard?.ventas_mes?.numero || 0} ventas totales mes
                </Text>
              </View>
            </View>

            {/* Meta Mensual de Ventas (KPI Principal) */}
            <View style={styles.goalCard}>
              <View style={styles.goalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="flag" size={20} color="#D32F2F" />
                  <Text style={styles.goalTitle}>Meta Comercial del Mes</Text>
                </View>
                <Text style={styles.goalPct}>
                  {dashboard?.ventas_mes?.avance_pct ?? 0}% cumplido
                </Text>
              </View>

              <View style={styles.goalAmountsRow}>
                <Text style={styles.goalCurrent}>
                  {formatCurrency(dashboard?.ventas_mes?.monto ?? 0)}
                </Text>
                <Text style={styles.goalTarget}>
                  de {formatCurrency(dashboard?.ventas_mes?.meta ?? 150000)}
                </Text>
              </View>

              {/* Barra de Progreso */}
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, Math.max(0, dashboard?.ventas_mes?.avance_pct ?? 0))}%` },
                  ]}
                />
              </View>
            </View>

            {/* Cartera Asignada a Crédito */}
            <View style={styles.creditCard}>
              <View style={styles.creditHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="account-balance" size={20} color="#1E293B" />
                  <Text style={styles.creditTitle}>Mi Cartera Asignada</Text>
                </View>
                <TouchableOpacity onPress={() => router.push('/clientes' as any)}>
                  <Text style={styles.creditLink}>Ver Cartera</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.creditGrid}>
                <View style={styles.creditItem}>
                  <Text style={styles.creditLabel}>Saldo Cartera</Text>
                  <Text style={[styles.creditVal, { color: '#E65100' }]}>
                    {formatCurrency(dashboard?.cartera_credito_total?.saldo_total ?? dashboard?.cxc?.saldo_total)}
                  </Text>
                </View>
                <View style={styles.creditItem}>
                  <Text style={styles.creditLabel}>Por Vencer</Text>
                  <Text style={[styles.creditVal, { color: '#2E7D32' }]}>
                    {formatCurrency(dashboard?.cartera_credito_total?.por_vencer ?? dashboard?.cxc?.por_vencer)}
                  </Text>
                </View>
                <View style={styles.creditItem}>
                  <Text style={styles.creditLabel}>Vencido (Mora)</Text>
                  <Text style={[styles.creditVal, { color: '#C62828' }]}>
                    {formatCurrency(dashboard?.cartera_credito_total?.vencido ?? dashboard?.cxc?.vencido)}
                  </Text>
                </View>
                <View style={styles.creditItem}>
                  <Text style={styles.creditLabel}>Cobrado Hoy</Text>
                  <Text style={[styles.creditVal, { color: '#1565C0' }]}>
                    {formatCurrency(dashboard?.cobros_hoy?.monto ?? dashboard?.cxc?.cobrado_hoy)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Accesos Rápidos de Operación en Campo */}
            <Text style={styles.sectionTitle}>Acciones Rápidas en Campo</Text>
            <View style={styles.actionsContainer}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#D32F2F' }]}
                onPress={() => router.push('/pedidos' as any)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="add-shopping-cart" size={26} color="#FFFFFF" />
                <View style={styles.actionBtnTextWrap}>
                  <Text style={styles.actionBtnTitle}>Nueva Venta</Text>
                  <Text style={styles.actionBtnDesc}>Levantar pedido en cliente</Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#0284C7' }]}
                onPress={() => router.push('/catalogo' as any)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="menu-book" size={26} color="#FFFFFF" />
                <View style={styles.actionBtnTextWrap}>
                  <Text style={styles.actionBtnTitle}>Catálogo de Productos</Text>
                  <Text style={styles.actionBtnDesc}>Precios de mayoreo, fotos y stock</Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#2E7D32' }]}
                onPress={() => router.push('/clientes' as any)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="people-alt" size={26} color="#FFFFFF" />
                <View style={styles.actionBtnTextWrap}>
                  <Text style={styles.actionBtnTitle}>Cartera & Clientes</Text>
                  <Text style={styles.actionBtnDesc}>Cobranza, semáforo y nuevos clientes</Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#18202A' }]}
                onPress={() => router.push('/visitas' as any)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="near-me" size={26} color="#00E676" />
                <View style={styles.actionBtnTextWrap}>
                  <Text style={styles.actionBtnTitle}>Ruta GPS en Vivo</Text>
                  <Text style={styles.actionBtnDesc}>Check-in GPS y visitas del día</Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* Resumen de Visitas del Día */}
            <View style={styles.visitsCard}>
              <View style={styles.visitsHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialIcons name="event-available" size={22} color="#D32F2F" />
                  <Text style={styles.visitsTitle}>Operación de Rutas (Hoy)</Text>
                </View>
                <TouchableOpacity onPress={() => router.push('/visitas' as any)}>
                  <Text style={styles.visitsLink}>Ver ruta completa</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.visitsStatsRow}>
                <View style={styles.visitStat}>
                  <Text style={styles.visitStatNum}>
                    {dashboard?.visitas?.total_hoy || 0}
                  </Text>
                  <Text style={styles.visitStatLabel}>Agendadas</Text>
                </View>
                <View style={styles.visitStatDivider} />
                <View style={styles.visitStat}>
                  <Text style={[styles.visitStatNum, { color: '#2E7D32' }]}>
                    {dashboard?.visitas?.realizadas_hoy || 0}
                  </Text>
                  <Text style={styles.visitStatLabel}>Realizadas</Text>
                </View>
                <View style={styles.visitStatDivider} />
                <View style={styles.visitStat}>
                  <Text style={[styles.visitStatNum, { color: '#E65100' }]}>
                    {dashboard?.visitas?.programadas || 0}
                  </Text>
                  <Text style={styles.visitStatLabel}>Pendientes</Text>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#121820',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  logoBadge: {
    width: 44,
    height: 38,
    marginRight: 10,
  },
  advisorName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  advisorRole: {
    color: '#CBD5E0',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  logoutButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    padding: 8,
    borderRadius: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 10,
    color: '#718096',
    fontSize: 13,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A202C',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  refreshBtnText: {
    fontSize: 12,
    color: '#D32F2F',
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  card: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  cardRed: {
    borderLeftWidth: 4,
    borderLeftColor: '#D32F2F',
  },
  cardGreen: {
    borderLeftWidth: 4,
    borderLeftColor: '#2E7D32',
  },
  cardOrange: {
    borderLeftWidth: 4,
    borderLeftColor: '#E65100',
  },
  cardDark: {
    borderLeftWidth: 4,
    borderLeftColor: '#1E293B',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTag: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tagRed: {
    backgroundColor: '#FFEBEE',
    color: '#D32F2F',
  },
  tagGreen: {
    backgroundColor: '#E8F5E9',
    color: '#2E7D32',
  },
  tagOrange: {
    backgroundColor: '#FFF3E0',
    color: '#E65100',
  },
  tagDark: {
    backgroundColor: '#EDF2F7',
    color: '#1E293B',
  },
  cardValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A202C',
  },
  cardLabel: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  actionsContainer: {
    gap: 8,
    marginTop: 10,
    marginBottom: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  actionBtnTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  actionBtnTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  actionBtnDesc: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    marginTop: 1,
  },
  visitsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  visitsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  visitsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A202C',
  },
  visitsLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D32F2F',
  },
  visitsStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingVertical: 10,
  },
  visitStat: {
    flex: 1,
    alignItems: 'center',
  },
  visitStatNum: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1A202C',
  },
  visitStatLabel: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  visitStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  goalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    borderLeftColor: '#D32F2F',
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  goalTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1A202C',
  },
  goalPct: {
    fontSize: 12,
    fontWeight: '800',
    color: '#D32F2F',
  },
  goalAmountsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 8,
  },
  goalCurrent: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1A202C',
  },
  goalTarget: {
    fontSize: 12,
    color: '#718096',
    fontWeight: '600',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#EDF2F7',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#D32F2F',
    borderRadius: 4,
  },
  creditCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  creditHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  creditTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
  },
  creditLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2E7D32',
  },
  creditGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  creditItem: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
  },
  creditLabel: {
    fontSize: 10,
    color: '#718096',
    fontWeight: '600',
  },
  creditVal: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 179, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 179, 0, 0.4)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
    gap: 8,
  },
  offlineBannerText: {
    color: '#FFD54F',
    fontSize: 12,
    fontWeight: '700',
  },
});
