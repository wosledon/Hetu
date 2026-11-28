import type { ReactNode } from 'react'

/** 在搜索结果片段中高亮命中词（大小写不敏感，正则特殊字符按字面量匹配） */
export function highlightSearchMatches(text: string, keyword: string): ReactNode {
  const query = keyword.trim()
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  if (parts.length === 1) return text
  const lower = query.toLowerCase()
  return parts.map((part, index) => part.toLowerCase() === lower
    ? <mark key={index} className="rounded-[3px] bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-300/25">{part}</mark>
    : part)
}

/** 搜索结果片段去 Markdown 标记：让两行摘要更干净，命中词仍可高亮 */
export function plainSearchSnippet(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}