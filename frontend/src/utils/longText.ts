/** 长文本折叠阈值：超过任一条就折叠（输入框与消息气泡共用同一套判定） */
export const LONG_TEXT_LINES = 12
export const LONG_TEXT_CHARS = 1200

export function countTextLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

export function isLongText(text: string): boolean {
  return countTextLines(text) > LONG_TEXT_LINES || text.length > LONG_TEXT_CHARS
}

/** 折叠态摘要：`61 行 · 2914 字符` */
export function longTextSummary(text: string): string {
  return `${countTextLines(text)} 行 · ${text.length} 字符`
}
