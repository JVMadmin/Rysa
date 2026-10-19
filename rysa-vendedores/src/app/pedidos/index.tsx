import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { ConnectivityBar } from '@/components/ConnectivityBar';
import { getFullCatalog, getSellerClients, createOrder, createVentaDirecta, createClient, VentaDirectaPayload } from '@/services/salesService';
import { getCatalogCache, getClientsCache, saveClientsCache, saveOfflineSale, queueOfflineAction } from '@/services/offlineCache';
import { getCajaActual, abrirCaja, cerrarCaja, CajaInfo, CajaResumen, CajaCierreResult, getCajaReportePdfUrl } from '@/services/cajaService';
import { getBackendUrl } from '@/lib/api';
import { Client, Product, PedidoInput, PedidoCreatedResponse } from '@/types';
import { shareTicketPdf, generateTicketPdf } from '@/lib/ticketPdf';

interface CartItem {
  product: Product;
  cantidad: number;
  precio: number;
  subtotal: number;
}

export default function PedidosScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Tipo de operación: Venta Directa (inmediata) vs Cotización
  const [tipoOperacion, setTipoOperacion] = useState<'venta_directa' | 'cotizacion'>('venta_directa');

  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientModalVisible, setClientModalVisible] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [condicion, setCondicion] = useState<'contado' | 'credito'>('contado');
  const [formaPago, setFormaPago] = useState('efectivo');
  const [notas, setNotas] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // IVA configurable y toggle
  const [aplicaIva, setAplicaIva] = useState(true);
  const [tasaIva, setTasaIva] = useState(8);

  // Toast flotante al agregar producto
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // Modal de Comprobante / Ticket Digital
  const [ticketModalVisible, setTicketModalVisible] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<PedidoCreatedResponse | null>(null);
  const [sharingPdf, setSharingPdf] = useState(false);

  // Estado de Caja / Turno Móvil
  const [cajaActual, setCajaActual] = useState<CajaInfo | null>(null);
  const [cajaResumen, setCajaResumen] = useState<CajaResumen | null>(null);
  const [loadingCaja, setLoadingCaja] = useState(false);
  const [cajaModalVisible, setCajaModalVisible] = useState(false);
  const [fondoInicialInput, setFondoInicialInput] = useState('0');
  const [turnoNombreInput, setTurnoNombreInput] = useState('');
  const [efectivoContadoInput, setEfectivoContadoInput] = useState('');
  const [submittingCaja, setSubmittingCaja] = useState(false);
  const [cierreResult, setCierreResult] = useState<CajaCierreResult | null>(null);
  const [cierreModalVisible, setCierreModalVisible] = useState(false);

  // Registro de Nuevo Cliente Express
  const [newClientModalVisible, setNewClientModalVisible] = useState(false);
  const [newClientForm, setNewClientForm] = useState({
    nombre: '',
    telefono: '',
    direccion: '',
    ciudad: 'Palenque',
    rfc: '',
    condicion_pago: 'contado' as 'contado' | 'credito',
  });
  const [savingClient, setSavingClient] = useState(false);

  // Cliente Virtual: Público en General
  const publicoGeneralClient: Client = useMemo(
    () => ({
      id: 'publico_general',
      codigo: 'PUB-GEN',
      nombre: 'PÚBLICO EN GENERAL',
      rfc: 'XAXX010101000',
      condicion_pago: 'contado',
      dias_credito: 0,
      saldo: 0,
      limite_credito: 0,
      lista_precios: 1,
      en_cartera: true,
      ciudad: 'Palenque',
    }),
    []
  );

  const refreshCaja = useCallback(async () => {
    try {
      setLoadingCaja(true);
      const res = await getCajaActual();
      setCajaActual(res.caja);
      setCajaResumen(res.resumen || null);
    } catch (err) {
      console.warn('[pedidos] Error consultando caja actual:', err);
    } finally {
      setLoadingCaja(false);
    }
  }, []);

  // 1. Cargar catálogo completo (2,244 productos), clientes y estado de caja
  useEffect(() => {
    refreshCaja();
    Promise.all([getCatalogCache(), getClientsCache()]).then(([cachedCat, cachedCli]) => {
      if (cachedCat.products.length > 0) {
        setAllProducts(cachedCat.products);
        setLoadingCatalog(false);
      }
      if (cachedCli.clients.length > 0) {
        setClients(cachedCli.clients);
      }
      getFullCatalog()
        .then((prods) => {
          if (prods.length > 0) setAllProducts(prods);
        })
        .catch(() => {})
        .finally(() => setLoadingCatalog(false));

      getSellerClients(undefined, 'all')
        .then((clis) => {
          if (clis.length > 0) {
            setClients(clis);
            saveClientsCache(clis);
          }
        })
        .catch(() => {});
    });
  }, [refreshCaja]);

  // 2. Obtener precio neto base según lista de precios del cliente (1 a 5)
  const getProductPriceForClient = useCallback(
    (product: Product, client: Client | null): number => {
      const lista = (client as any)?.lista_precios || (client as any)?.listaPrecios || 1;
      if (lista === 2 && product.precio2 && product.precio2 > 0) {
        return product.precio2;
      }
      if (product.precios && product.precios.length >= lista) {
        const pTier = product.precios[lista - 1];
        if (pTier?.precio && pTier.precio > 0) {
          return pTier.precio;
        }
        if (pTier?.precio_con_iva && pTier.precio_con_iva > 0) {
          return pTier.precio_con_iva;
        }
      }
      return product.precio1 || product.precio || 0;
    },
    []
  );

  // 3. Filtrado reactivo de productos
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) {
      return allProducts.slice(0, 30);
    }
    const q = productSearch.toLowerCase().trim();
    return allProducts
      .filter(
        (p) =>
          p.sku?.toLowerCase().includes(q) ||
          p.descripcion?.toLowerCase().includes(q) ||
          p.categoria?.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [allProducts, productSearch]);

  // 4. Filtrado reactivo de clientes (ESTRICTAMENTE Público General y Cartera Asignada)
  const filteredClients = useMemo(() => {
    const q = clientSearch.toLowerCase().trim();

    // En Vender solo se permiten clientes asignados en cartera o público en general
    const portfolioClients = clients.filter((c) => c.en_cartera === true);
    portfolioClients.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    if (!q) {
      return [publicoGeneralClient, ...portfolioClients];
    }
    const matching = portfolioClients.filter(
      (c) =>
        c.nombre?.toLowerCase().includes(q) ||
        c.codigo?.toLowerCase().includes(q) ||
        c.ciudad?.toLowerCase().includes(q)
    );
    if ('público en general'.includes(q) || 'publico'.includes(q) || 'general'.includes(q)) {
      return [publicoGeneralClient, ...matching];
    }
    return matching;
  }, [clients, clientSearch, publicoGeneralClient]);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMsg(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 2000);
  };

  // 5. Agregar producto al carrito y disparar toast
  const addToCart = (product: Product) => {
    const applicablePrice = getProductPriceForClient(product, selectedClient);
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.product.id === product.id);
      if (idx > -1) {
        const updated = [...prev];
        const newQty = updated[idx].cantidad + 1;
        updated[idx] = {
          ...updated[idx],
          cantidad: newQty,
          subtotal: newQty * updated[idx].precio,
        };
        return updated;
      }
      return [
        ...prev,
        {
          product,
          cantidad: 1,
          precio: applicablePrice,
          subtotal: applicablePrice,
        },
      ];
    });
    showToast(`✅ Agregado: ${product.nombre || product.descripcion}`);
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.cantidad + delta;
            if (newQty <= 0) return null;
            return {
              ...item,
              cantidad: newQty,
              subtotal: newQty * item.precio,
            };
          }
          return item;
        })
        .filter(Boolean) as CartItem[];
    });
  };

  // 6. Cálculos de Totales: Precio Base Neto + IVA 8% sumado
  const totals = useMemo(() => {
    let subtotalNeto = 0;

    cart.forEach((item) => {
      const qty = Number(item.cantidad || 0);
      const pBase = Number(item.precio || 0);
      subtotalNeto += qty * pBase;
    });

    subtotalNeto = Math.round(subtotalNeto * 100) / 100;
    const tasa = Number(tasaIva || 0) / 100;
    const totalIva = aplicaIva ? Math.round(subtotalNeto * tasa * 100) / 100 : 0;
    const totalBruto = Math.round((subtotalNeto + totalIva) * 100) / 100;

    return {
      subtotal: subtotalNeto,
      iva: totalIva,
      total: totalBruto,
    };
  }, [cart, aplicaIva, tasaIva]);

  // 7. Confirmación de la transacción (Venta Directa vs Cotización)
  const handleConfirmSale = async () => {
    if (submitting) return;
    if (!selectedClient) {
      Alert.alert('Atención', `Selecciona un cliente para ${tipoOperacion === 'venta_directa' ? 'realizar la venta' : 'generar la cotización'}.`);
      return;
    }
    if (cart.length === 0) {
      Alert.alert('Atención', 'Agrega al menos un producto a la orden.');
      return;
    }

    // Validación estricta: Se requiere turno de caja abierto para vender directo
    if (tipoOperacion === 'venta_directa') {
      if (!cajaActual || cajaActual.estado !== 'abierta') {
        Alert.alert(
          'Caja Cerrada / Turno Inactivo',
          'Para realizar ventas directas y registrar cobros en efectivo o transferencias, es obligatorio tener un turno de caja abierto.',
          [
            { text: 'Abrir Caja Ahora', onPress: () => setCajaModalVisible(true) },
            { text: 'Cancelar', style: 'cancel' },
          ]
        );
        return;
      }
    }

    setSubmitting(true);
    const opKey = `idem_${tipoOperacion === 'venta_directa' ? 'vta' : 'cot'}_${user?.id || 'movil'}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const notasFull = `[${tipoOperacion === 'venta_directa' ? 'VENTA DIRECTA' : 'COTIZACIÓN'} - ${condicion.toUpperCase()}${condicion === 'contado' ? ` - ${formaPago.toUpperCase()}` : ''}${aplicaIva ? ` - IVA ${tasaIva}%` : ' - SIN IVA'}] ${notas.trim()}`.trim();

    try {
      if (tipoOperacion === 'venta_directa') {
        const ventaPayload: VentaDirectaPayload = {
          cliente_id: selectedClient.id === 'publico_general' ? '' : selectedClient.id,
          cliente_nombre: selectedClient.nombre || 'PÚBLICO EN GENERAL',
          cliente_codigo: selectedClient.codigo || '',
          items: cart.map((c) => ({
            product_id: c.product.id,
            codigo: c.product.sku || '',
            descripcion: c.product.descripcion || c.product.nombre || '',
            unidad: c.product.unidad_medida || 'PZA',
            cantidad: c.cantidad,
            precio: c.precio,
            iva_tasa: aplicaIva ? Number(tasaIva) : 0,
          })),
          condicion,
          forma_pago: formaPago,
          notas: notasFull,
          idempotency_key: opKey,
          fecha: fechaHoy,
        };

        try {
          const result = await createVentaDirecta(ventaPayload);
          setConfirmedOrder(result.venta || result);
          setTicketModalVisible(true);
          refreshCaja();
        } catch (netErr: any) {
          // En caso de estar fuera de cobertura celular / offline:
          // Guardar venta localmente con clave idempotente para asignación atómica al reconectar
          const offlineDoc: any = {
            id: `local_${opKey}`,
            folio: 'FOLIO PENDIENTE (Sync)',
            tipo_operacion: 'venta_directa',
            fecha: fechaHoy,
            cliente_id: ventaPayload.cliente_id,
            cliente_nombre: ventaPayload.cliente_nombre,
            items: ventaPayload.items,
            subtotal: totals.subtotal,
            iva: totals.iva,
            total: totals.total,
            condicion,
            forma_pago: formaPago,
            idempotency_key: opKey,
            notas: notasFull,
          };
          await saveOfflineSale(offlineDoc);
          await queueOfflineAction({
            type: 'venta_directa',
            payload: ventaPayload,
          });
          setConfirmedOrder(offlineDoc);
          setTicketModalVisible(true);
          refreshCaja();
          Alert.alert(
            'Venta Guardada Fuera de Línea',
            'Sin señal de internet en este momento. La venta quedó registrada de forma segura en tu teléfono con clave única. En cuanto el dispositivo detecte red de datos se le asignará automáticamente su folio fiscal consecutivo único sin duplicarse.'
          );
        }
      } else {
        // Modo Cotización
        const orderPayload: PedidoInput = {
          cliente_id: selectedClient.id === 'publico_general' ? '' : selectedClient.id,
          vendedor_id: user?.id,
          fecha_pedido: fechaHoy,
          notas: notasFull,
          items: cart.map((c) => ({
            product_id: c.product.id,
            codigo: c.product.sku || '',
            descripcion: c.product.descripcion || c.product.nombre || '',
            unidad: c.product.unidad_medida || 'PZA',
            solicitado: c.cantidad,
            precio: c.precio,
            iva_tasa: aplicaIva ? Number(tasaIva) : 0,
          })),
          idempotency_key: opKey,
        };

        const result = await createOrder(orderPayload);
        setConfirmedOrder(result);
        setTicketModalVisible(true);
      }
    } catch (err: any) {
      Alert.alert('Error en transacción', err.message || 'No se pudo procesar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (val?: number) => {
    const num = Number(val || 0);
    return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 8. Handlers de Apertura y Cierre de Caja en Campo
  const handleAbrirCaja = async () => {
    const fondo = parseFloat(fondoInicialInput) || 0;
    if (fondo < 0) {
      Alert.alert('Monto Inválido', 'El fondo inicial no puede ser negativo.');
      return;
    }
    setSubmittingCaja(true);
    try {
      await abrirCaja(fondo, turnoNombreInput.trim() || undefined);
      await refreshCaja();
      setCajaModalVisible(false);
      setFondoInicialInput('0');
      setTurnoNombreInput('');
      Alert.alert('Caja Abierta', `Se ha iniciado el turno de caja exitosamente con fondo de ${formatCurrency(fondo)}.`);
    } catch (err: any) {
      Alert.alert('Error al abrir caja', err.message || 'No se pudo abrir la caja.');
    } finally {
      setSubmittingCaja(false);
    }
  };

  const handleCerrarCaja = async () => {
    const contado = parseFloat(efectivoContadoInput);
    if (isNaN(contado) || contado < 0) {
      Alert.alert('Monto Requerido', 'Por favor ingresa la cantidad exacta de efectivo en mano contada.');
      return;
    }

    Alert.alert(
      'Confirmar Cierre de Turno',
      `¿Deseas realizar el corte de caja con un conteo de ${formatCurrency(contado)}? Esta acción cerrará el turno actual.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar Corte',
          onPress: async () => {
            setSubmittingCaja(true);
            try {
              const res = await cerrarCaja(contado);
              setCierreResult(res);
              setCajaModalVisible(false);
              setCierreModalVisible(true);
              setEfectivoContadoInput('');
              await refreshCaja();
            } catch (err: any) {
              Alert.alert('Error en Cierre de Caja', err.message || 'No se pudo procesar el corte de caja.');
            } finally {
              setSubmittingCaja(false);
            }
          },
        },
      ]
    );
  };

  const handleSendCorteWhatsApp = (cierreData: CajaCierreResult) => {
    const backendUrl = getBackendUrl();
    const pdfUrl = cierreData.reporte_pdf_url.startsWith('http')
      ? cierreData.reporte_pdf_url
      : `${backendUrl}${cierreData.reporte_pdf_url}`;

    const diff = Number(cierreData.cierre.diferencia || 0);
    const diffSign = diff > 0 ? `+${formatCurrency(diff)} (Sobrante)` : diff < 0 ? `-${formatCurrency(Math.abs(diff))} (Faltante)` : '$0.00 (Exacto)';

    const msg =
      `*CORTE DE CAJA - GRUPO RYSA*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Asesor:* ${user?.name || 'Vendedor'}\n` +
      `📅 *Fecha:* ${new Date().toLocaleDateString('es-MX')} ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}\n` +
      `📦 *Turno ID:* #${cierreData.caja_id.slice(-6).toUpperCase()}\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 *Fondo Inicial:* ${formatCurrency(cierreData.cierre.fondo_inicial)}\n` +
      `🛍️ *Total Ventas:* ${formatCurrency(cierreData.cierre.total_ventas)} (${cierreData.cierre.num_ventas} ventas)\n` +
      `💰 *Ventas Efectivo:* ${formatCurrency(cierreData.cierre.ventas_efectivo)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 *Efectivo Esperado:* ${formatCurrency(cierreData.cierre.efectivo_esperado)}\n` +
      `✋ *Efectivo Contado:* ${formatCurrency(cierreData.cierre.efectivo_contado)}\n` +
      `⚖️ *Diferencia:* ${diffSign}\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📄 *Reporte PDF Oficial:*\n${pdfUrl}\n`;

    const encoded = encodeURIComponent(msg);
    Linking.openURL(`https://wa.me/?text=${encoded}`).catch(() => {
      Linking.openURL(`whatsapp://send?text=${encoded}`).catch(() => {
        Alert.alert('Error', 'No se pudo abrir WhatsApp en el dispositivo.');
      });
    });
  };

  // 9. Registro Exprés de Cliente Nuevo
  const handleCreateNewClient = async () => {
    if (!newClientForm.nombre.trim()) {
      Alert.alert('Campo Requerido', 'Por favor ingresa el nombre del nuevo cliente.');
      return;
    }
    setSavingClient(true);
    try {
      const created = await createClient({
        nombre: newClientForm.nombre.trim(),
        telefono: newClientForm.telefono.trim() || undefined,
        whatsapp: newClientForm.telefono.trim() || undefined,
        direccion: newClientForm.direccion.trim() || undefined,
        ciudad: newClientForm.ciudad.trim() || 'Palenque',
        rfc: newClientForm.rfc.trim() || 'XAXX010101000',
        condicion_pago: newClientForm.condicion_pago,
        tipo: 'publico',
        estado: 'activo',
      });

      const fullClient: Client = {
        ...created,
        en_cartera: true,
        saldo: 0,
        limite_credito: 0,
      };

      setClients((prev) => [fullClient, ...prev]);
      await saveClientsCache([fullClient, ...clients]);
      setSelectedClient(fullClient);
      setNewClientModalVisible(false);
      setClientModalVisible(false);
      setNewClientForm({
        nombre: '',
        telefono: '',
        direccion: '',
        ciudad: 'Palenque',
        rfc: '',
        condicion_pago: 'contado',
      });
      showToast(`✅ Cliente ${fullClient.nombre} registrado y asignado.`);
    } catch (err: any) {
      Alert.alert('Error al registrar cliente', err.message || 'No se pudo crear el cliente.');
    } finally {
      setSavingClient(false);
    }
  };

  // 8. Compartir Comprobante Oficial en formato PDF
  const handleSharePdfTicket = async () => {
    if (!confirmedOrder) return;
    setSharingPdf(true);
    try {
      await shareTicketPdf({
        folio: confirmedOrder.folio || 'PEDIDO',
        fecha: new Date().toLocaleString('es-MX', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        vendedor: user?.name || 'Asesor Comercial',
        clienteNombre: confirmedOrder.cliente_nombre || selectedClient?.nombre || 'Público General',
        clienteRfc: selectedClient?.rfc,
        clienteTelefono: selectedClient?.telefono || selectedClient?.celular,
        clienteDireccion: selectedClient?.direccion,
        condicion: condicion.toUpperCase(),
        formaPago: formaPago.toUpperCase(),
        notas,
        items: cart.map((c) => ({
          cantidad: c.cantidad,
          codigo: c.product.sku || '',
          descripcion: c.product.descripcion || c.product.nombre || 'Artículo',
          unidad: c.product.unidad_medida || 'PZA',
          precio: c.precio,
          subtotal: c.subtotal,
        })),
        subtotalNeto: totals.subtotal,
        tasaIva,
        aplicaIva,
        ivaMonto: totals.iva,
        total: totals.total,
      });
    } catch (err: any) {
      Alert.alert('Comprobante PDF', err?.message || 'No se pudo generar o compartir el archivo PDF.');
    } finally {
      setSharingPdf(false);
    }
  };

  // Finalizar y reiniciar para nueva venta
  const handleFinishSale = () => {
    setTicketModalVisible(false);
    setConfirmedOrder(null);
    setCart([]);
    setSelectedClient(null);
    setNotas('');
    setProductSearch('');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ConnectivityBar />

      {/* Alerta / Toast Flotante al Agregar Producto */}
      {toastMsg && (
        <View style={styles.toastBanner}>
          <MaterialIcons name="check-circle" size={18} color="#FFFFFF" />
          <Text style={styles.toastBannerText} numberOfLines={1}>
            {toastMsg}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Nueva Venta en Campo</Text>
          <Text style={styles.headerSubtitle}>Sucursal Matriz (Palenque) • Pedido Oficial</Text>
        </View>

        {/* Barra de Estado y Control de Caja / Turno */}
        <TouchableOpacity
          style={[
            styles.cajaStatusBar,
            cajaActual?.estado === 'abierta' ? styles.cajaStatusBarOpen : styles.cajaStatusBarClosed,
          ]}
          onPress={() => setCajaModalVisible(true)}
          activeOpacity={0.8}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}>
            <View
              style={[
                styles.cajaStatusDot,
                cajaActual?.estado === 'abierta' ? styles.cajaStatusDotOpen : styles.cajaStatusDotClosed,
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.cajaStatusTitle,
                  cajaActual?.estado === 'abierta' ? styles.cajaStatusTitleOpen : styles.cajaStatusTitleClosed,
                ]}
              >
                {cajaActual?.estado === 'abierta'
                  ? `Turno #${cajaActual.caja_numero || 1} Abierto (${cajaActual.caja_nombre || 'Caja Móvil'})`
                  : 'Caja Cerrada (Turno Inactivo)'}
              </Text>
              <Text style={styles.cajaStatusSub}>
                {cajaActual?.estado === 'abierta'
                  ? `Fondo: ${formatCurrency(cajaActual.fondo_inicial)} • Ventas: ${formatCurrency(cajaResumen?.total_ventas || 0)}`
                  : 'Requerido para venta directa • Toca para abrir'}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.cajaActionBadge,
              cajaActual?.estado === 'abierta' ? styles.cajaActionBadgeOpen : styles.cajaActionBadgeClosed,
            ]}
          >
            <MaterialIcons
              name={cajaActual?.estado === 'abierta' ? 'account-balance-wallet' : 'lock-open'}
              size={14}
              color={cajaActual?.estado === 'abierta' ? '#2E7D32' : '#C53030'}
            />
            <Text
              style={[
                styles.cajaActionText,
                cajaActual?.estado === 'abierta' ? styles.cajaActionTextOpen : styles.cajaActionTextClosed,
              ]}
            >
              {cajaActual?.estado === 'abierta' ? 'Turno' : 'Abrir'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Selector de Tipo de Operación: Venta Directa vs Cotización */}
        <View style={styles.operationTypeCard}>
          <TouchableOpacity
            style={[
              styles.operationTypeBtn,
              tipoOperacion === 'venta_directa' && styles.operationTypeBtnActive,
            ]}
            onPress={() => setTipoOperacion('venta_directa')}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="point-of-sale"
              size={18}
              color={tipoOperacion === 'venta_directa' ? '#FFFFFF' : '#4A5568'}
            />
            <Text
              style={[
                styles.operationTypeBtnText,
                tipoOperacion === 'venta_directa' && styles.operationTypeBtnTextActive,
              ]}
            >
              Venta Directa
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.operationTypeBtn,
              tipoOperacion === 'cotizacion' && styles.operationTypeBtnActiveCot,
            ]}
            onPress={() => setTipoOperacion('cotizacion')}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="request-quote"
              size={18}
              color={tipoOperacion === 'cotizacion' ? '#FFFFFF' : '#4A5568'}
            />
            <Text
              style={[
                styles.operationTypeBtnText,
                tipoOperacion === 'cotizacion' && styles.operationTypeBtnTextActive,
              ]}
            >
              Cotización
            </Text>
          </TouchableOpacity>
        </View>

        {/* 1. Selector de Cliente */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>1. Cliente</Text>
          <TouchableOpacity
            style={styles.clientSelector}
            onPress={() => setClientModalVisible(true)}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={selectedClient?.id === 'publico_general' ? 'storefront' : 'person'}
              size={24}
              color="#D32F2F"
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              {selectedClient ? (
                <>
                  <Text style={styles.selectedClientName}>{selectedClient.nombre}</Text>
                  <Text style={styles.selectedClientSub}>
                    {selectedClient.codigo ? `${selectedClient.codigo} • ` : ''}
                    Lista {selectedClient.lista_precios || 1}
                    {selectedClient.en_cartera ? ` • Saldo: ${formatCurrency(selectedClient.saldo)}` : ' • Cliente General'}
                  </Text>
                </>
              ) : (
                <Text style={styles.placeholderClient}>Toca para elegir un cliente...</Text>
              )}
            </View>
            <MaterialIcons name="arrow-drop-down" size={24} color="#718096" />
          </TouchableOpacity>
        </View>

        {/* 2. Catálogo & Búsqueda de Productos */}
        <View style={styles.sectionCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={styles.sectionLabel}>2. Agregar Productos</Text>
            <Text style={{ fontSize: 12, color: '#718096' }}>
              {allProducts.length} arts. en catálogo
            </Text>
          </View>
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={20} color="#718096" />
            <TextInput
              style={styles.productInput}
              placeholder="Escribe SKU o descripción para buscar..."
              placeholderTextColor="#A0AEC0"
              value={productSearch}
              onChangeText={setProductSearch}
            />
            {loadingCatalog && <ActivityIndicator size="small" color="#D32F2F" />}
          </View>

          {filteredProducts.length === 0 ? (
            <View style={{ paddingVertical: 18, alignItems: 'center' }}>
              <MaterialIcons name="search-off" size={32} color="#A0AEC0" />
              <Text style={{ fontSize: 13, color: '#718096', marginTop: 6, textAlign: 'center' }}>
                {productSearch.trim()
                  ? `No se encontraron productos para "${productSearch}"`
                  : 'Cargando catálogo...'}
              </Text>
            </View>
          ) : (
            <>
              {filteredProducts.map((p) => {
                const hasStock = (p.existencia || 0) > 0;
                const clientPrice = getProductPriceForClient(p, selectedClient);
                const precioConIva = Math.round(clientPrice * 1.08 * 100) / 100;
                const imgUri = p.foto || (p as any).imagen || (p as any).imagen_url;

                return (
                  <View key={p.id} style={styles.productRow}>
                    <View style={styles.productThumbBox}>
                      {imgUri ? (
                        <Image source={{ uri: imgUri }} style={styles.productThumb} resizeMode="contain" />
                      ) : (
                        <View style={styles.productThumbPlaceholder}>
                          <MaterialIcons name="inventory-2" size={22} color="#A0AEC0" />
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.productSku}>{p.sku || 'SIN SKU'}</Text>
                        <View style={[styles.stockBadge, hasStock ? styles.stockBadgeIn : styles.stockBadgeOut]}>
                          <Text style={[styles.stockBadgeText, hasStock ? styles.stockBadgeTextIn : styles.stockBadgeTextOut]}>
                            {hasStock ? `${p.existencia} ${p.unidad_medida || 'PZA'}` : 'Sin stock'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.productDesc} numberOfLines={2}>
                        {p.descripcion}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                        <Text style={styles.productPriceLabel}>Base neto: </Text>
                        <Text style={styles.productPriceHighlight}>{formatCurrency(clientPrice)}</Text>
                        <Text style={styles.productPriceSub}> + IVA 8%: {formatCurrency(precioConIva)}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.addBtn}
                      onPress={() => addToCart(p)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="add" size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                );
              })}
              {allProducts.length > 30 && !productSearch.trim() && (
                <Text style={{ fontSize: 11, color: '#A0AEC0', textAlign: 'center', marginVertical: 8 }}>
                  Mostrando primeros 30 de {allProducts.length} productos. Escribe en el buscador para filtrar al instante.
                </Text>
              )}
            </>
          )}
        </View>

        {/* 3. Resumen de Pedido / Carrito */}
        <View style={styles.sectionCard}>
          <View style={styles.cartHeader}>
            <Text style={styles.sectionLabel}>3. Resumen de Pedido ({cart.length})</Text>
            {cart.length > 0 && (
              <TouchableOpacity onPress={() => setCart([])}>
                <Text style={styles.clearCartText}>Vaciar</Text>
              </TouchableOpacity>
            )}
          </View>

          {cart.length === 0 ? (
            <View style={{ paddingVertical: 14, alignItems: 'center' }}>
              <MaterialIcons name="shopping-cart" size={28} color="#CBD5E0" />
              <Text style={{ fontSize: 12, color: '#A0AEC0', marginTop: 4 }}>
                Aún no has agregado artículos al pedido.
              </Text>
            </View>
          ) : (
            cart.map((item) => (
              <View key={item.product.id} style={styles.cartRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cartItemDesc} numberOfLines={1}>
                    {item.product.descripcion}
                  </Text>
                  <Text style={styles.cartItemPrice}>
                    {formatCurrency(item.precio)} c/u
                  </Text>
                </View>
                <View style={styles.qtyControl}>
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={() => updateQuantity(item.product.id, -1)}
                  >
                    <MaterialIcons name="remove" size={14} color="#D32F2F" />
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{item.cantidad}</Text>
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={() => updateQuantity(item.product.id, 1)}
                  >
                    <MaterialIcons name="add" size={14} color="#D32F2F" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.cartItemSubtotal}>{formatCurrency(item.subtotal)}</Text>
              </View>
            ))
          )}

          {/* Totales con desglose exacto de IVA */}
          {cart.length > 0 && (
            <View style={styles.totalsContainer}>
              {/* Controles de Configuración de IVA */}
              <View style={styles.ivaConfigRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="receipt-long" size={16} color="#4A5568" />
                  <Text style={styles.ivaConfigLabel}>¿Aplica IVA en la venta?</Text>
                </View>
                <View style={styles.ivaToggleWrap}>
                  <TouchableOpacity
                    style={[styles.ivaToggleBtn, aplicaIva && styles.ivaToggleBtnActive]}
                    onPress={() => setAplicaIva(true)}
                  >
                    <Text style={[styles.ivaToggleText, aplicaIva && styles.ivaToggleTextActive]}>Sí</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.ivaToggleBtn, !aplicaIva && styles.ivaToggleBtnActive]}
                    onPress={() => setAplicaIva(false)}
                  >
                    <Text style={[styles.ivaToggleText, !aplicaIva && styles.ivaToggleTextActive]}>No</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {aplicaIva && (
                <View style={styles.ivaInputRow}>
                  <Text style={styles.ivaInputLabel}>Porcentaje de IVA (%):</Text>
                  <View style={styles.ivaPercentInputWrap}>
                    <TextInput
                      style={styles.ivaPercentInput}
                      keyboardType="numeric"
                      value={String(tasaIva)}
                      onChangeText={(t) => {
                        const num = Number(t.replace(/[^0-9.]/g, ''));
                        setTasaIva(isNaN(num) ? 0 : num);
                      }}
                      maxLength={4}
                    />
                    <Text style={styles.ivaPercentSuffix}>%</Text>
                  </View>
                </View>
              )}

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal Neto:</Text>
                <Text style={styles.totalVal}>{formatCurrency(totals.subtotal)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>IVA Trasladado ({aplicaIva ? `${tasaIva}%` : '0%'}):</Text>
                <Text style={styles.totalVal}>{formatCurrency(totals.iva)}</Text>
              </View>
              <View style={[styles.totalRow, styles.totalRowHighlight]}>
                <Text style={styles.finalTotalLabel}>TOTAL A PAGAR:</Text>
                <Text style={styles.finalTotalVal}>{formatCurrency(totals.total)}</Text>
              </View>
            </View>
          )}
        </View>

        {/* 4. Condiciones de Pago */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>4. Condición y Pago</Text>
          <View style={styles.condicionRow}>
            <TouchableOpacity
              style={[styles.condicionBtn, condicion === 'contado' && styles.condicionBtnActive]}
              onPress={() => setCondicion('contado')}
            >
              <Text style={[styles.condicionText, condicion === 'contado' && styles.condicionTextActive]}>
                Contado
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.condicionBtn, condicion === 'credito' && styles.condicionBtnActive]}
              onPress={() => setCondicion('credito')}
            >
              <Text style={[styles.condicionText, condicion === 'credito' && styles.condicionTextActive]}>
                Crédito
              </Text>
            </TouchableOpacity>
          </View>

          {condicion === 'contado' && (
            <View style={styles.formaPagoRow}>
              {['efectivo', 'transferencia', 'tarjeta'].map((forma) => (
                <TouchableOpacity
                  key={forma}
                  style={[styles.formaBtn, formaPago === forma && styles.formaBtnActive]}
                  onPress={() => setFormaPago(forma)}
                >
                  <Text style={[styles.formaText, formaPago === forma && styles.formaTextActive]}>
                    {forma.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TextInput
            style={styles.notesInput}
            placeholder="Notas u observaciones de entrega (opcional)..."
            placeholderTextColor="#A0AEC0"
            value={notas}
            onChangeText={setNotas}
            multiline
          />
        </View>

        {/* Botón de Confirmación */}
        <TouchableOpacity
          style={[
            styles.confirmBtn,
            tipoOperacion === 'venta_directa' ? styles.confirmBtnVenta : styles.confirmBtnCotizacion,
            (submitting || cart.length === 0 || !selectedClient) && styles.confirmBtnDisabled,
            { marginBottom: Math.max(insets.bottom, 16) + 12 },
          ]}
          onPress={handleConfirmSale}
          disabled={submitting || cart.length === 0 || !selectedClient}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialIcons
                name={tipoOperacion === 'venta_directa' ? 'point-of-sale' : 'request-quote'}
                size={22}
                color="#FFFFFF"
              />
              <Text style={styles.confirmBtnText}>
                {tipoOperacion === 'venta_directa'
                  ? `Finalizar Venta Directa (${formatCurrency(totals.total)})`
                  : `Generar Cotización (${formatCurrency(totals.total)})`}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Modal Selección de Cliente */}
      <Modal
        visible={clientModalVisible}
        animationType="slide"
        onRequestClose={() => setClientModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <View style={styles.clientModalHeader}>
            <Text style={styles.clientModalTitle}>Seleccionar Cliente</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity
                style={styles.addClientHeaderBtn}
                onPress={() => setNewClientModalVisible(true)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="person-add" size={16} color="#FFFFFF" />
                <Text style={styles.addClientHeaderBtnText}>+ Nuevo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setClientModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#718096" />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.clientSearchBox}>
            <MaterialIcons name="search" size={20} color="#718096" />
            <TextInput
              style={{ flex: 1, marginLeft: 8, fontSize: 14 }}
              placeholder="Buscar por nombre, código o ciudad..."
              placeholderTextColor="#A0AEC0"
              value={clientSearch}
              onChangeText={setClientSearch}
            />
          </View>
          <FlatList
            data={filteredClients}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isPub = item.id === 'publico_general';
              return (
                <TouchableOpacity
                  style={[styles.clientPickerItem, isPub && styles.clientPickerPublico]}
                  onPress={() => {
                    setSelectedClient(item);
                    setClientModalVisible(false);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[styles.pickerClientName, isPub && { color: '#D32F2F', fontWeight: '800' }]}>
                      {item.nombre}
                    </Text>
                    {isPub ? (
                      <View style={styles.badgePublico}>
                        <Text style={styles.badgePublicoText}>Mostrador</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeCartera}>
                        <Text style={styles.badgeCarteraText}>⭐ Cliente en cartera</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.pickerClientInfo}>
                    {item.codigo ? `${item.codigo} • ` : ''}
                    {item.ciudad || item.colonia || 'Palenque'}
                    {item.en_cartera ? ` • Saldo: ${formatCurrency(item.saldo)}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </SafeAreaView>
      </Modal>

      {/* Modal: Alta Rápida de Cliente en Campo */}
      <Modal
        visible={newClientModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setNewClientModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="person-add" size={22} color="#D32F2F" />
                <Text style={styles.modalHeaderTitle}>Nuevo Cliente en Campo</Text>
              </View>
              <TouchableOpacity onPress={() => setNewClientModalVisible(false)}>
                <MaterialIcons name="close" size={22} color="#718096" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
              <Text style={styles.inputFieldLabel}>Nombre Completo / Razón Social *</Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder="Ej. Taller Mecánico San Juan / Juan Pérez"
                placeholderTextColor="#A0AEC0"
                value={newClientForm.nombre}
                onChangeText={(t) => setNewClientForm((p) => ({ ...p, nombre: t }))}
              />

              <Text style={styles.inputFieldLabel}>Teléfono / WhatsApp</Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder="10 dígitos (ej. 9161234567)"
                placeholderTextColor="#A0AEC0"
                keyboardType="phone-pad"
                value={newClientForm.telefono}
                onChangeText={(t) => setNewClientForm((p) => ({ ...p, telefono: t }))}
              />

              <Text style={styles.inputFieldLabel}>Dirección (Calle y No.)</Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder="Calle, No. Exterior, Colonia"
                placeholderTextColor="#A0AEC0"
                value={newClientForm.direccion}
                onChangeText={(t) => setNewClientForm((p) => ({ ...p, direccion: t }))}
              />

              <Text style={styles.inputFieldLabel}>Ciudad / Municipio</Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder="Palenque"
                placeholderTextColor="#A0AEC0"
                value={newClientForm.ciudad}
                onChangeText={(t) => setNewClientForm((p) => ({ ...p, ciudad: t }))}
              />

              <Text style={styles.inputFieldLabel}>RFC (Opcional)</Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder="XAXX010101000"
                placeholderTextColor="#A0AEC0"
                autoCapitalize="characters"
                value={newClientForm.rfc}
                onChangeText={(t) => setNewClientForm((p) => ({ ...p, rfc: t }))}
              />

              <Text style={styles.inputFieldLabel}>Condición Comercial Inicial</Text>
              <View style={styles.condicionRow}>
                <TouchableOpacity
                  style={[
                    styles.condicionBtn,
                    newClientForm.condicion_pago === 'contado' && styles.condicionBtnActive,
                  ]}
                  onPress={() => setNewClientForm((p) => ({ ...p, condicion_pago: 'contado' }))}
                >
                  <Text
                    style={[
                      styles.condicionText,
                      newClientForm.condicion_pago === 'contado' && styles.condicionTextActive,
                    ]}
                  >
                    Contado (Recomendado)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.condicionBtn,
                    newClientForm.condicion_pago === 'credito' && styles.condicionBtnActive,
                  ]}
                  onPress={() => setNewClientForm((p) => ({ ...p, condicion_pago: 'credito' }))}
                >
                  <Text
                    style={[
                      styles.condicionText,
                      newClientForm.condicion_pago === 'credito' && styles.condicionTextActive,
                    ]}
                  >
                    Crédito
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.modalSubmitBtn, savingClient && { opacity: 0.6 }]}
                onPress={handleCreateNewClient}
                disabled={savingClient}
                activeOpacity={0.8}
              >
                {savingClient ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <MaterialIcons name="check" size={18} color="#FFFFFF" />
                    <Text style={styles.modalSubmitBtnText}>Registrar y Seleccionar para Venta</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal: Control y Gestión de Turno de Caja */}
      <Modal
        visible={cajaModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setCajaModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <MaterialIcons
                  name="point-of-sale"
                  size={24}
                  color={cajaActual?.estado === 'abierta' ? '#2E7D32' : '#D32F2F'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalHeaderTitle}>
                    {cajaActual?.estado === 'abierta' ? 'Caja / Turno en Operación' : 'Apertura de Caja'}
                  </Text>
                  <Text style={styles.modalHeaderSubtitle}>
                    {cajaActual?.estado === 'abierta'
                      ? `Turno #${cajaActual.caja_numero || 1} • Asesor: ${user?.name || 'Vendedor'}`
                      : 'Inicia tu turno de venta para poder cobrar en ruta'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setCajaModalVisible(false)}>
                <MaterialIcons name="close" size={22} color="#718096" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
              {cajaActual?.estado === 'abierta' ? (
                <>
                  {/* Resumen del Turno Abierto */}
                  <View style={styles.cajaSummaryBox}>
                    <View style={styles.cajaSummaryRow}>
                      <Text style={styles.cajaSummaryLabel}>Fondo Inicial:</Text>
                      <Text style={styles.cajaSummaryVal}>{formatCurrency(cajaActual.fondo_inicial)}</Text>
                    </View>
                    <View style={styles.cajaSummaryRow}>
                      <Text style={styles.cajaSummaryLabel}>Ventas en Efectivo:</Text>
                      <Text style={[styles.cajaSummaryVal, { color: '#2E7D32' }]}>
                        +{formatCurrency(cajaResumen?.ventas_efectivo || 0)}
                      </Text>
                    </View>
                    <View style={styles.cajaSummaryRow}>
                      <Text style={styles.cajaSummaryLabel}>Ventas Otros (Transf/Tarjeta):</Text>
                      <Text style={styles.cajaSummaryVal}>{formatCurrency(cajaResumen?.ventas_otros || 0)}</Text>
                    </View>
                    <View style={styles.cajaSummaryRow}>
                      <Text style={styles.cajaSummaryLabel}>Total Ventas del Turno:</Text>
                      <Text style={[styles.cajaSummaryVal, { fontWeight: '700' }]}>
                        {formatCurrency(cajaResumen?.total_ventas || 0)}
                      </Text>
                    </View>
                    <View style={styles.cajaSummaryDivider} />
                    <View style={styles.cajaSummaryRow}>
                      <Text style={[styles.cajaSummaryLabel, { fontWeight: '800', color: '#1A202C' }]}>
                        EFECTIVO ESPERADO EN MANO:
                      </Text>
                      <Text style={[styles.cajaSummaryVal, { fontWeight: '800', color: '#1976D2', fontSize: 16 }]}>
                        {formatCurrency(cajaResumen?.efectivo_esperado || cajaActual.fondo_inicial)}
                      </Text>
                    </View>
                  </View>

                  {/* Arqueo para Cierre de Caja */}
                  <View style={styles.cierreSection}>
                    <Text style={styles.cierreTitle}>Cierre de Turno (Arqueo de Efectivo)</Text>
                    <Text style={styles.cierreSubtitle}>
                      Cuenta el dinero físico que tienes en mano e ingresa el monto total para realizar el corte:
                    </Text>

                    <Text style={styles.inputFieldLabel}>Efectivo Físico Contado ($) *</Text>
                    <TextInput
                      style={[styles.modalTextInput, { fontSize: 18, fontWeight: '700', textAlign: 'center' }]}
                      placeholder="0.00"
                      placeholderTextColor="#A0AEC0"
                      keyboardType="numeric"
                      value={efectivoContadoInput}
                      onChangeText={setEfectivoContadoInput}
                    />

                    {efectivoContadoInput.trim() !== '' && (
                      <View style={styles.diffBox}>
                        <Text style={styles.diffLabel}>Diferencia de Arqueo:</Text>
                        {(() => {
                          const contado = parseFloat(efectivoContadoInput) || 0;
                          const esperado = Number(cajaResumen?.efectivo_esperado ?? cajaActual.fondo_inicial);
                          const diff = contado - esperado;
                          const isOk = Math.abs(diff) < 0.01;
                          const isSurplus = diff > 0;
                          return (
                            <Text
                              style={[
                                styles.diffValue,
                                isOk ? styles.diffExact : isSurplus ? styles.diffSurplus : styles.diffShort,
                              ]}
                            >
                              {isSurplus ? '+' : ''}
                              {formatCurrency(diff)} ({isOk ? 'Cuadrado' : isSurplus ? 'Sobrante' : 'Faltante'})
                            </Text>
                          );
                        })()}
                      </View>
                    )}

                    <TouchableOpacity
                      style={[styles.closeTurnoBtn, submittingCaja && { opacity: 0.6 }]}
                      onPress={handleCerrarCaja}
                      disabled={submittingCaja}
                      activeOpacity={0.8}
                    >
                      {submittingCaja ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <>
                          <MaterialIcons name="lock" size={18} color="#FFFFFF" />
                          <Text style={styles.closeTurnoBtnText}>Cerrar Caja (Corte de Turno)</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  {/* Formulario de Apertura */}
                  <View style={styles.aperturaNotice}>
                    <MaterialIcons name="info" size={20} color="#E65100" />
                    <Text style={styles.aperturaNoticeText}>
                      Al abrir tu turno podrás realizar ventas directas, cobros en efectivo y transferencias desde el punto de venta.
                    </Text>
                  </View>

                  <Text style={styles.inputFieldLabel}>Fondo Inicial de Caja ($ Efectivo)</Text>
                  <TextInput
                    style={[styles.modalTextInput, { fontSize: 18, fontWeight: '700', textAlign: 'center' }]}
                    placeholder="0.00"
                    placeholderTextColor="#A0AEC0"
                    keyboardType="numeric"
                    value={fondoInicialInput}
                    onChangeText={setFondoInicialInput}
                  />

                  <Text style={styles.inputFieldLabel}>Nombre o Identificador del Turno (Opcional)</Text>
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="Ej. Ruta Centro Palenque / Turno Mañana"
                    placeholderTextColor="#A0AEC0"
                    value={turnoNombreInput}
                    onChangeText={setTurnoNombreInput}
                  />

                  <TouchableOpacity
                    style={[styles.openTurnoBtn, submittingCaja && { opacity: 0.6 }]}
                    onPress={handleAbrirCaja}
                    disabled={submittingCaja}
                    activeOpacity={0.8}
                  >
                    {submittingCaja ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <MaterialIcons name="lock-open" size={18} color="#FFFFFF" />
                        <Text style={styles.openTurnoBtnText}>Abrir Caja e Iniciar Turno</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal: Resultado del Corte de Caja con Reporte PDF y WhatsApp */}
      <Modal
        visible={cierreModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setCierreModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { maxHeight: '90%' }]}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <View style={styles.cierreSuccessBadge}>
                <MaterialIcons name="check-circle" size={42} color="#2E7D32" />
              </View>
              <Text style={styles.cierreSuccessTitle}>¡Corte de Caja Exitoso!</Text>
              <Text style={styles.cierreSuccessSubtitle}>
                El turno se cerró correctamente y el reporte oficial ha sido generado.
              </Text>
            </View>

            {cierreResult && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
                <View style={styles.corteDataCard}>
                  <View style={styles.corteDataRow}>
                    <Text style={styles.corteDataLabel}>Turno ID:</Text>
                    <Text style={styles.corteDataVal}>#{cierreResult.caja_id.slice(-6).toUpperCase()}</Text>
                  </View>
                  <View style={styles.corteDataRow}>
                    <Text style={styles.corteDataLabel}>Fondo Inicial:</Text>
                    <Text style={styles.corteDataVal}>{formatCurrency(cierreResult.cierre.fondo_inicial)}</Text>
                  </View>
                  <View style={styles.corteDataRow}>
                    <Text style={styles.corteDataLabel}>Total Ventas ({cierreResult.cierre.num_ventas} vtas):</Text>
                    <Text style={[styles.corteDataVal, { fontWeight: '700' }]}>
                      {formatCurrency(cierreResult.cierre.total_ventas)}
                    </Text>
                  </View>
                  <View style={styles.corteDataRow}>
                    <Text style={styles.corteDataLabel}>Ventas en Efectivo:</Text>
                    <Text style={[styles.corteDataVal, { color: '#2E7D32' }]}>
                      {formatCurrency(cierreResult.cierre.ventas_efectivo)}
                    </Text>
                  </View>
                  <View style={styles.corteDataRow}>
                    <Text style={styles.corteDataLabel}>Efectivo Esperado:</Text>
                    <Text style={styles.corteDataVal}>{formatCurrency(cierreResult.cierre.efectivo_esperado)}</Text>
                  </View>
                  <View style={styles.corteDataRow}>
                    <Text style={styles.corteDataLabel}>Efectivo Contado:</Text>
                    <Text style={[styles.corteDataVal, { fontWeight: '700' }]}>
                      {formatCurrency(cierreResult.cierre.efectivo_contado)}
                    </Text>
                  </View>
                  <View style={styles.corteDataDivider} />
                  <View style={styles.corteDataRow}>
                    <Text style={[styles.corteDataLabel, { fontWeight: '800' }]}>Diferencia:</Text>
                    <Text
                      style={[
                        styles.corteDataVal,
                        {
                          fontWeight: '800',
                          color:
                            cierreResult.cierre.diferencia > 0
                              ? '#2E7D32'
                              : cierreResult.cierre.diferencia < 0
                              ? '#D32F2F'
                              : '#1A202C',
                        },
                      ]}
                    >
                      {cierreResult.cierre.diferencia > 0 ? '+' : ''}
                      {formatCurrency(cierreResult.cierre.diferencia)}
                    </Text>
                  </View>
                </View>

                {/* Botón Destacado: Enviar por WhatsApp */}
                <TouchableOpacity
                  style={styles.whatsappShareBtn}
                  onPress={() => handleSendCorteWhatsApp(cierreResult)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="send" size={20} color="#FFFFFF" />
                  <Text style={styles.whatsappShareBtnText}>Enviar Corte por WhatsApp</Text>
                </TouchableOpacity>

                {/* Ver PDF */}
                <TouchableOpacity
                  style={styles.pdfReportBtn}
                  onPress={() => {
                    const fullPdf = cierreResult.reporte_pdf_url.startsWith('http')
                      ? cierreResult.reporte_pdf_url
                      : `${getBackendUrl()}${cierreResult.reporte_pdf_url}`;
                    Linking.openURL(fullPdf).catch(() => {
                      Alert.alert('PDF', 'No se pudo abrir el visor de PDF.');
                    });
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="picture-as-pdf" size={18} color="#D32F2F" />
                  <Text style={styles.pdfReportBtnText}>Descargar / Ver PDF Oficial</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.closeCierreModalBtn}
                  onPress={() => {
                    setCierreModalVisible(false);
                    setCierreResult(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.closeCierreModalBtnText}>Terminar</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL: Ticket / Comprobante Oficial con Logo y Exportación PDF */}
      <Modal
        visible={ticketModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setTicketModalVisible(false)}
      >
        <View style={styles.ticketOverlay}>
          <View style={styles.ticketContainer}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.ticketScroll}>
              {/* Encabezado Institucional del Ticket */}
              <View style={styles.ticketHeader}>
                <Image
                  source={require('../../../assets/images/rysa-logo.png')}
                  style={styles.ticketLogo}
                  resizeMode="contain"
                />
                <Text style={styles.ticketCompany}>GRUPO RYSA</Text>
                <Text style={styles.ticketBranch}>Sucursal Matriz (Palenque, Chiapas)</Text>
                <View style={styles.ticketFolioBadge}>
                  <Text style={styles.ticketFolioText}>FOLIO: {confirmedOrder?.folio || 'PEDIDO'}</Text>
                </View>
              </View>

              <View style={styles.ticketDivider} />

              {/* Datos de la Venta */}
              <View style={styles.ticketMetaRow}>
                <Text style={styles.ticketMetaLabel}>Fecha y Hora:</Text>
                <Text style={styles.ticketMetaValue}>
                  {new Date().toLocaleDateString('es-MX')} {new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <View style={styles.ticketMetaRow}>
                <Text style={styles.ticketMetaLabel}>Asesor:</Text>
                <Text style={styles.ticketMetaValue}>{user?.name || 'Vendedor'}</Text>
              </View>
              <View style={styles.ticketMetaRow}>
                <Text style={styles.ticketMetaLabel}>Cliente:</Text>
                <Text style={[styles.ticketMetaValue, { fontWeight: '700' }]} numberOfLines={1}>
                  {confirmedOrder?.cliente_nombre || selectedClient?.nombre}
                </Text>
              </View>
              <View style={styles.ticketMetaRow}>
                <Text style={styles.ticketMetaLabel}>Condición:</Text>
                <Text style={styles.ticketMetaValue}>
                  {condicion.toUpperCase()} ({formaPago.toUpperCase()})
                </Text>
              </View>

              <View style={styles.ticketDivider} />

              {/* Detalle de Artículos */}
              <Text style={styles.ticketSectionTitle}>ARTÍCULOS</Text>
              {cart.map((item, idx) => (
                <View key={idx} style={styles.ticketItemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ticketItemDesc} numberOfLines={1}>
                      {item.cantidad}x {item.product.descripcion}
                    </Text>
                    <Text style={styles.ticketItemSku}>
                      {item.product.sku} • {formatCurrency(item.precio)} c/u
                    </Text>
                  </View>
                  <Text style={styles.ticketItemTotal}>{formatCurrency(item.subtotal)}</Text>
                </View>
              ))}

              <View style={styles.ticketDivider} />

              {/* Resumen Financiero */}
              <View style={styles.ticketMetaRow}>
                <Text style={styles.ticketMetaLabel}>Subtotal Neto:</Text>
                <Text style={styles.ticketMetaValue}>{formatCurrency(totals.subtotal)}</Text>
              </View>
              <View style={styles.ticketMetaRow}>
                <Text style={styles.ticketMetaLabel}>IVA Trasladado ({aplicaIva ? `${tasaIva}%` : '0%'}):</Text>
                <Text style={styles.ticketMetaValue}>{formatCurrency(totals.iva)}</Text>
              </View>
              <View style={[styles.ticketMetaRow, { marginTop: 6 }]}>
                <Text style={styles.ticketTotalLabel}>TOTAL:</Text>
                <Text style={styles.ticketTotalValue}>{formatCurrency(totals.total)}</Text>
              </View>

              <Text style={styles.ticketFooterNote}>
                ¡Gracias por su compra!{'\n'}Comprobante oficial expedido en PDF por Grupo RYSA Móvil.
              </Text>
            </ScrollView>

            {/* Botones de Acción del Ticket (Descarga y Compartir PDF Real) */}
            <View style={styles.ticketActions}>
              <TouchableOpacity
                style={[styles.sharePdfBtn, sharingPdf && { opacity: 0.6 }]}
                onPress={handleSharePdfTicket}
                disabled={sharingPdf}
                activeOpacity={0.8}
              >
                {sharingPdf ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="picture-as-pdf" size={18} color="#FFFFFF" />
                    <Text style={styles.sharePdfBtnText}>Enviar PDF</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.finishBtn}
                onPress={handleFinishSale}
                activeOpacity={0.8}
              >
                <MaterialIcons name="check" size={18} color="#FFFFFF" />
                <Text style={styles.finishBtnText}>Listo</Text>
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
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 14,
  },
  toastBanner: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    zIndex: 999,
    backgroundColor: '#2E7D32',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 6,
  },
  toastBannerText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    flex: 1,
  },
  header: {
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A202C',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  operationTypeCard: {
    flexDirection: 'row',
    backgroundColor: '#EDF2F7',
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
    gap: 6,
  },
  operationTypeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  operationTypeBtnActive: {
    backgroundColor: '#2E7D32',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  operationTypeBtnActiveCot: {
    backgroundColor: '#1976D2',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  operationTypeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4A5568',
  },
  operationTypeBtnTextActive: {
    color: '#FFFFFF',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  clientSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    padding: 12,
    borderRadius: 8,
  },
  selectedClientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A202C',
  },
  selectedClientSub: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  placeholderClient: {
    fontSize: 13,
    color: '#A0AEC0',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 10,
    borderRadius: 8,
    height: 40,
    marginBottom: 10,
  },
  productInput: {
    flex: 1,
    marginLeft: 6,
    fontSize: 13,
    color: '#1A202C',
  },
  productThumbBox: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  productThumb: {
    width: '100%',
    height: '100%',
  },
  productThumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7FAFC',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  productSku: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5568',
  },
  stockBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  stockBadgeIn: {
    backgroundColor: '#DEF7EC',
  },
  stockBadgeOut: {
    backgroundColor: '#FDE8E8',
  },
  stockBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  stockBadgeTextIn: {
    color: '#03543F',
  },
  stockBadgeTextOut: {
    color: '#9B1C1C',
  },
  productDesc: {
    fontSize: 13,
    color: '#1A202C',
    fontWeight: '500',
    marginTop: 1,
  },
  productPriceLabel: {
    fontSize: 11,
    color: '#718096',
  },
  productPriceHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D32F2F',
  },
  productPriceSub: {
    fontSize: 11,
    color: '#718096',
    fontWeight: '500',
  },
  addBtn: {
    backgroundColor: '#D32F2F',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  clearCartText: {
    fontSize: 12,
    color: '#E53E3E',
    fontWeight: '600',
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  cartItemDesc: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A202C',
  },
  cartItemPrice: {
    fontSize: 11,
    color: '#718096',
  },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    marginHorizontal: 8,
  },
  qtyBtn: {
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  qtyText: {
    fontSize: 12,
    fontWeight: '700',
    minWidth: 18,
    textAlign: 'center',
  },
  cartItemSubtotal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A202C',
    minWidth: 60,
    textAlign: 'right',
  },
  totalsContainer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  ivaConfigRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  ivaConfigLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
  },
  ivaToggleWrap: {
    flexDirection: 'row',
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    padding: 2,
  },
  ivaToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  ivaToggleBtnActive: {
    backgroundColor: '#D32F2F',
  },
  ivaToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#718096',
  },
  ivaToggleTextActive: {
    color: '#FFFFFF',
  },
  ivaInputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ivaInputLabel: {
    fontSize: 11,
    color: '#718096',
  },
  ivaPercentInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    paddingHorizontal: 8,
    height: 28,
  },
  ivaPercentInput: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A202C',
    width: 32,
    textAlign: 'center',
    padding: 0,
  },
  ivaPercentSuffix: {
    fontSize: 11,
    fontWeight: '700',
    color: '#718096',
    marginLeft: 2,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalRowHighlight: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  totalLabel: {
    fontSize: 12,
    color: '#718096',
  },
  totalVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3748',
  },
  finalTotalLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A202C',
  },
  finalTotalVal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#D32F2F',
  },
  condicionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  condicionBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    alignItems: 'center',
  },
  condicionBtnActive: {
    backgroundColor: '#D32F2F',
  },
  condicionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4A5568',
  },
  condicionTextActive: {
    color: '#FFFFFF',
  },
  formaPagoRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  formaBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    alignItems: 'center',
  },
  formaBtnActive: {
    backgroundColor: '#2D3748',
  },
  formaText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5568',
  },
  formaTextActive: {
    color: '#FFFFFF',
  },
  notesInput: {
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    padding: 10,
    fontSize: 12,
    color: '#1A202C',
    minHeight: 50,
    textAlignVertical: 'top',
  },
  confirmBtn: {
    backgroundColor: '#D32F2F',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  confirmBtnVenta: {
    backgroundColor: '#2E7D32',
  },
  confirmBtnCotizacion: {
    backgroundColor: '#1976D2',
  },
  confirmBtnDisabled: {
    backgroundColor: '#CBD5E0',
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  clientModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  clientModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A202C',
  },
  clientSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    margin: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    height: 42,
  },
  clientPickerItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  clientPickerPublico: {
    backgroundColor: '#FFF5F5',
    borderLeftWidth: 4,
    borderLeftColor: '#D32F2F',
  },
  pickerClientName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A202C',
    flex: 1,
    marginRight: 8,
  },
  pickerClientInfo: {
    fontSize: 12,
    color: '#718096',
    marginTop: 4,
  },
  badgePublico: {
    backgroundColor: '#FED7D7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgePublicoText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#C53030',
  },
  badgeCartera: {
    backgroundColor: '#C6F6D5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeCarteraText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#22543D',
  },
  badgeGeneral: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeGeneralText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4A5568',
  },
  ticketOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  ticketContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxHeight: '85%',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  ticketScroll: {
    paddingBottom: 10,
  },
  ticketHeader: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  ticketLogo: {
    width: 140,
    height: 48,
    marginBottom: 6,
  },
  ticketCompany: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A202C',
  },
  ticketBranch: {
    fontSize: 11,
    color: '#D32F2F',
    fontWeight: '600',
    marginTop: 2,
  },
  ticketFolioBadge: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FEB2B2',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
  },
  ticketFolioText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D32F2F',
  },
  ticketDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 10,
  },
  ticketMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  ticketMetaLabel: {
    fontSize: 11,
    color: '#718096',
  },
  ticketMetaValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2D3748',
  },
  ticketSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5568',
    marginBottom: 6,
  },
  ticketItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  ticketItemDesc: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1A202C',
  },
  ticketItemSku: {
    fontSize: 10,
    color: '#718096',
  },
  ticketItemTotal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A202C',
  },
  ticketTotalLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A202C',
  },
  ticketTotalValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#D32F2F',
  },
  ticketFooterNote: {
    fontSize: 10,
    color: '#A0AEC0',
    textAlign: 'center',
    marginTop: 12,
  },
  ticketActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
  },
  sharePdfBtn: {
    flex: 2,
    backgroundColor: '#D32F2F',
    borderRadius: 8,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sharePdfBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  finishBtn: {
    flex: 1,
    backgroundColor: '#2D3748',
    borderRadius: 8,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  finishBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Barra de Estado de Caja
  cajaStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
  },
  cajaStatusBarOpen: {
    backgroundColor: '#F0FFF4',
    borderColor: '#C6F6D5',
  },
  cajaStatusBarClosed: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FEB2B2',
  },
  cajaStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  cajaStatusDotOpen: {
    backgroundColor: '#38A169',
  },
  cajaStatusDotClosed: {
    backgroundColor: '#E53E3E',
  },
  cajaStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  cajaStatusTitleOpen: {
    color: '#22543D',
  },
  cajaStatusTitleClosed: {
    color: '#9B2C2C',
  },
  cajaStatusSub: {
    fontSize: 11,
    color: '#718096',
    marginTop: 1,
  },
  cajaActionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
  },
  cajaActionBadgeOpen: {
    backgroundColor: '#C6F6D5',
  },
  cajaActionBadgeClosed: {
    backgroundColor: '#FED7D7',
  },
  cajaActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cajaActionTextOpen: {
    color: '#22543D',
  },
  cajaActionTextClosed: {
    color: '#9B2C2C',
  },
  addClientHeaderBtn: {
    backgroundColor: '#D32F2F',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
  },
  addClientHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxHeight: '85%',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    marginBottom: 14,
  },
  modalHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A202C',
  },
  modalHeaderSubtitle: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  inputFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4A5568',
    marginBottom: 4,
    marginTop: 10,
  },
  modalTextInput: {
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1A202C',
  },
  modalSubmitBtn: {
    backgroundColor: '#D32F2F',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  modalSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cajaSummaryBox: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  cajaSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  cajaSummaryLabel: {
    fontSize: 12,
    color: '#4A5568',
  },
  cajaSummaryVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A202C',
  },
  cajaSummaryDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 8,
  },
  cierreSection: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    paddingTop: 12,
  },
  cierreTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A202C',
  },
  cierreSubtitle: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
    marginBottom: 8,
  },
  diffBox: {
    backgroundColor: '#EDF2F7',
    padding: 10,
    borderRadius: 8,
    marginVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  diffLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
  },
  diffValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  diffExact: {
    color: '#2E7D32',
  },
  diffSurplus: {
    color: '#1976D2',
  },
  diffShort: {
    color: '#D32F2F',
  },
  closeTurnoBtn: {
    backgroundColor: '#C53030',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  closeTurnoBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  aperturaNotice: {
    backgroundColor: '#FFF8E1',
    borderColor: '#FFE082',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  aperturaNoticeText: {
    fontSize: 11,
    color: '#E65100',
    flex: 1,
    fontWeight: '500',
  },
  openTurnoBtn: {
    backgroundColor: '#2E7D32',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  openTurnoBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cierreSuccessBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  cierreSuccessTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1A202C',
  },
  cierreSuccessSubtitle: {
    fontSize: 12,
    color: '#718096',
    textAlign: 'center',
    marginTop: 2,
    paddingHorizontal: 12,
  },
  corteDataCard: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 12,
  },
  corteDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  corteDataLabel: {
    fontSize: 12,
    color: '#4A5568',
  },
  corteDataVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A202C',
  },
  corteDataDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 8,
  },
  whatsappShareBtn: {
    backgroundColor: '#25D366',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  whatsappShareBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  pdfReportBtn: {
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FEB2B2',
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  pdfReportBtnText: {
    color: '#D32F2F',
    fontSize: 13,
    fontWeight: '700',
  },
  closeCierreModalBtn: {
    backgroundColor: '#EDF2F7',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeCierreModalBtnText: {
    color: '#4A5568',
    fontSize: 13,
    fontWeight: '600',
  },
});
