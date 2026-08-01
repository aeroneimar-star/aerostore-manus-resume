import { ActivityIndicator, Text, View } from 'react-native';
import { authStyles as s } from './authStyles';

export function SessionSplashScreen({ message = 'Protegendo seu acesso…' }: { message?: string }) {
  return <View style={[s.page, s.content]} accessibilityLabel="Restaurando sessão"><View style={s.splashMark}><Text style={s.splashLetter}>A</Text></View><Text style={s.eyebrow}>AEROSTORE</Text><ActivityIndicator color="#C48054" /><Text style={s.helper}>{message}</Text></View>;
}
