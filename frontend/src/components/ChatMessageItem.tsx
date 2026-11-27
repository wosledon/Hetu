import { memo } from 'react'
import { Copy, Check, Coins, Pencil, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ThemedMarkdown from './ThemedMarkdown'
import UserMessageContent from './UserMessageContent'
import AgentChatTimeline from './agent/AgentChatTimeline'
import RetrievalResultCard from './RetrievalResultCard'
import { fromChatHistorySegments } from '../utils/historyTimeline'
import type { AgentTimelineItem } from '../utils/agentTimeline'
import { formatDateTime } from '../utils/locale'
import { formatTokens } from '../utils/agentStream'
import type { IChatMessage } from '../types'
import { Button, Card, IconButton, Textarea } from './ui'

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
  const { t } = useTranslation('chat')
  const segments = parseHistorySegments(message.toolCallsJson)
  const isUser = message.role === 'user'
  // 有序片段里已包含正文文本；旧格式的纯工具列表则回到“工具组 + 正文”布局
  const interleaved = segments.some((s) => s.kind === 'text')
  // 时间线文本是正文的前缀（历史消息最后一轮纯文本没收进时间线）：把没被覆盖的
  // 尾部补渲染，否则落库展示比流式预览少一截收尾（正文始终以 message.content 为准）
  const timelineText = segments.filter((s) => s.kind === 'text').map((s) => s.text ?? '').join('')
  const tailText = interleaved && message.content.startsWith(timelineText)
    ? message.content.slice(timelineText.length)
    : ''
  const isLegacy = segments.length > 0 && !interleaved
  // 历史消息与流式共用同一套时间线：折叠、行样式与间距只在 AgentTimeline 里维护一份
  const historyItems: AgentTimelineItem[] = []
  if (message.role === 'assistant') {
    if (message.thinkingContent && !segments.some((s) => s.kind === 'thought')) {
      historyItems.push({ kind: 'thought', text: message.thinkingContent })
    }
    if (interleaved) {
      historyItems.push(...fromChatHistorySegments(segments))
      // 时间线未覆盖的正文尾部（见上方 tailText 注释）
      if (tailText.trim().length > 0) historyItems.push({ kind: 'text', text: tailText })
    } else if (isLegacy) {
      historyItems.push(...fromChatHistorySegments(segments))
    }
  }
  // 检索来源发生在首次模型请求之前，归入第一轮的过程组展示（与流式一致）
  const webResults = (() => {
    if (message.role !== 'assistant' || !message.searchResultsJson) return []
    try {
      return (JSON.parse(message.searchResultsJson) as Array<Record<string, unknown>>).map((r) => toCamelKeys<{ title: string; url: string; snippet: string }>(r))
    } catch { return [] }
  })()
  const knowledgeResults = (() => {
    if (message.role !== 'assistant' || !message.knowledgeResultsJson) return []
    try {
      return (JSON.parse(message.knowledgeResultsJson) as Array<Record<string, unknown>>).map((r) => toCamelKeys<{ title: string; contentSnippet: string; id: string }>(r))
    } catch { return [] }
  })()
  const memoryResults = (() => {
    if (message.role !== 'assistant' || !message.memoryResultsJson) return []
    try {
      return (JSON.parse(message.memoryResultsJson) as Array<Record<string, unknown>>).map((r) => toCamelKeys<{ id: string; content: string; category?: string; score?: number }>(r))
    } catch { return [] }
  })()
  const retrievalCards = webResults.length > 0 || knowledgeResults.length > 0 || memoryResults.length > 0
    ? (
      <>
        <RetrievalResultCard kind="web" results={webResults} />
        <RetrievalResultCard kind="knowledge" results={knowledgeResults.map(r => ({ title: r.title, snippet: r.contentSnippet }))} />
        <RetrievalResultCard kind="memory" results={memoryResults} />
      </>
    )
    : undefined
  return (
    <div className={`group relative flex ${isUser ? 'justify-end' : ''}`}>
      <div className={`flex min-w-0 flex-1 flex-col ${isUser ? 'items-end' : ''}`}>
        {/* Copilot 式瀑布流：用户消息右浮动；AI 回复按 思考 → 工具调用 → 引用 → 正文 纵向堆叠 */}
        {/* overflow-wrap:anywhere 让 base64/URL/CSV 这类无空格长串能断行（同时影响 min-content，w-fit 气泡才会收缩），否则会横向撑破气泡 */}
        {/* 用户气泡用淡蓝表面；AI 回复不加气泡，过程卡片与正文直接排列 */}
        <Card plain={isUser} padded={false} className={`text-gray-800 [overflow-wrap:anywhere] dark:text-gray-100 ${isUser ? 'glass-bubble w-fit max-w-[85%] rounded-2xl rounded-tr-md border-blue-200/70 bg-blue-50/95 px-4 py-3 text-[14px] leading-6 shadow-sm dark:border-blue-400/15 dark:bg-blue-500/15' : 'w-full bg-transparent before:hidden'}`}>
          {isEditing ? (
            <div className="space-y-2">
              <Textarea tone="blue" glass
                value={editingContent}
                onChange={(e) => onEditContentChange(e.target.value)}
                className="w-full min-h-28 p-2 text-gray-900 dark:text-gray-100"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" tone="gray" size="sm" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onCancelEdit}>
                  <X size={14} />
                </Button>
                <button
                  onClick={onSaveEdit}
                  disabled={!editingContent.trim() || actionsDisabled}
                  className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  {t('common:save')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {!isUser && historyItems.length > 0 && (
                <div className="mb-3">
                  <AgentChatTimeline
                    items={historyItems}
                    intro={retrievalCards}
                    renderText={(source) => (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ThemedMarkdown source={source} />
                      </div>
                    )}
                  />
                </div>
              )}
              {!interleaved && (
                isUser ? (
                  <UserMessageContent content={message.content} />
                ) : (
                  <>
                    {historyItems.length === 0 && retrievalCards}
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ThemedMarkdown source={message.content} />
                    </div>
                  </>
                )
              )}
              {message.role === 'assistant' && (message.tokensUsed ?? 0) > 0 && (
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400">
                  <Coins size={10} />
                  <span>
                    {formatTokens(message.tokensUsed ?? 0)} tokens
                    {message.cachedTokens ? t('messageItem.cached', { tokens: formatTokens(message.cachedTokens) }) : ''}
                    {message.latencyMs ? ` · ${(message.latencyMs / 1000).toFixed(1)}s` : ''}
                  </span>
                </div>
              )}
            </>
          )}
        </Card>
        {/* 操作栏：气泡下方的副标题行，图标弱化显示、悬停整行提亮 */}
        {!isEditing && (
          <div className="mt-1.5 flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
            {isUser && (
              <span className="mr-1 pl-1 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                {formatDateTime(message.createdAt, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <IconButton variant="ghost" tone="gray" className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300" label={t('common:copy')} onClick={() => onCopy(message.id, message.content)}
              
              title={t('common:copy')}
              aria-label={t('common:copy')}>
              {isCopied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </IconButton>
            <IconButton variant="ghost" tone="gray" className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300" label={t('common:edit')} onClick={() => onStartEdit(message.id, message.content)}
              disabled={actionsDisabled}
              
              title={t('common:edit')}
              aria-label={t('common:edit')}>
              <Pencil size={12} />
            </IconButton>
            <IconButton variant="ghost" tone="gray" className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-gray-800" label={t('common:delete')} onClick={() => onDelete(message.id)}
              disabled={actionsDisabled}
              
              title={t('common:delete')}
              aria-label={t('common:delete')}>
              <Trash2 size={12} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  )
})
