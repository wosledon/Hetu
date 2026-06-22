import { useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import DOMPurify from 'dompurify'
import mermaid from 'mermaid'
import { useUIStore } from '../stores/uiStore'

interface ThemedMarkdownProps {
  source: string
  className?: string
}

/**
 * 预处理 markdown 文本，修复 LLM 输出中常见的格式问题：
 * - 将非标准列表符号（▪、•、·）转换为标准 markdown 列表标记
 * - 修复列表项之间缺少空行的问题
 */
function preprocessMarkdown(source: string): string {
  if (!source) return source
  let text = source

  // 将行首的 ▪、•、· 等非标准列表符号转换为标准 - 标记
  text = text.replace(/^[ \t]*[▪•·]\s+/gm, '- ')

  // 将行首的数字+点/顿号列表（如 1、）转换为标准格式
  text = text.replace(/^(\d+)[、.]\s/gm, '$1. ')

  // 在连续列表项之间确保有空行（提升段落间距）
  text = text.replace(/\n- /g, '\n\n- ')

  // 修复标题后紧跟内容缺少空行的问题
  text = text.replace(/^(#{1,6}\s+.+)\n([^\n#])/gm, '$1\n\n$2')

  return text
}

/**
 * Markdown 渲染组件，使用 react-markdown + remark-gfm。
 * 支持 GFM 表格、任务列表、删除线等扩展语法。
 */
export default function ThemedMarkdown({ source, className }: ThemedMarkdownProps) {
  const theme = useUIStore((state) => state.theme)
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const processed = preprocessMarkdown(source)

  return (
    <div className={`wmde-markdown ${isDark ? 'dark' : ''} ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}
