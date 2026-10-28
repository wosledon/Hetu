import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { uiLocale, formatDateTime } from '../utils/locale'
import {
  Check,
  ChevronDown,
  Columns2,
  Copy,
  Edit3,
  Eye,
  History,
  RotateCcw,
  Share2,
  Sparkles,
  X,
  Calendar,
  Clock,
  FileText,
  Bot,
  PenLine,
  Send,
  Database,
  RefreshCw,
  Loader2,
  Network,
  AlertCircle,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Code2,
  Quote,
  List,
  ListOrdered,
  ListTodo,
  SquareCode,
  Link2,
  Table2,
  Minus,
  Workflow,
  Square,
} from 'lucide-react'
import i18n from '../i18n'
import { TagInput } from './TagInput'
import ThemedMarkdown from './ThemedMarkdown'
import NoteToc from './NoteToc'
import { parseNoteHeadings } from '../utils/noteToc'
import { MilkdownEditor, type MilkdownEditorHandle, type SelectionInfo } from './MilkdownEditor'
import EmojiPicker from './EmojiPicker'
import { noteService } from '../services/noteService'
import { noteVersionService } from '../services/noteVersionService'
import { noteAiService } from '../services/noteAiService'
import { shareService } from '../services/shareService'
import { knowledgeBaseService } from '../services/knowledgeBaseService'
import { graphService } from '../services/graphService'
import { taskService } from '../services/taskService'
import { aiModelService } from '../services/aiProviderService'
import type { INote, INoteVersion, IShareLink } from '../types'
import { Button, Card, IconButton, Input, PageContainer, PillTabs, Textarea } from './ui'

/** AI 动作的提示词预设：快捷按钮点击后预填到输入框，用户可改完再执行 */
const AI_PRESET_ACTIONS = ['polish', 'translate', 'condense', 'expand', 'explain']

/** 目录留白槽最小宽度：NoteToc 的 w-52（208px）+ 与正文的间距 */
const TOC_GUTTER_MIN = 220

function aiActionPreset(action: string): string {
  return AI_PRESET_ACTIONS.includes(action) ? i18n.t(`notes:editor.aiPresets.${action}`) : ''
}

/** 浮动工具栏动作表：模块级定义，避免渲染期闭包引用 ref */
interface FormatAction {
  key: string
  icon: React.ComponentType<{ size?: number }>
  titleKey: string
  run: (md: MilkdownEditorHandle) => void
}

const FORMAT_ACTIONS: FormatAction[] = [
  { key: 'h2', icon: Heading2, titleKey: 'heading2', run: (md) => md.toggleHeading(2) },
  { key: 'h3', icon: Heading3, titleKey: 'heading3', run: (md) => md.toggleHeading(3) },
  { key: 'bold', icon: Bold, titleKey: 'bold', run: (md) => md.toggleBold() },
  { key: 'italic', icon: Italic, titleKey: 'italic', run: (md) => md.toggleItalic() },
  { key: 'strike', icon: Strikethrough, titleKey: 'strikethrough', run: (md) => md.toggleStrikethrough() },
  { key: 'code', icon: Code2, titleKey: 'inlineCode', run: (md) => md.toggleInlineCode() },
  { key: 'quote', icon: Quote, titleKey: 'quote', run: (md) => md.toggleBlockquote() },
  { key: 'ul', icon: List, titleKey: 'bulletList', run: (md) => md.toggleBulletList() },
  { key: 'ol', icon: ListOrdered, titleKey: 'orderedList', run: (md) => md.toggleOrderedList() },
  { key: 'todo', icon: ListTodo, titleKey: 'todoList', run: (md) => md.toggleTodo() },
  { key: 'codeblock', icon: SquareCode, titleKey: 'codeBlock', run: (md) => md.insertCodeBlock() },
]

interface MarkdownEditorProps {
  note: INote | null
}

/**
 * 剥离 AI 输出中的对话性前后缀与代码块包裹，保留正文。
 * 模型有时会把「标题 + 正文」挤在同一个标题行（如 "# 标题 正文…"），
 * 解析后整段变成标题；此时按选中文本/笔记标题拆成标题行 + 正文段落，
 * 其余 Markdown 结构（分节标题、列表等）原样保留。
 */
function sanitizeAiResult(
  raw: string,
  context: { noteTitle?: string; selectedText?: string } = {},
): string {
  let text = raw.trim()
  // 去掉整体代码块包裹
  const fenceMatch = text.match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  if (fenceMatch) text = fenceMatch[1].trim()
  const lines = text.split('\n')
  const prefixRe = /^\s*(?:[#>*\s-]*)(?:好的[，,。!！]?|没问题[，,。!！]?|当然[，,。!！]?|以下是[^：:]*|这是[^：:]*|已为您[^：:]*|我将[^：:]*|我来[^：:]*|润色后|翻译后|简化后|扩展后|续写后|结果|修改后)\s*[：:，,。]?\s*$/
  while (lines.length > 1 && prefixRe.test(lines[0])) lines.shift()
  const suffixRe = /^\s*(?:[#>*\s-]*)(?:希望|如需|如果|若|以上[。！!]?|如需调整|欢迎提出|请告诉我|可以告诉我)[^\n]{0,40}$/
  while (lines.length > 1 && suffixRe.test(lines[lines.length - 1])) lines.pop()

  // 规范化行首标记：模型常输出「##标题」「-项目」这类缺少空格的写法， CommonMark 不识别
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i]
      .replace(/^(\s*#{1,6})([^\s#])/, '$1 $2')
      .replace(/^(\s*[-*+])([^\s*+-])/, '$1 $2')
  }

  let result = lines.join('\n').trim()

  const prefixes = [context.noteTitle, context.selectedText]
    .map((t) => (t ?? '').trim().replace(/^#+\s*/, ''))
    .filter((t) => t.length >= 2)
  if (prefixes.length > 0) {
    const resultLines = result.split('\n')
    const heading = resultLines[0].match(/^\s*(#{1,6})\s*(.+)$/)
    if (heading && resultLines.length > 0) {
      const headingText = heading[2].trim()
      const matched = prefixes.find((p) =>
        headingText.toLowerCase().startsWith(p.slice(0, Math.min(6, p.length)).toLowerCase()),
      )
      // 仅当标题行里混入了明显是正文的内容（较长或含句读）才拆分，避免误拆「## 测试概述」这类短标题
      const extra = matched ? headingText.slice(matched.length).trim() : ''
      const looksLikeProse = extra.length > 12 || /[，。；、,.;:！!？?]/.test(extra)
      if (matched && extra && looksLikeProse) {
        resultLines[0] = `${heading[1]} ${matched}`
        resultLines.splice(1, 0, '', extra)
        result = resultLines.join('\n').trim()
      }
    }
  }
  return result
}

export default function MarkdownEditor({ note }: MarkdownEditorProps) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('notes')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<INoteVersion | null>(null)
  const [diffMode, setDiffMode] = useState(false)
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('edit')
  // ── 行内 AI（选区触发，定位在选区附近） ──
  const [showInlineAi, setShowInlineAi] = useState(false)
  const [inlineCoords, setInlineCoords] = useState<{ top: number; left: number } | null>(null)
  const [inlineAiResult, setInlineAiResult] = useState('')
  const [inlineAiLoading, setInlineAiLoading] = useState(false)
  const [inlineAiAction, setInlineAiAction] = useState<'continue' | 'polish' | 'translate' | 'condense' | 'expand' | 'explain' | 'custom'>('continue')
  const [inlineCustomPrompt, setInlineCustomPrompt] = useState('')
  const [aiSelection, setAiSelection] = useState('')

  // ── AI 助手面板（按钮触发，固定在编辑区右上角） ──
  const [showAssistant, setShowAssistant] = useState(false)
  const [assistantResult, setAssistantResult] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantAction, setAssistantAction] = useState<'continue' | 'polish' | 'translate' | 'condense' | 'expand' | 'explain' | 'custom'>('continue')
  const [assistantCustomPrompt, setAssistantCustomPrompt] = useState('')
  const milkdownRef = useRef<MilkdownEditorHandle>(null)
  const inlineInputRef = useRef<HTMLTextAreaElement>(null)
  const inlineAbortRef = useRef<AbortController | null>(null)
  const assistantAbortRef = useRef<AbortController | null>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [copied, setCopied] = useState(false)
  // 浮动格式工具栏：链接输入与分栏滚动同步
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const editScrollRef = useRef<HTMLDivElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const syncingScroll = useRef(false)
  // 左侧导航目录：默认展开，可从工具条收起；activeHeading 跟随滚动高亮
  const [tocVisible, setTocVisible] = useState(true)
  const [activeHeading, setActiveHeading] = useState(0)
  // 目录放进居中正文左侧的留白槽：槽宽不够时不渲染，避免压住正文
  const tocGutterRef = useRef<HTMLDivElement>(null)
  const [tocGutterWide, setTocGutterWide] = useState(false)

  // ── 模型选择 ──
  const { data: allModels = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: aiModelService.getAll,
  })
  const chatModels = useMemo(() => allModels.filter((m) => m.purpose === 'chat'), [allModels])
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const activeModelName = useMemo(() => {
    if (!selectedModelId) return t('editor.defaultModel')
    return chatModels.find((m) => m.id === selectedModelId)?.displayName ?? t('editor.defaultModel')
  }, [selectedModelId, chatModels, t])

  // 点击外部关闭模型选择器
  useEffect(() => {
    if (!showModelPicker) return
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelPicker])

  const updateNote = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof noteService.update>[1] }) =>
      noteService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['note', note?.id] })
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
      queryClient.invalidateQueries({ queryKey: ['noteVersions', note?.id] })
      setIsDirty(false)
    },
  })

  const setNoteIcon = useMutation({
    mutationFn: ({ id, icon }: { id: string; icon: string }) => noteService.update(id, { icon }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['note', note?.id] })
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
    },
  })

  const restoreVersion = useMutation({
    mutationFn: ({ noteId, versionId, content }: { noteId: string; versionId: string; content: string }) =>
      noteVersionService.restore(noteId, versionId).then(() => content),
    onSuccess: (restoredContent) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['noteVersions', note?.id] })
      // 同步到 Milkdown 编辑器
      milkdownRef.current?.setMarkdown(restoredContent)
      setContent(restoredContent)
      setIsDirty(false)
      setShowVersions(false)
      setPreviewVersion(null)
    },
  })

  const { data: versions = [] } = useQuery({
    queryKey: ['noteVersions', note?.id],
    queryFn: () => (note ? noteVersionService.getVersions(note.id) : Promise.resolve([])),
    enabled: !!note && showVersions,
  })

  const { data: shareLinks = [], refetch: refetchShareLinks } = useQuery({
    queryKey: ['shareLinks', note?.id],
    queryFn: () => (note ? shareService.getByNote(note.id) : Promise.resolve([])),
    enabled: !!note && showShareDialog,
  })

  // ── 知识库索引状态 ──

  const { data: embeddingPage } = useQuery({
    queryKey: ['embeddingStatuses', note?.id],
    queryFn: () => knowledgeBaseService.getEmbeddingStatuses({ noteId: note?.id }),
    enabled: !!note,
    refetchInterval: (query) =>
      query.state.data?.items.some((s) => s.hasRunningTask) ? 3000 : false,
  })

  const currentEmbedding = useMemo(
    () => embeddingPage?.items.find((s) => s.noteId === note?.id),
    [embeddingPage, note?.id]
  )

  // 索引与图谱提取都是「入队即返回」，按钮 loading 只能轮询任务表得到。
  // 与 embeddingStatuses 同一套路：点击后 invalidate 立即回一次，之后仅在有任务在跑时轮询。
  // 刚入队的任务排在最新一页，取前 20 条足够覆盖。
  const { data: noteTaskTypes = [] } = useQuery({
    queryKey: ['noteTasks', note?.id],
    queryFn: async () => {
      const page = await taskService.getAll({ page: 1, pageSize: 20 })
      return page.items
        .filter((t) => t.entityId === note?.id && (t.status === 0 || t.status === 1))
        .map((t) => t.taskType)
    },
    enabled: !!note,
    refetchInterval: (query) => (query.state.data?.length ?? 0) > 0 ? 2000 : false,
  })

  const isIndexing = noteTaskTypes.some((type) =>
    type === 'GenerateEmbedding' || type === 'GenerateKnowledgeItemEmbedding')
  const isExtractingGraph = noteTaskTypes.includes('GraphExtract')

  const [indexError, setIndexError] = useState<string | null>(null)

  const generateEmbedding = useMutation({
    mutationFn: () => noteService.generateIndex(note!.id),
    onSuccess: () => {
      setIndexError(null)
      queryClient.invalidateQueries({ queryKey: ['embeddingStatuses'] })
      queryClient.invalidateQueries({ queryKey: ['noteTasks', note!.id] })
    },
    onError: (err: Error) => {
      setIndexError(err.message || t('editor.indexFailed'))
      queryClient.invalidateQueries({ queryKey: ['embeddingStatuses'] })
      queryClient.invalidateQueries({ queryKey: ['noteTasks', note!.id] })
      setTimeout(() => setIndexError(null), 5000)
    },
  })

  // ── 知识图谱提取 ──
  const [extractNotice, setExtractNotice] = useState<{ text: string; ok: boolean } | null>(null)

  const extractGraph = useMutation({
    mutationFn: () => graphService.batchExtractQueue([note!.id]),
    onSuccess: (result) => {
      setExtractNotice(
        result.queuedCount > 0
          ? { text: t('editor.queued'), ok: true }
          : { text: t('editor.alreadyQueued'), ok: false }
      )
      queryClient.invalidateQueries({ queryKey: ['noteTasks', note!.id] })
      setTimeout(() => setExtractNotice(null), 5000)
    },
    onError: (err: Error) => {
      setExtractNotice({ text: err.message || t('editor.queueFailed'), ok: false })
      queryClient.invalidateQueries({ queryKey: ['noteTasks', note!.id] })
      setTimeout(() => setExtractNotice(null), 5000)
    },
  })

  const createShareLink = useMutation({
    mutationFn: (expiresInHours?: number) =>
      shareService.create(note!.id, expiresInHours),
    onSuccess: () => {
      refetchShareLinks()
    },
  })

  const deactivateShareLink = useMutation({
    mutationFn: (id: string) => shareService.deactivate(id),
    onSuccess: () => {
      refetchShareLinks()
    },
  })

  const handleAiExecuteFor = async (
    action: typeof inlineAiAction,
    customPrompt: string,
    context: 'inline' | 'assistant',
  ) => {
    if (!note) return
    const setLoading = context === 'inline' ? setInlineAiLoading : setAssistantLoading
    const setResult = context === 'inline' ? setInlineAiResult : setAssistantResult
    const abortRef = context === 'inline' ? inlineAbortRef : assistantAbortRef
    const selection = context === 'inline' ? aiSelection : (milkdownRef.current?.getMarkdown() ?? '')
    // 自定义输入（用户改过提示词）优先，否则用动作预设
    const systemPrompt = customPrompt.trim() || aiActionPreset(action)
    if (context === 'inline') setInlineAiAction(action)
    else setAssistantAction(action)

    // 同一面板重复执行时先中止上一次请求
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    let acc = ''
    setResult('')
    try {
      acc = await noteAiService.continue(
        note.id,
        { selectedText: selection || undefined, systemPrompt, modelId: selectedModelId || undefined },
        {
          signal: controller.signal,
          // 流式逐段回显，用户无需等整段生成完
          onDelta: (text) => { acc += text; setResult(acc) },
        },
      )
      setResult(acc)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('editor.aiFailed')
      if (controller.signal.aborted) {
        // 用户主动停止：保留已生成的部分
        setResult(acc)
        return
      }
      setResult(acc ? `${acc}\n\n[ERROR] ${message}` : `[ERROR] ${message}`)
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const handleStopAi = (context: 'inline' | 'assistant') => {
    const abortRef = context === 'inline' ? inlineAbortRef : assistantAbortRef
    abortRef.current?.abort()
  }

  /**
   * 由 MilkdownEditor 在选区变化时回调，更新行内 AI 浮窗的位置和选中文字。
   * 行内 AI 面板不再随选中自动弹出（避免与格式工具栏叠加、误触），
   * 改为由浮动工具栏上的「行内 AI」按钮显式打开。
   */
  const handleSelectionChange = useCallback((info: SelectionInfo) => {
    if (info.hasSelection && info.coords) {
      setAiSelection(info.text)
      setInlineCoords(info.coords)
    } else {
      setAiSelection('')
      setInlineCoords(null)
      if (!inlineAiLoading && !inlineAiResult) {
        setShowInlineAi(false)
      }
    }
  }, [inlineAiLoading, inlineAiResult])

  /**
   * 导航目录：按滚动位置推断当前所在章节（最后一个越过视口上沿的标题）。
   * 编辑区有吸顶工具条，阈值多留一节，避免标题刚露出就被算作当前章节。
   */
  const updateActiveHeading = useCallback((pane: HTMLDivElement) => {
    const headings = pane.querySelectorAll('h1,h2,h3,h4,h5,h6')
    if (headings.length === 0) return
    const threshold = pane.getBoundingClientRect().top + (pane === editScrollRef.current ? 56 : 16)
    let active = 0
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].getBoundingClientRect().top <= threshold) active = i
      else break
    }
    setActiveHeading((prev) => (prev === active ? prev : active))
  }, [])

  /** 导航目录点击：把可见的两栏都滚到对应标题（分栏下按比例同步落点不准，各自滚更齐） */
  const scrollToHeading = useCallback((index: number) => {
    for (const pane of [editScrollRef.current, previewScrollRef.current]) {
      if (!pane) continue
      const target = pane.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]
      if (!target) continue
      const offset = pane === editScrollRef.current ? 52 : 8
      const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - offset
      pane.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }
  }, [])

  // 分栏模式：编辑区与预览区滚动同步（按滚动比例，避免循环触发）
  const handleEditScroll = useCallback(() => {
    const edit = editScrollRef.current
    // 目录高亮要先算：单栏模式下没有对端 pane，不能放在同步逻辑后面
    if (edit) updateActiveHeading(edit)
    if (syncingScroll.current) return
    const preview = previewScrollRef.current
    if (!edit || !preview) return
    const editMax = edit.scrollHeight - edit.clientHeight
    const previewMax = preview.scrollHeight - preview.clientHeight
    if (editMax <= 0 || previewMax <= 0) return
    syncingScroll.current = true
    preview.scrollTop = (edit.scrollTop / editMax) * previewMax
    requestAnimationFrame(() => { syncingScroll.current = false })
  }, [updateActiveHeading])

  const handlePreviewScroll = useCallback(() => {
    const preview = previewScrollRef.current
    if (preview) updateActiveHeading(preview)
    if (syncingScroll.current) return
    const edit = editScrollRef.current
    if (!edit || !preview) return
    const editMax = edit.scrollHeight - edit.clientHeight
    const previewMax = preview.scrollHeight - preview.clientHeight
    if (editMax <= 0 || previewMax <= 0) return
    syncingScroll.current = true
    edit.scrollTop = (preview.scrollTop / previewMax) * editMax
    requestAnimationFrame(() => { syncingScroll.current = false })
  }, [updateActiveHeading])

  // 工具栏命令统一入口：避免在渲染期读取 ref
  const runFormat = useCallback((fn: (md: MilkdownEditorHandle) => void) => {
    const md = milkdownRef.current
    if (md) fn(md)
  }, [])

  /** AI 助手按钮：打开/关闭固定面板 */
  const toggleAssistant = () => {
    setShowAssistant((prev) => !prev)
    setAssistantResult('')
    setAssistantCustomPrompt('')
    setAssistantAction('continue')
    setShowModelPicker(false)
  }

  const closeInlineAi = () => {
    setShowInlineAi(false)
    setInlineAiResult('')
    setInlineCustomPrompt('')
    setInlineAiAction('continue')
    setShowModelPicker(false)
  }

  const handleReplaceSelection = () => {
    if (!inlineAiResult || inlineAiResult.startsWith('[ERROR]')) return
    const cleaned = sanitizeAiResult(inlineAiResult, { noteTitle: note?.title, selectedText: aiSelection })
    if (!cleaned) return
    // 选区丢失时 replaceSelection 会在光标处插入整段结果，导致内容重复；
    // 此时拒绝替换并提示用户改用「追加」
    const selection = milkdownRef.current?.getSelectionInfo()
    if (!selection?.hasSelection) {
      setInlineAiResult(`[ERROR] ${t('editor.selectionLost')}`)
      return
    }
    milkdownRef.current?.replaceSelection(cleaned)
    setInlineAiResult('')
    setAiSelection('')
    closeInlineAi()
  }

  const handleInsertAiResult = () => {
    const result = inlineAiResult || assistantResult
    if (!result || result.startsWith('[ERROR]')) return
    const cleaned = sanitizeAiResult(result)
    if (!cleaned) return
    milkdownRef.current?.appendContent(cleaned)
    setInlineAiResult('')
    setAssistantResult('')
  }

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const textarea = document.createElement('textarea')
      textarea.value = url
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const noteId = note?.id
  const noteTitle = note?.title ?? ''
  const noteContent = note?.content ?? ''
  // 未命名笔记（后端默认标题）在标题框里显示为占位符：直接输入即命名，无需先清空
  const isUntitled = title === t('note.untitled')

  // Synchronously sync state when note changes (avoids useEffect timing issues)
  const prevNoteIdRef = useRef<string | undefined>(undefined)
  if (noteId !== prevNoteIdRef.current) {
    prevNoteIdRef.current = noteId
    setTitle(noteTitle)
    setContent(noteContent)
    setIsDirty(false)
    setPreviewVersion(null)
    setShowInlineAi(false)
    setInlineCoords(null)
    setInlineAiResult('')
    setInlineAiLoading(false)
    setAssistantResult('')
    setAssistantLoading(false)
    setShowAssistant(false)
    setAiSelection('')
    setActiveHeading(0)
  }

  const tocItems = useMemo(() => parseNoteHeadings(content), [content])

  // 目录留白槽宽度变化（打开笔记、切视图、开侧栏、改窗口）时重算是否放得下目录。
  // 未选中笔记时正文区整个不渲染（留白槽也不在），所以要跟着 noteId 重挂观察
  useEffect(() => {
    const el = tocGutterRef.current
    if (!el) return
    const check = () => setTocGutterWide(el.clientWidth >= TOC_GUTTER_MIN)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [noteId])

  const save = useCallback(() => {
    if (!note || !isDirty) return
    updateNote.mutate({
      id: note.id,
      data: {
        title,
        content,
      },
    })
  }, [note, isDirty, title, content, updateNote])

  useEffect(() => {
    const timer = setTimeout(() => {
      save()
    }, 3000)
    return () => clearTimeout(timer)
  }, [title, content, save])

  const handleTitleChange = (value: string) => {
    setTitle(value)
    setIsDirty(true)
  }

  const handleContentChange = (value?: string) => {
    setContent(value || '')
    setIsDirty(true)
  }

  if (!note) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-transparent">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
            <PenLine size={28} className="text-white" />
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('editor.emptyHint')}</p>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">{t('editor.emptySubHint')}</p>
        </div>
      </div>
    )
  }

  // 格式工具按钮组：常驻工具条与选中浮动工具栏共用
  const formatToolbarContent = (
    <>
      {FORMAT_ACTIONS.map((item) => {
        const Icon = item.icon
        return (
          <Button variant="ghost" tone="gray" className="flex h-7 w-7 items-center justify-center p-0 rounded-lg text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]" key={item.key}
            title={t(`editor.format.${item.titleKey}`)}
            onClick={(e) => { e.preventDefault(); runFormat(item.run) }}>
            <Icon size={14} />
          </Button>
        )
      })}
      <span className="mx-0.5 h-4 w-px bg-gray-200 dark:bg-gray-700" />
      <Button variant="ghost" tone="indigo" className="flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12px] text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/30" title={t('editor.inlineAiHint')}
        onClick={() => { setShowInlineAi(true); setInlineAiResult(''); setInlineCustomPrompt('') }}>
        <Sparkles size={14} />
        AI
      </Button>
      {linkDraft === null ? (
        <>
          <Button variant="ghost" tone="gray" className="flex h-7 w-7 items-center justify-center p-0 rounded-lg text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]" title={t('editor.insertLink')}
            onClick={() => setLinkDraft('')}>
            <Link2 size={14} />
          </Button>
          <Button variant="ghost" tone="gray" className="flex h-7 w-7 items-center justify-center p-0 rounded-lg text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]" title={t('editor.insertTable')}
            onClick={() => runFormat((md) => md.insertTable())}>
            <Table2 size={14} />
          </Button>
          <Button variant="ghost" tone="gray" className="flex h-7 w-7 items-center justify-center p-0 rounded-lg text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]" title={t('editor.divider')}
            onClick={() => runFormat((md) => md.insertDivider())}>
            <Minus size={14} />
          </Button>
          <Button variant="ghost" tone="gray" className="flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12px] text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]" title={t('editor.insertDiagram')}
            onClick={() => runFormat((md) => md.insertDiagram())}>
            <Workflow size={14} />
            {t('editor.diagramLabel')}
          </Button>
        </>
      ) : (
        <Input tone="blue" glass
          autoFocus
          value={linkDraft}
          onChange={(e) => setLinkDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && linkDraft.trim()) {
              runFormat((md) => md.insertLink(linkDraft.trim()))
              setLinkDraft(null)
            }
            if (e.key === 'Escape') setLinkDraft(null)
          }}
          placeholder={t('editor.linkPlaceholder')}
          className="h-7 w-44 text-[12px]"
        />
      )}
    </>
  )

  return (
    <PageContainer variant="fill" className="flex-col bg-white pt-2 dark:bg-gray-900 glass">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-gray-100 bg-transparent px-4 dark:border-gray-800/50">
        <PillTabs
          value={viewMode}
          onSelect={(key) => setViewMode(key as typeof viewMode)}
          className="gap-0.5 rounded-xl p-0.5"
          items={[
            { key: 'preview', label: <><Eye size={13} />{t('common:preview')}</> },
            { key: 'edit', label: <><Edit3 size={13} />{t('common:edit')}</> },
            { key: 'split', label: <><Columns2 size={13} />{t('editor.viewSplit')}</> },
          ]}
        />
        <div className="flex items-center gap-1.5">
          <span className="hidden text-[11px] text-gray-400/80 sm:inline">
            {updateNote.isPending ? (
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse-soft" />{t('editor.saving')}</span>
            ) : isDirty ? (
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{t('editor.unsavedChanges')}</span>
            ) : (
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{t('common:saved')}</span>
            )}
          </span>
          {tocItems.length > 0 && tocGutterWide && (
            <button
              onClick={() => setTocVisible((v) => !v)}
              className={`rounded-lg p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 ${tocVisible ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300' : ''}`}
              title={t('editor.toc')}
            >
              <List size={15} />
            </button>
          )}
          <button
            onClick={() => setShowVersions(!showVersions)}
            className={`rounded-lg p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 ${showVersions ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300' : ''}`}
            title={t('editor.versions')}
          >
            <History size={15} />
          </button>
          <button
            onClick={() => setShowShareDialog(true)}
            className={`rounded-lg p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 ${showShareDialog ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300' : ''}`}
            title={t('editor.exportShare')}
          >
            <Share2 size={15} />
          </button>
          <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
          <button
            onClick={toggleAssistant}
            disabled={assistantLoading}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-indigo-500/20 transition-all hover:shadow-md hover:shadow-indigo-500/30 hover:brightness-110 active:scale-[0.97] disabled:opacity-50 ${
              showAssistant
                ? 'bg-gradient-to-r from-indigo-600 to-purple-700'
                : 'bg-gradient-to-r from-indigo-500 to-purple-600'
            }`}
            title={t('editor.aiAssistantHint')}
          >
            <Sparkles size={13} />
            {t('editor.aiAssistant')}
          </button>
        </div>
      </div>

      {/* 标题与元信息：与正文同一居中限宽，宽屏下不拉成一整行 */}
      <div className="border-b border-gray-100 bg-transparent px-8 pb-3 pt-4 dark:border-gray-800/50">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          {/* 笔记图标：emoji 或默认笔记图标，点击更换 */}
          <EmojiPicker
            value={note!.icon}
            onChange={(icon) => setNoteIcon.mutate({ id: note!.id, icon })}
          >
            {note!.icon
              ? <span className="text-[26px] leading-none">{note!.icon}</span>
              : <FileText size={24} className="shrink-0 text-gray-300 dark:text-gray-600" />}
          </EmojiPicker>
          <input
            type="text"
            value={isUntitled ? '' : title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={t('note.untitled')}
            className="min-w-0 flex-1 border-none bg-transparent text-[28px] font-bold leading-snug text-gray-800 outline-none placeholder:text-gray-300 dark:text-gray-100 dark:placeholder:text-gray-600"
          />
        </div>
        <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-4 text-[11px] text-gray-400 dark:text-gray-500">
          <span className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 dark:bg-white/[0.04]">
            <Calendar size={11} />
            {new Date(note!.createdAt).toLocaleDateString(uiLocale())}
          </span>
          <span className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 dark:bg-white/[0.04]">
            <Clock size={11} />
            {t('note.updated', { time: formatDistanceToNow(new Date(note!.updatedAt), { addSuffix: true, locale: uiLocale() === 'en' ? enUS : zhCN }) })}
          </span>
          {isIndexing ? (
            <span className="flex items-center gap-1.5 rounded-md bg-teal-50 px-2 py-1 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400">
              <Loader2 size={11} className="animate-spin" />
              {t('editor.indexing')}
            </span>
          ) : currentEmbedding?.hasEmbedding ? (
            <span className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
              <Database size={11} />
              {t('editor.indexed', { n: currentEmbedding.chunkCount })}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-gray-400 dark:bg-white/[0.04] dark:text-gray-500">
              <Database size={11} />
              {t('editor.notIndexed')}
            </span>
          )}
          {indexError && (
            <span className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600 dark:bg-red-900/20 dark:text-red-400">
              <AlertCircle size={11} />
              {indexError}
            </span>
          )}
          <Button variant="secondary" className="flex items-center gap-1 rounded-md border border-gray-200 bg-white glass px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-blue-600 dark:hover:text-blue-400" onClick={() => generateEmbedding.mutate()}
            disabled={generateEmbedding.isPending || isIndexing}
            
            title={currentEmbedding?.hasEmbedding ? t('editor.rebuildIndex') : t('editor.generateIndex')}>
            {isIndexing ? (
              <Loader2 size={11} className="animate-spin" />
            ) : generateEmbedding.isPending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : currentEmbedding?.hasEmbedding ? (
              <RefreshCw size={11} />
            ) : (
              <Database size={11} />
            )}
            {isIndexing
              ? t('editor.indexing')
              : generateEmbedding.isPending
                ? t('editor.processing')
                : currentEmbedding?.hasEmbedding
                  ? t('editor.rebuildIndex')
                  : t('editor.generateIndex')}
          </Button>
          <Button variant="secondary" className="flex items-center gap-1 rounded-md border border-gray-200 bg-white glass px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-violet-300 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-violet-600 dark:hover:text-violet-400" onClick={() => extractGraph.mutate()}
            disabled={extractGraph.isPending || isExtractingGraph}
            
            title={t('editor.extractHint')}>
            {isExtractingGraph || extractGraph.isPending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Network size={11} />
            )}
            {isExtractingGraph || extractGraph.isPending ? t('editor.extracting') : t('editor.extract')}
          </Button>
          {extractNotice && (
            <span
              className={
                extractNotice.ok
                  ? 'flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-[11px] text-violet-600 dark:bg-violet-900/20 dark:text-violet-400'
                  : 'flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
              }
            >
              {extractNotice.ok ? <Check size={11} /> : <AlertCircle size={11} />}
              {extractNotice.text}
            </span>
          )}
        </div>
        <div className="mx-auto mt-2 max-w-3xl">
          <TagInput noteId={note!.id} tags={note!.tags} />
        </div>
      </div>

      {showShareDialog && (
        <div className="animate-fade-in border-b border-gray-100 bg-gradient-to-r from-blue-50/50 to-indigo-50/30 p-4 dark:border-gray-800/50 dark:from-blue-900/10 dark:to-indigo-900/5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">{t('share.title')}</h3>
            <button
              onClick={() => setShowShareDialog(false)}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/50 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              { label: t('share.permanentLink'), hours: undefined as number | undefined, primary: true },
              { label: t('share.hours24'), hours: 24, primary: false },
              { label: t('share.days3'), hours: 72, primary: false },
            ].map(({ label, hours, primary }) => (
              <button
                key={label}
                onClick={() => createShareLink.mutate(hours)}
                disabled={createShareLink.isPending}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  primary
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {shareLinks.length > 0 && (
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {shareLinks.map((link: IShareLink) => (
                <Card key={link.id} className="flex items-center gap-2 p-2 dark:bg-gray-800">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-gray-600 dark:text-gray-400">{link.shareUrl}</div>
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {link.isActive ? t('share.visits', { n: link.viewCount }) : t('common:disabled')}
                      {link.expiresAt && ` · ${t('share.expires', { time: formatDateTime(link.expiresAt) })}`}
                    </div>
                  </div>
                  {link.isActive && (
                    <IconButton variant="ghost" tone="gray" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" label={t('share.copyLink')} onClick={() => handleCopyLink(link.shareUrl)}
                      
                      title={t('share.copyLink')}>
                      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </IconButton>
                  )}
                  {link.isActive && (
                    <IconButton variant="ghost" tone="gray" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500" label={t('share.disableLink')} onClick={() => deactivateShareLink.mutate(link.id)}
                      
                      title={t('share.disableLink')}>
                      <X size={14} />
                    </IconButton>
                  )}
                </Card>
              ))}
            </div>
          )}
          {shareLinks.length === 0 && (
            <div className="py-2 text-center text-xs text-gray-500">{t('share.noLinks')}</div>
          )}
        </div>
      )}

      {/* 正文列整体居中：目录放进居中正文左侧的留白槽，挨着正文而不挤压它；
          分栏时中心列放宽到两倍阅读宽，两个子栏各自仍是阅读宽 */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-transparent">
        <div
          className={`grid min-h-0 min-w-0 flex-1 ${
            viewMode === 'split'
              ? 'grid-cols-[minmax(0,1fr)_minmax(0,96rem)_minmax(0,1fr)]'
              : 'grid-cols-[minmax(0,1fr)_minmax(0,48rem)_minmax(0,1fr)]'
          }`}
        >
          <div ref={tocGutterRef} className="flex min-w-0 justify-end overflow-hidden">
            {tocVisible && tocItems.length > 0 && tocGutterWide && (
              <NoteToc items={tocItems} activeIndex={activeHeading} onSelect={scrollToHeading} />
            )}
          </div>
          <div className="flex min-h-0 min-w-0 flex-col">
            {/* 常驻格式工具条：dock 在正文上方、不随正文滚动。
                放在滚动区里吸顶会盖住正文（文字从工具条下面滑过去），故改为独立一行 */}
            {(viewMode === 'edit' || viewMode === 'split') && (
              <div className="shrink-0 border-b border-gray-100 bg-transparent py-1.5 dark:border-gray-800/50">
                <div className={`flex flex-wrap items-center gap-0.5 px-2 ${viewMode === 'split' ? '' : 'mx-auto max-w-3xl'}`}>
                  {formatToolbarContent}
                </div>
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1">
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div ref={editScrollRef} onScroll={handleEditScroll} className={`relative ${viewMode === 'split' ? 'flex-1' : 'w-full'} min-h-0 overflow-y-auto bg-transparent`}>
            <div className="mx-auto w-full max-w-3xl px-8 py-5">
              <MilkdownEditor
                key={noteId}
                ref={milkdownRef}
                initialMarkdown={noteContent}
                onChange={handleContentChange}
                onSelectionChange={handleSelectionChange}
                placeholder={t('editor.placeholder')}
              />
            </div>

            {/* 浮动格式工具栏：选中文本时出现在选区上方（mousedown 阻止默认行为以保留选区） */}
            {inlineCoords && (
              <div
                className="animate-fade-in absolute z-30 max-w-[calc(100%-1rem)]"
                style={{ top: Math.max(inlineCoords.top - 46, 4), left: inlineCoords.left }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <Card padded={false} className="flex flex-wrap items-center gap-0.5 p-1 shadow-lg shadow-black/5 [--glass-bg:#ffffff] dark:[--glass-bg:#10141f]">
                  {formatToolbarContent}
                </Card>
              </div>
            )}

            {showInlineAi && inlineCoords && (
              <div
                className="animate-fade-in absolute z-20 w-80 max-w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-indigo-200 bg-white glass glass-float shadow-xl shadow-indigo-500/10 dark:border-indigo-900/50 dark:bg-gray-900"
                style={{ top: inlineCoords.top, left: inlineCoords.left }}
              >                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={13} className="text-indigo-500" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{t('editor.inlineAi')}</span>
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                      {aiSelection.length > 0 ? t('editor.selectionChars', { n: aiSelection.length }) : t('editor.fullText')}
                    </span>
                  </div>
                  <button
                    onClick={closeInlineAi}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="px-3 py-2">
                  {!inlineAiResult && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {[
                        { key: 'polish', label: t('editor.ai.polish') },
                        { key: 'translate', label: t('editor.ai.translate') },
                        { key: 'condense', label: t('editor.ai.condense') },
                        { key: 'expand', label: t('editor.ai.expand') },
                        { key: 'explain', label: t('editor.ai.explain') },
                      ].map((a) => (
                        <button
                          key={a.key}
                      onClick={() => {
                        setInlineAiAction(a.key as typeof inlineAiAction)
                        setInlineCustomPrompt(aiActionPreset(a.key))
                        setInlineAiResult('')
                        requestAnimationFrame(() => inlineInputRef.current?.focus())
                      }}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            inlineAiAction === a.key
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                          }`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {!inlineAiResult && (
                    <Textarea tone="indigo" size="sm"
                      ref={inlineInputRef}
                      value={inlineCustomPrompt}
                      onChange={(e) => setInlineCustomPrompt(e.target.value)}
                      onFocus={() => setInlineAiAction('custom')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleAiExecuteFor(inlineAiAction, inlineCustomPrompt, 'inline')
                        }
                        if (e.key === 'Escape') {
                          closeInlineAi()
                        }
                      }}
                      placeholder={t('editor.inlinePlaceholder')}
                      rows={2}
                      className="w-full resize-none text-xs"
                    />
                  )}

                  {inlineAiResult && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs whitespace-pre-wrap text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                      {inlineAiResult}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/50">
                  <div className="relative" ref={modelPickerRef}>
                    <Button variant="ghost" tone="gray" className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-gray-500 transition-colors hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700" onClick={() => setShowModelPicker((v) => !v)}
                      
                      title={t('editor.selectModel')}>
                      <Bot size={11} />
                      {activeModelName}
                      <ChevronDown size={10} className={`transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
                    </Button>
                    {showModelPicker && (
                      <div className="absolute bottom-full left-0 z-30 mb-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                        <Button variant="ghost" tone="gray" className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700" onClick={() => { setSelectedModelId(''); setShowModelPicker(false) }}>
                          <span className="flex-1">{t('editor.defaultModel')}</span>
                          {!selectedModelId && <span className="text-[10px] text-emerald-500">✓</span>}
                        </Button>
                        {chatModels.filter((m) => !m.isDefault).map((m) => (
                          <Button variant="ghost" tone="gray" className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700" key={m.id}
                            onClick={() => { setSelectedModelId(m.id); setShowModelPicker(false) }}>
                            <span className="flex-1">{m.displayName}</span>
                            {selectedModelId === m.id && <span className="text-[10px] text-emerald-500">✓</span>}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {inlineAiResult && !inlineAiResult.startsWith('[ERROR]') && (
                      <>
                        <Button variant="primary" tone="emerald" className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700" onClick={handleReplaceSelection}>
                          {t('editor.acceptReplace')}
                        </Button>
                        <Button variant="ghost" tone="indigo" className="rounded-md px-2.5 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/30" onClick={handleInsertAiResult}>
                          {t('editor.append')}
                        </Button>
                        <Button variant="ghost" tone="gray" className="rounded-md px-2.5 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-200 dark:hover:bg-gray-800" onClick={() => { setInlineAiResult(''); setInlineCustomPrompt('') }}>
                          {t('editor.rewrite')}
                        </Button>
                      </>
                    )}
                    {!inlineAiResult && (
                      <button
                        onClick={() => handleAiExecuteFor(inlineAiAction, inlineCustomPrompt, 'inline')}
                        disabled={inlineAiLoading}
                        className="flex items-center gap-1 rounded-md bg-gradient-to-r from-blue-500 to-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition-all hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50"
                      >
                        <Send size={11} />
                        {inlineAiLoading ? t('editor.generating') : t('editor.execute')}
                      </button>
                    )}
                    {inlineAiLoading && (
                      <Button variant="ghost" tone="red" className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => handleStopAi('inline')}>
                        <Square size={11} />
                        {t('common:stop')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div ref={previewScrollRef} onScroll={handlePreviewScroll} className={`${viewMode === 'split' ? 'flex-1 border-l border-gray-100 dark:border-gray-800/50' : 'w-full'} overflow-y-auto bg-transparent px-8 py-6`}>
            <div className="mx-auto w-full max-w-3xl">
              <div className="markdown-preview prose prose-sm max-w-none dark:prose-invert">
                <ThemedMarkdown source={content} />
              </div>
            </div>
          </div>
        )}
            </div>
          </div>
        </div>

        {showAssistant && (
          <div className="animate-slide-in-right flex w-80 flex-col border-l border-indigo-200 bg-white glass dark:border-indigo-900/30 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                  <Sparkles size={14} className="text-indigo-500" />
                </div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('editor.aiAssistant')}</h3>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">{t('editor.fullText')}</span>
              </div>
              <button
                onClick={() => { setShowAssistant(false); setAssistantResult(''); setAssistantCustomPrompt(''); }}
                className="rounded-lg p-1.5 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {!assistantResult && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {[
                    { key: 'continue', label: t('editor.ai.continue') },
                    { key: 'polish', label: t('editor.ai.polish') },
                    { key: 'translate', label: t('editor.ai.translate') },
                    { key: 'condense', label: t('editor.ai.condense') },
                    { key: 'expand', label: t('editor.ai.expand') },
                    { key: 'explain', label: t('editor.ai.explain') },
                  ].map((a) => (
                    <button
                      key={a.key}
                      onClick={() => {
                        setAssistantAction(a.key as typeof assistantAction)
                        setAssistantCustomPrompt(aiActionPreset(a.key))
                        setAssistantResult('')
                      }}
                      className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                        assistantAction === a.key
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              {!assistantResult && (
                <Textarea tone="indigo"
                  value={assistantCustomPrompt}
                  onChange={(e) => setAssistantCustomPrompt(e.target.value)}
                  onFocus={() => setAssistantAction('custom')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleAiExecuteFor(assistantAction, assistantCustomPrompt, 'assistant')
                    }
                  }}
                  placeholder={t('editor.assistantPlaceholder')}
                  rows={3}
                  className="w-full resize-none text-xs"
                />
              )}

              {assistantResult && (
                <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs whitespace-pre-wrap text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {assistantResult}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="relative">
                  <Button variant="ghost" tone="gray" className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-gray-500 transition-colors hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700" onClick={() => setShowModelPicker((v) => !v)}
                    
                    title={t('editor.selectModel')}>
                    <Bot size={11} />
                    {activeModelName}
                    <ChevronDown size={10} className={`transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
                  </Button>
                  {showModelPicker && (
                    <div className="absolute bottom-full left-0 z-30 mb-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      <Button variant="ghost" tone="gray" className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700" onClick={() => { setSelectedModelId(''); setShowModelPicker(false) }}>
                        <span className="flex-1">{t('editor.defaultModel')}</span>
                        {!selectedModelId && <span className="text-[10px] text-emerald-500">✓</span>}
                      </Button>
                      {chatModels.filter((m) => !m.isDefault).map((m) => (
                        <Button variant="ghost" tone="gray" className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700" key={m.id}
                          onClick={() => { setSelectedModelId(m.id); setShowModelPicker(false) }}>
                          <span className="flex-1">{m.displayName}</span>
                          {selectedModelId === m.id && <span className="text-[10px] text-emerald-500">✓</span>}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {assistantResult && !assistantResult.startsWith('[ERROR]') && (
                    <>
                      <Button variant="primary" tone="emerald" className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700" onClick={handleInsertAiResult}>
                        {t('editor.appendToEnd')}
                      </Button>
                      <Button variant="ghost" tone="gray" className="rounded-md px-2.5 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-200 dark:hover:bg-gray-800" onClick={() => { setAssistantResult(''); setAssistantCustomPrompt('') }}>
                        {t('editor.rewrite')}
                      </Button>
                    </>
                  )}
                  {!assistantResult && (
                    <button
                      onClick={() => handleAiExecuteFor(assistantAction, assistantCustomPrompt, 'assistant')}
                      disabled={assistantLoading}
                      className="flex items-center gap-1 rounded-md bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white transition-all hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50"
                    >
                      <Send size={11} />
                      {assistantLoading ? t('editor.generating') : t('editor.execute')}
                    </button>
                  )}
                  {assistantLoading && (
                    <Button variant="ghost" tone="red" className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => handleStopAi('assistant')}>
                      <Square size={11} />
                      {t('common:stop')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {showVersions && (
          <Card padded={false} className="animate-slide-in-right flex w-80 flex-col border-l">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                  <History size={14} className="text-indigo-500" />
                </div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('editor.versions')}</h3>
              </div>
              <button
                onClick={() => {
                  setShowVersions(false)
                  setPreviewVersion(null)
                }}
                className="rounded-lg p-1.5 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto p-3">
              {versions.length === 0 && (
                <div className="py-10 text-center text-sm text-gray-400">{t('editor.noVersions')}</div>
              )}
              {versions.map((version) => (
                <div
                  key={version.id}
                  onClick={() => setPreviewVersion(version)}
                  className={`cursor-pointer rounded-xl border p-3 transition-all ${
                    previewVersion?.id === version.id
                      ? 'border-indigo-200 bg-indigo-50/60 shadow-sm shadow-indigo-500/5 dark:border-indigo-800/50 dark:bg-indigo-900/20'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50/60 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="truncate text-[13px] font-medium text-gray-700 dark:text-gray-200">{version.title || t('note.untitledShort')}</div>
                  <div className="mt-1 text-[11px] text-gray-400">{new Date(version.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>

            {previewVersion && (
              <div className="border-t border-gray-100 p-4 dark:border-gray-800">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{diffMode ? t('editor.versionCompare') : t('editor.versionPreview')}</div>
                  <Button variant="ghost" tone="gray" size="sm" className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800" onClick={() => setDiffMode((v) => !v)}>
                    {diffMode ? t('editor.closeCompare') : t('editor.compareCurrent')}
                  </Button>
                </div>
                {diffMode ? (
                  <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                    <div>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">{t('editor.currentVersion')}</div>
                      <ThemedMarkdown source={content.slice(0, 1000)} />
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">{t('editor.versions')}</div>
                      <ThemedMarkdown source={previewVersion.content.slice(0, 1000)} />
                    </div>
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                    <ThemedMarkdown source={previewVersion.content.slice(0, 500)} />
                  </div>
                )}
                <button
                  onClick={() => restoreVersion.mutate({ noteId: note!.id, versionId: previewVersion.id, content: previewVersion.content })}
                  disabled={restoreVersion.isPending}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-3 py-2.5 text-[13px] font-medium text-white shadow-sm shadow-emerald-500/20 transition-all hover:shadow-md hover:shadow-emerald-500/25 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                >
                  <RotateCcw size={14} />
                  {t('editor.restoreVersion')}
                </button>
              </div>
            )}
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
