import { MessagesSquare, Rocket } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import AgentToolbarSelect from './AgentToolbarSelect'
import { AGENT_MODES, agentModeMeta } from '../../utils/agentMode'

export interface AgentModeSelectProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

const MODE_ICONS: Record<string, typeof MessagesSquare> = {
  interactive: MessagesSquare,
  autopilot: Rocket,
}

/**
 * Agent 模式选择器（Code 模式）：交互式（按权限模式逐步确认）/ 自动巡航（Autopilot，写操作自动执行）。
 */
export default function AgentModeSelect({ value, onChange, className }: AgentModeSelectProps) {
  const { t } = useTranslation('agent')
  const meta = agentModeMeta(value)

  return (
    <div className={`flex shrink-0 items-center gap-1 ${className ?? ''}`}>
      <AgentToolbarSelect
        value={value}
        onChange={onChange}
        title={t('mode.title', { label: meta.label, hint: meta.hint })}
        options={AGENT_MODES.map((m) => ({
          value: m.value,
          label: t(m.labelKey),
          description: t(m.descriptionKey),
          icon: (() => {
            const OptIcon = MODE_ICONS[m.value] ?? MessagesSquare
            return <OptIcon size={13} className={agentModeMeta(m.value).cls} />
          })(),
        }))}
      />
    </div>
  )
}
