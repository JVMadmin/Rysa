import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { ConnectivityBar } from '@/components/ConnectivityBar';
import {
  getSellerClients,
  getSellerCxC,
  registerAbono,
  requestAbonoWithEvidence,
  createClient,
  uploadClientDocument,
  getClientFrequentProducts,
  getClientOrderHistory,
  registerClientLocation,
} from '@/services/salesService';
import { Client, SemaforoCrediticio } from '@/types';
import { pickDocument, PickedFile } from '@/lib/filePicker';
import { getClientsCache, saveClientsCache, CacheMetadata } from '@/services/offlineCache';
import { syncManager } from '@/services/syncManager';

export default function ClientesCarteraScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [clients, setClients] = useState<Client[]>([]);
  const [cxcSummary, setCxcSummary] = useState<{
    saldo_total?: number;
    vencido?: number;
    cobrado_hoy?: number;
  }>({});
  const [cacheMeta, setCacheMeta] = useState<CacheMetadata | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const [activeTab, setActiveTab] = useState<'mi_cartera' | 'con_saldo' | 'todos'>('mi_cartera');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal Detalle Cliente
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [frecuentes, setFrecuentes] = useState<any[]>([]);
  const [loadingFrecuentes, setLoadingFrecuentes] = useState(false);
  const [orderHistory, setOrderHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [capturingGps, setCapturingGps] = useState(false);

  // Modal Abono con Evidencia
  const [abonoModalVisible, setAbonoModalVisible] = useState(false);
  const [montoAbono, setMontoAbono] = useState('');
  const [metodoAbono, setMetodoAbono] = useState('efectivo');
  const [referenciaAbono, setReferenciaAbono] = useState('');
  const [notaAbono, setNotaAbono] = useState('');
  const [abonoEvidencia, setAbonoEvidencia] = useState<{ uri: string; base64?: string } | null>(null);
  const [submittingAbono, setSubmittingAbono] = useState(false);

  // Modal Nuevo Cliente en Campo
  const [nuevoModalVisible, setNuevoModalVisible] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoContacto, setNuevoContacto] = useState('');
  const [nuevoRfc, setNuevoRfc] = useState('XAXX010101000');
  const [nuevoTelefono, setNuevoTelefono] = useState('');
  const [nuevoWhatsapp, setNuevoWhatsapp] = useState('');
  const [nuevoDireccion, setNuevoDireccion] = useState('');
  const [nuevoCiudad, setNuevoCiudad] = useState('Palenque');
  const [nuevoGps, setNuevoGps] = useState<{ lat: number; lng: number } | null>(null);
  const [submittingNuevo, setSubmittingNuevo] = useState(false);

  // Archivos de expediente para nuevo cliente
  const [docIneFrontal, setDocIneFrontal] = useState<PickedFile | null>(null);
  const [docIneReverso, setDocIneReverso] = useState<PickedFile | null>(null);
  const [docCsf, setDocCsf] = useState<PickedFile | null>(null);

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [clientsList, cxcData] = await Promise.all([
        getSellerClients(undefined, 'all').catch(() => null),
        getSellerCxC().catch(() => null),
      ]);
      if (clientsList && Array.isArray(clientsList) && clientsList.length > 0) {
        setClients(clientsList);
        await saveClientsCache(clientsList);
        setCacheMeta({ savedAt: new Date().toISOString(), itemCount: clientsList.length });
      } else {
        // Si la llamada retornó vacío por error de red, leer de caché
        const cached = await getClientsCache();
        if (cached.clients.length > 0) {
          setClients(cached.clients);
          setCacheMeta(cached.meta);
        }
      }
      if (cxcData) {
        setCxcSummary(cxcData);
      }
    } catch {
      // Fallback a caché local
      const cached = await getClientsCache();
      if (cached.clients.length > 0) {
        setClients(cached.clients);
        setCacheMeta(cached.meta);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 1. Cargar caché inmediatamente al montar (0ms)
  useEffect(() => {
    getClientsCache().then((cached) => {
      if (cached.clients.length > 0) {
        setClients(cached.clients);
        setCacheMeta(cached.meta);
        setLoading(false);
      }
      // Consultar al servidor en background (Stale-While-Revalidate)
      loadData(cached.clients.length > 0);
    });

    // 2. Suscribirse a eventos de reconexión de red automática
    const unsubReconnect = syncManager.subscribeReconnect(() => {
      console.log('[ClientesScreen] Network reconnected - refreshing clients...');
      loadData(true);
    });

    const unsubStatus = syncManager.subscribeStatus((st) => {
      setIsOffline(!st.isOnline);
    });

    return () => {
      unsubReconnect();
      unsubStatus();
    };
  }, [loadData]);

  // Cargar productos frecuentes e historial de compras cuando se abre el detalle de un cliente
  useEffect(() => {
    if (selectedClient?.id) {
      setLoadingFrecuentes(true);
      getClientFrequentProducts(selectedClient.id)
        .then(setFrecuentes)
        .catch(() => setFrecuentes([]))
        .finally(() => setLoadingFrecuentes(false));

      setLoadingHistory(true);
      getClientOrderHistory(selectedClient.id)
        .then(setOrderHistory)
        .catch(() => setOrderHistory([]))
        .finally(() => setLoadingHistory(false));
    } else {
      setFrecuentes([]);
      setOrderHistory([]);
    }
  }, [selectedClient?.id]);

  // Determinar si un cliente pertenece a la cartera asignada al asesor logueado
  const isAssignedToMe = useCallback(
    (c: Client): boolean => {
      if (!user) return false;
      const urole = (user.role || '').toLowerCase();
      if (urole.includes('admin') || urole.includes('supervisor')) {
        return true;
      }
      if (c.en_cartera !== undefined) {
        return Boolean(c.en_cartera);
      }
      const uid = String(user.id || '');
      const uname = (user.name || '').trim().toLowerCase();
      const cUid = c.vendedor_id ? String(c.vendedor_id) : '';
      const cName = (c.vendedor || '').trim().toLowerCase();

      if (cUid && cUid === uid) return true;
      if (cName && uname && (cName === uname || uname.includes(cName) || cName.includes(uname))) {
        return true;
      }
      return false;
    },
    [user]
  );

  const myClients = useMemo(() => {
    return clients.filter(isAssignedToMe);
  }, [clients, isAssignedToMe]);

  const debtClients = useMemo(() => {
    return myClients.filter((c) => (c.saldo || 0) > 0);
  }, [myClients]);

  const baseClients = useMemo(() => {
    if (activeTab === 'con_saldo') return debtClients;
    return myClients.length > 0 ? myClients : clients;
  }, [activeTab, myClients, debtClients, clients]);

  const filtered = useMemo(() => {
    if (!search.trim()) return baseClients;
    const q = search.trim().toLowerCase();
    return baseClients.filter(
      (c) =>
        c.nombre?.toLowerCase().includes(q) ||
        c.codigo?.toLowerCase().includes(q) ||
        c.telefono?.toLowerCase().includes(q) ||
        c.ciudad?.toLowerCase().includes(q)
    );
  }, [baseClients, search]);

  const formatCurrency = (val?: number) => {
    const num = Number(val || 0);
    return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Acciones de contacto y GPS
  const handleCall = (phone?: string) => {
    if (phone) Linking.openURL(`tel:${phone}`);
  };

  const handleWhatsApp = (phone?: string) => {
    if (!phone) return;
    const clean = phone.replace(/\D/g, '');
    const num = clean.length === 10 ? `52${clean}` : clean;
    Linking.openURL(`https://wa.me/${num}`);
  };

  const handleCaptureGpsInSitu = async (client: Client) => {
    setCapturingGps(true);
    try {
      let lat = 17.9895;
      let lng = -92.9475;
      if (typeof navigator !== 'undefined' && (navigator as any).geolocation) {
        await new Promise<void>((resolve) => {
          (navigator as any).geolocation.getCurrentPosition(
            (pos: any) => {
              lat = Number(pos.coords.latitude.toFixed(6));
              lng = Number(pos.coords.longitude.toFixed(6));
              resolve();
            },
            () => resolve(),
            { enableHighAccuracy: true, timeout: 6000 }
          );
        });
      }

      await registerClientLocation(client.id, {
        latitud: lat,
        longitud: lng,
        precision: 6,
        fuente: 'app_vendedores_in_situ',
      });

      Alert.alert('GPS Actualizado', `Coordenadas guardadas para ${client.nombre}`);
      loadData();
      setSelectedClient((prev) => (prev ? { ...prev, latitud: lat, longitud: lng } : null));
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo guardar la ubicación GPS.');
    } finally {
      setCapturingGps(false);
    }
  };

  // Registro de Abono con Evidencia Fotográfica y Aprobación Gerencial
  const handleOpenAbono = (client: Client) => {
    setSelectedClient(client);
    setMontoAbono('');
    setMetodoAbono('efectivo');
    setReferenciaAbono('');
    setNotaAbono('');
    setAbonoEvidencia(null);
    setAbonoModalVisible(true);
  };

  const handleTakeAbonoPhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permiso Requerido', 'Se requiere acceso a la cámara para fotografiar el comprobante.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.6,
        base64: true,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        setAbonoEvidencia({ uri: res.assets[0].uri, base64: res.assets[0].base64 || undefined });
      }
    } catch {
      Alert.alert('Error', 'No se pudo abrir la cámara.');
    }
  };

  const handlePickAbonoGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        quality: 0.6,
        base64: true,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        setAbonoEvidencia({ uri: res.assets[0].uri, base64: res.assets[0].base64 || undefined });
      }
    } catch {
      Alert.alert('Error', 'No se pudo seleccionar la imagen de la galería.');
    }
  };

  const handleConfirmAbono = async () => {
    if (!selectedClient) return;
    const monto = parseFloat(montoAbono);
    if (isNaN(monto) || monto <= 0) {
      Alert.alert('Atención', 'Ingresa un monto válido para el abono.');
      return;
    }

    setSubmittingAbono(true);
    try {
      const res = await requestAbonoWithEvidence({
        cliente_id: selectedClient.id,
        monto,
        metodo: metodoAbono,
        referencia: referenciaAbono.trim() || undefined,
        nota: notaAbono.trim() || undefined,
        evidencia_b64: abonoEvidencia?.base64 ? `data:image/jpeg;base64,${abonoEvidencia.base64}` : undefined,
      });

      Alert.alert(
        'Solicitud Enviada a Gerencia',
        `Folio: ${res.folio || 'SAB-REG'}\n\nSe ha enviado la solicitud de abono por ${formatCurrency(monto)} con evidencia fotográfica.\n\nQueda en estado "Pendiente de Aprobación" para revisión y autorización de Gerencia.`
      );

      setAbonoModalVisible(false);
      setAbonoEvidencia(null);
      loadData();
    } catch (err: any) {
      Alert.alert('Error al registrar solicitud de abono', err.message || 'No se pudo enviar la solicitud.');
    } finally {
      setSubmittingAbono(false);
    }
  };

  // Creación de Nuevo Cliente en Campo (Solo Contado)
  const handleOpenNuevoCliente = () => {
    setNuevoNombre('');
    setNuevoContacto('');
    setNuevoRfc('XAXX010101000');
    setNuevoTelefono('');
    setNuevoWhatsapp('');
    setNuevoDireccion('');
    setNuevoCiudad('Villahermosa');
    setNuevoGps(null);
    setDocIneFrontal(null);
    setDocIneReverso(null);
    setDocCsf(null);
    setNuevoModalVisible(true);
  };

  const handlePickFile = async (tipo: 'ine_frontal' | 'ine_reverso' | 'csf') => {
    const file = await pickDocument(tipo === 'csf' ? 'image/*,application/pdf' : 'image/*');
    if (!file) return;

    if (tipo === 'ine_frontal') setDocIneFrontal(file);
    if (tipo === 'ine_reverso') setDocIneReverso(file);
    if (tipo === 'csf') setDocCsf(file);
  };

  const handleCapturarGpsNuevo = async () => {
    if (typeof navigator !== 'undefined' && (navigator as any).geolocation) {
      (navigator as any).geolocation.getCurrentPosition(
        (pos: any) => {
          setNuevoGps({
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
          });
        },
        () => {
          setNuevoGps({ lat: 17.9895, lng: -92.9475 });
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      setNuevoGps({ lat: 17.9895, lng: -92.9475 });
    }
  };

  const handleGuardarNuevoCliente = async () => {
    if (!nuevoNombre.trim()) {
      Alert.alert('Campo Requerido', 'Ingresa el Nombre o Razón Social del cliente.');
      return;
    }
    if (!nuevoTelefono.trim()) {
      Alert.alert('Campo Requerido', 'Ingresa el teléfono o celular de contacto.');
      return;
    }

    setSubmittingNuevo(true);
    try {
      const nuevo = await createClient({
        nombre: nuevoNombre.trim(),
        contacto: nuevoContacto.trim() || undefined,
        rfc: nuevoRfc.trim() || 'XAXX010101000',
        telefono: nuevoTelefono.trim(),
        whatsapp: nuevoWhatsapp.trim() || nuevoTelefono.trim(),
        direccion: nuevoDireccion.trim() || undefined,
        ciudad: nuevoCiudad.trim() || 'Villahermosa',
        latitud: nuevoGps?.lat,
        longitud: nuevoGps?.lng,
        vendedor_id: user?.id,
        vendedor: user?.name,
      });

      // Subir documentos adjuntos si se seleccionaron
      if (docIneFrontal && nuevo?.id) {
        await uploadClientDocument(nuevo.id, 'ine_frontal', docIneFrontal).catch(() => {});
      }
      if (docIneReverso && nuevo?.id) {
        await uploadClientDocument(nuevo.id, 'ine_reverso', docIneReverso).catch(() => {});
      }
      if (docCsf && nuevo?.id) {
        await uploadClientDocument(nuevo.id, 'csf', docCsf).catch(() => {});
      }

      Alert.alert(
        'Cliente Registrado',
        `El cliente ${nuevo.nombre} fue creado a CONTADO sin crédito. Podrá tramitar crédito posteriormente con Supervisión.`
      );

      setNuevoModalVisible(false);
      loadData();
    } catch (err: any) {
      Alert.alert('Error al crear cliente', err.message || 'No se pudo registrar el cliente.');
    } finally {
      setSubmittingNuevo(false);
    }
  };

  // Semáforo Badge Component
  const renderSemaforo = (sem?: SemaforoCrediticio) => {
    if (!sem) return null;
    const bg = sem.color === 'verde' ? '#E8F5E9' : sem.color === 'amarillo' ? '#FFF8E1' : '#FFEBEE';
    const textCol = sem.color === 'verde' ? '#2E7D32' : sem.color === 'amarillo' ? '#F57F17' : '#C62828';
    const dotCol = sem.color === 'verde' ? '#00E676' : sem.color === 'amarillo' ? '#FFD600' : '#FF1744';

    return (
      <View style={[styles.semaforoBadge, { backgroundColor: bg }]}>
        <View style={[styles.semaforoDot, { backgroundColor: dotCol }]} />
        <Text style={[styles.semaforoText, { color: textCol }]}>{sem.badge}</Text>
      </View>
    );
  };

  const renderClientCard = ({ item }: { item: Client }) => {
    const assigned = isAssignedToMe(item);
    const hasSaldo = (item.saldo || 0) > 0;
    const hasVencido = (item.vencido || 0) > 0;

    return (
      <TouchableOpacity
        style={styles.clientCard}
        onPress={() => setSelectedClient(item)}
        activeOpacity={0.8}
      >
        {/* Cabecera Tarjeta */}
        <View style={styles.cardHeaderRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              {item.codigo ? <Text style={styles.clientCode}>{item.codigo}</Text> : null}
              <View
                style={[
                  styles.assignTag,
                  assigned ? styles.assignTagMine : styles.assignTagOther,
                ]}
              >
                <Text
                  style={[
                    styles.assignTagText,
                    assigned ? styles.assignTagTextMine : styles.assignTagTextOther,
                  ]}
                >
                  {assigned ? 'Mi Cartera' : 'General'}
                </Text>
              </View>
              {assigned && renderSemaforo(item.semaforo)}
            </View>
            <Text style={styles.clientName} numberOfLines={1}>
              {item.nombre}
            </Text>
          </View>
        </View>

        {/* Datos Financieros & Semáforo Resumen */}
        <View style={styles.cardFinanceRow}>
          <View style={styles.financeCol}>
            <Text style={styles.financeLabel}>Saldo Pendiente</Text>
            {assigned ? (
              <Text style={[styles.financeValue, hasSaldo && { color: '#D32F2F' }]}>
                {formatCurrency(item.saldo)}
              </Text>
            ) : (
              <Text style={styles.financeProtected}>🔒 Reservado</Text>
            )}
          </View>

          <View style={styles.financeCol}>
            <Text style={styles.financeLabel}>Vencido</Text>
            {assigned ? (
              <Text style={[styles.financeValue, hasVencido ? { color: '#C62828' } : { color: '#2E7D32' }]}>
                {formatCurrency(item.vencido)}
              </Text>
            ) : (
              <Text style={styles.financeProtected}>🔒 Reservado</Text>
            )}
          </View>

          <View style={styles.financeCol}>
            <Text style={styles.financeLabel}>Condición</Text>
            {assigned ? (
              <Text style={styles.financeSub}>{item.condicion_pago?.toUpperCase() || 'CONTADO'}</Text>
            ) : (
              <Text style={styles.financeProtected}>—</Text>
            )}
          </View>
        </View>

        {assigned && item.semaforo?.resumen ? (
          <View style={styles.resumenRow}>
            <MaterialIcons
              name="info-outline"
              size={12}
              color={item.semaforo.color === 'rojo' ? '#C62828' : '#718096'}
            />
            <Text style={styles.resumenText} numberOfLines={1}>
              {item.semaforo.resumen}
            </Text>
          </View>
        ) : null}

        {/* Ubicación y Botones Rápidos */}
        <View style={styles.cardActionFooter}>
          <View style={styles.locationWrap}>
            <MaterialIcons
              name={assigned ? 'place' : 'location-city'}
              size={14}
              color={assigned ? '#D32F2F' : '#718096'}
            />
            <Text style={styles.locationText} numberOfLines={1}>
              {assigned
                ? item.direccion || item.ciudad || 'Sin dirección'
                : item.ciudad || '🔒 Ubicación reservada'}
            </Text>
          </View>

          <View style={styles.actionRowBtns}>
            <TouchableOpacity
              style={styles.quickVenderBtn}
              onPress={() => {
                setSelectedClient(null);
                router.push({ pathname: '/pedidos', params: { cliente_id: item.id } } as any);
              }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add-shopping-cart" size={13} color="#FFFFFF" />
              <Text style={styles.quickVenderText}>Vender</Text>
            </TouchableOpacity>

            {assigned && hasSaldo && (
              <TouchableOpacity
                style={styles.quickAbonoBtn}
                onPress={() => handleOpenAbono(item)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="payments" size={14} color="#FFFFFF" />
                <Text style={styles.quickAbonoText}>Abonar</Text>
              </TouchableOpacity>
            )}

            {item.telefono ? (
              <TouchableOpacity
                style={styles.quickCallBtn}
                onPress={() => handleCall(item.telefono)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="phone" size={14} color="#2D3748" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const isSelectedAssigned = selectedClient ? isAssignedToMe(selectedClient) : false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ConnectivityBar onManualSync={loadData} />

      {/* Header Institucional Unificado de Cartera */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View>
            <Text style={styles.headerTitle}>Cartera & Clientes</Text>
            <Text style={styles.headerSubtitle}>
              {user?.name || 'Vendedor'} • {myClients.length} asignados
            </Text>
          </View>

          {/* Botón "+ Nuevo Cliente" */}
          <TouchableOpacity
            style={styles.newClientBtn}
            onPress={handleOpenNuevoCliente}
            activeOpacity={0.8}
          >
            <MaterialIcons name="person-add" size={16} color="#FFFFFF" />
            <Text style={styles.newClientBtnText}>+ Nuevo</Text>
          </TouchableOpacity>
        </View>

        {/* Banner de Modo Offline */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={14} color="#FFB300" />
            <Text style={styles.offlineBannerText}>
              Modo Sin Conexión • Mostrando cartera en caché ({clients.length} clientes)
            </Text>
          </View>
        )}

        {/* Tarjetas de Métricas de Cartera a Crédito */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Cartera Total</Text>
            <Text style={styles.kpiValue}>
              {formatCurrency(cxcSummary.saldo_total || debtClients.reduce((acc, c) => acc + (c.saldo || 0), 0))}
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Mora / Vencido</Text>
            <Text style={[styles.kpiValue, { color: '#EF5350' }]}>
              {formatCurrency(cxcSummary.vencido || debtClients.reduce((acc, c) => acc + (c.vencido || 0), 0))}
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Cobrado Hoy</Text>
            <Text style={[styles.kpiValue, { color: '#69F0AE' }]}>
              {formatCurrency(cxcSummary.cobrado_hoy || 0)}
            </Text>
          </View>
        </View>

        {/* Buscador */}
        <View style={styles.searchInputWrap}>
          <MaterialIcons name="search" size={20} color="#718096" style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por cliente, código o teléfono..."
            placeholderTextColor="#A0AEC0"
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <MaterialIcons name="close" size={18} color="#718096" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Pestañas de Filtro */}
        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'mi_cartera' && styles.tabBtnActive]}
            onPress={() => setActiveTab('mi_cartera')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'mi_cartera' && styles.tabBtnTextActive]}>
              Mi Cartera ({myClients.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'con_saldo' && styles.tabBtnActive]}
            onPress={() => setActiveTab('con_saldo')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'con_saldo' && styles.tabBtnTextActive]}>
              Con Saldo ({debtClients.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'todos' && styles.tabBtnActive]}
            onPress={() => setActiveTab('todos')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'todos' && styles.tabBtnTextActive]}>
              General ({clients.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Lista de Clientes */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#D32F2F" />
          <Text style={styles.loadingText}>Cargando cartera de clientes...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderClientCard}
          contentContainerStyle={[
            styles.listContainer,
            { paddingBottom: Math.max(insets.bottom, 16) + 60 },
          ]}
          initialNumToRender={12}
          maxToRenderPerBatch={16}
          windowSize={7}
          removeClippedSubviews={true}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadData();
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <MaterialIcons name="folder-off" size={48} color="#CBD5E0" />
              <Text style={styles.emptyTitle}>Sin clientes encontrados</Text>
              <Text style={styles.emptyDesc}>
                No hay clientes que coincidan con la búsqueda o filtro seleccionado.
              </Text>
            </View>
          }
        />
      )}

      {/* Modal Detalle Cliente con Productos Frecuentes y Acciones */}
      <Modal
        visible={!!selectedClient && !abonoModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedClient(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <Text style={styles.modalClientCode}>{selectedClient?.codigo || 'CLIENTE'}</Text>
                  {selectedClient && renderSemaforo(selectedClient.semaforo)}
                </View>
                <Text style={styles.modalClientName} numberOfLines={2}>
                  {selectedClient?.nombre}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedClient(null)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={24} color="#718096" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {isSelectedAssigned ? (
                <>
                  {/* Resumen Financiero */}
                  <View style={styles.modalSectionCard}>
                    <Text style={styles.modalSectionTitle}>Estado Financiero & Crédito</Text>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Saldo Pendiente:</Text>
                      <Text style={[styles.infoValue, { color: '#D32F2F', fontWeight: '800' }]}>
                        {formatCurrency(selectedClient?.saldo)}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Saldo Vencido:</Text>
                      <Text style={[styles.infoValue, { color: '#C62828', fontWeight: '700' }]}>
                        {formatCurrency(selectedClient?.vencido)}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Límite de Crédito:</Text>
                      <Text style={styles.infoValue}>
                        {formatCurrency(selectedClient?.limite_credito)}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Días de Crédito:</Text>
                      <Text style={styles.infoValue}>{selectedClient?.dias_credito || 0} días</Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.protectedNotice}>
                  <MaterialIcons name="lock" size={26} color="#E53935" />
                  <Text style={styles.protectedTitle}>Saldos y Crédito Reservados</Text>
                  <Text style={styles.protectedDesc}>
                    Este cliente pertenece a otra cartera comercial. La información de crédito y saldos está protegida.
                  </Text>
                </View>
              )}

              {/* Historial de Compras / Ventas y Pedidos */}
              <View style={styles.modalSectionCard}>
                <Text style={styles.modalSectionTitle}>Historial de Compras / Pedidos</Text>
                {loadingHistory ? (
                  <ActivityIndicator size="small" color="#D32F2F" style={{ marginVertical: 8 }} />
                ) : orderHistory.length === 0 ? (
                  <Text style={styles.frecuenteEmpty}>Sin compras ni pedidos registrados.</Text>
                ) : (
                  orderHistory.map((h, hIdx) => (
                    <View key={h.id || hIdx} style={styles.historyRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={styles.historyFolio}>{h.folio}</Text>
                          <Text style={styles.historyFecha}>{(h.fecha || '').slice(0, 10)}</Text>
                          {h.vendido_por_mi ? (
                            <View style={styles.badgeVendidoPorMi}>
                              <Text style={styles.badgeVendidoPorMiText}>⭐ Vendido por ti</Text>
                            </View>
                          ) : (
                            <View style={styles.badgeVendidoPorOtro}>
                              <Text style={styles.badgeVendidoPorOtroText}>Vendido por: {h.vendedor_nombre || 'Asesor'}</Text>
                            </View>
                          )}
                        </View>
                        {h.resumen_items ? (
                          <Text style={styles.historyItems} numberOfLines={1}>
                            {h.resumen_items}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.historyTotal}>{formatCurrency(h.total)}</Text>
                    </View>
                  ))
                )}
              </View>

              {/* Productos Frecuentes */}
              <View style={styles.modalSectionCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.modalSectionTitle}>Productos Frecuentes</Text>
                  <MaterialIcons name="repeat" size={16} color="#718096" />
                </View>

                {loadingFrecuentes ? (
                  <ActivityIndicator size="small" color="#D32F2F" style={{ marginVertical: 8 }} />
                ) : frecuentes.length === 0 ? (
                  <Text style={styles.emptyFrecuentesText}>
                    No hay compras frecuentes registradas aún.
                  </Text>
                ) : (
                  frecuentes.map((f, i) => (
                    <View key={i} style={styles.frecuenteRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={styles.frecuenteName} numberOfLines={1}>
                          {f.nombre}
                        </Text>
                        <Text style={styles.frecuenteSub}>
                          {f.veces_comprado} compras • {formatCurrency(f.ultimo_precio)}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.addFrecuenteBtn}
                        onPress={() => {
                          setSelectedClient(null);
                          router.push('/pedidos' as any);
                        }}
                      >
                        <MaterialIcons name="add" size={16} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>

              {isSelectedAssigned && (
                <>
                  {/* Expediente y Documentos */}
                  <View style={styles.modalSectionCard}>
                    <Text style={styles.modalSectionTitle}>Expediente de Documentos</Text>
                    <View style={styles.docRow}>
                      <Text style={styles.docLabel}>INE Frontal:</Text>
                      <Text style={selectedClient?.documentos?.ine_frontal ? styles.docOk : styles.docPending}>
                        {selectedClient?.documentos?.ine_frontal ? '✅ Registrada' : '❌ Pendiente'}
                      </Text>
                    </View>
                    <View style={styles.docRow}>
                      <Text style={styles.docLabel}>INE Reverso:</Text>
                      <Text style={selectedClient?.documentos?.ine_reverso ? styles.docOk : styles.docPending}>
                        {selectedClient?.documentos?.ine_reverso ? '✅ Registrada' : '❌ Pendiente'}
                      </Text>
                    </View>
                    <View style={styles.docRow}>
                      <Text style={styles.docLabel}>Constancia Fiscal (CSF):</Text>
                      <Text style={selectedClient?.documentos?.csf ? styles.docOk : styles.docPending}>
                        {selectedClient?.documentos?.csf ? '✅ Registrada' : '❌ Pendiente'}
                      </Text>
                    </View>
                  </View>

                  {/* GPS In-Situ */}
                  <View style={styles.modalSectionCard}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View>
                        <Text style={styles.modalSectionTitle}>Geolocalización GPS</Text>
                        <Text style={styles.gpsCoordsText}>
                          {selectedClient?.latitud && selectedClient?.longitud
                            ? `${selectedClient.latitud.toFixed(5)}, ${selectedClient.longitud.toFixed(5)}`
                            : 'Sin coordenadas asignadas'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.captureGpsBtn, capturingGps && { opacity: 0.6 }]}
                        onPress={() => selectedClient && handleCaptureGpsInSitu(selectedClient)}
                        disabled={capturingGps}
                      >
                        {capturingGps ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <>
                            <MaterialIcons name="my-location" size={14} color="#FFFFFF" />
                            <Text style={styles.captureGpsText}>Capturar GPS</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>

            {/* Botones de Acción en el Detalle */}
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#D32F2F' }]}
                onPress={() => {
                  setSelectedClient(null);
                  router.push('/pedidos' as any);
                }}
              >
                <MaterialIcons name="shopping-cart" size={18} color="#FFFFFF" />
                <Text style={styles.actionBtnText}>Vender</Text>
              </TouchableOpacity>

              {isSelectedAssigned && (selectedClient?.saldo || 0) > 0 && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#2E7D32' }]}
                  onPress={() => setAbonoModalVisible(true)}
                >
                  <MaterialIcons name="payments" size={18} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>Abonar</Text>
                </TouchableOpacity>
              )}

              {selectedClient?.telefono && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#25D366' }]}
                  onPress={() => handleWhatsApp(selectedClient.whatsapp || selectedClient.telefono)}
                >
                  <MaterialIcons name="chat" size={18} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>WhatsApp</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Registrar Abono */}
      <Modal
        visible={abonoModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setAbonoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.abonoContent, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.abonoTitle}>Registrar Abono a Cartera</Text>
                <Text style={styles.abonoClient}>{selectedClient?.nombre}</Text>
              </View>
              <TouchableOpacity onPress={() => setAbonoModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#718096" />
              </TouchableOpacity>
            </View>

            <View style={styles.abonoCurrentBox}>
              <Text style={styles.abonoCurrentLabel}>Saldo Pendiente:</Text>
              <Text style={styles.abonoCurrentValue}>
                {formatCurrency(selectedClient?.saldo)}
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Monto a Abonar ($):</Text>
            <TextInput
              style={styles.abonoInput}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#A0AEC0"
              value={montoAbono}
              onChangeText={setMontoAbono}
            />

            <Text style={styles.fieldLabel}>Método de Pago:</Text>
            <View style={styles.metodosRow}>
              {['efectivo', 'transferencia', 'deposito', 'tarjeta'].map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.metodoBtn, metodoAbono === m && styles.metodoBtnActive]}
                  onPress={() => setMetodoAbono(m)}
                >
                  <Text style={[styles.metodoText, metodoAbono === m && styles.metodoTextActive]}>
                    {m.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Referencia / Folio Banco (opcional):</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="Ej. Transferencia #128472"
              placeholderTextColor="#A0AEC0"
              value={referenciaAbono}
              onChangeText={setReferenciaAbono}
            />

            <Text style={styles.fieldLabel}>Nota interna:</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="Observación del cobro..."
              placeholderTextColor="#A0AEC0"
              value={notaAbono}
              onChangeText={setNotaAbono}
            />

            {/* Evidencia Fotográfica / Comprobante */}
            <Text style={styles.fieldLabel}>Evidencia Fotográfica / Comprobante:</Text>
            <View style={styles.evidencePickerRow}>
              <TouchableOpacity
                style={styles.evidencePickBtn}
                onPress={handleTakeAbonoPhoto}
              >
                <MaterialIcons name="camera-alt" size={18} color="#D32F2F" />
                <Text style={styles.evidencePickBtnText}>Cámara</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.evidencePickBtn}
                onPress={handlePickAbonoGallery}
              >
                <MaterialIcons name="photo-library" size={18} color="#1565C0" />
                <Text style={[styles.evidencePickBtnText, { color: '#1565C0' }]}>Galería</Text>
              </TouchableOpacity>
            </View>

            {abonoEvidencia ? (
              <View style={styles.evidencePreviewContainer}>
                <Image source={{ uri: abonoEvidencia.uri }} style={styles.evidenceThumb} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.evidenceOkText}>✅ Evidencia cargada</Text>
                  <TouchableOpacity onPress={() => setAbonoEvidencia(null)}>
                    <Text style={styles.evidenceRemoveText}>Eliminar foto</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <Text style={styles.evidenceHint}>
                * Opcional pero recomendada para agilizar la aprobación de Gerencia.
              </Text>
            )}

            <TouchableOpacity
              style={[styles.confirmAbonoBtn, submittingAbono && { opacity: 0.7 }]}
              onPress={handleConfirmAbono}
              disabled={submittingAbono}
            >
              {submittingAbono ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialIcons name="check-circle" size={20} color="#FFFFFF" />
                  <Text style={styles.confirmAbonoText}>Confirmar Abono</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal Nuevo Cliente (Exclusivo Contado en Campo) */}
      <Modal
        visible={nuevoModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setNuevoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalClientName}>Nuevo Cliente en Campo</Text>
                <Text style={styles.cashOnlyTag}>🔒 Modo Contado Exclusivo</Text>
              </View>
              <TouchableOpacity onPress={() => setNuevoModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#718096" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
              {/* Aviso Institucional */}
              <View style={styles.cashBanner}>
                <MaterialIcons name="info" size={18} color="#D32F2F" />
                <Text style={styles.cashBannerText}>
                  Por seguridad comercial, los nuevos clientes registrados en campo se crean a CONTADO sin crédito. La solicitud de crédito se tramita posteriormente con sus documentos ante Supervisión.
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Nombre o Razón Social *:</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="Nombre del cliente o negocio"
                placeholderTextColor="#A0AEC0"
                value={nuevoNombre}
                onChangeText={setNuevoNombre}
              />

              <Text style={styles.fieldLabel}>Contacto / Encargado:</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="Nombre de la persona de contacto"
                placeholderTextColor="#A0AEC0"
                value={nuevoContacto}
                onChangeText={setNuevoContacto}
              />

              <Text style={styles.fieldLabel}>Teléfono / Celular *:</Text>
              <TextInput
                style={styles.fieldInput}
                keyboardType="phone-pad"
                placeholder="10 dígitos"
                placeholderTextColor="#A0AEC0"
                value={nuevoTelefono}
                onChangeText={setNuevoTelefono}
              />

              <Text style={styles.fieldLabel}>RFC (Default Genérico):</Text>
              <TextInput
                style={styles.fieldInput}
                autoCapitalize="characters"
                value={nuevoRfc}
                onChangeText={setNuevoRfc}
              />

              <Text style={styles.fieldLabel}>Dirección Completa:</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="Calle, Número, Colonia"
                placeholderTextColor="#A0AEC0"
                value={nuevoDireccion}
                onChangeText={setNuevoDireccion}
              />

              <Text style={styles.fieldLabel}>Ciudad / Municipio:</Text>
              <TextInput
                style={styles.fieldInput}
                value={nuevoCiudad}
                onChangeText={setNuevoCiudad}
              />

              {/* Geolocalización */}
              <View style={styles.gpsPickRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Ubicación GPS:</Text>
                  <Text style={styles.gpsCoordsText}>
                    {nuevoGps ? `${nuevoGps.lat}, ${nuevoGps.lng}` : 'Sin capturar'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.gpsPickBtn}
                  onPress={handleCapturarGpsNuevo}
                >
                  <MaterialIcons name="my-location" size={16} color="#FFFFFF" />
                  <Text style={styles.gpsPickBtnText}>GPS Aquí</Text>
                </TouchableOpacity>
              </View>

              {/* Carga de Documentos (INE y CSF) */}
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Documentación para Expediente:</Text>

              <TouchableOpacity
                style={[styles.filePickBtn, docIneFrontal && styles.filePickBtnSelected]}
                onPress={() => handlePickFile('ine_frontal')}
              >
                <MaterialIcons
                  name={docIneFrontal ? 'check-circle' : 'camera-alt'}
                  size={18}
                  color={docIneFrontal ? '#2E7D32' : '#718096'}
                />
                <Text style={styles.filePickText} numberOfLines={1}>
                  {docIneFrontal ? `INE Frontal: ${docIneFrontal.name}` : 'Subir INE (Frontal)'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filePickBtn, docIneReverso && styles.filePickBtnSelected]}
                onPress={() => handlePickFile('ine_reverso')}
              >
                <MaterialIcons
                  name={docIneReverso ? 'check-circle' : 'camera-alt'}
                  size={18}
                  color={docIneReverso ? '#2E7D32' : '#718096'}
                />
                <Text style={styles.filePickText} numberOfLines={1}>
                  {docIneReverso ? `INE Reverso: ${docIneReverso.name}` : 'Subir INE (Reverso)'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filePickBtn, docCsf && styles.filePickBtnSelected]}
                onPress={() => handlePickFile('csf')}
              >
                <MaterialIcons
                  name={docCsf ? 'check-circle' : 'description'}
                  size={18}
                  color={docCsf ? '#2E7D32' : '#718096'}
                />
                <Text style={styles.filePickText} numberOfLines={1}>
                  {docCsf ? `CSF: ${docCsf.name}` : 'Subir Constancia Situación Fiscal (CSF / PDF)'}
                </Text>
              </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity
              style={[styles.saveClientBtn, submittingNuevo && { opacity: 0.7 }]}
              onPress={handleGuardarNuevoCliente}
              disabled={submittingNuevo}
            >
              {submittingNuevo ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialIcons name="person-add" size={18} color="#FFFFFF" />
                  <Text style={styles.saveClientBtnText}>Registrar Cliente a Contado</Text>
                </>
              )}
            </TouchableOpacity>
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
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#CBD5E0',
    marginTop: 1,
  },
  newClientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D32F2F',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  newClientBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  kpiLabel: {
    fontSize: 9,
    color: '#A0AEC0',
    fontWeight: '600',
  },
  kpiValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: '#1A202C',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  tabBtnActive: {
    backgroundColor: '#D32F2F',
  },
  tabBtnText: {
    fontSize: 11,
    color: '#CBD5E0',
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 10,
    color: '#718096',
    fontSize: 13,
  },
  listContainer: {
    padding: 12,
    gap: 10,
  },
  clientCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  clientCode: {
    fontSize: 10,
    fontWeight: '800',
    color: '#718096',
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  assignTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  assignTagMine: {
    backgroundColor: '#E8F5E9',
  },
  assignTagOther: {
    backgroundColor: '#EDF2F7',
  },
  assignTagText: {
    fontSize: 9,
    fontWeight: '700',
  },
  assignTagTextMine: {
    color: '#2E7D32',
  },
  assignTagTextOther: {
    color: '#718096',
  },
  clientName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A202C',
  },
  semaforoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    gap: 4,
  },
  semaforoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  semaforoText: {
    fontSize: 9,
    fontWeight: '800',
  },
  cardFinanceRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    marginVertical: 6,
  },
  financeCol: {
    flex: 1,
  },
  financeLabel: {
    fontSize: 9,
    color: '#718096',
    fontWeight: '600',
  },
  financeValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1A202C',
    marginTop: 1,
  },
  financeSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5568',
    marginTop: 1,
  },
  financeProtected: {
    fontSize: 10,
    color: '#A0AEC0',
    fontStyle: 'italic',
    marginTop: 1,
  },
  resumenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  resumenText: {
    fontSize: 10,
    color: '#718096',
    fontWeight: '600',
  },
  cardActionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    paddingTop: 6,
  },
  locationWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    marginRight: 8,
  },
  locationText: {
    fontSize: 10,
    color: '#718096',
  },
  actionRowBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickVenderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D32F2F',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 3,
  },
  quickVenderText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  quickAbonoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2E7D32',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 3,
  },
  quickAbonoText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  quickCallBtn: {
    backgroundColor: '#EDF2F7',
    padding: 5,
    borderRadius: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    paddingBottom: 8,
  },
  modalClientCode: {
    fontSize: 11,
    fontWeight: '800',
    color: '#718096',
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modalClientName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A202C',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalSectionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  modalSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: 6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  infoLabel: {
    fontSize: 11,
    color: '#718096',
  },
  infoValue: {
    fontSize: 12,
    color: '#1A202C',
  },
  frecuenteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  frecuenteName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D3748',
  },
  frecuenteSub: {
    fontSize: 10,
    color: '#718096',
  },
  addFrecuenteBtn: {
    backgroundColor: '#D32F2F',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyFrecuentesText: {
    fontSize: 11,
    color: '#A0AEC0',
    fontStyle: 'italic',
  },
  docRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 3,
  },
  docLabel: {
    fontSize: 11,
    color: '#4A5568',
  },
  docOk: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2E7D32',
  },
  docPending: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C62828',
  },
  gpsCoordsText: {
    fontSize: 10,
    color: '#718096',
    marginTop: 2,
  },
  captureGpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
  },
  captureGpsText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  protectedNotice: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 6,
  },
  protectedTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#C62828',
  },
  protectedDesc: {
    fontSize: 11,
    color: '#718096',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  abonoContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  abonoTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A202C',
  },
  abonoClient: {
    fontSize: 12,
    color: '#718096',
    marginTop: 1,
  },
  abonoCurrentBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 8,
    marginVertical: 10,
  },
  abonoCurrentLabel: {
    fontSize: 12,
    color: '#C62828',
    fontWeight: '700',
  },
  abonoCurrentValue: {
    fontSize: 14,
    color: '#D32F2F',
    fontWeight: '800',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5568',
    marginBottom: 4,
    marginTop: 6,
  },
  abonoInput: {
    borderWidth: 2,
    borderColor: '#2E7D32',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 18,
    fontWeight: '800',
    color: '#1A202C',
    marginBottom: 8,
  },
  metodosRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  metodoBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
  },
  metodoBtnActive: {
    backgroundColor: '#2E7D32',
    borderColor: '#2E7D32',
  },
  metodoText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4A5568',
  },
  metodoTextActive: {
    color: '#FFFFFF',
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    color: '#1A202C',
    marginBottom: 6,
  },
  confirmAbonoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2E7D32',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
    marginTop: 12,
  },
  confirmAbonoText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  cashOnlyTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#C62828',
    marginTop: 2,
  },
  cashBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF5F5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#D32F2F',
  },
  cashBannerText: {
    flex: 1,
    fontSize: 11,
    color: '#C53030',
    lineHeight: 15,
  },
  gpsPickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    marginVertical: 6,
  },
  gpsPickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  gpsPickBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  filePickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    borderRadius: 8,
    gap: 8,
    marginBottom: 6,
  },
  filePickBtnSelected: {
    borderColor: '#2E7D32',
    backgroundColor: '#E8F5E9',
  },
  filePickText: {
    fontSize: 11,
    color: '#2D3748',
    fontWeight: '600',
    flex: 1,
  },
  saveClientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D32F2F',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
    marginTop: 10,
  },
  saveClientBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2D3748',
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
    textAlign: 'center',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 179, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 179, 0, 0.4)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
    marginBottom: 4,
    gap: 6,
  },
  offlineBannerText: {
    color: '#FFD54F',
    fontSize: 11,
    fontWeight: '700',
  },
  // Historial de compras styles
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  historyFolio: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1A202C',
  },
  historyFecha: {
    fontSize: 10,
    color: '#718096',
  },
  historyItems: {
    fontSize: 11,
    color: '#4A5568',
    marginTop: 2,
  },
  historyTotal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2E7D32',
  },
  frecuenteEmpty: {
    fontSize: 11,
    color: '#A0AEC0',
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  badgeVendidoPorMi: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeVendidoPorMiText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#2E7D32',
  },
  badgeVendidoPorOtro: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeVendidoPorOtroText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#4A5568',
  },
  // Evidencia de abono styles
  evidencePickerRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  evidencePickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
  },
  evidencePickBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D32F2F',
  },
  evidencePreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  evidenceThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: '#CBD5E0',
  },
  evidenceOkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2E7D32',
  },
  evidenceRemoveText: {
    fontSize: 11,
    color: '#C62828',
    fontWeight: '600',
    marginTop: 2,
    textDecorationLine: 'underline',
  },
  evidenceHint: {
    fontSize: 10,
    color: '#718096',
    fontStyle: 'italic',
    marginBottom: 8,
  },
});
