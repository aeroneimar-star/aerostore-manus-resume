import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { useWebFocusVisible, webFocusVisibleStyle } from '@/accessibility/useWebFocusVisible';
import type { CustomerProfile } from '@/app-auth/contracts';
import { getAuthStyles } from './authStyles';
import { useAppTheme, theme } from '@/theme';
import type { ThemePreference } from '@/theme';

function Button({ label, onPress, secondary = false, disabled = false, tokens }: { label: string; onPress(): void; secondary?: boolean; disabled?: boolean; tokens: import('@/theme').ThemeTokens }) {
  const focus = useWebFocusVisible();
  const s = getAuthStyles(tokens);
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onFocus={focus.onFocus} onBlur={focus.onBlur} style={[s.button, secondary && s.secondary, disabled && s.buttonMuted, focus.focusVisible && webFocusVisibleStyle]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}

const themeOptionLabels: Record<ThemePreference, string> = {
  dark: 'Escuro',
  light: 'Claro',
  system: 'Automático',
};

export function ProfileScreen({ profile, loading = false, error, success, onSave, onCancel, onLogout }: { profile: CustomerProfile; loading?: boolean; error?: string; success?: string; onSave(input: { version: number; displayName: string; fullName: string; email?: string }): void; onCancel(): void; onLogout(): void }) {
  const { tokens, preference, setPreference } = useAppTheme();
  const s = getAuthStyles(tokens);
  const [editing, setEditing] = useState(false); const [displayName, setDisplayName] = useState(profile.displayName); const [fullName, setFullName] = useState(profile.fullName); const [email, setEmail] = useState('');
  useEffect(() => { setDisplayName(profile.displayName); setFullName(profile.fullName); setEmail(''); }, [profile]);
  const cancel = () => { setEditing(false); setDisplayName(profile.displayName); setFullName(profile.fullName); setEmail(''); onCancel(); };

  const themeOptions: ThemePreference[] = ['dark', 'light', 'system'];

  return <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><View style={s.card}>
    <View style={s.statusHeader}><Text style={s.eyebrow}>AEROSTORE · PERFIL</Text><Text style={s.statusMeta}>{profile.profileComplete ? 'COMPLETO' : 'EM CONSTRUÇÃO'}</Text></View>
    <Text accessibilityRole="header" style={s.title}>Seus dados essenciais.</Text><Text style={s.description}>Este perfil pertence ao aplicativo e não altera seus registros de atendimento.</Text>
    <View style={s.profileFacts}><View style={s.fact}><Text style={s.factLabel}>TELEFONE</Text><Text style={s.factValue}>{profile.phoneMasked}</Text></View><View style={s.fact}><Text style={s.factLabel}>ACESSO</Text><Text style={s.factValue}>{profile.accessStatus}</Text></View></View>
    <Text style={s.label}>Como quer ser chamado</Text><TextInput accessibilityLabel="Nome de exibição" editable={editing && !loading} value={displayName} onChangeText={setDisplayName} placeholder="Seu nome" placeholderTextColor={tokens.inputPlaceholder} style={[s.input, !editing && s.readonlyInput]} />
    <Text style={s.label}>Nome completo</Text><TextInput accessibilityLabel="Nome completo" editable={editing && !loading} value={fullName} onChangeText={setFullName} placeholder="Nome completo" placeholderTextColor={tokens.inputPlaceholder} style={[s.input, !editing && s.readonlyInput]} />
    <Text style={s.label}>E-mail</Text><TextInput accessibilityLabel="E-mail" editable={editing && !loading} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={editing ? email : profile.emailMasked} onChangeText={setEmail} placeholder={profile.emailMasked || 'nome@email.com'} placeholderTextColor={tokens.inputPlaceholder} style={[s.input, !editing && s.readonlyInput]} />

    {/* Seção Aparência */}
    <View style={styles.appearanceSection}>
      <Text style={[s.label, styles.appearanceLabel]}>APARÊNCIA</Text>
      <Text style={[s.description, { fontSize: 13, marginBottom: theme.spacing.sm }]}>Escolha como o aplicativo deve ser exibido.</Text>
      {themeOptions.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="radio"
          accessibilityState={{ checked: preference === option }}
          accessibilityLabel={`Tema ${themeOptionLabels[option]}`}
          onPress={() => setPreference(option)}
          style={[
            styles.themeOption,
            { borderColor: tokens.border },
            preference === option && { backgroundColor: tokens.surfaceElevated, borderColor: tokens.accent },
          ]}>
          <Text style={[styles.themeOptionText, { color: tokens.textSecondary }, preference === option && { color: tokens.textPrimary, fontWeight: '700' }]}>
            {themeOptionLabels[option]}
          </Text>
          {preference === option ? (
            <View style={[styles.themeCheck, { backgroundColor: tokens.accent }]} />
          ) : null}
        </Pressable>
      ))}
    </View>

    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}{success ? <Text accessibilityRole="alert" style={s.success}>{success}</Text> : null}
    {editing ? <><Button label={loading ? 'Salvando…' : 'Salvar alterações'} disabled={loading || fullName.trim().length < 3} onPress={() => onSave({ version: profile.version, displayName, fullName, ...(email.trim() ? { email: email.trim() } : {}) })} tokens={tokens} /><Button label="Cancelar" secondary disabled={loading} onPress={cancel} tokens={tokens} /></> : <Button label="Editar perfil" onPress={() => setEditing(true)} tokens={tokens} />}
    <Button label="Voltar ao status" secondary disabled={loading} onPress={onCancel} tokens={tokens} /><Button label="Sair da conta" secondary disabled={loading} onPress={onLogout} tokens={tokens} />
    {loading ? <ActivityIndicator accessibilityLabel="Salvando perfil" color={tokens.accent} style={s.inlineLoader} /> : null}
  </View></ScrollView>;
}

const styles = StyleSheet.create({
  appearanceSection: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.xs,
  },
  appearanceLabel: {
    marginBottom: theme.spacing.xs,
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: theme.radii.md,
    minHeight: theme.sizes.touch,
    paddingHorizontal: theme.spacing.md,
  },
  themeOptionText: {
    fontFamily: theme.typography.body,
    fontSize: 14,
  },
  themeCheck: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
