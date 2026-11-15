/** 与历史消息去重相关的最小结构（WorkSessionArea / 测试共用） */
export interface TimestampedHistoryMessage {
  role: string
  createdAt: string
}

/**
 * 本轮流式期间过滤已落库的「本轮」消息。
 *
 * 后端现在按迭代即时落库思考 / 工具 / 正文，而消息列表在流式期间每 2 秒轮询，
 * 同一轮会在历史与 streamItems 两处各渲染一次。这里把本轮开始之后落库的非用户消息
 * 从历史里排除，只由实时时间线展示；流结束、streamItems 清空后再完整显示历史。
 *
 * 只排除用户消息之后的内容：用户气泡仍由历史 / 乐观气泡正常展示。
 */
export function excludeLiveTurnMessages<T extends TimestampedHistoryMessage>(
  messages: readonly T[],
  turnStartedAt: number,
): T[] {
  if (!turnStartedAt) return messages as T[]
  let lastUserIndex = -1
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUserIndex = index
  })
  return messages.filter((message, index) =>
    message.role === 'user'
    || index <= lastUserIndex
    || new Date(message.createdAt).getTime() < turnStartedAt)
}
