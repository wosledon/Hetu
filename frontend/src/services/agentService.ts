import { get } from './api'
import type { IAgentPermissionMode } from '../types/agent'

export const agentService = {
  /** 权限模式清单由后端统一定义（对话页与编码会话共用） */
  getPermissionModes: () => get<IAgentPermissionMode[]>('/agent/permission-modes'),
}