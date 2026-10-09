import { useRef, useEffect, useMemo, useState, memo, Component, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Copy, Check, ArrowUpFromLine } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { mermaidConfig, fitMermaidLabels } from '../utils/mermaidTheme'

/** 从 React 节点中提取纯文本 */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: React.ReactNode } }).props?.children)
  }
  return ''
}

/** 代码块：右上角悬浮操作（复制 / 插入编辑器）+ 语言标识，mermaid 块除外 */
function CodeBlockWithActions({ children, onCodeAction, diagramSvg }: { children?: React.ReactNode; onCodeAction?: (code: string, action: 'copy' | 'insert') => void; diagramSvg?: string }) {
  const [copied, setCopied] = useState(false)
  const codeEl = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string } } | null
  const className = codeEl?.props?.className ?? ''
  const text = extractText(children)

  if (className.includes('mermaid')) {
    // 图表已由 React 渲染为 SVG；未渲染成功时保留代码块原文
    return diagramSvg
      ? <div className="mermaid-container" dangerouslySetInnerHTML={{ __html: diagramSvg }} />
      : <pre className="mermaid">{text}</pre>
  }

  const language = className.replace(/language-/, '') || 'text'

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
        <span className="code-lang">{language}</span>
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
  mod.default.initialize(mermaidConfig(isDark))
  return mod.default
}

/** 图表代码的稳定标识：同一段代码复用同一渲染结果，主题切换时按此键重渲染 */
function mermaidId(code: string): string {
  let hash = 0
  for (let i = 0; i < code.length; i++) hash = (Math.imul(31, hash) + code.charCodeAt(i)) | 0
  return `m${(hash >>> 0).toString(36)}`
}

/**
 * 修复 LLM 生成图表的高频语法错误（mermaid 11 解析严格）：
 * 1. 标签里的字面 \n 转为 <br/>（mermaid 只认 <br/>）；
 * 2. 标签含圆括号 / 方括号 / 花括号 / 引号时加双引号（如 `B[主程序(Program.cs)]` 会解析失败）；
 * 3. 边标签 `|...|` 含同类字符时同样加引号；
 * 4. `A & B --> C` / `A --> B & C` 多源多目标拆成多条边（mermaid 11 不支持 & 简写）。
 */
function repairMermaid(code: string): string {
  return code
    .replace(/\\n/g, '<br/>')
    .split('\n')
    .flatMap((line) => splitAmpEdges(line))
    .map((line) => quoteLabels(line))
    .join('\n')
}

/** `A & B --> C` 拆成 `A --> C` + `B --> C`（右侧同样处理） */
function splitAmpEdges(line: string): string[] {
  const match = /^(\s*)([^-]*?)\s*-->\s*(.*)$/.exec(line)
  if (!match) return [line]
  const [, indent, left, right] = match
  const sources = left.split(/\s*&\s*/).filter((s) => s.length > 0)
  const targets = right.split(/\s*&\s*/).filter((s) => s.length > 0)
  if (sources.length <= 1 && targets.length <= 1) return [line]
  const lines: string[] = []
  for (const source of sources.length > 1 ? sources : [left.trim()]) {
    for (const target of targets.length > 1 ? targets : [right.trim()]) {
      lines.push(`${indent}${source} --> ${target}`)
    }
  }
  return lines
}

/** 给含特殊字符的节点 / 边标签补双引号，避免 mermaid 解析失败 */
function quoteLabels(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    // [[...]]（子程序）与 {...} / [...] 两类标签
    const doubled = line.startsWith('[[', i)
    const open = doubled ? '[[' : ch === '{' ? '{' : ch === '[' ? '[' : null
    if (!open) {
      out += ch
      i++
      continue
    }
    const close = open === '[[' ? ']]' : open === '{' ? '}' : ']'
    const end = line.indexOf(close, i + open.length)
    if (end < 0) {
      out += line.slice(i)
      break
    }
    const inner = line.slice(i + open.length, end)
    const needsQuote = /[(){}[\]"]/.test(inner) && !inner.startsWith('"')
    out += needsQuote
      ? `${open}"${inner.replace(/"/g, "'")}"${close}`
      : `${open}${inner}${close}`
    i = end + close.length
  }
  // 边标签：-->|文本| 含特殊字符时加引号
  return out.replace(/\|([^|]*[(){}[\]"][^|]*)\|/g, (_m, label: string) =>
    label.startsWith('"') ? `|${label}|` : `|"${label.replace(/"/g, "'")}"|`)
}

/** 文档渲染异常时的降级容器：避免单篇文档问题把整个应用打成白屏 */
class MarkdownErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error('Markdown 渲染失败', error) }
  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-[13px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          文档渲染出错，可尝试复制原文到编辑器中查看
        </div>
      )
    }
    return this.props.children
  }
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
  const [viewerSrc, setViewerSrc] = useState<string | null>(null)
  /** 已渲染图表：代码标识 -> SVG 字符串（由 React 渲染，不再直接改动 DOM） */
  const [diagrams, setDiagrams] = useState<Record<string, string>>({})

  // 从正文提取 mermaid 代码块（含未闭合围栏的截断内容），做语法修复后供渲染使用
  const mermaidBlocks = useMemo(() => {
    if (!source.includes('mermaid')) return []
    const blocks: { id: string; code: string }[] = []
    const pattern = /```mermaid[ \t]*\r?\n([\s\S]*?)(?:```|$)/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const code = match[1].trim()
      if (!code) continue
      blocks.push({ id: mermaidId(code), code: repairMermaid(code) })
    }
    return blocks
  }, [source])

  // 初始化 mermaid（仅在文档含图表时加载依赖）
  useEffect(() => {
    if (!source.includes('mermaid')) return
    void loadMermaid(isDark)
  }, [isDark, source])

  // 渲染后按需生成 mermaid 图表：结果写入 state 由 React 渲染。
  // 早期实现用 el.replaceWith(div) 直接替换 React 管理的节点，切换文档时 React 再删旧子树
  // 会抛 removeChild NotFoundError 并卸载整棵树（白屏），故一律走 state。
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const mermaid = await loadMermaid(isDark)
      for (const block of mermaidBlocks) {
        if (cancelled) return
        if (diagrams[block.id]) continue
        try {
          const { svg } = await mermaid.render(`hetu-${block.id}-${Math.random().toString(36).slice(2, 6)}`, block.code)
          if (cancelled) return
          setDiagrams((prev) => (prev[block.id] ? prev : { ...prev, [block.id]: svg }))
        } catch (error) {
          // 语法仍无法解析：保留代码块原文，避免整篇文档失败
          console.warn('mermaid 渲染失败，已保留代码块', error)
        }
      }
    }
    if (mermaidBlocks.length > 0) void run()
    return () => { cancelled = true }
  }, [mermaidBlocks, diagrams, isDark])

  // 预处理：修复 markdown 格式（跳过代码块，避免破坏其中的内容）
  const processed = useMemo(() => {
    if (!source) return ''

    // 按代码围栏切分：仅处理非代码段，防止把代码里的 "- "、"# 注释" 等当作 markdown 改写
    const segments = source.split(/(```[\s\S]*?(?:```|$))/g)
    return segments
      .map((segment) => {
        if (segment.startsWith('```')) return segment

        let text = segment

        // 将行首的 ▪、•、· 等非标准列表符号转换为标准 - 标记
        text = text.replace(/^[ \t]*[▪•·]\s+/gm, '- ')

        // 将行首的数字+点/顿号列表（如 1、）转换为标准格式
        text = text.replace(/^(\d+)[、.]\s/gm, '$1. ')

        // 修复标题后紧跟内容缺少空行的问题
        text = text.replace(/^(#{1,6}\s+.+)\n([^\n#])/gm, '$1\n\n$2')

        return text
      })
      .join('')
  }, [source])

  // CJK 标签宽度修正：图表 SVG 进入 DOM 后统一适配（React 渲染，无 DOM 所有权冲突）
  useEffect(() => {
    if (!containerRef.current) return
    const containers = containerRef.current.querySelectorAll<HTMLElement>('.mermaid-container')
    if (containers.length === 0) return
    containers.forEach(fitMermaidLabels)
  }, [diagrams, processed])

  return (
    <div ref={containerRef} className={`wmde-markdown ${isDark ? 'dark' : ''} ${className ?? ''}`}>
      <MarkdownErrorBoundary>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeKatex]}
          components={{
            pre: ({ children }) => (
              <CodeBlockWithActions
                onCodeAction={onCodeAction}
                diagramSvg={diagrams[mermaidId(extractText(children).trim())]}
              >
                {children}
              </CodeBlockWithActions>
            ),
            img: ({ src, alt }) => (
              <img
                src={typeof src === 'string' ? src : ''}
                alt={alt ?? ''}
                loading="lazy"
                onClick={() => setViewerSrc(typeof src === 'string' ? src : '')}
              />
            ),
          }}
        >
          {processed}
        </ReactMarkdown>
      </MarkdownErrorBoundary>
      {viewerSrc && (
        <div className="md-image-viewer" onClick={() => setViewerSrc(null)}>
          <img src={viewerSrc} alt="预览图片" />
        </div>
      )}
    </div>
  )
})
