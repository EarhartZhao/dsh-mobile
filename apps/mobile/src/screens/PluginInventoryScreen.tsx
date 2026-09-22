/**
 * Full plugin inventory, split out of settings: an instance can load dozens of
 * plugins, which made the settings page scroll far past everything else.
 * Reached from the settings summary row; back returns to settings.
 */
import React from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { MobileInventorySnapshot } from '@dsh-mobile/protocol'
import { useI18n, type TranslationKey } from '../i18n'
import { colors, fontSize, radius, spacing } from '../theme'

interface Props {
  inventory: MobileInventorySnapshot | null | undefined
  inventoryLoading: boolean
  refreshInventory: () => void
  /** Capabilities the bridge advertises; long enough to swamp the settings card. */
  features: string[]
  onBack: () => void
}

export function PluginInventoryScreen({
  inventory,
  inventoryLoading,
  refreshInventory,
  features,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useI18n()

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('plugins.title')}</Text>
        <TouchableOpacity
          style={styles.headerAction}
          onPress={refreshInventory}
          disabled={inventoryLoading || inventory === null}
          accessibilityRole="button"
        >
          <Text style={[styles.headerActionText, (inventoryLoading || inventory === null) && styles.disabled]}>
            {inventoryLoading ? t('common.loading') : t('inventory.refresh')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionCard}>
          {inventory === undefined ? (
            <Text style={styles.metaText}>{t('inventory.loading')}</Text>
          ) : inventory === null ? (
            <Text style={styles.metaText}>{t('inventory.unavailable')}</Text>
          ) : (
            <>
              <Text style={styles.metaText}>
                {inventory.managementAvailable === true
                  ? t('inventory.management.available')
                  : t('inventory.management.readonly')}
              </Text>
              {inventory.entries.length === 0
                ? <Text style={styles.metaText}>{t('inventory.empty')}</Text>
                : inventory.entries.map(entry => (
                  <View key={entry.entryId} style={styles.inventoryRow}>
                    <Text style={styles.inventoryName} numberOfLines={1}>{entry.moduleName}</Text>
                    <Text style={styles.metaText} numberOfLines={1}>
                      {entry.enabled ? t('inventory.enabled') : t('inventory.disabled')}
                      {' · '}
                      {t(`inventory.phase.${entry.fiberPhase ?? 'none'}` as TranslationKey)}
                    </Text>
                  </View>
                ))}
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>{t('plugins.capabilities')}</Text>
        <View style={styles.sectionCard}>
          {features.length === 0
            ? <Text style={styles.metaText}>{t('app.pluginFeaturesMissing')}</Text>
            : (
              <View style={styles.featureWrap}>
                {features.map(feature => (
                  <Text key={feature} style={styles.featureChip}>{feature}</Text>
                ))}
              </View>
            )}
        </View>
      </ScrollView>
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
  headerAction: { width: 72, alignItems: 'flex-end' },
  headerActionText: { color: colors.accent, fontSize: fontSize.small },
  disabled: { opacity: 0.4 },
  content: { padding: spacing(4), paddingBottom: spacing(8), gap: spacing(1) },
  sectionTitle: { color: colors.textDim, fontSize: fontSize.tiny, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: spacing(3), marginBottom: spacing(1) },
  sectionCard: { backgroundColor: colors.bgElevated, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden', padding: spacing(4), gap: spacing(1) },
  inventoryRow: { paddingVertical: spacing(1.5) },
  inventoryName: { color: colors.text, fontSize: fontSize.small, fontWeight: '500', marginBottom: 2 },
  metaText: { color: colors.textDim, fontSize: fontSize.small, lineHeight: 19 },
  featureWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1.5) },
  featureChip: { color: colors.textDim, fontSize: fontSize.tiny, backgroundColor: colors.bg, borderRadius: radius.card, paddingHorizontal: spacing(2), paddingVertical: spacing(0.75) },
})
