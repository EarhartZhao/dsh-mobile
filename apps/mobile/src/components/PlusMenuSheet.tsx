/**
 * Mobile composer plus-menu: commands, attachments and references.
 *
 * The Web's composer reaches the model, plan, goal, subagent and permission
 * surfaces through its own control row and header; this sheet used to mirror
 * them in a fourth tab, which left two doors to the same switch. They live
 * only on the composer row and in the conversation menu now.
 */
import React, { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { TouchableOpacity } from './Touchable'
import { colors, fontSize, radius, spacing } from '../theme'
import { ModalBackdrop } from './ModalBackdrop'
import { useI18n } from '../i18n'

export interface PlusCommand {
  name: string
  description: string
  hint?: string
  images?: boolean
}

export interface PlusReference {
  key: string
  title: string
  subtitle?: string
  /** Source path a current host reports beside the entry (e.g. a skill's SKILL.md). */
  meta?: string
  insert: string
}

export type PlusMenuStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** One tab of the sheet; the composer's `/` and `@` triggers pick a start tab. */
export type PlusTab = 'commands' | 'attachments' | 'references'

interface Props {
  visible: boolean
  /** Tab to open on, and the query to seed its search with, for a typed trigger. */
  initialTab?: PlusTab
  initialQuery?: string
  commands: PlusCommand[]
  commandStatus: PlusMenuStatus
  commandError: string
  onReloadCommands: () => void
  references: PlusReference[]
  referenceStatus: PlusMenuStatus
  onReloadReferences: () => void
  /**
   * A tab the reader switched to by hand. The sheet owns which tab is showing,
   * but only the screen knows how to fill it: opening on `commands` does not
   * fetch references, so the switch has to be reported or the tab stays blank.
   */
  onTabChange?: (tab: PlusTab) => void
  pendingImageCount: number
  pendingFileCount: number
  uploadingFileCount: number
  onClose: () => void
  onPickCommand: (command: PlusCommand, argument?: string) => void
  onCaptureImage: () => void
  onPickImages: () => void
  onPickFile: () => void
  onInsertReference: (reference: PlusReference) => void
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
  const [tab, setTab] = useState<PlusTab>('commands')
  const [query, setQuery] = useState('')
  // Seeded on each open, and only then: a trigger's own text is where the
  // search starts, while the search box the user then types in owns the query.
  useEffect(() => {
    if (!props.visible) return
    setQuery(props.initialQuery ?? '')
    if (props.initialTab !== undefined) setTab(props.initialTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-time seed, not a live binding
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
            {(['commands', 'attachments', 'references'] as const).map(value => (
              <TouchableOpacity
                key={value}
                style={[styles.tab, tab === value && styles.tabActive]}
                onPress={() => {
                  setTab(value)
                  if (value !== tab) props.onTabChange?.(value)
                }}
              >
                <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
                  {value === 'commands' ? t('plus.tab.commands') : value === 'attachments' ? t('plus.tab.attachments') : t('plus.tab.references')}
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
                <TouchableOpacity style={styles.item} onPress={props.onPickFile}>
                  <Text style={styles.itemTitle}>{t('plus.pickFile')}</Text>
                  <Text style={styles.itemSubtitle}>{t('plus.pickFileSubtitle')}</Text>
                </TouchableOpacity>
                {props.pendingImageCount > 0 && (
                  <Text style={styles.meta}>{t('plus.imagesSelected', { count: props.pendingImageCount })}</Text>
                )}
                {props.pendingFileCount > 0 && (
                  <Text style={styles.meta}>{t('plus.filesSelected', { count: props.pendingFileCount })}</Text>
                )}
                {props.uploadingFileCount > 0 && (
                  <Text style={styles.meta}>{t('plus.filesUploading', { count: props.uploadingFileCount })}</Text>
                )}
              </>
            )}
            {tab === 'references' && (
              <>
                <TextInput
                  style={styles.search}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('plus.searchReferences')}
                  placeholderTextColor={colors.textDim}
                />
                <StatusLine status={props.referenceStatus} error={props.referenceStatus === 'failed' ? t('plus.referencesFailed') : ''} onRetry={props.onReloadReferences} />
                {filteredReferences.length === 0 && props.referenceStatus === 'ready' && (
                  <Text style={styles.meta}>{t('plus.noReferences')}</Text>
                )}
                {filteredReferences.map(reference => (
                  <TouchableOpacity key={reference.key} style={styles.item} onPress={() => props.onInsertReference(reference)}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{reference.title}</Text>
                  {reference.subtitle !== undefined && <Text style={styles.itemSubtitle} numberOfLines={1}>{reference.subtitle}</Text>}
                  {reference.meta !== undefined && <Text style={styles.itemMeta} numberOfLines={1}>{reference.meta}</Text>}
                  </TouchableOpacity>
                ))}
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
  item: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing(2.5),
    gap: spacing(1),
  },
  itemTitle: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  itemSubtitle: { color: colors.textDim, fontSize: fontSize.tiny },
  itemMeta: { color: colors.textDim, fontSize: fontSize.tiny, opacity: 0.7 },
  itemWarning: { color: colors.warning, fontSize: fontSize.tiny },
  meta: { color: colors.textDim, fontSize: fontSize.tiny },
  failedRow: { flexDirection: 'row', gap: spacing(2), alignItems: 'center' },
  error: { flex: 1, color: colors.danger, fontSize: fontSize.tiny },
  retry: { color: colors.accent, fontSize: fontSize.small },
})
