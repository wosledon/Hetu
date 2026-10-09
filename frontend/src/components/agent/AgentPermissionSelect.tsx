import { ClipboardList, Eye, ShieldCheck, ShieldOff, Sparkles } from 'lucide-react'
import AgentToolbarSelect from './AgentToolbarSelect'
import {
  AGENT_PERMISSION_MODES,
  permissionModeMeta,
} from '../../utils/agentPermission'

export interface AgentPermissionSelectProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

/** 每档配一个图标，与触发器前的小图标保持一致 */
const MODE_ICONS: Record<string, typeof ShieldCheck> = {
  plan: ClipboardList,
  readonly: Eye,
  ask: ShieldCheck,
  auto: Sparkles,
  bypass: ShieldOff,
}

/**
 * 权限模式选择器。对话页与编码会话共用五档：
 * plan（只调研）/ readonly（只读）/ ask（写入需确认）/ auto（自动执行）/ bypass（全部放行）。
 */
export default function AgentPermissionSelect({ value, onChange, className }: AgentPermissionSelectProps) {
  const meta = permissionModeMeta(value)
  const Icon = MODE_ICONS[value] ?? ShieldCheck

  return (
    <div className={`flex shrink-0 items-center gap-1 ${className ?? ''}`}>
      <Icon size={13} className={meta.cls} />
      <AgentToolbarSelect
        value={value}
        onChange={onChange}
        title={`权限模式：${meta.label}`}
        options={AGENT_PERMISSION_MODES.map((m) => ({
          value: m.value,
          label: m.label,
          description: m.description,
          icon: (() => {
            const OptIcon = MODE_ICONS[m.value] ?? ShieldCheck
            return <OptIcon size={13} className={permissionModeMeta(m.value).cls} />
          })(),
        }))}
      />
    </div>
  )
}
