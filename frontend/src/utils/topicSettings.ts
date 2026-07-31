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
  toolApprovalMode?: 'auto' | 'ask' | 'bypass'
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

