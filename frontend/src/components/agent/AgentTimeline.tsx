import type { ReactNode } from 'react'
import ThemedMarkdown from '../ThemedMarkdown'
import ChatToolCallRow from '../ChatToolCallRow'
import ToolCallGroup from '../ToolCallGroup'
import AgentApprovalCard from './AgentApprovalCard'
import AgentThoughtBlock from './AgentThoughtBlock'
import AgentFileChangeRow from './AgentFileChangeRow'
import AgentCheckpointRow from './AgentCheckpointRow'
import AgentSubAgentPanel from './AgentSubAgentPanel'
import { foldAgentTimeline, type AgentTimelineItem } from '../../utils/agentTimeline'

export interface AgentTimelineProps {
  items: AgentTimelineItem[]
  /** 流式进行中：正文带光标、思考块显示加载 */
  streaming?: boolean
  /** 编码会话独有：点击路径在编辑器打开 */
  onOpenPath?: (path: string) => void
  /** 编码会话独有：把命令送到终端执行 */
  onRunCommand?: (command: string) => void
  /** 把代码块插入编辑器 */
  onInsertCode?: (code: string) => void
  /** 工具审批决策 */
  onApprove?: (id: string, approved: boolean) => void
  /** 编码会话独有：回滚到检查点 */
  onRestoreCheckpoint?: (id: string, label: string) => void | Promise<void>
  /** 时间线为空时的占位（如「思考中...」） */
  emptyHint?: ReactNode
  /** 自定义正文渲染（历史消息用各自页面的 Markdown 样式）；不传则用默认 Markdown */
  renderText?: (text: string) => ReactNode
}

/**
 * Agent 执行过程的统一时间线渲染器。
 *
 * 对话页、编码会话、任务看板详情三端共用：把 思考 → 工具调用 → 正文
 * 按发生顺序穿插展示；仅以思考开启的过程折叠成组，纯工具调用逐行显示。三端的能力差异通过可选
 * 回调表达——编码会话传 onOpenPath / onRunCommand / onRestoreCheckpoint，
 * 对话页与任务看板只读展示。
 */
export default function AgentTimeline({
  items,
  streaming = false,
  onOpenPath,
  onRunCommand,
  onInsertCode,
  onApprove,
  onRestoreCheckpoint,
  emptyHint,
  renderText,
}: AgentTimelineProps) {
  if (items.length === 0) return <>{emptyHint ?? null}</>

  const folded = foldAgentTimeline(items)

  return (
    // 自成容器：AgentTimeline 若返回 Fragment，行会成为调用方 space-y-* 的直接子项，
    // 导致同一时间线在不同页面出现不同间距
    <div className="min-w-0">
      {folded.map((entry, i) => {
        if (entry.kind === 'tool') {
          if (entry.items.length === 1) {
            const only = entry.items[0]
            return (
              <div key={`t${i}`} className={only.kind === 'thought' ? 'mb-0' : 'mb-1'}>
                {only.kind === 'thought'
                  ? <AgentThoughtBlock text={only.text ?? ''} streaming={streaming && i === folded.length - 1} />
                  : (
                      <ChatToolCallRow
                        name={only.name}
                        args={only.args}
                        result={only.result}
                        isError={only.isError}
                        running={only.running}
                        onOpenPath={onOpenPath}
                        onRunCommand={onRunCommand}
                        compact
                      />
                    )}
              </div>
            )
          }
          return (
            <div key={`t${i}`} className={entry.items[0]?.kind === 'thought' ? 'mb-0' : 'mb-1'}>
              <ToolCallGroup
                items={entry.items}
                renderItem={(item, compact) => (item.kind === 'thought'
                  ? <AgentThoughtBlock text={item.text ?? ''} compact={compact} />
                  : (
                      <ChatToolCallRow
                        name={item.name}
                        args={item.args}
                        result={item.result}
                        isError={item.isError}
                        running={item.running}
                        onOpenPath={onOpenPath}
                        onRunCommand={onRunCommand}
                        compact={compact}
                      />
                    ))}
              />
            </div>
          )
        }

        const item = entry.item
        switch (item.kind) {
          case 'text':
            return (
              <div key={`o${i}`} className={renderText ? 'mb-2' : 'mb-2 text-sm leading-relaxed text-gray-800 dark:text-gray-100'}>
                {renderText
                  ? renderText(item.text)
                  : (
                    <ThemedMarkdown
                      source={item.text}
                      onCodeAction={(code, action) => {
                        if (action === 'insert') onInsertCode?.(code)
                      }}
                    />
                  )}
                {streaming && i === folded.length - 1 && (
                  <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-blue-500" aria-hidden />
                )}
              </div>
            )
          case 'thought':
            return (
              <div key={`o${i}`} className="mb-0">
                <AgentThoughtBlock text={item.text} streaming={streaming && i === folded.length - 1} />
              </div>
            )
          case 'approval':
            return (
              <div key={`o${i}`} className="mb-2">
                <AgentApprovalCard
                  request={item}
                  onApprove={() => onApprove?.(item.id, true)}
                  onDeny={() => onApprove?.(item.id, false)}
                />
              </div>
            )
          case 'file':
            return (
              <div key={`o${i}`} className="mb-1">
                <AgentFileChangeRow path={item.path} action={item.action} onOpenPath={onOpenPath} />
              </div>
            )
          case 'checkpoint':
            return (
              <div key={`o${i}`} className="mb-1">
                <AgentCheckpointRow
                  label={item.label}
                  fileCount={item.fileCount}
                  onRestore={onRestoreCheckpoint ? () => onRestoreCheckpoint(item.id, item.label) : undefined}
                />
              </div>
            )
          case 'subagent':
            return (
              <div key={`o${i}`} className="mb-2">
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
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
