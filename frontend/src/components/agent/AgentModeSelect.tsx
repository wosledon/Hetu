import { Bot, Rocket } from 'lucide-react'
import AgentToolbarSelect from './AgentToolbarSelect'
import { AGENT_MODES, agentModeMeta } from '../../utils/agentMode'

export interface AgentModeSelectProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

const MODE_ICONS: Record<string, typeof Bot> = {
  interactive: Bot,
  autopilot: Rocket,
}

/**
 * Agent 模式选择器（Code 模式）：交互式（按权限模式逐步确认）/ 自动巡航（Autopilot，写操作自动执行）。
 */
export default function AgentModeSelect({ value, onChange, className }: AgentModeSelectProps) {
  const meta = agentModeMeta(value)
  const Icon = MODE_ICONS[value] ?? MODE_ICONS.interactive

  return (
    <div className={`flex shrink-0 items-center gap-1 ${className ?? ''}`}>
      <Icon size={13} className={meta.cls} />
      <AgentToolbarSelect
        value={value}
        onChange={onChange}
        title={`Agent 模式：${meta.label}（${meta.hint}）`}
        options={AGENT_MODES.map((m) => ({
          value: m.value,
          label: m.label,
          description: m.description,
          icon: (() => {
            const OptIcon = MODE_ICONS[m.value] ?? Bot
            return <OptIcon size={13} className={agentModeMeta(m.value).cls} />
          })(),
        }))}
      />
    </div>
  )
}
