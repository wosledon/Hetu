import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react'

const MIN_SCALE = 0.2
const MAX_SCALE = 4
const ZOOM_STEP = 1.2
/** 视口内边距：与 CSS 中 .mermaid-viewer 的 padding 保持一致 */
const VIEW_PADDING = 10

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

interface MermaidDiagramProps {
  /** mermaid 渲染出的 SVG 字符串 */
  svg: string
}

/**
 * 可交互图表容器：拖拽平移、滚轮 / 按钮缩放、全屏查看。
 * 工具条独立成行置于图表上方，避免遮住节点；变换只作用于内层 canvas。
 */
export default function MermaidDiagram({ svg }: MermaidDiagramProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  /** 画布未变换时的布局尺寸（offsetWidth 不受 transform 影响） */
  const canvasSize = useCallback(() => {
    const canvas = viewportRef.current?.querySelector<HTMLElement>('.mermaid-canvas')
    return { width: canvas?.offsetWidth ?? 0, height: canvas?.offsetHeight ?? 0 }
  }, [])

  /** 缩放到完整可见并居中 */
  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const { width, height } = canvasSize()
    if (width <= 0 || height <= 0) return
    const available = {
      width: viewport.clientWidth - VIEW_PADDING * 2,
      height: viewport.clientHeight - VIEW_PADDING * 2,
    }
    if (available.width <= 0 || available.height <= 0) return
    const next = clampScale(Math.min(available.width / width, available.height / height, 1))
    setScale(next)
    setOffset({
      x: (viewport.clientWidth - width * next) / 2,
      y: (viewport.clientHeight - height * next) / 2,
    })
  }, [canvasSize])

  // 首帧与 SVG 变化后适配一次（被 max-height 裁切的图会缩到完整可见）
  useEffect(() => {
    const raf = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(raf)
  }, [fit, svg])

  // Ctrl/⌘ + 滚轮缩放（普通滚轮保持页面滚动）；原生监听以支持 preventDefault
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && !isFullscreen) return
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      setScale((prev) => {
        const next = clampScale(prev * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
        const ratio = next / prev
        setOffset((o) => ({ x: px - ratio * (px - o.x), y: py - ratio * (py - o.y) }))
        return next
      })
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [isFullscreen])

  // 全屏状态同步：进入时等布局稳定后重新适配
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === cardRef.current
      setIsFullscreen(active)
      if (active) requestAnimationFrame(fit)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [fit])

  const toggleFullscreen = () => {
    const card = cardRef.current
    if (!card) return
    if (document.fullscreenElement === card) void document.exitFullscreen()
    else void card.requestFullscreen?.().catch(() => {})
  }

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const cx = viewport.clientWidth / 2
    const cy = viewport.clientHeight / 2
    setScale((prev) => {
      const next = clampScale(prev * factor)
      const ratio = next / prev
      setOffset((o) => ({ x: cx - ratio * (cx - o.x), y: cy - ratio * (cy - o.y) }))
      return next
    })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // 工具条上的点击不该触发拖拽（指针捕获会导致按钮 click 不触发）
    if ((event.target as HTMLElement).closest('.mermaid-toolbar')) return
    if (event.button !== 0) return
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
    setPanning(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch { /* 不支持指针捕获不影响拖拽 */ }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) })
  }

  const endPan = () => {
    dragRef.current = null
    setPanning(false)
  }

  const buttonClass =
    'flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100'

  return (
    <div ref={cardRef} className="mermaid-container">
      {/* 工具条独立成行：不遮图表内容，全屏时随容器一起放大 */}
      <div className="mermaid-toolbar">
        <span className="mermaid-zoom-label tabular-nums">{Math.round(scale * 100)}%</span>
        <button className={buttonClass} onClick={() => zoomBy(1 / ZOOM_STEP)} title="缩小" aria-label="缩小">
          <Minus size={13} />
        </button>
        <button className={buttonClass} onClick={() => zoomBy(ZOOM_STEP)} title="放大" aria-label="放大">
          <Plus size={13} />
        </button>
        <button
          className={buttonClass}
          onClick={fit}
          title="适应视图"
          aria-label="适应视图"
        >
          <RotateCcw size={13} />
        </button>
        <button
          className={buttonClass}
          onClick={toggleFullscreen}
          title={isFullscreen ? '退出全屏（Esc）' : '全屏查看'}
          aria-label={isFullscreen ? '退出全屏' : '全屏查看'}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={() => zoomBy(ZOOM_STEP)}
        className={`mermaid-viewer ${panning ? 'is-panning' : ''}`}
        title="拖拽移动 · Ctrl/⌘ + 滚轮缩放 · 双击放大"
      >
        <div
          className="mermaid-canvas"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  )
}
