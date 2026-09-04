/** Mobile composer plus-menu: commands, attachments, references, and controls. */
import React, { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { colors, fontSize, radius, spacing } from '../theme'
import { ModalBackdrop } from './ModalBackdrop'
import { useI18n } from '../i18n'

export interface PlusCommand {
  name: string
  description: string
  hint?: string
  images?: boolean
}

export interface PlusPreset {
  id: string
  name?: string
  description?: string
}

export interface PlusReference {
  key: string
  title: string
  subtitle?: string
  insert: string
}

export type PlusMenuStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface Props {
  visible: boolean
  commands: PlusCommand[]
  commandStatus: PlusMenuStatus
  commandError: string
  onReloadCommands: () => void
  presets: PlusPreset[]
  presetStatus: PlusMenuStatus
  presetError: string
  references: PlusReference[]
  referenceStatus: PlusMenuStatus
  permissions: { value: string; name: string; description?: string }[]
  permissionValue?: string
  planActive: boolean
  hasGoal: boolean
  modelLabel: string
  presetLabel?: string
  pendingImageCount: number
  onClose: () => void
  onPickCommand: (command: PlusCommand, argument?: string) => void
  onCaptureImage: () => void
  onPickImages: () => void
  onInsertReference: (reference: PlusReference) => void
  onPermission: (value: string) => void
  onTogglePlan: () => void
  onGoal: () => void
  onModel: () => void
  onPresets: () => void
  onSelectPreset: (preset: PlusPreset) => void
  onSubagents: () => void
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }): React.JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action !== undefined && (
        <TouchableOpacity onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></TouchableOpacity>
      )}
    </View>
  )
}

function StatusLine({ status, error, onRetry }: { status: PlusMenuStatus; error: string; onRetry: () => void }): React.JSX.Element | null {
  const { t } = useI18n()
  if (status === 'loading') return <Text style={styles.meta}>{t('common.loading')}</Text>
  if (status === 'failed') {
    return (
      <View style={styles.failedRow}>
        <Text style={styles.error}>{error === '' ? t('plus.loadFailed') : error}</Text>
        <TouchableOpacity onPress={onRetry}><Text style={styles.retry}>{t('common.retry')}</Text></TouchableOpacity>
      </View>
    )
  }
  return null
}

export function PlusMenuSheet(props: Props): React.JSX.Element {
  const { t } = useI18n()
  const [tab, setTab] = useState<'commands' | 'attachments' | 'references' | 'controls'>('commands')
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (props.visible) setQuery('')
  }, [props.visible])

  const filteredCommands = props.commands.filter(command =>
    command.name.toLowerCase().includes(query.toLowerCase()) ||
    command.description.toLowerCase().includes(query.toLowerCase()))
  const filteredReferences = props.references.filter(reference =>
    reference.title.toLowerCase().includes(query.toLowerCase()) ||
    (reference.subtitle ?? '').toLowerCase().includes(query.toLowerCase()))

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <ModalBackdrop onClose={props.onClose} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{t('plus.title')}</Text>
            <TouchableOpacity onPress={props.onClose}><Text style={styles.close}>{t('common.close')}</Text></TouchableOpacity>
          </View>
          <View style={styles.tabs}>
            {(['commands', 'attachments', 'references', 'controls'] as const).map(value => (
              <TouchableOpacity
                key={value}
                style={[styles.tab, tab === value && styles.tabActive]}
                onPress={() => setTab(value)}
              >
                <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
                  {value === 'commands' ? t('plus.tab.commands') : value === 'attachments' ? t('plus.tab.attachments') : value === 'references' ? t('plus.tab.references') : t('plus.tab.controls')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {tab === 'commands' && (
              <>
                <TextInput
                  style={styles.search}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('plus.searchCommands')}
                  placeholderTextColor={colors.textDim}
                />
                <StatusLine status={props.commandStatus} error={props.commandError} onRetry={() => props.onReloadCommands()} />
                {props.commandStatus === 'ready' && props.commandError !== '' && (
                  <Text style={styles.itemWarning}>{props.commandError}</Text>
                )}
                {props.commandStatus === 'ready' && filteredCommands.length === 0 && (
                  <Text style={styles.meta}>{t('plus.noCommands')}</Text>
                )}
                {filteredCommands.map(command => (
                  <TouchableOpacity
                    key={command.name}
                    style={styles.item}
                    disabled={props.pendingImageCount > 0 && command.images !== true}
                    onPress={() => props.onPickCommand(command)}
                  >
                    <Text style={styles.itemTitle}>/{command.name}</Text>
                    <Text style={styles.itemSubtitle} numberOfLines={2}>{command.description}</Text>
                    {props.pendingImageCount > 0 && command.images !== true && (
                      <Text style={styles.itemWarning}>{t('plus.commandRejectsImages')}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}
            {tab === 'attachments' && (
              <>
                <TouchableOpacity style={styles.item} onPress={props.onCaptureImage}>
                  <Text style={styles.itemTitle}>{t('plus.capture')}</Text>
                  <Text style={styles.itemSubtitle}>{t('plus.captureSubtitle')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.item} onPress={props.onPickImages}>
                  <Text style={styles.itemTitle}>{t('plus.pickImages')}</Text>
                  <Text style={styles.itemSubtitle}>{t('plus.pickImagesSubtitle')}</Text>
                </TouchableOpacity>
                {props.pendingImageCount > 0 && (
                  <Text style={styles.meta}>{t('plus.imagesSelected', { count: props.pendingImageCount })}</Text>
                )}
              </>
            )}
            {tab === 'references' && (
              <>
                <StatusLine status={props.referenceStatus} error={props.referenceStatus === 'failed' ? t('plus.referencesFailed') : ''} onRetry={props.onReloadCommands} />
                {filteredReferences.length === 0 && props.referenceStatus === 'ready' && (
                  <Text style={styles.meta}>{t('plus.noReferences')}</Text>
                )}
                {filteredReferences.map(reference => (
                  <TouchableOpacity key={reference.key} style={styles.item} onPress={() => props.onInsertReference(reference)}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{reference.title}</Text>
                    {reference.subtitle !== undefined && <Text style={styles.itemSubtitle} numberOfLines={1}>{reference.subtitle}</Text>}
                  </TouchableOpacity>
                ))}
              </>
            )}
            {tab === 'controls' && (
              <>
                <TouchableOpacity style={styles.item} onPress={props.onModel}>
                  <Text style={styles.itemTitle}>{t('plus.model')}</Text>
                  <Text style={styles.itemSubtitle}>{`${t('common.current')} ${props.modelLabel}`}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.item} onPress={props.onTogglePlan}>
                  <Text style={styles.itemTitle}>{props.planActive ? t('plus.planOff') : t('plus.planOn')}</Text>
                  <Text style={styles.itemSubtitle}>{t('plus.planSubtitle')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.item} onPress={props.onGoal}>
                  <Text style={styles.itemTitle}>{props.hasGoal ? t('plus.goalEdit') : t('plus.goalCreate')}</Text>
                  <Text style={styles.itemSubtitle}>{t('plus.goalSubtitle')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.item} onPress={props.onPresets}>
                  <Text style={styles.itemTitle}>{t('plus.agentPresets')}</Text>
                  <Text style={styles.itemSubtitle}>{props.presetLabel === undefined ? t('plus.noPreset') : props.presetLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.item} onPress={props.onSubagents}>
                  <Text style={styles.itemTitle}>{t('plus.subagents')}</Text>
                  <Text style={styles.itemSubtitle}>{t('plus.subagentsSubtitle')}</Text>
                </TouchableOpacity>
                {props.permissions.length > 0 && (
                  <>
                    <SectionHeader title={t('plus.permissionPresets')} />
                    {props.permissions.map(permission => {
                      const active = permission.value === props.permissionValue
                      const danger = permission.value === 'danger-full-access'
                      return (
                        <TouchableOpacity
                          key={permission.value}
                          style={[styles.item, active && styles.itemActive]}
                          disabled={active}
                          onPress={() => props.onPermission(permission.value)}
                        >
                          <Text style={[styles.itemTitle, danger && styles.danger]}>{permission.name}</Text>
                          {permission.description !== undefined && <Text style={styles.itemSubtitle}>{permission.description}</Text>}
                          {active && <Text style={styles.meta}>{t('common.current')}</Text>}
                        </TouchableOpacity>
                      )
                    })}
                  </>
                )}
                {props.presets.length > 0 && (
                  <>
                    <SectionHeader title="Agent presets" />
                    <StatusLine status={props.presetStatus} error={props.presetError} onRetry={props.onPresets} />
                    {props.presets.map(preset => (
                      <TouchableOpacity key={preset.id} style={styles.item} onPress={() => props.onSelectPreset(preset)}>
                        <Text style={styles.itemTitle}>{preset.name ?? preset.id}</Text>
                        {preset.description !== undefined && <Text style={styles.itemSubtitle} numberOfLines={2}>{preset.description}</Text>}
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </ModalBackdrop>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    height: '50%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    maxHeight: '82%',
    paddingBottom: spacing(3),
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing(2) },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  close: { color: colors.accent, fontSize: fontSize.small },
  tabs: { flexDirection: 'row', gap: spacing(2), paddingHorizontal: spacing(3), paddingBottom: spacing(2) },
  tab: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    alignItems: 'center',
    paddingVertical: spacing(1.5),
  },
  tabActive: { borderColor: colors.accent, backgroundColor: colors.bgBubbleUser },
  tabText: { color: colors.textDim, fontSize: fontSize.small },
  tabTextActive: { color: colors.accent, fontWeight: '600' },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing(3), paddingBottom: spacing(3), gap: spacing(1) },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    color: colors.text,
    fontSize: fontSize.small,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    marginBottom: spacing(1),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(2),
  },
  sectionTitle: { color: colors.textDim, fontSize: fontSize.tiny, fontWeight: '600' },
  sectionAction: { color: colors.accent, fontSize: fontSize.tiny },
  item: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing(2.5),
    gap: spacing(1),
  },
  itemActive: { borderColor: colors.accent, backgroundColor: colors.bgBubbleUser },
  itemTitle: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  itemSubtitle: { color: colors.textDim, fontSize: fontSize.tiny },
  itemWarning: { color: colors.warning, fontSize: fontSize.tiny },
  meta: { color: colors.textDim, fontSize: fontSize.tiny },
  failedRow: { flexDirection: 'row', gap: spacing(2), alignItems: 'center' },
  error: { flex: 1, color: colors.danger, fontSize: fontSize.tiny },
  retry: { color: colors.accent, fontSize: fontSize.small },
  danger: { color: colors.danger },
})
