/** 权限模式五档。对话页与编码会话共用同一套语义（取编码会话原有、更丰富的模型）。 */
export const AGENT_PERMISSION_MODES = [
  { value: 'plan', label: '计划（只调研）' },
  { value: 'readonly', label: '只读' },
  { value: 'ask', label: '写入需确认' },
  { value: 'auto', label: '自动执行' },
  { value: 'bypass', label: '全部放行' },
] as const

export type AgentPermissionMode = (typeof AGENT_PERMISSION_MODES)[number]['value']

export const DEFAULT_PERMISSION_MODE: AgentPermissionMode = 'ask'

/** 是否合法值（非法值回落到默认档） */
export function parsePermissionMode(value: string | null | undefined): AgentPermissionMode {
  const v = value?.trim().toLowerCase()
  return (AGENT_PERMISSION_MODES as readonly { value: string }[]).some((m) => m.value === v)
    ? (v as AgentPermissionMode)
    : DEFAULT_PERMISSION_MODE
}

export interface PermissionModeMeta {
  label: string
  cls: string
}

/** 模式对应的中文名与配色（供工具栏图标、时间线状态点复用） */
export function permissionModeMeta(mode: string): PermissionModeMeta {
  switch (mode) {
    case 'plan':
      return { label: '计划模式', cls: 'text-sky-500' }
    case 'readonly':
      return { label: '只读模式', cls: 'text-gray-400' }
    case 'bypass':
      return { label: '全部放行', cls: 'text-rose-500' }
    case 'auto':
      return { label: '自动执行', cls: 'text-emerald-500' }
    default:
      return { label: '写入需确认', cls: 'text-amber-500' }
  }
}
