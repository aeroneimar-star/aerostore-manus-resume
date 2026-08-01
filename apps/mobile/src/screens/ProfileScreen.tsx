import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useWebFocusVisible, webFocusVisibleStyle } from '@/accessibility/useWebFocusVisible';
import type { CustomerProfile } from '@/app-auth/contracts';
import { authStyles as s } from './authStyles';

function Button({ label, onPress, secondary = false, disabled = false }: { label: string; onPress(): void; secondary?: boolean; disabled?: boolean }) {
  const focus = useWebFocusVisible();
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onFocus={focus.onFocus} onBlur={focus.onBlur} style={[s.button, secondary && s.secondary, disabled && s.buttonMuted, focus.focusVisible && webFocusVisibleStyle]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}

export function ProfileScreen({ profile, loading = false, error, success, onSave, onCancel, onLogout }: { profile: CustomerProfile; loading?: boolean; error?: string; success?: string; onSave(input: { version: number; displayName: string; fullName: string; email?: string }): void; onCancel(): void; onLogout(): void }) {
  const [editing, setEditing] = useState(false); const [displayName, setDisplayName] = useState(profile.displayName); const [fullName, setFullName] = useState(profile.fullName); const [email, setEmail] = useState('');
  useEffect(() => { setDisplayName(profile.displayName); setFullName(profile.fullName); setEmail(''); }, [profile]);
  const cancel = () => { setEditing(false); setDisplayName(profile.displayName); setFullName(profile.fullName); setEmail(''); onCancel(); };
  return <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><View style={s.card}>
    <View style={s.statusHeader}><Text style={s.eyebrow}>AEROSTORE · PERFIL</Text><Text style={s.statusMeta}>{profile.profileComplete ? 'COMPLETO' : 'EM CONSTRUÇÃO'}</Text></View>
    <Text accessibilityRole="header" style={s.title}>Seus dados essenciais.</Text><Text style={s.description}>Este perfil pertence ao aplicativo e não altera seus registros de atendimento.</Text>
    <View style={s.profileFacts}><View style={s.fact}><Text style={s.factLabel}>TELEFONE</Text><Text style={s.factValue}>{profile.phoneMasked}</Text></View><View style={s.fact}><Text style={s.factLabel}>ACESSO</Text><Text style={s.factValue}>{profile.accessStatus}</Text></View></View>
    <Text style={s.label}>Como quer ser chamado</Text><TextInput accessibilityLabel="Nome de exibição" editable={editing && !loading} value={displayName} onChangeText={setDisplayName} placeholder="Seu nome" placeholderTextColor="#77726A" style={[s.input, !editing && s.readonlyInput]} />
    <Text style={s.label}>Nome completo</Text><TextInput accessibilityLabel="Nome completo" editable={editing && !loading} value={fullName} onChangeText={setFullName} placeholder="Nome completo" placeholderTextColor="#77726A" style={[s.input, !editing && s.readonlyInput]} />
    <Text style={s.label}>E-mail</Text><TextInput accessibilityLabel="E-mail" editable={editing && !loading} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={editing ? email : profile.emailMasked} onChangeText={setEmail} placeholder={profile.emailMasked || 'nome@email.com'} placeholderTextColor="#77726A" style={[s.input, !editing && s.readonlyInput]} />
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}{success ? <Text accessibilityRole="alert" style={s.success}>{success}</Text> : null}
    {editing ? <><Button label={loading ? 'Salvando…' : 'Salvar alterações'} disabled={loading || fullName.trim().length < 3} onPress={() => onSave({ version: profile.version, displayName, fullName, ...(email.trim() ? { email: email.trim() } : {}) })} /><Button label="Cancelar" secondary disabled={loading} onPress={cancel} /></> : <Button label="Editar perfil" onPress={() => setEditing(true)} />}
    <Button label="Voltar ao status" secondary disabled={loading} onPress={onCancel} /><Button label="Sair da conta" secondary disabled={loading} onPress={onLogout} />
    {loading ? <ActivityIndicator accessibilityLabel="Salvando perfil" color="#E3B18E" style={s.inlineLoader} /> : null}
  </View></ScrollView>;
}
