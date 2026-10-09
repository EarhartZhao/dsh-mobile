/**
 * One trajectory record, in full — the Web's inspector as a page of its own.
 *
 * The Web keeps the record it is inspecting in a panel beside the ledger, and
 * the phone has no beside: tapping a row pushes this page instead. Everything
 * the projection holds is printed here and nothing is truncated — the record's
 * own body, every labelled block (a call's parameters, its result, the schema
 * the model was shown, an unknown event's raw payload) and the sub-tool calls
 * it owns, each with its own body and blocks.
 *
 * It re-derives the same projection the list does and looks its record up by
 * `#N`, so the two can never disagree, and so the page keeps reading correctly
 * if the log grows under it while it is open.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  deriveConversation,
  groupTurns,
  type ConnectionManager,
  type Turn,
} from '@dsh-mobile/core'
import { useI18n } from '../i18n'
import { colors, chat, fontSize, spacing } from '../theme'
import { Icon } from '../icons'
import { TouchableOpacity } from '../components/Touchable'
import { formatTokenCount } from '../ui-labels'
import {
  projectTrajectory,
  trajectoryRecordByIndex,
  type TrajectoryRecord,
  type Translate,
} from '../trajectory-model'

interface Props {
  manager: ConnectionManager
  sessionId: string
  /** The `#N` of the record to show. */
  index: number
  onBack: () => void
}

export function TrajectoryRecordScreen({ manager, sessionId, index, onBack }: Props): React.JSX.Element {
  const { locale, t } = useI18n()
  const [turns, setTurns] = useState<Turn[]>([])

  /** The same live fold the list reads, so the record stays current. */
  useEffect(() => {
    let alive = true
    let pending = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = (): void => {
      const session = manager.store.sessions.get(sessionId)
      if (session === undefined) {
        setTurns([])
        return
      }
      setTurns(groupTurns(deriveConversation(session, {
        running: session.runningKnown ? session.running : undefined,
      })))
    }
    const off = manager.store.on('changed', ({ sessionId: changed }) => {
      if (changed !== undefined && changed !== sessionId) return
      if (pending) return
      pending = true
      timer = setTimeout(() => {
        timer = null
        pending = false
        if (alive) apply()
      }, 50)
    })
    apply()
    return () => {
      alive = false
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [manager, sessionId])

  const model = useMemo(() => projectTrajectory(turns, t), [turns, t])
  const record = useMemo(() => trajectoryRecordByIndex(model, index), [model, index])

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.back}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('chat.back')}
        >
          <Icon name="ChevronLeftOutline" size={22} color={colors.accent} />
          <Text style={styles.backLabel}>{t('chat.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {t('trajectory.record.title', { index })}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {record === undefined
          ? <Text style={styles.empty}>{t('trajectory.record.missing')}</Text>
          : <RecordDetail record={record} locale={locale} t={t} />}
      </ScrollView>
    </View>
  )
}

/** Everything one record holds, laid out the way the inspector stacks it. */
function RecordDetail({ record, locale, t }: {
  record: TrajectoryRecord
  locale: string
  t: Translate
}): React.JSX.Element {
  return (
    <View>
      <View style={styles.heading}>
        <Text style={styles.badge}>{record.badge}</Text>
        <Text style={styles.headingTitle}>{record.title}</Text>
        {record.status !== undefined && <StatusDot status={record.status} />}
      </View>
      <View style={styles.facts}>
        <Fact label={t('trajectory.record.field.turn')} value={
          record.turn === null
            ? t('trajectory.record.betweenTurns')
            : t('trajectory.turn', { turn: record.turn })
        } />
        <Fact label={t('trajectory.record.field.group')} value={record.group} />
        <Fact label={t('trajectory.record.field.kind')} value={record.badge} />
        {record.status !== undefined && (
          <Fact label={t('trajectory.record.field.status')} value={statusLabel(record.status, t)} />
        )}
        {record.time > 0 && (
          <Fact
            label={t('trajectory.record.field.time')}
            value={new Date(record.time).toLocaleString(locale, { hour12: false })}
          />
        )}
        {record.startedAt !== undefined && (
          <Fact
            label={t('trajectory.record.field.started')}
            value={new Date(record.startedAt).toLocaleString(locale, { hour12: false })}
          />
        )}
        {record.endedAt !== undefined && (
          <Fact
            label={t('trajectory.record.field.ended')}
            value={new Date(record.endedAt).toLocaleString(locale, { hour12: false })}
          />
        )}
        {record.durationMs !== undefined && (
          <Fact
            label={t('trajectory.record.field.duration')}
            value={t('trajectory.duration.ms', { value: grouped(record.durationMs) })}
          />
        )}
        {record.metrics !== undefined && (
          <Fact label={t('trajectory.record.field.usage')} value={metricLine(record.metrics, t)} />
        )}
      </View>
      {record.body !== undefined && record.body !== '' && (
        <Block label={t('trajectory.record.body')} text={record.body} />
      )}
      {record.sections.map(section => (
        <Block key={section.label} label={section.label} text={section.text} mono />
      ))}
      {record.children.length > 0 && (
        <View style={styles.children}>
          <Text style={styles.childrenTitle}>
            {t('trajectory.record.children')}
            {t('chat.step.separator')}
            {t('trajectory.subtools', { count: record.children.length })}
          </Text>
          {record.children.map(child => (
            <View key={child.key} style={styles.child}>
              <View style={styles.heading}>
                <Text style={styles.index}>#{child.index}</Text>
                <Text style={styles.badge}>{child.badge}</Text>
                <Text style={styles.childTitle}>{child.title}</Text>
                {child.status !== undefined && <StatusDot status={child.status} />}
                <Text style={styles.childMeta} numberOfLines={1}>{child.meta}</Text>
              </View>
              {child.body !== undefined && child.body !== '' && (
                <Block label={t('trajectory.record.body')} text={child.body} />
              )}
              {child.sections.map(section => (
                <Block key={section.label} label={section.label} text={section.text} mono />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

/** One label/value line of the record's own facts. */
function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} selectable>{value}</Text>
    </View>
  )
}

/** One labelled block: a record's body, or one of its captured payloads. */
function Block({ label, text, mono = false }: {
  label: string
  text: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <View style={styles.block}>
      <Text style={styles.blockLabel}>{label}</Text>
      <Text style={[styles.blockText, mono && styles.mono]} selectable>{text}</Text>
    </View>
  )
}

function StatusDot({ status }: { status: 'running' | 'done' | 'error' }): React.JSX.Element {
  const color = status === 'running' ? colors.running : status === 'error' ? colors.danger : colors.success
  return <View style={[styles.statusDot, { backgroundColor: color }]} />
}

function statusLabel(status: 'running' | 'done' | 'error', t: Translate): string {
  return status === 'running'
    ? t('trajectory.status.running')
    : status === 'error' ? t('trajectory.status.failed') : t('trajectory.status.done')
}

function metricLine(metrics: NonNullable<TrajectoryRecord['metrics']>, t: Translate): string {
  return [
    ...(metrics.input === undefined ? [] : [t('trajectory.metric.input', { value: formatTokenCount(metrics.input) })]),
    ...(metrics.output === undefined ? [] : [t('trajectory.metric.output', { value: formatTokenCount(metrics.output) })]),
    ...(metrics.think === undefined ? [] : [t('trajectory.metric.think', { value: formatTokenCount(metrics.think) })]),
  ].join(t('chat.step.separator'))
}

/** The Web prints its durations as integer milliseconds with thousands separators. */
function grouped(milliseconds: number): string {
  return String(Math.round(milliseconds)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const mono = 'monospace'

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chat.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    gap: spacing(2),
  },
  back: { flexDirection: 'row', alignItems: 'center', minWidth: 88, gap: 2 },
  backLabel: { color: colors.accent, fontSize: fontSize.body },
  title: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600', textAlign: 'center' },
  content: { paddingHorizontal: spacing(4), paddingBottom: spacing(8) },
  empty: { color: colors.textDim, fontSize: fontSize.small, paddingVertical: spacing(6), textAlign: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  headingTitle: { flexShrink: 1, color: chat.labelPrimary, fontSize: fontSize.body, fontWeight: '600' },
  badge: { color: chat.labelTertiary, fontSize: fontSize.tiny, minWidth: 34 },
  index: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontVariant: ['tabular-nums'] },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  childTitle: { flexShrink: 1, color: chat.labelPrimary, fontSize: fontSize.small },
  childMeta: { marginLeft: 'auto', color: chat.labelTertiary, fontSize: fontSize.tiny },
  facts: {
    marginTop: spacing(2),
    paddingTop: spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chat.borderL1,
    gap: spacing(1),
  },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(2) },
  factLabel: { width: 76, color: chat.labelTertiary, fontSize: fontSize.tiny },
  factValue: { flex: 1, color: chat.labelSecondary, fontSize: fontSize.tiny },
  block: {
    marginTop: spacing(3),
    paddingTop: spacing(1.5),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chat.borderL1,
  },
  blockLabel: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontWeight: '600' },
  blockText: {
    marginTop: spacing(1),
    color: chat.labelSecondary,
    fontSize: fontSize.tiny,
    lineHeight: fontSize.tiny + 6,
  },
  mono: { fontFamily: mono },
  children: { marginTop: spacing(4) },
  childrenTitle: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontWeight: '600' },
  child: {
    marginTop: spacing(2),
    paddingLeft: spacing(2),
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: chat.borderL2,
  },
})
