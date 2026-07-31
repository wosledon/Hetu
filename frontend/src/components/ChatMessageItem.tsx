import { memo } from 'react'
import { Bot, Brain, ChevronDown, Search, Database, Atom, Copy, Check, Pencil, Trash2, X } from 'lucide-react'
import ThemedMarkdown from './ThemedMarkdown'
import type { IChatMessage } from '../types'

// Older messages persisted RAG results with PascalCase keys; normalize to camelCase.
function toCamelKeys<T>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k.charAt(0).toLowerCase() + k.slice(1)] = v
  }
  return out as T
}

interface ChatMessageItemProps {
  message: IChatMessage
  assistantName: string
  isEditing: boolean
  editingContent: string
  isCopied: boolean
  thinkingExpanded: boolean
  actionsDisabled: boolean
  onToggleThinking: (id: string) => void
  onCopy: (id: string, content: string) => void
  onStartEdit: (id: string, content: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
  onEditContentChange: (v: string) => void
}

/** 单条历史消息。memo 化后流式更新不会重渲染整个历史列表。 */
export default memo(function ChatMessageItem({
  message, assistantName, isEditing, editingContent, isCopied, thinkingExpanded,
  actionsDisabled,
  onToggleThinking, onCopy, onStartEdit, onSaveEdit, onCancelEdit, onDelete, onEditContentChange,
}: ChatMessageItemProps) {
  return (
    <div className="flex gap-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${message.role === 'user' ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>
        {message.role === 'user' ? <span className="text-xs font-bold">U</span> : <Bot size={15} />}
      </div>
      <div className="flex min-w-0 w-full flex-col">
        <div className="mb-1.5 flex items-center gap-2">
          {message.role === 'assistant' && (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{assistantName}</span>
          )}
          <span className="text-xs text-gray-400">{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          {message.role === 'user' && (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">你</span>
          )}
        </div>
        <div className={`group relative rounded-2xl px-4 py-3 ${message.role === 'user' ? 'rounded-tr-sm bg-blue-50 text-gray-900 dark:bg-blue-950/40 dark:text-gray-100' : 'rounded-tl-sm bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'}`}>
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editingContent}
                onChange={(e) => onEditContentChange(e.target.value)}
                className="w-full min-h-28 rounded-md border border-gray-200 bg-white p-2 text-sm text-gray-900 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={onCancelEdit}
                  className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <X size={14} />
                </button>
                <button
                  onClick={onSaveEdit}
                  disabled={!editingContent.trim() || actionsDisabled}
                  className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <>
              {message.role === 'assistant' && message.thinkingContent && (
                <div className="mb-3">
                  <button
                    onClick={() => onToggleThinking(message.id)}
                    className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <Brain size={12} />
                    <span>深度思考</span>
                    <ChevronDown size={10} className={`transition-transform ${thinkingExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {thinkingExpanded && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-400 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-500">
                      <ThemedMarkdown source={message.thinkingContent} />
                    </div>
                  )}
                </div>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ThemedMarkdown source={message.content} />
              </div>
              {message.role === 'assistant' && message.searchResultsJson && (() => {
                try {
                  const results = (JSON.parse(message.searchResultsJson) as Array<Record<string, unknown>>).map((r) => toCamelKeys<{ title: string; url: string; snippet: string }>(r))
                  if (results.length === 0) return null
                  return (
                    <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-gray-400">
                        <Search size={11} />
                        参考来源
                      </div>
                      <div className="space-y-1">
                        {results.map((r, i) => (
                          <a
                            key={i}
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-blue-100 text-[9px] font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium text-blue-600 dark:text-blue-400">{r.title}</span>
                              <span className="block truncate text-gray-400">{r.url}</span>
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )
                } catch { return null }
              })()}
              {message.role === 'assistant' && message.knowledgeResultsJson && (() => {
                try {
                  const results = (JSON.parse(message.knowledgeResultsJson) as Array<Record<string, unknown>>).map((r) => toCamelKeys<{ title: string; contentSnippet: string; id: string }>(r))
                  if (results.length === 0) return null
                  return (
                    <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-gray-400">
                        <Database size={11} />
                        知识库参考
                      </div>
                      <div className="space-y-1">
                        {results.map((r, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-amber-100 text-[9px] font-bold text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium text-amber-600 dark:text-amber-400">{r.title}</span>
                              {r.contentSnippet && (
                                <span className="block truncate text-gray-400">{r.contentSnippet.slice(0, 80)}{r.contentSnippet.length > 80 ? '...' : ''}</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                } catch { return null }
              })()}
              {message.role === 'assistant' && message.memoryResultsJson && (() => {
                try {
                  const results = (JSON.parse(message.memoryResultsJson) as Array<Record<string, unknown>>).map((r) => toCamelKeys<{ id: string; content: string; category?: string; score?: number }>(r))
                  if (results.length === 0) return null
                  return (
                    <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-gray-400">
                        <Atom size={11} />
                        记忆参考
                      </div>
                      <div className="space-y-1">
                        {results.map((r, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-violet-100 text-[9px] font-bold text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-gray-600 dark:text-gray-300">{r.content.slice(0, 100)}{r.content.length > 100 ? '...' : ''}</span>
                              {r.category && <span className="text-[10px] text-gray-400">{r.category}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                } catch { return null }
              })()}
            </>
          )}
          {!isEditing && (
            <div className={`absolute -top-3 ${message.role === 'user' ? 'left-0' : 'right-0'} opacity-0 transition-opacity group-hover:opacity-100 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-800`}>
              <button
                onClick={() => onCopy(message.id, message.content)}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title="复制"
              >
                {isCopied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              </button>
              <button
                onClick={() => onStartEdit(message.id, message.content)}
                disabled={actionsDisabled}
                className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-50 dark:hover:text-gray-300"
                title="编辑"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => onDelete(message.id)}
                disabled={actionsDisabled}
                className="p-1 rounded text-gray-400 hover:text-red-500 disabled:opacity-50"
                title="删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
