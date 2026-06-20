import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import {
  Check,
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
  Folder,
  Bot,
  Languages,
  Minimize2,
  Maximize2,
  MessageCircle,
  PenLine,
  Send,
} from 'lucide-react'
import { TagInput } from './TagInput'
import ThemedMarkdown from './ThemedMarkdown'
import { noteService } from '../services/noteService'
import { notebookService } from '../services/notebookService'
import { noteVersionService } from '../services/noteVersionService'
import { noteAiService } from '../services/noteAiService'
import { shareService } from '../services/shareService'
import type { INote, INoteVersion, IShareLink, INotebook } from '../types'

interface MarkdownEditorProps {
  note: INote | null
}

export default function MarkdownEditor({ note }: MarkdownEditorProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<INoteVersion | null>(null)
  const [diffMode, setDiffMode] = useState(false)
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [aiResult, setAiResult] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [showInlineAi, setShowInlineAi] = useState(false)
  const [inlineCoords, setInlineCoords] = useState<{ top: number; left: number } | null>(null)
  const [aiAction, setAiAction] = useState<'continue' | 'polish' | 'translate' | 'condense' | 'expand' | 'explain' | 'custom'>('continue')
  const [aiCustomPrompt, setAiCustomPrompt] = useState('')
  const [aiSelection, setAiSelection] = useState('')
  const [aiSelectionRange, setAiSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inlineInputRef = useRef<HTMLTextAreaElement>(null)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [copied, setCopied] = useState(false)

  const updateNote = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof noteService.update>[1] }) =>
      noteService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['noteVersions', note?.id] })
      setIsDirty(false)
    },
  })

  const restoreVersion = useMutation({
    mutationFn: ({ noteId, versionId }: { noteId: string; versionId: string }) =>
      noteVersionService.restore(noteId, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['noteVersions', note?.id] })
      setShowVersions(false)
      setPreviewVersion(null)
    },
  })

  const { data: versions = [] } = useQuery({
    queryKey: ['noteVersions', note?.id],
    queryFn: () => (note ? noteVersionService.getVersions(note.id) : Promise.resolve([])),
    enabled: !!note && showVersions,
  })

  const { data: notebooks = [] } = useQuery({
    queryKey: ['notebooks'],
    queryFn: () => notebookService.getTree(),
    enabled: !!note,
  })

  const { data: shareLinks = [], refetch: refetchShareLinks } = useQuery({
    queryKey: ['shareLinks', note?.id],
    queryFn: () => (note ? shareService.getByNote(note.id) : Promise.resolve([])),
    enabled: !!note && showShareDialog,
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

  const handleAiExecuteFor = async (action: typeof aiAction, customPrompt: string) => {
    if (!note) return
    const systemPrompts: Record<typeof aiAction, string> = {
      continue: '',
      polish: '请润色以下文本，优化表达，提升文采：',
      translate: '请将以下文本翻译为其他语言：',
      condense: '请简化以下表达，去除冗余：',
      expand: '请丰富以下内容，添加细节：',
      explain: '请解释以下文本含义：',
      custom: customPrompt,
    }
    const systemPrompt = systemPrompts[action]
    setAiAction(action)
    setAiLoading(true)
    setAiResult('')
    try {
      const result = await noteAiService.continue(note.id, { selectedText: aiSelection || undefined, systemPrompt })
      setAiResult(result)
    } catch (err) {
      setAiResult(`[ERROR] ${err instanceof Error ? err.message : 'AI 操作失败'}`)
    } finally {
      setAiLoading(false)
    }
  }

  const handleAiExecute = () => handleAiExecuteFor(aiAction, aiCustomPrompt)

  const getSelectionCoords = useCallback((): { top: number; left: number } | null => {
    const ta = textareaRef.current
    if (!ta) return null
    const { selectionStart, selectionEnd, value } = ta
    const end = selectionEnd > selectionStart ? selectionEnd : selectionStart
    if (end <= 0) return null

    const style = window.getComputedStyle(ta)
    const div = document.createElement('div')
    const props = [
      'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
      'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'textDecoration',
      'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap', 'wordBreak',
    ]
    props.forEach((p) => { div.style[p as string] = style[p as string] })
    div.style.position = 'absolute'
    div.style.visibility = 'hidden'
    div.style.whiteSpace = 'pre-wrap'
    div.style.wordWrap = 'break-word'

    div.textContent = value.substring(0, end)
    const span = document.createElement('span')
    span.textContent = value.substring(end) || '.'
    div.appendChild(span)
    document.body.appendChild(div)

    const lineHeight = parseFloat(style.lineHeight) || 24
    const coords = {
      top: span.offsetTop + parseFloat(style.borderTopWidth) + lineHeight - ta.scrollTop,
      left: Math.max(span.offsetLeft + parseFloat(style.borderLeftWidth) - ta.scrollLeft, 0),
    }
    document.body.removeChild(div)
    return coords
  }, [])

  const handleTextareaSelect = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart, selectionEnd, value } = ta
    if (selectionEnd > selectionStart) {
      setAiSelection(value.slice(selectionStart, selectionEnd))
      setAiSelectionRange({ start: selectionStart, end: selectionEnd })
      const coords = getSelectionCoords()
      if (coords) setInlineCoords(coords)
      setShowInlineAi(true)
    } else {
      setAiSelection('')
      setAiSelectionRange(null)
      if (!aiLoading && !aiResult) {
        setShowInlineAi(false)
        setInlineCoords(null)
      }
    }
  }, [getSelectionCoords, aiLoading, aiResult])

  const openInlineAi = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart, selectionEnd, value } = ta
    if (selectionEnd <= selectionStart) {
      ta.focus()
      return
    }
    setAiSelection(value.slice(selectionStart, selectionEnd))
    setAiSelectionRange({ start: selectionStart, end: selectionEnd })
    const coords = getSelectionCoords()
    if (coords) setInlineCoords(coords)
    setShowInlineAi(true)
    setTimeout(() => inlineInputRef.current?.focus(), 50)
  }, [getSelectionCoords])

  const closeInlineAi = useCallback(() => {
    setShowInlineAi(false)
    setAiResult('')
    setAiCustomPrompt('')
    setAiAction('continue')
  }, [])

  const handleReplaceSelection = () => {
    if (!aiResult || aiResult.startsWith('[ERROR]') || !aiSelectionRange) return
    const newContent = content.slice(0, aiSelectionRange.start) + aiResult + content.slice(aiSelectionRange.end)
    handleContentChange(newContent)
    setAiResult('')
    setAiSelection('')
    setAiSelectionRange(null)
    closeInlineAi()
  }

  const handleInsertAiResult = () => {
    if (!aiResult || aiResult.startsWith('[ERROR]')) return
    handleContentChange(`${content}\n\n${aiResult}`)
    setAiResult('')
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

  const notebookPath = useMemo(() => {
    if (!note?.notebookId || !notebooks.length) return '未分类'
    const findPath = (items: INotebook[], id: string, path: string[] = []): string | null => {
      for (const item of items) {
        if (item.id === id) return [...path, item.name].join(' / ')
        if (item.children?.length) {
          const found = findPath(item.children, id, [...path, item.name])
          if (found) return found
        }
      }
      return null
    }
    return findPath(notebooks, note.notebookId) || '未分类'
  }, [note?.notebookId, notebooks])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() =>  {
    setTitle(noteTitle)
    setContent(noteContent)
    setIsDirty(false)
    setPreviewVersion(null)
    setShowInlineAi(false)
    setInlineCoords(null)
    setAiResult('')
    setAiSelection('')
    setAiSelectionRange(null)
  }, [noteId, noteTitle, noteContent])
  /* eslint-enable react-hooks/set-state-in-effect */

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
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gradient-to-br from-gray-50/80 to-gray-100/50 dark:from-gray-950 dark:to-gray-900/50">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
            <PenLine size={28} className="text-white" />
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">选择或创建一个笔记开始编写</p>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">支持 Markdown 语法 · AI 辅助写作 · 历史版本</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-gray-900">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-100 bg-white/80 px-4 dark:border-gray-800/50 dark:bg-gray-900/80">
        <div className="flex items-center gap-0.5 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.06]">
          {[
            { key: 'preview', label: '预览', icon: Eye },
            { key: 'edit', label: '编辑', icon: Edit3 },
            { key: 'split', label: '分栏', icon: Columns2 },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setViewMode(key as typeof viewMode)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                viewMode === key
                  ? 'bg-white text-gray-700 shadow-sm dark:bg-white/10 dark:text-gray-100'
                  : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden text-[11px] text-gray-400/80 sm:inline">
            {updateNote.isPending ? (
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse-soft" />保存中...</span>
            ) : isDirty ? (
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />有未保存的更改</span>
            ) : (
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />已保存</span>
            )}
          </span>
          <button
            onClick={() => setShowVersions(!showVersions)}
            className={`rounded-lg p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 ${showVersions ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300' : ''}`}
            title="历史版本"
          >
            <History size={15} />
          </button>
          <button
            onClick={() => setShowShareDialog(true)}
            className={`rounded-lg p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 ${showShareDialog ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300' : ''}`}
            title="导出/分享"
          >
            <Share2 size={15} />
          </button>
          <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
          <button
            onClick={openInlineAi}
            disabled={aiLoading}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-indigo-500/20 transition-all hover:shadow-md hover:shadow-indigo-500/30 hover:brightness-110 active:scale-[0.97] disabled:opacity-50 ${
              showInlineAi
                ? 'bg-gradient-to-r from-indigo-600 to-purple-700'
                : 'bg-gradient-to-r from-indigo-500 to-purple-600'
            }`}
            title="选中文字后点击，在选区下方行内调用 AI"
          >
            <Sparkles size={13} />
            AI 助手
          </button>
        </div>
      </div>

      <div className="border-b border-gray-100 bg-white px-8 pb-5 pt-7 dark:border-gray-800/50 dark:bg-gray-900">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="笔记标题"
          className="w-full border-none bg-transparent text-[28px] font-bold leading-tight tracking-tight text-gray-800 outline-none placeholder:text-gray-300 dark:text-gray-100 dark:placeholder:text-gray-600"
        />
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-gray-400 dark:text-gray-500">
          <span className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 dark:bg-white/[0.04]">
            <Calendar size={11} />
            {new Date(note.createdAt).toLocaleDateString('zh-CN')}
          </span>
          <span className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 dark:bg-white/[0.04]">
            <Clock size={11} />
            更新于 {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true, locale: zhCN })}
          </span>
          <span className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 dark:bg-white/[0.04]">
            <Folder size={11} />
            {notebookPath}
          </span>
        </div>
        <div className="mt-3">
          <TagInput noteId={note.id} tags={note.tags} />
        </div>
      </div>

      {showShareDialog && (
        <div className="animate-fade-in border-b border-gray-100 bg-gradient-to-r from-blue-50/50 to-indigo-50/30 p-4 dark:border-gray-800/50 dark:from-blue-900/10 dark:to-indigo-900/5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">分享笔记</h3>
            <button
              onClick={() => setShowShareDialog(false)}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/50 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              { label: '永久链接', hours: undefined as number | undefined, primary: true },
              { label: '24小时有效', hours: 24, primary: false },
              { label: '3天有效', hours: 72, primary: false },
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
                <div key={link.id} className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-gray-600 dark:text-gray-400">{link.shareUrl}</div>
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {link.isActive ? `访问 ${link.viewCount} 次` : '已禁用'}
                      {link.expiresAt && ` · 过期: ${new Date(link.expiresAt).toLocaleString('zh-CN')}`}
                    </div>
                  </div>
                  {link.isActive && (
                    <button
                      onClick={() => handleCopyLink(link.shareUrl)}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      title="复制链接"
                    >
                      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  )}
                  {link.isActive && (
                    <button
                      onClick={() => deactivateShareLink.mutate(link.id)}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      title="禁用链接"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {shareLinks.length === 0 && (
            <div className="py-2 text-center text-xs text-gray-500">暂无分享链接</div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden bg-gradient-to-br from-gray-50/50 to-gray-100/30 dark:from-gray-950 dark:to-gray-900/50">
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div className={`relative ${viewMode === 'split' ? 'flex-1' : 'w-full'} overflow-y-auto bg-white px-8 py-6 dark:bg-gray-900`}>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onSelect={handleTextareaSelect}
              onMouseUp={handleTextareaSelect}
              onKeyUp={handleTextareaSelect}
              placeholder="开始编写..."
              className="w-full resize-none overflow-hidden text-sm leading-[1.85] text-gray-700 outline-none placeholder:text-gray-300 dark:bg-gray-900 dark:text-gray-200 dark:placeholder:text-gray-600"
              style={{ minHeight: 'calc(100vh - 220px)' }}
            />

            {showInlineAi && inlineCoords && (
              <div
                className="animate-fade-in absolute z-20 w-80 max-w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-xl shadow-indigo-500/10 dark:border-indigo-900/50 dark:bg-gray-900"
                style={{ top: inlineCoords.top, left: inlineCoords.left }}
              >
                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={13} className="text-indigo-500" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">行内 AI</span>
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                      {aiSelection.length} 字
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
                  {!aiResult && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {[
                        { key: 'polish', label: '润色' },
                        { key: 'translate', label: '翻译' },
                        { key: 'condense', label: '精简' },
                        { key: 'expand', label: '扩展' },
                        { key: 'explain', label: '解释' },
                      ].map((a) => (
                        <button
                          key={a.key}
                          onClick={() => {
                            setAiAction(a.key as typeof aiAction)
                            setAiCustomPrompt('')
                            handleAiExecuteFor(a.key as typeof aiAction, '')
                          }}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            aiAction === a.key
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                          }`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {!aiResult && (
                    <textarea
                      ref={inlineInputRef}
                      value={aiCustomPrompt}
                      onChange={(e) => setAiCustomPrompt(e.target.value)}
                      onFocus={() => setAiAction('custom')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleAiExecute()
                        }
                        if (e.key === 'Escape') {
                          closeInlineAi()
                        }
                      }}
                      placeholder="描述想要的修改，回车执行…"
                      rows={2}
                      className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-indigo-400 focus:bg-white dark:border-gray-700 dark:bg-gray-900 dark:focus:border-indigo-500 dark:focus:bg-gray-800"
                    />
                  )}

                  {aiResult && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs whitespace-pre-wrap text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                      {aiResult}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/50">
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Bot size={11} />
                    <span>GPT-4o</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {aiResult && !aiResult.startsWith('[ERROR]') && (
                      <>
                        <button
                          onClick={handleReplaceSelection}
                          className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700"
                        >
                          接受替换
                        </button>
                        <button
                          onClick={handleInsertAiResult}
                          className="rounded-md px-2.5 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                        >
                          追加
                        </button>
                        <button
                          onClick={() => { setAiResult(''); setAiCustomPrompt('') }}
                          className="rounded-md px-2.5 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-200 dark:hover:bg-gray-800"
                        >
                          重写
                        </button>
                      </>
                    )}
                    {!aiResult && (
                      <button
                        onClick={handleAiExecute}
                        disabled={aiLoading}
                        className="flex items-center gap-1 rounded-md bg-gradient-to-r from-blue-500 to-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition-all hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50"
                      >
                        <Send size={11} />
                        {aiLoading ? '生成中…' : '执行'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className={`${viewMode === 'split' ? 'flex-1 border-l border-gray-100 dark:border-gray-800/50' : 'w-full bg-white dark:bg-gray-900'} overflow-y-auto px-8 py-6 bg-gray-50/30 dark:bg-gray-950/50`}>
            <div className="markdown-preview prose prose-sm max-w-none dark:prose-invert">
              <ThemedMarkdown source={content} />
            </div>
          </div>
        )}

        {showVersions && (
          <div className="animate-slide-in-right flex w-80 flex-col border-l border-gray-100 bg-white dark:border-gray-800/50 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                  <History size={14} className="text-indigo-500" />
                </div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">历史版本</h3>
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
                <div className="py-10 text-center text-sm text-gray-400">暂无历史版本</div>
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
                  <div className="truncate text-[13px] font-medium text-gray-700 dark:text-gray-200">{version.title || '无标题'}</div>
                  <div className="mt-1 text-[11px] text-gray-400">{new Date(version.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>

            {previewVersion && (
              <div className="border-t border-gray-100 p-4 dark:border-gray-800">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{diffMode ? '版本对比' : '版本预览'}</div>
                  <button
                    onClick={() => setDiffMode((v) => !v)}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {diffMode ? '关闭对比' : '对比当前'}
                  </button>
                </div>
                {diffMode ? (
                  <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                    <div>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">当前版本</div>
                      <ThemedMarkdown source={content.slice(0, 1000)} />
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">历史版本</div>
                      <ThemedMarkdown source={previewVersion.content.slice(0, 1000)} />
                    </div>
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                    <ThemedMarkdown source={previewVersion.content.slice(0, 500)} />
                  </div>
                )}
                <button
                  onClick={() => restoreVersion.mutate({ noteId: note.id, versionId: previewVersion.id })}
                  disabled={restoreVersion.isPending}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-3 py-2.5 text-[13px] font-medium text-white shadow-sm shadow-emerald-500/20 transition-all hover:shadow-md hover:shadow-emerald-500/25 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                >
                  <RotateCcw size={14} />
                  恢复此版本
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
