import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CatalogClient } from '@/catalog/CatalogClient';
import { toCatalogClientError } from '@/catalog/CatalogClientError';
import { catalogClient } from '@/catalog/client';
import type {
  B2cCatalogFilter,
  B2cCatalogItem,
  B2cCatalogPagination,
} from '@/catalog/contracts';
import { FilterChips } from '@/components/FilterChips';
import { ProductCard } from '@/components/ProductCard';
import { ScreenState } from '@/components/ScreenState';
import { theme } from '@/theme';

type FeaturedFilter = boolean | undefined;
type LoadState = 'loading' | 'ready' | 'empty' | 'error' | 'disabled';

interface CatalogScreenProps {
  client?: CatalogClient;
}

export function CatalogScreen({ client = catalogClient }: CatalogScreenProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<B2cCatalogItem[]>([]);
  const [categories, setCategories] = useState<B2cCatalogFilter[]>([]);
  const [pagination, setPagination] = useState<B2cCatalogPagination>();
  const [category, setCategory] = useState<string | undefined>();
  const [featured, setFeatured] = useState<FeaturedFilter>();
  const [state, setState] = useState<LoadState>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState('loading');
    Promise.all([
      client.getCatalog({ page: 1, limit: 4, category, featured }),
      client.getFilters(),
    ])
      .then(([catalog, filters]) => {
        if (!active) return;
        setItems(catalog.data.items);
        setPagination(catalog.data.pagination);
        setCategories(filters.data.categories);
        setState(catalog.data.items.length ? 'ready' : 'empty');
      })
      .catch((error: unknown) => {
        if (!active) return;
        const normalized = toCatalogClientError(error);
        setState(normalized.code === 'CATALOG_DISABLED' ? 'disabled' : 'error');
      });
    return () => {
      active = false;
    };
  }, [category, client, featured, reloadKey]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);

  const loadMore = useCallback(async () => {
    if (!pagination || pagination.page >= pagination.total_pages || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await client.getCatalog({
        page: pagination.page + 1,
        limit: pagination.limit,
        category,
        featured,
      });
      setItems((current) => [...current, ...response.data.items]);
      setPagination(response.data.pagination);
    } catch {
      setState('error');
    } finally {
      setLoadingMore(false);
    }
  }, [category, client, featured, loadingMore, pagination]);

  const contentWidth = Math.min(Math.max(width - 32, 0), theme.sizes.maxContent);
  const columns = contentWidth >= 760 ? 2 : 1;
  const cardWidth = Math.max((contentWidth - (columns - 1) * theme.spacing.md) / columns, 260);

  const categoryOptions = useMemo(
    () => [
      { label: 'Todos', value: undefined },
      ...categories.map((item) => ({
        label: item.label,
        value: item.slug,
        count: item.count,
      })),
    ],
    [categories],
  );

  const featuredOptions = [
    { label: 'Todos', value: undefined },
    { label: 'Destaques', value: true },
    { label: 'Não destacados', value: false },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.content, { width: contentWidth }]}>
          <View style={styles.nav}>
            <Text accessibilityRole="header" style={styles.brand}>
              AEROSTORE
            </Text>
            <Text style={styles.edition}>APP / 01</Text>
          </View>

          <View style={styles.hero}>
            <View style={styles.heroRule} />
            <Text style={styles.kicker}>CURADORIA MASCULINA • 2026</Text>
            <Text maxFontSizeMultiplier={1.35} style={styles.heroTitle}>
              Essenciais com{'\n'}presença.
            </Text>
            <Text maxFontSizeMultiplier={1.6} style={styles.heroBody}>
              Uma seleção precisa para vestir o ritmo da cidade — menos ruído,
              mais intenção.
            </Text>
          </View>

          <View style={styles.filters}>
            <View>
              <Text style={styles.filterLabel}>COLEÇÃO</Text>
              <FilterChips
                label="Filtrar por categoria"
                options={categoryOptions}
                value={category}
                onChange={setCategory}
              />
            </View>
            <View>
              <Text style={styles.filterLabel}>CURADORIA</Text>
              <FilterChips
                label="Filtrar por destaque"
                options={featuredOptions}
                value={featured}
                onChange={setFeatured}
              />
            </View>
          </View>

          {state === 'loading' ? <ScreenState kind="loading" /> : null}
          {state === 'empty' ? <ScreenState kind="empty" /> : null}
          {state === 'disabled' ? <ScreenState kind="disabled" /> : null}
          {state === 'error' ? <ScreenState kind="error" onRetry={retry} /> : null}

          {state === 'ready' ? (
            <>
              <View style={styles.collectionHeader}>
                <Text accessibilityRole="header" style={styles.collectionTitle}>
                  Coleção
                </Text>
                <Text style={styles.collectionCount}>
                  {pagination?.total ?? items.length} peças
                </Text>
              </View>
              <View style={styles.grid}>
                {items.map((item) => (
                  <ProductCard
                    key={item.slug}
                    item={item}
                    width={cardWidth}
                    onPress={() => router.push(`/product/${item.slug}`)}
                  />
                ))}
              </View>
              {pagination && pagination.page < pagination.total_pages ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: loadingMore }}
                  accessibilityLabel={loadingMore ? 'Carregando mais peças' : 'Carregar mais peças'}
                  disabled={loadingMore}
                  onPress={loadMore}
                  style={({ pressed }) => [
                    styles.loadMore,
                    pressed && styles.loadMorePressed,
                  ]}>
                  <Text style={styles.loadMoreText}>
                    {loadingMore ? 'Carregando…' : 'Carregar mais'}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          <View style={styles.footer}>
            <Text style={styles.footerMark}>A</Text>
            <Text style={styles.footerCopy}>
              Fundação local do aplicativo.{'\n'}Compras ainda não disponíveis.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: theme.colors.ink,
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: theme.spacing.xxl,
  },
  content: {
    maxWidth: theme.sizes.maxContent,
  },
  nav: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
  },
  brand: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.body,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 3.4,
  },
  edition: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 10,
    letterSpacing: 1.5,
  },
  hero: {
    minHeight: 390,
    paddingBottom: theme.spacing.xxl,
    paddingTop: theme.spacing.hero,
  },
  heroRule: {
    backgroundColor: theme.colors.copper,
    height: 2,
    marginBottom: theme.spacing.lg,
    width: 64,
  },
  kicker: {
    color: theme.colors.copperSoft,
    fontFamily: theme.typography.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.4,
  },
  heroTitle: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.display,
    fontSize: 52,
    letterSpacing: -1.6,
    lineHeight: 57,
    marginTop: theme.spacing.md,
  },
  heroBody: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 26,
    marginTop: theme.spacing.lg,
    maxWidth: 480,
  },
  filters: {
    borderBottomColor: '#34332F',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#34332F',
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
  filterLabel: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginBottom: theme.spacing.sm,
  },
  collectionHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: theme.spacing.lg,
    paddingTop: theme.spacing.xxl,
  },
  collectionTitle: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.display,
    fontSize: 34,
  },
  collectionCount: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  loadMore: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: theme.colors.ivory,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: theme.spacing.xl,
    minHeight: theme.sizes.touch,
    minWidth: 180,
    paddingHorizontal: theme.spacing.lg,
  },
  loadMorePressed: {
    backgroundColor: '#272621',
  },
  loadMoreText: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    alignItems: 'center',
    borderTopColor: '#34332F',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: theme.spacing.hero,
    paddingTop: theme.spacing.lg,
  },
  footerMark: {
    color: theme.colors.copper,
    fontFamily: theme.typography.display,
    fontSize: 32,
  },
  footerCopy: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 11,
    lineHeight: 17,
  },
});
