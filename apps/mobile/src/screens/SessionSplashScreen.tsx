import { ActivityIndicator, Text, View } from 'react-native';
import { useAuthStyles } from './authStyles';
import { useAppTheme } from '@/theme';

export function SessionSplashScreen({ message = 'Protegendo seu acesso…' }: { message?: string }) {
  const s = useAuthStyles();
  const { tokens } = useAppTheme();
  return (
    <View style={[s.page, s.content]} accessibilityLabel="Restaurando sessão">
      <View style={s.splashMark}><Text style={s.splashLetter}>A</Text></View>
      <Text style={s.eyebrow}>AEROSTORE</Text>
      <ActivityIndicator color={tokens.accent} />
      <Text style={s.helper}>{message}</Text>
    </View>
  );
}
