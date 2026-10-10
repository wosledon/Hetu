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

/**
 * 粘贴的长文本在正文里的标记：发送时把块包起来，渲染时再拆出来单独折叠，
 * 这样会话里看到的是「折叠块 + 自己写的那句话」，而不是一条整体被折叠的消息。
 * 标记同时可读，模型也能看出这段是粘贴进来的原文。
 */
export function wrapLongTextBlock(text: string): string {
  return `[粘贴的长文本 ${countTextLines(text)} 行 / ${text.length} 字符]\n${text}\n[/粘贴的长文本]`
}

/** 从消息正文里拆出粘贴的长文本块与其后的文字 */
export function splitLongTextBlock(content: string): { block: string | null; label: string | null; rest: string } {
  const match = content.match(/^\[粘贴的长文本 (\d+) 行 \/ (\d+) 字符\]\n([\s\S]*?)\n\[\/粘贴的长文本\](?:\n{1,2})?/)
  if (!match) return { block: null, label: null, rest: content }
  return { block: match[3], label: `${match[1]} 行 · ${match[2]} 字符`, rest: content.slice(match[0].length) }
}
