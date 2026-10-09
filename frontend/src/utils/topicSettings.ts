/// 会话级 UI 配置缓存（模型选择/工具开关等），按 topicId 独立存储于 localStorage。
/// 每个会话的配置完全隔离，互不影响。
export interface TopicSettings {
  modelId?: string
  deepThinking?: boolean
  reasoningEffort?: string
  webSearch?: boolean
  knowledgeBase?: boolean
  memory?: boolean
  toolCalling?: boolean
  /** 权限模式五档：plan / readonly / ask / auto / bypass（与编码会话共用） */
  permissionMode?: string
  /** Agent 模式：interactive（交互式）/ autopilot（自动执行），仅 Code 会话使用 */
  agentMode?: string
  /** 会话级上下文上限（token），空 = 模型支持的上限 */
  contextWindow?: number
}

const KEY_PREFIX = 'hetu:topic-settings:'

/// 读取指定会话的配置。
export function loadTopicSettings(topicId?: string): TopicSettings {
  if (!topicId) return {}
  try {
    const raw = localStorage.getItem(KEY_PREFIX + topicId)
    return raw ? (JSON.parse(raw) as TopicSettings) : {}
  } catch {
    return {}
  }
}

/// 保存指定会话的配置（仅写入该会话的 key，不影响其他会话）。
export function saveTopicSettings(topicId: string, settings: TopicSettings): void {
  try {
    localStorage.setItem(KEY_PREFIX + topicId, JSON.stringify(settings))
  } catch {
    // 存储不可用时静默失败
  }
}

