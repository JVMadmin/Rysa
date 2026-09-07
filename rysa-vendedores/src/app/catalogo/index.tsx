import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectivityBar } from '@/components/ConnectivityBar';
import { getFullCatalog, searchProducts, getCategoriesList } from '@/services/salesService';
import { Product } from '@/types';
import {
  getCatalogCache,
  saveCatalogCache,
  getCategoriesCache,
  saveCategoriesCache,
  CacheMetadata,
} from '@/services/offlineCache';
import { syncManager } from '@/services/syncManager';

export default function CatalogoScreen() {
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<Product[]>([]);
  const [cachedAllProducts, setCachedAllProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('TODAS');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Categorías activas desde API / Caché con diferenciadores y conteos
  const [serverCategories, setServerCategories] = useState<{ categoria: string; count: number }[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoadingCategories(true);
    try {
      const data = await getCategoriesList();
      if (data && data.length > 0) {
        setServerCategories(data);
        await saveCategoriesCache(data);
      }
    } catch (err) {
      console.warn('[CatalogoScreen] Error fetching categories:', err);
      const cached = await getCategoriesCache();
      if (cached && cached.length > 0) {
        setServerCategories(cached);
      }
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  const fetchCatalog = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const data = await getFullCatalog();
      if (data && data.length > 0) {
        setProducts(data);
        setCachedAllProducts(data);
      }
    } catch (err) {
      console.warn('[CatalogoScreen] Error fetching catalog:', err);
      const cached = await getCatalogCache();
      if (cached.products.length > 0) {
        setProducts(cached.products);
        setCachedAllProducts(cached.products);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Cargar caché de inmediato al montar (0ms)
  useEffect(() => {
    getCatalogCache().then((cached) => {
      if (cached.products.length > 0) {
        setProducts(cached.products);
        setCachedAllProducts(cached.products);
        setLoading(false);
      }
      fetchCatalog(cached.products.length > 0);
    });

    getCategoriesCache().then((cachedCats) => {
      if (cachedCats && cachedCats.length > 0) {
        setServerCategories(cachedCats);
      }
      fetchCategories();
    });

    const unsubReconnect = syncManager.subscribeReconnect(() => {
      console.log('[CatalogoScreen] Network reconnected - refreshing full catalog & categories...');
      fetchCatalog(true);
      fetchCategories();
    });

    const unsubStatus = syncManager.subscribeStatus((st) => {
      setIsOffline(!st.isOnline);
    });

    return () => {
      unsubReconnect();
      unsubStatus();
    };
  }, [fetchCatalog, fetchCategories]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCatalog();
    fetchCategories();
  };

  // Categorías con conteo exacto y diferenciadores visuales
  const categories = useMemo(() => {
    const source = cachedAllProducts.length > 0 ? cachedAllProducts : products;
    const countMap = new Map<string, number>();

    source.forEach((p) => {
      const cat = (p.categoria || p.linea || '').trim().toUpperCase();
      if (cat) {
        countMap.set(cat, (countMap.get(cat) || 0) + 1);
      }
    });

    const result: { name: string; count: number }[] = [
      { name: 'TODAS', count: source.length },
    ];

    if (serverCategories.length > 0) {
      serverCategories.forEach((sc) => {
        const catUpper = sc.categoria.trim().toUpperCase();
        const cnt = countMap.get(catUpper) || sc.count || 0;
        result.push({ name: catUpper, count: cnt });
      });
    } else {
      Array.from(countMap.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, count]) => {
          result.push({ name, count });
        });
    }

    return result;
  }, [cachedAllProducts, products, serverCategories]);

  // Filtrado reactivo en tiempo real al escribir (0ms lag sobre los 2,244 productos)
  const filteredProducts = useMemo(() => {
    const source = cachedAllProducts.length > 0 ? cachedAllProducts : products;
    let list = source;
    if (selectedCategory !== 'TODAS') {
      list = list.filter((p) => {
        const cat = (p.categoria || p.linea || '').trim().toUpperCase();
        return cat === selectedCategory;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (p) =>
          (p.descripcion || p.nombre || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.categoria || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [cachedAllProducts, products, search, selectedCategory]);

  const formatCurrency = (val?: number) => {
    const num = Number(val || 0);
    return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const handleAddToCart = (product: Product) => {
    // Redirigir a Nueva Venta con el producto
    router.push('/pedidos' as any);
  };

  const renderProductItem = ({ item }: { item: Product }) => {
    const hasStock = (item.existencia || 0) > 0;
    const precioLista = item.precio1 || item.precio || 0;
    const precioMayoreo = item.precio2 || null;

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => setSelectedProduct(item)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            <View style={styles.skuBadge}>
              <Text style={styles.skuText}>{item.sku || 'SIN SKU'}</Text>
            </View>
            {item.categoria ? (
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryText} numberOfLines={1}>
                  {item.categoria}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={[styles.stockBadge, hasStock ? styles.stockIn : styles.stockOut]}>
            <MaterialIcons
              name={hasStock ? 'check-circle' : 'cancel'}
              size={12}
              color={hasStock ? '#2E7D32' : '#C62828'}
            />
            <Text style={[styles.stockText, hasStock ? styles.stockTextIn : styles.stockTextOut]}>
              {hasStock ? `${item.existencia} ${item.unidad_medida || 'PZA'}` : 'Sin stock'}
            </Text>
          </View>
        </View>

        {/* Cuerpo del Producto */}
        <View style={styles.cardBody}>
          <View style={styles.productIconContainer}>
            {item.foto ? (
              <Image source={{ uri: item.foto }} style={styles.productImage} resizeMode="contain" />
            ) : (
              <MaterialIcons name="inventory-2" size={36} color="#A0AEC0" />
            )}
          </View>
          <View style={styles.productInfo}>
            <Text style={styles.productTitle} numberOfLines={2}>
              {item.descripcion}
            </Text>
            {item.linea ? (
              <Text style={styles.productLine} numberOfLines={1}>
                Línea: {item.linea}
              </Text>
            ) : null}

            {/* Precios: Lista y Mayoreo */}
            <View style={styles.priceRow}>
              <View style={styles.priceCol}>
                <Text style={styles.priceLabel}>Base neto:</Text>
                <Text style={styles.priceMain}>{formatCurrency(precioLista)}</Text>
                <Text style={{ fontSize: 10, color: '#718096' }}>+ IVA 8%: {formatCurrency(Math.round(precioLista * 1.08 * 100) / 100)}</Text>
              </View>
              {precioMayoreo && precioMayoreo !== precioLista ? (
                <View style={styles.priceCol}>
                  <Text style={styles.priceLabel}>Mayoreo:</Text>
                  <Text style={styles.priceWholesale}>{formatCurrency(precioMayoreo)}</Text>
                  <Text style={{ fontSize: 10, color: '#718096' }}>+ IVA 8%: {formatCurrency(Math.round(precioMayoreo * 1.08 * 100) / 100)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Footer / Acciones */}
        <View style={styles.cardFooter}>
          <Text style={styles.unitText}>
            Unidad: <Text style={{ fontWeight: '700', color: '#2D3748' }}>{item.unidad_medida || 'PZA'}</Text>
          </Text>
          <TouchableOpacity
            style={[styles.addOrderBtn, !hasStock && styles.addOrderBtnDisabled]}
            onPress={() => handleAddToCart(item)}
            activeOpacity={0.8}
            disabled={!hasStock}
          >
            <MaterialIcons name="add-shopping-cart" size={16} color="#FFFFFF" />
            <Text style={styles.addOrderBtnText}>Vender</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ConnectivityBar onManualSync={onRefresh} />

      {/* Header Institucional de Catálogo */}
      <View style={styles.searchHeader}>
        <View style={styles.titleRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialIcons name="menu-book" size={24} color="#FFFFFF" />
            <Text style={styles.titleText}>Catálogo Institucional</Text>
          </View>
          <Text style={styles.totalBadge}>{filteredProducts.length} arts.</Text>
        </View>

        {/* Banner Offline */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={14} color="#FFB300" />
            <Text style={styles.offlineBannerText}>
              Modo Sin Conexión • Catálogo en caché ({cachedAllProducts.length || filteredProducts.length} productos)
            </Text>
          </View>
        )}

        {/* Input de Búsqueda */}
        <View style={styles.searchInputContainer}>
          <MaterialIcons name="search" size={20} color="#718096" style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por SKU, descripción o línea..."
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

        {/* Chips de Categorías con Conteo y Botón de Recarga */}
        <View style={{ marginTop: 10 }}>
          <View style={styles.categoriesHeaderRow}>
            <Text style={styles.categoriesSectionLabel}>Líneas y Categorías ({categories.length - 1})</Text>
            <TouchableOpacity
              style={styles.reloadCategoriesBtn}
              onPress={fetchCategories}
              disabled={loadingCategories}
              activeOpacity={0.7}
            >
              {loadingCategories ? (
                <ActivityIndicator size="small" color="#B9F6CA" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MaterialIcons name="refresh" size={14} color="#B9F6CA" />
                  <Text style={styles.reloadCategoriesText}>Cargar Categorías</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {categories.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoriesScroll}
            >
              {categories.map((cat) => {
                const active = selectedCategory === cat.name;
                return (
                  <TouchableOpacity
                    key={cat.name}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                    onPress={() => setSelectedCategory(cat.name)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                      {cat.name}
                    </Text>
                    <View style={[styles.catCountBadge, active && styles.catCountBadgeActive]}>
                      <Text style={[styles.catCountBadgeText, active && styles.catCountBadgeTextActive]}>
                        {cat.count}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>

      {/* Lista de Productos */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#D32F2F" />
          <Text style={styles.loadingText}>Cargando catálogo...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id}
          renderItem={renderProductItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 60 },
          ]}
          initialNumToRender={12}
          maxToRenderPerBatch={16}
          windowSize={7}
          removeClippedSubviews={true}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#D32F2F']} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="search-off" size={48} color="#CBD5E0" />
              <Text style={styles.emptyTitle}>Sin coincidencias</Text>
              <Text style={styles.emptyDesc}>
                No se encontraron artículos con el criterio ingresado.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  searchHeader: {
    backgroundColor: '#121820',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  titleText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  totalBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B9F6CA',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#1A202C',
  },
  categoriesHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  categoriesSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A0AEC0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reloadCategoriesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(185, 246, 202, 0.3)',
  },
  reloadCategoriesText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B9F6CA',
  },
  categoriesScroll: {
    paddingTop: 4,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 6,
  },
  categoryChipActive: {
    backgroundColor: '#D32F2F',
    borderColor: '#D32F2F',
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#CBD5E0',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },
  catCountBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catCountBadgeActive: {
    backgroundColor: '#FFFFFF',
  },
  catCountBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#CBD5E0',
  },
  catCountBadgeTextActive: {
    color: '#D32F2F',
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
  listContent: {
    padding: 14,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  skuBadge: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  skuText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2D3748',
  },
  categoryBadge: {
    backgroundColor: '#FFF5F5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 140,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#C53030',
  },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  stockIn: {
    backgroundColor: '#E8F5E9',
  },
  stockOut: {
    backgroundColor: '#FFEBEE',
  },
  stockText: {
    fontSize: 10,
    fontWeight: '700',
  },
  stockTextIn: {
    color: '#2E7D32',
  },
  stockTextOut: {
    color: '#C62828',
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  productIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F7FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  productImage: {
    width: 56,
    height: 56,
    borderRadius: 6,
  },
  productInfo: {
    flex: 1,
  },
  productTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A202C',
    lineHeight: 18,
  },
  productLine: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  priceCol: {},
  priceLabel: {
    fontSize: 9,
    color: '#718096',
    fontWeight: '600',
  },
  priceMain: {
    fontSize: 15,
    fontWeight: '800',
    color: '#D32F2F',
  },
  priceWholesale: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2E7D32',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  unitText: {
    fontSize: 11,
    color: '#718096',
  },
  addOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D32F2F',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  addOrderBtnDisabled: {
    backgroundColor: '#CBD5E0',
  },
  addOrderBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#2D3748',
    marginTop: 10,
  },
  emptyDesc: {
    fontSize: 12,
    color: '#718096',
    marginTop: 4,
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
});
