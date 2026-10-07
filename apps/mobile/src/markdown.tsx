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
import { chat, fontSize, radius, spacing } from './theme'
import { useI18n } from './i18n'
import { Icon } from './icons'

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
          <TouchableOpacity
            onPress={() => void Clipboard.setString(content)}
            accessibilityRole="button"
            accessibilityLabel={t('common.copy')}
            hitSlop={6}
          >
            <Icon name="CopyOutline" size={14} color={chat.link} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { void Share.share({ message: content }) }}
            accessibilityRole="button"
            accessibilityLabel={t('common.share')}
            hitSlop={6}
          >
            <Icon name="ShareOutline" size={14} color={chat.link} />
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

/**
 * Rules for a document opened to be read, adding native text selection.
 *
 * The renderer's own text nodes are plain `<Text>`, which on Android ignores a
 * long press — so a previewed `.md` could not be selected or copied, while the
 * plain-text preview beside it could. The chat deliberately stays without
 * selection: a long press there opens the message action sheet (copy / share /
 * branch), and a selectable body would swallow that gesture. A reader is the
 * opposite case, so the two surfaces share the look and differ on this one
 * behaviour.
 */
export const markdownPreviewRules = {
  ...markdownRules,
  textgroup: (
    node: { key: string },
    children: React.ReactNode,
    _parent: unknown,
    styles: Record<string, object>,
  ): React.JSX.Element => (
    <Text key={node.key} selectable style={styles.textgroup}>{children}</Text>
  ),
  text: (
    node: { key: string; content: string },
    _children: React.ReactNode,
    _parent: unknown,
    styles: Record<string, object>,
    inheritedStyles: object = {},
  ): React.JSX.Element => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.text]}>{node.content}</Text>
  ),
}

/** Typography shared by every Markdown surface. */
export const markdownStyles = StyleSheet.create({
  // The web's assistant flow body: 14/24 with a 16px block gap, which is the
  // same ladder a previewed `.md` reads at.
  body: { color: chat.labelPrimary, fontSize: 14, lineHeight: 24 },
  paragraph: { marginTop: 0, marginBottom: 16 },
  strong: { color: chat.labelPrimary, fontWeight: '700' },
  em: { fontStyle: 'italic' },
  link: { color: chat.link },
  heading1: { color: chat.labelPrimary, fontSize: 20, lineHeight: 28, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  heading2: { color: chat.labelPrimary, fontSize: 17, lineHeight: 24, fontWeight: '700', marginTop: 8, marginBottom: 6 },
  heading3: { color: chat.labelPrimary, fontSize: 15, lineHeight: 22, fontWeight: '600', marginTop: 6, marginBottom: 4 },
  code_inline: {
    color: chat.labelPrimary,
    backgroundColor: chat.inlineCode,
    fontSize: fontSize.small,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fence: {
    backgroundColor: chat.codeBlock,
    borderColor: chat.borderL2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing(2),
    marginVertical: spacing(1.5),
  },
  code: { color: chat.labelPrimary, fontSize: fontSize.small, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  bullet_list_icon: { color: chat.labelTertiary },
  ordered_list_content: { color: chat.labelPrimary, fontSize: 14, lineHeight: 24 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: chat.borderL3, paddingLeft: spacing(3), marginVertical: 8 },
  hr: { backgroundColor: chat.borderL2 },
})

const codeStyles = StyleSheet.create({
  block: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chat.borderL2,
    borderRadius: radius.md,
    backgroundColor: chat.codeBlock,
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
    borderBottomColor: chat.borderL2,
    backgroundColor: chat.codeBlock,
  },
  language: { color: chat.labelTertiary, fontSize: fontSize.tiny },
  actions: { flexDirection: 'row', gap: spacing(3) },
  code: {
    minWidth: '100%',
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(2),
    color: chat.labelPrimary,
    fontSize: fontSize.small,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
})
