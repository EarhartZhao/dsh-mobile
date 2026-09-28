/**
 * The one Markdown look this app renders: chat bubbles and the file preview
 * share it, so a `.md` opened from a tool result reads exactly like the message
 * that cited it.
 *
 * The renderer is `react-native-markdown-display`; the rules below only replace
 * fenced code with a panel that carries its own copy/share affordances. Links are
 * handled by the caller through `onLinkPress` (see `link-targets.ts`), because
 * what a link *means* depends on the surface it was tapped from.
 */
import React from 'react'
import { Clipboard, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { colors, fontSize, radius, spacing } from './theme'
import { useI18n } from './i18n'

/** Fenced code block: language chip, copy/share, horizontal scroll. */
export function CodeBlock({ node }: { node: { content: string; attributes?: unknown } }): React.JSX.Element {
  const { t } = useI18n()
  const content = node.content.endsWith('\n') ? node.content.slice(0, -1) : node.content
  const attributes = typeof node.attributes === 'object' && node.attributes !== null
    ? node.attributes as { info?: unknown }
    : {}
  const language = typeof attributes.info === 'string' && attributes.info !== ''
    ? attributes.info.split(/\s+/)[0]
    : t('chat.code')
  return (
    <View style={codeStyles.block}>
      <View style={codeStyles.header}>
        <Text style={codeStyles.language}>{language}</Text>
        <View style={codeStyles.actions}>
          <TouchableOpacity onPress={() => void Clipboard.setString(content)}>
            <Text style={codeStyles.action}>{t('common.copy')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { void Share.share({ message: content }) }}>
            <Text style={codeStyles.action}>{t('common.share')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal nestedScrollEnabled>
        <Text selectable style={codeStyles.code}>{content}</Text>
      </ScrollView>
    </View>
  )
}

/** Rules shared by every Markdown surface. */
export const markdownRules = {
  code_block: (node: { key: string; content: string; attributes?: unknown }): React.JSX.Element => (
    <CodeBlock key={node.key} node={node} />
  ),
  fence: (node: { key: string; content: string; attributes?: unknown }): React.JSX.Element => (
    <CodeBlock key={node.key} node={node} />
  ),
}

/** Typography shared by every Markdown surface. */
export const markdownStyles = StyleSheet.create({
  body: { color: colors.text, fontSize: fontSize.body, lineHeight: 22 },
  strong: { color: colors.text, fontWeight: '700' },
  em: { fontStyle: 'italic' },
  link: { color: colors.accent },
  heading1: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  heading2: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  heading3: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 6, marginBottom: 3 },
  code_inline: {
    color: colors.accent,
    backgroundColor: colors.bg,
    fontSize: fontSize.small,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fence: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing(2),
    marginVertical: spacing(1.5),
  },
  code: { color: colors.text, fontSize: fontSize.small, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  bullet_list_icon: { color: colors.textDim },
  ordered_list_content: { color: colors.text, fontSize: fontSize.body },
  blockquote: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing(2), backgroundColor: colors.bg },
  hr: { backgroundColor: colors.border },
})

const codeStyles = StyleSheet.create({
  block: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.bg,
    marginVertical: spacing(2),
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  language: { color: colors.textDim, fontSize: fontSize.tiny },
  actions: { flexDirection: 'row', gap: spacing(3) },
  action: { color: colors.accent, fontSize: fontSize.tiny },
  code: {
    minWidth: '100%',
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(2),
    color: colors.text,
    fontSize: fontSize.small,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
})
