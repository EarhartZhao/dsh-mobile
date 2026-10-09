/**
 * The trajectory's own overview: the Web's timeline, laid over the list.
 *
 * The Web draws the whole log as three lanes — 输入, 模型, 工具 — with every
 * record a block whose width is its recorded duration (or one equal slot, when
 * 时长 is off) and a hairline at every turn boundary. Dragging it selects a
 * time range that filters the table beside it.
 *
 * A phone cannot drag a range and read the rows at the same time, so this keeps
 * the picture and drops the range: the bar shows what the list holds, dims
 * everything the search box did not match, rings the record the reader last
 * opened, and a tap anywhere brings the nearest record into view. Tapping is
 * coordinate-based rather than a hit target per block, because a block can be
 * two pixels wide.
 */
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native'
import { chat } from '../theme'
import type { TranslationKey } from '../i18n'
import type { TrajectoryKind, TrajectoryTimelineModel, Translate } from '../trajectory-model'
import { TRAJECTORY_LANES } from '../trajectory-model'

/** The lane band's own height: the Web's 8px block every 14px. */
const LANE_STEP = 14
const LANE_HEIGHT = 8
/**
 * The lane caption's line box. The band is only 8 points tall, and a caption
 * squeezed into that box loses the bottom of every glyph, so the caption gets
 * a full line of its own and is centred on the band instead.
 */
const LABEL_HEIGHT = 14
/** The Web's plot height (50px) and its 7px breathing room top and bottom. */
const PLOT_HEIGHT = 50
const PLOT_PADDING = 7

/** The Web's lane captions, under the names this bar draws them by. */
const LANE_KEYS: Record<(typeof TRAJECTORY_LANES)[number], TranslationKey> = {
  input: 'trajectory.lane.input',
  model: 'trajectory.lane.model',
  tools: 'trajectory.lane.tools',
}

/** The colour one record's kind draws with, matching the Web's own palette. */
function spanColor(kind: TrajectoryKind, isError: boolean): string {
  if (isError) return chat.error
  switch (kind) {
    case 'user': return chat.infoFill
    case 'context': return chat.success
    case 'assistant': return chat.warn
    case 'tool':
    case 'subtool': return chat.deepDiving
    default: return chat.labelSecondary
  }
}

interface Props {
  t: Translate
  model: TrajectoryTimelineModel
  /** Record indexes matching the search box, or null without a query. */
  matchIndexes: ReadonlySet<number> | null
  /** The record the reader last opened, ringed so the next tap reads as a hop. */
  selectedIndex: number | null
  /** Bring the nearest record into view. */
  onSelect: (index: number) => void
}

/**
 * Draw the fixed three-lane overview above the ledger.
 * @param props.t - active locale lookup.
 * @param props.model - the spans and turn boundaries to place.
 * @param props.matchIndexes - search hits, or null when the box is empty.
 * @param props.selectedIndex - the last opened record's `#N`.
 * @param props.onSelect - called with the record nearest a tap.
 * @returns the overview bar.
 */
export function TrajectoryTimeline({
  t,
  model,
  matchIndexes,
  selectedIndex,
  onSelect,
}: Props): React.JSX.Element {
  const full = Math.max(1, model.end - model.start)
  // The track's own measured width, so a tap can be turned into a domain value.
  const trackWidth = React.useRef<number | null>(null)
  /** A tap's own x, read against the domain the bar is currently drawing. */
  const onPress = (event: GestureResponderEvent): void => {
    const { locationX } = event.nativeEvent
    const width = trackWidth.current ?? 0
    if (width <= 0) return
    const point = model.start + (Math.min(1, Math.max(0, locationX / width)) * full)
    const nearest = model.spans.reduce((candidate, span) => {
      const distance = point < span.start
        ? span.start - point
        : point > span.end ? point - span.end : 0
      const best = point < candidate.start
        ? candidate.start - point
        : point > candidate.end ? point - candidate.end : 0
      return distance < best ? span : candidate
    })
    onSelect(nearest.index)
  }
  const boundaries = model.turnBoundaries.filter(boundary => boundary.time > model.start)
  return (
    <View
      style={styles.root}
      accessibilityRole="image"
      accessibilityLabel={t('trajectory.timeline.aria')}
    >
      <View style={styles.labels} pointerEvents="none">
        {TRAJECTORY_LANES.map((lane, index) => (
          <View
            key={lane}
            style={[
              styles.laneLabelBox,
              { top: PLOT_PADDING + index * LANE_STEP - (LABEL_HEIGHT - LANE_HEIGHT) / 2 },
            ]}
          >
            <Text style={styles.laneLabel} numberOfLines={1}>
              {t(LANE_KEYS[lane])}
            </Text>
          </View>
        ))}
      </View>
      <TouchableOpacity
        style={styles.track}
        activeOpacity={1}
        accessible={false}
        onPress={onPress}
        onLayout={event => { trackWidth.current = event.nativeEvent.layout.width }}
      >
        {boundaries.map(boundary => (
          <View
            key={boundary.turn}
            pointerEvents="none"
            style={[styles.boundary, {
              left: `${((boundary.time - model.start) / full) * 100}%` as const,
            }]}
          />
        ))}
        {model.spans.map((span) => {
          const left = ((span.start - model.start) / full) * 100
          const width = ((span.end - span.start) / full) * 100
          // Search dims what it did not match, exactly as the Web's own
          // `[data-search-match='false']` does; the selection stays legible.
          const dimmed = matchIndexes !== null
            && !matchIndexes.has(span.index)
            && span.index !== selectedIndex
          return (
            <View
              key={span.index}
              pointerEvents="none"
              style={[
                styles.span,
                {
                  left: `${left}%`,
                  width: `${width}%`,
                  top: PLOT_PADDING + span.lane * LANE_STEP,
                  backgroundColor: spanColor(span.kind, span.isError),
                  opacity: dimmed ? 0.16 : 1,
                },
                span.index === selectedIndex && styles.spanSelected,
              ]}
            />
          )
        })}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    height: PLOT_HEIGHT,
    backgroundColor: chat.bgBase,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chat.borderL2,
  },
  labels: { width: 34, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: chat.borderL1 },
  laneLabelBox: { position: 'absolute', right: 4, height: LABEL_HEIGHT, justifyContent: 'center' },
  laneLabel: { color: chat.labelCaption, fontSize: 10 },
  track: { flex: 1 },
  boundary: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: chat.borderL2,
  },
  span: {
    position: 'absolute',
    height: LANE_HEIGHT,
    minWidth: 2,
    borderRadius: 1,
  },
  spanSelected: {
    shadowColor: chat.infoFill,
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
})
