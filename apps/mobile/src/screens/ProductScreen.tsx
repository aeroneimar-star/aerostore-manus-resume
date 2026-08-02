import { Image } from 'expo-image';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import type { CatalogClient } from '@/catalog/CatalogClient';
import { toCatalogClientError } from '@/catalog/CatalogClientError';
import { catalogClient } from '@/catalog/client';
import type {
  B2cAvailability,
  B2cProduct,
  B2cProductVariant,
} from '@/catalog/contracts';
import { Price } from '@/components/Price';
import { ScreenState } from '@/components/ScreenState';
import { useAppTheme, theme } from '@/theme';
import { createCartClient } from '@/cart/client';

type ProductState = 'loading' | 'ready' | 'error' | 'disabled' | 'not_found';

const availabilityCopy: Record<B2cAvailability, string> = {
  in_stock: 'Disponível na coleção',
  low_stock: 'Últimas disponibilidades',
  out_of_stock: 'Indisponível no momento',
};

interface ProductScreenProps {
  client?: CatalogClient;
  productIdOverride?: string;
}

export function ProductScreen({
  client = catalogClient,
  productIdOverride,
}: ProductScreenProps) {
  const router = useRouter();
  const cartClient = createCartClient();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slugParam = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const productId = productIdOverride ?? slugParam ?? '';
  const { width } = useWindowDimensions();
  const { tokens } = useAppTheme();
  const [product, setProduct] = useState<B2cProduct>();
  const [state, setState] = useState<ProductState>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [addingToCart, setAddingToCart] = useState(false);

  const handleAddToCart = useCallback(async () => {
    if (!product) return;
    setAddingToCart(true);
    try {
      const variant = product.variants[0];
      await cartClient.addItem({
        product_id: product.id,
        variant_id: variant?.slug,
        quantity: 1,
      });
      router.push('/cart' as Href);
    } catch {
      // Silently fail — user can retry
    } finally {
      setAddingToCart(false);
    }
  }, [product, router]);

  useEffect(() => {
    let active = true;
    setState('loading');
    client.getProduct(productId)
      .then((response) => {
        if (!active) return;
        setProduct(response.data.product);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        const normalized = toCatalogClientError(error);
        if (normalized.status === 401) router.replace('/?expired=1' as Href);
        else if (normalized.status === 403) router.replace('/access-status' as Href);
        else if (normalized.code === 'PRODUCT_NOT_FOUND') setState('not_found');
        else if (normalized.code === 'CATALOG_DISABLED') setState('disabled');
        else setState('error');
      });
    return () => {
      active = false;
    };
  }, [client, productId, reloadKey, router]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const imageWidth = Math.min(Math.max(width - 48, 280), 620);
  const colors = useMemo(
    () => product?.colors ?? uniqueVariantValue(product?.variants, 'color'),
    [product],
  );
  const sizes = useMemo(
    () => product?.sizes ?? uniqueVariantValue(product?.variants, 'size'),
    [product],
  );

  if (state === 'loading') return <ScreenState kind="loading" />;
  if (state === 'disabled') return <ScreenState kind="disabled" />;
  if (state === 'not_found') return <ScreenState kind="not_found" />;
  if (state === 'error') return <ScreenState kind="error" onRetry={retry} />;
  if (!product) return <ScreenState kind="not_found" />;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: tokens.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.maxContent}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={`Galeria de ${product.title}`}
          contentContainerStyle={styles.gallery}>
          {product.images.length > 0 ? (
            product.images.map((item) => (
              <Image
                key={`${item.url}-${item.sort_order ?? 0}`}
                accessible
                accessibilityLabel={item.alt ?? product.title}
                source={{ uri: item.url }}
                contentFit="cover"
                placeholder={{ blurhash: 'L16R;f%M00xu~qM{Rjof00of~qay' }}
                transition={240}
                style={[styles.image, { width: imageWidth, backgroundColor: tokens.skeleton }]}
              />
            ))
          ) : (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel="Imagem do produto indisponível"
              style={[styles.image, styles.imagePlaceholder, { width: imageWidth, borderColor: tokens.border }]}>
              <Text
                maxFontSizeMultiplier={1.6}
                style={[styles.imagePlaceholderText, { color: tokens.textSecondary }]}>
                Imagem indisponível
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.details}>
          <Text style={[styles.category, { color: tokens.textMuted }]}>
            {product.brand} · {product.category_label ?? 'Coleção AEROSTORE'}
          </Text>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={[styles.title, { color: tokens.textPrimary }]}>
            {product.title}
          </Text>
          <Text maxFontSizeMultiplier={1.6} style={[styles.shortDescription, { color: tokens.textSecondary }]}>
            {product.short_description}
          </Text>
          <Text style={[styles.sku, { color: tokens.textMuted }]}>CÓDIGO {product.sku}</Text>
          <Price
            large
            priceCents={product.price_cents}
            compareAtPriceCents={product.compare_at_price_cents}
          />
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: product.availability === 'out_of_stock' ? tokens.textMuted : tokens.success },
              ]}
            />
            <Text style={[styles.statusText, { color: tokens.textSecondary }]}>
              {availabilityCopy[product.availability]}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: tokens.divider }]} />
          <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>SOBRE A PEÇA</Text>
          <Text maxFontSizeMultiplier={1.7} style={[styles.description, { color: tokens.textSecondary }]}>
            {product.description}
          </Text>

          <VariantValues title="Cores" values={colors} tokens={tokens} />
          <VariantValues title="Tamanhos" values={sizes} tokens={tokens} />

          <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>VARIAÇÕES</Text>
          <View style={[styles.variantList, { borderTopColor: tokens.divider }]}>
            {product.variants.map((variant) => (
              <VariantRow key={variant.slug} variant={variant} tokens={tokens} />
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adicionar ao carrinho"
            onPress={handleAddToCart}
            disabled={product.availability === 'out_of_stock' || addingToCart}
            style={[styles.addToCartButton, { backgroundColor: tokens.accent }, (product.availability === 'out_of_stock' || addingToCart) && { opacity: 0.5, backgroundColor: tokens.surfaceMuted }]}
            testID="add-to-cart">
            <Text style={[styles.addToCartText, { color: tokens.textInverse }]}>
              {addingToCart ? 'Adicionando...' : product.availability === 'out_of_stock' ? 'Indisponível' : 'Adicionar ao carrinho'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/cart' as Href)}
            style={[styles.viewCartButton, { borderColor: tokens.accent }]}
            testID="view-cart">
            <Text style={[styles.viewCartText, { color: tokens.accent }]}>Ver carrinho</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function uniqueVariantValue(
  variants: B2cProductVariant[] | undefined,
  key: 'color' | 'size',
) {
  return [...new Set((variants ?? []).flatMap((variant) => variant[key] ? [variant[key] as string] : []))];
}

function VariantValues({ title, values, tokens }: { title: string; values: string[]; tokens: import('@/theme').ThemeTokens }) {
  if (!values.length) return null;
  return (
    <View style={styles.variantGroup}>
      <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>{title.toUpperCase()}</Text>
      <View style={styles.chipRow}>
        {values.map((value) => (
          <View key={value} accessible accessibilityLabel={`${title}: ${value}`} style={[styles.chip, { borderColor: tokens.border }]}>
            <Text style={[styles.chipText, { color: tokens.textPrimary }]}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function VariantRow({ variant, tokens }: { variant: B2cProductVariant; tokens: import('@/theme').ThemeTokens }) {
  const label = [variant.color, variant.size].filter(Boolean).join(' • ');
  return (
    <View style={[styles.variantRow, { borderBottomColor: tokens.divider }]}>
      <Text style={[styles.variantName, { color: tokens.textPrimary }]}>{label || 'Variação'}</Text>
      <Text style={[styles.variantStatus, { color: tokens.textMuted }]}>
        {availabilityCopy[variant.availability]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    paddingBottom: theme.spacing.hero,
  },
  maxContent: {
    maxWidth: theme.sizes.maxContent,
    width: '100%',
  },
  gallery: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  image: {
    aspectRatio: 0.82,
    borderRadius: theme.radii.lg,
  },
  imagePlaceholder: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  imagePlaceholderText: {
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  details: {
    maxWidth: 680,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  category: {
    fontFamily: theme.typography.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: theme.typography.display,
    fontSize: 42,
    letterSpacing: -1,
    lineHeight: 48,
    marginTop: theme.spacing.sm,
  },
  shortDescription: {
    fontFamily: theme.typography.body,
    fontSize: 17,
    lineHeight: 26,
    marginBottom: theme.spacing.lg,
    marginTop: theme.spacing.sm,
  },
  sku: {
    fontFamily: theme.typography.body,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: theme.spacing.sm,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  statusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusDotMuted: {
  },
  statusText: {
    fontFamily: theme.typography.body,
    fontSize: 13,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: theme.spacing.xl,
  },
  sectionLabel: {
    fontFamily: theme.typography.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginBottom: theme.spacing.sm,
  },
  description: {
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 27,
  },
  variantGroup: {
    marginTop: theme.spacing.xl,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  chip: {
    alignItems: 'center',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.sizes.touch,
    paddingHorizontal: theme.spacing.md,
  },
  chipText: {
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '600',
  },
  variantList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginBottom: theme.spacing.xl,
  },
  variantRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
  },
  variantName: {
    fontFamily: theme.typography.body,
    fontSize: 14,
    fontWeight: '700',
  },
  variantStatus: {
    fontFamily: theme.typography.body,
    fontSize: 12,
  },
  addToCartButton: {
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: theme.spacing.lg,
  },
  addToCartDisabled: {
    opacity: 0.5,
  },
  addToCartText: {
    fontFamily: theme.typography.body,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  viewCartButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  viewCartText: {
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
