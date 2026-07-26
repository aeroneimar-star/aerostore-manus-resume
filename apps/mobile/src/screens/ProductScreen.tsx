import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { theme } from '@/theme';

type ProductState = 'loading' | 'ready' | 'error' | 'disabled' | 'not_found';

const availabilityCopy: Record<B2cAvailability, string> = {
  in_stock: 'Disponível na coleção',
  low_stock: 'Últimas disponibilidades',
  out_of_stock: 'Indisponível no momento',
};

interface ProductScreenProps {
  client?: CatalogClient;
  slugOverride?: string;
}

export function ProductScreen({
  client = catalogClient,
  slugOverride,
}: ProductScreenProps) {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slugParam = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const slug = slugOverride ?? slugParam ?? '';
  const { width } = useWindowDimensions();
  const [product, setProduct] = useState<B2cProduct>();
  const [state, setState] = useState<ProductState>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState('loading');
    client.getProductBySlug(slug)
      .then((response) => {
        if (!active) return;
        setProduct(response.data.product);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        const normalized = toCatalogClientError(error);
        if (normalized.code === 'PRODUCT_NOT_FOUND') setState('not_found');
        else if (normalized.code === 'CATALOG_DISABLED') setState('disabled');
        else setState('error');
      });
    return () => {
      active = false;
    };
  }, [client, reloadKey, slug]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const imageWidth = Math.min(Math.max(width - 48, 280), 620);
  const colors = useMemo(
    () => uniqueVariantValue(product?.variants, 'color'),
    [product],
  );
  const sizes = useMemo(
    () => uniqueVariantValue(product?.variants, 'size'),
    [product],
  );

  if (state === 'loading') return <ScreenState kind="loading" />;
  if (state === 'disabled') return <ScreenState kind="disabled" />;
  if (state === 'not_found') return <ScreenState kind="not_found" />;
  if (state === 'error') return <ScreenState kind="error" onRetry={retry} />;
  if (!product) return <ScreenState kind="not_found" />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.maxContent}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={`Galeria de ${product.title}`}
          contentContainerStyle={styles.gallery}>
          {product.images.map((item) => (
            <Image
              key={`${item.url}-${item.sort_order ?? 0}`}
              accessible
              accessibilityLabel={item.alt ?? product.title}
              source={{ uri: item.url }}
              contentFit="cover"
              transition={240}
              style={[styles.image, { width: imageWidth }]}
            />
          ))}
        </ScrollView>

        <View style={styles.details}>
          <Text style={styles.category}>
            {product.category_label ?? 'Coleção AEROSTORE'}
          </Text>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={styles.title}>
            {product.title}
          </Text>
          <Text maxFontSizeMultiplier={1.6} style={styles.shortDescription}>
            {product.short_description}
          </Text>
          <Price
            large
            priceCents={product.price_cents}
            compareAtPriceCents={product.compare_at_price_cents}
          />
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                product.availability === 'out_of_stock' && styles.statusDotMuted,
              ]}
            />
            <Text style={styles.statusText}>
              {availabilityCopy[product.availability]}
            </Text>
          </View>

          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>SOBRE A PEÇA</Text>
          <Text maxFontSizeMultiplier={1.7} style={styles.description}>
            {product.description}
          </Text>

          <VariantValues title="Cores" values={colors} />
          <VariantValues title="Tamanhos" values={sizes} />

          <Text style={styles.sectionLabel}>VARIAÇÕES</Text>
          <View style={styles.variantList}>
            {product.variants.map((variant) => (
              <VariantRow key={variant.slug} variant={variant} />
            ))}
          </View>

          <View
            accessible
            accessibilityRole="summary"
            style={styles.prototypeNotice}>
            <Text style={styles.prototypeTitle}>
              Indisponível para compra nesta versão
            </Text>
            <Text style={styles.prototypeBody}>
              Esta etapa apresenta somente o catálogo editorial. Nenhuma seleção
              reserva produto ou inicia pedido.
            </Text>
          </View>
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

function VariantValues({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <View style={styles.variantGroup}>
      <Text style={styles.sectionLabel}>{title.toUpperCase()}</Text>
      <View style={styles.chipRow}>
        {values.map((value) => (
          <View key={value} accessible accessibilityLabel={`${title}: ${value}`} style={styles.chip}>
            <Text style={styles.chipText}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function VariantRow({ variant }: { variant: B2cProductVariant }) {
  const label = [variant.color, variant.size].filter(Boolean).join(' • ');
  return (
    <View style={styles.variantRow}>
      <Text style={styles.variantName}>{label || 'Variação'}</Text>
      <Text style={styles.variantStatus}>
        {availabilityCopy[variant.availability]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.ink,
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
    backgroundColor: '#24231F',
    borderRadius: theme.radii.lg,
  },
  details: {
    maxWidth: 680,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  category: {
    color: theme.colors.copperSoft,
    fontFamily: theme.typography.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.display,
    fontSize: 42,
    letterSpacing: -1,
    lineHeight: 48,
    marginTop: theme.spacing.sm,
  },
  shortDescription: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 17,
    lineHeight: 26,
    marginBottom: theme.spacing.lg,
    marginTop: theme.spacing.sm,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  statusDot: {
    backgroundColor: theme.colors.moss,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusDotMuted: {
    backgroundColor: theme.colors.stone,
  },
  statusText: {
    color: theme.colors.paper,
    fontFamily: theme.typography.body,
    fontSize: 13,
  },
  divider: {
    backgroundColor: '#34332F',
    height: StyleSheet.hairlineWidth,
    marginVertical: theme.spacing.xl,
  },
  sectionLabel: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginBottom: theme.spacing.sm,
  },
  description: {
    color: theme.colors.paper,
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
    borderColor: '#474640',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.sizes.touch,
    paddingHorizontal: theme.spacing.md,
  },
  chipText: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '600',
  },
  variantList: {
    borderTopColor: '#34332F',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginBottom: theme.spacing.xl,
  },
  variantRow: {
    borderBottomColor: '#34332F',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
  },
  variantName: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.body,
    fontSize: 14,
    fontWeight: '700',
  },
  variantStatus: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 12,
  },
  prototypeNotice: {
    backgroundColor: theme.colors.paper,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.lg,
  },
  prototypeTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.display,
    fontSize: 22,
  },
  prototypeBody: {
    color: '#56534D',
    fontFamily: theme.typography.body,
    fontSize: 13,
    lineHeight: 20,
    marginTop: theme.spacing.xs,
  },
});
