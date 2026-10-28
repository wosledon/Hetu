import { useTranslation } from 'react-i18next'

export interface AgentWorkingIndicatorProps {
  /** 提示文字；不传则用 agent 命名空间的默认文案 */
  label?: string
}

/**
 * 对话进行中时挂在会话末尾的动画：三条呼吸的声波柱 + 文案。
 * 对话页与编码会话共用——即使本轮还没有任何输出（思考 / 工具调用中），
 * 用户也能在会话末尾看到「还在跑」的持续反馈。
 */
export default function AgentWorkingIndicator({ label }: AgentWorkingIndicatorProps) {
  const { t } = useTranslation('agent')
  return (
    <div className="flex animate-fade-in items-center gap-2 py-1" role="status">
      <span className="flex h-3.5 items-center gap-[3px]" aria-hidden>
        <span className="agent-wave-bar h-full w-[3px] rounded-full bg-blue-500 dark:bg-blue-400" />
        <span className="agent-wave-bar h-full w-[3px] rounded-full bg-blue-500 [animation-delay:-0.2s] dark:bg-blue-400" />
        <span className="agent-wave-bar h-full w-[3px] rounded-full bg-violet-500 [animation-delay:-0.4s] dark:bg-violet-400" />
      </span>
      <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">{label ?? t('working.label')}</span>
    </div>
  )
}
