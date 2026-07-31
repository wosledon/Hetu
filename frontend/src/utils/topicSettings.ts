/// 会话级 UI 配置缓存（模型选择/工具开关等），按 topicId 存于 localStorage。
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

export function loadTopicSettings(topicId?: string): TopicSettings {
  if (!topicId) return {}
  try {
    const raw = localStorage.getItem(KEY_PREFIX + topicId)
    return raw ? (JSON.parse(raw) as TopicSettings) : {}
  } catch {
    return {}
  }
}

export function saveTopicSettings(topicId: string, settings: TopicSettings): void {
  try {
    localStorage.setItem(KEY_PREFIX + topicId, JSON.stringify(settings))
  } catch {
    // 存储不可用时静默失败
  }
}
