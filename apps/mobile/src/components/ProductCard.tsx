import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  useWebFocusVisible,
  webFocusVisibleStyle,
} from '@/accessibility/useWebFocusVisible';
import type { B2cCatalogItem } from '@/catalog/contracts';
import { theme } from '@/theme';

import { Price } from './Price';

interface ProductCardProps {
  item: B2cCatalogItem;
  width: number;
  onPress: () => void;
}

export function ProductCard({ item, width, onPress }: ProductCardProps) {
  const focus = useWebFocusVisible();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver produto ${item.title}`}
      accessibilityHint="Abre os detalhes editoriais do produto"
      onBlur={focus.onBlur}
      onFocus={focus.onFocus}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { width },
        pressed && styles.cardPressed,
        focus.focusVisible && webFocusVisibleStyle,
      ]}>
      <View style={styles.imageFrame}>
        {item.primary_image ? (
          <Image
            accessible
            accessibilityLabel={item.primary_image.alt ?? item.title}
            source={{ uri: item.primary_image.url }}
            contentFit="cover"
            transition={240}
            style={styles.image}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>A</Text>
          </View>
        )}
        {item.badge_label ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.badge_label}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={1.5} style={styles.category}>
          {item.category_label ?? 'Coleção'}
        </Text>
        <Text maxFontSizeMultiplier={1.45} style={styles.title}>
          {item.title}
        </Text>
        <Text maxFontSizeMultiplier={1.5} style={styles.description} numberOfLines={2}>
          {item.short_description}
        </Text>
        <Price
          priceCents={item.price_cents}
          compareAtPriceCents={item.compare_at_price_cents}
        />
        <View style={styles.footer}>
          <Text maxFontSizeMultiplier={1.5} style={styles.status}>
            {item.status_copy}
          </Text>
          <Text style={styles.arrow} accessibilityElementsHidden>
            ↗
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.inkRaised,
    borderRadius: theme.radii.lg,
    overflow: 'hidden',
    ...theme.shadows.card,
  },
  cardPressed: {
    opacity: 0.86,
    transform: [{ translateY: 2 }],
  },
  imageFrame: {
    aspectRatio: 0.82,
    backgroundColor: '#24231F',
    position: 'relative',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  placeholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  placeholderText: {
    color: theme.colors.copper,
    fontFamily: theme.typography.display,
    fontSize: 64,
  },
  badge: {
    backgroundColor: theme.colors.ivory,
    borderRadius: theme.radii.pill,
    left: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 7,
    position: 'absolute',
    top: theme.spacing.sm,
  },
  badgeText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  copy: {
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
  },
  category: {
    color: theme.colors.copperSoft,
    fontFamily: theme.typography.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.display,
    fontSize: 22,
    lineHeight: 27,
  },
  description: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 38,
  },
  footer: {
    alignItems: 'center',
    borderTopColor: '#302F2B',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
  },
  status: {
    color: theme.colors.paper,
    flex: 1,
    fontFamily: theme.typography.body,
    fontSize: 11,
  },
  arrow: {
    color: theme.colors.copperSoft,
    fontSize: 20,
  },
});
