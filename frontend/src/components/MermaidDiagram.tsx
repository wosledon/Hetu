import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react'

const MIN_SCALE = 0.2
const MAX_SCALE = 4
const ZOOM_STEP = 1.2

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

interface MermaidDiagramProps {
  /** mermaid 渲染出的 SVG 字符串 */
  svg: string
}

/**
 * 可交互图表容器：拖拽平移、滚轮 / 按钮缩放、全屏查看。
 * 变换只作用于内层 canvas，SVG 本身由 React 渲染，不直接改动 DOM 结构。
 */
export default function MermaidDiagram({ svg }: MermaidDiagramProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  /** 图表原始尺寸（viewBox 优先，避免受 max-width 影响） */
  const naturalSize = useCallback(() => {
    const svgEl = viewportRef.current?.querySelector('svg')
    if (!svgEl) return { width: 0, height: 0 }
    const box = (svgEl as SVGSVGElement).viewBox?.baseVal
    if (box && box.width > 0) return { width: box.width, height: box.height }
    const rect = svgEl.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }, [])

  /** 缩放到刚好容纳整个图表 */
  const fitToViewport = useCallback((viewport: HTMLDivElement) => {
    const { width, height } = naturalSize()
    if (width <= 0) return
    const available = {
      width: viewport.clientWidth - 24,
      height: viewport.clientHeight - 24,
    }
    const next = clampScale(Math.min(available.width / width, available.height / height, 1))
    setScale(next)
    // 居中：按缩放后的实际尺寸计算偏移
    const scaledWidth = width * next
    const scaledHeight = height * next
    setOffset({
      x: Math.max(0, (viewport.clientWidth - scaledWidth) / 2),
      y: Math.max(0, (viewport.clientHeight - scaledHeight) / 2),
    })
  }, [naturalSize])

  // 首次进入：过宽的图表自动缩到容器宽度
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const { width } = naturalSize()
    const available = viewport.clientWidth - 24
    if (width > available && available > 0) setScale(clampScale(available / width))
  }, [naturalSize, svg])

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

  // 全屏状态同步：进入时适配屏幕，退出时恢复
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === viewportRef.current
      setIsFullscreen(active)
      if (active && viewportRef.current) fitToViewport(viewportRef.current)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [fitToViewport])

  const toggleFullscreen = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (document.fullscreenElement === viewport) void document.exitFullscreen()
    else void viewport.requestFullscreen?.().catch(() => {})
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
    if (event.button !== 0) return
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
    setPanning(true)
    try {
      // 指针捕获让拖拽移出容器后仍能跟随；个别环境不支持时忽略即可
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

  const toolbarButtonClass =
    'flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-gray-900 dark:bg-gray-800/90 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'

  return (
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

      <div className="mermaid-toolbar">
        <span className="mermaid-zoom-label tabular-nums">{Math.round(scale * 100)}%</span>
        <button className={toolbarButtonClass} onClick={() => zoomBy(1 / ZOOM_STEP)} title="缩小" aria-label="缩小">
          <Minus size={13} />
        </button>
        <button className={toolbarButtonClass} onClick={() => zoomBy(ZOOM_STEP)} title="放大" aria-label="放大">
          <Plus size={13} />
        </button>
        <button
          className={toolbarButtonClass}
          onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}
          title="重置视图"
          aria-label="重置视图"
        >
          <RotateCcw size={13} />
        </button>
        <button
          className={toolbarButtonClass}
          onClick={toggleFullscreen}
          title={isFullscreen ? '退出全屏' : '全屏查看'}
          aria-label={isFullscreen ? '退出全屏' : '全屏查看'}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
    </div>
  )
}
