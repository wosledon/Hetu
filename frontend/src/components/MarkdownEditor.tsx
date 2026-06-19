import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import MDEditor from '@uiw/react-md-editor'
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
      <div className="flex-1 flex items-center justify-center bg-white text-gray-400 dark:bg-gray-900">
        选择或创建一个笔记开始编辑
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-gray-900">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('preview')}
            className={`rounded p-2 ${viewMode === 'preview' ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white'}`}
            title="预览"
          >
            <Eye size={16} />
          </button>
          <button
            onClick={() => setViewMode('edit')}
            className={`rounded p-2 ${viewMode === 'edit' ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white'}`}
            title="编辑"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`rounded p-2 ${viewMode === 'split' ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white'}`}
            title="分栏"
          >
            <Columns2 size={16} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{updateNote.isPending ? '保存中...' : isDirty ? '有未保存的更改' : '自动保存于 ' + new Date(note.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          <button
            onClick={() => setShowVersions(!showVersions)}
            className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <History size={14} />
            历史版本
          </button>
          <button
            onClick={() => setShowShareDialog(true)}
            className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Share2 size={14} />
            导出/分享
          </button>
          <button
            onClick={() => setShowAiModal(true)}
            disabled={aiLoading}
            className="flex items-center gap-1 rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
          >
            <Sparkles size={14} />
            AI 助手
          </button>
        </div>
      </div>

      <div className="px-8 pb-4 pt-6">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="笔记标题"
          className="w-full border-none bg-transparent text-3xl font-bold text-gray-800 outline-none placeholder-gray-300 dark:text-gray-100 dark:placeholder-gray-600"
        />
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <Calendar size={14} />
            {new Date(note.createdAt).toLocaleDateString('zh-CN')}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={14} />
            更新于 {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true, locale: zhCN })}
          </span>
          <span className="flex items-center gap-1">
            <Folder size={14} />
            {notebookPath}
          </span>
        </div>
        <div className="mt-3">
          <TagInput noteId={note.id} tags={note.tags} />
        </div>
      </div>

      {showShareDialog && (
        <div className="border-b border-gray-200 dark:border-gray-800 p-4 bg-blue-50/50 dark:bg-blue-900/10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">分享笔记</h3>
            <button
              onClick={() => setShowShareDialog(false)}
              className="p-1 text-gray-500 hover:text-gray-700"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => createShareLink.mutate(undefined)}
              disabled={createShareLink.isPending}
              className="px-3 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              创建永久链接
            </button>
            <button
              onClick={() => createShareLink.mutate(24)}
              disabled={createShareLink.isPending}
              className="px-3 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              24小时有效
            </button>
            <button
              onClick={() => createShareLink.mutate(72)}
              disabled={createShareLink.isPending}
              className="px-3 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              3天有效
            </button>
          </div>
          {shareLinks.length > 0 && (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {shareLinks.map((link: IShareLink) => (
                <div key={link.id} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{link.shareUrl}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {link.isActive ? `访问 ${link.viewCount} 次` : '已禁用'}
                      {link.expiresAt && ` · 过期: ${new Date(link.expiresAt).toLocaleString('zh-CN')}`}
                    </div>
                  </div>
                  {link.isActive && (
                    <button
                      onClick={() => handleCopyLink(link.shareUrl)}
                      className="p-1 text-gray-500 hover:text-gray-700"
                      title="复制链接"
                    >
                      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                    </button>
                  )}
                  {link.isActive && (
                    <button
                      onClick={() => deactivateShareLink.mutate(link.id)}
                      className="p-1 text-gray-500 hover:text-red-500"
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
            <div className="text-xs text-gray-500 text-center py-2">暂无分享链接</div>
          )}
        </div>
      )}

      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-blue-500" />
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">AI 助手</h3>
              </div>
              <button
                onClick={() => {
                  setShowAiModal(false)
                  setAiResult('')
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={18} />
              </button>
            </div>

            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="mb-2 text-xs text-gray-500">选中的文本：</div>
              <div className="max-h-24 overflow-y-auto rounded border border-gray-200 bg-white p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                {window.getSelection()?.toString() || '未选择文本，将对整篇笔记进行操作'}
              </div>
            </div>

            <div className="px-6 py-4">
              <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">选择操作：</div>
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
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">或输入自定义指令：</label>
                <textarea
                  value={aiCustomPrompt}
                  onChange={(e) => setAiCustomPrompt(e.target.value)}
                  onFocus={() => setAiAction('custom')}
                  placeholder="例如：将这段内容改写为更正式的语气..."
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
            </div>

            {aiResult && (
              <div className="border-t border-gray-200 px-6 py-4 dark:border-gray-800">
                <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">AI 生成结果</div>
                <div className="max-h-40 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                  {aiResult}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Bot size={14} />
                <span>使用模型：GPT-4o</span>
              </div>
              <div className="flex items-center gap-3">
                {aiResult && !aiResult.startsWith('[ERROR]') && (
                  <button
                    onClick={handleInsertAiResult}
                    className="rounded-lg px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
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
                  className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  取消
                </button>
                <button
                  onClick={handleAiExecute}
                  disabled={aiLoading}
                  className="flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  <Send size={14} />
                  {aiLoading ? '生成中...' : aiResult ? '重新生成' : '执行'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div className={`${viewMode === 'split' ? 'flex-1' : 'w-full'} overflow-y-auto px-8 py-4`}>
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="开始编写..."
              className="h-full w-full resize-none text-sm leading-relaxed text-gray-800 outline-none dark:bg-gray-900 dark:text-gray-100"
              style={{ minHeight: '100%' }}
            />
          </div>
        )}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className={`${viewMode === 'split' ? 'flex-1 border-l border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950' : 'w-full'} overflow-y-auto px-8 py-4`}>
            <div className="markdown-preview text-sm text-gray-800 dark:text-gray-100">
              <MDEditor.Markdown source={content} />
            </div>
          </div>
        )}

        {showVersions && (
          <div className="w-80 border-l border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900">
            <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h3 className="font-medium text-sm">历史版本</h3>
              <button
                onClick={() => {
                  setShowVersions(false)
                  setPreviewVersion(null)
                }}
                className="p-1 text-gray-500 hover:text-gray-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {versions.length === 0 && (
                <div className="text-sm text-gray-400 text-center py-8">暂无历史版本</div>
              )}
              {versions.map((version) => (
                <div
                  key={version.id}
                  onClick={() => setPreviewVersion(version)}
                  className={`p-3 rounded-md border cursor-pointer text-sm ${
                    previewVersion?.id === version.id
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="font-medium truncate">{version.title || '无标题'}</div>
                  <div className="text-xs text-gray-500 mt-1">{new Date(version.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>

            {previewVersion && (
              <div className="border-t border-gray-200 dark:border-gray-800 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{diffMode ? '版本对比' : '版本预览'}</div>
                  <button
                    onClick={() => setDiffMode((v) => !v)}
                    className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {diffMode ? '关闭对比' : '对比当前'}
                  </button>
                </div>
                {diffMode ? (
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900">
                    <div>
                      <div className="text-[10px] uppercase text-gray-400 mb-1">当前版本</div>
                      <MDEditor.Markdown source={content.slice(0, 1000)} />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-gray-400 mb-1">历史版本</div>
                      <MDEditor.Markdown source={previewVersion.content.slice(0, 1000)} />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900">
                    <MDEditor.Markdown source={previewVersion.content.slice(0, 500)} />
                  </div>
                )}
                <button
                  onClick={() => restoreVersion.mutate({ noteId: note.id, versionId: previewVersion.id })}
                  disabled={restoreVersion.isPending}
                  className="w-full flex items-center justify-center gap-1 text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
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
