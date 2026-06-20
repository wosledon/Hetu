import { useState, useEffect, useCallback, useMemo } from 'react'
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
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiAction, setAiAction] = useState<'continue' | 'polish' | 'translate' | 'condense' | 'expand' | 'explain' | 'custom'>('continue')
  const [aiCustomPrompt, setAiCustomPrompt] = useState('')
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

  const handleAiExecute = async () => {
    if (!note) return
    const selectedText = window.getSelection()?.toString() || undefined
    const systemPrompts: Record<typeof aiAction, string> = {
      continue: '',
      polish: '请润色以下文本，优化表达，提升文采：',
      translate: '请将以下文本翻译为其他语言：',
      condense: '请简化以下表达，去除冗余：',
      expand: '请丰富以下内容，添加细节：',
      explain: '请解释以下文本含义：',
      custom: aiCustomPrompt,
    }
    const systemPrompt = systemPrompts[aiAction]
    setAiLoading(true)
    setAiResult('')
    try {
      const result = await noteAiService.continue(note.id, { selectedText, systemPrompt })
      setAiResult(result)
    } catch (err) {
      setAiResult(`[ERROR] ${err instanceof Error ? err.message : 'AI 操作失败'}`)
    } finally {
      setAiLoading(false)
    }
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
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20">
            <PenLine size={28} className="text-white" />
          </div>
          <p className="text-sm text-gray-400">选择或创建一个笔记开始编辑</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-gray-900">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {[
            { key: 'preview', label: '预览', icon: Eye },
            { key: 'edit', label: '编辑', icon: Edit3 },
            { key: 'split', label: '分栏', icon: Columns2 },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setViewMode(key as typeof viewMode)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                viewMode === key
                  ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-gray-400 sm:inline">{updateNote.isPending ? '保存中...' : isDirty ? '有未保存的更改' : '自动保存于 ' + new Date(note.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          <button
            onClick={() => setShowVersions(!showVersions)}
            className={`rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 ${showVersions ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300' : ''}`}
            title="历史版本"
          >
            <History size={15} />
          </button>
          <button
            onClick={() => setShowShareDialog(true)}
            className={`rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 ${showShareDialog ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300' : ''}`}
            title="导出/分享"
          >
            <Share2 size={15} />
          </button>
          <button
            onClick={() => setShowAiModal(true)}
            disabled={aiLoading}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50"
          >
            <Sparkles size={13} />
            AI 助手
          </button>
        </div>
      </div>

      <div className="border-b border-gray-100 bg-white px-8 pb-5 pt-6 dark:border-gray-800 dark:bg-gray-900">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="笔记标题"
          className="w-full border-none bg-transparent text-3xl font-bold text-gray-800 outline-none placeholder:text-gray-300 dark:text-gray-100 dark:placeholder:text-gray-600"
        />
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
          <span className="flex items-center gap-1.5">
            <Calendar size={12} />
            {new Date(note.createdAt).toLocaleDateString('zh-CN')}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={12} />
            更新于 {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true, locale: zhCN })}
          </span>
          <span className="flex items-center gap-1.5">
            <Folder size={12} />
            {notebookPath}
          </span>
        </div>
        <div className="mt-3">
          <TagInput noteId={note.id} tags={note.tags} />
        </div>
      </div>

      {showShareDialog && (
        <div className="border-b border-gray-100 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 p-4 dark:border-gray-800 dark:from-blue-900/10 dark:to-indigo-900/10">
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

      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 dark:border-gray-800 dark:from-blue-900/20 dark:to-indigo-900/20">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm dark:bg-gray-800">
                  <Sparkles size={16} className="text-indigo-500" />
                </div>
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">AI 助手</h3>
              </div>
              <button
                onClick={() => {
                  setShowAiModal(false)
                  setAiResult('')
                }}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/50 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-3 dark:border-gray-800 dark:bg-gray-950/50">
              <div className="mb-1.5 text-xs font-medium text-gray-500">选中的文本</div>
              <div className="max-h-20 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2.5 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                {window.getSelection()?.toString() || '未选择文本，将对整篇笔记进行操作'}
              </div>
            </div>

            <div className="px-6 py-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">选择操作</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'continue', label: '续写', icon: PenLine, desc: '根据上下文继续编写', color: 'blue' },
                  { key: 'polish', label: '润色', icon: Sparkles, desc: '优化表达，提升文采', color: 'green' },
                  { key: 'translate', label: '翻译', icon: Languages, desc: '翻译为其他语言', color: 'purple' },
                  { key: 'condense', label: '精简', icon: Minimize2, desc: '简化表达，去除冗余', color: 'orange' },
                  { key: 'expand', label: '扩展', icon: Maximize2, desc: '丰富内容，添加细节', color: 'pink' },
                  { key: 'explain', label: '解释', icon: MessageCircle, desc: '解释文本含义', color: 'indigo' },
                ].map((action) => {
                  const Icon = action.icon
                  const isActive = aiAction === action.key
                  return (
                    <button
                      key={action.key}
                      onClick={() => setAiAction(action.key as typeof aiAction)}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isActive
                          ? `border-${action.color}-500 bg-${action.color}-50 dark:bg-${action.color}-950/30`
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <Icon size={16} className={`text-${action.color}-500`} />
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{action.label}</span>
                      </div>
                      <p className="text-xs text-gray-500">{action.desc}</p>
                    </button>
                  )
                })}
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-500">或输入自定义指令</label>
                <textarea
                  value={aiCustomPrompt}
                  onChange={(e) => setAiCustomPrompt(e.target.value)}
                  onFocus={() => setAiAction('custom')}
                  placeholder="例如：将这段内容改写为更正式的语气..."
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-gray-900 dark:focus:border-blue-500 dark:focus:bg-gray-800"
                />
              </div>
            </div>

            {aiResult && (
              <div className="border-t border-gray-100 px-6 py-4 dark:border-gray-800">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">AI 生成结果</div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {aiResult}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-gray-800 dark:bg-gray-950/50">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Bot size={14} />
                <span>使用模型：GPT-4o</span>
              </div>
              <div className="flex items-center gap-2">
                {aiResult && !aiResult.startsWith('[ERROR]') && (
                  <button
                    onClick={handleInsertAiResult}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                  >
                    插入到笔记
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowAiModal(false)
                    setAiResult('')
                    setAiCustomPrompt('')
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  取消
                </button>
                <button
                  onClick={handleAiExecute}
                  disabled={aiLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50"
                >
                  <Send size={13} />
                  {aiLoading ? '生成中...' : aiResult ? '重新生成' : '执行'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950">
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div className={`${viewMode === 'split' ? 'flex-1' : 'w-full'} overflow-y-auto bg-white px-8 py-6 dark:bg-gray-900`}>
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="开始编写..."
              className="h-full w-full resize-none text-sm leading-7 text-gray-700 outline-none placeholder:text-gray-300 dark:bg-gray-900 dark:text-gray-200 dark:placeholder:text-gray-600"
              style={{ minHeight: '100%' }}
            />
          </div>
        )}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className={`${viewMode === 'split' ? 'flex-1 border-l border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-950' : 'w-full bg-white dark:bg-gray-900'} overflow-y-auto px-8 py-6`}>
            <div className="markdown-preview prose prose-sm max-w-none dark:prose-invert">
              <ThemedMarkdown source={content} />
            </div>
          </div>
        )}

        {showVersions && (
          <div className="flex w-80 flex-col border-l border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 p-4 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <History size={15} className="text-indigo-500" />
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">历史版本</h3>
              </div>
              <button
                onClick={() => {
                  setShowVersions(false)
                  setPreviewVersion(null)
                }}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto p-3">
              {versions.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">暂无历史版本</div>
              )}
              {versions.map((version) => (
                <div
                  key={version.id}
                  onClick={() => setPreviewVersion(version)}
                  className={`cursor-pointer rounded-xl border p-3 text-sm transition-all ${
                    previewVersion?.id === version.id
                      ? 'border-indigo-200 bg-indigo-50 shadow-sm dark:border-indigo-800 dark:bg-indigo-900/20'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <div className="font-medium truncate">{version.title || '无标题'}</div>
                  <div className="mt-1 text-xs text-gray-400">{new Date(version.createdAt).toLocaleString()}</div>
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
                  className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50"
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
