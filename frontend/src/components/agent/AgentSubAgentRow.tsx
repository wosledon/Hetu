import { Bot, Loader2 } from 'lucide-react'

const SUBAGENT_STAGE_META: Record<string, { label: string; cls: string }> = {
  running: { label: '进行中', cls: 'text-sky-600 dark:text-sky-400' },
  done: { label: '完成', cls: 'text-emerald-600 dark:text-emerald-400' },
  error: { label: '失败', cls: 'text-rose-600 dark:text-rose-400' },
}

export interface AgentSubAgentRowProps {
  description: string
  stage: string
  tool?: string
  steps?: number
  message?: string
}

/**
 * 子 Agent 进度行。编码会话与任务看板详情共用。
 */
export default function AgentSubAgentRow({ description, stage, tool, steps, message }: AgentSubAgentRowProps) {
  const meta = SUBAGENT_STAGE_META[stage] ?? SUBAGENT_STAGE_META.done

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5 dark:border-gray-800 dark:bg-gray-800/40">
      {stage === 'running'
        ? <Loader2 size={12} className="shrink-0 animate-spin text-sky-500" />
        : <Bot size={12} className="shrink-0 text-gray-400" />}
      <span className="min-w-0 flex-1 truncate text-[11px] text-gray-600 dark:text-gray-300">{description}</span>
      <span className={`shrink-0 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
      {tool && <span className="shrink-0 font-mono text-[10px] text-gray-400">{tool}</span>}
      {steps != null && steps > 0 && <span className="shrink-0 text-[10px] text-gray-400">{steps} 步</span>}
      {message && <span className="min-w-0 max-w-[40%] truncate text-[10px] text-gray-400" title={message}>{message}</span>}
    </div>
  )
}
