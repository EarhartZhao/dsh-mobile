/** Input-trigger candidate menu (/ skills, @ files+sessions) above the composer. */
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { colors, fontSize, spacing } from '../theme'

export interface Candidate {
  key: string
  title: string
  subtitle?: string
  insert: string
}

export function CandidateMenu({ items, onPick }: {
  items: Candidate[]
  onPick: (candidate: Candidate) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <View style={styles.panel}>
      {items.slice(0, 8).map(item => (
        <TouchableOpacity key={item.key} style={styles.row} onPress={() => onPick(item)}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          {item.subtitle !== undefined && item.subtitle !== '' && (
            <Text style={styles.subtitle} numberOfLines={1}>{item.subtitle}</Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: 240,
  },
  row: { paddingHorizontal: spacing(4), paddingVertical: spacing(2.5) },
  title: { color: colors.text, fontSize: fontSize.small },
  subtitle: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 1 },
})
