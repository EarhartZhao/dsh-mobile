/**
 * Conversation screen: history tail + live stream (throttled re-render),
 * prompt input, cancel, and the bottom action bar for approvals/questions.
 * Chunks never set state directly — the store batches and the 50ms throttle
 * bounds render frequency regardless of chunk rate (docs/01 移植策略).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Clipboard,
  Image,
  FlatList,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { deriveConversation, placementLabel, queuePreview, sessionStatsView, type ConnectionManager, type ConversationImage, type ConversationItem, type SessionStatsView, type TodoItemView } from '@dsh-mobile/core'
import type { JobView, QueuedInboxItem, SubagentCatalog } from '@dsh-mobile/protocol'
import Markdown from 'react-native-markdown-display'
import { Path, Svg } from 'react-native-svg'
import { CandidateMenu, type Candidate } from '../components/CandidateMenu'
import { ImageLightbox } from '../components/ImageLightbox'
import { ModalBackdrop } from '../components/ModalBackdrop'
import { PromptModal } from '../components/PromptModal'
import { PlusMenuSheet, type PlusCommand, type PlusMenuStatus, type PlusPreset, type PlusReference } from '../components/PlusMenuSheet'
import { QuestionCard, type QuestionAnswerPayload } from '../components/QuestionCard'
import { SubagentPanel } from '../components/SubagentPanel'
import { GoalBar, PlanChip, SessionStatsBar, TodoStrip, type GoalViewLite } from '../components/strips'
import { colors, fontSize, radius, spacing } from '../theme'
import { commonLabel, jobKindLabel, toolDisplayName } from '../ui-labels'

interface PermissionSelectView {
  options: { value: string; name: string; description?: string }[]
  currentValue: string
}

interface PendingImage {
  mediaType: string
  data: string
  width: number
  height: number
  name?: string | null
}

interface ImageLimitsView {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  maxImageDimension: number
  mediaTypes: string[]
}

interface Props {
  manager: ConnectionManager
  sessionId: string
  onBack: () => void
  onOpenSession?: (sessionId: string) => void
}

export function ChatScreen({ manager, sessionId, onBack, onOpenSession }: Props): React.JSX.Element {
  const [items, setItems] = useState<ConversationItem[]>([])
  const [draft, setDraft] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
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
  const [renameOpen, setRenameOpen] = useState(false)
  const [subOpen, setSubOpen] = useState<SubagentCatalog | null>(null)
  const [imageLimits, setImageLimits] = useState<ImageLimitsView | null>(null)
  const [plusOpen, setPlusOpen] = useState(false)
  const [commands, setCommands] = useState<PlusCommand[]>([])
  const [commandStatus, setCommandStatus] = useState<PlusMenuStatus>('idle')
  const [commandError, setCommandError] = useState('')
  const [commandPrompt, setCommandPrompt] = useState<{ command: PlusCommand } | null>(null)
  const [presets, setPresets] = useState<PlusPreset[]>([])
  const [presetStatus, setPresetStatus] = useState<PlusMenuStatus>('idle')
  const [presetError, setPresetError] = useState('')
  const [references, setReferences] = useState<PlusReference[]>([])
  const [referenceStatus, setReferenceStatus] = useState<PlusMenuStatus>('idle')
  const [lightbox, setLightbox] = useState<{ source: string; name?: string } | null>(null)
  const [modelMenu, setModelMenu] = useState<{
    current: { provider: string; model: string; reasoningEffort?: string }
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
  const [modelLabel, setModelLabel] = useState('模型')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const skillsCache = useRef<{ sessionId: string; skills: { name: string; description: string }[] } | null>(null)

  /** Trailing-token detection: /skill and @file/session triggers (ui-input-trigger lite). */
  const onDraftChange = (text: string): void => {
    setDraft(text)
    const m = /(^|\s)(\/|@)([\w.-]*)$/.exec(text)
    if (m === null) { setCandidates([]); return }
    const token = m[3]
    if (m[2] === '/') {
      void resolveSkills(token)
    } else {
      void resolveAtRefs(token)
    }
  }

  const resolveSkills = async (query: string): Promise<void> => {
    const client = manager.client
    if (client === null) return
    let skills = skillsCache.current?.sessionId === sessionId ? skillsCache.current.skills : null
    if (skills === null) {
      const result = await client.skills.list({ sessionId } as never).catch(() => null)
      if (result?.result.ok) {
        skills = (result.result.value.skills as never) as { name: string; description: string }[]
        skillsCache.current = { sessionId, skills }
      }
    }
    if (skills === null) return
    setCandidates(skills
      .filter(s => s.name.startsWith(query))
      .map(s => ({ key: s.name, title: `/${s.name}`, subtitle: s.description, insert: `/${s.name} ` })))
  }

  const resolveAtRefs = async (query: string): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const summary = manager.store.summaries.find(s => s.sessionId === sessionId)
    const cwd = summary?.cwd
    const files: Candidate[] = []
    if (cwd !== undefined && cwd !== '') {
      const listing = await client.host.listDirectory({ path: cwd } as never).catch(() => null)
      if (listing?.result.ok) {
        for (const entry of listing.result.value.entries) {
          if (entry.name.toLowerCase().startsWith(query.toLowerCase())) {
            files.push({ key: entry.path, title: entry.name, subtitle: entry.path, insert: `@${entry.path} ` })
          }
        }
      }
    }
    const sessions: Candidate[] = manager.store.summaries
      .filter(s => s.sessionId !== sessionId)
      .filter(s => {
        const t = manager.store.title(s.sessionId) ?? ''
        return t.toLowerCase().includes(query.toLowerCase())
      })
      .slice(0, 4)
      .map(s => ({
        key: s.sessionId,
        title: manager.store.title(s.sessionId) ?? s.cwd ?? s.sessionId.slice(-8),
        subtitle: '会话',
        insert: `@${manager.store.title(s.sessionId) ?? s.cwd ?? s.sessionId.slice(-8)} `,
      }))
    setCandidates([...files.slice(0, 6), ...sessions])
  }

  const pickCandidate = (candidate: Candidate): void => {
    setDraft(draft.replace(/(^|\s)(\/|@)([\w.-]*)$/, (_full, lead: string) => `${lead}${candidate.insert}`))
    setCandidates([])
  }

  const chooseImages = async (): Promise<void> => {
    try {
      const picker = NativeModules.DshImagePicker as {
        pickImages(maxBytes: number): Promise<PendingImage[]>
      } | undefined
      if (picker?.pickImages === undefined) throw new Error('当前 App 不支持多图选择。')
      const images = await picker.pickImages(imageLimits?.maxImageBytes ?? 20 * 1024 * 1024)
      for (const image of images) {
        appendImage(image)
      }
    } catch (error) {
      showNotice(`选择图片失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const captureImage = async (): Promise<void> => {
    const image = await callImagePicker('captureImage')
    if (image !== null && image !== undefined) {
      appendImage(image)
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
      showNotice(`选择图片失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  const validateImage = (image: PendingImage): string | null => {
    if (imageLimits === null) return null
    const bytes = Math.floor(image.data.length * 3 / 4)
    if (!imageLimits.mediaTypes.includes(image.mediaType)) return '不支持的图片格式。'
    if (bytes > imageLimits.maxImageBytes) return `图片超过单张大小上限 ${formatBytes(imageLimits.maxImageBytes)}。`
    if (image.width > imageLimits.maxImageDimension || image.height > imageLimits.maxImageDimension) {
      return `图片超过最大边长 ${imageLimits.maxImageDimension}px。`
    }
    if (image.width * image.height > imageLimits.maxImagePixels) return '图片像素数超过上限。'
    return null
  }

  const appendImage = (image: PendingImage): void => {
    const invalid = validateImage(image)
    if (invalid !== null) {
      showNotice(invalid)
      return
    }
    setPendingImages(current => {
      const next = [...current, image]
      if (imageLimits !== null && next.length > imageLimits.maxImagesPerMessage) {
        showNotice(`一条消息最多添加 ${imageLimits.maxImagesPerMessage} 张图片。`)
        return current
      }
      if (imageLimits !== null) {
        const total = next.reduce((sum, item) => sum + Math.floor(item.data.length * 3 / 4), 0)
        if (total > imageLimits.maxMessageImageBytes) {
          showNotice(`图片总大小超过 ${formatBytes(imageLimits.maxMessageImageBytes)}。`)
          return current
        }
      }
      return next
    })
  }
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<FlatList<ConversationItem>>(null)

  const refresh = useCallback(() => {
    const session = manager.store.sessions.get(sessionId)
    if (session === undefined) return
    setItems(deriveConversation(session))
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
    if (result?.result.ok) onBack()
    void manager.refreshBaseline()
  }

  const loadModels = useCallback(async (): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const result = await client.sessions.models({ sessionId } as never).catch(() => null)
    if (result?.result.ok) setModelLabel(result.result.value.current.model)
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
    } catch {
      setCommands([
        { name: 'compact', description: '压缩当前会话上下文。' },
        { name: 'goal', description: '设置或查看当前任务目标。', hint: '<objective>', images: true },
        { name: 'permission', description: '切换权限预设。', hint: '<preset>' },
        { name: 'plan', description: '进入或退出 Plan 模式。', hint: '[off|message]', images: true },
      ])
      setCommandStatus('ready')
      setCommandError('动态命令目录不可用，已显示常用命令。')
    }
  }, [commandStatus, manager, sessionId])

  const loadPresets = useCallback(async (force = false): Promise<void> => {
    const client = manager.client
    if (client === null || (!force && presetStatus === 'ready')) return
    setPresetStatus('loading')
    setPresetError('')
    const result = await client.agentPresets.list({} as never).catch(() => null)
    if (result?.result.ok !== true) {
      setPresets([])
      setPresetStatus('failed')
      setPresetError(result?.result.ok === false ? `加载失败：${result.result.error.message}` : '加载失败：连接不可用。')
      return
    }
    setPresets(result.result.value.presets.filter(preset => preset.broken === undefined))
    setPresetStatus('ready')
  }, [manager, presetStatus])

  const loadReferences = useCallback(async (force = false): Promise<void> => {
    const client = manager.client
    if (client === null || (!force && referenceStatus === 'ready')) return
    setReferenceStatus('loading')
    const summary = manager.store.summaries.find(item => item.sessionId === sessionId)
    const files: PlusReference[] = []
    if (summary?.cwd !== undefined && summary.cwd !== '') {
      const listing = await client.host.listDirectory({ path: summary.cwd } as never).catch(() => null)
      if (listing?.result.ok) {
        for (const entry of listing.result.value.entries) {
          files.push({ key: `file:${entry.path}`, title: entry.name, subtitle: entry.path, insert: `@${entry.path} ` })
        }
      }
    }
    const sessions: PlusReference[] = manager.store.summaries
      .filter(item => item.sessionId !== sessionId)
      .slice(0, 20)
      .map(item => {
        const label = manager.store.title(item.sessionId) ?? item.cwd ?? item.sessionId.slice(-8)
        return { key: `session:${item.sessionId}`, title: label, subtitle: '会话', insert: `@${label} ` }
      })
    const skills: PlusReference[] = []
    const skillResult = await client.skills.list({ sessionId } as never).catch(() => null)
    if (skillResult?.result.ok) {
      for (const skill of skillResult.result.value.skills) {
        skills.push({ key: `skill:${skill.name}`, title: `/${skill.name}`, subtitle: skill.description, insert: `/${skill.name} ` })
      }
    }
    setReferences([...skills.slice(0, 12), ...files.slice(0, 12), ...sessions])
    setReferenceStatus('ready')
  }, [manager, referenceStatus, sessionId])

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

  useEffect(() => {
    // Baseline: tail page (with projections watermark), then live frames take over.
    const client = manager.client
    if (client !== null) {
      void client.sessions.history({ sessionId, maxMessages: 120 } as never).then(result => {
        if (result.result.ok) {
          manager.store.applyHistory(
            sessionId,
            result.result.value.events,
            result.result.value.projections ?? undefined,
          )
        }
      }).catch(() => undefined)
    }
    let pending = false
    const off = manager.store.on('changed', ({ sessionId: changed }) => {
      if (changed !== undefined && changed !== sessionId) return
      if (pending) return
      pending = true
      setTimeout(() => {
        pending = false
        refresh()
      }, 50)
    })
    refresh()
    return off
  }, [manager, sessionId, refresh])
  useEffect(() => { void loadModels() }, [loadModels])

  const send = async (): Promise<void> => {
    const client = manager.client
    const text = draft.trim()
    if (client === null || (text === '' && pendingImages.length === 0)) return
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
    let result
    try {
      result = await client.sessions.prompt({
        sessionId,
        // Always queue: while a turn runs the message parks in the inbox FIFO
        // (dock below); explicit steering is the dock's 引导 action.
        mode: 'queue',
        content: [
          ...(text !== '' ? [{ type: 'text', text }] : []),
          ...pendingImages.map(image => ({
            type: 'image',
            mediaType: image.mediaType,
            data: image.data,
            ...(image.name === null ? {} : { name: image.name }),
          })),
        ],
        clientTimeZone,
      } as never)
    } catch (error) {
      result = null
      showNotice(`发送失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (result === null || !result.result.ok) {
      setDraft(text) // put the draft back on failure
      if (result !== null && !result.result.ok) showNotice(`发送失败：${result.result.error.message}`)
      return
    }
    setPendingImages([])
    // Slash commands report their result in the command slot.
    const command = result.result.value.command
    if (command?.text !== undefined && command.text !== '') showNotice(command.text)
  }

  const runCommand = async (command: string): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const response = await client.sessions.prompt({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: command }],
    } as never).catch(() => null)
    const result = response?.result
    if (result?.ok) {
      const text = result.value.command?.text
      if (text !== undefined && text !== '') showNotice(text)
    } else if (result !== undefined && !result.ok) {
      showNotice(`命令失败：${result.error.message}`)
    }
  }

  const runMenuCommand = async (command: PlusCommand, argument?: string): Promise<void> => {
    const client = manager.client
    if (client === null) return
    showNotice(`执行中：/${command.name}`)
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
          showNotice(`命令失败：${result.result.text}`)
          return
        }
        setPendingImages([])
        if (result.result.text !== undefined && result.result.text !== '') showNotice(result.result.text)
        return
      } catch {
        await runCommand(text)
        return
      }
    }
    if (command.images !== true && pendingImages.length > 0) {
      showNotice(`/${command.name} 不接受图片附件。`)
      return
    }
    try {
      const result = await client.commands.execute({ sessionId, line: text })
      if (result.result.kind === 'error') {
        showNotice(`命令失败：${result.result.text}`)
        return
      }
      if (result.result.text !== undefined && result.result.text !== '') showNotice(result.result.text)
    } catch {
      await runCommand(text)
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

  const selectPermission = (value: string): void => {
    if (value === 'danger-full-access') {
      Alert.alert('启用完全访问权限', '此权限允许绕过沙箱写入整个系统，确认继续？', [
        { text: '取消', style: 'cancel' },
        { text: '启用', style: 'destructive', onPress: () => { void runCommand('/permission danger-full-access') } },
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
    await manager.client?.respond({
      type: 'client-response',
      rpcId: rpcId as never,
      result: { ok: true, value: { sessionId, answer } },
    })
  }, [manager, sessionId])

  const cancelQuestion = useCallback(async (rpcId: string): Promise<void> => {
    await manager.client?.respond({
      type: 'client-response',
      rpcId: rpcId as never,
      result: {
        ok: false,
        error: { code: 'cancelled', message: '用户关闭了这组提问', details: {} },
      },
    })
  }, [manager])

  const session = manager.store.sessions.get(sessionId)
  const approvals = [...(session?.pendingApprovals.values() ?? [])]
  const questions = [...(session?.pendingQuestions.values() ?? [])]
  const title = manager.store.title(sessionId) ?? '会话'

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ 返回</Text></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <TouchableOpacity style={styles.back} onPress={() => setMenuOpen(true)}><Text style={styles.back}>⋯</Text></TouchableOpacity>
      </View>
      {(() => {
        const s = manager.store.summaries.find(x => x.sessionId === sessionId)
        return (
          <View style={styles.metaHeader}>
            <View style={styles.metaText}>
              {s?.cwd !== undefined && <Text style={styles.metaLine} numberOfLines={1}>目录 {s.cwd}</Text>}
              {s?.agentPreset !== undefined && <Text style={styles.metaLine} numberOfLines={1}>预设 {s.agentPreset}</Text>}
              {s?.parentSessionId !== undefined && <Text style={styles.metaLine} numberOfLines={1}>父会话 {s.parentSessionId.slice(0, 8)}</Text>}
              <Text style={styles.metaLine} numberOfLines={1}>
                更新 {new Date(s?.updatedAt ?? Date.now()).toLocaleString('zh-CN', { hour12: false })}
                {s?.origin === 'subagent' ? ' · 子代理' : ''}
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
                <Text style={[styles.chipText, danger && { color: colors.danger }]}>{commonLabel(option.name)}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <Bubble item={item} manager={manager} sessionId={sessionId} />}
      />
      {planMode !== undefined && <PlanChip mode={planMode} />}
      <GoalBar
        goal={goal}
        onEdit={() => setGoalPrompt('edit')}
        onPause={() => void goalAction('pause')}
        onResume={() => void goalAction('resume')}
        onComplete={() => void goalAction('complete')}
        onClear={() => void goalAction('clear')}
      />
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
        />
      )}
      <CandidateMenu items={candidates} onPick={pickCandidate} />
      <SessionStatsBar view={statsView} />
      <View style={styles.composer}>
        {editingItem === null && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => { setPlusOpen(true); void loadCommands(); void loadReferences(); void loadPresets() }}
            accessibilityRole="button"
            accessibilityLabel="添加命令、附件或控制项"
          >
            <PlusGlyph color={colors.accent} />
          </TouchableOpacity>
        )}
        {pendingImages.length > 0 && editingItem === null && (
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
                  <Text style={styles.pendingImageRemoveText}>✕</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {lightbox !== null && (
          <ImageLightbox visible source={lightbox.source} name={lightbox.name} onClose={() => setLightbox(null)} />
        )}
        {imageLimits !== null && pendingImages.length === 0 && editingItem === null && (
          <View style={styles.imageLimitsBar}>
            <Text style={styles.imageLimitsText} numberOfLines={1}>{imageLimitsSummary(imageLimits)}</Text>
          </View>
        )}
        {editingItem !== null && (
          <TouchableOpacity style={styles.editCancel} onPress={() => { setEditingItem(null); setDraft('') }}>
            <Text style={styles.editCancelText}>✕</Text>
          </TouchableOpacity>
        )}
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={onDraftChange}
          placeholder={editingItem !== null ? '编辑排队消息…' : running ? '排队新消息…' : '发消息…'}
          placeholderTextColor={colors.textDim}
          multiline
        />
        {running ? (
          <View style={styles.runningButtons}>
            <TouchableOpacity style={[styles.sendButton, { backgroundColor: colors.danger }]} onPress={() => void cancel()}>
              <Text style={styles.sendText}>停止</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendButton, draft.trim() === '' && pendingImages.length === 0 && editingItem === null && styles.disabled]}
              disabled={draft.trim() === '' && pendingImages.length === 0 && editingItem === null}
              onPress={() => void send()}
            >
              <Text style={styles.sendText}>{editingItem !== null ? '保存' : '排队'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, draft.trim() === '' && pendingImages.length === 0 && editingItem === null && styles.disabled]}
            disabled={draft.trim() === '' && pendingImages.length === 0 && editingItem === null}
            onPress={() => void send()}
          >
            <Text style={styles.sendText}>{editingItem !== null ? '保存' : '发送'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <ModalBackdrop onClose={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuRow} onPress={() => { setMenuOpen(false); setRenameOpen(true) }}>
              <Text style={styles.menuText}>重命名</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => void fork()}>
              <Text style={styles.menuText}>分叉会话</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => void openModels()}>
              <Text style={styles.menuText}>切换模型</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => void openSubagents()}>
              <Text style={styles.menuText}>子代理</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => { setMenuOpen(false); setGoalPrompt(goal === null ? 'create' : 'edit') }}>
              <Text style={styles.menuText}>{goal === null ? '设置目标' : '编辑目标'}</Text>
            </TouchableOpacity>
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
                          <Text style={styles.menuText} numberOfLines={1}>{commonLabel(effort.name)}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </React.Fragment>
                ))}
              </View>
            ))}
            <TouchableOpacity style={styles.menuRow} onPress={() => setModelMenu(null)}>
              <Text style={[styles.menuText, { color: colors.textDim }]}>关闭</Text>
            </TouchableOpacity>
          </ScrollView>
        </ModalBackdrop>
      </Modal>
      <PlusMenuSheet
        visible={plusOpen}
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
        modelLabel={modelLabel}
        presetLabel={manager.store.summaries.find(item => item.sessionId === sessionId)?.agentPreset}
        pendingImageCount={pendingImages.length}
        onClose={() => setPlusOpen(false)}
        onPickCommand={pickMenuCommand}
        onCaptureImage={() => { setPlusOpen(false); void captureImage() }}
        onPickImages={() => { setPlusOpen(false); void chooseImages() }}
        onInsertReference={reference => { setPlusOpen(false); setDraft(current => `${current}${current.endsWith(' ') || current === '' ? '' : ' '}${reference.insert}`) }}
        onPermission={value => { setPlusOpen(false); selectPermission(value) }}
        onTogglePlan={() => { setPlusOpen(false); void runMenuCommand({ name: 'plan', description: '切换 Plan 模式', images: true }, planMode === undefined || planMode === 'off' ? '' : 'off') }}
        onGoal={() => { setPlusOpen(false); setGoalPrompt(goal === null ? 'create' : 'edit') }}
        onModel={() => { setPlusOpen(false); void openModels() }}
        onPresets={() => { void loadPresets(true) }}
        onSelectPreset={preset => {
          setPlusOpen(false)
          void manager.client?.agentPresets.select({ sessionId, agentPreset: preset.id } as never)
            .then(result => {
              if (!result.result.ok) showNotice(`切换失败：${result.result.error.message}`)
              else {
                void manager.refreshBaseline()
                void loadCommands(true)
              }
            })
            .catch(() => showNotice('切换失败：连接不可用。'))
        }}
        onSubagents={() => { setPlusOpen(false); void openSubagents() }}
      />
      <PromptModal
        visible={commandPrompt !== null}
        title={commandPrompt === null ? '' : `/${commandPrompt.command.name}`}
        initial=""
        confirmLabel="执行"
        onCancel={() => setCommandPrompt(null)}
        onConfirm={argument => {
          const command = commandPrompt?.command
          setCommandPrompt(null)
          if (command !== undefined) void runMenuCommand(command, argument)
        }}
      />
      <PromptModal
        visible={renameOpen}
        title="重命名会话"
        initial={title}
        confirmLabel="重命名"
        onCancel={() => setRenameOpen(false)}
        onConfirm={t => void rename(t)}
      />
      <PromptModal
        visible={goalPrompt !== null}
        title={goalPrompt === 'create' ? '设置目标' : '编辑目标'}
        initial={goal?.objective ?? ''}
        confirmLabel={goalPrompt === 'create' ? '创建' : '保存'}
        onCancel={() => setGoalPrompt(null)}
        onConfirm={t => void goalSubmit(t)}
      />
    </KeyboardAvoidingView>
  )
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${Math.round(size / (1024 * 1024) * 10) / 10}MB`
  return `${Math.round(size / 1024)}KB`
}

function imageLimitsSummary(limits: ImageLimitsView): string {
  const mediaTypes = limits.mediaTypes
    .map(type => type.replace('image/', '').toUpperCase())
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 4)
    .join('/')
  return `图片限制：单张≤${formatBytes(limits.maxImageBytes)} · 每条${limits.maxImagesPerMessage}张 · ${mediaTypes}`
}

function PlusGlyph({ color }: { color: string }): React.JSX.Element {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

function QueueDock({ queue, editingId, onEdit, onRemove, onSteer }: {
  queue: QueuedInboxItem[]
  editingId: string | null
  onEdit: (item: QueuedInboxItem) => void
  onRemove: (id: string) => void
  onSteer: (id: string) => void
}): React.JSX.Element {
  return (
    <View style={styles.dock}>
      <Text style={styles.dockTitle}>队列 · {queue.length}</Text>
      {queue.map(item => (
        <View key={item.id} style={styles.dockRow}>
          <View style={styles.dockBadge}><Text style={styles.dockBadgeText}>{placementLabel(item.placement)}</Text></View>
          <Text style={styles.dockPreview} numberOfLines={1}>{queuePreview(item)}</Text>
          <TouchableOpacity onPress={() => onEdit(item)} disabled={editingId === item.id}>
            <Text style={[styles.dockAction, editingId === item.id && { color: colors.textDim }]}>编辑</Text>
          </TouchableOpacity>
          {item.placement === 'queued' && (
            <TouchableOpacity onPress={() => onSteer(item.id)}>
              <Text style={styles.dockAction}>引导</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => onRemove(item.id)}>
            <Text style={[styles.dockAction, { color: colors.danger }]}>删除</Text>
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
  const live = jobs.filter(j => j.status === 'running' || j.status === 'stopping').length
  return (
    <View style={styles.jobs}>
      <TouchableOpacity style={styles.jobsHeader} onPress={onToggle}>
        <Text style={styles.jobsTitle}>任务 · {jobs.length}{live > 0 ? `（${live} 运行中）` : ''}</Text>
        <Text style={styles.jobsChevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && jobs.map(job => (
        <View key={job.id} style={styles.jobRow}>
          <View style={[styles.jobDot, { backgroundColor: jobStatusColor(job.status) }]} />
          <View style={styles.jobText}>
            <Text style={styles.jobLabel} numberOfLines={1}>{job.label}</Text>
            <Text style={styles.jobMeta}>
              {jobKindLabel(job.kind)} · {jobStatusLabel(job.status)}{job.detail !== undefined && job.detail !== '' ? ` · ${job.detail}` : ''}
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

function jobStatusLabel(status: JobView['status']): string {
  switch (status) {
    case 'running': return '运行中'
    case 'stopping': return '停止中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    case 'killed': return '已终止'
  }
}

function Bubble({ item, manager, sessionId }: {
  item: ConversationItem
  manager: ConnectionManager
  sessionId: string
}): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <View style={[styles.bubble, styles.bubbleUser]}>
          {item.images.map(image => (
            <MessageImage key={image.kind === 'data' ? image.uri : image.attachmentId} image={image} manager={manager} sessionId={sessionId} />
          ))}
          <Markdown style={markdownStyles} rules={markdownRules}>{item.text}</Markdown>
        </View>
      )
    case 'compaction':
      return (
        <View style={styles.compactionRow}>
          <Text style={styles.compactionText}>上下文已压缩 · {item.summary}</Text>
        </View>
      )
    case 'assistant':
    case 'stream':
      return (
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.bubble, styles.bubbleAssistant]}
          onLongPress={item.kind === 'assistant' && item.text !== '' ? () => { void Share.share({ message: item.text }) } : undefined}
        >
          {item.reasoning !== '' && <Text style={styles.reasoning}>{item.reasoning}</Text>}
          <Markdown style={markdownStyles} rules={markdownRules}>{item.text}</Markdown>
          {item.kind === 'assistant' && item.producedFiles.length > 0 && (
            <View style={styles.deliverableRow}>
              {item.producedFiles.map(path => (
                <View key={path} style={styles.deliverableChip}>
                  <Text style={styles.deliverableText} numberOfLines={1}>{path.split(/[\\/]/).at(-1) ?? path}</Text>
                </View>
              ))}
            </View>
          )}
          {item.kind === 'stream' && <Text style={styles.cursor}>▍</Text>}
          {item.kind === 'assistant' && item.interrupted && <Text style={styles.interrupted}>（已中断）</Text>}
        </TouchableOpacity>
      )
    case 'tool':
      return <ToolCard item={item} />
  }
}

function CodeBlock({ node }: { node: { content: string; attributes?: unknown } }): React.JSX.Element {
  const content = node.content.endsWith('\n') ? node.content.slice(0, -1) : node.content
  const attributes = typeof node.attributes === 'object' && node.attributes !== null
    ? node.attributes as { info?: unknown }
    : {}
  const language = typeof attributes.info === 'string' && attributes.info !== ''
    ? attributes.info.split(/\s+/)[0]
    : '代码'
  return (
    <View style={codeStyles.block}>
      <View style={codeStyles.header}>
        <Text style={codeStyles.language}>{language}</Text>
        <View style={codeStyles.actions}>
          <TouchableOpacity onPress={() => void Clipboard.setString(content)}>
            <Text style={codeStyles.action}>复制</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { void Share.share({ message: content }) }}>
            <Text style={codeStyles.action}>分享</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal nestedScrollEnabled>
        <Text selectable style={codeStyles.code}>{content}</Text>
      </ScrollView>
    </View>
  )
}

function MessageImage({ image, manager, sessionId }: {
  image: ConversationImage
  manager: ConnectionManager
  sessionId: string
}): React.JSX.Element {
  const [source, setSource] = useState<string | null>(image.kind === 'data' ? image.uri : null)
  const [aspect, setAspect] = useState(4 / 3)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (image.kind !== 'attachment') return
    let alive = true
    void manager.client?.sessions.attachment({ sessionId, attachmentId: image.attachmentId } as never)
      .then(result => {
        if (!alive || !result.result.ok) return
        const value = result.result.value as {
          attachment: { mediaType: string; width: number; height: number }
          data: string
        }
        setSource(`data:${value.attachment.mediaType};base64,${value.data}`)
        setAspect(value.attachment.width / value.attachment.height)
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [image, manager, sessionId])

  if (source === null) return <Text style={styles.imageFallback}>图片加载中…</Text>
  return (
    <>
      <TouchableOpacity onPress={() => setLightboxOpen(true)}>
        <Image source={{ uri: source }} style={[styles.messageImage, { aspectRatio: aspect }]} />
      </TouchableOpacity>
      <ImageLightbox visible={lightboxOpen} source={source} name={image.name} onClose={() => setLightboxOpen(false)} />
    </>
  )
}

function ToolCard({ item }: { item: ConversationItem & { kind: 'tool' } }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const statusColor = item.status === 'running' ? colors.running : item.status === 'error' ? colors.danger : colors.success
  const statusText = item.status === 'running' ? '执行中' : item.status === 'error' ? '失败' : '完成'
  const isTerminal = /^(bash|pwsh|sh|zsh|cmd|powershell|pty-send)$/.test(item.name)
  const isRead = /^(read|cat|Read)$/.test(item.name)
  return (
    <TouchableOpacity style={styles.toolCard} onPress={() => setOpen(o => !o)} activeOpacity={0.8}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolName}>{toolDisplayName(item.name)}</Text>
        <Text style={[styles.toolStatus, { color: statusColor }]}>{statusText} {open ? '▾' : '▸'}</Text>
      </View>
      {open && (
        <View>
          {item.args !== '' && (
            <Text style={[styles.toolBody, isTerminal && toolStyles.mono]} numberOfLines={open ? undefined : 3}>{item.args}</Text>
          )}
          {(isTerminal || isRead) && item.resultText !== '' ? (
            <View style={toolStyles.block}>
              <ScrollView style={toolStyles.scroll} nestedScrollEnabled>
                <Text style={[toolStyles.mono, isRead && toolStyles.read]}>{item.resultText}</Text>
              </ScrollView>
            </View>
          ) : item.resultPreview !== '' && <Text style={styles.toolBody}>{item.resultPreview}</Text>}
        </View>
      )}
    </TouchableOpacity>
  )
}

function ActionBar({ manager, sessionId, onAnswerQuestion, onCancelQuestion }: {
  manager: ConnectionManager
  sessionId: string
  onAnswerQuestion: (rpcId: string, answer: QuestionAnswerPayload) => Promise<void>
  onCancelQuestion: (rpcId: string) => Promise<void>
}): React.JSX.Element {
  const session = manager.store.sessions.get(sessionId)
  const approvals = [...(session?.pendingApprovals.values() ?? [])]
  const questions = [...(session?.pendingQuestions.values() ?? [])]

  const answerApproval = async (rpcId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    await manager.client?.respond({
      type: 'client-response',
      rpcId: rpcId as never,
      result: { ok: true, value: { sessionId, approvalId, outcome } },
    }).catch(() => undefined)
  }

  return (
    <View style={styles.actionBar}>
      {approvals.map(approval => (
        <View key={approval.approvalId} style={styles.actionRow}>
          <Text style={styles.actionText} numberOfLines={2}>
            审批：{toolDisplayName(approval.toolName)}{approval.reason !== undefined && approval.reason !== '' ? `（${approval.reason}）` : ''}
          </Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.success }]}
              onPress={() => void answerApproval(approval.rpcId, approval.approvalId, 'allowed-once')}>
              <Text style={styles.actionButtonText}>允许</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.danger }]}
              onPress={() => void answerApproval(approval.rpcId, approval.approvalId, 'rejected')}>
              <Text style={styles.actionButtonText}>拒绝</Text>
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
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing(2),
  },
  back: { color: colors.accent, fontSize: fontSize.body, width: 56 },
  headerTitle: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600', textAlign: 'center' },
  listContent: { padding: spacing(3), gap: spacing(2) },
  metaHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(3),
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(1),
  },
  metaText: { flex: 1, gap: 2 },
  modelChip: { alignSelf: 'flex-end', marginRight: spacing(3), marginVertical: spacing(1) },
  modelChipText: { color: colors.accent, fontSize: fontSize.tiny },
  metaLine: { color: colors.textDim, fontSize: fontSize.tiny, paddingHorizontal: spacing(4), marginBottom: spacing(1) },
  permissionBar: { flexGrow: 0, height: 56, marginBottom: spacing(1) },
  permissionContent: { paddingHorizontal: spacing(3), paddingVertical: spacing(1), gap: spacing(2), alignItems: 'center' },
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
  bubble: { maxWidth: '88%', borderRadius: radius.bubble, padding: spacing(3) },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.bgBubbleUser },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: colors.bgBubbleAssistant },
  bubbleText: { color: colors.text, fontSize: fontSize.body, lineHeight: 22 },
  reasoning: { color: colors.textDim, fontSize: fontSize.small, fontStyle: 'italic', marginBottom: spacing(1) },
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
  imageLimitsBar: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing(3),
    paddingTop: spacing(2),
  },
  imageLimitsText: { color: colors.textDim, fontSize: fontSize.tiny },
  pendingImagesRow: { alignSelf: 'stretch', flexGrow: 0, paddingVertical: spacing(1) },
  pendingImagesContent: { gap: spacing(2), paddingHorizontal: spacing(1), paddingRight: spacing(3) },
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
  pendingImageRemoveText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  iconButton: {
    minWidth: 40,
    paddingHorizontal: spacing(1.5),
    width: 40,
    height: 44,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageImage: { alignSelf: 'stretch', width: '100%', borderRadius: radius.card, marginBottom: spacing(2) },
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
  actionBar: {
    borderTopWidth: 1,
    borderTopColor: colors.warning,
    backgroundColor: colors.bgElevated,
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
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing(3),
    gap: spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.bubble,
    color: colors.text,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    fontSize: fontSize.body,
    backgroundColor: colors.bgElevated,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.bubble,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
  },
  disabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontSize: fontSize.body, fontWeight: '600' },
  runningButtons: { flexDirection: 'column', gap: spacing(1.5) },
  editCancel: { alignSelf: 'center', padding: spacing(1) },
  editCancelText: { color: colors.textDim, fontSize: fontSize.body },
  notice: {
    marginHorizontal: spacing(3),
    marginBottom: spacing(2),
    backgroundColor: colors.bgBubbleUser,
    borderRadius: radius.card,
    padding: spacing(2.5),
  },
  noticeText: { color: colors.text, fontSize: fontSize.small },
  dock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
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
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  jobsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobsTitle: { color: colors.textDim, fontSize: fontSize.tiny },
  jobsChevron: { color: colors.textDim, fontSize: fontSize.small },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(2) },
  jobDot: { width: 8, height: 8, borderRadius: 4 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  jobText: { flex: 1 },
  jobLabel: { color: colors.text, fontSize: fontSize.small },
  jobMeta: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 1 },
})

const markdownRules = {
  code_block: (node: { key: string; content: string; attributes?: unknown }): React.JSX.Element => (
    <CodeBlock key={node.key} node={node} />
  ),
  fence: (node: { key: string; content: string; attributes?: unknown }): React.JSX.Element => (
    <CodeBlock key={node.key} node={node} />
  ),
}

const markdownStyles = StyleSheet.create({
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

const toolStyles = StyleSheet.create({
  block: { backgroundColor: colors.bg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, marginTop: spacing(2), maxHeight: 260 },
  scroll: { padding: spacing(2) },
  mono: { color: colors.text, fontSize: fontSize.tiny, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  read: { color: colors.textDim },
})
