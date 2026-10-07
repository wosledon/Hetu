import { useRef, useEffect, useMemo, useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Copy, Check, ArrowUpFromLine } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'

/** 从 React 节点中提取纯文本 */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: React.ReactNode } }).props?.children)
  }
  return ''
}

/** 代码块：右上角悬浮操作（复制 / 插入编辑器），mermaid 块除外 */
function CodeBlockWithActions({ children, onCodeAction }: { children?: React.ReactNode; onCodeAction?: (code: string, action: 'copy' | 'insert') => void }) {
  const [copied, setCopied] = useState(false)
  const codeEl = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string } } | null
  const className = codeEl?.props?.className ?? ''
  const text = extractText(children)

  if (className.includes('mermaid')) {
    return <pre className="mermaid">{text}</pre>
  }

  const copy = () => {
    navigator.clipboard.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
    onCodeAction?.(text, 'copy')
  }

  return (
    <div className="group/code relative">
      <pre className="overflow-x-auto">{children}</pre>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-white/90 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/code:opacity-100 dark:bg-gray-900/90">
        <button
          onClick={copy}
          title="复制代码"
          aria-label="复制代码"
          className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </button>
        {onCodeAction && (
          <button
            onClick={() => onCodeAction(text, 'insert')}
            title="插入到编辑器"
            aria-label="插入到编辑器"
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <ArrowUpFromLine size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

/** mermaid 体积较大（含多种布局引擎），仅在文档内确实存在图表时按需加载 */
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null
async function loadMermaid(isDark: boolean) {
  const mod = await (mermaidModulePromise ??= import('mermaid'))
  mod.default.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
  })
  return mod.default
}

interface ThemedMarkdownProps {
  source: string
  className?: string
  /** 代码块动作（复制 / 插入编辑器） */
  onCodeAction?: (code: string, action: 'copy' | 'insert') => void
}

/**
 * Markdown 渲染组件，支持：
 * - GFM 表格、任务列表、删除线
 * - LaTeX 数学公式 ($...$ / $$...$$)
 * - HTML 嵌入（details、kbd 等，经 DOMPurify 消毒）
 * - Mermaid 图表
 */
export default memo(function ThemedMarkdown({ source, className, onCodeAction }: ThemedMarkdownProps) {
  const theme = useUIStore((state) => state.theme)
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const containerRef = useRef<HTMLDivElement>(null)

  // 初始化 mermaid（仅在文档含图表时加载依赖）
  useEffect(() => {
    if (!source.includes('mermaid')) return
    void loadMermaid(isDark)
  }, [isDark, source])

  // 在渲染后执行 mermaid 图表
  useEffect(() => {
    if (!containerRef.current) return
    const mermaidEls = containerRef.current.querySelectorAll<HTMLElement>('pre.mermaid')
    if (mermaidEls.length === 0) return

    let cancelled = false
    const run = async () => {
      const mermaid = await loadMermaid(isDark)
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
        components={{
          pre: ({ children }) => <CodeBlockWithActions onCodeAction={onCodeAction}>{children}</CodeBlockWithActions>,
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
})
