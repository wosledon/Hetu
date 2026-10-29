import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type {
  IWhiteboardBounds, IWhiteboardConnector, IWhiteboardElement, IWhiteboardPen, IWhiteboardScene,
  IWhiteboardShape, IWhiteboardStyle, IWhiteboardText, IWhiteboardViewport, WhiteboardCanvasHandle, WhiteboardTool,
} from '../../types/whiteboard'
import {
  GRID_SIZE, MIN_SIZE, centerOf, connectorAnchors, createConnector, createPen, createShape, createText,
  elementText, fitTextElement, hitTest, isShapeElement, rectFromPoints, refreshConnectors, snapValue,
  translateElement, withConnectorBounds, wrapText,
} from '../../utils/whiteboard'

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 手柄屏幕尺寸（世界坐标无关，恒为 8px） */
const HANDLE_SIZE = 8

interface WhiteboardCanvasProps {
  scene: IWhiteboardScene
  tool: WhiteboardTool
  style: IWhiteboardStyle
  /** 网格吸附开关 */
  snap: boolean
  /**
   * 场景变更。historySnapshot 为进入本次交互前的场景快照：
   * 传入表示这是一次可撤销的变更，不传表示拖拽中间态。
   */
  onSceneChange: (scene: IWhiteboardScene, historySnapshot?: IWhiteboardScene) => void
  onSelectionChange?: (elements: IWhiteboardElement[]) => void
  /** 供导出 PNG/SVG 使用：画布 SVG 元素引用 */
  svgRef?: Ref<SVGSVGElement>
  handleRef?: Ref<WhiteboardCanvasHandle>
  /** 只读模式（演示）：不响应绘制 / 选择，仅保留滚轮缩放与平移 */
  readOnly?: boolean
}

interface DragSession {
  pointerId: number
  kind: 'pan' | 'move' | 'resize' | 'create' | 'marquee' | 'connector'
  startClientX: number
  startClientY: number
  startWorldX: number
  startWorldY: number
  snapshot: IWhiteboardScene
  origins?: Map<string, IWhiteboardElement>
  handle?: HandleId
  connectorFromId?: string | null
  startViewport?: IWhiteboardViewport
}

function diamondPoints(bounds: IWhiteboardBounds): string {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  return `${bounds.x},${cy} ${cx},${bounds.y} ${bounds.x + bounds.width},${cy} ${cx},${bounds.y + bounds.height}`
}

/** 连接线箭头三角形（世界坐标） */
function arrowPoints(from: { x: number; y: number }, to: { x: number; y: number }, size = 10): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const baseX = to.x - Math.cos(angle) * size
  const baseY = to.y - Math.sin(angle) * size
  const normalX = Math.cos(angle + Math.PI / 2) * size * 0.45
  const normalY = Math.sin(angle + Math.PI / 2) * size * 0.45
  return `${to.x},${to.y} ${baseX + normalX},${baseY + normalY} ${baseX - normalX},${baseY - normalY}`
}

function resizeBounds(origin: IWhiteboardBounds, handle: HandleId, dx: number, dy: number): IWhiteboardBounds {
  let { x, y, width, height } = origin
  if (handle.includes('w')) {
    x = origin.x + dx
    width = origin.width - dx
  }
  if (handle.includes('e')) width = origin.width + dx
  if (handle.includes('n')) {
    y = origin.y + dy
    height = origin.height - dy
  }
  if (handle.includes('s')) height = origin.height + dy
  if (width < MIN_SIZE) {
    if (handle.includes('w')) x = origin.x + origin.width - MIN_SIZE
    width = MIN_SIZE
  }
  if (height < MIN_SIZE) {
    if (handle.includes('n')) y = origin.y + origin.height - MIN_SIZE
    height = MIN_SIZE
  }
  return { x, y, width, height }
}

function handlePoint(element: IWhiteboardElement, handle: HandleId): { x: number; y: number } {
  const right = element.x + element.width
  const bottom = element.y + element.height
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  switch (handle) {
    case 'nw': return { x: element.x, y: element.y }
    case 'n': return { x: cx, y: element.y }
    case 'ne': return { x: right, y: element.y }
    case 'e': return { x: right, y: cy }
    case 'se': return { x: right, y: bottom }
    case 's': return { x: cx, y: bottom }
    case 'sw': return { x: element.x, y: bottom }
    case 'w': return { x: element.x, y: cy }
  }
}

/** 手柄命中：世界坐标点是否落在某个手柄上（阈值按屏幕尺寸反算） */
function handleAt(element: IWhiteboardElement, x: number, y: number, zoom: number): HandleId | null {
  const threshold = HANDLE_SIZE / zoom
  for (const handle of HANDLES) {
    const point = handlePoint(element, handle)
    if (Math.abs(x - point.x) <= threshold && Math.abs(y - point.y) <= threshold) return handle
  }
  return null
}

function handleCursor(handle: HandleId): string {
  if (handle === 'n' || handle === 's') return 'ns-resize'
  if (handle === 'e' || handle === 'w') return 'ew-resize'
  if (handle === 'nw' || handle === 'se') return 'nwse-resize'
  return 'nesw-resize'
}

function intersects(element: IWhiteboardElement, bounds: IWhiteboardBounds): boolean {
  return element.x < bounds.x + bounds.width
    && element.x + element.width > bounds.x
    && element.y < bounds.y + bounds.height
    && element.y + element.height > bounds.y
}

/** 元素上的说明文字：自动换行 + 居中（文本元素不换行，由外框表达宽度） */
function ElementLabel({ element, text }: { element: IWhiteboardShape | IWhiteboardText; text: string }) {
  if (!text) return null
  const maxWidth = element.type === 'text' ? Number.POSITIVE_INFINITY : Math.max(10, element.width - 16)
  const lines = wrapText(text, element.fontSize, maxWidth)
  const lineHeight = element.fontSize * 1.4
  const startY = element.y + element.height / 2 - (lineHeight * lines.length) / 2 + element.fontSize * 0.85
  return (
    <text
      fontSize={element.fontSize}
      fill={element.type === 'text' ? element.fill : element.stroke}
      textAnchor="middle"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {lines.map((line, index) => (
        <tspan key={index} x={element.x + element.width / 2} y={startY + lineHeight * index}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function ElementView({ element }: { element: IWhiteboardElement }) {
  const common = {
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    fill: element.fill,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  }
  switch (element.type) {
    case 'rect':
      return (
        <g>
          <rect x={element.x} y={element.y} width={element.width} height={element.height} rx={6} {...common} />
          <ElementLabel element={element} text={element.text} />
        </g>
      )
    case 'ellipse':
      return (
        <g>
          <ellipse
            cx={element.x + element.width / 2}
            cy={element.y + element.height / 2}
            rx={element.width / 2}
            ry={element.height / 2}
            {...common}
          />
          <ElementLabel element={element} text={element.text} />
        </g>
      )
    case 'diamond':
      return (
        <g>
          <polygon points={diamondPoints(element)} {...common} />
          <ElementLabel element={element} text={element.text} />
        </g>
      )
    case 'text':
      return <ElementLabel element={element} text={element.text} />
    case 'pen':
      return <polyline points={element.points.join(' ')} {...common} fill="none" />
    case 'connector': {
      const midX = (element.from.x + element.to.x) / 2
      const midY = (element.from.y + element.to.y) / 2
      return (
        <g>
          <line x1={element.from.x} y1={element.from.y} x2={element.to.x} y2={element.to.y} {...common} />
          <polygon points={arrowPoints(element.from, element.to)} fill={element.stroke} stroke="none" />
          {element.label && (
            <text
              x={midX}
              y={midY - 6}
              fontSize={element.fontSize}
              fill={element.fill}
              textAnchor="middle"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {element.label}
            </text>
          )}
        </g>
      )
    }
  }
}

/** 白板画布：SVG 引擎，承载全部绘制 / 选择 / 变换交互 */
export default function WhiteboardCanvas({
  scene, tool, style, snap, onSceneChange, onSelectionChange, svgRef, handleRef, readOnly = false,
}: WhiteboardCanvasProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [draft, setDraft] = useState<IWhiteboardElement | null>(null)
  const [marquee, setMarquee] = useState<IWhiteboardBounds | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)

  const sessionRef = useRef<DragSession | null>(null)
  const sceneRef = useRef(scene)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    sceneRef.current = scene
  }, [scene])

  const viewport = scene.viewport

  const selectedElements = useMemo(
    () => scene.elements.filter((element) => selectedIds.includes(element.id)),
    [scene.elements, selectedIds],
  )

  useEffect(() => {
    onSelectionChange?.(selectedElements)
  }, [selectedElements, onSelectionChange])

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.querySelector('svg')?.getBoundingClientRect()
    return {
      x: (clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom,
      y: (clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom,
    }
  }, [viewport])

  /** 顶层命中元素（后画的优先） */
  const topmostAt = useCallback((x: number, y: number, excludeId?: string) => {
    for (let i = sceneRef.current.elements.length - 1; i >= 0; i -= 1) {
      const element = sceneRef.current.elements[i]
      if (element.id === excludeId) continue
      if (hitTest(element, x, y)) return element
    }
    return null
  }, [])

  const applyElements = useCallback((elements: IWhiteboardElement[], historySnapshot?: IWhiteboardScene) => {
    onSceneChange({ ...sceneRef.current, elements: refreshConnectors(elements) }, historySnapshot)
  }, [onSceneChange])

  const applyViewport = useCallback((next: IWhiteboardViewport, historySnapshot?: IWhiteboardScene) => {
    onSceneChange({ ...sceneRef.current, viewport: next }, historySnapshot)
  }, [onSceneChange])

  /* ── 文本 / 连接线标签编辑浮层 ── */

  const editingElement = editingId ? scene.elements.find((element) => element.id === editingId) ?? null : null

  const editingText = editingElement ? elementText(editingElement) : ''

  const closeEditing = useCallback((text: string) => {
    const element = editingElement
    setEditingId(null)
    if (!element) return
    // 空文本：文本元素直接删除（含刚建好就收起的情况），形状元素还原为无文字
    if (element.type === 'text' && !text.trim()) {
      applyElements(sceneRef.current.elements.filter((item) => item.id !== element.id), sceneRef.current)
      return
    }
    if (elementText(element) === text) return
    if (element.type === 'connector') {
      applyElements(sceneRef.current.elements.map((item) => (item.id === element.id ? { ...element, label: text } : item)), sceneRef.current)
    } else if (element.type === 'text') {
      applyElements(sceneRef.current.elements.map((item) => (item.id === element.id ? fitTextElement({ ...element, text }) : item)), sceneRef.current)
    } else if (isShapeElement(element)) {
      applyElements(sceneRef.current.elements.map((item) => (item.id === element.id ? { ...element, text } : item)), sceneRef.current)
    }
  }, [applyElements, editingElement])

  const updateEditingText = (text: string) => {
    const element = editingElement
    if (!element) return
    if (element.type === 'connector') {
      applyElements(sceneRef.current.elements.map((item) => (item.id === element.id ? { ...element, label: text } : item)))
    } else if (element.type === 'text') {
      applyElements(sceneRef.current.elements.map((item) => (item.id === element.id ? fitTextElement({ ...element, text }) : item)))
    } else if (isShapeElement(element)) {
      applyElements(sceneRef.current.elements.map((item) => (item.id === element.id ? { ...element, text } : item)))
    }
  }

  /* ── 指针交互 ── */

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || event.button === 2) return
    // 任何画布交互都先收尾文本编辑：空文本元素随之删除，浮层不会残留
    if (editingId) closeEditing(editingText)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 合成事件或异常环境下指针捕获可能失败：不影响交互本身
    }
    const world = toWorld(event.clientX, event.clientY)
    const snapshot = sceneRef.current
    const panning = tool === 'pan' || spaceDown || event.button === 1

    if (panning) {
      sessionRef.current = {
        pointerId: event.pointerId, kind: 'pan',
        startClientX: event.clientX, startClientY: event.clientY,
        startWorldX: world.x, startWorldY: world.y, snapshot, startViewport: viewport,
      }
      return
    }

    if (tool === 'eraser') {
      const hit = topmostAt(world.x, world.y)
      if (hit) {
        setSelectedIds((ids) => ids.filter((id) => id !== hit.id))
        applyElements(snapshot.elements.filter((element) => element.id !== hit.id), snapshot)
      }
      return
    }

    if (tool === 'text') {
      const created = fitTextElement(createText(snapValue(world.x, snap), snapValue(world.y, snap), style))
      applyElements([...snapshot.elements, created], snapshot)
      setSelectedIds([created.id])
      setEditingId(created.id)
      return
    }

    if (tool === 'pen') {
      sessionRef.current = {
        pointerId: event.pointerId, kind: 'create',
        startClientX: event.clientX, startClientY: event.clientY,
        startWorldX: world.x, startWorldY: world.y, snapshot,
      }
      setDraft(createPen([snapValue(world.x, snap), snapValue(world.y, snap)], style))
      return
    }

    if (tool === 'connector') {
      const hit = topmostAt(world.x, world.y)
      const from = hit ? centerOf(hit) : { x: world.x, y: world.y }
      sessionRef.current = {
        pointerId: event.pointerId, kind: 'connector',
        startClientX: event.clientX, startClientY: event.clientY,
        startWorldX: world.x, startWorldY: world.y, snapshot,
        connectorFromId: hit?.id ?? null,
      }
      setDraft(createConnector(from, from, style))
      return
    }

    if (tool === 'rect' || tool === 'ellipse' || tool === 'diamond') {
      sessionRef.current = {
        pointerId: event.pointerId, kind: 'create',
        startClientX: event.clientX, startClientY: event.clientY,
        startWorldX: world.x, startWorldY: world.y, snapshot,
      }
      setDraft(createShape(tool, rectFromPoints(world.x, world.y, world.x, world.y, snap), style))
      return
    }

    // 选择工具：优先命中手柄，其次元素，最后空白区域（框选）
    const single = selectedElements.length === 1 ? selectedElements[0] : null
    if (single && single.type !== 'pen' && single.type !== 'connector') {
      const handle = handleAt(single, world.x, world.y, viewport.zoom)
      if (handle) {
        sessionRef.current = {
          pointerId: event.pointerId, kind: 'resize', handle,
          startClientX: event.clientX, startClientY: event.clientY,
          startWorldX: world.x, startWorldY: world.y, snapshot,
          origins: new Map([[single.id, single]]),
        }
        return
      }
    }

    const hit = topmostAt(world.x, world.y)
    if (hit) {
      const nextIds = event.shiftKey
        ? selectedIds.includes(hit.id)
          ? selectedIds.filter((id) => id !== hit.id)
          : [...selectedIds, hit.id]
        : selectedIds.includes(hit.id) ? selectedIds : [hit.id]
      setSelectedIds(nextIds)
      const movingIds = nextIds.includes(hit.id) ? nextIds : [hit.id]
      const origins = new Map(
        snapshot.elements.filter((element) => movingIds.includes(element.id)).map((element) => [element.id, element]),
      )
      sessionRef.current = {
        pointerId: event.pointerId, kind: 'move',
        startClientX: event.clientX, startClientY: event.clientY,
        startWorldX: world.x, startWorldY: world.y, snapshot, origins,
      }
      return
    }

    if (!event.shiftKey) setSelectedIds([])
    sessionRef.current = {
      pointerId: event.pointerId, kind: 'marquee',
      startClientX: event.clientX, startClientY: event.clientY,
      startWorldX: world.x, startWorldY: world.y, snapshot,
    }
    setMarquee({ x: world.x, y: world.y, width: 0, height: 0 })
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly) return
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const world = toWorld(event.clientX, event.clientY)
    const delta = (value: number) => (snap ? Math.round(value / GRID_SIZE) * GRID_SIZE : value)

    switch (session.kind) {
      case 'pan': {
        const start = session.startViewport ?? viewport
        applyViewport({
          ...start,
          x: start.x + (event.clientX - session.startClientX),
          y: start.y + (event.clientY - session.startClientY),
        })
        break
      }
      case 'move': {
        const dx = delta(world.x - session.startWorldX)
        const dy = delta(world.y - session.startWorldY)
        const origins = session.origins ?? new Map<string, IWhiteboardElement>()
        applyElements(
          session.snapshot.elements.map((element) => {
            const origin = origins.get(element.id)
            return origin ? translateElement(origin, dx, dy) : element
          }),
        )
        break
      }
      case 'resize': {
        const origin = [...(session.origins ?? new Map<string, IWhiteboardElement>()).values()][0]
        const handle = session.handle
        if (!origin || !handle) break
        const bounds = resizeBounds(origin, handle, delta(world.x - session.startWorldX), delta(world.y - session.startWorldY))
        const resized = origin.type === 'text' ? fitTextElement({ ...origin, ...bounds }) : { ...origin, ...bounds }
        applyElements(session.snapshot.elements.map((element) => (element.id === origin.id ? resized : element)))
        break
      }
      case 'create': {
        if (draft?.type === 'pen') {
          const lastX = draft.points[draft.points.length - 2]
          const lastY = draft.points[draft.points.length - 1]
          if (Math.hypot(world.x - lastX, world.y - lastY) < 2 / viewport.zoom) return
          const next: IWhiteboardPen = {
            ...draft,
            points: [...draft.points, snapValue(world.x, snap), snapValue(world.y, snap)],
          }
          setDraft(next)
        } else if (draft) {
          setDraft({ ...draft, ...rectFromPoints(session.startWorldX, session.startWorldY, world.x, world.y, snap) })
        }
        break
      }
      case 'connector': {
        const start = draft
        if (!start || start.type !== 'connector') break
        const target = topmostAt(world.x, world.y, start.id)
        const fromElement = session.connectorFromId
          ? session.snapshot.elements.find((element) => element.id === session.connectorFromId) ?? null
          : null
        const anchorFrom = fromElement ? centerOf(fromElement) : start.from
        const next: IWhiteboardConnector = target
          ? withConnectorBounds({
            ...start,
            fromId: session.connectorFromId ?? null,
            toId: target.id,
            from: fromElement ? connectorAnchors(fromElement, target).from : anchorFrom,
            to: fromElement ? connectorAnchors(fromElement, target).to : centerOf(target),
          })
          : withConnectorBounds({
            ...start,
            toId: null,
            from: anchorFrom,
            to: { x: snapValue(world.x, snap), y: snapValue(world.y, snap) },
          })
        setDraft(next)
        break
      }
      case 'marquee': {
        setMarquee(rectFromPoints(session.startWorldX, session.startWorldY, world.x, world.y, snap))
        break
      }
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly) return
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    sessionRef.current = null
    const world = toWorld(event.clientX, event.clientY)

    switch (session.kind) {
      case 'pan':
        applyViewport(viewport, session.snapshot)
        break
      case 'move':
      case 'resize':
        applyElements(sceneRef.current.elements, session.snapshot)
        break
      case 'create': {
        if (!draft) break
        const created = draft.type === 'pen'
          ? draft
          : { ...draft, ...rectFromPoints(session.startWorldX, session.startWorldY, world.x, world.y, snap) }
        applyElements([...session.snapshot.elements, created], session.snapshot)
        setSelectedIds([created.id])
        setDraft(null)
        break
      }
      case 'connector': {
        if (!draft) break
        applyElements([...session.snapshot.elements, draft], session.snapshot)
        setSelectedIds([draft.id])
        setDraft(null)
        break
      }
      case 'marquee': {
        if (marquee && (marquee.width > 2 || marquee.height > 2)) {
          setSelectedIds(session.snapshot.elements.filter((element) => intersects(element, marquee)).map((element) => element.id))
        }
        setMarquee(null)
        break
      }
    }
  }

  const handleDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (readOnly || tool !== 'select') return
    const world = toWorld(event.clientX, event.clientY)
    const hit = topmostAt(world.x, world.y)
    if (hit) {
      setSelectedIds([hit.id])
      setEditingId(hit.id)
      return
    }
    const created = fitTextElement(createText(snapValue(world.x, snap), snapValue(world.y, snap), style))
    applyElements([...sceneRef.current.elements, created], sceneRef.current)
    setSelectedIds([created.id])
    setEditingId(created.id)
  }

  /* ── 滚轮缩放 / 平移（原生非 passive 监听，保证 preventDefault 生效） ── */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = container.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const current = sceneRef.current.viewport
      if (event.shiftKey) {
        applyViewport({ ...current, x: current.x - event.deltaY })
        return
      }
      const factor = Math.exp(-event.deltaY * 0.0015)
      const zoom = Math.min(4, Math.max(0.1, current.zoom * factor))
      const ratio = zoom / current.zoom
      applyViewport({
        zoom,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [applyViewport])

  /* ── 空格临时切换平移 ── */

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        setSpaceDown(true)
        event.preventDefault()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  /* ── 命令式操作：页面快捷键与工具栏调用 ── */

  useImperativeHandle(handleRef, () => {
    const ids = new Set(selectedIds)
    return {
      deleteSelection() {
        if (ids.size === 0) return
        applyElements(sceneRef.current.elements.filter((element) => !ids.has(element.id)), sceneRef.current)
        setSelectedIds([])
      },
      duplicateSelection() {
        const clones = sceneRef.current.elements
          .filter((element) => ids.has(element.id))
          .map((element) => ({ ...element, id: `${element.id}-copy-${Date.now().toString(36)}` }))
        if (clones.length === 0) return
        applyElements([...sceneRef.current.elements, ...clones], sceneRef.current)
        setSelectedIds(clones.map((element) => element.id))
      },
      nudgeSelection(dx: number, dy: number) {
        if (ids.size === 0) return
        applyElements(
          sceneRef.current.elements.map((element) => (ids.has(element.id) ? translateElement(element, dx, dy) : element)),
          sceneRef.current,
        )
      },
      reorderSelection(toFront: boolean) {
        if (ids.size === 0) return
        const selected = sceneRef.current.elements.filter((element) => ids.has(element.id))
        const rest = sceneRef.current.elements.filter((element) => !ids.has(element.id))
        applyElements(toFront ? [...rest, ...selected] : [...selected, ...rest], sceneRef.current)
      },
      selectAll() {
        setSelectedIds(sceneRef.current.elements.map((element) => element.id))
      },
    }
  }, [applyElements, selectedIds])

  /* ── 渲染 ── */

  const selectionOverlay = selectedElements.map((element) => (
    <rect
      key={element.id}
      x={element.x * viewport.zoom + viewport.x}
      y={element.y * viewport.zoom + viewport.y}
      width={element.width * viewport.zoom}
      height={element.height * viewport.zoom}
      fill="none"
      stroke="#3b82f6"
      strokeWidth={1}
      strokeDasharray="4 3"
      style={{ pointerEvents: 'none' }}
    />
  ))

  const single = selectedElements.length === 1 ? selectedElements[0] : null
  const handleOverlay = single && single.type !== 'pen' && single.type !== 'connector'
    ? HANDLES.map((handle) => {
      const point = handlePoint(single, handle)
      return (
        <rect
          key={handle}
          x={point.x * viewport.zoom + viewport.x - HANDLE_SIZE / 2}
          y={point.y * viewport.zoom + viewport.y - HANDLE_SIZE / 2}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          fill="#ffffff"
          stroke="#3b82f6"
          strokeWidth={1.5}
          style={{ cursor: handleCursor(handle) }}
        />
      )
    })
    : null

  const cursorClass = readOnly
    ? 'cursor-default text-white/[0.06]'
    : spaceDown || tool === 'pan'
      ? 'cursor-grab active:cursor-grabbing text-gray-200 dark:text-white/[0.07]'
      : tool === 'select' ? 'cursor-default text-gray-200 dark:text-white/[0.07]'
        : tool === 'eraser' ? 'cursor-cell text-gray-200 dark:text-white/[0.07]'
          : 'cursor-crosshair text-gray-200 dark:text-white/[0.07]'

  const editingField = editingElement && editingElement.type !== 'connector' && editingElement.type !== 'pen'
    ? editingElement
    : null

  const editingOverlay = editingField
    ? (
      <textarea
        autoFocus
        value={editingText}
        onChange={(event) => updateEditingText(event.target.value)}
        onBlur={() => closeEditing(editingText)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setEditingId(null)
          }
        }}
        className="absolute z-10 resize-none rounded border border-blue-400 bg-white/95 p-1 text-gray-800 outline-none dark:bg-gray-800/95 dark:text-gray-100"
        style={{
          left: editingField.x * viewport.zoom + viewport.x,
          top: editingField.y * viewport.zoom + viewport.y,
          width: Math.max(140, editingField.width * viewport.zoom),
          height: Math.max(editingField.fontSize * 1.6 * viewport.zoom, editingField.height * viewport.zoom),
          fontSize: editingField.fontSize * viewport.zoom,
          lineHeight: 1.5,
        }}
      />
    )
    : null

  const labelOverlay = editingElement?.type === 'connector'
    ? (() => {
      const midX = (editingElement.from.x + editingElement.to.x) / 2
      const midY = (editingElement.from.y + editingElement.to.y) / 2
      return (
        <input
          autoFocus
          defaultValue={editingElement.label}
          onBlur={(event) => closeEditing(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.stopPropagation()
              closeEditing(event.currentTarget.value)
            }
          }}
          className="absolute z-10 rounded border border-blue-400 bg-white/95 px-1 text-gray-800 outline-none dark:bg-gray-800/95 dark:text-gray-100"
          style={{
            left: midX * viewport.zoom + viewport.x - 60,
            top: midY * viewport.zoom + viewport.y - 16,
            width: 120,
            fontSize: editingElement.fontSize * viewport.zoom,
          }}
        />
      )
    })()
    : null

  return (
    <div ref={containerRef} className={`relative h-full w-full overflow-hidden ${readOnly ? 'bg-gray-950' : 'bg-gray-50 dark:bg-gray-950'}`}>
      <svg
        ref={svgRef}
        className={`h-full w-full touch-none select-none ${cursorClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      >
        <defs>
          <pattern id="wb-grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
            <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="currentColor" strokeWidth={1} />
          </pattern>
        </defs>
        <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#wb-grid)" />
        <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>
          {scene.elements.map((element) => (
            <ElementView key={element.id} element={element} />
          ))}
          {draft && <ElementView element={draft} />}
          {marquee && (
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill="rgba(59,130,246,0.08)"
              stroke="#3b82f6"
              strokeDasharray="4 3"
            />
          )}
        </g>
        {selectionOverlay}
        {handleOverlay}
      </svg>
      {editingOverlay}
      {labelOverlay}
    </div>
  )
}
