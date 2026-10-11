/** 输入框的 @ 提及 / / 指令查询词提取：纯函数放在 utils，便于组件文件只导出组件（Fast Refresh） */

/** 在光标前提取正在输入的 @ 查询词；不在提及位置时返回 null */
export function extractMentionQuery(input: string, cursor: number): string | null {
  const uptoCursor = input.slice(0, cursor)
  const at = uptoCursor.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(uptoCursor[at - 1])) return null
  const query = uptoCursor.slice(at + 1)
  return /\s/.test(query) ? null : query
}

/** 在光标前提取正在输入的 / 指令查询词；仅输入框开头生效 */
export function extractSlashQuery(input: string, cursor: number): string | null {
  if (!input.startsWith('/')) return null
  const uptoCursor = input.slice(0, cursor)
  return /\s/.test(uptoCursor) ? null : uptoCursor.slice(1)
}
