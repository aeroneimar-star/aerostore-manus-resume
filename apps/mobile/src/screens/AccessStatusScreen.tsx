import { ScrollView, Text, View } from 'react-native';
import type { AccessStatus } from '@/app-auth/contracts';
import { authStyles as s } from './authStyles';

export function AccessStatusScreen({ status }: { status: AccessStatus }) {
  const approved=status==='APPROVED'; const rejected=status==='REJECTED'; const restricted=status==='SUSPENDED'||status==='BLOCKED'; const phonePending=status==='PENDING_PHONE_VERIFICATION';
  return <ScrollView style={s.page} contentContainerStyle={s.content}><View style={s.card}>
    <Text style={s.eyebrow}>AEROSTORE</Text><View style={s.seal}><Text style={s.sealText}>{approved?'✓':rejected?'!':'◷'}</Text></View>
    <Text style={s.title}>{approved?'Seu acesso foi aprovado.':rejected?'Não foi possível liberar seu acesso.':restricted?'Seu acesso está indisponível.':phonePending?'Confirme seu telefone.':'Seu cadastro está em análise.'}</Text>
    <Text style={s.description}>{approved?'O catálogo será carregado em uma próxima fase segura.':rejected?'Entre em contato com a AEROSTORE.':restricted?'Entre em contato com a AEROSTORE para receber ajuda.':phonePending?'Conclua a confirmação para continuar.':'Avisaremos quando o acesso for liberado.'}</Text>
    <Text style={s.helper}>Nenhuma compra, catálogo privado ou sessão definitiva foi liberada neste fluxo.</Text>
  </View></ScrollView>;
}
