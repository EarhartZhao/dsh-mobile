import React, { useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ConnectionManager, ConnectionState } from '@dsh-mobile/core'
import type { MobileInventorySnapshot } from '@dsh-mobile/protocol'
import { useI18n, type Language, type TranslationKey } from '../i18n'
import { ModalBackdrop } from '../components/ModalBackdrop'
import { colors, fontSize, radius, spacing } from '../theme'

export type ThemeMode = 'light' | 'dark' | 'system'

interface DiagnosticError {
  at: string
  message: string
  kind: string
}

interface DiagnosticEvent {
  at: string
  state: ConnectionState
}

interface SettingsScreenProps {
  manager: ConnectionManager
  connState: ConnectionState
  errors: DiagnosticError[]
  events: DiagnosticEvent[]
  inventory: MobileInventorySnapshot | null | undefined
  inventoryLoading: boolean
  refreshInventory: () => void
  themeMode: ThemeMode
  setTheme: (mode: ThemeMode) => void
  language: Language
  setLanguage: (language: Language) => void
  onOpenDiagnostics: () => void
  onBack: () => void
  appVersion: string
}

function themeLabel(mode: ThemeMode, t: (key: TranslationKey) => string): string {
  return mode === 'light' ? t('app.theme.light') : mode === 'dark' ? t('app.theme.dark') : t('app.theme.system')
}

function languageLabel(mode: Language, t: (key: TranslationKey) => string): string {
  return mode === 'system' ? t('app.language.system') : mode === 'zh' ? t('app.language.zh') : t('app.language.en')
}

export function SettingsScreen({
  manager,
  connState,
  errors,
  events,
  inventory,
  inventoryLoading,
  refreshInventory,
  themeMode,
  setTheme,
  language,
  setLanguage,
  onOpenDiagnostics,
  onBack,
  appVersion,
}: SettingsScreenProps): React.JSX.Element {
  const { t } = useI18n()
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false)

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('app.settings')}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutTitle}>dsh-mobile</Text>
          <Text style={styles.aboutMeta}>App {appVersion}</Text>
          <Text style={styles.aboutMeta}>
            {t('app.plugin')} {manager.compatibility?.pluginVersion ?? t('common.unknown')}
            {manager.compatibility === null ? '' : ` · ${t('app.mobileApi')} ${manager.compatibility?.mobileApi ?? 0}`}
          </Text>
          <Text style={styles.featureText}>
            {manager.compatibility?.features.length
              ? manager.compatibility.features.join(' · ')
              : t('app.pluginFeaturesMissing')}
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.settingRow} onPress={() => setThemePickerOpen(true)}>
            <View style={styles.rowCopy}>
              <Text style={styles.settingLabel}>{t('app.theme')}：{themeLabel(themeMode, t)}</Text>
              <Text style={styles.settingHint}>{t('app.theme.chooseHint')}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>{t('app.language')}</Text>
        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.settingRow} onPress={() => setLanguagePickerOpen(true)}>
            <View style={styles.rowCopy}>
              <Text style={styles.settingLabel}>{t('app.language')}：{languageLabel(language, t)}</Text>
              <Text style={styles.settingHint}>{t('app.language')}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>{t('app.pluginSettings')}</Text>
        <View style={styles.sectionCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('inventory.title')}</Text>
            {inventory !== null && (
              <TouchableOpacity onPress={refreshInventory} disabled={inventoryLoading}>
                <Text style={styles.actionText}>{inventoryLoading ? t('common.loading') : t('inventory.refresh')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {inventory === undefined ? (
            <Text style={styles.metaText}>{t('inventory.loading')}</Text>
          ) : inventory === null ? (
            <Text style={styles.metaText}>{t('inventory.unavailable')}</Text>
          ) : inventory.entries.length === 0 ? (
            <Text style={styles.metaText}>{t('inventory.empty')}</Text>
          ) : inventory.entries.map(entry => (
            <View key={entry.entryId} style={styles.inventoryRow}>
              <Text style={styles.inventoryName} numberOfLines={1}>{entry.moduleName}</Text>
              <Text style={styles.metaText} numberOfLines={1}>
                {entry.enabled ? t('inventory.enabled') : t('inventory.disabled')}
                {' · '}
                {t(`inventory.phase.${entry.fiberPhase ?? 'none'}` as TranslationKey)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t('app.connectionSettings')}</Text>
        <View style={styles.sectionCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.metaText}>{t('diagnostics.state')}</Text>
            <Text style={styles.summaryValue}>{t(`connection.${connState === 'connecting' ? 'connectingState' : connState}` as TranslationKey)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.metaText}>{t('diagnostics.recentErrors')}</Text>
            <Text style={styles.summaryValue}>{errors.length}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.metaText}>{t('diagnostics.recentEvents')}</Text>
            <Text style={styles.summaryValue}>{events.length}</Text>
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={onOpenDiagnostics}>
            <Text style={styles.primaryButtonText}>{t('diagnostics.open')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.footerText}>dsh-mobile · {appVersion}</Text>
      </ScrollView>

      <Modal transparent visible={themePickerOpen} animationType="fade" onRequestClose={() => setThemePickerOpen(false)}>
        <ModalBackdrop onClose={() => setThemePickerOpen(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>{t('app.theme')}</Text>
            {(['light', 'dark', 'system'] as ThemeMode[]).map(mode => (
              <TouchableOpacity key={mode} style={styles.optionRow} onPress={() => { setTheme(mode); setThemePickerOpen(false) }}>
                <Text style={styles.optionText}>{themeLabel(mode, t)}</Text>
                <Text style={[styles.check, themeMode !== mode && styles.hidden]}>✓</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ModalBackdrop>
      </Modal>
      <Modal transparent visible={languagePickerOpen} animationType="fade" onRequestClose={() => setLanguagePickerOpen(false)}>
        <ModalBackdrop onClose={() => setLanguagePickerOpen(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>{t('app.language')}</Text>
            {(['system', 'zh', 'en'] as Language[]).map(mode => (
              <TouchableOpacity key={mode} style={styles.optionRow} onPress={() => { setLanguage(mode); setLanguagePickerOpen(false) }}>
                <Text style={styles.optionText}>{languageLabel(mode, t)}</Text>
                <Text style={[styles.check, language !== mode && styles.hidden]}>✓</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ModalBackdrop>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: { width: 42, height: 42, alignItems: 'flex-start', justifyContent: 'center' },
  backIcon: { color: colors.accent, fontSize: 34, lineHeight: 36, fontWeight: '300' },
  headerTitle: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  headerSpacer: { width: 42 },
  content: { padding: spacing(4), paddingBottom: spacing(8), gap: spacing(1) },
  aboutCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing(4),
    marginBottom: spacing(3),
  },
  aboutTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: spacing(1) },
  aboutMeta: { color: colors.textDim, fontSize: fontSize.small, lineHeight: 19 },
  featureText: { color: colors.textDim, fontSize: fontSize.tiny, lineHeight: 17, marginTop: spacing(2) },
  sectionTitle: { color: colors.textDim, fontSize: fontSize.tiny, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: spacing(2), marginBottom: spacing(1) },
  sectionCard: { backgroundColor: colors.bgElevated, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  settingRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowCopy: { flex: 1, gap: 2 },
  settingLabel: { color: colors.text, fontSize: fontSize.body, fontWeight: '500' },
  settingHint: { color: colors.textDim, fontSize: fontSize.tiny },
  chevron: { color: colors.textDim, fontSize: 24, marginLeft: spacing(2) },
  pickerCard: { backgroundColor: colors.bgElevated, borderRadius: radius.card, marginHorizontal: spacing(7), paddingVertical: spacing(2), overflow: 'hidden' },
  pickerTitle: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: spacing(5), paddingVertical: spacing(3) },
  optionRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(5), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  optionText: { color: colors.text, fontSize: fontSize.body },
  check: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  hidden: { opacity: 0 },
  cardHeader: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cardTitle: { color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  actionText: { color: colors.accent, fontSize: fontSize.small },
  metaText: { color: colors.textDim, fontSize: fontSize.small, lineHeight: 19 },
  inventoryRow: { paddingHorizontal: spacing(4), paddingVertical: spacing(2.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  inventoryName: { color: colors.text, fontSize: fontSize.small, fontWeight: '500', marginBottom: 2 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  summaryValue: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  primaryButton: { alignSelf: 'stretch', margin: spacing(3), backgroundColor: colors.accent, borderRadius: radius.card, alignItems: 'center', paddingVertical: spacing(2.5) },
  primaryButtonText: { color: '#fff', fontSize: fontSize.small, fontWeight: '700' },
  footerText: { color: colors.textDim, fontSize: fontSize.tiny, textAlign: 'center', marginTop: spacing(4) },
})
