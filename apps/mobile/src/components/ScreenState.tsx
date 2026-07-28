import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  useWebFocusVisible,
  webFocusVisibleStyle,
} from '@/accessibility/useWebFocusVisible';
import { theme } from '@/theme';

type StateKind = 'loading' | 'empty' | 'error' | 'disabled' | 'not_found';

const content: Record<StateKind, { eyebrow: string; title: string; body: string }> = {
  loading: {
    eyebrow: 'CURADORIA EM ANDAMENTO',
    title: 'Preparando a coleção',
    body: 'Estamos organizando as peças para você.',
  },
  empty: {
    eyebrow: 'NENHUMA PEÇA',
    title: 'Nada por aqui ainda',
    body: 'Experimente outra categoria ou combinação de destaque.',
  },
  error: {
    eyebrow: 'NÃO FOI POSSÍVEL CARREGAR',
    title: 'A coleção fez uma pausa',
    body: 'Verifique sua conexão e tente novamente.',
  },
  disabled: {
    eyebrow: 'EM PREPARAÇÃO',
    title: 'O catálogo ainda não está disponível.',
    body: 'Nossa curadoria digital será apresentada em breve.',
  },
  not_found: {
    eyebrow: 'PRODUTO NÃO ENCONTRADO',
    title: 'Esta peça não está disponível',
    body: 'Ela pode ter saído da coleção ou o endereço pode estar incorreto.',
  },
};

interface ScreenStateProps {
  kind: StateKind;
  onRetry?: () => void;
}

export function ScreenState({ kind, onRetry }: ScreenStateProps) {
  const retryFocus = useWebFocusVisible();
  const copy = content[kind];
  const loading = kind === 'loading';
  return (
    <View
      style={styles.container}
      accessibilityRole={loading ? 'progressbar' : 'summary'}
      accessibilityLiveRegion="polite">
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Carregando coleção"
          color={theme.colors.copperSoft}
          size="large"
        />
      ) : (
        <View style={styles.marker} />
      )}
      <Text maxFontSizeMultiplier={1.5} style={styles.eyebrow}>
        {copy.eyebrow}
      </Text>
      <Text maxFontSizeMultiplier={1.5} style={styles.title}>
        {copy.title}
      </Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.body}>
        {copy.body}
      </Text>
      {onRetry && kind !== 'disabled' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tentar carregar novamente"
          onBlur={retryFocus.onBlur}
          onFocus={retryFocus.onFocus}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            retryFocus.focusVisible && webFocusVisibleStyle,
          ]}>
          <Text style={styles.buttonText}>Tentar novamente</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    alignSelf: 'center',
    justifyContent: 'center',
    minHeight: 360,
    maxWidth: 520,
    paddingHorizontal: theme.spacing.lg,
    width: '100%',
  },
  marker: {
    backgroundColor: theme.colors.copper,
    height: 2,
    marginBottom: theme.spacing.lg,
    width: 52,
  },
  eyebrow: {
    color: theme.colors.copperSoft,
    fontFamily: theme.typography.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: theme.spacing.md,
  },
  title: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.display,
    fontSize: 34,
    lineHeight: 40,
    marginTop: theme.spacing.sm,
  },
  body: {
    color: theme.colors.stone,
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 25,
    marginTop: theme.spacing.sm,
  },
  button: {
    alignItems: 'center',
    backgroundColor: theme.colors.ivory,
    borderRadius: theme.radii.pill,
    justifyContent: 'center',
    marginTop: theme.spacing.lg,
    minHeight: theme.sizes.touch,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonPressed: {
    opacity: 0.74,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    fontWeight: '700',
  },
});
