/**
 * Conversation screen: history tail + live stream (throttled re-render),
 * prompt input, cancel, and the bottom action bar for approvals/questions.
 * Chunks never set state directly — the store batches and the 50ms throttle
 * bounds render frequency regardless of chunk rate (docs/01 移植策略).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  ActivityIndicator,
  Clipboard,
  Image,
  FlatList,
  Linking,
  Keyboard,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Modal,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { buildTranscript, compactJson, deriveConversation, increasedForkTitle, isLogBehindHost, placementLabel, prettyJson, queuePreview, sessionDisplayTitle, sessionStatsView, shortSessionId, stepTokenUsage, totalLineChanges, turnTokenUsage, type ConnectionManager, type ConversationItem, type FileChangeSummary, type ProcessActivitySummary, type SessionState, type SessionStatsView, type TodoItemView, type TranscriptRow, type Turn, type TurnProcessStep } from '@dsh-mobile/core'
import { subagentAddress, subagentRows, type SubagentAddress } from '@dsh-mobile/core'
import type {
  JobView, MobileFeedbackItem, MobileFeedbackRating, QueuedInboxItem, SubagentCatalog,
} from '@dsh-mobile/protocol'
import { presetSelectionEnabled } from '@dsh-mobile/protocol'
import Markdown from 'react-native-markdown-display'
import { ActionSheet, type SheetAction } from '../components/ActionSheet'
import { AttachmentImage } from '../components/AttachmentImage'
import { Icon } from '../icons'
import { ChatSearchSheet } from '../components/ChatSearchSheet'
import { linkTarget } from '../link-targets'
import { markdownCompactStyles, markdownRules, markdownStyles } from '../markdown'
import { extensionOf } from '../file-kinds'
import { FilePreviewSheet } from '../components/FilePreviewSheet'
import { ImageLightbox } from '../components/ImageLightbox'
import { MessageActionRow } from '../components/MessageActions'
import { ModalBackdrop } from '../components/ModalBackdrop'
import { PromptModal } from '../components/PromptModal'
import { ToolCard, VARIANT_ICONS } from '../components/ToolCard'
import { WorkspaceBrowserSheet } from '../components/WorkspaceBrowserSheet'
import {
  PlusMenuSheet,
  type PlusCommand,
  type PlusMenuStatus,
  type PlusPreset,
  type PlusReference,
  type PlusTab,
} from '../components/PlusMenuSheet'
import { QuestionCard, type QuestionAnswerPayload } from '../components/QuestionCard'
import { SubagentPanel } from '../components/SubagentPanel'
import { SubagentSwitcher } from '../components/SubagentSwitcher'
import { GoalBar, PlanChip, SessionStatsBar, TodoStrip, type GoalViewLite } from '../components/strips'
import { chat, chatText, colors, fontSize, radius, shadow, spacing } from '../theme'
import whale from '../assets/running-whale.png'
import { commonLabel, jobKindLabel, runDurationLabel, stepActivityLabel, toolDisplayName, toolRowVariant } from '../ui-labels'
import { sessionReferenceText } from '../session-references'
import { useI18n, type TranslationKey } from '../i18n'
import { appendPendingImage, buildPromptContent, formatBytes, type ImageLimitsView, type ImageRejection, type PendingImage } from '../chat-images'

interface PermissionSelectView {
  options: { value: string; name: string; description?: string }[]
  currentValue: string
}

interface PickedFile {
  name: string
  mimeType?: string
  size?: number
  data: string
}

interface PendingFile {
  id: string
  name: string
  bytes: number
  attachmentId?: string
  receiptId?: string
  status: 'uploading' | 'ready' | 'error'
  error?: string
}

const MAX_MOBILE_FILE_BYTES = 512 * 1024

/**
 * History windows tried in order: the tail read when the transcript opens, and
 * each walk further back from it.
 *
 * 120 is the window a healthy gateway answers with. The smaller ones are for a
 * gateway older than plugin 0.2.36, which cannot trim a page to what one NATS
 * publish carries (the Hub's ceiling is 1 MiB): there a big Session fails the
 * whole read, and a shallower window is the difference between an empty screen
 * and a readable transcript.
 */
const HISTORY_PAGE_SIZES = [120, 40]

/**
 * One history read, walking {@link HISTORY_PAGE_SIZES} down until it lands.
 *
 * A gateway older than plugin 0.2.36 cannot trim a page to what one NATS
 * publish carries, so a Session with heavy records fails the whole read instead
 * of answering short; a shallower window is what still opens it. The last
 * failure is the caller's to report.
 */
async function readHistoryPage<T>(read: (maxMessages: number) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (const maxMessages of HISTORY_PAGE_SIZES) {
    try {
      return await read(maxMessages)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/**
 * The oldest seq this Session's local log holds — the cursor every older read
 * walks back from. Records are seq-ascending, so the first one carrying a seq is
 * the oldest.
 */
function oldestSeq(session: SessionState | undefined): number | undefined {
  return session?.events
    // Transient chunks ride a placeholder zero, not a log position: counting
    // one as the oldest seq made "load older" ask for records before seq 0 and
    // stop on the empty page it got back, so a page that had been trimmed
    // mid-turn was never filled in.
    .filter(entry => !isTransientEvent(entry.event))
    .map(entry => typeof entry.event.seq === 'number' ? entry.event.seq : undefined)
    .find((seq): seq is number => seq !== undefined)
}

/** One live-stream chunk, which the durable log never carries. */
function isTransientEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false
  const data = (event as { data?: unknown }).data
  return typeof data === 'object' && data !== null && (data as { transient?: unknown }).transient === true
}

/**
 * The Host's run state for one Session, or `undefined` while the Host has not
 * said anything about it. The distinction is the whole point: a Session that
 * merely defaults to not-running must not settle a turn the Host may well be
 * running, and one the Host has reported idle must.
 */
function hostRunningOf(session: SessionState): boolean | undefined {
  return session.runningKnown ? session.running : undefined
}

/**
 * How long one tail-read attempt stands before another is allowed. The read is
 * a request, not a state: one that failed (or landed before the Host wrote the
 * records) has to be retryable.
 */
const HEAL_RETRY_MS = 5_000

/**
 * Frames per second stop being a useful measure in a quiet turn — a long tool
 * call streams nothing — so a silent stream is only re-read once it has been
 * quiet this long while the Host still reports the Session as running.
 */
const SILENT_STREAM_MS = 30_000

interface Props {
  manager: ConnectionManager
  sessionId: string
  onBack: () => void
  onOpenSession?: (sessionId: string) => void
  /** Enter sends the composer; Shift+Enter keeps the newline. Defaults on. */
  enterToSend?: boolean
}

function activeComposerToken(text: string): { prefix: string; trigger: '/' | '@'; query: string } | null {
  const quotedReference = /(?:^|\s)(@"([^"]*))$/u.exec(text)
  if (quotedReference?.[1] !== undefined && quotedReference[2] !== undefined) {
    return { prefix: quotedReference[1], trigger: '@', query: quotedReference[2] }
  }
  const reference = /(?:^|\s)(@([^\s]*))$/u.exec(text)
  if (reference?.[1] !== undefined && reference[2] !== undefined) {
    return { prefix: reference[1], trigger: '@', query: reference[2] }
  }
  const command = /(?:^|\s)(\/([\w.-]*))$/u.exec(text)
  if (command?.[1] !== undefined && command[2] !== undefined) {
    return { prefix: command[1], trigger: '/', query: command[2] }
  }
  return null
}

/** One file or directory the user picked into the composer from the browser. */
interface InsertedReference {
  path: string
  kind: 'file' | 'directory'
  size?: number
}

function fileMention(path: string, kind: 'file' | 'directory'): string | null {
  const value = kind === 'directory' ? `${path}/` : path
  const hasUnsafeCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return character === '"' || codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
  })
  if (hasUnsafeCharacter) return null
  return /\s/u.test(value) ? `@"${value}"` : `@${value}`
}

export function ChatScreen({ manager, sessionId, onBack, onOpenSession, enterToSend = true }: Props): React.JSX.Element {
  const { locale, t } = useI18n()
  const [items, setItems] = useState<ConversationItem[]>([])
  const [hasOlderHistory, setHasOlderHistory] = useState(false)
  /**
   * Backfill of everything older than the tail page. Reading a chat means the
   * whole chat, so the walk runs on its own; it stops on a pause, a failure, or
   * the end of the log. `backfilled` counts the records it pulled, which is what
   * the progress line reports.
   */
  const [backfill, setBackfill] = useState<'idle' | 'running' | 'paused' | 'failed'>('idle')
  const [backfilled, setBackfilled] = useState(0)
  /** The walk reads these between awaits, where state would still be stale. */
  const hasMoreRef = useRef(false)
  const backfillRun = useRef(0)
  const backfillStop = useRef(false)
  /**
   * The Host watermark whose tail read this screen already triggered, keyed by
   * Session: a page that cannot move the tail would otherwise be asked for
   * again on every store change. It carries the attempt's time too, so a read
   * that failed the first time is tried again rather than written off.
   */
  const healedSeq = useRef({ sessionId: '', seq: -1, at: 0 })
  /** When a frame for this Session last reached the store (see the stall watch). */
  const lastFrameAt = useRef(Date.now())
  /** Bumped to re-run the baseline read: what leaving and re-entering does. */
  const [tailEpoch, setTailEpoch] = useState(0)
  /**
   * The tail read that fills the transcript. A Session with heavy records takes
   * a while to come back, and a gateway whose page is bigger than one NATS
   * publish cannot answer it at all — both used to look like an empty chat.
   */
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyError, setHistoryError] = useState('')
  /** Guards a landing tail read: only the newest one may touch the screen. */
  const historyRequest = useRef(0)
  const [draft, setDraft] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [running, setRunning] = useState(false)
  const [queue, setQueue] = useState<QueuedInboxItem[]>([])
  const [jobs, setJobs] = useState<JobView[]>([])
  const [jobsOpen, setJobsOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<{ id: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [todos, setTodos] = useState<TodoItemView[]>([])
  const [statsView, setStatsView] = useState<SessionStatsView | null>(null)
  const [goal, setGoal] = useState<GoalViewLite | null>(null)
  const [goalPrompt, setGoalPrompt] = useState<'create' | 'edit' | null>(null)
  const [planMode, setPlanMode] = useState<string | undefined>(undefined)
  const [permissions, setPermissions] = useState<PermissionSelectView | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [messageAction, setMessageAction] = useState<ConversationItem | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [subOpen, setSubOpen] = useState<SubagentCatalog | null>(null)
  /** The header switcher's own dropdown, distinct from the full panel. */
  const [lineageOpen, setLineageOpen] = useState(false)
  /**
   * The switcher's clock. A child that is running shows how long its open turn
   * has taken, so the list re-renders once a second while — and only while —
   * that list is on screen with live work in it.
   */
  const [subNow, setSubNow] = useState(() => Date.now())
  /**
   * The mode this conversation was created with, learned by asking its parent
   * for the catalog when the store had not carried that projection yet. Held
   * with the parent it was read for, so a screen that changes Session cannot
   * address the new one with the old one's mode.
   */
  const [catalogedMode, setCatalogedMode] = useState<
    { parentSessionId: string, mode: 'one-shot' | 'continuable' } | null
  >(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [browserOpen, setBrowserOpen] = useState(false)
  /** References picked from the browser, shown as composer chips. */
  const [insertedRefs, setInsertedRefs] = useState<InsertedReference[]>([])
  /** Durable per-message feedback of this Session, keyed by assistant message id. */
  const [feedback, setFeedback] = useState<Record<string, MobileFeedbackItem>>({})
  /** Composer handle: reference picks return focus so they stay sendable. */
  const composerRef = useRef<React.ComponentRef<typeof TextInput> | null>(null)
  const [imageLimits, setImageLimits] = useState<ImageLimitsView | null>(null)
  const [plusOpen, setPlusOpen] = useState(false)
  const [commands, setCommands] = useState<PlusCommand[]>([])
  const [commandStatus, setCommandStatus] = useState<PlusMenuStatus>('idle')
  const [commandError, setCommandError] = useState('')
  const [commandPrompt, setCommandPrompt] = useState<{ command: PlusCommand } | null>(null)
  const [presets, setPresets] = useState<PlusPreset[]>([])
  const [presetStatus, setPresetStatus] = useState<PlusMenuStatus>('idle')
  const [presetError, setPresetError] = useState('')
  /** Host policy: when selection is off, offering a picker promises a choice the host ignores. */
  const [presetSelectionOn, setPresetSelectionOn] = useState(true)
  const [references, setReferences] = useState<PlusReference[]>([])
  const [referenceStatus, setReferenceStatus] = useState<PlusMenuStatus>('idle')
  const [lightbox, setLightbox] = useState<{ source: string; name?: string } | null>(null)
  const [modelMenu, setModelMenu] = useState<{
    current: { provider: string; model: string; reasoningEffort?: string }
    routable: boolean
    failures: { id: string; name: string; message: string }[]
    groups: {
      id: string
      name: string
      models: {
        id: string
        name: string
        reasoning?: { efforts: { id: string; name: string }[]; defaultEffort?: string }
      }[]
    }[]
  } | null>(null)
  const [pendingModel, setPendingModel] = useState<{ providerId: string; modelId: string; efforts: { id: string; name: string }[] } | null>(null)
  const [modelLabel, setModelLabel] = useState(t('chat.model'))
  /**
   * What opened the plus sheet: the attach button, or one of the composer's own
   * triggers. The trigger decides the tab it starts on and what a pick does —
   * `/` and `@` are text the reader typed, so their pick completes that text,
   * while the attach button starts a command outright.
   */
  const [sheetTrigger, setSheetTrigger] = useState<'plus' | '/' | '@'>('plus')
  const [sheetTab, setSheetTab] = useState<PlusTab>('commands')
  const [sheetQuery, setSheetQuery] = useState('')
  /**
   * A trigger the reader already dismissed, as `<char>@<offset>`. Without it
   * the modal reopens on the next keystroke, since the token is still in the
   * draft; it is cleared whenever no trigger is left, so typing `/` again
   * after deleting it opens the sheet as usual.
   */
  const dismissedTrigger = useRef<string | null>(null)

  /** Open the one plus sheet, on the tab and query the trigger implies. */
  const openPlus = (tab: PlusTab, query: string, trigger: 'plus' | '/' | '@'): void => {
    setSheetTrigger(trigger)
    setSheetTab(tab)
    setSheetQuery(query)
    setPlusOpen(true)
    if (tab === 'commands') void loadCommands()
    if (tab === 'references') void loadReferences()
    if (tab === 'controls') void loadPresets()
  }

  /**
   * Trailing-token detection: `/` opens the commands tab, `@` the references
   * tab, both in the same sheet the attach button opens (ui-input-trigger lite).
   */
  const onDraftChange = (text: string): void => {
    setDraft(text)
    const token = activeComposerToken(text)
    if (token === null) {
      dismissedTrigger.current = null
      return
    }
    const key = `${token.trigger}@${text.length - token.prefix.length}`
    if (dismissedTrigger.current === key) return
    openPlus(token.trigger === '/' ? 'commands' : 'references', token.query, token.trigger)
  }

  /**
   * Replace the trigger token the sheet was opened for with the picked text,
   * and keep the caret in the composer so the result is immediately sendable.
   * A pick made from the attach button has no token to replace: its insert
   * appends.
   */
  const insertAtTrigger = (insert: string): void => {
    const token = sheetTrigger === 'plus' ? null : activeComposerToken(draft)
    setDraft(token === null
      ? `${draft}${draft === '' || draft.endsWith(' ') ? '' : ' '}${insert}`
      : `${draft.slice(0, -token.prefix.length)}${insert}`)
    composerRef.current?.focus()
  }

  const chooseImages = async (): Promise<void> => {
    try {
      const picker = NativeModules.DshImagePicker as {
        pickImages(maxBytes: number): Promise<PendingImage[]>
      } | undefined
      if (picker?.pickImages === undefined) throw new Error(t('chat.multiImageUnsupported'))
      const images = await picker.pickImages(imageLimits?.maxImageBytes ?? 20 * 1024 * 1024)
      for (const image of images) {
        appendImage(image)
      }
    } catch (error) {
      showNotice(t('chat.selectImagesFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  const captureImage = async (): Promise<void> => {
    const image = await callImagePicker('captureImage')
    if (image !== null && image !== undefined) {
      appendImage(image)
    }
  }

  const chooseFile = async (): Promise<void> => {
    const picker = NativeModules.DshFilePicker as { pickFile(): Promise<PickedFile | null> } | undefined
    if (picker?.pickFile === undefined) {
      showNotice(t('plus.filePickerUnavailable'))
      return
    }
    let uploadId: string | null = null
    try {
      const selected = await picker.pickFile()
      if (selected == null) return
      if (selected.name.trim() === '' || selected.data.trim() === '') {
        showNotice(t('plus.fileUploadFailed', { message: 'invalid file picker result' }))
        return
      }
      const bytes = selected.size ?? Math.floor(selected.data.length * 3 / 4)
      if (bytes > MAX_MOBILE_FILE_BYTES) {
        showNotice(t('plus.fileTooLarge', { size: formatBytes(MAX_MOBILE_FILE_BYTES) }))
        return
      }
      uploadId = `${selected.name}:${Date.now()}:${Math.random()}`
      setPendingFiles(current => [...current, { id: uploadId as string, name: selected.name, bytes, status: 'uploading' }])
      const client = manager.client
      if (client === null) throw new Error(t('chat.loadConnection'))
      const uploaded = await client.fileUploads.upload({ sessionId, data: selected.data, name: selected.name })
      if (!uploaded?.receiptId) throw new Error('missing receiptId')
      setPendingFiles(current => current.map(file => file.id === uploadId
        ? { ...file, receiptId: uploaded.receiptId, attachmentId: uploaded.file.attachmentId, bytes: uploaded.file.bytes, status: 'ready' }
        : file))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showNotice(t('plus.fileUploadFailed', { message }))
      if (uploadId !== null) setPendingFiles(current => current.map(file => file.id === uploadId ? { ...file, status: 'error', error: message } : file))
    }
  }

  const callImagePicker = async (method: 'pickImage' | 'captureImage'): Promise<PendingImage | null | undefined> => {
    try {
      const picker = NativeModules.DshImagePicker as {
        pickImage(maxBytes: number): Promise<PendingImage | null>
        captureImage(maxBytes: number): Promise<PendingImage | null>
      } | undefined
      return await picker?.[method](imageLimits?.maxImageBytes ?? 20 * 1024 * 1024)
    } catch (error) {
      showNotice(t('chat.selectImagesFailed', { message: error instanceof Error ? error.message : String(error) }))
      return null
    }
  }

  const rejectionNotice = (rejection: ImageRejection): string => {
    switch (rejection.kind) {
      case 'format': return t('chat.unsupportedImageFormat')
      case 'perImageSize': return t('chat.imageTooLarge', { size: rejection.sizeLabel })
      case 'dimension': return t('chat.imageTooWide', { size: rejection.size })
      case 'pixels': return t('chat.imageTooManyPixels')
      case 'count': return t('chat.maxImages', { count: rejection.count })
      case 'totalSize': return t('chat.imagesTooLarge', { size: rejection.sizeLabel })
    }
  }

  const appendImage = (image: PendingImage): void => {
    setPendingImages(current => {
      const { next, rejection } = appendPendingImage(current, image, imageLimits)
      if (rejection !== null) showNotice(rejectionNotice(rejection))
      return next
    })
  }
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<FlatList<TranscriptRow>>(null)
  /**
   * One press, one navigation. The header can receive both a touch-up and an
   * accessibility activation, and a large conversation is expensive to release
   * twice. The latch is cleared whenever this screen is handed another
   * conversation: following a subagent and coming back keeps the same mounted
   * screen, so a latch held across the hop swallowed the second back gesture.
   */
  const backHandled = useRef(false)
  const mountedRef = useRef(true)
  /**
   * The reader is following the newest message: the transcript is at its bottom
   * and no finger or momentum scroll is in flight. Exactly one mechanism may
   * hold the offset while this is true, so it gates both of them:
   *
   * - the scroll anchor (`maintainVisibleContentPosition`) stays unarmed, and
   * - the follow scroll re-pins the newest row to the bottom of the viewport.
   *
   * Armed together they fought: a streamed chunk grew the row above the anchor,
   * the native anchor answered by moving the content back, and the follow
   * scroll moved it the other way again — the up-and-down the reader saw while
   * the model was thinking. Reading older history is the mirror image: the
   * anchor is what keeps a prepended page from moving the place the reader is
   * looking at, and nothing here scrolls.
   */
  const followTailRef = useRef(true)
  const [followTail, setFollowTail] = useState(true)
  const listInteractionActive = useRef(false)
  const listDistanceFromBottom = useRef(0)
  const listInteractionEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The list's own height, from its layout and its scroll samples. */
  const listViewportHeight = useRef(0)
  /** Coalesced follow scroll: the newest height, and its pending frame. */
  const pendingTailHeight = useRef<number | null>(null)
  const tailFollowFrame = useRef<number | null>(null)
  /**
   * The transcript's measured height, kept for the floating scroll-to-bottom
   * control. Unlike the follow scroll this is recorded even while the reader is
   * away from the tail, because coming back needs the same measured bottom the
   * follow scroll uses — `scrollToEnd` estimates an unmeasured row.
   */
  const listContentHeight = useRef(0)

  /**
   * Record where the reader is. The gesture handlers compare and assign through
   * this so the scroll anchor's prop only changes when the answer changes —
   * a state write per scroll sample would re-render the transcript 60 times a
   * second.
   */
  const syncFollowTail = useCallback((next: boolean): void => {
    if (followTailRef.current === next) return
    followTailRef.current = next
    setFollowTail(next)
  }, [])

  const handleBack = useCallback((): void => {
    // The header can receive both a touch-up and an accessibility/keyboard
    // activation.  Make navigation idempotent so an expensive unmount is not
    // scheduled twice while a large conversation is being released.
    if (backHandled.current) return
    backHandled.current = true
    onBack()
  }, [onBack])

  /**
   * This screen stays mounted while the reader follows a child conversation and
   * comes back, so everything held loosely on it has to be re-scoped by hand.
   * The latch is per press, and the composer belongs to the conversation it was
   * written for — a draft, a reference chip or a staged photo must not ride
   * into the conversation next door.
   */
  useEffect(() => {
    backHandled.current = false
    setDraft('')
    setPendingImages([])
    setInsertedRefs([])
    setEditingItem(null)
  }, [sessionId])

  const onListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height)
    listDistanceFromBottom.current = distanceFromBottom
    listViewportHeight.current = layoutMeasurement.height
    // Content growing below the reader is not the reader moving: a streamed
    // chunk leaves the offset where it was, so the next sample reports a
    // distance the reader never made. Disarming on that sample and re-arming on
    // the follow scroll that answers it turned every chunk into a toggle of the
    // scroll anchor and of the offset it holds — the up-and-down the reader saw
    // while the model was thinking. Only their own gesture (or the control that
    // returns them to the tail) hands the offset over, so this side only ever
    // takes it back, with the small tolerance that keeps layout rounding from
    // leaving the tail unowned.
    if (!listInteractionActive.current && distanceFromBottom <= 48) syncFollowTail(true)
  }, [syncFollowTail])

  /** The viewport can be known before the first scroll sample arrives. */
  const onListLayout = useCallback((event: LayoutChangeEvent): void => {
    listViewportHeight.current = event.nativeEvent.layout.height
  }, [])

  const onListScrollBeginDrag = useCallback((): void => {
    // Opt out before the first scroll sample arrives, otherwise a concurrent
    // row measurement could win the race and move the list back to the tail.
    if (listInteractionEndTimer.current !== null) {
      clearTimeout(listInteractionEndTimer.current)
      listInteractionEndTimer.current = null
    }
    listInteractionActive.current = true
    syncFollowTail(false)
  }, [syncFollowTail])

  const finishListInteraction = useCallback((): void => {
    listInteractionActive.current = false
    syncFollowTail(listDistanceFromBottom.current <= 48)
  }, [syncFollowTail])

  const onListScrollEndDrag = useCallback((): void => {
    // Momentum begins on a later native event. Delay the unlock briefly so
    // there is no gap in which a content-size change can steal the scroll.
    if (listInteractionEndTimer.current !== null) clearTimeout(listInteractionEndTimer.current)
    listInteractionEndTimer.current = setTimeout(() => {
      listInteractionEndTimer.current = null
      finishListInteraction()
    }, 120)
  }, [finishListInteraction])

  const onListMomentumScrollBegin = useCallback((): void => {
    if (listInteractionEndTimer.current !== null) {
      clearTimeout(listInteractionEndTimer.current)
      listInteractionEndTimer.current = null
    }
    listInteractionActive.current = true
  }, [])

  const onListMomentumScrollEnd = useCallback((): void => {
    finishListInteraction()
  }, [finishListInteraction])

  /**
   * Keep the newest row in view while the reader is following the tail.
   *
   * The offset is measured, not estimated. `scrollToEnd` asks VirtualizedList
   * for the last cell's metrics, and for a cell it has never measured that is
   * an average-based guess — wrong by however tall the streaming row is, which
   * left the list a screen short of the bottom and the follow logic fighting
   * itself over the difference. `onContentSizeChange` hands over the real
   * content height, the viewport comes from the list's own layout, and their
   * difference *is* the bottom. Streams arrive faster than a frame, so the
   * burst collapses into one scroll per frame with the newest height.
   */
  const onListContentSizeChange = useCallback((_width: number, height: number): void => {
    listContentHeight.current = height
    // A transcript the reader has scrolled away from must never be dragged back
    // down by a row that merely remeasured.
    if (!mountedRef.current || listInteractionActive.current || !followTailRef.current) return
    pendingTailHeight.current = height
    if (tailFollowFrame.current !== null) return
    tailFollowFrame.current = requestAnimationFrame(() => {
      tailFollowFrame.current = null
      const contentHeight = pendingTailHeight.current
      pendingTailHeight.current = null
      if (contentHeight === null) return
      if (!mountedRef.current || listInteractionActive.current || !followTailRef.current) return
      const viewportHeight = listViewportHeight.current
      // Nothing has been laid out yet, so there is no measured bottom to aim at
      // — and no anchor armed to disagree with the estimate this once.
      if (viewportHeight <= 0) {
        listRef.current?.scrollToEnd({ animated: false })
        return
      }
      listRef.current?.scrollToOffset({ offset: Math.max(0, contentHeight - viewportHeight), animated: false })
    })
  }, [])

  /**
   * The web's floating "back to bottom" control: re-arm the follow scroll and
   * pin the tail. The offset is the same measured bottom the follow scroll
   * aims at, so a tap lands the reader exactly where the next streamed chunk
   * would have kept them.
   */
  const returnToBottom = useCallback((): void => {
    syncFollowTail(true)
    const viewportHeight = listViewportHeight.current
    const contentHeight = listContentHeight.current
    if (viewportHeight <= 0 || contentHeight <= 0) {
      listRef.current?.scrollToEnd({ animated: true })
      return
    }
    listRef.current?.scrollToOffset({ offset: Math.max(0, contentHeight - viewportHeight), animated: true })
  }, [syncFollowTail])

  const refresh = useCallback(() => {
    const session = manager.store.sessions.get(sessionId)
    if (session === undefined) return
    const nextItems = deriveConversation(session, { running: hostRunningOf(session) })
    setItems(nextItems)
    setRunning(session.running)
    setQueue([...session.queue])
    setJobs([...session.jobs])
    setTodos([...session.todos])
    setStatsView(sessionStatsView(session))
    const goalRaw = session.projections['goal']
    if (goalRaw !== null && goalRaw !== undefined && typeof goalRaw === 'object' && 'goal' in (goalRaw as object)) {
      const g = (goalRaw as { goal?: { id?: string; revision?: number; objective?: string; phase?: string } }).goal
      if (g !== undefined && g !== null && typeof g.id === 'string' && typeof g.revision === 'number' && typeof g.objective === 'string') {
        setGoal({ id: g.id, revision: g.revision, objective: g.objective, phase: (g.phase as GoalViewLite['phase']) ?? 'active' })
      } else setGoal(null)
    } else setGoal(null)
    const planRaw = session.projections['plan']
    if (typeof planRaw === 'string') setPlanMode(planRaw)
    else if (planRaw !== null && typeof planRaw === 'object' && 'mode' in (planRaw as object) && typeof (planRaw as { mode?: unknown }).mode === 'string') {
      setPlanMode((planRaw as { mode: string }).mode)
    } else setPlanMode(undefined)
    const permissionRaw = session.projections['permissions']
    if (permissionRaw !== null && typeof permissionRaw === 'object') {
      const raw = permissionRaw as { options?: unknown; currentValue?: unknown }
      const options = Array.isArray(raw.options)
        ? raw.options.filter((option): option is PermissionSelectView['options'][number] =>
            typeof option === 'object' && option !== null &&
            typeof (option as Record<string, unknown>)['value'] === 'string' &&
            typeof (option as Record<string, unknown>)['name'] === 'string')
        : []
      if (options.length > 0 && typeof raw.currentValue === 'string') {
        setPermissions({ options, currentValue: raw.currentValue })
      } else setPermissions(undefined)
    } else setPermissions(undefined)
    const imageRaw = session.projections['imageLimits']
    if (imageRaw !== null && imageRaw !== undefined && typeof imageRaw === 'object') {
      const raw = imageRaw as Record<string, unknown>
      const number = (key: string): number | null =>
        typeof raw[key] === 'number' && raw[key] > 0 ? raw[key] as number : null
      const maxImageBytes = number('maxImageBytes')
      const maxImagesPerMessage = number('maxImagesPerMessage')
      const maxMessageImageBytes = number('maxMessageImageBytes')
      const maxImagePixels = number('maxImagePixels')
      const maxImageDimension = number('maxImageDimension')
      const mediaTypes = Array.isArray(raw.mediaTypes)
        ? raw.mediaTypes.filter((value): value is string => typeof value === 'string')
        : []
      if (maxImageBytes !== null && maxImagesPerMessage !== null && maxMessageImageBytes !== null &&
        maxImagePixels !== null && maxImageDimension !== null && mediaTypes.length > 0) {
        setImageLimits({
          maxImageBytes,
          maxImagesPerMessage,
          maxMessageImageBytes,
          maxImagePixels,
          maxImageDimension,
          mediaTypes,
        })
      } else setImageLimits(null)
    } else setImageLimits(null)
  }, [manager, sessionId])

  const goalAction = async (verb: 'pause' | 'resume' | 'complete' | 'clear'): Promise<void> => {
    const client = manager.client
    if (client === null || goal === null) return
    const ref = { id: goal.id, revision: goal.revision }
    await (verb === 'pause' ? client.goals.pause({ sessionId, ref } as never)
      : verb === 'resume' ? client.goals.resume({ sessionId, ref } as never)
      : verb === 'complete' ? client.goals.complete({ sessionId, ref } as never)
      : client.goals.clear({ sessionId, ref } as never)).catch(() => undefined)
  }

  const goalSubmit = async (objective: string): Promise<void> => {
    const client = manager.client
    setGoalPrompt(null)
    if (client === null) return
    if (goalPrompt === 'create') {
      const result = await client.goals.create({ sessionId, objective } as never).catch(() => null)
      if (result?.result.ok) {
        const ref = (result.result.value as { ref?: { id?: string; revision?: number } }).ref
        if (typeof ref?.id === 'string' && typeof ref.revision === 'number') {
          setGoal({ id: ref.id, revision: ref.revision, objective, phase: 'active' })
        }
      }
      return
    }
    if (goal !== null) await client.goals.edit({ sessionId, ref: { id: goal.id, revision: goal.revision }, objective } as never).catch(() => undefined)
  }

  const rename = async (title: string): Promise<void> => {
    setRenameOpen(false)
    await manager.client?.sessions.rename({ sessionId, title } as never).catch(() => undefined)
  }

  const fork = async (): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const result = await client.sessions.fork({ sessionId } as never).catch(() => null)
    setMenuOpen(false)
    // New forked session: navigation lands on the list, where it now exists.
    if (result?.result.ok) handleBack()
    void manager.refreshBaseline()
  }

  const loadModels = useCallback(async (): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const result = await client.sessions.models({ sessionId } as never).catch(() => null)
    if (mountedRef.current && result?.result.ok) setModelLabel(result.result.value.current.model)
  }, [manager, sessionId])

  const loadCommands = useCallback(async (force = false): Promise<void> => {
    const client = manager.client
    if (client === null || (!force && commandStatus === 'ready')) return
    setCommandStatus('loading')
    setCommandError('')
    try {
      const result = await client.commands.list({ sessionId })
      const values = result.commands
        .filter(command => typeof command.name === 'string')
        .map(command => ({
          name: command.name,
          description: command.description,
          hint: command.input?.hint,
          images: command.input?.images,
        }))
      setCommands(values)
      setCommandStatus('ready')
    } catch (error) {
      setCommands([])
      setCommandStatus('failed')
      setCommandError(t('chat.loadFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }, [commandStatus, manager, sessionId, t])

  const loadPresets = useCallback(async (force = false): Promise<void> => {
    const client = manager.client
    if (client === null || (!force && presetStatus === 'ready')) return
    setPresetStatus('loading')
    setPresetError('')
    const roster = await client.catalog.agentPresets().catch(() => null)
    if (roster === null) {
      setPresets([])
      setPresetStatus('failed')
      setPresetError(t('chat.loadConnection'))
      return
    }
    setPresets(roster.presets.filter(preset => preset.broken === undefined))
    setPresetSelectionOn(presetSelectionEnabled(roster))
    setPresetStatus('ready')
  }, [manager, presetStatus, t])

  const loadReferences = useCallback(async (force = false): Promise<void> => {
    const client = manager.client
    if (client === null || (!force && referenceStatus === 'ready')) return
    setReferenceStatus('loading')
    const [fileValues, sessionValues] = await Promise.all([
      client.references.files({ sessionId, query: '' }).catch(() => []),
      client.references.sessions({ sessionId, query: '' }).catch(() => []),
    ])
    const files: PlusReference[] = fileValues.flatMap((entry) => {
      const mention = fileMention(entry.path, entry.kind)
      if (mention === null) return []
      const title = entry.path.split('/').filter(Boolean).at(-1) ?? entry.path
      return [{ key: `file:${entry.path}`, title: `${title}${entry.kind === 'directory' ? '/' : ''}`, subtitle: entry.path, insert: `${mention} ` }]
    })
    const sessions: PlusReference[] = sessionValues.map(entry => ({
      key: `session:${entry.sessionId}`,
      ...sessionReferenceText(entry, t('chat.session')),
      insert: `${entry.mention} `,
    }))
    const skills: PlusReference[] = []
    const skillResult = await client.catalog.skills({ sessionId }).catch(() => null)
    if (skillResult !== null) {
      for (const skill of skillResult.skills) {
        const source = skill.path
        skills.push({
          key: `skill:${skill.name}`,
          title: `/${skill.name}`,
          subtitle: skill.description,
          ...(source === undefined ? {} : { meta: source }),
          insert: `/${skill.name} `,
        })
      }
    }
    setReferences([...skills.slice(0, 12), ...files.slice(0, 12), ...sessions])
    setReferenceStatus('ready')
  }, [manager, referenceStatus, sessionId, t])

  const openModels = async (): Promise<void> => {
    setMenuOpen(false)
    const client = manager.client
    if (client === null) return
    const result = await client.sessions.models({ sessionId } as never).catch(() => null)
    if (result?.result.ok) {
      setModelMenu(result.result.value as never)
      setModelLabel(`${result.result.value.current.model}`)
    }
  }

  const openSubagents = async (): Promise<void> => {
    setMenuOpen(false)
    const client = manager.client
    if (client === null) return
    const result = await client.subagents.list({ parentSessionId: sessionId } as never).catch(() => null)
    if (result?.result.ok) setSubOpen(result.result.value as never)
  }

  const selectModel = async (provider: string, model: string, reasoningEffort?: string): Promise<void> => {
    setModelMenu(null)
    setModelLabel(model)
    setPendingModel(null)
    await manager.client?.sessions.selectModel({ sessionId, provider, model, reasoningEffort } as never).catch(() => undefined)
  }

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  /**
   * A tapped link: URLs leave the app, file references open the workspace
   * preview, and this build's own vocabularies (`dsh-session:`, anchors) are
   * ignored. Without this the renderer's default `Linking.openURL` swallowed
   * every relative path the model cites — which is most of them.
   */
  const openTranscriptLink = useCallback((href: string): void => {
    const target = linkTarget(href)
    if (target.kind === 'ignore') return
    if (target.kind === 'file') {
      setPreviewPath(target.path)
      return
    }
    void Linking.openURL(target.url).catch(() => {
      showNotice(t('chat.linkFailed', { url: target.url }))
    })
  }, [showNotice, t])

  // Held as a value rather than read off the manager inside the callback, so a
  // reconnect re-runs the read: an empty transcript must not outlive the
  // connection it failed on.
  const connection = manager.client

  /**
   * This conversation's durable subagent address, when it is a child.
   *
   * A child is not addressable as a Session — the Host answers such a read with
   * "subagent Sessions require their durable parent address" — so a reader that
   * followed one out of the header switcher has to name the parent and the mode
   * the child was created with before its transcript can be read at all. The
   * list carries the parent; the parent's own `subagentCatalog` carries the
   * mode. Until both are known the read waits, because the mode is part of the
   * address and a guessed one is refused rather than ignored.
   */
  const subagentParentId = ((): string | null => {
    const row = manager.store.summaries.find(summary => String(summary.sessionId) === sessionId)
    return typeof row?.parentSessionId === 'string' && row.parentSessionId !== ''
      ? row.parentSessionId
      : null
  })()
  const storeAddress = subagentParentId === null ? null : subagentAddress(manager.store, sessionId)
  const subagentMode: 'one-shot' | 'continuable' | null = storeAddress?.mode
    ?? (catalogedMode?.parentSessionId === subagentParentId ? catalogedMode.mode : null)
  // Memoized on the three primitives that make it: the read callbacks take this
  // as a dependency, and a fresh object every render would restart the tail
  // read on every render.
  const subagentReadAddress = useMemo<SubagentAddress | null>(
    () => subagentParentId !== null && subagentMode !== null
      ? { parentSessionId: subagentParentId, childSessionId: sessionId, mode: subagentMode }
      : null,
    [sessionId, subagentMode, subagentParentId],
  )
  /** This conversation is a subagent child, whether or not its mode is known. */
  const isSubagentSession = subagentParentId !== null
  /** The read may start: a top-level Session always, a child once addressed. */
  const historyReady = !isSubagentSession || subagentMode !== null
  /**
   * Why this conversation's composer is read-only, when it is — the Web swaps
   * the whole composer for that explanation. A one-shot child never accepts a
   * follow-up, and a child whose mode this client cannot read has no address to
   * send one through either, so both states explain themselves instead of
   * offering a box whose send the Host would refuse.
   */
  const composerReadOnly: 'one-shot' | 'unknown' | null = !isSubagentSession || subagentMode === 'continuable'
    ? null
    : subagentMode === 'one-shot' ? 'one-shot' : 'unknown'

  /**
   * Ask the parent for its catalog when this client has not read that
   * projection yet — the mode is in there, and nothing else carries it. One
   * request per parent, and a failure leaves the transcript read-only rather
   * than spending a read the Host would refuse.
   */
  const catalogAsk = useRef<string | null>(null)
  useEffect(() => {
    if (subagentParentId === null || subagentMode !== null) return
    const client = manager.client
    const ask = `${subagentParentId}:${sessionId}`
    if (client === null || catalogAsk.current === ask) return
    catalogAsk.current = ask
    let live = true
    void client.subagents.list({ parentSessionId: subagentParentId } as never).then((result) => {
      if (!live || result?.result.ok !== true) return
      const entry = result.result.value.entries
        .find(row => row.kind === 'child' && String(row.id) === sessionId)
      if (entry === undefined || entry.kind !== 'child') return
      setCatalogedMode({ parentSessionId: subagentParentId, mode: entry.mode })
    }).catch(() => undefined)
    return () => { live = false }
  }, [manager, sessionId, subagentMode, subagentParentId])

  /**
   * The tail read that fills this Session's transcript.
   *
   * A failed read used to be swallowed whole: the screen stayed blank and the
   * Session looked empty, which is exactly what a long one with heavy records
   * does when its page is too big for the gateway to publish in one frame.
   */
  const loadHistoryTail = useCallback(async (): Promise<void> => {
    // No connection yet: the caller keeps the loading state, and the read is
    // retried when one arrives (the connection is a dependency below).
    if (connection === null) return
    // A child whose mode is still being read has no address yet, so there is
    // nothing to ask: the effect that owns this read re-runs when it lands.
    if (!historyReady) return
    const address = subagentReadAddress
    const request = ++historyRequest.current
    setHistoryStatus('loading')
    setHistoryError('')
    try {
      const page = await readHistoryPage(async maxMessages => {
        const result = address === null
          ? await connection.sessions.history({ sessionId, maxMessages } as never)
          : await connection.subagents.history({
            parentSessionId: address.parentSessionId,
            childSessionId: address.childSessionId,
            mode: address.mode,
            maxMessages,
          } as never)
        if (!result.result.ok) throw new Error(result.result.error.message)
        return result.result.value
      })
      if (request !== historyRequest.current || !mountedRef.current) return
      manager.store.applyHistory(
        sessionId,
        page.events,
        page.projections ?? undefined,
      )
      hasMoreRef.current = page.hasMore
      setHasOlderHistory(page.hasMore)
      setHistoryStatus('ready')
    } catch (error) {
      if (request !== historyRequest.current || !mountedRef.current) return
      setHistoryStatus('error')
      setHistoryError(error instanceof Error ? error.message : String(error))
    }
  }, [connection, historyReady, manager, sessionId, subagentReadAddress])

  /**
   * One page further back, applied to the store.
   * @returns whether another page is still waiting; `null` when the read failed
   *   or the log stopped moving, which ends a walk.
   */
  const loadOlderPage = useCallback(async (): Promise<boolean | null> => {
    const client = manager.client
    const beforeSeq = oldestSeq(manager.store.sessions.get(sessionId))
    if (client === null || beforeSeq === undefined || !hasMoreRef.current) return null
    const address = subagentReadAddress
    try {
      const page = await readHistoryPage(async maxMessages => {
        const result = address === null
          ? await client.sessions.history({ sessionId, beforeSeq, maxMessages } as never)
          : await client.subagents.history({
            parentSessionId: address.parentSessionId,
            childSessionId: address.childSessionId,
            mode: address.mode,
            beforeSeq,
            maxMessages,
          } as never)
        if (!result.result.ok) throw new Error(result.result.error.message)
        return result.result.value
      })
      if (!mountedRef.current) return null
      manager.store.applyHistory(sessionId, page.events)
      setBackfilled(count => count + page.events.length)
      hasMoreRef.current = page.hasMore
      setHasOlderHistory(page.hasMore)
      if (!page.hasMore) return false
      // A gateway that answered with the same window would have the walk ask
      // for it forever, so a page that moved nothing ends it instead.
      const oldest = oldestSeq(manager.store.sessions.get(sessionId))
      return oldest === undefined || oldest >= beforeSeq ? null : true
    } catch (error) {
      showNotice(t('chat.historyFailed', { message: error instanceof Error ? error.message : String(error) }))
      return null
    }
  }, [manager, sessionId, showNotice, subagentReadAddress, t])

  /**
   * Pull the rest of the log, one page at a time.
   *
   * A page too big for the Hub to publish used to fail the read outright, and
   * even when it worked, walking back through a long Session meant tapping
   * "load earlier" once per page. The gateway now answers short pages, and this
   * keeps asking until there is nothing older to ask for.
   */
  const backfillHistory = useCallback(async (): Promise<void> => {
    const generation = ++backfillRun.current
    backfillStop.current = false
    setBackfill('running')
    for (;;) {
      if (generation !== backfillRun.current || !mountedRef.current) return
      if (backfillStop.current) {
        setBackfill('paused')
        return
      }
      const more = await loadOlderPage()
      if (generation !== backfillRun.current || !mountedRef.current) return
      if (more === null) {
        setBackfill('failed')
        return
      }
      if (!more) {
        setBackfill('idle')
        return
      }
    }
  }, [loadOlderPage])

  const pauseBackfill = useCallback((): void => {
    backfillStop.current = true
  }, [])

  /**
   * Notice a Transcript whose live stream dropped the end of a turn.
   *
   * A Session's live stream carries its chunks, its durable records and its
   * `turn/end`. When that stream dies mid-turn the transcript never learns how
   * the turn ended, and the records it missed exist only in the Host's log —
   * which the bridge's re-opened stream reports as a watermark above every
   * record the App holds. Landing the baseline read again is what leaving and
   * re-entering the screen does, minus the leaving: the answer and the end of
   * the turn arrive while the reader is still looking at it.
   */
  const healMissingTail = useCallback((): void => {
    const session = manager.store.sessions.get(sessionId)
    if (session === undefined || !isLogBehindHost(session)) return
    const healed = healedSeq.current
    const now = Date.now()
    if (healed.sessionId === sessionId
      && healed.seq >= session.lastSeq
      && now - healed.at < HEAL_RETRY_MS) return
    healedSeq.current = { sessionId, seq: session.lastSeq, at: now }
    setTailEpoch(epoch => epoch + 1)
  }, [manager, sessionId])

  /**
   * The same heal, forced for a stream that went quiet without saying so.
   *
   * `isLogBehindHost` compares the log against a watermark the Host reports,
   * and a stream that dies mid-turn reports nothing more: the records it
   * dropped are invisible to that comparison, so the transcript keeps a clock
   * running over a turn that ended. Silence while the Session still reads as
   * running is that shape, and re-reading the tail is the cure — it lands the
   * missing records and re-registers the live follow behind them.
   */
  const healSilentStream = useCallback((): void => {
    const session = manager.store.sessions.get(sessionId)
    if (session === undefined) return
    if (isLogBehindHost(session)) {
      healMissingTail()
      return
    }
    if (!session.running) return
    if (Date.now() - lastFrameAt.current < SILENT_STREAM_MS) return
    const healed = healedSeq.current
    const now = Date.now()
    if (healed.sessionId === sessionId && now - healed.at < HEAL_RETRY_MS) return
    healedSeq.current = { sessionId, seq: session.lastSeq, at: now }
    setTailEpoch(epoch => epoch + 1)
  }, [healMissingTail, manager, sessionId])

  useEffect(() => {
    // Every establish pass — a reconnect, or the bridge restarting under a
    // connection that never dropped — retires the live streams this Session
    // had, and the bridge forgets which Session this reader is on. Landing the
    // baseline read again is what re-arms both: the read re-registers the
    // live follow, and anything that arrived in the gap comes with the page.
    return manager.on('established', () => { setTailEpoch(epoch => epoch + 1) })
  }, [manager])

  useEffect(() => {
    // Baseline: tail page (with projections watermark), then live frames take over.
    let alive = true
    // A screen that changes Session (or reconnects) starts the walk over: the
    // store keeps what it already has, so it resumes from the current oldest.
    backfillRun.current += 1
    backfillStop.current = false
    setBackfill('idle')
    setBackfilled(0)
    hasMoreRef.current = false
    setHasOlderHistory(false)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    void loadHistoryTail().then(() => {
      if (alive && hasMoreRef.current) void backfillHistory()
    })
    let pending = false
    const off = manager.store.on('changed', ({ sessionId: changed }) => {
      if (changed !== undefined && changed !== sessionId) return
      lastFrameAt.current = Date.now()
      healMissingTail()
      if (pending) return
      pending = true
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        if (!alive) return
        pending = false
        refresh()
      }, 50)
    })
    if (alive) refresh()
    return () => {
      alive = false
      off()
      if (refreshTimer !== null) clearTimeout(refreshTimer)
    }
  }, [backfillHistory, healMissingTail, loadHistoryTail, manager, sessionId, refresh, tailEpoch])
  useEffect(() => () => {
    mountedRef.current = false
    if (listInteractionEndTimer.current !== null) clearTimeout(listInteractionEndTimer.current)
    if (tailFollowFrame.current !== null) cancelAnimationFrame(tailFollowFrame.current)
  }, [])
  useEffect(() => {
    // The heal above hangs off the next frame, and a stream that died at the
    // end of a turn never sends one. This is the only thing that notices, and
    // it is two seq comparisons per tick — the whole cost of running it while
    // a Session sits quietly open.
    const timer = setInterval(healSilentStream, 2_000)
    return () => clearInterval(timer)
  }, [healSilentStream])
  useEffect(() => { void loadModels() }, [loadModels])

  /**
   * Reads the goal's process-local activation, which the durable `goal`
   * projection deliberately omits. Hosts without the bridge mapping answer
   * `mobile-forbidden`; the projection stays authoritative there.
   */
  const goalActivationRequest = useRef(0)
  const refreshGoalActivation = useCallback(async (): Promise<void> => {
    const client = manager.client
    if (client === null) return
    if (!(manager.compatibility?.features ?? []).includes('goal-state')) return
    const request = ++goalActivationRequest.current
    try {
      const view = await client.goalState.get({ sessionId })
      if (request !== goalActivationRequest.current) return
      setGoal((current) => {
        if (current === null) return current
        if (view === null || view.id !== current.id) return { ...current, activation: undefined }
        return { ...current, phase: view.phase, activation: view.activation }
      })
    } catch {
      // Activation is a fidelity extra: a failed read must not clear the goal.
    }
  }, [manager, sessionId])

  const goalId = goal?.id
  const goalRevision = goal?.revision
  const goalPhase = goal?.phase
  useEffect(() => {
    if (goalId === undefined) return
    void refreshGoalActivation()
  }, [goalId, goalPhase, goalRevision, refreshGoalActivation])

  useEffect(() => manager.store.on('remoteEvent', ({ event, args }) => {
    if (event === 'commands/change') {
      setCommands([])
      setCommandStatus('idle')
      if (plusOpen) void loadCommands(true)
    } else if (event === 'agent-preset/selected' && args[0] === sessionId) {
      setPresets([])
      setPresetStatus('idle')
      void loadModels()
    } else if (event === 'goal/activation-changed') {
      // The durable projection carries phase only; activation is process-local,
      // so it has to be read from goals/get on every change. This emit carries
      // one payload object (unlike the positional api-session/* emits).
      const payload = args[0]
      const changed = typeof payload === 'object' && payload !== null
        ? (payload as { sessionId?: unknown }).sessionId
        : undefined
      if (changed === sessionId) void refreshGoalActivation()
    } else if (event === 'llm/adapters-updated' || event === 'credentials/reference-updated') {
      void loadModels()
    }
  }), [loadCommands, loadModels, manager, plusOpen, refreshGoalActivation, sessionId])

  useEffect(() => () => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
  }, [])

  /**
   * Picks one browsed path into the draft as an `@` reference and keeps a chip
   * for it, so the composer shows what the prompt now carries.
   */
  const insertReference = useCallback((reference: InsertedReference): void => {
    const mention = fileMention(reference.path, reference.kind)
    if (mention === null) return
    setBrowserOpen(false)
    setDraft(current => `${current === '' || /\s$/.test(current) ? current : `${current} `}${mention} `)
    setInsertedRefs(current => [...current.filter(entry => entry.path !== reference.path).slice(-5), reference])
    composerRef.current?.focus()
  }, [])

  /** Drops one chip together with the mention it stands for. */
  const removeReference = useCallback((reference: InsertedReference): void => {
    const mention = fileMention(reference.path, reference.kind)
    if (mention !== null) setDraft(current => current.replace(`${mention} `, '').replace(mention, ''))
    setInsertedRefs(current => current.filter(entry => entry.path !== reference.path))
  }, [])

  // Chips follow the draft: editing a mention away also retires its chip.
  const visibleRefs = insertedRefs.filter((reference) => {
    const mention = fileMention(reference.path, reference.kind)
    return mention !== null && draft.includes(mention)
  })

  /**
   * The send circle's enabled state, shared by its style and its `disabled`
   * prop: a draft, a picked image, an uploaded file or a queued-prompt edit all
   * give the composer something to submit — the same rule the web applies when
   * it dims the button at 0.4.
   */
  const canSubmit = draft.trim() !== ''
    || pendingImages.length > 0
    || pendingFiles.some(file => file.status === 'ready')
    || editingItem !== null

  const canRateMessages = (manager.compatibility?.features ?? []).includes('message-feedback')

  /** Re-reads the durable ratings of this Session (list is authoritative). */
  const loadFeedback = useCallback(async (): Promise<void> => {
    const client = manager.client
    if (client === null || !canRateMessages) return
    const result = await client.feedback.list({ sessionId }).catch(() => null)
    if (result === null || !result.ok) return
    setFeedback(Object.fromEntries(result.value.items.map(item => [item.messageId, item])))
  }, [canRateMessages, manager, sessionId])

  useEffect(() => { void loadFeedback() }, [loadFeedback])

  /**
   * Writes one rating, or clears it. The host is compare-and-set: a conflict
   * carries the authoritative item, so one retry is enough.
   */
  const rateMessage = async (item: ConversationItem, rating: MobileFeedbackRating | null): Promise<void> => {
    const client = manager.client
    const messageId = item.kind === 'assistant' ? item.messageId : undefined
    if (client === null || messageId === undefined) return
    const current = feedback[messageId]
    if (rating === null) {
      if (current === undefined) return
      const removed = await client.feedback.delete({ sessionId, messageId, ifVersion: current.version }).catch(() => null)
      if (removed === null) { showNotice(t('notice.connectionUnavailable')); return }
      if (!removed.ok) {
        showNotice(t('notice.feedbackFailed', { message: removed.error.code }))
        await loadFeedback()
        return
      }
      setFeedback((previous) => {
        const next = { ...previous }
        delete next[messageId]
        return next
      })
      showNotice(t('notice.feedbackCleared'))
      return
    }
    let result = await client.feedback.put({
      sessionId, messageId, rating, ifVersion: current?.version ?? null,
    }).catch(() => null)
    if (result !== null && !result.ok && result.error.code === 'version-conflict') {
      result = await client.feedback.put({
        sessionId, messageId, rating, ifVersion: result.error.current?.version ?? null,
      }).catch(() => null)
    }
    if (result === null) { showNotice(t('notice.connectionUnavailable')); return }
    if (!result.ok) {
      showNotice(t('notice.feedbackFailed', { message: result.error.code }))
      await loadFeedback()
      return
    }
    setFeedback(previous => ({ ...previous, [messageId]: result.value }))
    showNotice(t('notice.feedbackSaved'))
  }

  const send = async (): Promise<void> => {
    const client = manager.client
    const text = draft.trim()
    const readyFiles = pendingFiles.filter(file => file.status === 'ready' && file.receiptId !== undefined)
    if (client === null || (text === '' && pendingImages.length === 0 && readyFiles.length === 0)) return
    if (editingItem !== null && readyFiles.length > 0) {
      showNotice(t('plus.fileUploadFailed', { message: 'queued edits do not support file attachments' }))
      return
    }
    Keyboard.dismiss()
    setDraft('')
    // Edit mode: rewrite the queued item in place instead of a new prompt.
    if (editingItem !== null) {
      const editResult = await client.sessions.updateQueue({
        sessionId,
        itemId: editingItem.id,
        action: { kind: 'edit', content: [{ type: 'text', text }] },
      } as never)
      if (!editResult.result.ok) setDraft(text)
      else setEditingItem(null)
      return
    }
    // Hermes may report a non-IANA zone (host validates strictly); omit then.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const clientTimeZone = typeof tz === 'string' && (tz === 'UTC' || tz.includes('/')) ? tz : undefined
    if (clientTimeZone === undefined) console.warn('[prompt] non-IANA timeZone omitted:', tz)
    // A continuable child takes human messages through its own domain: the
    // Session methods refuse one with `agent-busy`, and what actually reaches
    // the child's inbox is `subagent.prompt` under its durable parent address.
    // It has no queue, so this is the one path here that is not a queue write.
    const child = subagentReadAddress
    if (child !== null && child.mode === 'continuable') {
      if (readyFiles.length > 0) {
        showNotice(t('chat.subagentNoFiles'))
        setDraft(text)
        return
      }
      const content = buildPromptContent(text, pendingImages, [])
      let sent = false
      try {
        const result = await client.subagents.prompt({
          parentSessionId: child.parentSessionId,
          childSessionId: child.childSessionId,
          mode: 'continuable',
          content,
          ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
        } as never)
        if (result.result.ok) sent = true
        else showNotice(t('chat.sendFailed', { message: result.result.error.message }))
      } catch (error) {
        showNotice(t('chat.sendFailed', { message: error instanceof Error ? error.message : String(error) }))
      }
      if (!sent) {
        setDraft(text)
        return
      }
      setPendingImages([])
      setPendingFiles([])
      return
    }
    let result: any = null
    const content = buildPromptContent(text, pendingImages, readyFiles.map(file => ({ receiptId: file.receiptId as string })))
    try {
      const payload = { sessionId, mode: 'queue' as const, content, clientTimeZone }
      if (readyFiles.length > 0) {
        const uploadedPrompt = await client.filePrompts.prompt(payload)
        result = { result: { ok: uploadedPrompt.accepted, value: { command: uploadedPrompt.command } } }
      } else {
        result = await client.sessions.prompt(payload as never)
      }
    } catch (error) {
      result = null
      showNotice(t('chat.sendFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
    if (result === null || !result.result.ok) {
      setDraft(text) // put the draft back on failure
      if (result !== null && !result.result.ok) showNotice(t('chat.sendFailed', { message: result.result.error.message }))
      return
    }
    setPendingImages([])
    setPendingFiles([])
    // Slash commands report their result in the command slot.
    const command = result.result.value.command
    if (command?.text !== undefined && command.text !== '') showNotice(command.text)
  }

  const runCommand = async (command: string): Promise<void> => {
    const client = manager.client
    if (client === null) return
    try {
      const response = await client.commands.execute({ sessionId, line: command })
      if (response.result.kind === 'error') showNotice(t('chat.commandFailed', { message: response.result.text }))
      else if (response.result.text !== undefined && response.result.text !== '') showNotice(response.result.text)
    } catch (error) {
      showNotice(t('chat.commandFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  const runMenuCommand = async (command: PlusCommand, argument?: string): Promise<void> => {
    const client = manager.client
    if (client === null) return
    if (pendingFiles.length > 0) {
      showNotice(t('chat.commandRejectsFiles', { command: command.name }))
      return
    }
    showNotice(t('chat.executing', { command: command.name }))
    const text = argument === undefined || argument.trim() === ''
      ? `/${command.name}`
      : `/${command.name} ${argument.trim()}`
    if (command.images === true && pendingImages.length > 0) {
      try {
        const result = await client.commands.execute({
          sessionId,
          line: text,
          images: pendingImages.map(image => ({
            type: 'image',
            mediaType: image.mediaType,
            data: image.data,
            ...(image.name === null ? {} : { name: image.name }),
          })),
        })
        if (result.result.kind === 'error') {
          showNotice(t('chat.commandFailed', { message: result.result.text }))
          return
        }
        setPendingImages([])
        if (result.result.text !== undefined && result.result.text !== '') showNotice(result.result.text)
        return
      } catch (error) {
        showNotice(t('chat.commandFailed', { message: error instanceof Error ? error.message : String(error) }))
        return
      }
    }
    if (command.images !== true && pendingImages.length > 0) {
      showNotice(t('chat.commandRejectsImages', { command: command.name }))
      return
    }
    try {
      const result = await client.commands.execute({ sessionId, line: text })
      if (result.result.kind === 'error') {
        showNotice(t('chat.commandFailed', { message: result.result.text }))
        return
      }
      if (result.result.text !== undefined && result.result.text !== '') showNotice(result.result.text)
    } catch (error) {
      showNotice(t('chat.commandFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  const pickMenuCommand = (command: PlusCommand): void => {
    if (command.hint !== undefined && command.hint !== '') {
      setPlusOpen(false)
      setCommandPrompt({ command })
      return
    }
    setPlusOpen(false)
    void runMenuCommand(command)
  }

  /**
   * A command picked from the sheet. Opened by a typed trigger, the reader was
   * writing a line, so the pick finishes it in place and they can still add
   * arguments before sending; opened by the attach button, the pick is the
   * whole invocation and runs now.
   */
  const pickSheetCommand = (command: PlusCommand): void => {
    if (sheetTrigger !== 'plus') {
      setPlusOpen(false)
      insertAtTrigger(`/${command.name} `)
      return
    }
    pickMenuCommand(command)
  }

  const messageText = (item: ConversationItem): string => {
    if (item.kind === 'tool') return item.resultText !== '' ? item.resultText : item.args
    if (item.kind === 'compaction') return item.summary
    if (item.kind === 'preparing') return item.name
    if (item.kind === 'unknown') return compactJson(item.data)
    if (item.kind === 'delivery') return item.files.map(file => file.path).join('\n')
    if (item.kind === 'turn-start' || item.kind === 'turn-end') return ''
    return item.text
  }

  const messageActions = (item: ConversationItem): SheetAction[] => {
    const text = messageText(item)
    const actions: SheetAction[] = []
    // Copy is offered for every message, matching the web action row: an
    // attachment-only turn still has its args/result text to copy, and a
    // missing action reads as a missing feature.
    actions.push({ key: 'copy', label: t('actions.copy') })
    if (text !== '') actions.push({ key: 'share', label: t('actions.share') })
    if (item.kind !== 'stream') actions.push({ key: 'fork', label: t('actions.forkHere') })
    if (item.kind === 'user') actions.push({ key: 'resend', label: t('actions.resendNew') })
    if (canRateMessages && item.kind === 'assistant' && item.messageId !== undefined) {
      const current = feedback[item.messageId]
      actions.push({
        key: 'feedback-up',
        label: current?.rating === 'positive' ? `${t('actions.feedbackUp')} ✓` : t('actions.feedbackUp'),
      })
      actions.push({
        key: 'feedback-down',
        label: current?.rating === 'negative' ? `${t('actions.feedbackDown')} ✓` : t('actions.feedbackDown'),
      })
      if (current !== undefined) actions.push({ key: 'feedback-clear', label: t('actions.feedbackClear') })
    }
    return actions
  }

  /**
   * Fork the session at one boundary seq. The web branches only from a
   * completed turn's tail and sends that turn's real `turn/end` seq (the Host
   * cuts exactly there); the long-press menu's "branch here" keeps its older
   * per-message anchor and shares this one transport.
   */
  const forkAtSeq = async (seq: number): Promise<void> => {
    const client = manager.client
    const result = await client?.sessions.fork({ sessionId, atSeq: seq } as never).catch(() => null)
    const rpc = result?.result
    if (rpc === undefined) {
      showNotice(t('notice.connectionUnavailable'))
      return
    }
    if (!rpc.ok) {
      showNotice(t('notice.forkFailed', { message: rpc.error.message }))
      return
    }
    const childId = rpc.value.sessionId
    /**
     * The web's fork service renames the child before it resolves (`increaseTitle`
     * is client-side, not an RPC field), so a branch never reads as its source in
     * the list. A rename failure leaves the branch itself intact: the notice says
     * the fork happened, which is the part the user asked for.
     */
    const sourceTitle = manager.store.title(sessionId)
    if (client !== null && sourceTitle !== undefined && sourceTitle.trim() !== '') {
      await client.sessions.rename({ sessionId: childId, title: increasedForkTitle(sourceTitle) } as never)
        .catch(() => null)
    }
    await manager.refreshBaseline().catch(() => undefined)
    showNotice(t('notice.forked'))
    onOpenSession?.(childId)
  }

  const forkAtMessage = (item: ConversationItem): Promise<void> => forkAtSeq(item.seq)

  const resendToNewSession = async (item: ConversationItem): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const created = await client.sessions.create({} as never)
    if (!created.result.ok) {
      showNotice(t('notice.createdSessionFailed', { message: created.result.error.message }))
      return
    }
    const newSessionId = created.result.value.sessionId
    const content: unknown[] = []
    if (item.kind === 'user') {
      for (const image of item.images) {
        if (image.kind === 'data') {
          content.push({ type: 'image', mediaType: image.uri.slice(5, image.uri.indexOf(';')), data: image.uri.split(',')[1] ?? '', name: image.name })
          continue
        }
        const attachment = await client.sessions.attachment({ sessionId, attachmentId: image.attachmentId } as never).catch(() => null)
        const value = attachment?.result.ok ? attachment.result.value as { attachment: { mediaType: string }; data: string } : null
        if (value !== null) {
          content.push({
            type: 'image',
            mediaType: value.attachment.mediaType,
            data: value.data,
            name: image.name,
          })
        }
      }
    }
    const text = item.kind === 'user' ? item.text : messageText(item)
    if (text.trim() !== '') content.unshift({ type: 'text', text })
    if (content.length === 0) {
      showNotice(t('notice.noResendContent'))
      return
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const clientTimeZone = typeof tz === 'string' && (tz === 'UTC' || tz.includes('/')) ? tz : undefined
    const sent = await client.sessions.prompt({
      sessionId: newSessionId,
      mode: 'queue',
      content,
      ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
    } as never)
    if (!sent.result.ok) {
      showNotice(t('notice.resendFailed', { message: sent.result.error.message }))
      return
    }
    showNotice(t('notice.resent'))
    onOpenSession?.(newSessionId)
  }

  const runMessageAction = async (key: string): Promise<void> => {
    const item = messageAction
    setMessageAction(null)
    if (item === null) return
    if (key === 'copy') { void Clipboard.setString(messageText(item)); return }
    if (key === 'share') { void Share.share({ message: messageText(item) }).catch(() => undefined); return }
    if (key === 'fork') { await forkAtMessage(item); return }
    if (key === 'resend') { await resendToNewSession(item); return }
    if (key === 'feedback-up') { await rateMessage(item, 'positive'); return }
    if (key === 'feedback-down') { await rateMessage(item, 'negative'); return }
    if (key === 'feedback-clear') { await rateMessage(item, null); return }
  }

  const jumpToItem = (target: ConversationItem): void => {
    /**
     * The search sheet indexes `items`, but the list renders `listRows`: tool
     * calls, turn boundaries and reasoning-only answers are not rows of their
     * own, so an item index would land several rows off. `rowIndexOfItemKey`
     * resolves the row that actually carries the target, and a folded step
     * points at its turn rather than scrolling nowhere.
     */
    const index = rowIndexOfItemKey.get(target.key)
    if (index === undefined) return
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.15 })
  }

  const selectPermission = (value: string): void => {
    if (value === 'danger-full-access') {
      Alert.alert(t('chat.fullAccessTitle'), t('chat.fullAccessMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('chat.enable'), style: 'destructive', onPress: () => { void runCommand('/permission danger-full-access') } },
      ])
      return
    }
    void runCommand(`/permission ${value}`)
  }

  const cancel = async (): Promise<void> => {
    await manager.client?.sessions.cancel({ sessionId } as never).catch(() => undefined)
  }

  const queueAction = async (itemId: string, action: 'remove' | 'steer'): Promise<void> => {
    await manager.client?.sessions.updateQueue({ sessionId, itemId, action: { kind: action } } as never)
      .catch(() => undefined)
  }

  const startEdit = (item: QueuedInboxItem): void => {
    setEditingItem({ id: item.id })
    setDraft(queuePreview(item))
  }

  const answerQuestion = useCallback(async (rpcId: string, answer: QuestionAnswerPayload): Promise<void> => {
    const receipt = await manager.client?.respond({
      type: 'client-response',
      rpcId: rpcId as never,
      result: { ok: true, value: { sessionId, answer } },
    })
    if (receipt !== undefined && !receipt.accepted) {
      throw new Error(t('chat.questionStale'))
    }
    manager.store.resolveQuestion(sessionId, rpcId)
  }, [manager, sessionId, t])

  const cancelQuestion = useCallback(async (rpcId: string): Promise<void> => {
    const receipt = await manager.client?.respond({
      type: 'client-response',
      rpcId: rpcId as never,
      result: {
        ok: false,
        error: { code: 'cancelled', message: t('chat.questionCancelled'), details: {} },
      },
    })
    if (receipt !== undefined && !receipt.accepted) {
      throw new Error(t('chat.questionStale'))
    }
    manager.store.resolveQuestion(sessionId, rpcId)
  }, [manager, sessionId, t])

  const session = manager.store.sessions.get(sessionId)
  const approvals = [...(session?.pendingApprovals.values() ?? [])]
  const questions = [...(session?.pendingQuestions.values() ?? [])]
  // Same label the Web conversation header shows: title, else the workspace
  // name, else the id.
  const summary = manager.store.summaries.find(item => item.sessionId === sessionId)
  const title = sessionDisplayTitle({
    title: manager.store.title(sessionId),
    ...(summary?.cwd === undefined ? {} : { cwd: summary.cwd }),
    sessionId,
  })

  // One process disclosure per turn — the shape the web uses, so a turn's
  // reasoning stops competing with its answer. The order comes from core
  // (prompt → process → answer); building it here is what split the transcript.
  //
  // The disclosure rides inside the answer's card (the web's own is chrome-free
  // and sits in the answer's flow), so only a turn that has no answer yet — a
  // live turn still calling tools — needs a card of its own.
  // Row building lives in core: the rows are not the conversation items (tool
  // calls and reasoning-only answers have no row of their own), and the same
  // grouping answers where a search hit's jump must land.
  //
  // The Host's run state goes with them: when it says the Session is idle, a
  // turn whose closing event the live stream dropped renders as finished
  // instead of leaving a clock running over it forever.
  const { turns, rows: listRows, rowIndexOfItemKey } = buildTranscript(items, {
    running: session === undefined ? undefined : hostRunningOf(session),
  })
  /**
   * The running turn, for the transcript's own bottom indicator: the web keeps
   * a live clock there so a long turn never looks stalled. It rides the last
   * turn rather than a separate stream flag, which is what makes it disappear
   * the moment the turn settles.
   */
  const liveTurn = turns.at(-1)?.live === true ? turns.at(-1) : undefined
  /** What sits directly above the running line, for its separating rule. */
  const lastRow = listRows.at(-1)
  /**
   * The header switcher's rows, derived from exactly the projections the Web's
   * catalog reads: the parent's durable `subagentCatalog`, each child's own
   * `subagentTiming` / `tokenUsage` / `title`, and the Session list's liveness.
   * Deriving beats fetching here — every one of those values already arrives on
   * this client's own mux stream, so the list is live without a request.
   */
  const subRows = subagentRows(manager.store, sessionId, subNow)
  const subRowsOf = useCallback(
    (parentId: string, now: number) => subagentRows(manager.store, parentId, now),
    [manager.store],
  )
  const subLive = subRows.some(row => row.activity === 'running')
  useEffect(() => {
    if (!lineageOpen || !subLive) return
    const timer = setInterval(() => setSubNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [lineageOpen, subLive])

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('chat.back')}
        >
          <Icon name="ChevronLeftOutline" size={22} color={colors.accent} />
          <Text style={styles.backLabel}>{t('chat.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <SubagentSwitcher
          rows={subRows}
          currentSessionId={sessionId}
          open={lineageOpen}
          now={subNow}
          rowsOf={subRowsOf}
          onToggle={() => { setSubNow(Date.now()); setLineageOpen(open => !open) }}
          onClose={() => setLineageOpen(false)}
          onSwitch={id => onOpenSession?.(id)}
        />
        <TouchableOpacity style={styles.headerAction} onPress={() => setSearchOpen(true)} accessibilityLabel={t('chat.searchCurrent')}>
          <Icon name="SearchOutline" size={20} color={colors.accent} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerMenu} onPress={() => setMenuOpen(true)} accessibilityLabel={t('chat.more')}>
          <Icon name="EllipsisOutline" size={20} color={colors.accent} />
        </TouchableOpacity>
      </View>
      {(() => {
        const s = manager.store.summaries.find(x => x.sessionId === sessionId)
        // The parent's own title when this client already holds it — the same
        // label the switcher lists it under — and a short handle otherwise.
        // The raw id starts with `session-`, so its first characters identify
        // nothing.
        const parentSessionId = s?.parentSessionId
        const parentTitle = parentSessionId === undefined ? undefined : manager.store.title(parentSessionId)
        const parentLabel = parentTitle !== undefined && parentTitle.trim() !== ''
          ? parentTitle
          : shortSessionId(parentSessionId ?? '')
        return (
          <View style={styles.metaHeader}>
            <View style={styles.metaText}>
              {s?.cwd !== undefined && <Text style={styles.metaLine} numberOfLines={1}>{t('chat.directory', { value: s.cwd })}</Text>}
              {s?.agentPreset !== undefined && <Text style={styles.metaLine} numberOfLines={1}>{t('chat.preset', { value: s.agentPreset })}</Text>}
              {/* The way back to a subagent's parent, besides the back gesture:
                  the parent's own header carries the switcher, but the child's
                  cannot, so this line is the only affordance down here. */}
              {s?.parentSessionId !== undefined && (
                <TouchableOpacity
                  onPress={() => onOpenSession?.(s.parentSessionId as string)}
                  disabled={onOpenSession === undefined}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.openParent')}
                >
                  <Text style={[styles.metaLine, styles.metaLink]} numberOfLines={1}>
                    {t('chat.parentSession', { value: parentLabel })}
                  </Text>
                </TouchableOpacity>
              )}
              <Text style={styles.metaLine} numberOfLines={1}>
                {t('chat.updated', { value: new Date(s?.updatedAt ?? Date.now()).toLocaleString(locale, { hour12: false }) })}
                {s?.origin === 'subagent' ? t('chat.subagentMeta') : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.modelChip} onPress={() => void openModels()}>
              <Text style={styles.modelChipText} numberOfLines={1}>{modelLabel}</Text>
            </TouchableOpacity>
          </View>
        )
      })()}
      {permissions !== undefined && (
        <ScrollView horizontal style={styles.permissionBar} contentContainerStyle={styles.permissionContent} showsHorizontalScrollIndicator={false}>
          {permissions.options.map(option => {
            const active = option.value === permissions.currentValue
            const danger = option.value === 'danger-full-access'
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.chip, active && styles.chipActive, danger && styles.permissionDanger]}
                disabled={active}
                onPress={() => selectPermission(option.value)}
              >
                <Text style={[styles.chipText, danger && { color: colors.danger }]}>{commonLabel(option.name, t)}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}
      {historyStatus === 'error' && (
        <View style={styles.historyErrorBar}>
          <Text style={styles.historyErrorText} numberOfLines={3}>
            {t('chat.historyFailed', { message: historyError })}
          </Text>
          <TouchableOpacity
            style={styles.historyRetry}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
            onPress={() => void loadHistoryTail()}
          >
            <Text style={styles.historyRetryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* The transcript frame carries the web's floating control, so a growing
          input card below never covers it and the reader can always get back
          to the newest message. */}
      <View style={styles.listWrap}>
        <FlatList
          ref={listRef}
          data={listRows}
          keyExtractor={row => row.key}
          contentContainerStyle={styles.listContent}
          // Only armed while the reader is holding their place in older history:
          // the anchor is what keeps a prepended page from moving what they are
          // reading, and it is the follow scroll that keeps the newest row in
          // view while the model streams. See `followTailRef`.
          maintainVisibleContentPosition={followTail ? undefined : { minIndexForVisible: 0 }}
          // A refused read is the bar's to explain; claiming "no messages yet"
          // underneath it would contradict what just went wrong.
          ListEmptyComponent={historyStatus === 'error' ? undefined : (
            <View style={styles.transcriptEmpty}>
              {historyStatus === 'loading' && <ActivityIndicator color={colors.accent} />}
              <Text style={styles.transcriptEmptyText}>
                {historyStatus === 'loading' ? t('chat.loadingHistory') : t('chat.empty')}
              </Text>
            </View>
          )}
          ListFooterComponent={liveTurn === undefined
            ? undefined
            : (
              // The web keeps the rule out when the row above is the prompt that
              // opened the turn: the status then reads as part of that prompt's
              // own block rather than as a separator from the transcript.
              <RunningIndicator
                startedAt={liveTurn.startedAt}
                divider={lastRow !== undefined && lastRow.kind === 'item'
                  && lastRow.item.kind !== 'user' && lastRow.item.kind !== 'stream'}
              />
            )}
          ListHeaderComponent={hasOlderHistory ? (
            backfill === 'running' ? (
              <View style={styles.historyLoader}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.historyLoaderText}>{t('chat.backfilling', { count: backfilled })}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.pauseBackfill')}
                  onPress={pauseBackfill}
                >
                  <Text style={styles.historyLoaderText}>{t('chat.pauseBackfill')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.historyLoader}
                onPress={() => void backfillHistory()}
              >
                <Text style={styles.historyLoaderText}>
                  {backfill === 'failed' ? t('chat.retryOlder') : t('chat.loadOlder')}
                </Text>
              </TouchableOpacity>
            )
          ) : undefined}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onScroll={onListScroll}
          onLayout={onListLayout}
          onScrollBeginDrag={onListScrollBeginDrag}
          onScrollEndDrag={onListScrollEndDrag}
          onMomentumScrollBegin={onListMomentumScrollBegin}
          onMomentumScrollEnd={onListMomentumScrollEnd}
          scrollEventThrottle={16}
          onContentSizeChange={onListContentSizeChange}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: true })
          }}
          renderItem={({ item, index }) => {
            // The web's flow rhythm: process rows sit 6px apart, a response is
            // separated from its neighbour by 12px, and a turn header keeps 16px
            // clearance from the input above it and the answer below.
            const rowGap = item.kind === 'turn'
              ? 16
              : item.item.kind === 'user' || item.item.kind === 'assistant' || item.item.kind === 'stream'
                ? 12
                : 6
            const rowStyle = { marginTop: index === 0 ? 0 : rowGap }
            if (item.kind === 'turn') {
              return (
                <View style={rowStyle}>
                  <TurnProcessBlock
                    turn={item.turn}
                    steps={item.steps}
                    summary={item.summary}
                    toolCallCount={item.toolCallCount}
                    manager={manager}
                    sessionId={sessionId}
                    onLongPress={setMessageAction}
                    onOpenLink={openTranscriptLink}
                  />
                </View>
              )
            }
            const entry = item.item
            const messageId = entry.kind === 'assistant' ? entry.messageId : undefined
          /**
           * The turn's billed tokens ride the answer's own action row, the way
           * the web seats its usage pill in the completion row. Only the row
           * that owns the turn's answer carries the process, so only it can sum
           * the turn's usage — and a turn with nothing to disclose has no
           * process to sum, so its single step's own accounting is the turn's.
           */
          const turnUsage = entry.kind !== 'assistant'
            ? null
            : item.process !== undefined
              ? turnTokenUsage(item.process)
              : entry.usage === undefined ? null : stepTokenUsage(entry.usage)
            /**
             * The web hangs its icon row on the turn tail and only once the turn
             * has closed (`closing === null` renders the tail alone): a message
             * that is still being written has nothing to copy, rate or fork yet,
             * and a prompt keeps its own clock row throughout.
             */
            const actions = entry.kind === 'user' || (entry.kind === 'assistant' && !item.turn.live)
              ? (
                <MessageActionRow
                  time={typeof entry.time === 'number' ? entry.time : 0}
                  clock={entry.kind === 'user' ? 'start' : 'end'}
                  {...(messageId === undefined ? {} : { rating: feedback[messageId] })}
                  canRate={canRateMessages && messageId !== undefined}
                  {...(item.branch === undefined ? {} : { branch: item.branch })}
                  {...(turnUsage === null ? {} : { usage: turnUsage })}
                  onCopy={() => {
                    void Clipboard.setString(messageText(entry))
                    showNotice(t('notice.copied'))
                  }}
                  onRate={next => void rateMessage(entry, next)}
                  onBranch={() => {
                    if (item.branch?.seq === undefined) {
                      showNotice(t('actions.branchUnavailable'))
                      return
                    }
                    void forkAtSeq(item.branch.seq)
                  }}
                />
              )
              : undefined
            return (
              <View style={rowStyle}>
                <Bubble
                  item={entry}
                  manager={manager}
                  sessionId={sessionId}
                  onLongPress={() => setMessageAction(entry)}
                  onPreview={setPreviewPath}
                  onOpenLink={openTranscriptLink}
                  {...(item.process === undefined ? {} : { process: item.process })}
                  {...(actions === undefined ? {} : { actions })}
                />
              </View>
            )
          }}
        />
        {!followTail && (
          <TouchableOpacity
            style={styles.toBottom}
            accessibilityRole="button"
            accessibilityLabel={t('chat.toBottom')}
            onPress={returnToBottom}
          >
            <Icon name="ChevronDownOutline" size={16} color={chat.labelPrimary} />
          </TouchableOpacity>
        )}
      </View>
      {planMode !== undefined && <PlanChip mode={planMode} />}
      <GoalBar
        goal={goal}
        onEdit={() => setGoalPrompt('edit')}
        onPause={() => void goalAction('pause')}
        onResume={() => void goalAction('resume')}
        onComplete={() => void goalAction('complete')}
        onClear={() => void goalAction('clear')}
      />
      {goal?.phase === 'paused' && (
        <Text style={styles.goalPausedHint}>{t('chat.goalPausedTurn')}</Text>
      )}
      <TodoStrip todos={todos} />
      {notice !== null && (
        <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View>
      )}
      {jobs.length > 0 && (
        <JobsStrip jobs={jobs} open={jobsOpen} onToggle={() => setJobsOpen(o => !o)} />
      )}
      {queue.length > 0 && (
        <QueueDock
          queue={queue}
          editingId={editingItem?.id ?? null}
          onEdit={startEdit}
          onRemove={id => void queueAction(id, 'remove')}
          onSteer={id => void queueAction(id, 'steer')}
        />
      )}
      {(approvals.length > 0 || questions.length > 0) && (
        <ActionBar
          manager={manager}
          sessionId={sessionId}
          onAnswerQuestion={answerQuestion}
          onCancelQuestion={cancelQuestion}
          onApprovalStale={() => showNotice(t('chat.approvalStale'))}
        />
      )}
      <SessionStatsBar view={statsView} />
      <View style={styles.composer}>
        {lightbox !== null && (
          <ImageLightbox visible source={lightbox.source} name={lightbox.name} onClose={() => setLightbox(null)} />
        )}
        {/* The web's composer card: one panel-radius surface holding the draft
            and its control row, with the attachment and reference chips as the
            card's own accessory — not separate strips above it. */}
        <View style={styles.composerCard}>
          {composerReadOnly !== null ? (
            <View style={styles.composerNotice}>
              <Text style={styles.composerNoticeTitle}>
                {t(composerReadOnly === 'one-shot'
                  ? 'subagent.readOnly.oneShotTitle'
                  : 'subagent.readOnly.title')}
              </Text>
              <Text style={styles.composerNoticeBody}>
                {t(composerReadOnly === 'one-shot'
                  ? 'subagent.readOnly.oneShotBody'
                  : 'subagent.readOnly.body')}
              </Text>
            </View>
          ) : (
            <>
          {editingItem === null && (pendingImages.length > 0 || pendingFiles.length > 0) && (
            <View style={styles.composerAccessory}>
              {pendingImages.length > 0 && (
                <ScrollView horizontal style={styles.pendingImagesRow} contentContainerStyle={styles.pendingImagesContent}>
                  {pendingImages.map((image, index) => (
                    <TouchableOpacity
                      key={`${image.name ?? 'image'}:${index}`}
                      style={styles.pendingImageCard}
                      onPress={() => setLightbox({ source: `data:${image.mediaType};base64,${image.data}`, name: image.name ?? undefined })}
                    >
                      <Image source={{ uri: `data:${image.mediaType};base64,${image.data}` }} style={styles.pendingImage} />
                      <TouchableOpacity
                        style={styles.pendingImageRemove}
                        hitSlop={8}
                        onPress={() => setPendingImages(current => current.filter((_, removeIndex) => removeIndex !== index))}
                      >
                        <Icon name="CloseOutline" size={11} color="#fff" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {pendingFiles.length > 0 && (
                <ScrollView horizontal style={styles.pendingFilesRow} contentContainerStyle={styles.pendingFilesContent}>
                  {pendingFiles.map(file => (
                    <View key={file.id} style={styles.pendingFileCard}>
                      <View style={styles.pendingFileHeader}>
                        <Text style={styles.pendingFileName} numberOfLines={1}>{file.name}</Text>
                        <TouchableOpacity hitSlop={8} onPress={() => setPendingFiles(current => current.filter(item => item.id !== file.id))}>
                          <Icon name="CloseOutline" size={11} color="#fff" />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.pendingFileMeta}>{formatBytes(file.bytes)}</Text>
                      {file.status === 'uploading' && (
                        <View style={styles.pendingFileProgress}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.pendingFileStatus}>{t('common.loading')}</Text></View>
                      )}
                      {file.status === 'ready' && <Text style={[styles.pendingFileStatus, { color: colors.accent }]}>{t('common.current')}</Text>}
                      {file.status === 'error' && <Text style={[styles.pendingFileStatus, { color: colors.danger }]} numberOfLines={1}>{file.error ?? t('plus.fileUploadFailed', { message: '' })}</Text>}
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
          {visibleRefs.length > 0 && (
            <View style={styles.refRow}>
              {visibleRefs.map(reference => (
                <View key={reference.path} style={styles.refChip}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.refBody}
                    onPress={() => setPreviewPath(reference.path)}
                  >
                    <Text style={styles.refName} numberOfLines={1}>
                      {reference.path.split(/[\\/]/).at(-1) ?? reference.path}
                    </Text>
                    <Text style={styles.refMeta}>
                      {reference.kind === 'directory' ? t('common.directory') : reference.size === undefined ? '' : formatBytes(reference.size)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('common.delete')}
                    onPress={() => removeReference(reference)}
                    hitSlop={8}
                  >
                    <Icon name="CloseOutline" size={14} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <TextInput
            ref={composerRef}
            style={styles.input}
            value={draft}
            onChangeText={onDraftChange}
            placeholder={editingItem !== null ? t('chat.editQueuePlaceholder') : running ? t('chat.queuePlaceholder') : t('chat.sendPlaceholder')}
            placeholderTextColor={chat.labelCaption}
            multiline
            // Multiline submit is a TextInput behavior, not a key handler: on
            // Android a hardware Enter reaches neither onKeyPress nor
            // preventDefault, and a soft keyboard's return key inserts a
            // newline for multiline fields. `submitBehavior` makes the input's
            // own submit path fire onSubmitEditing instead (verified on the
            // emulator: onKeyPress left the newline in the draft).
            submitBehavior={enterToSend ? 'submit' : 'newline'}
            onSubmitEditing={() => { if (enterToSend) void send() }}
          />
          {/* The web's control row: the attach circle pins left, the send
              circle right, and the two never move the draft's own geometry. */}
          <View style={styles.composerRow}>
            {editingItem === null && (
              <TouchableOpacity
                style={styles.addButton}
                hitSlop={8}
                onPress={() => openPlus('commands', '', 'plus')}
                accessibilityRole="button"
                accessibilityLabel={t('chat.add')}
              >
                <Icon name="PlusOutlineMedium" size={14} color={chat.labelPrimary} />
              </TouchableOpacity>
            )}
            {editingItem !== null && (
              <TouchableOpacity style={styles.editCancel} hitSlop={8} onPress={() => { setEditingItem(null); setDraft('') }}>
                <Icon name="CloseOutline" size={15} color={chat.labelTertiary} />
              </TouchableOpacity>
            )}
            <View style={styles.composerSpacer} />
            {running ? (
              <TouchableOpacity
                style={styles.sendCircle}
                hitSlop={6}
                onPress={() => void cancel()}
                accessibilityRole="button"
                accessibilityLabel={t('chat.stop')}
              >
                <Icon name="StopSolid" size={16} color="#fff" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.sendCircle, !canSubmit && styles.sendCircleDisabled]}
                disabled={!canSubmit}
                hitSlop={6}
                onPress={() => void send()}
                accessibilityRole="button"
                accessibilityLabel={editingItem !== null ? t('chat.save') : t('chat.send')}
              >
                <Icon name="SendSolid" size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
            </>
          )}
        </View>
      </View>
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <ModalBackdrop onClose={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuRow} onPress={() => { setMenuOpen(false); setRenameOpen(true) }}>
              <Text style={styles.menuText}>{t('chat.renameAction')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => void fork()}>
              <Text style={styles.menuText}>{t('chat.forkAction')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => void openModels()}>
              <Text style={styles.menuText}>{t('chat.switchModel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => void openSubagents()}>
              <Text style={styles.menuText}>{t('chat.subagents')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => { setMenuOpen(false); setGoalPrompt(goal === null ? 'create' : 'edit') }}>
              <Text style={styles.menuText}>{goal === null ? t('plus.goalCreate') : t('plus.goalEdit')}</Text>
            </TouchableOpacity>
            {(manager.compatibility?.features ?? []).includes('workspace-files') && (
              <TouchableOpacity style={styles.menuRow} onPress={() => { setMenuOpen(false); setBrowserOpen(true) }}>
                <Text style={styles.menuText}>{t('chat.workspaceFiles')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ModalBackdrop>
      </Modal>
      <Modal transparent visible={subOpen !== null} animationType="fade" onRequestClose={() => setSubOpen(null)}>
        <ModalBackdrop onClose={() => setSubOpen(null)}>
          {subOpen !== null && (
            <SubagentPanel
              manager={manager}
              parentSessionId={sessionId}
              catalog={subOpen}
              onClose={() => setSubOpen(null)}
              onOpenSession={id => { setSubOpen(null); onOpenSession?.(id) }}
            />
          )}
        </ModalBackdrop>
      </Modal>
      <Modal transparent visible={modelMenu !== null} animationType="fade" onRequestClose={() => setModelMenu(null)}>
        <ModalBackdrop onClose={() => setModelMenu(null)}>
          <ScrollView style={styles.modelCard}>
            {modelMenu?.routable === false && (
              <Text style={styles.modelWarning}>{t('chat.modelRouteUnavailable')}</Text>
            )}
            {modelMenu?.groups.map(group => (
              <View key={group.id}>
                <Text style={styles.modelGroup}>{group.name}</Text>
                {group.models.map(model => (
                  <React.Fragment key={model.id}>
                    <TouchableOpacity
                      style={[styles.menuRow, modelMenu.current.model === model.id && styles.menuRowActive]}
                      onPress={() => {
                        if (model.reasoning === undefined) { void selectModel(group.id, model.id); return }
                        setPendingModel({ providerId: group.id, modelId: model.id, efforts: model.reasoning.efforts })
                      }}
                    >
                      <Text style={styles.menuText} numberOfLines={1}>{model.name}</Text>
                    </TouchableOpacity>
                    {pendingModel?.providerId === group.id && pendingModel.modelId === model.id && (
                      model.reasoning?.efforts.map(effort => (
                        <TouchableOpacity
                          key={effort.id}
                          style={[
                            styles.menuRow,
                            styles.submenuRow,
                            modelMenu.current.model === model.id &&
                              modelMenu.current.reasoningEffort === effort.id &&
                              styles.menuRowActive,
                          ]}
                          onPress={() => void selectModel(group.id, model.id, effort.id)}
                        >
                          <Text style={styles.menuText} numberOfLines={1}>{commonLabel(effort.name, t)}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </React.Fragment>
                ))}
              </View>
            ))}
            {modelMenu?.failures.map(failure => (
              <View key={failure.id} style={styles.modelFailure}>
                <Text style={styles.modelFailureTitle}>{failure.name}</Text>
                <Text style={styles.modelFailureMessage}>{failure.message}</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.menuRow} onPress={() => setModelMenu(null)}>
              <Text style={[styles.menuText, { color: colors.textDim }]}>{t('common.close')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </ModalBackdrop>
      </Modal>
      <PlusMenuSheet
        visible={plusOpen}
        initialTab={sheetTab}
        initialQuery={sheetQuery}
        commandsUnavailable={isSubagentSession ? t('plus.commandsSubagent') : undefined}
        commands={commands}
        commandStatus={commandStatus}
        commandError={commandError}
        onReloadCommands={() => { void loadCommands(true) }}
        presets={presets}
        presetStatus={presetStatus}
        presetError={presetError}
        references={references}
        referenceStatus={referenceStatus}
        permissions={permissions?.options ?? []}
        permissionValue={permissions?.currentValue}
        planActive={planMode !== undefined && planMode !== 'off'}
        hasGoal={goal !== null}
        presetSelectionEnabled={presetSelectionOn}
        modelLabel={modelLabel}
        presetLabel={manager.store.summaries.find(item => item.sessionId === sessionId)?.agentPreset}
        pendingImageCount={pendingImages.length}
        pendingFileCount={pendingFiles.length}
        uploadingFileCount={pendingFiles.filter(file => file.status === 'uploading').length}
        onClose={() => {
          // Remember which trigger was dismissed: the token is still in the
          // draft, and the next keystroke must not reopen the same sheet.
          const token = sheetTrigger === 'plus' ? null : activeComposerToken(draft)
          dismissedTrigger.current = token === null
            ? null
            : `${token.trigger}@${draft.length - token.prefix.length}`
          setPlusOpen(false)
        }}
        onPickCommand={pickSheetCommand}
        onCaptureImage={() => { setPlusOpen(false); void captureImage() }}
        onPickImages={() => { setPlusOpen(false); void chooseImages() }}
        onPickFile={() => { setPlusOpen(false); void chooseFile() }}
        onInsertReference={reference => {
          setPlusOpen(false)
          insertAtTrigger(reference.insert)
        }}
        onPermission={value => { setPlusOpen(false); selectPermission(value) }}
        onTogglePlan={() => { setPlusOpen(false); void runMenuCommand({ name: 'plan', description: t('plus.planSubtitle'), images: true }, planMode === undefined || planMode === 'off' ? '' : 'off') }}
        onGoal={() => { setPlusOpen(false); setGoalPrompt(goal === null ? 'create' : 'edit') }}
        onModel={() => { setPlusOpen(false); void openModels() }}
        onPresets={() => { void loadPresets(true) }}
        onSelectPreset={preset => {
          setPlusOpen(false)
          void manager.client?.agentPresets.select({ sessionId, agentPreset: preset.id } as never)
            .then(result => {
              if (!result.result.ok) showNotice(t('chat.switchFailed', { message: result.result.error.message }))
              else {
                void manager.refreshBaseline()
                void loadCommands(true)
              }
            })
            .catch(() => showNotice(t('chat.switchConnection')))
        }}
        onSubagents={() => { setPlusOpen(false); void openSubagents() }}
      />
      <ChatSearchSheet
        visible={searchOpen}
        items={items}
        onClose={() => setSearchOpen(false)}
        onJump={jumpToItem}
      />
      <ActionSheet
        visible={messageAction !== null}
        title={messageAction === null ? t('actions.message') : messageAction.kind === 'tool' ? t('chat.toolTitle', { name: messageAction.name }) : t('actions.message')}
        actions={messageAction === null ? [] : messageActions(messageAction)}
        onClose={() => setMessageAction(null)}
        onAction={key => { void runMessageAction(key) }}
      />
      <PromptModal
        visible={commandPrompt !== null}
        title={commandPrompt === null ? '' : `/${commandPrompt.command.name}`}
        initial=""
        confirmLabel={t('chat.execute')}
        onCancel={() => setCommandPrompt(null)}
        onConfirm={argument => {
          const command = commandPrompt?.command
          setCommandPrompt(null)
          if (command !== undefined) void runMenuCommand(command, argument)
        }}
      />
      <PromptModal
        visible={renameOpen}
        title={t('chat.renameSession')}
        initial={title}
        confirmLabel={t('common.rename')}
        onCancel={() => setRenameOpen(false)}
        onConfirm={value => void rename(value)}
      />
      <PromptModal
        visible={goalPrompt !== null}
        title={goalPrompt === 'create' ? t('plus.goalCreate') : t('plus.goalEdit')}
        initial={goal?.objective ?? ''}
        confirmLabel={goalPrompt === 'create' ? t('common.create') : t('chat.save')}
        onCancel={() => setGoalPrompt(null)}
        onConfirm={value => void goalSubmit(value)}
      />
      <FilePreviewSheet
        visible={previewPath !== null}
        path={previewPath}
        sessionId={sessionId}
        client={manager.client}
        features={manager.compatibility?.features ?? []}
        onClose={() => setPreviewPath(null)}
        onNotice={showNotice}
      />
      <WorkspaceBrowserSheet
        visible={browserOpen}
        sessionId={sessionId}
        manager={manager}
        onClose={() => setBrowserOpen(false)}
        onOpenFile={(path) => { setBrowserOpen(false); setPreviewPath(path) }}
        onInsertReference={(reference) => insertReference(reference)}
      />
    </KeyboardAvoidingView>
  )
}

function QueueDock({ queue, editingId, onEdit, onRemove, onSteer }: {
  queue: QueuedInboxItem[]
  editingId: string | null
  onEdit: (item: QueuedInboxItem) => void
  onRemove: (id: string) => void
  onSteer: (id: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <View style={styles.dock}>
      <Text style={styles.dockTitle}>{t('chat.queueTitle', { count: queue.length })}</Text>
      {queue.map(item => (
        <View key={item.id} style={styles.dockRow}>
          <View style={styles.dockBadge}><Text style={styles.dockBadgeText}>{placementLabel(item.placement)}</Text></View>
          <Text style={styles.dockPreview} numberOfLines={1}>{queuePreview(item)}</Text>
          <TouchableOpacity onPress={() => onEdit(item)} disabled={editingId === item.id}>
            <Text style={[styles.dockAction, editingId === item.id && { color: colors.textDim }]}>{t('chat.edit')}</Text>
          </TouchableOpacity>
          {item.placement === 'queued' && (
            <TouchableOpacity onPress={() => onSteer(item.id)}>
              <Text style={styles.dockAction}>{t('chat.steer')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => onRemove(item.id)}>
            <Text style={[styles.dockAction, { color: colors.danger }]}>{t('common.delete')}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  )
}

function JobsStrip({ jobs, open, onToggle }: {
  jobs: JobView[]
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const live = jobs.filter(j => j.status === 'running' || j.status === 'stopping').length
  return (
    <View style={styles.jobs}>
      <TouchableOpacity style={styles.jobsHeader} onPress={onToggle}>
        <Text style={styles.jobsTitle}>{t('chat.jobsTitle', { count: jobs.length })}{live > 0 ? t('chat.jobsLive', { live }) : ''}</Text>
        {open
          ? <Icon name="ChevronDownOutline" size={14} color={colors.textDim} />
          : <Icon name="ChevronRightOutline" size={14} color={colors.textDim} />}
      </TouchableOpacity>
      {open && jobs.map(job => (
        <View key={job.id} style={styles.jobRow}>
          <View style={[styles.jobDot, { backgroundColor: jobStatusColor(job.status) }]} />
          <View style={styles.jobText}>
            <Text style={styles.jobLabel} numberOfLines={1}>{job.label}</Text>
            <Text style={styles.jobMeta}>
              {jobKindLabel(job.kind, t)} · {jobStatusLabel(job.status, t)}{job.detail !== undefined && job.detail !== '' ? ` · ${job.detail}` : ''}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

function jobStatusColor(status: JobView['status']): string {
  switch (status) {
    case 'running': return colors.running
    case 'stopping': return colors.warning
    case 'completed': return colors.success
    case 'failed': return colors.danger
    case 'killed': return colors.textDim
  }
}

function jobStatusLabel(status: JobView['status'], t: (key: TranslationKey, values?: Record<string, string | number>) => string): string {
  switch (status) {
    case 'running': return t('session.running')
    case 'stopping': return t('chat.stopping')
    case 'completed': return t('chat.completed')
    case 'failed': return t('job.failed')
    case 'killed': return t('chat.killed')
  }
}

/**
 * One disclosure per turn, the way the web renders a turn's process: every
 * reasoning block and tool call of the turn collapses under a single row
 * labelled by what it holds, so the answer is not buried under a column of
 * per-step "思考过程" headers of assorted widths.
 */
/**
 * The transcript's own bottom indicator, the web's "深度求索中" line: a live
 * elapsed time under the newest turn, the whale that stands in for progress,
 * and — when the row above carries output rather than a prompt — the web's
 * hairline rule separating the settled transcript from the live one. It owns
 * its timer so a one-second tick re-renders this row instead of the whole
 * transcript, and it counts from the recorded turn start rather than from
 * mount, so switching screens mid-turn does not restart it.
 */
function RunningIndicator({ startedAt, divider = false }: {
  startedAt: number
  /** The web hides the rule when the row above is the prompt that opened the turn. */
  divider?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const [, tick] = useState(0)
  const known = startedAt > 0
  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = known ? Math.max(0, Date.now() - startedAt) : 0
  return (
    <View style={styles.running} accessibilityLiveRegion="polite">
      {divider && <View style={styles.runningDivider} />}
      <View style={styles.runningContent}>
        <Image source={whale} style={styles.runningWhale} />
        <Text style={styles.runningText}>
          {known
            ? t('chat.runningFor', { duration: runDurationLabel(elapsed, t) })
            : t('chat.running')}
        </Text>
      </View>
    </View>
  )
}

/**
 * One reasoning row, the Web's `ReasoningRow`: a single 24px line at rest — a
 * 14px glyph in a 16px box, the title, the Web's 2px separator, then the
 * one-line summary — that swaps to the complete text as compact Markdown once
 * it is opened.
 *
 * Two of its behaviours are the ones the reader notices. The collapsed line's
 * height never changes, so a paragraph streaming in one character at a time
 * grows nothing and nudges nothing under the reader's thumb (the Web pins the
 * same row with `contain: size layout`). And the summary follows the Web's own
 * source: while the block is still the streaming tail it names the newest
 * *completed* paragraph, because the one below it is still being written; once
 * the block settles it reads its own first line, which is where a finished
 * thought starts.
 */
function ProcessReasoningRow({ step, running, open, onToggle, onLongPress, onOpenLink }: {
  step: Extract<TurnProcessStep, { kind: 'thinking' }>
  /** This block is the live tail: still being written right now. */
  running: boolean
  open: boolean
  onToggle: () => void
  onLongPress: () => void
  onOpenLink?: ((href: string) => void) | undefined
}): React.JSX.Element {
  const { t } = useI18n()
  const summary = running ? step.preview : step.settledPreview
  return (
    <TouchableOpacity
      style={styles.reasoningRow}
      activeOpacity={1}
      onPress={onToggle}
      onLongPress={onLongPress}
    >
      <View style={styles.reasoningHead}>
        <View style={styles.reasoningGlyph}>
          <Icon name="ThinkOutline" size={14} color={chat.labelTertiary} />
        </View>
        <Text style={styles.reasoningTitle}>{t('chat.thoughtStep')}</Text>
        {!open && summary !== '' && <View style={styles.reasoningDot} />}
        {!open && summary !== '' && (
          <Text style={styles.reasoningSummary} numberOfLines={1}>{summary}</Text>
        )}
      </View>
      {open && (
        <View style={styles.reasoningBody}>
          <Markdown
            style={markdownCompactStyles}
            rules={markdownRules}
            {...onOpenLink === undefined
              ? {}
              : { onLinkPress: (href: string): boolean => { onOpenLink(href); return false } }}
          >
            {step.text}
          </Markdown>
        </View>
      )}
    </TouchableOpacity>
  )
}

/**
 * One announced-but-undispatched call: the icon and title of the row it will
 * become, plus the only progress a long file write can report before the Host
 * accepts it.
 *
 * The Web measures the argument stream exactly once, on its file-mutation
 * preparation row (`tool.preparing.content`); every other family shows its own
 * title alone until the call is dispatched, so this row does the same rather
 * than inventing a count for tools that never measured one.
 */
function ProcessPreparingRow({ step }: {
  step: Extract<TurnProcessStep, { kind: 'preparing' }>
}): React.JSX.Element {
  const { t } = useI18n()
  const variant = toolRowVariant(step.name)
  const summary = variant === 'write' || variant === 'edit'
    ? t('tool.preparingContent', { kilobytes: Math.ceil(step.argsLength / 1024) })
    : ''
  return (
    <View style={styles.processRow}>
      <View style={styles.processRowGlyph}>
        <Icon name={VARIANT_ICONS[variant]} size={14} color={chat.labelTertiary} />
      </View>
      <Text style={styles.processRowTitle} numberOfLines={1}>{toolDisplayName(step.name, t)}</Text>
      {summary !== '' && <View style={styles.processRowDot} />}
      {summary !== '' && <Text style={styles.processRowSummary} numberOfLines={1}>{summary}</Text>}
    </View>
  )
}

function TurnProcessBlock({ turn, steps, summary, toolCallCount, manager, sessionId, onLongPress, onOpenLink, bare = false }: {
  turn: Turn
  /**
   * The steps this block holds: one run of a live turn, or — once the turn
   * settles — its whole trace. The web reads a running turn run by run and
   * folds the lot into one control when it closes.
   */
  steps: TurnProcessStep[]
  /** This block's own activity: what a live header names it by. */
  summary: ProcessActivitySummary
  /** Tool calls inside this block, for the header's accessibility label. */
  toolCallCount: number
  manager: ConnectionManager
  sessionId: string
  onLongPress: (item: ConversationItem) => void
  /** Link handling for an expanded reasoning body's own Markdown. */
  onOpenLink?: ((href: string) => void) | undefined
  /** Embedded in the answer's own card, so it drops its chrome and reads as
   *  one module with the answer — the web's disclosure is fully transparent. */
  bare?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  // Collapsed by default, the way the web renders it. Once the user toggles
  // it, that choice wins for as long as the row is mounted.
  const [manual, setManual] = useState<boolean | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  /** Steps open individually: the web shows each as one truncated line and
   *  expands only the one you tap. */
  const [openSteps, setOpenSteps] = useState<Set<string>>(() => new Set())
  // A running turn opens its own process: the Web renders the live trace while
  // work happens, and a collapsed row here reads as "nothing is happening" —
  // exactly the gap that makes a long tool chain look stalled. Once the turn
  // settles it folds back to the answer, and a manual toggle always wins.
  //
  // Liveness — not "a step is in flight right now" — is what holds it open. A
  // turn between steps is still the turn being watched, and closing the block
  // for the gap between a tool result and the next chunk dropped thousands of
  // pixels and took them back on the next one: the up-and-down the reader saw
  // while the model worked.
  const open = manual ?? turn.live
  /**
   * The header says what the turn is doing, in the web's own two states. While
   * it runs, the newest step category and its one-line detail (`正在运行命令 ·
   * pwsh`) — the web's live trace rows. Once it settles, the web's toggle text
   * and nothing else: `用时 1分53秒`, or `已完成工作` without a timing, or
   * `已停止` / `处理失败` when it did not complete. The phone used to prefix
   * that with a ranked category summary (`已读取文件，执行了命令 · 用时 5秒`),
   * which the web never puts on this row — those categories are what the
   * disclosure contains, not a second title.
   */
  const liveLabel = summary.running === undefined
    ? t('chat.step.thinking')
    : stepActivityLabel(summary.running, summary.preparing ? 'preparing' : 'running', t)
  const settledLabel = turn.endReason === 'aborted'
    ? t('chat.stopped')
    : turn.endReason === 'error'
      ? t('chat.turn.failed')
      : turn.durationMs === undefined
        ? t('chat.turn.worked')
        // The web floors a measured turn at one second, so a turn that resolved
        // within the same second reads `用时 1秒`, never `用时 0秒`.
        : t('chat.turn.took', { duration: runDurationLabel(Math.max(1_000, turn.durationMs), t) })
  const label = turn.live ? liveLabel : settledLabel
  const title = turn.live && summary.runningDetail !== ''
    ? `${label}${t('chat.step.separator')}${summary.runningDetail}`
    : label
  const toggleStep = (key: string): void => {
    setOpenSteps(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <View style={bare ? styles.turnProcessBare : styles.turnProcess}>
      <TouchableOpacity
        style={styles.turnProcessHeader}
        // Toggling the state the row is actually showing: a live block is open
        // before the reader ever touches it, so the first tap has to close it.
        onPress={() => setManual(!open)}
        accessibilityRole="button"
        accessibilityLabel={toolCallCount > 0 ? t('chat.toolCallSummary', { count: toolCallCount }) : label}
      >
        <Text style={[styles.turnProcessLabel, turn.live && styles.turnProcessLive]} numberOfLines={1}>{title}</Text>
        <View style={open ? styles.turnProcessChevronOpen : undefined}>
          <Icon name="ChevronDownOutline" size={14} color={chat.labelTertiary} />
        </View>
      </TouchableOpacity>
      {open && steps.map(step => (step.kind === 'thinking'
        ? (
          <ProcessReasoningRow
            key={step.key}
            step={step}
            // Only the newest step of a live turn is still being written, which
            // is the Web's own rule (`running={streaming && i === last}`).
            running={turn.live && step.key === turn.process.at(-1)?.key}
            open={openSteps.has(step.key)}
            onToggle={() => toggleStep(step.key)}
            onLongPress={() => setCopied(step.key)}
            onOpenLink={onOpenLink}
          />
        )
        : step.kind === 'preparing'
          ? <ProcessPreparingRow key={step.key} step={step} />
          : (
            <ToolCard
              key={step.key}
              item={step.item}
              manager={manager}
              sessionId={sessionId}
              onLongPress={() => onLongPress(step.item)}
              bare
            />
          )))}
      <ActionSheet
        visible={copied !== null}
        title={t('chat.thoughtStep')}
        actions={[
          { key: 'copy', label: t('actions.copy') },
          { key: 'share', label: t('actions.share') },
        ]}
        onClose={() => setCopied(null)}
        onAction={key => {
          const step = steps.find(candidate => candidate.key === copied)
          setCopied(null)
          if (step === undefined || step.kind !== 'thinking') return
          if (key === 'copy') Clipboard.setString(step.text)
          else void Share.share({ message: step.text }).catch(() => undefined)
        }}
      />
    </View>
  )
}

const LONG_REPLY_LIMIT = 6000
const REPLY_PREVIEW_LIMIT = 1200

function CollapsibleMarkdown({ text, onOpenLink }: {
  text: string
  /**
   * Handles a tapped link. Returning nothing (rather than a boolean) also
   * suppresses the renderer's own `Linking.openURL`, which is what we want for
   * the relative file paths these transcripts are full of.
   */
  onOpenLink?: (href: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const collapsible = text.length > LONG_REPLY_LIMIT
  const [expanded, setExpanded] = useState(!collapsible)
  const previousLength = useRef(text.length)

  useEffect(() => {
    // A streaming reply can cross the limit after the component mounts.  Fold
    // it at that transition so an unbounded Markdown tree is never kept open.
    if (text.length > LONG_REPLY_LIMIT && previousLength.current <= LONG_REPLY_LIMIT) {
      setExpanded(false)
    }
    previousLength.current = text.length
  }, [text.length])

  // Keep the initial render cheap for very large model replies.  Rendering a
  // long Markdown document creates a large native Spannable tree and can block
  // Android's main thread while the screen is being left.
  if (!collapsible || expanded) {
    return (
      <>
        {collapsible && (
          <TouchableOpacity style={styles.replyToggle} onPress={() => setExpanded(false)}>
            <Text style={styles.replyToggleText}>{t('chat.replyCollapse')}</Text>
          </TouchableOpacity>
        )}
        <Markdown
          style={markdownStyles}
          rules={markdownRules}
          {...onOpenLink === undefined
            ? {}
            : { onLinkPress: (href: string): boolean => { onOpenLink(href); return false } }}
        >
          {text}
        </Markdown>
      </>
    )
  }

  const preview = text.slice(0, REPLY_PREVIEW_LIMIT).trimEnd()
  return (
    <TouchableOpacity style={styles.replyPreview} onPress={() => setExpanded(true)} accessibilityRole="button">
      <Text style={styles.replyPreviewText} numberOfLines={12}>{preview}{preview.length < text.length ? '…' : ''}</Text>
      <Text style={styles.replyToggleText}>{t('chat.replyExpand', { count: text.length })}</Text>
    </TouchableOpacity>
  )
}

/**
 * Files the model declared as deliverables, one card each — the shape the web
 * shows under an answer that produced user-facing files. The description is the
 * model's own copy from its `present` call, and tapping a card opens the same
 * preview (or hand-off) every other file reference uses.
 */
function DeliveredFilesCard({ item, onPreview }: {
  item: Extract<ConversationItem, { kind: 'delivery' }>
  onPreview: (path: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <View style={styles.deliveredRow}>
      {item.files.map(file => {
        const name = file.path.split(/[\\/]/).at(-1) ?? file.path
        return (
          <TouchableOpacity
            key={file.path}
            style={styles.deliveredCard}
            onPress={() => onPreview(file.path)}
            accessibilityLabel={t('chat.delivered', { name })}
          >
            <Text style={styles.deliveredKind}>{(extensionOf(file.path) || 'file').toUpperCase().slice(0, 4)}</Text>
            <View style={styles.deliveredCopy}>
              <Text style={styles.deliveredName} numberOfLines={1}>{name}</Text>
              {file.description !== undefined && (
                <Text style={styles.deliveredDescription} numberOfLines={3}>{file.description}</Text>
              )}
            </View>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

/**
 * The turn's file changes, in the web's per-turn card shape: one headline
 * (`已编辑 2 个文件` with the total `+219 -1`) and one row per file. Tapping a row
 * opens the same workspace preview the produced-file chips use.
 */
function FileChangesCard({ changes, onPreview }: {
  changes: FileChangeSummary[]
  onPreview: (path: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const totals = totalLineChanges(changes)
  return (
    <View style={styles.changesCard}>
      <View style={styles.changesHeader}>
        <Text style={styles.changesTitle}>{t('chat.changesTitle', { count: changes.length })}</Text>
        <Text style={styles.changesTotals}>{`+${totals.added} -${totals.removed}`}</Text>
      </View>
      {changes.map(change => (
        <TouchableOpacity key={change.path} style={styles.changesRow} onPress={() => onPreview(change.path)}>
          <Text style={styles.changesPath} numberOfLines={1}>{change.path}</Text>
          <Text style={styles.changesCounts}>{`+${change.added} -${change.removed}`}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

/**
 * Conversation content this client has no renderer for.
 *
 * The web transcript discloses the event type and its raw payload rather than
 * dropping it, so content added by a plugin or a newer dsh can never be
 * silently missing on the phone. The row is deliberately quiet: one line naming
 * the event, a short explanation, and the payload — compacted while collapsed,
 * indented with copy/share once opened.
 */
function UnknownEventCard({ item }: { item: Extract<ConversationItem, { kind: 'unknown' }> }): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <View style={styles.unknownCard}>
      <TouchableOpacity style={styles.unknownHeader} onPress={() => setOpen(value => !value)} accessibilityRole="button">
        <Text style={styles.unknownTitle} numberOfLines={1}>
          {t('chat.unknownEvent', { type: item.eventType })}
        </Text>
        {open
          ? <Icon name="ChevronDownOutline" size={14} color={colors.textDim} />
          : <Icon name="ChevronRightOutline" size={14} color={colors.textDim} />}
      </TouchableOpacity>
      {open && <Text style={styles.unknownHint}>{t('chat.unknownEventHint')}</Text>}
      <ScrollView style={styles.unknownBody} nestedScrollEnabled>
        <Text selectable style={styles.unknownJson}>{open ? prettyJson(item.data) : compactJson(item.data)}</Text>
      </ScrollView>
      {open && (
        <View style={styles.unknownActions}>
          <TouchableOpacity onPress={() => Clipboard.setString(prettyJson(item.data))}>
            <Text style={styles.unknownAction}>{t('common.copy')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { Share.share({ message: prettyJson(item.data) }).catch(() => undefined) }}>
            <Text style={styles.unknownAction}>{t('common.share')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

function Bubble({ item, manager, sessionId, onLongPress, onPreview, onOpenLink, process, actions }: {
  item: ConversationItem
  manager: ConnectionManager
  sessionId: string
  onLongPress: () => void
  /** Opens the workspace preview sheet for one produced path. */
  onPreview: (path: string) => void
  /** Handles a tapped Markdown link (URLs leave the app, file refs preview). */
  onOpenLink: (href: string) => void
  /** The turn's process disclosure, merged into the answer's own card. */
  process?: Turn
  /** The message's own web-parity action row, when it has one. */
  actions?: React.ReactNode
}): React.JSX.Element | null {
  const { t } = useI18n()
  switch (item.kind) {
    case 'user':
      return (
        // The web's `.userRow`: attachments and the prompt bubble stack against
        // the right edge, then the message's own action row under the bubble —
        // never inside it, which is what made the clock read as message text.
        <View style={styles.userRow}>
          {item.images.length > 0 && (
            <View style={styles.userAttachments}>
              {item.images.map(image => (
                <AttachmentImage key={image.kind === 'data' ? image.uri : image.attachmentId} image={image} manager={manager} sessionId={sessionId} style={styles.userAttachment} fallbackStyle={styles.imageFallback} />
              ))}
            </View>
          )}
          <TouchableOpacity activeOpacity={1} style={styles.userBubble} onLongPress={onLongPress}>
            <CollapsibleMarkdown text={item.text} onOpenLink={onOpenLink} />
          </TouchableOpacity>
          {actions}
        </View>
      )
    case 'compaction':
      return (
        <View style={styles.compactionRow}>
          <Text style={styles.compactionText}>{t('chat.compacted', { summary: item.summary })}</Text>
        </View>
      )
    case 'unknown':
      return <UnknownEventCard item={item} />
    case 'delivery':
      return <DeliveredFilesCard item={item} onPreview={onPreview} />
    case 'assistant':
    case 'stream':
      return (
        // The web's assistant flow item has no card: full-width narration on the
        // transcript surface, with the process disclosure and the action row as
        // siblings. The fill was what made every answer a boxed bubble and left
        // the answer text a different width from the tool rows above it.
        <TouchableOpacity
          activeOpacity={1}
          style={styles.assistantRow}
          onLongPress={onLongPress}
        >
          {/* A settled turn's disclosure rides in the answer's own card; a live
              turn's runs are rows of their own, above the answer they produced. */}
          {process !== undefined && !process.live && (
            <TurnProcessBlock
              turn={process}
              steps={process.process}
              summary={process.summary}
              toolCallCount={process.toolCallCount}
              manager={manager}
              sessionId={sessionId}
              onLongPress={() => onLongPress()}
              onOpenLink={onOpenLink}
              bare
            />
          )}
          {process !== undefined && process.changes.length > 0 && (
            <FileChangesCard changes={process.changes} onPreview={onPreview} />
          )}
          <CollapsibleMarkdown text={item.text} onOpenLink={onOpenLink} />
          {item.kind === 'assistant' && item.producedFiles.length > 0 && (
            <View style={styles.deliverableRow}>
              {item.producedFiles.map(path => (
              <TouchableOpacity
                key={path}
                style={styles.deliverableChip}
                onPress={() => onPreview(path)}
                onLongPress={() => { void Share.share({ message: path }) }}
              >
                <Text style={styles.deliverableText} numberOfLines={1}>{path.split(/[\\/]/).at(-1) ?? path}</Text>
              </TouchableOpacity>
              ))}
            </View>
          )}
          {item.kind === 'stream' && <Text style={styles.cursor}>▍</Text>}
          {item.kind === 'assistant' && item.interrupted && <Text style={styles.interrupted}>{t('chat.interrupted')}</Text>}
          {item.kind === 'assistant' && actions}
        </TouchableOpacity>
      )
    case 'tool':
      return <ToolCard item={item} manager={manager} sessionId={sessionId} onLongPress={onLongPress} />
    // Turn boundaries and the preparing row are consumed by the process block
    // (and its core grouping), never by a bubble of their own.
    default:
      return null
  }
}

function ActionBar({ manager, sessionId, onAnswerQuestion, onCancelQuestion, onApprovalStale }: {
  manager: ConnectionManager
  sessionId: string
  onAnswerQuestion: (rpcId: string, answer: QuestionAnswerPayload) => Promise<void>
  onCancelQuestion: (rpcId: string) => Promise<void>
  /** Explains a refused answer once the card itself has been retired. */
  onApprovalStale: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const session = manager.store.sessions.get(sessionId)
  const approvals = [...(session?.pendingApprovals.values() ?? [])]
  const questions = [...(session?.pendingQuestions.values() ?? [])]

  const answerApproval = async (rpcId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    const receipt = await manager.client?.respond({
      type: 'client-response',
      rpcId: rpcId as never,
      result: { ok: true, value: { sessionId, approvalId, outcome } },
    }).catch(() => undefined)
    // A refused answer means the Host no longer holds this request: the turn
    // ended, or the bridge restarted while the phone kept the card. The bridge
    // also publishes the resolution it missed, but a card that can never be
    // answered must not stay on screen either way.
    if (receipt !== undefined && !receipt.accepted) {
      manager.store.resolveApproval(sessionId, approvalId)
      onApprovalStale()
      return
    }
    manager.store.resolveApproval(sessionId, approvalId)
  }

  return (
    <View style={styles.actionBar}>
      {approvals.map(approval => (
        <View key={approval.approvalId} style={styles.actionRow}>
          <Text style={styles.actionText} numberOfLines={2}>
            {t('chat.approval', { tool: toolDisplayName(approval.toolName, t), reason: approval.reason !== undefined && approval.reason !== '' ? t('chat.approvalReason', { reason: approval.reason }) : '' })}
          </Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.success }]}
              onPress={() => void answerApproval(approval.rpcId, approval.approvalId, 'allowed-once')}>
              <Text style={styles.actionButtonText}>{t('chat.allow')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.danger }]}
              onPress={() => void answerApproval(approval.rpcId, approval.approvalId, 'rejected')}>
              <Text style={styles.actionButtonText}>{t('chat.deny')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {questions.map(question => {
        return (
          <QuestionCard
            key={question.rpcId}
            pending={question}
            onSubmit={answer => onAnswerQuestion(question.rpcId, answer)}
            onCancel={() => onCancelQuestion(question.rpcId)}
          />
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chat.bgBase },
  /** The transcript's frame: the list, plus the floating control over it. */
  listWrap: { flex: 1 },
  /**
   * The web's `.toBottom`: a 34px circle on the floating fill, 24px in from the
   * composer's own side clearance and 16px above the list's bottom edge, wearing
   * the panel elevation rather than a rule.
   */
  toBottom: {
    position: 'absolute',
    right: 24,
    bottom: 16,
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: chat.floating,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chat.borderL3,
    boxShadow: shadow.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing(2),
  },
  backButton: { flexDirection: 'row', alignItems: 'center', minWidth: 88, gap: 2 },
  backLabel: { color: colors.accent, fontSize: fontSize.body },
  headerAction: { width: 36, alignItems: 'center', justifyContent: 'center' },
  headerMenu: { width: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600', textAlign: 'center' },
  /**
   * The web's transcript geometry on a narrow viewport: 24px side pads (the
   * composer's 8px clearance plus 16), 16px above the first row, and no uniform
   * gap — each row carries its own, so a turn header can keep 16px while two
   * steps of the same turn sit 6px apart.
   */
  listContent: { paddingHorizontal: 24, paddingTop: spacing(4), paddingBottom: spacing(1) },
  historyLoader: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1),
  },
  historyLoaderText: { color: colors.accent, fontSize: fontSize.small },
  transcriptEmpty: { alignItems: 'center', gap: spacing(2), paddingTop: spacing(10) },
  transcriptEmptyText: { color: colors.textDim, fontSize: fontSize.small },
  historyErrorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
    backgroundColor: colors.bgElevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyErrorText: { flex: 1, color: colors.danger, fontSize: fontSize.tiny },
  historyRetry: { paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  historyRetryText: { color: colors.accent, fontSize: fontSize.small },
  goalPausedHint: { color: colors.warning, fontSize: fontSize.tiny, paddingHorizontal: spacing(2), paddingBottom: spacing(0.5) },
  metaHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(2),
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(0.5),
  },
  metaText: { flex: 1, gap: 2 },
  modelChip: { alignSelf: 'flex-end', marginRight: spacing(1), marginVertical: spacing(0.5) },
  modelChipText: { color: colors.accent, fontSize: fontSize.tiny },
  metaLine: { color: colors.textDim, fontSize: fontSize.tiny, marginBottom: spacing(0.5) },
  metaLink: { color: colors.accent },
  permissionBar: { flexGrow: 0, flexShrink: 0, height: 46, minHeight: 46, maxHeight: 46, marginBottom: spacing(0.5) },
  permissionContent: { paddingHorizontal: spacing(2), paddingVertical: spacing(0.5), gap: spacing(1.5), alignItems: 'center' },
  permissionDanger: { borderColor: colors.danger },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center' },
  menuCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    marginHorizontal: spacing(10),
    paddingVertical: spacing(2),
  },
  menuRow: { paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
  menuRowActive: { backgroundColor: colors.bgBubbleUser },
  submenuRow: { paddingLeft: spacing(7) },
  menuText: { color: colors.text, fontSize: fontSize.body },
  modelCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    marginHorizontal: spacing(6),
    maxHeight: '70%',
    paddingVertical: spacing(2),
  },
  modelGroup: { color: colors.textDim, fontSize: fontSize.tiny, paddingHorizontal: spacing(4), paddingTop: spacing(3), paddingBottom: spacing(1) },
  modelWarning: { color: colors.danger, fontSize: fontSize.small, paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
  modelFailure: { paddingHorizontal: spacing(4), paddingVertical: spacing(1.5), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  modelFailureTitle: { color: colors.warning, fontSize: fontSize.small, fontWeight: '600' },
  modelFailureMessage: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: spacing(0.5) },
  /** The web's `.userRow`: prompt block and its action row against the right edge. */
  userRow: { alignSelf: 'stretch', alignItems: 'flex-end', gap: 6 },
  /**
   * The web's prompt bubble: `specific-bubble` fill, `radius-xl`, 10/16 padding
   * and 14/22 type, capped at the figma 525px share of the column (0.702) or
   * 82% of a narrow viewport, whichever is smaller.
   */
  userBubble: {
    maxWidth: '82%',
    backgroundColor: chat.bubble,
    borderRadius: radius.xl,
    paddingHorizontal: spacing(4),
    paddingVertical: 10,
  },
  userAttachments: { alignSelf: 'flex-end', alignItems: 'flex-end', gap: spacing(2), maxWidth: '82%' },
  userAttachment: { width: 240, maxWidth: '100%', borderRadius: radius.lg },
  /**
   * The web's assistant flow item has no fill and no padding: full-width
   * narration on the transcript surface, so the answer shares one column with
   * the process disclosure above it.
   */
  assistantRow: { alignSelf: 'stretch' },
  /**
   * The web's turn disclosure is chrome-free: a 33px header carrying a 0.5px
   * rule under it, then the turn's own rows. It stays 16px clear of the answer
   * below, so the disclosure and the narration read as one column.
   */
  /** A row of its own: the list's own gap is what separates it from its answer. */
  turnProcess: { alignSelf: 'stretch' },
  /** Embedded in the answer's own row: same geometry, the rule is the only chrome. */
  turnProcessBare: { alignSelf: 'stretch', marginBottom: spacing(4) },
  turnProcessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 33,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chat.borderL2,
    gap: spacing(2),
  },
  turnProcessLabel: { flex: 1, color: chat.labelTertiary, fontSize: 14, lineHeight: 24 },
  /** Live, the header steps up one tier so it reads as "in progress". */
  turnProcessLive: { color: chat.labelSecondary },
  /** The web's chevron sits closed pointing down and flips up when open. */
  turnProcessChevronOpen: { transform: [{ rotate: '180deg' }] },
  /** One reasoning row: a 24px line at rest, its text indented 22px when open. */
  reasoningRow: { alignSelf: 'stretch' },
  reasoningHead: { flexDirection: 'row', alignItems: 'center', minHeight: 24 },
  reasoningGlyph: { width: 16, alignItems: 'center', marginRight: 6 },
  reasoningTitle: { color: chat.labelTertiary, ...chatText.secondary },
  /** The web's 2px separator dot between a row's title and its summary. */
  reasoningDot: { width: 2, height: 2, borderRadius: 1, backgroundColor: chat.labelCaption, marginHorizontal: 8 },
  reasoningSummary: { flex: 1, color: chat.labelTertiary, ...chatText.secondary },
  /** The Web indents an expanded reasoning body to the title's own column. */
  reasoningBody: {
    paddingLeft: 22,
    paddingVertical: 4,
  },
  /** A process row with no tool card of its own (the preparing call). */
  processRow: { flexDirection: 'row', alignItems: 'center', minHeight: 24 },
  processRowGlyph: { width: 16, marginRight: 6 },
  processRowTitle: { color: chat.labelTertiary, ...chatText.secondary },
  processRowDot: { width: 2, height: 2, borderRadius: 1, backgroundColor: chat.labelCaption, marginHorizontal: 8 },
  processRowSummary: { flex: 1, color: chat.labelTertiary, ...chatText.secondary },
  /** The web's live status line: deep-diving blue, 12/22, with its rule above. */
  running: { alignItems: 'flex-start', marginTop: 12 },
  runningDivider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    marginTop: 8,
    marginBottom: 10,
    backgroundColor: chat.borderL2,
  },
  runningContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  runningWhale: { width: 14, height: 14, tintColor: chat.deepDiving },
  runningText: { color: chat.deepDiving, fontSize: 12, lineHeight: 22 },
  unknownCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.card,
    backgroundColor: colors.bgElevated,
    marginHorizontal: spacing(1),
    marginVertical: spacing(0.5),
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    gap: spacing(1),
  },
  unknownHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  unknownTitle: { flex: 1, color: colors.textDim, fontSize: fontSize.small, fontWeight: '600' },
  unknownHint: { color: colors.textDim, fontSize: fontSize.tiny },
  unknownBody: { maxHeight: 200, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card },
  unknownJson: { color: colors.text, fontSize: 11, fontFamily: 'monospace', padding: spacing(2) },
  unknownActions: { flexDirection: 'row', gap: spacing(3) },
  unknownAction: { color: colors.accent, fontSize: fontSize.tiny },
  changesCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    marginBottom: spacing(1.5),
    overflow: 'hidden',
  },
  changesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    backgroundColor: colors.bg,
  },
  changesTitle: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  changesTotals: { color: colors.textDim, fontSize: fontSize.tiny, fontFamily: 'monospace' },
  changesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
  changesPath: { flex: 1, color: colors.textDim, fontSize: fontSize.tiny },
  changesCounts: { color: colors.textDim, fontSize: fontSize.tiny, fontFamily: 'monospace' },
  deliveredRow: { gap: spacing(1.5), marginBottom: spacing(1.5) },
  deliveredCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
  },
  deliveredKind: {
    minWidth: 34,
    textAlign: 'center',
    color: colors.accent,
    fontSize: fontSize.tiny,
    fontWeight: '700',
  },
  deliveredCopy: { flex: 1, gap: 2 },
  deliveredName: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  deliveredDescription: { color: colors.textDim, fontSize: fontSize.tiny, lineHeight: 16 },
  replyPreview: { borderRadius: radius.card, backgroundColor: colors.bgElevated, paddingHorizontal: spacing(1.5), paddingVertical: spacing(1) },
  replyPreviewText: { color: colors.text, fontSize: fontSize.small, lineHeight: 20 },
  replyToggle: { alignSelf: 'flex-start', paddingVertical: spacing(0.5) },
  replyToggleText: { color: colors.accent, fontSize: fontSize.tiny },
  compactionRow: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    backgroundColor: colors.bgElevated,
  },
  compactionText: { color: colors.textDim, fontSize: fontSize.small },
  deliverableRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(2) },
  deliverableChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    maxWidth: 180,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1),
  },
  deliverableText: { color: colors.accent, fontSize: fontSize.tiny },
  pendingImageRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  pendingImagesRow: { alignSelf: 'stretch', flexGrow: 0 },
  pendingImagesContent: { gap: spacing(2) },
  pendingFilesRow: { alignSelf: 'stretch', flexGrow: 0 },
  pendingFilesContent: { gap: spacing(2) },
  pendingFileCard: {
    width: 190,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing(2),
    gap: spacing(1),
    backgroundColor: colors.bgElevated,
  },
  pendingFileHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  pendingFileName: { flex: 1, color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  pendingFileMeta: { color: colors.textDim, fontSize: fontSize.tiny },
  pendingFileProgress: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  pendingFileStatus: { color: colors.textDim, fontSize: fontSize.tiny },
  pendingImageCard: { width: 68, height: 68 },
  pendingImage: { width: 64, height: 64, borderRadius: radius.card },
  pendingImageRemove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFallback: { color: colors.textDim, fontSize: fontSize.small, marginBottom: spacing(2) },
  cursor: { color: colors.accent },
  interrupted: { color: colors.warning, fontSize: fontSize.small },
  toolCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing(2.5),
  },
  toolHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolName: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  toolStatus: { fontSize: fontSize.tiny },
  toolBody: { color: colors.textDim, fontSize: fontSize.tiny, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: spacing(2) },
  /** Approvals and questions: the same dock card, marked by the warning rule. */
  actionBar: {
    marginHorizontal: spacing(2),
    marginBottom: spacing(2),
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
    backgroundColor: chat.inputCard,
    boxShadow: shadow.soft,
    padding: spacing(3),
    gap: spacing(2),
  },
  actionRow: { gap: spacing(2) },
  actionText: { color: colors.text, fontSize: fontSize.small },
  actionButtons: { flexDirection: 'row', gap: spacing(2) },
  actionButton: { borderRadius: radius.card, paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
  actionButtonText: { color: '#fff', fontSize: fontSize.small, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.bgBubbleUser },
  chipText: { color: colors.text, fontSize: fontSize.small },
  /** The web's composer shell: 8px side clearance and a 4px foot, no rule. */
  composer: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(1),
  },
  /**
   * The web's input card: `radius-panel` (28), the input surface fill, the l2
   * hairline plus the soft elevation glow, and 8px of top pad before the draft.
   * Menus and stat panels wear the panel radius too, so the composer, its @
   * menu and its stats read as one family of surfaces.
   */
  composerCard: {
    borderRadius: radius.panel,
    backgroundColor: chat.inputCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chat.borderL2,
    boxShadow: shadow.soft,
    paddingTop: 8,
  },
  /**
   * The web's read-only composer: the same frame the draft would have held,
   * carrying the reason it holds nothing instead — title in primary, reason in
   * tertiary, both on one centered line.
   */
  composerNotice: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 54,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  composerNoticeTitle: { color: chat.labelPrimary, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  composerNoticeBody: { color: chat.labelTertiary, fontSize: 13, lineHeight: 20 },
  /** The card's accessory band: picked images, files and reference chips. */
  composerAccessory: { paddingTop: 10, paddingHorizontal: 12, gap: spacing(2) },
  /**
   * The web's control row: attach circle left, send circle right, 12px between
   * controls, and 2px of its own top pad so the row sits slightly low against
   * the draft while the send circle keeps its own seat.
   */
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    paddingTop: 2,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  composerSpacer: { flex: 1, minWidth: 0 },
  /** The 28px attach circle on the selector fill. */
  addButton: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: chat.selector,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  /** The 34px primary circle: `button-info-fill`, white glyph, 0.4 when empty. */
  sendCircle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: chat.infoFill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendCircleDisabled: { opacity: 0.4 },
  refRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(1),
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  refChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(0.5),
    maxWidth: '100%',
  },
  refName: { color: colors.text, fontSize: fontSize.tiny, flexShrink: 1 },
  refBody: { flexDirection: 'row', alignItems: 'center', gap: spacing(1), flexShrink: 1 },
  refMeta: { color: colors.textDim, fontSize: fontSize.tiny },
  feedbackBadge: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: spacing(0.5) },
  /**
   * The draft surface: 14/24 type with the web's 4px top pad and 14/8 side pads
   * (the 4px the scrollport takes back on the right), one 24px line as its floor
   * and the composer's 14-line cap as its ceiling.
   */
  input: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    maxHeight: 336,
    minHeight: 36,
    paddingTop: 4,
    paddingLeft: 14,
    paddingRight: 8,
    color: chat.labelPrimary,
    fontSize: 14,
    lineHeight: 24,
    backgroundColor: 'transparent',
  },
  editCancel: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  /**
   * The composer's own dock cards — the queue, running jobs and notices — wear
   * the same rounded surface as the input card they float above, the way the
   * web stacks them: one surface tier, 8px of side clearance, no full-width
   * rules cutting the transcript in two.
   */
  notice: {
    marginHorizontal: spacing(2),
    marginBottom: spacing(2),
    backgroundColor: chat.hover,
    borderRadius: radius.md,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  noticeText: { color: chat.labelSecondary, fontSize: 12, lineHeight: 18 },
  dock: {
    marginHorizontal: spacing(2),
    marginBottom: spacing(2),
    borderRadius: radius.lg,
    backgroundColor: chat.menu,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chat.borderL1,
    boxShadow: shadow.panel,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    gap: spacing(1.5),
  },
  dockTitle: { color: colors.textDim, fontSize: fontSize.tiny },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  dockBadge: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 1,
  },
  dockBadgeText: { color: colors.textDim, fontSize: fontSize.tiny },
  dockPreview: { flex: 1, color: colors.text, fontSize: fontSize.small },
  dockAction: { color: colors.accent, fontSize: fontSize.small, paddingHorizontal: spacing(1) },
  jobs: {
    marginHorizontal: spacing(2),
    marginBottom: spacing(2),
    borderRadius: radius.lg,
    backgroundColor: chat.menu,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chat.borderL1,
    boxShadow: shadow.panel,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  jobsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobsTitle: { color: colors.textDim, fontSize: fontSize.tiny },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(2) },
  jobDot: { width: 8, height: 8, borderRadius: 4 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  jobText: { flex: 1 },
  jobLabel: { color: colors.text, fontSize: fontSize.small },
  jobMeta: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 1 },
})
