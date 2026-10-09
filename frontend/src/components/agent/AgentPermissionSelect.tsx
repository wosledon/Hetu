import { ShieldCheck, ShieldOff, ListChecks } from 'lucide-react'
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

const MODE_ICONS: Record<string, typeof ShieldCheck> = {
  plan: ListChecks,
  readonly: ShieldOff,
  ask: ShieldCheck,
  auto: ShieldCheck,
  bypass: ShieldCheck,
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
        options={AGENT_PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label }))}
      />
    </div>
  )
}
