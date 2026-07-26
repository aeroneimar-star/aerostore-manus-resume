import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/theme';

const formatBrl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);

interface PriceProps {
  priceCents: number;
  compareAtPriceCents?: number | null;
  large?: boolean;
}

export function Price({
  priceCents,
  compareAtPriceCents,
  large = false,
}: PriceProps) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={
        compareAtPriceCents
          ? `De ${formatBrl(compareAtPriceCents)} por ${formatBrl(priceCents)}`
          : formatBrl(priceCents)
      }>
      <Text
        maxFontSizeMultiplier={1.5}
        style={[styles.price, large && styles.priceLarge]}>
        {formatBrl(priceCents)}
      </Text>
      {compareAtPriceCents ? (
        <Text maxFontSizeMultiplier={1.5} style={styles.compare}>
          {formatBrl(compareAtPriceCents)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  price: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.body,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  priceLarge: {
    fontFamily: theme.typography.display,
    fontSize: 28,
    fontWeight: '600',
  },
  compare: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 13,
    textDecorationLine: 'line-through',
  },
});
