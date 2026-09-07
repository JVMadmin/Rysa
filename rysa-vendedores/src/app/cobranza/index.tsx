import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectivityBar } from '@/components/ConnectivityBar';
import { useAuth } from '@/auth/AuthContext';
import { getSellerClients, registerAbono, getSellerCxC } from '@/services/salesService';
import { Client, AbonoInput } from '@/types';

export default function CobranzaScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [allClients, setAllClients] = useState<Client[]>([]);
  const [activeTab, setActiveTab] = useState<'mi_cartera' | 'todos'>('mi_cartera');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Metricas CxC del backend
  const [cxcSummary, setCxcSummary] = useState<{
    saldo_total?: number;
    vencido?: number;
    cobrado_hoy?: number;
  }>({});

  // Modal Abono
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [montoAbono, setMontoAbono] = useState('');
  const [formaPago, setFormaPago] = useState('efectivo');
  const [referencia, setReferencia] = useState('');
  const [submittingAbono, setSubmittingAbono] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [clientsList, cxcData] = await Promise.all([
        getSellerClients().catch(() => []),
        getSellerCxC().catch(() => ({})),
      ]);

      setAllClients(clientsList || []);
      setCxcSummary(cxcData || {});
    } catch {
      // mantener estado previo
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Determinar si un cliente pertenece a la cartera asignada al usuario actual
  const isAssignedToMe = useCallback(
    (c: Client): boolean => {
      if (!user) return false;
      const uid = String(user.id || '');
      const uname = (user.name || '').trim().toLowerCase();
      const cUid = c.vendedor_id ? String(c.vendedor_id) : '';
      const cName = (c.vendedor || '').trim().toLowerCase();

      // Coincidencia por ID directo
      if (cUid && cUid === uid) return true;
      // Coincidencia por nombre de vendedor
      if (cName && uname && (cName === uname || uname.includes(cName) || cName.includes(uname))) {
        return true;
      }
      return false;
    },
    [user]
  );

  // Clientes con saldo pendiente (> 0)
  const allDebtors = useMemo(() => {
    return allClients
      .filter((c) => (c.saldo || 0) > 0)
      .sort((a, b) => (b.vencido || b.saldo || 0) - (a.vencido || a.saldo || 0));
  }, [allClients]);

  // Clientes asignados con saldo
  const myDebtors = useMemo(() => {
    return allDebtors.filter(isAssignedToMe);
  }, [allDebtors, isAssignedToMe]);

  // Lista base según la pestaña activa
  const activeBaseDebtors = useMemo(() => {
    if (activeTab === 'mi_cartera') {
      // Si el usuario es administrador/propietario y no tiene clientes asignados directamente,
      // le permitimos ver la cartera completa con etiqueta explicativa
      const isAdmin = user?.role === 'admin' || user?.role === 'propietario' || user?.role === 'admin_propietario';
      if (myDebtors.length === 0 && isAdmin) {
        return allDebtors;
      }
      return myDebtors;
    }
    return allDebtors;
  }, [activeTab, myDebtors, allDebtors, user]);

  // Filtrado por búsqueda
  const filtered = useMemo(() => {
    if (!search.trim()) return activeBaseDebtors;
    const q = search.trim().toLowerCase();
    return activeBaseDebtors.filter(
      (c) =>
        c.nombre?.toLowerCase().includes(q) ||
        c.codigo?.toLowerCase().includes(q) ||
        c.telefono?.toLowerCase().includes(q) ||
        c.ciudad?.toLowerCase().includes(q)
    );
  }, [activeBaseDebtors, search]);

  // Métricas calculadas para la vista activa
  const metrics = useMemo(() => {
    const saldoTotal = activeBaseDebtors.reduce((acc, c) => acc + (c.saldo || 0), 0);
    const vencidoTotal = activeBaseDebtors.reduce((acc, c) => acc + (c.vencido || 0), 0);
    return {
      saldoTotal,
      vencidoTotal,
      cobradoHoy: cxcSummary.cobrado_hoy || 0,
    };
  }, [activeBaseDebtors, cxcSummary]);

  const handleOpenAbonoModal = (client: Client) => {
    setSelectedClient(client);
    setMontoAbono('');
    setReferencia('');
    setFormaPago('efectivo');
  };

  const handleConfirmAbono = async () => {
    if (!selectedClient) return;
    const num = parseFloat(montoAbono);
    if (isNaN(num) || num <= 0) {
      Alert.alert('Atención', 'Ingresa un monto válido para el abono.');
      return;
    }

    setSubmittingAbono(true);
    try {
      const payload: AbonoInput = {
        monto: num,
        forma_pago: formaPago,
        referencia: referencia.trim() || undefined,
      };

      await registerAbono(selectedClient.id, payload);
      Alert.alert('Abono Registrado', `Se registraron $${num.toFixed(2)} a ${selectedClient.nombre}`, [
        {
          text: 'Aceptar',
          onPress: () => {
            setSelectedClient(null);
            loadData();
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo procesar el abono.');
    } finally {
      setSubmittingAbono(false);
    }
  };

  const formatCurrency = (val?: number) => {
    const num = Number(val || 0);
    return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ConnectivityBar />
      {/* Header Resumen Cartera */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={styles.headerTitle}>Cobranza & Cartera</Text>
            <Text style={styles.headerSubtitle}>
              {activeTab === 'mi_cartera' ? 'Mi cartera asignada' : 'Toda la cartera de la empresa'}
            </Text>
          </View>
          <View style={styles.userBadge}>
            <MaterialIcons name="person" size={14} color="#B9F6CA" />
            <Text style={styles.userBadgeText} numberOfLines={1}>
              {user?.name || 'Vendedor'}
            </Text>
          </View>
        </View>

        {/* Métricas */}
        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Total Cartera</Text>
            <Text style={styles.metricVal}>{formatCurrency(metrics.saldoTotal)}</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Total Vencido</Text>
            <Text style={[styles.metricVal, { color: '#FF8A80' }]}>
              {formatCurrency(metrics.vencidoTotal)}
            </Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Cobrado Hoy</Text>
            <Text style={[styles.metricVal, { color: '#B9F6CA' }]}>
              {formatCurrency(metrics.cobradoHoy)}
            </Text>
          </View>
        </View>
      </View>

      {/* Tabs Selector: Mi Cartera vs Toda la Cartera */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'mi_cartera' && styles.tabBtnActive]}
          onPress={() => setActiveTab('mi_cartera')}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="assignment-ind"
            size={18}
            color={activeTab === 'mi_cartera' ? '#FFFFFF' : '#718096'}
          />
          <Text style={[styles.tabBtnText, activeTab === 'mi_cartera' && styles.tabBtnTextActive]}>
            Mi Cartera ({myDebtors.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'todos' && styles.tabBtnActive]}
          onPress={() => setActiveTab('todos')}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="people-outline"
            size={18}
            color={activeTab === 'todos' ? '#FFFFFF' : '#718096'}
          />
          <Text style={[styles.tabBtnText, activeTab === 'todos' && styles.tabBtnTextActive]}>
            Toda la Cartera ({allDebtors.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <MaterialIcons name="search" size={20} color="#718096" />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por cliente con adeudo..."
            placeholderTextColor="#A0AEC0"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <Text style={styles.countText}>
          {filtered.length} cliente{filtered.length === 1 ? '' : 's'} con saldo pendiente
        </Text>
      </View>

      {/* Listado */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#D32F2F" />
          <Text style={styles.loadingText}>Cargando cartera de cobranza...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 60 },
          ]}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadData();
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              {activeTab === 'mi_cartera' && myDebtors.length === 0 ? (
                <>
                  <MaterialIcons name="info-outline" size={48} color="#D32F2F" />
                  <Text style={styles.emptyTitle}>Sin clientes asignados en mora</Text>
                  <Text style={styles.emptyDesc}>
                    No tienes clientes asignados con adeudo pendiente a tu nombre ({user?.name || 'Vendedor'}).
                  </Text>
                  <TouchableOpacity
                    style={styles.switchTabBtn}
                    onPress={() => setActiveTab('todos')}
                  >
                    <Text style={styles.switchTabBtnText}>Ver Toda la Cartera General</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <MaterialIcons name="check-circle" size={48} color="#48BB78" />
                  <Text style={styles.emptyTitle}>¡Sin saldos pendientes!</Text>
                  <Text style={styles.emptyDesc}>Los clientes seleccionados se encuentran al corriente.</Text>
                </>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const hasVencido = (item.vencido || 0) > 0;
            const assignedToMe = isAssignedToMe(item);

            return (
              <View style={styles.debtorCard}>
                <View style={styles.debtorHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.clientCode}>{item.codigo || 'SIN CÓDIGO'}</Text>
                      <View
                        style={[
                          styles.assignBadge,
                          assignedToMe ? styles.assignBadgeMine : styles.assignBadgeOther,
                        ]}
                      >
                        <Text
                          style={[
                            styles.assignBadgeText,
                            assignedToMe ? styles.assignBadgeTextMine : styles.assignBadgeTextOther,
                          ]}
                        >
                          {assignedToMe ? 'Mi Cartera' : item.vendedor ? `Asig: ${item.vendedor}` : 'General'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.clientName} numberOfLines={1}>
                      {item.nombre}
                    </Text>
                  </View>
                  <View style={[styles.badge, hasVencido ? styles.badgeRed : styles.badgeOrange]}>
                    <Text
                      style={[
                        styles.badgeText,
                        hasVencido ? styles.badgeTextRed : styles.badgeTextOrange,
                      ]}
                    >
                      {hasVencido ? 'VENCIDO' : 'POR VENCER'}
                    </Text>
                  </View>
                </View>

                <View style={styles.debtorDetails}>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>Saldo Adeudado</Text>
                    <Text style={styles.detailSaldo}>{formatCurrency(item.saldo)}</Text>
                  </View>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>Monto Vencido</Text>
                    <Text
                      style={[
                        styles.detailVal,
                        hasVencido && { color: '#D32F2F', fontWeight: '800' },
                      ]}
                    >
                      {formatCurrency(item.vencido || 0)}
                    </Text>
                  </View>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>Días Crédito</Text>
                    <Text style={styles.detailVal}>{item.dias_credito || 0}d</Text>
                  </View>
                </View>

                <View style={styles.debtorActions}>
                  <TouchableOpacity
                    style={styles.abonoBtn}
                    onPress={() => handleOpenAbonoModal(item)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="attach-money" size={18} color="#FFFFFF" />
                    <Text style={styles.abonoBtnText}>Registrar Abono</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Modal Registrar Abono */}
      <Modal
        visible={!!selectedClient}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedClient(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalSub}>{selectedClient?.codigo || 'CLIENTE'}</Text>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {selectedClient?.nombre}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedClient(null)}>
                <MaterialIcons name="close" size={24} color="#718096" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.balanceInfoBox}>
                <Text style={styles.balanceInfoLabel}>Saldo Pendiente:</Text>
                <Text style={styles.balanceInfoValue}>
                  {formatCurrency(selectedClient?.saldo)}
                </Text>
              </View>

              <Text style={styles.formLabel}>Monto del Abono ($MXN):</Text>
              <TextInput
                style={styles.montoInput}
                placeholder="0.00"
                keyboardType="numeric"
                value={montoAbono}
                onChangeText={setMontoAbono}
                autoFocus
              />

              <Text style={styles.formLabel}>Forma de Pago:</Text>
              <View style={styles.formaPagoRow}>
                {['efectivo', 'transferencia', 'cheque', 'tarjeta'].map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[styles.formaBtn, formaPago === f && styles.formaBtnActive]}
                    onPress={() => setFormaPago(f)}
                  >
                    <Text
                      style={[
                        styles.formaBtnText,
                        formaPago === f && styles.formaBtnTextActive,
                      ]}
                    >
                      {f.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.formLabel}>Referencia / Folio (opcional):</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Ej. SPEI 83921 / Cheque 402"
                placeholderTextColor="#A0AEC0"
                value={referencia}
                onChangeText={setReferencia}
              />

              <TouchableOpacity
                style={[styles.saveBtn, submittingAbono && styles.saveBtnDisabled]}
                onPress={handleConfirmAbono}
                disabled={submittingAbono}
              >
                {submittingAbono ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveBtnText}>Confirmar y Aplicar Abono</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  header: {
    backgroundColor: '#121820',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#CBD5E0',
    fontSize: 12,
    marginTop: 2,
  },
  userBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    maxWidth: 150,
  },
  userBadgeText: {
    color: '#B9F6CA',
    fontSize: 11,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  metricLabel: {
    color: '#A0AEC0',
    fontSize: 11,
    fontWeight: '600',
  },
  metricVal: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#EDF2F7',
    padding: 4,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 10,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: '#D32F2F',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5568',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: '#1A202C',
  },
  countText: {
    fontSize: 11,
    color: '#718096',
    marginTop: 6,
    marginLeft: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  loadingText: {
    marginTop: 10,
    color: '#718096',
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  debtorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  debtorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  clientCode: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D32F2F',
  },
  assignBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  assignBadgeMine: {
    backgroundColor: '#FFEBEE',
  },
  assignBadgeOther: {
    backgroundColor: '#EDF2F7',
  },
  assignBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  assignBadgeTextMine: {
    color: '#C62828',
  },
  assignBadgeTextOther: {
    color: '#4A5568',
  },
  clientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D3748',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeRed: {
    backgroundColor: '#FFEBEE',
  },
  badgeOrange: {
    backgroundColor: '#FFF3E0',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  badgeTextRed: {
    color: '#C62828',
  },
  badgeTextOrange: {
    color: '#E65100',
  },
  debtorDetails: {
    flexDirection: 'row',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: '#F7FAFC',
  },
  detailCol: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: '#718096',
  },
  detailSaldo: {
    fontSize: 14,
    fontWeight: '800',
    color: '#C53030',
    marginTop: 2,
  },
  detailVal: {
    fontSize: 13,
    color: '#4A5568',
    marginTop: 2,
  },
  debtorActions: {
    alignItems: 'flex-end',
    marginTop: 10,
  },
  abonoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2E7D32',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  abonoBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3748',
    marginTop: 12,
    textAlign: 'center',
  },
  emptyDesc: {
    fontSize: 13,
    color: '#718096',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  switchTabBtn: {
    marginTop: 16,
    backgroundColor: '#D32F2F',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  switchTabBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: '#E2E8F0',
    paddingBottom: 12,
  },
  modalSub: {
    fontSize: 12,
    color: '#D32F2F',
    fontWeight: '700',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A202C',
    marginTop: 2,
  },
  modalBody: {
    paddingVertical: 14,
  },
  balanceInfoBox: {
    backgroundColor: '#FFF5F5',
    padding: 10,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  balanceInfoLabel: {
    fontSize: 13,
    color: '#C53030',
  },
  balanceInfoValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#C53030',
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4A5568',
    marginBottom: 6,
    marginTop: 8,
  },
  montoInput: {
    backgroundColor: '#F7FAFC',
    borderWidth: 2,
    borderColor: '#D32F2F',
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 20,
    fontWeight: '800',
    color: '#1A202C',
  },
  formaPagoRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  formaBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
  },
  formaBtnActive: {
    backgroundColor: '#D32F2F',
  },
  formaBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5568',
  },
  formaBtnTextActive: {
    color: '#FFFFFF',
  },
  textInput: {
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 13,
    color: '#1A202C',
  },
  saveBtn: {
    backgroundColor: '#2E7D32',
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  saveBtnDisabled: {
    backgroundColor: '#A5D6A7',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
