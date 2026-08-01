import { StyleSheet, View } from 'react-native';
import { ScreenState } from './ScreenState';
import { theme } from '@/theme';

export function LoadingCatalog() {
  return <View accessibilityRole="progressbar" accessibilityLabel="Carregando catálogo" style={styles.grid}>{[0, 1].map((item) => <View key={item} style={styles.card}><View style={styles.image} /><View style={styles.lineWide} /><View style={styles.line} /><View style={styles.price} /></View>)}</View>;
}
export function EmptyCatalog() { return <ScreenState kind="empty" />; }
export function ErrorCatalog({ onRetry }: { onRetry(): void }) { return <ScreenState kind="error" onRetry={onRetry} />; }

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md, paddingTop: theme.spacing.xxl },
  card: { backgroundColor: theme.colors.inkRaised, borderRadius: theme.radii.lg, minWidth: 280, overflow: 'hidden', paddingBottom: theme.spacing.md, width: '48%' },
  image: { aspectRatio: 0.82, backgroundColor: '#24231F' },
  lineWide: { backgroundColor: '#302F2B', borderRadius: 4, height: 18, marginHorizontal: theme.spacing.md, marginTop: theme.spacing.md, width: '72%' },
  line: { backgroundColor: '#302F2B', borderRadius: 4, height: 10, marginHorizontal: theme.spacing.md, marginTop: theme.spacing.sm, width: '50%' },
  price: { backgroundColor: '#3A3832', borderRadius: 4, height: 16, marginHorizontal: theme.spacing.md, marginTop: theme.spacing.md, width: '35%' },
});
