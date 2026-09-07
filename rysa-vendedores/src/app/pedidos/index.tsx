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
import { getFullCatalog, getSellerClients, createOrder } from '@/services/salesService';
import { getCatalogCache, getClientsCache, saveClientsCache } from '@/services/offlineCache';
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

  // 1. Cargar catálogo completo (2,244 productos) y clientes
  useEffect(() => {
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
  }, []);

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

  // 4. Filtrado reactivo de clientes (Público General primero, luego Cartera Asignada, luego el resto)
  const filteredClients = useMemo(() => {
    const q = clientSearch.toLowerCase().trim();

    const sortedDbClients = [...clients].sort((a, b) => {
      const aMine = a.en_cartera ? 1 : 0;
      const bMine = b.en_cartera ? 1 : 0;
      if (aMine !== bMine) return bMine - aMine;
      return (a.nombre || '').localeCompare(b.nombre || '');
    });

    if (!q) {
      return [publicoGeneralClient, ...sortedDbClients];
    }
    const matching = sortedDbClients.filter(
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

  // 7. Confirmación del pedido en el ERP
  const handleConfirmSale = async () => {
    if (submitting) return;
    if (!selectedClient) {
      Alert.alert('Atención', 'Selecciona un cliente para levantar el pedido.');
      return;
    }
    if (cart.length === 0) {
      Alert.alert('Atención', 'Agrega al menos un producto al pedido.');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `idem_${user?.id || 'movil'}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const orderPayload: PedidoInput = {
        cliente_id: selectedClient.id === 'publico_general' ? '' : selectedClient.id,
        vendedor_id: user?.id,
        fecha_pedido: new Date().toISOString().slice(0, 10),
        notas: `[${condicion.toUpperCase()}${condicion === 'contado' ? ` - ${formaPago.toUpperCase()}` : ''}${aplicaIva ? ` - IVA ${tasaIva}%` : ' - SIN IVA'}] ${notas.trim()}`.trim(),
        items: cart.map((c) => ({
          product_id: c.product.id,
          codigo: c.product.sku || '',
          descripcion: c.product.descripcion || c.product.nombre || '',
          unidad: c.product.unidad_medida || 'PZA',
          solicitado: c.cantidad,
          precio: c.precio,
          iva_tasa: aplicaIva ? Number(tasaIva) : 0,
        })),
        idempotency_key: idempotencyKey,
      };

      const result = await createOrder(orderPayload);
      setConfirmedOrder(result);
      setTicketModalVisible(true);
    } catch (err: any) {
      Alert.alert('Error al registrar pedido', err.message || 'No se pudo registrar el pedido en el servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (val?: number) => {
    const num = Number(val || 0);
    return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

                return (
                  <View key={p.id} style={styles.productRow}>
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
              <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />
              <Text style={styles.confirmBtnText}>Confirmar Pedido ({formatCurrency(totals.total)})</Text>
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
            <TouchableOpacity onPress={() => setClientModalVisible(false)}>
              <MaterialIcons name="close" size={24} color="#718096" />
            </TouchableOpacity>
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
                    ) : item.en_cartera ? (
                      <View style={styles.badgeCartera}>
                        <Text style={styles.badgeCarteraText}>⭐ Cliente en cartera</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeGeneral}>
                        <Text style={styles.badgeGeneralText}>Directorio general</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.pickerClientInfo}>
                    {item.codigo ? `${item.codigo} • ` : ''}
                    {item.ciudad || item.colonia || 'Palenque'}
                    {item.en_cartera ? ` • Saldo: ${formatCurrency(item.saldo)}` : ' • Saldo confidencial'}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </SafeAreaView>
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
});
