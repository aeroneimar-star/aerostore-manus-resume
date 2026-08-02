/**
 * BrandSwitchScreen — Tela de troca de branding para smoke visual.
 * Mostra AEROSTORE vs Casa CAMBORÊ lado a lado com feature flags.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import {
  BrandThemeProvider,
  useBrand,
  useFeatureFlag,
  useBrandTheme,
  AEROSTORE_CONFIG,
  CASA_CAMBORE_CONFIG,
  type BrandId,
} from '../brand/BrandThemeProvider';

function BrandCard({ brandId, themeMode }: { brandId: BrandId; themeMode: 'light' | 'dark' }) {
  const config = brandId === 'aerostore' ? AEROSTORE_CONFIG : CASA_CAMBORE_CONFIG;
  const isDark = themeMode === 'dark';
  const bg = isDark ? '#1A1F1A' : '#FAF6F0';
  const surface = isDark ? '#2A2F2A' : '#FFFFFF';
  const text = isDark ? '#E8E4DF' : '#2D1810';
  const accent = config.colors.accentColor;

  return (
    <View style={[styles.card, { backgroundColor: surface }]}>
      <View style={[styles.brandHeader, { borderBottomColor: config.colors.primaryColor }]}>
        <Text style={[styles.brandName, { color: config.colors.primaryColor }]}>
          {config.displayName}
        </Text>
        <View style={[styles.statusBadge, {
          backgroundColor: config.enabled ? config.colors.successColor + '20' : config.colors.errorColor + '20'
        }]}>
          <Text style={[styles.statusText, {
            color: config.enabled ? config.colors.successColor : config.colors.errorColor
          }]}>
            {config.enabled ? 'Ativa' : 'Desativada'}
          </Text>
        </View>
      </View>

      {/* Cores */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: text }]}>Cores</Text>
        <View style={styles.colorRow}>
          {Object.entries(config.colors).map(([key, value]) => (
            <View key={key} style={styles.colorItem}>
              <View style={[styles.colorSwatch, { backgroundColor: value }]} />
              <Text style={[styles.colorLabel, { color: text, fontSize: 8 }]}>
                {key.replace(/Color$/, '').replace(/([A-Z])/g, ' $1').trim()}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Feature Flags */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: text }]}>Feature Flags</Text>
        <View style={styles.flagsGrid}>
          {Object.entries(config.featureFlags).map(([key, enabled]) => (
            <View key={key} style={[styles.flagItem, {
              backgroundColor: enabled ? config.colors.successColor + '15' : config.colors.errorColor + '10'
            }]}>
              <Text style={[styles.flagName, { color: text }]}>{key}</Text>
              <View style={[styles.flagBadge, {
                backgroundColor: enabled ? config.colors.successColor : config.colors.errorColor
              }]}>
                <Text style={styles.flagBadgeText}>
                  {enabled ? 'ON' : 'OFF'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Contatos */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: text }]}>Contatos</Text>
        <View style={styles.contactRow}>
          <Text style={[styles.contactLabel, { color: text }]}>Email:</Text>
          <Text style={[styles.contactValue, { color: accent }]}>{config.contacts.supportEmail}</Text>
        </View>
        <View style={styles.contactRow}>
          <Text style={[styles.contactLabel, { color: text }]}>Website:</Text>
          <Text style={[styles.contactValue, { color: accent }]}>{config.contacts.website}</Text>
        </View>
        <View style={styles.contactRow}>
          <Text style={[styles.contactLabel, { color: text }]}>Instagram:</Text>
          <Text style={[styles.contactValue, { color: accent }]}>{config.contacts.instagram}</Text>
        </View>
      </View>
    </View>
  );
}

function BrandComparisonContent() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  const [activeBrand, setActiveBrand] = useState<BrandId>('aerostore');

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Brand Engine</Text>
        <Text style={styles.subtitle}>Plataforma Multimarca</Text>
      </View>

      {/* Theme Toggle */}
      <View style={styles.themeToggle}>
        <TouchableOpacity
          style={[styles.themeBtn, themeMode === 'light' && styles.themeBtnActive]}
          onPress={() => setThemeMode('light')}
        >
          <Text style={[styles.themeBtnText, themeMode === 'light' && styles.themeBtnTextActive]}>LIGHT</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.themeBtn, themeMode === 'dark' && styles.themeBtnActive]}
          onPress={() => setThemeMode('dark')}
        >
          <Text style={[styles.themeBtnText, themeMode === 'dark' && styles.themeBtnTextActive]}>DARK</Text>
        </TouchableOpacity>
      </View>

      {/* Active Brand Switch */}
      <View style={styles.switchSection}>
        <Text style={styles.switchLabel}>Marca Ativa:</Text>
        <View style={styles.switchButtons}>
          <TouchableOpacity
            style={[styles.switchBtn, activeBrand === 'aerostore' && styles.switchBtnActive]}
            onPress={() => setActiveBrand('aerostore')}
          >
            <Text style={styles.switchBtnText}>AEROSTORE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.switchBtn, activeBrand === 'casa-cambore' && styles.switchBtnActive]}
            onPress={() => setActiveBrand('casa-cambore')}
          >
            <Text style={styles.switchBtnText}>Casa CAMBORÊ</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Active Brand Preview */}
      <BrandThemeProvider initialBrandId={activeBrand}>
        <ActiveBrandPreview themeMode={themeMode} />
      </BrandThemeProvider>

      {/* Side by Side */}
      <View style={styles.sideBySide}>
        <BrandCard brandId="aerostore" themeMode={themeMode} />
        <BrandCard brandId="casa-cambore" themeMode={themeMode} />
      </View>

      {/* Feature Flags Comparison */}
      <FeatureFlagsComparison themeMode={themeMode} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          AEROSTORE · Brand Engine + White-Label · Fase 3.11.5
        </Text>
      </View>
    </ScrollView>
  );
}

function ActiveBrandPreview({ themeMode }: { themeMode: 'light' | 'dark' }) {
  const { brand } = useBrand();
  const isDark = themeMode === 'dark';

  return (
    <View style={[styles.preview, {
      backgroundColor: isDark ? '#1A1F1A' : '#FFFFFF',
      borderLeftColor: brand.colors.primaryColor
    }]}>
      <Text style={[styles.previewTitle, { color: brand.colors.primaryColor }]}>
        {brand.displayName}
      </Text>
      <Text style={[styles.previewSlug, { color: isDark ? '#888' : '#666' }]}>
        {brand.slug} · {brand.currency} · {brand.locale}
      </Text>
      <View style={[styles.previewColorBar, { backgroundColor: brand.colors.primaryColor }]} />
    </View>
  );
}

function FeatureFlagsComparison({ themeMode }: { themeMode: 'light' | 'dark' }) {
  const isDark = themeMode === 'dark';
  const text = isDark ? '#E8E4DF' : '#2D1810';

  const flags: (keyof typeof AEROSTORE_CONFIG.featureFlags)[] = [
    'cashback', 'marketplace', 'wishlist', 'retirada', 'entrega',
    'motoboy', 'frete', 'pix', 'cartao', 'programaFidelidade',
    'notificacoes', 'cupons', 'giftCard', 'avaliacoes'
  ];

  return (
    <View style={[styles.comparisonSection, { backgroundColor: isDark ? '#2A2F2A' : '#FFFFFF' }]}>
      <Text style={[styles.comparisonTitle, { color: text }]}>
        Comparação de Feature Flags
      </Text>
      <View style={styles.comparisonHeader}>
        <Text style={[styles.comparisonLabel, { color: text }]}>Feature</Text>
        <Text style={[styles.comparisonLabel, { color: AEROSTORE_CONFIG.colors.primaryColor }]}>
          AEROSTORE
        </Text>
        <Text style={[styles.comparisonLabel, { color: CASA_CAMBORE_CONFIG.colors.primaryColor }]}>
          CAMBORÊ
        </Text>
      </View>
      {flags.map(flag => (
        <View key={flag} style={styles.comparisonRow}>
          <Text style={[styles.comparisonFlagName, { color: text }]}>{flag}</Text>
          <View style={[styles.comparisonCell, {
            backgroundColor: AEROSTORE_CONFIG.featureFlags[flag] ? '#16A34A20' : '#DC262620'
          }]}>
            <Text style={[styles.comparisonCellText, {
              color: AEROSTORE_CONFIG.featureFlags[flag] ? '#16A34A' : '#DC2626'
            }]}>
              {AEROSTORE_CONFIG.featureFlags[flag] ? '✓' : '✗'}
            </Text>
          </View>
          <View style={[styles.comparisonCell, {
            backgroundColor: CASA_CAMBORE_CONFIG.featureFlags[flag] ? '#16A34A20' : '#DC262620'
          }]}>
            <Text style={[styles.comparisonCellText, {
              color: CASA_CAMBORE_CONFIG.featureFlags[flag] ? '#16A34A' : '#DC2626'
            }]}>
              {CASA_CAMBORE_CONFIG.featureFlags[flag] ? '✓' : '✗'}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: { padding: 16, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#2D1810' },
  subtitle: { fontSize: 12, color: '#888', marginTop: 4 },
  themeToggle: { flexDirection: 'row', justifyContent: 'center', gap: 8, padding: 8 },
  themeBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#E0E0E0' },
  themeBtnActive: { backgroundColor: '#C8834A' },
  themeBtnText: { fontSize: 11, fontWeight: '700', color: '#666' },
  themeBtnTextActive: { color: '#FFF' },
  switchSection: { padding: 12 },
  switchLabel: { fontSize: 11, color: '#888', marginBottom: 6 },
  switchButtons: { flexDirection: 'row', gap: 8 },
  switchBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#E0E0E0' },
  switchBtnActive: { backgroundColor: '#C8834A' },
  switchBtnText: { fontSize: 11, fontWeight: '600', color: '#333' },
  preview: { margin: 12, padding: 16, borderRadius: 12, borderLeftWidth: 4 },
  previewTitle: { fontSize: 16, fontWeight: '800' },
  previewSlug: { fontSize: 10, marginTop: 4 },
  previewColorBar: { height: 4, borderRadius: 2, marginTop: 12 },
  sideBySide: { flexDirection: 'row', padding: 12, gap: 8 },
  card: { flex: 1, borderRadius: 12, padding: 12 },
  brandHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, paddingBottom: 8, marginBottom: 8 },
  brandName: { fontSize: 12, fontWeight: '800' },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusText: { fontSize: 8, fontWeight: '700' },
  section: { marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: '700', marginBottom: 6 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  colorItem: { alignItems: 'center', width: 36 },
  colorSwatch: { width: 24, height: 24, borderRadius: 6 },
  colorLabel: { marginTop: 2, textAlign: 'center' },
  flagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  flagItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 6, borderRadius: 4 },
  flagName: { fontSize: 8, marginRight: 4 },
  flagBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 },
  flagBadgeText: { fontSize: 7, fontWeight: '700', color: '#FFF' },
  contactRow: { flexDirection: 'row', marginBottom: 3 },
  contactLabel: { fontSize: 9, width: 60 },
  contactValue: { fontSize: 9, flex: 1 },
  comparisonSection: { margin: 12, padding: 12, borderRadius: 12 },
  comparisonTitle: { fontSize: 12, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  comparisonHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#DDD', paddingBottom: 4, marginBottom: 4 },
  comparisonLabel: { fontSize: 8, fontWeight: '700', flex: 1 },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  comparisonFlagName: { fontSize: 9, flex: 1 },
  comparisonCell: { width: 30, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
  comparisonCellText: { fontSize: 10, fontWeight: '700' },
  footer: { padding: 16, alignItems: 'center' },
  footerText: { fontSize: 10, color: '#999', textAlign: 'center' },
});

export default BrandSwitchScreen;
