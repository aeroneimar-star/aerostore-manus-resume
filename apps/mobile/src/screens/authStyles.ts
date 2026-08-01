import { StyleSheet } from 'react-native';
import { theme } from '@/theme';

export const authStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.ink },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  card: { width: '100%', maxWidth: 460, backgroundColor: theme.colors.inkRaised, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: '#34322E', padding: theme.spacing.xl, ...theme.shadows.card },
  eyebrow: { color: theme.colors.copperSoft, fontFamily: theme.typography.body, fontSize: 12, fontWeight: '700', letterSpacing: 3, marginBottom: theme.spacing.xl },
  title: { color: theme.colors.ivory, fontFamily: theme.typography.display, fontSize: 38, lineHeight: 44, marginBottom: theme.spacing.sm },
  description: { color: theme.colors.stone, fontFamily: theme.typography.body, fontSize: 16, lineHeight: 24, marginBottom: theme.spacing.lg },
  label: { color: theme.colors.paper, fontFamily: theme.typography.body, fontSize: 13, fontWeight: '600', marginBottom: theme.spacing.xs },
  input: { minHeight: 54, borderWidth: 1, borderColor: '#4A4741', borderRadius: theme.radii.md, color: theme.colors.ivory, backgroundColor: '#121211', paddingHorizontal: theme.spacing.md, fontFamily: theme.typography.body, fontSize: 18, marginBottom: theme.spacing.md },
  otp: { textAlign: 'center', letterSpacing: 10, fontSize: 24 },
  button: { minHeight: theme.sizes.touch, borderRadius: theme.radii.pill, backgroundColor: theme.colors.copper, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.lg },
  buttonMuted: { opacity: 0.48 },
  buttonText: { color: theme.colors.ink, fontFamily: theme.typography.body, fontWeight: '800', fontSize: 15 },
  secondary: { marginTop: theme.spacing.sm, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#514E48' },
  secondaryText: { color: theme.colors.paper },
  helper: { color: theme.colors.stone, textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: theme.spacing.md },
  error: { color: theme.colors.error, fontSize: 13, marginBottom: theme.spacing.md },
  seal: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#292720', marginBottom: theme.spacing.lg },
  sealText: { color: theme.colors.copperSoft, fontSize: 24 },
});
