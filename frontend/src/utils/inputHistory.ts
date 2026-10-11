const STORAGE_KEY = 'hetu-input-history'
const MAX_ITEMS = 50

/**
 * 输入历史（↑↓ 回溯）：对话页与 Code 会话共用同一份本地历史，
 * 存在 localStorage 里，跨会话/刷新都能回溯，不随组件卸载丢失。
 */
export function loadInputHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

/** 记一条输入历史（去重后追加到末尾），返回新的完整列表 */
export function pushInputHistory(text: string): string[] {
  const content = text.trim()
  const list = loadInputHistory()
  if (!content) return list
  const next = [...list.filter((item) => item !== content), content].slice(-MAX_ITEMS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存不下（隐私模式/配额）时退化为内存历史，不影响发送
  }
  return next
}
