import { Coins } from 'lucide-react'
import type { AgentUsage } from '../../utils/agentStream'
import { formatTokens } from '../../utils/agentStream'

export interface AgentUsageBadgeProps {
  usage: AgentUsage | null
  /** 紧凑模式：只显示总 token（对话页输入框旁） */
  compact?: boolean
  className?: string
}

/**
 * 统一的 Agent 用量徽标。对话页、编码会话顶栏、任务看板详情共用，
 * 历史上只有编码会话显示用量，这里补齐并收敛为一份实现。
 */
export default function AgentUsageBadge({ usage, compact = false, className = '' }: AgentUsageBadgeProps) {
  if (!usage || usage.totalTokens <= 0) return null

  const title = `输入 ${formatTokens(usage.promptTokens)} / 输出 ${formatTokens(usage.completionTokens)}${
    usage.cachedTokens > 0 ? ` / 缓存命中 ${formatTokens(usage.cachedTokens)}` : ''
  }${usage.latencyMs > 0 ? ` · 本轮耗时 ${(usage.latencyMs / 1000).toFixed(1)}s` : ''}`

  if (compact) {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums text-gray-500 dark:text-gray-400 ${className}`}
        title={title}
      >
        <Coins size={10} />
        {formatTokens(usage.totalTokens)}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums text-gray-500 dark:text-gray-400 ${className}`}
      title={title}
    >
      <Coins size={10} />
      <span>{formatTokens(usage.totalTokens)}</span>
      {usage.cachedTokens > 0 && (
        <span className="text-gray-400 dark:text-gray-500">缓存 {formatTokens(usage.cachedTokens)}</span>
      )}
    </span>
  )
}
