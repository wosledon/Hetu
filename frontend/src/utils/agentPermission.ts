import type { WorkPermissionMode } from '../types/work'

/** 后端五档权限（/api/agent/permission-modes）的缺省值；展示清单以接口为准 */
export const DEFAULT_PERMISSION_MODE: WorkPermissionMode = 'ask'

const KNOWN_MODES: readonly WorkPermissionMode[] = ['plan', 'readonly', 'ask', 'auto', 'bypass']

/** 缓存值只做类型收窄，非法值回落到默认档（后端同样会把非法值折算为 ask） */
export function parsePermissionMode(value: string | null | undefined): WorkPermissionMode {
  const v = value?.trim().toLowerCase()
  return KNOWN_MODES.includes(v as WorkPermissionMode) ? (v as WorkPermissionMode) : DEFAULT_PERMISSION_MODE
}