import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useWebFocusVisible, webFocusVisibleStyle } from '@/accessibility/useWebFocusVisible';
import type { AccessSnapshot, AccessStatus } from '@/app-auth/contracts';
import { authStyles as s } from './authStyles';

const copy: Record<AccessStatus, { title: string; description: string; symbol: string }> = {
  PENDING_PHONE_VERIFICATION: { title: 'Confirme seu telefone para continuar.', description: 'Volte à confirmação para concluir esta etapa com segurança.', symbol: '·' },
  PENDING_APPROVAL: { title: 'Seu cadastro está em análise.', description: 'A equipe AEROSTORE está verificando seus dados. Avisaremos quando o acesso for liberado.', symbol: '◷' },
  APPROVED: { title: 'Seu acesso foi aprovado.', description: 'Seu catálogo privado está pronto para ser explorado.', symbol: '✓' },
  REJECTED: { title: 'Não foi possível liberar seu acesso.', description: 'Entre em contato com a AEROSTORE para mais informações.', symbol: '!' },
  SUSPENDED: { title: 'Seu acesso está temporariamente suspenso.', description: 'Entre em contato com a AEROSTORE para receber ajuda.', symbol: '—' },
  BLOCKED: { title: 'Não foi possível acessar sua conta.', description: 'Entre em contato com a AEROSTORE.', symbol: '×' },
  CLOSED: { title: 'Esta conta não está disponível.', description: 'A sessão foi encerrada com segurança.', symbol: '—' },
};

function Action({ label, onPress, secondary = false, separated = false, disabled = false }: { label: string; onPress(): void; secondary?: boolean; separated?: boolean; disabled?: boolean }) {
  const focus = useWebFocusVisible();
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onFocus={focus.onFocus} onBlur={focus.onBlur} style={[s.button, secondary && s.secondary, s.statusAction, separated && s.statusActionSeparated, disabled && s.buttonMuted, focus.focusVisible && webFocusVisibleStyle]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}

export const isCompactAccessHeader = (width: number) => width <= 430;

export function AccessStatusHeader({ compact }: { compact: boolean }) {
  return <View accessibilityLabel="Cabeçalho do status de acesso" style={[s.statusHeader, compact && s.statusHeaderCompact]}><Text style={[s.eyebrow, s.statusEyebrow]}>AEROSTORE · ACESSO</Text><Text style={s.statusMeta}>ATUALIZADO AGORA</Text></View>;
}

export function AccessStatusScreen({ snapshot, loading = false, error, onRefresh, onProfile, onCatalog, onLogout, onVerifyPhone }: { snapshot: AccessSnapshot; loading?: boolean; error?: string; onRefresh(): void; onProfile(): void; onCatalog(): void; onLogout(): void; onVerifyPhone(): void }) {
  const { width } = useWindowDimensions(); const compactHeader = isCompactAccessHeader(width);
  const status = snapshot.effectiveStatus; const content = copy[status]; const profileAvailable = snapshot.permissions.canViewProfile;
  return <ScrollView style={s.page} contentContainerStyle={s.content}><View style={s.card}>
    <AccessStatusHeader compact={compactHeader} />
    <View style={s.seal}><Text style={s.sealText}>{content.symbol}</Text></View>
    <Text accessibilityRole="header" style={s.title}>{content.title}</Text><Text style={s.description}>{content.description}</Text>
    <View style={s.securityNote}><Text style={s.securityNoteTitle}>Status verificado</Text><Text style={s.securityNoteText}>{status === 'APPROVED' ? 'Seu catálogo é privado e protegido pela sua sessão AEROSTORE.' : 'Esta informação vem diretamente da AEROSTORE. O catálogo privado permanece protegido.'}</Text></View>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <View accessibilityLabel="Ações do status de acesso" style={s.statusActions}>
      {status === 'PENDING_PHONE_VERIFICATION' ? <Action label="Confirmar telefone" onPress={onVerifyPhone} disabled={loading} /> : null}
      {status === 'APPROVED' ? <Action label="Ver catálogo privado" onPress={onCatalog} disabled={loading} /> : null}
      {profileAvailable ? <Action label="Abrir meu perfil" onPress={onProfile} separated={status === 'PENDING_PHONE_VERIFICATION' || status === 'APPROVED'} disabled={loading} /> : null}
      <Action label={loading ? 'Atualizando status…' : 'Atualizar status'} onPress={onRefresh} secondary separated={status === 'PENDING_PHONE_VERIFICATION' || status === 'APPROVED' || profileAvailable} disabled={loading} />
      <Action label={status === 'CLOSED' ? 'Voltar ao início' : 'Sair da conta'} onPress={onLogout} secondary separated disabled={loading} />
    </View>
    {loading ? <ActivityIndicator accessibilityLabel="Atualizando status" color="#E3B18E" style={s.inlineLoader} /> : null}
  </View></ScrollView>;
}
