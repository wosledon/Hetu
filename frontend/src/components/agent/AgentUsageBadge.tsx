import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('agent')
  if (!usage || usage.totalTokens <= 0) return null

  const segments = [t('usage.tokens', { input: formatTokens(usage.promptTokens), output: formatTokens(usage.completionTokens) })]
  if (usage.cachedTokens > 0) segments.push(t('usage.cached', { value: formatTokens(usage.cachedTokens) }))
  if (usage.latencyMs > 0) segments.push(t('usage.latency', { seconds: (usage.latencyMs / 1000).toFixed(1) }))
  const title = segments.join(' · ')

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
        <span className="text-gray-400 dark:text-gray-500">{t('usage.cachedShort', { value: formatTokens(usage.cachedTokens) })}</span>
      )}
    </span>
  )
}
