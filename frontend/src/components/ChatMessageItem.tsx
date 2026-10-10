import { memo } from 'react'
import { Search, Database, Atom, Copy, Check, Coins, Pencil, Trash2, X, User } from 'lucide-react'
import ThemedMarkdown from './ThemedMarkdown'
import CollapsedLongText from './CollapsedLongText'
import ChatToolCallRow from './ChatToolCallRow'
import ToolCallGroup from './ToolCallGroup'
import { foldConsecutiveToolCalls } from '../utils/toolRendering'
import { formatTokens } from '../utils/agentStream'
import type { IChatMessage } from '../types'

interface ITimelineSegment {
  kind?: string
  content?: string
  name?: string
  arguments?: string
  result?: string
  isError?: boolean
  /** 旧数据可能是 PascalCase */
  Kind?: string
}

type HistorySegment =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; name: string; arguments: string; result?: string; isError?: boolean }

/**
 * 解析持久化的 ToolCallsJson：
 * - 新格式：有序片段数组（{ kind: 'thought' | 'text' | 'tool', ... }），按发生顺序穿插
 * - 旧格式：纯工具数组，退化为“工具组 → 正文”
 */
function parseHistorySegments(json?: string): HistorySegment[] {
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const hasKind = parsed.some((x) => x && typeof x === 'object' && 'kind' in (x as object))
  if (!hasKind) {
    // 旧格式：工具列表
    return (parsed as Array<Record<string, unknown>>).map((raw) => ({
      kind: 'tool' as const,
      name: String(raw.name ?? raw.Name ?? ''),
      arguments: String(raw.arguments ?? raw.Arguments ?? '{}'),
      result: (raw.result ?? raw.Result) as string | undefined,
      isError: Boolean(raw.isError ?? raw.IsError ?? false),
    }))
  }

  return (parsed as ITimelineSegment[]).map((raw) => {
    const kind = raw.kind ?? raw.Kind ?? 'text'
    if (kind === 'tool') {
      return {
        kind: 'tool' as const,
        name: String(raw.name ?? ''),
        arguments: String(raw.arguments ?? '{}'),
        result: raw.result,
        isError: Boolean(raw.isError),
      }
    }
    return { kind: (kind === 'thought' ? 'thought' : 'text') as 'thought' | 'text', text: String(raw.content ?? '') }
  })
}

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
  isEditing: boolean
  editingContent: string
  isCopied: boolean
  actionsDisabled: boolean
  onCopy: (id: string, content: string) => void
  onStartEdit: (id: string, content: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
  onEditContentChange: (v: string) => void
}

/** 单条历史消息。memo 化后流式更新不会重渲染整个历史列表。 */
export default memo(function ChatMessageItem({
  message, isEditing, editingContent, isCopied,
  actionsDisabled,
  onCopy, onStartEdit, onSaveEdit, onCancelEdit, onDelete, onEditContentChange,
}: ChatMessageItemProps) {
  const segments = parseHistorySegments(message.toolCallsJson)
  const isUser = message.role === 'user'
  // 有序片段里已包含正文文本；旧格式的纯工具列表则回到“工具组 + 正文”布局
  const interleaved = segments.some((s) => s.kind === 'text')
  const isLegacy = segments.length > 0 && !interleaved
  // 两段输出之间的所有过程（工具调用、思考）折叠为一组，文本输出作为组分界
  const foldedSegments = foldConsecutiveToolCalls(
    segments,
    (s) => s.kind === 'tool' || s.kind === 'thought',
    (s) => s.kind === 'tool'
      ? { kind: 'tool', name: s.name, args: s.arguments, result: s.result, isError: s.isError }
      : { kind: 'thought', name: '', args: s.text, text: s.text },
  )
  const foldedLegacySegments = foldConsecutiveToolCalls(
    segments.filter((s) => s.kind === 'tool'),
    () => true,
    (s) => s.kind === 'tool'
      ? { kind: 'tool', name: s.name, args: s.arguments, result: s.result, isError: s.isError }
      : { kind: 'tool', name: '', args: '{}' },
  )
  return (
    <div className={`group relative flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm">
          <User size={13} />
        </div>
      )}
      <div className={`flex min-w-0 flex-1 flex-col ${isUser ? 'items-end' : ''}`}>
        {isUser && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">你</span>
          </div>
        )}
        {/* Copilot 式瀑布流：无聊天气泡。用户消息右浮动（头像在右）；AI 回复按 思考 → 工具调用 → 引用 → 正文 纵向堆叠 */}
        {/* overflow-wrap:anywhere 让 base64/URL/CSV 这类无空格长串能断行（同时影响 min-content，w-fit 气泡才会收缩），否则会横向撑破气泡 */}
        <div className={`text-gray-800 [overflow-wrap:anywhere] dark:text-gray-100 ${isUser ? 'w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-50/70 px-4 py-2.5 dark:bg-blue-950/30' : 'w-full'}`}>
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
              {message.role === 'assistant' && message.thinkingContent && !segments.some((s) => s.kind === 'thought') && (
                <div className="mb-3">
                  <ChatToolCallRow name="" args={message.thinkingContent} text={message.thinkingContent} label="思考" />
                </div>
              )}
              {/* 瀑布流时间线：思考/工具调用与文本按发生顺序穿插（新格式） */}
              {!isUser && interleaved && (
                <div className="space-y-2">
                  {foldedSegments.map((entry, i) => {
                    if (entry.kind === 'tool') {
                      const only = entry.items[0]
                      // 单条过程：工具调用或思考，都直接用统一的行样式
                      if (entry.items.length === 1) {
                        return only.kind === 'thought'
                          ? <ChatToolCallRow key={i} name="" args={only.text ?? ''} text={only.text ?? ''} label="思考" />
                          : (
                            <ChatToolCallRow
                              key={i}
                              name={only.name}
                              args={only.args}
                              result={only.result}
                              isError={only.isError}
                            />
                          )
                      }
                      return <ToolCallGroup key={i} items={entry.items} />
                    }
                    const seg = entry.item
                    if (seg.kind === 'thought') {
                      return (
                        <ChatToolCallRow key={i} name="" args={seg.text} text={seg.text} label="思考" />
                      )
                    }
                    return (
                      <div key={i} className="prose prose-sm dark:prose-invert max-w-none">
                        <ThemedMarkdown source={seg.kind === 'text' ? seg.text : ''} />
                      </div>
                    )
                  })}
                </div>
              )}
              {/* 旧格式：工具组集中展示，正文在后 */}
              {!isUser && isLegacy && (
                <div className="mb-3 space-y-1">
                  {foldedLegacySegments.map((entry, i) =>
                    entry.kind === 'tool'
                      ? entry.items.length > 1
                        ? <ToolCallGroup key={i} items={entry.items} />
                        : (
                          <ChatToolCallRow
                            key={i}
                            name={entry.items[0].name}
                            args={entry.items[0].args}
                            result={entry.items[0].result}
                            isError={entry.items[0].isError}
                          />
                        )
                      : null
                  )}
                </div>
              )}
              {!interleaved && (
                isUser ? (
                  <CollapsedLongText text={message.content}>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ThemedMarkdown source={message.content} />
                    </div>
                  </CollapsedLongText>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ThemedMarkdown source={message.content} />
                  </div>
                )
              )}
              {message.role === 'assistant' && message.searchResultsJson && (() => {
                try {
                  const results = (JSON.parse(message.searchResultsJson) as Array<Record<string, unknown>>).map((r) => toCamelKeys<{ title: string; url: string; snippet: string }>(r))
                  if (results.length === 0) return null
                  return (
                    <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                      <div className="flex items-center gap-1 border-b border-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-400 dark:border-gray-800">
                        <Search size={11} />
                        参考来源
                      </div>
                      <div className="space-y-0.5 p-1.5">
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
                    <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                      <div className="flex items-center gap-1 border-b border-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-400 dark:border-gray-800">
                        <Database size={11} />
                        知识库参考
                      </div>
                      <div className="space-y-0.5 p-1.5">
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
                    <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                      <div className="flex items-center gap-1 border-b border-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-400 dark:border-gray-800">
                        <Atom size={11} />
                        记忆参考
                      </div>
                      <div className="space-y-0.5 p-1.5">
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
              {message.role === 'assistant' && (message.tokensUsed ?? 0) > 0 && (
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400">
                  <Coins size={10} />
                  <span>
                    {formatTokens(message.tokensUsed ?? 0)} tokens
                    {message.cachedTokens ? `（缓存 ${formatTokens(message.cachedTokens)}）` : ''}
                    {message.latencyMs ? ` · ${(message.latencyMs / 1000).toFixed(1)}s` : ''}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        {/* 操作栏：气泡下方的副标题行，图标弱化显示、悬停整行提亮 */}
        {!isEditing && (
          <div className="mt-1.5 flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => onCopy(message.id, message.content)}
              className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              title="复制"
              aria-label="复制"
            >
              {isCopied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
            <button
              onClick={() => onStartEdit(message.id, message.content)}
              disabled={actionsDisabled}
              className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              title="编辑"
              aria-label="编辑"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => onDelete(message.id)}
              disabled={actionsDisabled}
              className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-gray-800"
              title="删除"
              aria-label="删除"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
