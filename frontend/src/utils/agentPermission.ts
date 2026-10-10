import i18n from '../i18n'

/** 权限模式五档。对话页与编码会话共用同一套语义（取编码会话原有、更丰富的模型）。 */
export const AGENT_PERMISSION_MODES = [
  { value: 'plan', labelKey: 'permission.modes.plan.label', descriptionKey: 'permission.modes.plan.description' },
  { value: 'readonly', labelKey: 'permission.modes.readonly.label', descriptionKey: 'permission.modes.readonly.description' },
  { value: 'ask', labelKey: 'permission.modes.ask.label', descriptionKey: 'permission.modes.ask.description' },
  { value: 'auto', labelKey: 'permission.modes.auto.label', descriptionKey: 'permission.modes.auto.description' },
  { value: 'bypass', labelKey: 'permission.modes.bypass.label', descriptionKey: 'permission.modes.bypass.description' },
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

/** 模式对应的名称与配色（供工具栏图标、时间线状态点复用） */
export function permissionModeMeta(mode: string): PermissionModeMeta {
  switch (mode) {
    case 'plan':
      return { label: i18n.t('agent:permission.meta.plan'), cls: 'text-sky-500' }
    case 'readonly':
      return { label: i18n.t('agent:permission.meta.readonly'), cls: 'text-gray-400' }
    case 'bypass':
      return { label: i18n.t('agent:permission.meta.bypass'), cls: 'text-rose-500' }
    case 'auto':
      return { label: i18n.t('agent:permission.meta.auto'), cls: 'text-emerald-500' }
    default:
      return { label: i18n.t('agent:permission.meta.ask'), cls: 'text-amber-500' }
  }
}
