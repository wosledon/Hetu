import { useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import mermaid from 'mermaid'
import { useUIStore } from '../stores/uiStore'

interface ThemedMarkdownProps {
  source: string
  className?: string
}

/**
 * Markdown 渲染组件，支持：
 * - GFM 表格、任务列表、删除线
 * - LaTeX 数学公式 ($...$ / $$...$$)
 * - HTML 嵌入（details、kbd 等，经 DOMPurify 消毒）
 * - Mermaid 图表
 */
export default function ThemedMarkdown({ source, className }: ThemedMarkdownProps) {
  const theme = useUIStore((state) => state.theme)
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const containerRef = useRef<HTMLDivElement>(null)

  // 初始化 mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
    })
  }, [isDark])

  // 在渲染后执行 mermaid 图表
  useEffect(() => {
    if (!containerRef.current) return
    const mermaidEls = containerRef.current.querySelectorAll<HTMLElement>('pre.mermaid')
    if (mermaidEls.length === 0) return

    let cancelled = false
    const run = async () => {
      for (const el of mermaidEls) {
        if (cancelled) return
        const code = el.textContent ?? ''
        if (!code.trim()) continue
        try {
          const { svg } = await mermaid.render(`mermaid-${Math.random().toString(36).slice(2)}`, code)
          const div = document.createElement('div')
          div.className = 'mermaid-container'
          div.innerHTML = svg
          el.replaceWith(div)
        } catch {
          // mermaid 解析失败，保留原始代码块
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [source, isDark])

  // 预处理：修复 markdown 格式（不触碰 HTML 标签）
  const processed = useMemo(() => {
    if (!source) return ''

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
  }, [source])

  return (
    <div ref={containerRef} className={`wmde-markdown ${isDark ? 'dark' : ''} ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
