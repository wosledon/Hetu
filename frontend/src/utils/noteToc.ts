/** 笔记目录条目：从正文解析出的标题（级别 + 纯文本） */
export interface NoteTocItem {
  /** 标题级别 1-6 */
  level: number
  /** 标题纯文本（去掉 Markdown 记号） */
  text: string
}

/**
 * 解析笔记正文的标题（ATX 写法 `#` ~ `######`），代码围栏内的 `#` 不算标题。
 *
 * 目录点击后按序号滚动到第 n 个标题元素：编辑器（Milkdown）与预览
 * （react-markdown）都把标题渲染成 h1-h6，与这里的结果按序一一对应。
 * 因此这里只做「跳过围栏 + 去记号」，不做嵌套重组，保证序号稳定。
 */
export function parseNoteHeadings(markdown: string): NoteTocItem[] {
  const items: NoteTocItem[] = []
  let inFence = false

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (!match) continue
    // 闭合式 ATX 的结尾 # 与行内记号去掉，避免目录里出现裸符号
    const text = match[2]
      .replace(/\s+#+\s*$/, '')
      .replace(/[`*~]/g, '')
      .trim()
    if (text) items.push({ level: match[1].length, text })
  }

  return items
}
