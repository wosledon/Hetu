export interface PendingQueueMessage {
  id: string
  content: string
}

const key = (scope: 'chat' | 'work', sessionId: string) => `hetu:pending-queue:${scope}:${sessionId}`

export function loadPendingQueue(scope: 'chat' | 'work', sessionId: string): PendingQueueMessage[] {
  if (!sessionId) return []
  try {
    const raw = localStorage.getItem(key(scope, sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PendingQueueMessage =>
      !!item && typeof item === 'object'
      && typeof (item as PendingQueueMessage).id === 'string'
      && typeof (item as PendingQueueMessage).content === 'string')
  } catch {
    return []
  }
}

export function savePendingQueue(scope: 'chat' | 'work', sessionId: string, items: PendingQueueMessage[]): void {
  if (!sessionId) return
  try {
    localStorage.setItem(key(scope, sessionId), JSON.stringify(items))
  } catch {
    // 存储已满或禁用时保留内存队列，不影响当前会话
  }
}
