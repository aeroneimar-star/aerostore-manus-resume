import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAuthStyles } from './authStyles';

export function SessionExpiredScreen({ onLogin }: { onLogin(): void }) {
  const s = useAuthStyles();
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <View style={s.card}>
        <Text style={s.eyebrow}>SESSÃO PROTEGIDA</Text>
        <View style={s.seal}><Text style={s.sealText}>↻</Text></View>
        <Text style={s.title}>Sua sessão expirou.</Text>
        <Text style={s.description}>Para proteger seus dados, confirme seu telefone novamente.</Text>
        <Pressable accessibilityLabel="Entrar novamente" accessibilityRole="button" onPress={onLogin} style={s.button}>
          <Text style={s.buttonText}>Entrar novamente</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
