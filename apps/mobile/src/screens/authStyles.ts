import { StyleSheet } from 'react-native';
import { theme } from '@/theme';
import { useAppTheme } from '@/theme';
import type { ThemeTokens } from '@/theme';

/**
 * Auth styles factory — returns styles with token-based colors.
 * Call with the active tokens to get themed styles.
 */
export function getAuthStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: tokens.background },
    content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
    card: { width: '100%', maxWidth: 460, backgroundColor: tokens.surface, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: tokens.border, padding: theme.spacing.xl, ...theme.shadows.card },
    eyebrow: { color: tokens.textMuted, fontFamily: theme.typography.body, fontSize: 12, fontWeight: '700', letterSpacing: 3, marginBottom: theme.spacing.xl },
    title: { color: tokens.textPrimary, fontFamily: theme.typography.display, fontSize: 38, lineHeight: 44, marginBottom: theme.spacing.sm },
    description: { color: tokens.textSecondary, fontFamily: theme.typography.body, fontSize: 16, lineHeight: 24, marginBottom: theme.spacing.lg },
    label: { color: tokens.textSecondary, fontFamily: theme.typography.body, fontSize: 13, fontWeight: '600', marginBottom: theme.spacing.xs },
    input: { minHeight: 54, borderWidth: 1, borderColor: tokens.inputBorder, borderRadius: theme.radii.md, color: tokens.textPrimary, backgroundColor: tokens.inputBackground, paddingHorizontal: theme.spacing.md, fontFamily: theme.typography.body, fontSize: 18, marginBottom: theme.spacing.md },
    otp: { textAlign: 'center', letterSpacing: 10, fontSize: 24 },
    button: { minHeight: theme.sizes.touch, borderRadius: theme.radii.pill, backgroundColor: tokens.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.lg },
    buttonMuted: { opacity: 0.48 },
    buttonText: { color: tokens.textInverse, fontFamily: theme.typography.body, fontWeight: '800', fontSize: 15 },
    secondary: { marginTop: theme.spacing.sm, backgroundColor: 'transparent', borderWidth: 1, borderColor: tokens.borderStrong },
    secondaryText: { color: tokens.textSecondary },
    helper: { color: tokens.textSecondary, textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: theme.spacing.md },
    error: { color: tokens.error, fontSize: 13, marginBottom: theme.spacing.md },
    seal: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surfaceElevated, marginBottom: theme.spacing.lg },
    sealText: { color: tokens.accent, fontSize: 24 },
    splashMark: { width: 76, height: 76, borderRadius: 38, borderWidth: 1, borderColor: tokens.accent, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.lg, backgroundColor: tokens.surface },
    splashLetter: { color: tokens.textPrimary, fontFamily: theme.typography.display, fontSize: 38 },
    statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.spacing.sm, marginBottom: theme.spacing.xl },
    statusHeaderCompact: { flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'flex-start', gap: theme.spacing.xs },
    statusEyebrow: { flexShrink: 1, marginBottom: 0 },
    statusMeta: { flexShrink: 0, color: tokens.success, fontFamily: theme.typography.body, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
    statusActions: { width: '100%' },
    statusAction: { marginTop: 0 },
    statusActionSeparated: { marginTop: theme.spacing.sm },
    securityNote: { borderLeftWidth: 2, borderLeftColor: tokens.accent, paddingLeft: theme.spacing.md, marginBottom: theme.spacing.lg },
    securityNoteTitle: { color: tokens.textSecondary, fontFamily: theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.xxs },
    securityNoteText: { color: tokens.textMuted, fontFamily: theme.typography.body, fontSize: 12, lineHeight: 18 },
    inlineLoader: { marginTop: theme.spacing.md },
    profileFacts: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
    fact: { flex: 1, minWidth: 0, borderTopWidth: 1, borderTopColor: tokens.border, paddingTop: theme.spacing.sm },
    factLabel: { color: tokens.textMuted, fontFamily: theme.typography.body, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: theme.spacing.xxs },
    factValue: { color: tokens.textSecondary, fontFamily: theme.typography.body, fontSize: 13 },
    readonlyInput: { color: tokens.textMuted, backgroundColor: tokens.surfaceMuted },
    success: { color: tokens.success, fontSize: 13, marginBottom: theme.spacing.md },
    accent: tokens.accent,
  });
}

/**
 * Hook that returns auth styles based on the current active theme.
 * Use this in auth screen components that need theme-reactive styles.
 */
export function useAuthStyles() {
  const { tokens } = useAppTheme();
  return getAuthStyles(tokens);
}
