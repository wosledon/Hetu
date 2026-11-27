import { ClipboardList, Eye, ShieldCheck, ShieldOff, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import AgentToolbarSelect from './AgentToolbarSelect'
import { useAgentPermissionModes } from '../../hooks/useAgentPermissionModes'

export interface AgentPermissionSelectProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

/** 图标与配色属于前端展示层；名称与说明由后端 /api/agent/permission-modes 下发 */
const MODE_ICONS: Record<string, typeof ShieldCheck> = {
  plan: ClipboardList,
  readonly: Eye,
  ask: ShieldCheck,
  auto: Sparkles,
  bypass: ShieldOff,
}

const MODE_CLASSES: Record<string, string> = {
  plan: 'text-sky-500',
  readonly: 'text-gray-400',
  ask: 'text-amber-500',
  auto: 'text-emerald-500',
  bypass: 'text-rose-500',
}

const DEFAULT_CLASS = 'text-amber-500'

/**
 * 权限模式选择器。对话页与编码会话共用；选项列表、名称与说明全部来自后端，
 * 前端只保留图标与配色映射。
 */
export default function AgentPermissionSelect({ value, onChange, className }: AgentPermissionSelectProps) {
  const { t } = useTranslation('agent')
  const { data: modes = [] } = useAgentPermissionModes()
  const current = modes.find((m) => m.value === value)
  const CurrentIcon = MODE_ICONS[value] ?? ShieldCheck
  // 首次加载时先用原始值占位，避免工具栏短暂显示“无”
  const options = modes.length > 0
    ? modes.map((m) => {
        const Icon = MODE_ICONS[m.value] ?? ShieldCheck
        return {
          value: m.value,
          label: m.label,
          description: m.description,
          icon: <Icon size={13} className={MODE_CLASSES[m.value] ?? DEFAULT_CLASS} />,
        }
      })
    : [{ value, label: value, icon: <CurrentIcon size={13} className={MODE_CLASSES[value] ?? DEFAULT_CLASS} /> }]

  return (
    <div className={`flex shrink-0 items-center gap-1 ${className ?? ''}`}>
      <AgentToolbarSelect
        value={value}
        onChange={onChange}
        title={t('permission.title', { label: current?.label ?? value })}
        options={options}
      />
    </div>
  )
}