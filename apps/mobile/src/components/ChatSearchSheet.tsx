/** In-conversation search and jump-to-message sheet. */
import React, { useEffect, useMemo, useState } from 'react'
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import type { ConversationItem } from '@dsh-mobile/core'
import { ModalBackdrop } from './ModalBackdrop'
import { colors, fontSize, radius, spacing } from '../theme'
import { useI18n, type TranslationKey } from '../i18n'

interface SearchHit {
  key: string
  index: number
  title: string
  snippet: string
}

function searchableText(item: ConversationItem): string {
  switch (item.kind) {
    case 'user':
    case 'assistant':
    case 'stream':
      return `${item.text}\n${item.kind === 'assistant' || item.kind === 'stream' ? item.reasoning : ''}`
    case 'tool':
      return `${item.name}\n${item.args}\n${item.resultText}`
    case 'compaction':
      return item.summary
  }
}

function titleOf(item: ConversationItem, t: (key: TranslationKey, values?: Record<string, string | number>) => string): string {
  switch (item.kind) {
    case 'user': return t('search.userMessage')
    case 'assistant': return item.interrupted ? t('search.assistantInterrupted') : t('search.assistantMessage')
    case 'tool': return t('search.toolCall', { name: item.name })
    case 'stream': return t('search.generating')
    case 'compaction': return t('search.compaction')
  }
}

function snippetOf(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (query === '') return normalized.slice(0, 140)
  const at = normalized.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return normalized.slice(0, 140)
  const start = Math.max(0, at - 40)
  return `${start > 0 ? '…' : ''}${normalized.slice(start, start + 140)}${start + 140 < normalized.length ? '…' : ''}`
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

function searchItems(items: ConversationItem[], query: string, t: Translate): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  return items.map((item, index) => ({ item, index })).flatMap(({ item, index }) => {
    const haystack = searchableText(item)
    if (!haystack.toLowerCase().includes(q)) return []
    return [{
      key: item.key,
      index,
      title: titleOf(item, t),
      snippet: snippetOf(haystack, q),
    }]
  })
}

export function ChatSearchSheet({ visible, items, onClose, onJump }: {
  visible: boolean
  items: ConversationItem[]
  onClose: () => void
  onJump: (item: ConversationItem) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  useEffect(() => { if (visible) setQuery('') }, [visible])
  const hits = useMemo(() => searchItems(items, query, t), [items, query, t])
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalBackdrop onClose={onClose} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{t('search.title')}</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>{t('common.close')}</Text></TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.textDim}
            autoFocus
            autoCorrect={false}
          />
          <FlatList
            style={styles.list}
            data={hits}
            keyExtractor={hit => hit.key}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={(
              <Text style={styles.empty}>{query.trim() === '' ? t('search.emptyPrompt') : t('search.empty')}</Text>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.hit} onPress={() => {
                const target = items[item.index]
                if (target !== undefined) onJump(target)
                onClose()
              }}>
                <View style={styles.hitHeader}>
                  <Text style={styles.hitTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.hitIndex}>#{item.index + 1}</Text>
                </View>
                <Text style={styles.hitSnippet} numberOfLines={3}>{item.snippet}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </ModalBackdrop>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { justifyContent: 'flex-end' },
  sheet: {
    height: '55%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingBottom: spacing(3),
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing(2) },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
  title: { color: colors.text, fontSize: fontSize.body, fontWeight: '700' },
  close: { color: colors.accent, fontSize: fontSize.small },
  input: {
    marginHorizontal: spacing(3),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    color: colors.text,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    fontSize: fontSize.small,
  },
  list: { marginTop: spacing(2), paddingHorizontal: spacing(3) },
  empty: { color: colors.textDim, fontSize: fontSize.small, textAlign: 'center', marginTop: spacing(4) },
  hit: { paddingVertical: spacing(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  hitHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing(2) },
  hitTitle: { color: colors.text, fontSize: fontSize.small, fontWeight: '600', flex: 1 },
  hitIndex: { color: colors.textDim, fontSize: fontSize.tiny },
  hitSnippet: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: spacing(1) },
})
