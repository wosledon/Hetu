import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ListChecks, Loader2, Wrench, X } from 'lucide-react'
import ThemedMarkdown from '../ThemedMarkdown'
import ChatToolCallRow from '../ChatToolCallRow'
import AgentApprovalCard from './AgentApprovalCard'
import AgentThoughtBlock from './AgentThoughtBlock'
import AgentFileChangeRow from './AgentFileChangeRow'
import AgentCheckpointRow from './AgentCheckpointRow'
import AgentSubAgentPanel from './AgentSubAgentPanel'
import { splitAgentSegments, type AgentTimelineItem } from '../../utils/agentTimeline'
import { SurfaceButton } from '../ui'

export interface AgentChatTimelineProps {
  items: AgentTimelineItem[]
  /** 流式进行中：最后一组自动展开并跟随底部 */
  streaming?: boolean
  /** 首次输出前的检索来源（记忆 / 知识库 / 联网），挂进第一个过程组 */
  intro?: ReactNode
  onOpenPath?: (path: string) => void
  onRunCommand?: (command: string) => void
  onInsertCode?: (code: string) => void
  onApprove?: (id: string, approved: boolean) => void
  onRestoreCheckpoint?: (id: string, label: string) => void | Promise<void>
  /** 自定义正文渲染（历史消息用各自页面的 Markdown 样式）；不传则用默认 Markdown */
  renderText?: (text: string) => ReactNode
}

/** 展开的过程组高度上限：超出后组内滚动，不把整页撑长 */
const BODY_MAX_HEIGHT = 300
/** 距离底部小于该值视为贴底，内容增长时继续跟随 */
const STICK_THRESHOLD = 32

/** 两次文本输出之间的过程组：思考 / 工具调用 / 审批等按时间线排列，进行中自动展开 */
function ProcessGroup({
  items,
  active,
  streaming,
  intro,
  onOpenPath,
  onRunCommand,
  onInsertCode,
  onApprove,
  onRestoreCheckpoint,
}: Omit<AgentChatTimelineProps, 'items' | 'renderText'> & { items: AgentTimelineItem[]; active: boolean }) {
  const { t } = useTranslation('chat')
  // null = 跟随默认策略（进行中展开、输出后折叠）；手动开合后以用户选择为准
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? (active && streaming === true)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)

  const running = active && streaming === true
  const failed = items.some((item) => item.kind === 'tool' && item.isError)

  // 内容增长签名：思考 / 参数 / 结果的长度之和，避免每次流式增量都重算滚动
  const growth = useMemo(() => items.reduce((sum, item) => {
    if (item.kind === 'thought') return sum + (item.text?.length ?? 0)
    if (item.kind === 'tool') return sum + (item.args?.length ?? 0) + (item.result?.length ?? 0)
    return sum
  }, 0), [items])

  useEffect(() => {
    const el = bodyRef.current
    if (!el || !open) return
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [open, growth])

  const renderRow = (item: AgentTimelineItem) => {
    switch (item.kind) {
      case 'thought':
        return <AgentThoughtBlock text={item.text} streaming={running} compact />
      case 'tool':
        return (
          <ChatToolCallRow
            name={item.name}
            args={item.args}
            result={item.result}
            isError={item.isError}
            running={item.running ?? item.result === undefined}
            onOpenPath={onOpenPath}
            onRunCommand={onRunCommand}
            compact
          />
        )
      case 'approval':
        return (
          <AgentApprovalCard
            request={item}
            onApprove={() => onApprove?.(item.id, true)}
            onDeny={() => onApprove?.(item.id, false)}
          />
        )
      case 'file':
        return <AgentFileChangeRow path={item.path} action={item.action} onOpenPath={onOpenPath} />
      case 'checkpoint':
        return (
          <AgentCheckpointRow
            label={item.label}
            fileCount={item.fileCount}
            onRestore={onRestoreCheckpoint ? () => onRestoreCheckpoint(item.id, item.label) : undefined}
          />
        )
      case 'subagent':
        return (
          <AgentSubAgentPanel
            description={item.description}
            stage={item.stage}
            tool={item.tool}
            steps={item.steps}
            message={item.message}
            entries={item.entries}
            onOpenPath={onOpenPath}
            onRunCommand={onRunCommand}
            onInsertCode={onInsertCode}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="mb-1 min-w-0">
      <SurfaceButton
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open) stickRef.current = true
          setOverride(!open)
        }}
        className="-mx-1 flex min-h-7 w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.025]"
      >
        {/* 展开箭头按钮 20px，图标与文字保持 24px 行盒 */}
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-white shadow-[0_1px_1px_rgba(15,23,42,0.04)] transition-colors dark:bg-white/[0.03] ${
          open
            ? 'border-gray-300/90 text-gray-500 dark:border-white/15 dark:text-gray-300'
            : 'border-gray-200/80 text-gray-400 dark:border-white/[0.08] dark:text-gray-500'
        }`}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${
          failed
            ? 'text-red-500 dark:text-red-400'
            : running
              ? 'text-blue-500 dark:text-blue-400'
              : 'text-gray-400 dark:text-gray-500'
        }`}>
          {failed
            ? <X size={14} />
            : running
              ? <Loader2 size={14} className="animate-spin" />
              : items.some((item) => item.kind === 'thought') ? <ListChecks size={14} /> : <Wrench size={13} />}
        </span>
        <span className={`shrink-0 text-[12px] font-medium leading-6 ${
          running ? 'text-blue-600 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'
        }`}>
          {t(running ? 'tool.processRunning' : 'tool.processSummary', { count: items.length })}
        </span>
        <span className="flex-1" />
      </SurfaceButton>
      {open && (
        <div
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
          }}
          style={{ maxHeight: BODY_MAX_HEIGHT }}
          className="ml-2 overflow-y-auto overscroll-contain border-l border-gray-200/80 py-1 pl-3 dark:border-white/[0.08]"
        >
          {intro && <div className="mb-0.5">{intro}</div>}
          <div className="space-y-0.5">
            {items.map((item, i) => <div key={item.kind === 'tool' ? (item.id ?? i) : i}>{renderRow(item)}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 对话流展示：两次文本输出之间的思考 / 工具调用等过程折叠为一组，
 * 组内按时间线样式排列；进行中的组自动展开并跟随底部，输出到达后自动折叠。
 */
function AgentChatTimeline({
  items,
  streaming = false,
  intro,
  onOpenPath,
  onRunCommand,
  onInsertCode,
  onApprove,
  onRestoreCheckpoint,
  renderText,
}: AgentChatTimelineProps) {
  const segments = useMemo(() => splitAgentSegments(items), [items])
  // 还没有任何输出片段时不要单独渲染检索来源等子项：等父级过程组/正文出现后再一起挂出
  if (segments.length === 0) return null

  const lastIndex = segments.length - 1

  const renderTextBlock = (text: string, key: number, cursor: boolean) => (
    <div key={key} className={renderText ? 'mb-2' : 'mb-2 text-sm leading-relaxed text-gray-800 dark:text-gray-100'}>
      {renderText
        ? renderText(text)
        : (
          <ThemedMarkdown
            source={text}
            onCodeAction={(code, action) => {
              if (action === 'insert') onInsertCode?.(code)
            }}
          />
        )}
      {cursor && (
        <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-blue-500" aria-hidden />
      )}
    </div>
  )

  const firstProcessIndex = segments.findIndex((segment) => segment.kind === 'process')
  return (
    <div className="min-w-0">
      {firstProcessIndex === -1 && intro && <div className="mb-1">{intro}</div>}
      {segments.map((segment, i) => {
        if (segment.kind === 'text') {
          return renderTextBlock(segment.text, i, streaming && i === lastIndex)
        }
        return (
          <ProcessGroup
            key={i}
            items={segment.items}
            active={streaming && i === lastIndex}
            streaming={streaming}
            intro={i === firstProcessIndex ? intro : undefined}
            onOpenPath={onOpenPath}
            onRunCommand={onRunCommand}
            onInsertCode={onInsertCode}
            onApprove={onApprove}
            onRestoreCheckpoint={onRestoreCheckpoint}
          />
        )
      })}
    </div>
  )
}

export default memo(AgentChatTimeline)