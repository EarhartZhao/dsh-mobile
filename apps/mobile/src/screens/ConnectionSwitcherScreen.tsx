/**
 * Every Hub this install has paired with, and which one is in use.
 *
 * Reached from the settings summary row; back returns to settings. Tapping a
 * row switches the app to it (the root rebuilds the connection), the pencil
 * renames it locally, and the row can be deleted after a confirmation. Adding
 * another machine is the scanner, one level further in.
 */
import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { TouchableOpacity } from '../components/Touchable'
import { ConfirmModal } from '../components/ConfirmModal'
import { profileTitle, type Profile } from '../pairing-store'
import { useI18n } from '../i18n'
import { colors, fontSize, radius, spacing } from '../theme'
import { Icon } from '../icons'

interface Props {
  profiles: Profile[]
  activeId: string | null
  onSwitch: (id: string) => void
  onRemove: (id: string) => void
  onRename: (id: string, label: string) => void
  onAdd: () => void
  onBack: () => void
}

/** `wss://hub.example:8443` reads better without its scheme in a subtitle. */
function shortHub(hub: string): string {
  return hub.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
}

export function ConnectionSwitcherScreen({
  profiles,
  activeId,
  onSwitch,
  onRemove,
  onRename,
  onAdd,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [pendingRemoval, setPendingRemoval] = useState<Profile | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startRename = (profile: Profile): void => {
    setRenaming(profile.id)
    // The default name is a fine starting point: the field edits the label,
    // and an empty one goes back to showing the machine's own name.
    setDraft(profile.label === '' ? profileTitle(profile) : profile.label)
  }

  const commitRename = (id: string): void => {
    onRename(id, draft)
    setRenaming(null)
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Icon name="ChevronLeftOutline" size={22} color={colors.accent} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('connections.title')}</Text>
        <TouchableOpacity style={styles.headerAction} onPress={onAdd} accessibilityRole="button" accessibilityLabel={t('connections.add')}>
          <Text style={styles.headerActionText}>{t('connections.add')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>{t('connections.saved')}</Text>
        <View style={styles.sectionCard}>
          {profiles.length === 0 ? (
            <Text style={styles.metaText}>{t('connections.empty')}</Text>
          ) : profiles.map(profile => {
            const active = profile.id === activeId
            return (
              <View key={profile.id} style={styles.row}>
                <TouchableOpacity
                  style={styles.rowMain}
                  onPress={() => onSwitch(profile.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${profileTitle(profile)} ${active ? t('connections.current') : t('connections.switch')}`}
                >
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {active ? '● ' : ''}{profileTitle(profile)}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {shortHub(profile.hub)} · {profile.instance}
                    {active ? ` · ${t('connections.current')}` : ''}
                  </Text>
                </TouchableOpacity>
                {renaming === profile.id ? (
                  <TextInput
                    style={styles.renameInput}
                    value={draft}
                    onChangeText={setDraft}
                    autoFocus
                    placeholder={profile.instance}
                    placeholderTextColor={colors.textDim}
                    onSubmitEditing={() => commitRename(profile.id)}
                    onBlur={() => commitRename(profile.id)}
                    accessibilityLabel={t('connections.rename')}
                  />
                ) : (
                  <>
                    <TouchableOpacity style={styles.rowAction} onPress={() => startRename(profile)} accessibilityRole="button" accessibilityLabel={`${t('connections.rename')}: ${profileTitle(profile)}`}>
                      <Text style={styles.rowActionText}>{t('connections.rename')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rowAction} onPress={() => setPendingRemoval(profile)} accessibilityRole="button" accessibilityLabel={`${t('connections.remove')}: ${profileTitle(profile)}`}>
                      <Text style={[styles.rowActionText, styles.dangerText]}>{t('connections.remove')}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )
          })}
        </View>

        <Text style={styles.sectionTitle}>{t('connections.howTo')}</Text>
        <View style={styles.sectionCard}>
          <Text style={styles.metaText}>{t('connections.hint')}</Text>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={pendingRemoval !== null}
        title={t('connections.removeConfirmTitle')}
        message={t('connections.removeConfirmMessage', { name: pendingRemoval === null ? '' : profileTitle(pendingRemoval) })}
        confirmLabel={t('connections.removeConfirmAction')}
        cancelLabel={t('common.cancel')}
        danger
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          const target = pendingRemoval
          setPendingRemoval(null)
          if (target !== null) onRemove(target.id)
        }}
      />
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
  headerTitle: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  headerAction: { width: 72, alignItems: 'flex-end' },
  headerActionText: { color: colors.accent, fontSize: fontSize.small },
  content: { padding: spacing(4), paddingBottom: spacing(8), gap: spacing(1) },
  sectionTitle: { color: colors.textDim, fontSize: fontSize.tiny, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: spacing(3), marginBottom: spacing(1) },
  sectionCard: { backgroundColor: colors.bgElevated, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), gap: spacing(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.body, fontWeight: '500', marginBottom: 2 },
  rowMeta: { color: colors.textDim, fontSize: fontSize.tiny },
  rowAction: { paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  rowActionText: { color: colors.accent, fontSize: fontSize.small },
  dangerText: { color: colors.danger },
  renameInput: { flex: 1, color: colors.text, fontSize: fontSize.small, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.accent, paddingVertical: spacing(0.5) },
  metaText: { color: colors.textDim, fontSize: fontSize.small, lineHeight: 19, padding: spacing(4) },
})
