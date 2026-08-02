import { StyleSheet, View } from 'react-native';
import { ScreenState } from './ScreenState';
import { useAppTheme, theme } from '@/theme';

export function LoadingCatalog() {
  const { tokens } = useAppTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Carregando catálogo" style={styles.grid}>
      {[0, 1].map((item) => (
        <View key={item} style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border, borderWidth: 1 }]}>
          <View style={[styles.image, { backgroundColor: tokens.skeleton }]} />
          <View style={[styles.lineWide, { backgroundColor: tokens.skeletonLine }]} />
          <View style={[styles.line, { backgroundColor: tokens.skeletonLine }]} />
          <View style={[styles.price, { backgroundColor: tokens.skeletonPrice }]} />
        </View>
      ))}
    </View>
  );
}
export function EmptyCatalog() { return <ScreenState kind="empty" />; }
export function ErrorCatalog({ onRetry }: { onRetry(): void }) { return <ScreenState kind="error" onRetry={onRetry} />; }

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md, paddingTop: theme.spacing.xxl },
  card: { borderRadius: theme.radii.lg, minWidth: 280, overflow: 'hidden', paddingBottom: theme.spacing.md, width: '48%' },
  image: { aspectRatio: 0.82 },
  lineWide: { borderRadius: 4, height: 18, marginHorizontal: theme.spacing.md, marginTop: theme.spacing.md, width: '72%' },
  line: { borderRadius: 4, height: 10, marginHorizontal: theme.spacing.md, marginTop: theme.spacing.sm, width: '50%' },
  price: { borderRadius: 4, height: 16, marginHorizontal: theme.spacing.md, marginTop: theme.spacing.md, width: '35%' },
});
