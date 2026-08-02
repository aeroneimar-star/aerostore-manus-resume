import { type Href, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWebFocusVisible, webFocusVisibleStyle } from '@/accessibility/useWebFocusVisible';
import type { CatalogClient } from '@/catalog/CatalogClient';
import { toCatalogClientError } from '@/catalog/CatalogClientError';
import { catalogClient } from '@/catalog/client';
import type { B2cCatalogFilter, B2cCatalogItem, B2cCatalogPagination, CatalogQuery } from '@/catalog/contracts';
import { CategoryFilter } from '@/components/CategoryFilter';
import { EmptyCatalog, ErrorCatalog, LoadingCatalog } from '@/components/CatalogStates';
import { FilterChips } from '@/components/FilterChips';
import { ProductCard } from '@/components/ProductCard';
import { useAppTheme, theme } from '@/theme';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';
const PAGE_SIZE = 4;

export function CatalogScreen({ client = catalogClient }: { client?: CatalogClient }) {
  const router = useRouter(); const loadMoreFocus = useWebFocusVisible(); const profileFocus = useWebFocusVisible(); const { width } = useWindowDimensions();
  const { tokens } = useAppTheme();
  const [items, setItems] = useState<B2cCatalogItem[]>([]); const [categories, setCategories] = useState<B2cCatalogFilter[]>([]); const [pagination, setPagination] = useState<B2cCatalogPagination>();
  const [category, setCategory] = useState<string>(); const [sort, setSort] = useState<CatalogQuery['sort']>('recentes'); const [searchInput, setSearchInput] = useState(''); const [search, setSearch] = useState('');
  const [state, setState] = useState<LoadState>('loading'); const [loadingMore, setLoadingMore] = useState(false); const [refreshing, setRefreshing] = useState(false); const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { const timer = setTimeout(() => setSearch(searchInput.trim()), 350); return () => clearTimeout(timer); }, [searchInput]);
  useEffect(() => {
    let active = true; if (!refreshing) setState('loading');
    Promise.all([client.getCatalog({ page: 1, pageSize: PAGE_SIZE, category, search: search || undefined, sort }), client.getFilters()])
      .then(([catalog, filters]) => { if (!active) return; setItems(catalog.data.items); setPagination(catalog.data.pagination); setCategories(filters.data.categories); setState(catalog.data.items.length ? 'ready' : 'empty'); })
      .catch((error: unknown) => { if (!active) return; const normalized = toCatalogClientError(error); if (normalized.status === 401) router.replace('/?expired=1' as Href); else if (normalized.status === 403) router.replace('/access-status' as Href); else setState('error'); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [category, client, reloadKey, router, search, sort]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const refresh = useCallback(() => { setRefreshing(true); setReloadKey((value) => value + 1); }, []);
  const loadMore = useCallback(async () => {
    if (!pagination || pagination.page >= pagination.total_pages || loadingMore) return;
    setLoadingMore(true);
    try { const response = await client.getCatalog({ page: pagination.page + 1, pageSize: PAGE_SIZE, category, search: search || undefined, sort }); setItems((current) => [...current, ...response.data.items]); setPagination(response.data.pagination); }
    catch (error) { const normalized = toCatalogClientError(error); if (normalized.status === 401) router.replace('/?expired=1' as Href); else if (normalized.status === 403) router.replace('/access-status' as Href); else setState('error'); }
    finally { setLoadingMore(false); }
  }, [category, client, loadingMore, pagination, router, search, sort]);

  const contentWidth = Math.min(Math.max(width - 32, 0), theme.sizes.maxContent); const columns = contentWidth >= 760 ? 2 : 1; const cardWidth = Math.max((contentWidth - (columns - 1) * theme.spacing.md) / columns, 260);
  const sortOptions = useMemo(() => [{ label: 'Recentes', value: 'recentes' as const }, { label: 'Menor preço', value: 'preco_asc' as const }, { label: 'Maior preço', value: 'preco_desc' as const }, { label: 'A–Z', value: 'nome_asc' as const }], []);

  return <SafeAreaView style={[styles.safeArea, { backgroundColor: tokens.background }]} edges={['top']}><ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={tokens.accent} />} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <View style={[styles.content, { width: contentWidth }]}>
      <View style={styles.nav}><Text accessibilityRole="header" style={[styles.brand, { color: tokens.textPrimary }]}>AEROSTORE</Text><View style={styles.navActions}><Pressable accessibilityRole="button" accessibilityLabel="Abrir meu carrinho" onPress={() => router.push('/cart' as Href)} style={styles.navButton}><Text style={[styles.navButtonText, { color: tokens.textMuted }]}>CARRINHO</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Abrir meu perfil" onPress={() => router.push('/profile' as Href)} onFocus={profileFocus.onFocus} onBlur={profileFocus.onBlur} style={[styles.navButton, profileFocus.focusVisible && webFocusVisibleStyle]}><Text style={[styles.profileLink, { color: tokens.textMuted }]}>PERFIL</Text></Pressable></View></View>
      <View style={styles.hero}><View style={[styles.heroRule, { backgroundColor: tokens.accent }]} /><Text style={[styles.kicker, { color: tokens.textMuted }]}>CATÁLOGO PRIVADO · ACESSO EXCLUSIVO</Text><Text maxFontSizeMultiplier={1.35} style={[styles.heroTitle, { color: tokens.textPrimary }]}>Escolhas que{`\n`}ficam.</Text><Text maxFontSizeMultiplier={1.6} style={[styles.heroBody, { color: tokens.textSecondary }]}>A curadoria AEROSTORE agora no seu ritmo. Explore peças, variações e disponibilidade — sem ruído, sem pressa.</Text></View>
      <View style={[styles.filters, { borderBottomColor: tokens.divider, borderTopColor: tokens.divider }]}>
        <View><Text style={[styles.filterLabel, { color: tokens.textMuted }]}>BUSCAR</Text><TextInput accessibilityLabel="Buscar no catálogo" value={searchInput} onChangeText={setSearchInput} placeholder="Produto, marca ou código" placeholderTextColor={tokens.inputPlaceholder} autoCapitalize="none" returnKeyType="search" style={[styles.search, { backgroundColor: tokens.surface, borderColor: tokens.border, color: tokens.textPrimary }]} /></View>
        <View><Text style={[styles.filterLabel, { color: tokens.textMuted }]}>CATEGORIA</Text><CategoryFilter categories={categories} value={category} onChange={setCategory} /></View>
        <View><Text style={[styles.filterLabel, { color: tokens.textMuted }]}>ORDENAR</Text><FilterChips label="Ordenar catálogo" options={sortOptions} value={sort} onChange={setSort} /></View>
      </View>
      {state === 'loading' ? <LoadingCatalog /> : null}{state === 'empty' ? <EmptyCatalog /> : null}{state === 'error' ? <ErrorCatalog onRetry={retry} /> : null}
      {state === 'ready' ? <><View style={styles.collectionHeader}><Text accessibilityRole="header" style={[styles.collectionTitle, { color: tokens.textPrimary }]}>Coleção</Text><Text style={[styles.collectionCount, { color: tokens.textSecondary }]}>{pagination?.total ?? items.length} peças</Text></View><View style={styles.grid}>{items.map((item) => <ProductCard key={item.id} item={item} width={cardWidth} onPress={() => router.push(`/product/${item.id}` as Href)} />)}</View>
        {pagination && pagination.page < pagination.total_pages ? <Pressable accessibilityRole="button" accessibilityState={{ busy: loadingMore }} accessibilityLabel={loadingMore ? 'Carregando mais peças' : 'Carregar mais peças'} disabled={loadingMore} onBlur={loadMoreFocus.onBlur} onFocus={loadMoreFocus.onFocus} onPress={loadMore} style={({ pressed }) => [styles.loadMore, { borderColor: tokens.textPrimary }, pressed && { backgroundColor: tokens.surfaceElevated }, loadMoreFocus.focusVisible && webFocusVisibleStyle]}><Text style={[styles.loadMoreText, { color: tokens.textPrimary }]}>{loadingMore ? 'Carregando…' : 'Carregar mais'}</Text></Pressable> : null}
      </> : null}
      <View style={[styles.footer, { borderTopColor: tokens.divider }]}><Text style={[styles.footerMark, { color: tokens.accent }]}>A</Text><Text style={[styles.footerCopy, { color: tokens.textMuted }]}>Catálogo privado AEROSTORE.{`\n`}Compra disponível em breve.</Text></View>
    </View>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, scrollContent: { alignItems: 'center', paddingBottom: theme.spacing.xxl }, content: { maxWidth: theme.sizes.maxContent },
  nav: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 64 }, navActions: { flexDirection: 'row', gap: 12 }, brand: { fontFamily: theme.typography.body, fontSize: 16, fontWeight: '800', letterSpacing: 3.4 }, navButton: { paddingHorizontal: 12, paddingVertical: 8 }, navButtonText: { fontFamily: theme.typography.body, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }, profileLink: { fontFamily: theme.typography.body, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, paddingVertical: 12 },
  hero: { minHeight: 370, paddingBottom: theme.spacing.xxl, paddingTop: theme.spacing.hero }, heroRule: { height: 2, marginBottom: theme.spacing.lg, width: 64 }, kicker: { fontFamily: theme.typography.body, fontSize: 10, fontWeight: '700', letterSpacing: 2.2 }, heroTitle: { fontFamily: theme.typography.display, fontSize: 52, letterSpacing: -1.6, lineHeight: 57, marginTop: theme.spacing.md }, heroBody: { fontFamily: theme.typography.body, fontSize: 16, lineHeight: 26, marginTop: theme.spacing.lg, maxWidth: 520 },
  filters: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, gap: theme.spacing.lg, paddingVertical: theme.spacing.lg }, filterLabel: { fontFamily: theme.typography.body, fontSize: 9, fontWeight: '700', letterSpacing: 1.8, marginBottom: theme.spacing.sm }, search: { borderRadius: theme.radii.md, borderWidth: 1, fontFamily: theme.typography.body, fontSize: 15, minHeight: 52, paddingHorizontal: theme.spacing.md },
  collectionHeader: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: theme.spacing.lg, paddingTop: theme.spacing.xxl }, collectionTitle: { fontFamily: theme.typography.display, fontSize: 34 }, collectionCount: { fontFamily: theme.typography.body, fontSize: 12 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  loadMore: { alignItems: 'center', alignSelf: 'center', borderRadius: theme.radii.pill, borderWidth: 1, justifyContent: 'center', marginTop: theme.spacing.xl, minHeight: theme.sizes.touch, minWidth: 180, paddingHorizontal: theme.spacing.lg }, loadMorePressed: {}, loadMoreText: { fontFamily: theme.typography.body, fontSize: 13, fontWeight: '700' },
  footer: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.hero, paddingTop: theme.spacing.lg }, footerMark: { fontFamily: theme.typography.display, fontSize: 32 }, footerCopy: { fontFamily: theme.typography.body, fontSize: 11, lineHeight: 17 },
});
