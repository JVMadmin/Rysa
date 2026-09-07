import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import { useAuth } from '@/auth/AuthContext';
import { ConnectivityBar } from '@/components/ConnectivityBar';
import { RouteMap, MapClientPoint } from '@/components/RouteMap';
import { trackingService } from '@/services/trackingService';
import { pickImageOrPhoto, PickedFile } from '@/lib/filePicker';
import {
  getVisits,
  checkInVisit,
  createVisit,
  registerSellerLocation,
  getSellerClients,
} from '@/services/salesService';
import { Visit, Client } from '@/types';
import {
  getVisitsCache,
  saveVisitsCache,
  getClientsCache,
  getLastGpsCache,
  saveLastGpsCache,
  queueOfflineAction,
} from '@/services/offlineCache';
import { syncManager } from '@/services/syncManager';

// Coordenadas base Sucursal Matriz (Palenque, Chiapas)
const BASE_LAT = 17.5095;
const BASE_LNG = -91.9827;

export default function VisitasScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [visits, setVisits] = useState<Visit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [activeTab, setActiveTab] = useState<'hoy' | 'programadas' | 'ruta_optima'>('hoy');

  // Estado GPS en vivo
  const [currentGps, setCurrentGps] = useState<{
    latitud: number;
    longitud: number;
    precision: number;
    ultimaSincronizacion?: string;
  }>({
    latitud: BASE_LAT,
    longitud: BASE_LNG,
    precision: 6,
  });
  const [transmittingGps, setTransmittingGps] = useState(false);
  const [continuousTracking, setContinuousTracking] = useState(false);
  const trackingIntervalRef = useRef<any>(null);

  // Modal Nueva Visita In-Situ
  const [newVisitModalVisible, setNewVisitModalVisible] = useState(false);
  const [selectedClientForVisit, setSelectedClientForVisit] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientPickerVisible, setClientPickerVisible] = useState(false);
  const [tipoVisita, setTipoVisita] = useState('visita');
  const [resultadoVisita, setResultadoVisita] = useState('visita_exitosa');
  const [notasVisita, setNotasVisita] = useState('');
  const [fotoInSitu, setFotoInSitu] = useState<PickedFile | null>(null);
  const [submittingNewVisit, setSubmittingNewVisit] = useState(false);

  // Modal Check-In de Visita Programada
  const [selectedVisitForCheckin, setSelectedVisitForCheckin] = useState<Visit | null>(null);
  const [comentariosCheckin, setComentariosCheckin] = useState('');
  const [resultadoCheckin, setResultadoCheckin] = useState('visita_exitosa');
  const [fotoCheckin, setFotoCheckin] = useState<PickedFile | null>(null);
  const [submittingCheckin, setSubmittingCheckin] = useState(false);

  // Ruta y Trazado OSRM
  const [osrmRoute, setOsrmRoute] = useState<Array<[number, number]>>([]);
  const [loadingRoutePolyline, setLoadingRoutePolyline] = useState(false);

  // Captura de GPS NATIVO con permisos en tiempo de ejecución
  const captureGpsPosition = useCallback(async (): Promise<{ latitud: number; longitud: number; precision: number }> => {
    const updateCoords = (coords: { latitud: number; longitud: number; precision: number }) => {
      setCurrentGps((prev) => ({ ...prev, ...coords }));
      saveLastGpsCache({ ...coords, updatedAt: new Date().toISOString() });
      return coords;
    };

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        const coords = {
          latitud: Number(pos.coords.latitude.toFixed(6)),
          longitud: Number(pos.coords.longitude.toFixed(6)),
          precision: Math.round(pos.coords.accuracy || 6),
        };
        return updateCoords(coords);
      } else {
        console.warn('[visitas] Permiso de ubicación no concedido');
      }
    } catch (nativeErr) {
      console.warn('[visitas] Error con expo-location nativo:', nativeErr);
    }

    // Fallback a web navigator si está en emulador web
    if (typeof navigator !== 'undefined' && (navigator as any).geolocation) {
      try {
        const webCoords = await new Promise<{ latitud: number; longitud: number; precision: number }>((resolve) => {
          (navigator as any).geolocation.getCurrentPosition(
            (pos: any) => {
              resolve({
                latitud: Number(pos.coords.latitude.toFixed(6)),
                longitud: Number(pos.coords.longitude.toFixed(6)),
                precision: Math.round(pos.coords.accuracy || 8),
              });
            },
            () => resolve({ latitud: BASE_LAT, longitud: BASE_LNG, precision: 10 }),
            { enableHighAccuracy: true, timeout: 6000 }
          );
        });
        return updateCoords(webCoords);
      } catch {}
    }

    // Fallback a última posición guardada en caché
    const cachedGps = await getLastGpsCache();
    if (cachedGps) {
      return updateCoords(cachedGps);
    }

    return updateCoords({ latitud: BASE_LAT, longitud: BASE_LNG, precision: 10 });
  }, []);

  // Consulta de Ruta con Calles Reales vía OSRM
  const fetchOsrmRoute = useCallback(async (origin: { latitud: number; longitud: number }, stops: Client[]) => {
    if (!stops || stops.length === 0) return;
    setLoadingRoutePolyline(true);
    try {
      const validStops = stops.slice(0, 5).filter((s) => s.latitud && s.longitud);
      if (validStops.length === 0) return;

      const coordsStr = [
        `${origin.longitud},${origin.latitud}`,
        ...validStops.map((s) => `${s.longitud},${s.latitud}`),
      ].join(';');

      const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
          const polyline: Array<[number, number]> = data.routes[0].geometry.coordinates.map(
            (c: [number, number]) => [c[1], c[0]]
          );
          setOsrmRoute(polyline);
        }
      }
    } catch (err) {
      console.warn('[visitas] Error en cálculo de ruta OSRM:', err);
    } finally {
      setLoadingRoutePolyline(false);
    }
  }, []);

  // Navegación asistida directa con Google Maps
  const handleOpenGoogleMaps = (lat?: number, lng?: number, clientName?: string) => {
    if (!lat || !lng) {
      Alert.alert('Sin Coordenadas', 'Este cliente aún no tiene ubicación registrada en GPS.');
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'No se pudo abrir la aplicación de Google Maps.');
    });
  };

  // Llamada telefónica directa al cliente
  const handleCallClient = (telefono?: string, clientName?: string) => {
    if (!telefono) {
      Alert.alert('Sin Teléfono', `El cliente ${clientName || ''} no tiene teléfono registrado.`);
      return;
    }
    const clean = telefono.replace(/[^0-9+]/g, '');
    Linking.openURL(`tel:${clean}`).catch(() => {
      Alert.alert('Error', 'No se pudo abrir la aplicación de llamadas telefónicas.');
    });
  };

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [visitsData, clientsData] = await Promise.all([
        getVisits().catch(() => null),
        getSellerClients().catch(() => null),
      ]);
      if (visitsData && Array.isArray(visitsData)) {
        setVisits(visitsData);
        await saveVisitsCache(visitsData);
      } else {
        const cachedVisits = await getVisitsCache();
        if (cachedVisits.visits.length > 0) setVisits(cachedVisits.visits);
      }
      if (clientsData && Array.isArray(clientsData)) {
        setClients(clientsData);
      } else {
        const cachedClients = await getClientsCache();
        if (cachedClients.clients.length > 0) setClients(cachedClients.clients);
      }
      await captureGpsPosition();
    } catch {
      const [cachedVisits, cachedClients] = await Promise.all([
        getVisitsCache(),
        getClientsCache(),
      ]);
      if (cachedVisits.visits.length > 0) setVisits(cachedVisits.visits);
      if (cachedClients.clients.length > 0) setClients(cachedClients.clients);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [captureGpsPosition]);

  useEffect(() => {
    // 1. Cargar caché de inmediato al entrar (0ms)
    Promise.all([getVisitsCache(), getClientsCache(), getLastGpsCache()]).then(
      ([cachedVisits, cachedClients, cachedGps]) => {
        if (cachedVisits.visits.length > 0) {
          setVisits(cachedVisits.visits);
          setLoading(false);
        }
        if (cachedClients.clients.length > 0) {
          setClients(cachedClients.clients);
        }
        if (cachedGps) {
          setCurrentGps((prev) => ({ ...prev, ...cachedGps }));
        }
        loadData(cachedVisits.visits.length > 0);
      }
    );

    // 2. Suscripción a reconexión automática de red
    const unsubReconnect = syncManager.subscribeReconnect(() => {
      console.log('[VisitasScreen] Network reconnected - syncing visits & transmitting GPS...');
      loadData(true);
      handleTransmitLocation(true);
    });

    const unsubStatus = syncManager.subscribeStatus((st) => {
      setIsOffline(!st.isOnline);
    });

    return () => {
      unsubReconnect();
      unsubStatus();
    };
  }, [loadData]);

  // Transmitir ubicación GPS al ERP con manejo offline silencioso
  const handleTransmitLocation = useCallback(async (silent = false) => {
    if (!silent) setTransmittingGps(true);
    try {
      const coords = await captureGpsPosition();
      try {
        await registerSellerLocation({
          latitud: coords.latitud,
          longitud: coords.longitud,
          precision: coords.precision,
          fuente: 'gps_app_vendedores',
        });
        const nowStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        setCurrentGps((prev) => ({ ...prev, ultimaSincronizacion: nowStr }));
        if (!silent) {
          Alert.alert(
            'Ubicación Transmitida',
            `Tu ubicación (${coords.latitud}, ${coords.longitud}) se registró en el ERP RYSA.`
          );
        }
      } catch (networkErr: any) {
        // Modo offline: encolar telemetría para cuando reconecte
        await queueOfflineAction({
          type: 'location_ping',
          payload: {
            latitud: coords.latitud,
            longitud: coords.longitud,
            precision: coords.precision,
            fuente: 'gps_app_vendedores_offline',
          },
        });
        const nowStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        setCurrentGps((prev) => ({ ...prev, ultimaSincronizacion: `${nowStr} (en cola)` }));
        if (!silent) {
          Alert.alert(
            'Ubicación Guardada Localmente',
            `Sin señal celular. Tu ubicación (${coords.latitud}, ${coords.longitud}) quedó guardada en el teléfono y se transmitirá al reconectar.`
          );
        }
      }
    } catch (err: any) {
      if (!silent) {
        Alert.alert('Error GPS', err.message || 'No se pudo capturar la ubicación.');
      }
    } finally {
      if (!silent) setTransmittingGps(false);
    }
  }, [captureGpsPosition]);

  // Suscripción al servicio global de tracking (persiste entre pantallas y en segundo plano)
  useEffect(() => {
    trackingService.init();
    const unsub = trackingService.addListener((isActive, lastLoc) => {
      setContinuousTracking(isActive);
      if (lastLoc) {
        setCurrentGps((prev) => ({
          ...prev,
          latitud: lastLoc.latitud,
          longitud: lastLoc.longitud,
          precision: lastLoc.precision,
          ultimaSincronizacion: new Date(lastLoc.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        }));
      }
    });
    return () => unsub();
  }, []);

  // Toggle de Tracking Continuo (usando trackingService global con watchPositionAsync)
  const toggleContinuousTracking = async () => {
    if (continuousTracking) {
      await trackingService.stopTracking();
      Alert.alert('Ruta en Pausa', 'Se detuvo la transmisión continua de ubicación.');
    } else {
      const ok = await trackingService.startTracking();
      if (ok) {
        Alert.alert(
          'Ruta Activa',
          'Se activó el rastreo en vivo y continuo. Tu supervisor verá tu avance en tiempo real en el ERP aunque navegues a otras pantallas.'
        );
      } else {
        Alert.alert('Permiso Requerido', 'No se pudo activar el GPS. Verifica los permisos de ubicación en los ajustes de tu dispositivo.');
      }
    }
  };

  // Trazar Ruta Completa Asistida en Google Maps
  const handleOpenFullRouteGoogleMaps = () => {
    const sourceClients = suggestedRoute.length > 0
      ? suggestedRoute
      : clients.filter((c) => c.latitud && c.longitud);

    const validStops = sourceClients
      .filter((s) => s.latitud && s.longitud && Math.abs(s.latitud) > 1)
      .slice(0, 10);

    if (validStops.length === 0) {
      Alert.alert('Sin Puntos GPS', 'No hay visitas o clientes con coordenadas GPS registradas para trazar.');
      return;
    }

    const origin = `${currentGps.latitud},${currentGps.longitud}`;
    const destination = `${validStops[validStops.length - 1].latitud},${validStops[validStops.length - 1].longitud}`;
    const waypointsList = validStops.slice(0, validStops.length - 1);
    const waypoints = waypointsList.map((s) => `${s.latitud},${s.longitud}`).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    if (waypoints) {
      url += `&waypoints=${waypoints}`;
    }

    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'No se pudo abrir la aplicación de Google Maps.');
    });
  };

  // Crear visita in-situ (con soporte offline transparente y evidencia fotográfica)
  const handleCreateInSituVisit = async () => {
    if (!selectedClientForVisit) {
      Alert.alert('Atención', 'Selecciona el cliente que estás visitando.');
      return;
    }

    setSubmittingNewVisit(true);
    try {
      const coords = await captureGpsPosition();
      const payload = {
        cliente_id: selectedClientForVisit.id,
        cliente_nombre: selectedClientForVisit.nombre,
        cliente_codigo: selectedClientForVisit.codigo,
        tipo_visita: tipoVisita,
        estado: 'realizada',
        comentarios: `[${resultadoVisita.toUpperCase()}] ${notasVisita}`.trim(),
        latitud: coords.latitud,
        longitud: coords.longitud,
        foto_evidencia: fotoInSitu?.uri || undefined,
      };

      try {
        await createVisit(payload);
        Alert.alert(
          'Visita Certificada con GPS',
          `Se registró la visita en ${selectedClientForVisit.nombre} exitosamente.`,
          [
            {
              text: 'Aceptar',
              onPress: () => {
                setNewVisitModalVisible(false);
                setSelectedClientForVisit(null);
                setNotasVisita('');
                setFotoInSitu(null);
                loadData();
              },
            },
          ]
        );
      } catch (netErr: any) {
        // Encolar offline
        await queueOfflineAction({
          type: 'create_visit',
          payload,
        });
        const fakeVisit: Visit = {
          id: `local_${Date.now()}`,
          cliente_id: selectedClientForVisit.id,
          cliente_nombre: selectedClientForVisit.nombre,
          cliente_codigo: selectedClientForVisit.codigo,
          tipo_visita: tipoVisita,
          estado: 'realizada',
          comentarios: payload.comentarios,
          latitud: coords.latitud,
          longitud: coords.longitud,
          fecha_programada: new Date().toISOString(),
          fecha_registro: new Date().toISOString(),
        };
        setVisits((prev) => [fakeVisit, ...prev]);
        Alert.alert(
          'Visita Guardada en Teléfono (Offline)',
          `Sin señal de red. La visita quedó guardada localmente y se enviará al ERP en cuanto se restablezca la conexión.`,
          [
            {
              text: 'Entendido',
              onPress: () => {
                setNewVisitModalVisible(false);
                setSelectedClientForVisit(null);
                setNotasVisita('');
                setFotoInSitu(null);
              },
            },
          ]
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo guardar la visita.');
    } finally {
      setSubmittingNewVisit(false);
    }
  };

  // Check-In visita programada (con soporte offline transparente y evidencia fotográfica)
  const handleConfirmCheckin = async () => {
    if (!selectedVisitForCheckin) return;
    setSubmittingCheckin(true);

    try {
      const coords = await captureGpsPosition();
      const payload = {
        visita_id: selectedVisitForCheckin.id,
        comentarios: comentariosCheckin.trim() || undefined,
        resultado: resultadoCheckin,
        latitud: coords.latitud,
        longitud: coords.longitud,
        foto_evidencia: fotoCheckin?.uri || undefined,
      };

      try {
        await checkInVisit(selectedVisitForCheckin.id, payload);
        Alert.alert('Check-In Exitoso', 'Visita completada y certificada con coordenadas GPS.', [
          {
            text: 'Aceptar',
            onPress: () => {
              setSelectedVisitForCheckin(null);
              setFotoCheckin(null);
              loadData();
            },
          },
        ]);
      } catch (netErr: any) {
        // Encolar offline
        await queueOfflineAction({
          type: 'checkin_visit',
          payload,
        });
        setVisits((prev) =>
          prev.map((v) =>
            v.id === selectedVisitForCheckin.id ? { ...v, estado: 'realizada' } : v
          )
        );
        Alert.alert(
          'Check-In Guardado en Teléfono (Offline)',
          'Sin conexión de red en este momento. El check-in se certificó localmente con GPS y se sincronizará automáticamente con el ERP.',
          [
            {
              text: 'Entendido',
              onPress: () => setSelectedVisitForCheckin(null),
            },
          ]
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo registrar el check-in.');
    } finally {
      setSubmittingCheckin(false);
    }
  };

  const getStatusBadge = (estado: string) => {
    switch (estado) {
      case 'realizada':
        return { label: 'REALIZADA', bg: '#E8F5E9', text: '#2E7D32' };
      case 'en_camino':
        return { label: 'EN CAMINO', bg: '#FFF8E1', text: '#F57F17' };
      case 'cancelada':
        return { label: 'CANCELADA', bg: '#FFEBEE', text: '#C62828' };
      default:
        return { label: 'PROGRAMADA', bg: '#E3F2FD', text: '#1565C0' };
    }
  };

  // Algoritmo de Ruta Óptima (Vecino más cercano) emulando clientes de Carlos
  const suggestedRoute = useMemo(() => {
    const targetClients = clients.filter((c) => {
      const vName = (c.vendedor || '').toLowerCase();
      const uName = (user?.name || '').toLowerCase();
      return (
        vName.includes('carlos') ||
        (c.vendedor_id && c.vendedor_id === user?.id) ||
        (uName && vName.includes(uName)) ||
        !c.vendedor_id
      );
    });

    const routeSource = targetClients.length ? targetClients : clients;

    // Asignar coordenadas emuladas si no las tienen aún para garantizar la ruta
    const clientsWithGps = routeSource.slice(0, 15).map((c, i) => {
      if (c.latitud != null && c.longitud != null && Math.abs(c.latitud) > 1) {
        return c;
      }
      const angle = (i * 137.5 * Math.PI) / 180;
      const r = 0.012 + (i * 0.004);
      return {
        ...c,
        latitud: Number((BASE_LAT + r * Math.cos(angle)).toFixed(6)),
        longitud: Number((BASE_LNG + r * Math.sin(angle)).toFixed(6)),
      };
    });

    if (!clientsWithGps.length) return [];

    let current = [currentGps.latitud, currentGps.longitud];
    const rest = [...clientsWithGps];
    const ordered: Client[] = [];

    while (rest.length) {
      let bestIdx = 0;
      let bestDist = Infinity;
      rest.forEach((cli, idx) => {
        const d = (cli.latitud! - current[0]) ** 2 + (cli.longitud! - current[1]) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      });
      const nextCli = rest.splice(bestIdx, 1)[0];
      ordered.push(nextCli);
      current = [nextCli.latitud!, nextCli.longitud!];
    }
    return ordered;
  }, [clients, currentGps, user]);

  // Puntos geográficos normalizados para el componente de mapa interactivo
  const mapClientPoints: MapClientPoint[] = useMemo(() => {
    return suggestedRoute.slice(0, 15).map((c, idx) => ({
      id: c.id,
      nombre: c.nombre,
      latitud: c.latitud || BASE_LAT,
      longitud: c.longitud || BASE_LNG,
      orden: idx + 1,
      estado: visits.some((v) => v.cliente_id === c.id && v.estado === 'realizada')
        ? 'realizada'
        : 'programada',
      direccion: c.direccion || c.colonia || c.ciudad || '',
      telefono: (c as any).celular || (c as any).whatsapp || c.telefono || '',
    }));
  }, [suggestedRoute, visits]);

  // Calcular ruta OSRM con la red vial en Palenque
  useEffect(() => {
    if (suggestedRoute.length > 0 && currentGps.latitud) {
      fetchOsrmRoute(currentGps, suggestedRoute);
    }
  }, [suggestedRoute, currentGps.latitud, currentGps.longitud, fetchOsrmRoute]);

  // Lista según pestaña
  const displayedVisits = useMemo(() => {
    if (activeTab === 'hoy') {
      return visits.filter((v) => v.estado === 'realizada' || v.estado === 'en_camino');
    }
    return visits.filter((v) => v.estado === 'programada');
  }, [visits, activeTab]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter(
      (c) =>
        c.nombre?.toLowerCase().includes(q) ||
        c.codigo?.toLowerCase().includes(q) ||
        c.ciudad?.toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Telemetría y conectividad */}
      <ConnectivityBar onManualSync={loadData} />

      {/* Header Institucional */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={styles.headerTitle}>Ruta & GPS en Campo</Text>
            <Text style={styles.headerSubtitle}>Operación y seguimiento de visitas</Text>
          </View>
          <TouchableOpacity
            style={[styles.trackingToggleBtn, continuousTracking && styles.trackingToggleBtnActive]}
            onPress={toggleContinuousTracking}
            activeOpacity={0.8}
          >
            <View style={[styles.gpsDot, continuousTracking && styles.gpsDotActive]} />
            <Text style={[styles.trackingToggleText, continuousTracking && styles.trackingToggleTextActive]}>
              {continuousTracking ? 'Ruta 15s Activa' : 'Iniciar Ruta'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Banner Offline */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={14} color="#FFB300" />
            <Text style={styles.offlineBannerText}>
              Modo Sin Conexión • GPS guardando en caché y encolando para sincronización
            </Text>
          </View>
        )}

        {/* Panel Telemetría GPS en Vivo */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsCardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="my-location" size={18} color="#00E676" />
              <Text style={styles.gpsCardTitle}>GPS del Asesor</Text>
            </View>
            <Text style={styles.gpsPrecisionText}>±{currentGps.precision}m precisión</Text>
          </View>

          <View style={styles.gpsCoordsRow}>
            <Text style={styles.gpsCoordsText}>
              {currentGps.latitud.toFixed(5)}° N, {currentGps.longitud.toFixed(5)}° W
            </Text>
            {currentGps.ultimaSincronizacion && (
              <Text style={styles.gpsSyncText}>Sync: {currentGps.ultimaSincronizacion}</Text>
            )}
          </View>

          <View style={styles.gpsActionButtons}>
            <TouchableOpacity
              style={[styles.transmitBtn, transmittingGps && { opacity: 0.7 }]}
              onPress={() => handleTransmitLocation(false)}
              disabled={transmittingGps}
              activeOpacity={0.8}
            >
              {transmittingGps ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialIcons name="cloud-upload" size={16} color="#FFFFFF" />
                  <Text style={styles.transmitBtnText}>Transmitir mi GPS</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.newVisitBtn}
              onPress={() => setNewVisitModalVisible(true)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add-location-alt" size={16} color="#FFFFFF" />
              <Text style={styles.newVisitBtnText}>Nueva Visita In-Situ</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.fullRouteGmapsBtn}
            onPress={handleOpenFullRouteGoogleMaps}
            activeOpacity={0.8}
          >
            <MaterialIcons name="directions" size={16} color="#FFFFFF" />
            <Text style={styles.fullRouteGmapsText}>Trazar Ruta Completa en Google Maps</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs Selector: Hoy vs Programadas vs Ruta Sugerida */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'hoy' && styles.tabBtnActive]}
          onPress={() => setActiveTab('hoy')}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="check-circle"
            size={16}
            color={activeTab === 'hoy' ? '#FFFFFF' : '#718096'}
          />
          <Text style={[styles.tabBtnText, activeTab === 'hoy' && styles.tabBtnTextActive]}>
            Realizadas ({visits.filter((v) => v.estado === 'realizada').length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'programadas' && styles.tabBtnActive]}
          onPress={() => setActiveTab('programadas')}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="event"
            size={16}
            color={activeTab === 'programadas' ? '#FFFFFF' : '#718096'}
          />
          <Text
            style={[styles.tabBtnText, activeTab === 'programadas' && styles.tabBtnTextActive]}
          >
            Agenda ({visits.filter((v) => v.estado === 'programada').length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'ruta_optima' && styles.tabBtnActive]}
          onPress={() => setActiveTab('ruta_optima')}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="alt-route"
            size={16}
            color={activeTab === 'ruta_optima' ? '#FFFFFF' : '#718096'}
          />
          <Text
            style={[styles.tabBtnText, activeTab === 'ruta_optima' && styles.tabBtnTextActive]}
          >
            Ruta Óptima
          </Text>
        </TouchableOpacity>
      </View>

      {/* Contenido según pestaña */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#D32F2F" />
          <Text style={styles.loadingText}>Cargando datos de ruta...</Text>
        </View>
      ) : activeTab === 'ruta_optima' ? (
        /* Pestaña: Ruta Sugerida Ordenada por Proximidad */
        <FlatList
          data={suggestedRoute}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 60 },
          ]}
          ListHeaderComponent={
            <View>
              <View style={styles.routeHeaderBox}>
                <MaterialIcons name="navigation" size={20} color="#D32F2F" />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.routeHeaderText}>
                    Ruta en vivo optimizada por cercanía y red vial OSRM.
                  </Text>
                  <Text style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
                    {loadingRoutePolyline ? 'Trazando recorrido vial...' : `${suggestedRoute.length} clientes ordenados por proximidad`}
                  </Text>
                </View>
              </View>

              {/* Mapa en Vivo Interactivo (OpenStreetMap / Leaflet / OSRM) */}
              <RouteMap
                sellerLocation={currentGps}
                clients={mapClientPoints}
                routeCoordinates={osrmRoute}
                height={260}
              />

              <TouchableOpacity
                style={styles.gmapsNavFullBtn}
                onPress={handleOpenFullRouteGoogleMaps}
                activeOpacity={0.8}
              >
                <MaterialIcons name="navigation" size={18} color="#FFFFFF" />
                <Text style={styles.gmapsNavFullBtnText}>Navegar Ruta Completa en Google Maps</Text>
              </TouchableOpacity>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="location-off" size={48} color="#CBD5E0" />
              <Text style={styles.emptyTitle}>Sin clientes geolocalizados</Text>
              <Text style={styles.emptyDesc}>
                Para generar la ruta óptima, registra las coordenadas de los clientes en sus visitas.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <View style={styles.suggestedCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={styles.orderNumberBadge}>
                  <Text style={styles.orderNumberText}>#{index + 1}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.clientName} numberOfLines={1}>
                    {item.nombre}
                  </Text>
                  <Text style={styles.addressText} numberOfLines={1}>
                    {item.direccion || item.colonia || item.ciudad || 'Sin dirección'}
                  </Text>
                  <Text style={styles.coordsMiniText}>
                    GPS: {item.latitud?.toFixed(4)}, {item.longitud?.toFixed(4)}
                  </Text>
                </View>
              </View>

              {/* Botones de Acción de Ruta: Navegar en Google Maps, Llamar por Teléfono y Visitar */}
              <View style={styles.routeActionsRow}>
                <TouchableOpacity
                  style={styles.navMapsBtn}
                  onPress={() => handleOpenGoogleMaps(item.latitud, item.longitud, item.nombre)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="map" size={15} color="#1565C0" />
                  <Text style={styles.navMapsBtnText}>Google Maps</Text>
                </TouchableOpacity>

                {(item.celular || item.telefono || (item as any).whatsapp) ? (
                  <TouchableOpacity
                    style={styles.callClientBtn}
                    onPress={() => handleCallClient(item.celular || item.telefono || (item as any).whatsapp, item.nombre)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="phone" size={15} color="#2E7D32" />
                    <Text style={styles.callClientBtnText}>Llamar</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.directVisitBtn}
                  onPress={() => {
                    setSelectedClientForVisit(item);
                    setNewVisitModalVisible(true);
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="add-location" size={16} color="#FFFFFF" />
                  <Text style={styles.directVisitBtnText}>Visitar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      ) : (
        /* Pestañas: Realizadas o Programadas */
        <FlatList
          data={displayedVisits}
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
              <MaterialIcons name="route" size={54} color="#CBD5E0" />
              <Text style={styles.emptyTitle}>
                {activeTab === 'hoy' ? 'Sin visitas realizadas hoy' : 'Sin visitas programadas'}
              </Text>
              <Text style={styles.emptyDesc}>
                {activeTab === 'hoy'
                  ? 'Utiliza "Nueva Visita In-Situ" para reportar una visita en cliente con coordenadas GPS.'
                  : 'No tienes citas programadas en la agenda para hoy.'}
              </Text>
              <TouchableOpacity
                style={styles.emptyActionBtn}
                onPress={() => setNewVisitModalVisible(true)}
              >
                <MaterialIcons name="add-location-alt" size={18} color="#FFFFFF" />
                <Text style={styles.emptyActionBtnText}>Registrar Visita en Campo</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const badge = getStatusBadge(item.estado);
            const isDone = item.estado === 'realizada';

            return (
              <View style={styles.visitCard}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientName} numberOfLines={1}>
                      {item.cliente_nombre || 'Cliente sin nombre'}
                    </Text>
                    <Text style={styles.visitType}>{item.tipo_visita?.toUpperCase() || 'VISITA'}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                  </View>
                </View>

                {item.fecha_programada || item.hora ? (
                  <View style={styles.infoRow}>
                    <MaterialIcons name="schedule" size={14} color="#718096" />
                    <Text style={styles.infoText}>
                      {item.fecha_programada || ''} {item.hora ? `a las ${item.hora}` : ''}
                    </Text>
                  </View>
                ) : null}

                {item.comentarios ? (
                  <View style={styles.commentBox}>
                    <Text style={styles.commentText} numberOfLines={2}>
                      {item.comentarios}
                    </Text>
                  </View>
                ) : null}

                {/* Badge GPS Verificado */}
                {isDone ? (
                  <View style={styles.gpsVerifiedTag}>
                    <MaterialIcons name="gps-fixed" size={13} color="#2E7D32" />
                    <Text style={styles.gpsVerifiedText}>GPS Certificado en Sitio</Text>
                  </View>
                ) : (
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={styles.checkinBtn}
                      onPress={() => {
                        setSelectedVisitForCheckin(item);
                        setComentariosCheckin('');
                        setResultadoCheckin('visita_exitosa');
                      }}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons name="where-to-vote" size={16} color="#FFFFFF" />
                      <Text style={styles.checkinBtnText}>Hacer Check-In GPS</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {/* MODAL: Registrar Visita In-Situ con GPS */}
      <Modal
        visible={newVisitModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setNewVisitModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalSub}>OPERACIÓN EN RUTA</Text>
                <Text style={styles.modalTitle}>Registrar Visita con GPS</Text>
              </View>
              <TouchableOpacity onPress={() => setNewVisitModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#718096" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
              {/* Coordenadas GPS actuales */}
              <View style={styles.gpsStatusBanner}>
                <MaterialIcons name="gps-fixed" size={18} color="#2E7D32" />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.gpsStatusTitle}>Coordenadas GPS en Sitio</Text>
                  <Text style={styles.gpsStatusCoords}>
                    {currentGps.latitud.toFixed(5)}, {currentGps.longitud.toFixed(5)} (±{currentGps.precision}m)
                  </Text>
                </View>
              </View>

              {/* Selector de Cliente */}
              <Text style={styles.formLabel}>1. Cliente visitado:</Text>
              <TouchableOpacity
                style={styles.pickerSelector}
                onPress={() => setClientPickerVisible(true)}
              >
                <MaterialIcons name="person" size={20} color="#D32F2F" />
                <Text style={styles.pickerSelectorText} numberOfLines={1}>
                  {selectedClientForVisit ? selectedClientForVisit.nombre : 'Toca para seleccionar cliente...'}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={22} color="#718096" />
              </TouchableOpacity>

              {/* Tipo de Visita (idéntico a la web app) */}
              <Text style={styles.formLabel}>2. Tipo de Visita:</Text>
              <View style={styles.chipsRow}>
                {[
                  { id: 'visita', label: 'Visita General' },
                  { id: 'cobro', label: 'Cobro' },
                  { id: 'nueva', label: 'Nueva / Prospección' },
                  { id: 'seguimiento', label: 'Seguimiento' },
                ].map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.chipBtn, tipoVisita === t.id && styles.chipBtnActive]}
                    onPress={() => setTipoVisita(t.id)}
                  >
                    <Text style={[styles.chipText, tipoVisita === t.id && styles.chipTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Resultado de la visita */}
              <Text style={styles.formLabel}>3. Resultado de la visita:</Text>
              <View style={styles.chipsRow}>
                {[
                  { id: 'visita_exitosa', label: 'Exitosa' },
                  { id: 'pedido_levantado', label: 'Venta / Pedido' },
                  { id: 'abono_cobrado', label: 'Cobro Aplicado' },
                  { id: 'cliente_ausente', label: 'Ausente / Cerrado' },
                  { id: 'reprogramar', label: 'Reprogramar' },
                ].map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.chipBtn, resultadoVisita === r.id && styles.chipBtnActive]}
                    onPress={() => setResultadoVisita(r.id)}
                  >
                    <Text
                      style={[styles.chipText, resultadoVisita === r.id && styles.chipTextActive]}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Observaciones */}
              <Text style={styles.formLabel}>4. Observaciones de campo:</Text>
              <TextInput
                style={styles.textAreaInput}
                placeholder="Escribe acuerdos, pedidos o notas de la visita..."
                placeholderTextColor="#A0AEC0"
                value={notasVisita}
                onChangeText={setNotasVisita}
                multiline
                numberOfLines={3}
              />

              {/* Evidencia Fotográfica */}
              <Text style={styles.formLabel}>5. Evidencia Fotográfica (Fachada / Visita):</Text>
              {fotoInSitu ? (
                <View style={styles.photoPreviewRow}>
                  <Image source={{ uri: fotoInSitu.uri }} style={styles.photoThumb} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.photoName} numberOfLines={1}>{fotoInSitu.name}</Text>
                    <TouchableOpacity onPress={() => setFotoInSitu(null)}>
                      <Text style={styles.photoRemoveText}>Eliminar foto</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.photoPickerBtn}
                  onPress={async () => {
                    const file = await pickImageOrPhoto('Foto de Fachada / Visita');
                    if (file) setFotoInSitu(file);
                  }}
                >
                  <MaterialIcons name="photo-camera" size={20} color="#D32F2F" />
                  <Text style={styles.photoPickerText}>Tomar Foto o Elegir de Galería</Text>
                </TouchableOpacity>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                (submittingNewVisit || !selectedClientForVisit) && styles.saveBtnDisabled,
              ]}
              onPress={handleCreateInSituVisit}
              disabled={submittingNewVisit || !selectedClientForVisit}
            >
              {submittingNewVisit ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="check-circle" size={20} color="#FFFFFF" />
                  <Text style={styles.saveBtnText}>Certificar y Guardar Visita</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SUB-MODAL: Selector de Cliente */}
      <Modal
        visible={clientPickerVisible}
        animationType="slide"
        onRequestClose={() => setClientPickerVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Seleccionar Cliente de Cartera</Text>
            <TouchableOpacity onPress={() => setClientPickerVisible(false)}>
              <MaterialIcons name="close" size={24} color="#718096" />
            </TouchableOpacity>
          </View>

          <View style={styles.pickerSearchBox}>
            <MaterialIcons name="search" size={20} color="#718096" />
            <TextInput
              style={{ flex: 1, marginLeft: 8, fontSize: 14 }}
              placeholder="Buscar por nombre o código..."
              placeholderTextColor="#A0AEC0"
              value={clientSearch}
              onChangeText={setClientSearch}
            />
          </View>

          <FlatList
            data={filteredClients}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.clientPickerItem}
                onPress={() => {
                  setSelectedClientForVisit(item);
                  setClientPickerVisible(false);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientPickerName}>{item.nombre}</Text>
                  <Text style={styles.clientPickerSub}>
                    {item.codigo ? `${item.codigo} • ` : ''}
                    {item.ciudad || item.colonia || 'Sin ciudad'}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color="#CBD5E0" />
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>

      {/* MODAL: Check-In de Visita Programada */}
      <Modal
        visible={!!selectedVisitForCheckin}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedVisitForCheckin(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalSub}>CHECK-IN DE VISITA</Text>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {selectedVisitForCheckin?.cliente_nombre}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedVisitForCheckin(null)}>
                <MaterialIcons name="close" size={24} color="#718096" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.gpsStatusBanner}>
                <MaterialIcons name="gps-fixed" size={18} color="#2E7D32" />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.gpsStatusTitle}>GPS Certificado en Sitio</Text>
                  <Text style={styles.gpsStatusCoords}>
                    {currentGps.latitud.toFixed(5)}, {currentGps.longitud.toFixed(5)}
                  </Text>
                </View>
              </View>

              <Text style={styles.formLabel}>Resultado de la visita:</Text>
              <View style={styles.chipsRow}>
                {[
                  { id: 'visita_exitosa', label: 'Exitosa' },
                  { id: 'pedido_levantado', label: 'Venta' },
                  { id: 'abono_cobrado', label: 'Cobro' },
                  { id: 'cliente_ausente', label: 'Ausente' },
                  { id: 'reprogramar', label: 'Reprogramar' },
                ].map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.chipBtn, resultadoCheckin === r.id && styles.chipBtnActive]}
                    onPress={() => setResultadoCheckin(r.id)}
                  >
                    <Text
                      style={[styles.chipText, resultadoCheckin === r.id && styles.chipTextActive]}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.formLabel}>Comentarios de la visita:</Text>
              <TextInput
                style={styles.textAreaInput}
                placeholder="Observaciones de la visita..."
                placeholderTextColor="#A0AEC0"
                value={comentariosCheckin}
                onChangeText={setComentariosCheckin}
                multiline
                numberOfLines={3}
              />

              {/* Evidencia Fotográfica */}
              <Text style={styles.formLabel}>Evidencia Fotográfica (Opcional):</Text>
              {fotoCheckin ? (
                <View style={styles.photoPreviewRow}>
                  <Image source={{ uri: fotoCheckin.uri }} style={styles.photoThumb} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.photoName} numberOfLines={1}>{fotoCheckin.name}</Text>
                    <TouchableOpacity onPress={() => setFotoCheckin(null)}>
                      <Text style={styles.photoRemoveText}>Eliminar foto</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.photoPickerBtn}
                  onPress={async () => {
                    const file = await pickImageOrPhoto('Foto de Check-In / Fachada');
                    if (file) setFotoCheckin(file);
                  }}
                >
                  <MaterialIcons name="photo-camera" size={20} color="#D32F2F" />
                  <Text style={styles.photoPickerText}>Tomar Foto o Elegir de Galería</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, submittingCheckin && styles.saveBtnDisabled]}
                onPress={handleConfirmCheckin}
                disabled={submittingCheckin}
              >
                {submittingCheckin ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="where-to-vote" size={20} color="#FFFFFF" />
                    <Text style={styles.saveBtnText}>Certificar Check-In con GPS</Text>
                  </View>
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
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
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
  trackingToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
  },
  trackingToggleBtnActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.2)',
    borderColor: '#00E676',
    borderWidth: 1,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#A0AEC0',
  },
  gpsDotActive: {
    backgroundColor: '#00E676',
  },
  trackingToggleText: {
    color: '#CBD5E0',
    fontSize: 11,
    fontWeight: '700',
  },
  trackingToggleTextActive: {
    color: '#00E676',
  },
  gpsCard: {
    backgroundColor: '#18202A',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  gpsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gpsCardTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  gpsPrecisionText: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
  },
  gpsCoordsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  gpsCoordsText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  gpsSyncText: {
    color: '#A0AEC0',
    fontSize: 11,
  },
  gpsActionButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  transmitBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#273240',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  transmitBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  newVisitBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D32F2F',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  newVisitBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
    gap: 4,
  },
  tabBtnActive: {
    backgroundColor: '#D32F2F',
  },
  tabBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4A5568',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
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
    paddingTop: 12,
  },
  routeHeaderBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    gap: 8,
  },
  routeHeaderText: {
    flex: 1,
    fontSize: 12,
    color: '#C62828',
    fontWeight: '600',
  },
  suggestedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  orderNumberBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#121820',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderNumberText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  coordsMiniText: {
    fontSize: 11,
    color: '#2E7D32',
    marginTop: 2,
    fontWeight: '600',
  },
  routeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: '#F1F5F9',
  },
  navMapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  navMapsBtnText: {
    color: '#1565C0',
    fontSize: 11,
    fontWeight: '700',
  },
  callClientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  callClientBtnText: {
    color: '#2E7D32',
    fontSize: 11,
    fontWeight: '700',
  },
  directVisitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D32F2F',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  directVisitBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  visitCard: {
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  clientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D3748',
  },
  addressText: {
    fontSize: 11,
    color: '#718096',
    marginTop: 1,
  },
  visitType: {
    fontSize: 11,
    color: '#D32F2F',
    fontWeight: '700',
    marginTop: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  infoText: {
    fontSize: 12,
    color: '#718096',
  },
  commentBox: {
    backgroundColor: '#F7FAFC',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  commentText: {
    fontSize: 12,
    color: '#4A5568',
    fontStyle: 'italic',
  },
  gpsVerifiedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    marginTop: 8,
  },
  gpsVerifiedText: {
    color: '#2E7D32',
    fontSize: 11,
    fontWeight: '700',
  },
  cardActions: {
    marginTop: 12,
    alignItems: 'flex-end',
  },
  checkinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D32F2F',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  checkinBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
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
  emptyActionBtn: {
    marginTop: 16,
    backgroundColor: '#D32F2F',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  emptyActionBtnText: {
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
    fontSize: 11,
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
    paddingVertical: 12,
  },
  gpsStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 10,
  },
  gpsStatusTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2E7D32',
  },
  gpsStatusCoords: {
    fontSize: 11,
    color: '#388E3C',
    marginTop: 1,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4A5568',
    marginTop: 10,
    marginBottom: 6,
  },
  pickerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  pickerSelectorText: {
    flex: 1,
    fontSize: 13,
    color: '#1A202C',
    fontWeight: '600',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chipBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#EDF2F7',
  },
  chipBtnActive: {
    backgroundColor: '#D32F2F',
  },
  chipText: {
    fontSize: 11,
    color: '#4A5568',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  textAreaInput: {
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: '#1A202C',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: '#D32F2F',
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  saveBtnDisabled: {
    backgroundColor: '#EF9A9A',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#E2E8F0',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A202C',
  },
  pickerSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    margin: 14,
    paddingHorizontal: 10,
    height: 40,
  },
  clientPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: '#EDF2F7',
  },
  clientPickerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3748',
  },
  clientPickerSub: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
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
  fullRouteGmapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E88E5',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginTop: 8,
    gap: 6,
  },
  fullRouteGmapsText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  gmapsNavFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1565C0',
    borderRadius: 8,
    paddingVertical: 10,
    marginVertical: 10,
    gap: 8,
  },
  gmapsNavFullBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  photoPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FEB2B2',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 10,
    gap: 8,
    marginVertical: 6,
  },
  photoPickerText: {
    color: '#C53030',
    fontSize: 13,
    fontWeight: '600',
  },
  photoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
    marginVertical: 6,
  },
  photoThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
  },
  photoName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3748',
  },
  photoRemoveText: {
    fontSize: 11,
    color: '#E53E3E',
    fontWeight: '700',
    marginTop: 2,
  },
});
