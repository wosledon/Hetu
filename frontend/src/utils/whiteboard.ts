import type {
  IWhiteboardBounds, IWhiteboardConnector, IWhiteboardElement, IWhiteboardPen,
  IWhiteboardScene, IWhiteboardShape, IWhiteboardStyle, IWhiteboardText, IWhiteboardViewport,
  WhiteboardShapeType, WhiteboardTool,
} from '../types/whiteboard'
/** 网格步长（世界坐标）：吸附与背景网格共用 */
export const GRID_SIZE = 20

/** 最小元素尺寸，避免拖拽出 0 宽高的不可见元素 */
export const MIN_SIZE = 12

export const EMPTY_SCENE: IWhiteboardScene = {
  elements: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

export const DEFAULT_STYLE: IWhiteboardStyle = {
  stroke: '#334155',
  fill: '#dbeafe',
  strokeWidth: 2,
  fontSize: 14,
}

/** 描边色板（工具栏取色） */
export const STROKE_COLORS = ['#334155', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ffffff']

/** 填充色板（第一个为透明） */
export const FILL_COLORS = ['transparent', '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#ede9fe', '#f1f5f9']

/** 工具元数据：图标由组件层映射，这里只维护 key 与默认指针行为 */
export const DRAWING_TOOLS: WhiteboardTool[] = ['rect', 'ellipse', 'diamond', 'text', 'pen', 'connector']

let idCounter = 0

export function newId(): string {
  idCounter += 1
  return `wb-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

/** 解析后端场景 JSON：损坏或结构不符时退回到空白画板，保证编辑器始终可用 */
export function parseScene(raw: string | undefined | null): IWhiteboardScene {
  if (!raw) return { ...EMPTY_SCENE, viewport: { ...EMPTY_SCENE.viewport } }
  try {
    const parsed = JSON.parse(raw) as Partial<IWhiteboardScene>
    const elements = Array.isArray(parsed.elements)
      ? parsed.elements.filter((el): el is IWhiteboardElement => !!el && typeof el.id === 'string' && typeof el.type === 'string')
      : []
    const viewport = normalizeViewport(parsed.viewport)
    return { elements, viewport }
  } catch {
    return { ...EMPTY_SCENE, viewport: { ...EMPTY_SCENE.viewport } }
  }
}

export function serializeScene(scene: IWhiteboardScene): string {
  return JSON.stringify({ elements: scene.elements, viewport: scene.viewport })
}

function normalizeViewport(viewport: Partial<IWhiteboardViewport> | undefined): IWhiteboardViewport {
  const zoom = typeof viewport?.zoom === 'number' && Number.isFinite(viewport.zoom) && viewport.zoom > 0
    ? Math.min(4, Math.max(0.1, viewport.zoom))
    : 1
  return {
    x: typeof viewport?.x === 'number' && Number.isFinite(viewport.x) ? viewport.x : 0,
    y: typeof viewport?.y === 'number' && Number.isFinite(viewport.y) ? viewport.y : 0,
    zoom,
  }
}

export function snapValue(value: number, enabled: boolean): number {
  return enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : Math.round(value * 100) / 100
}

/** 由拖拽起点与当前点归一化出外接矩形（支持向左上拖动） */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number, snap: boolean): IWhiteboardBounds {
  const sx1 = snapValue(x1, snap)
  const sy1 = snapValue(y1, snap)
  const sx2 = snapValue(x2, snap)
  const sy2 = snapValue(y2, snap)
  return {
    x: Math.min(sx1, sx2),
    y: Math.min(sy1, sy2),
    width: Math.max(MIN_SIZE, Math.abs(sx2 - sx1)),
    height: Math.max(MIN_SIZE, Math.abs(sy2 - sy1)),
  }
}

export function createShape(
  type: WhiteboardShapeType,
  bounds: IWhiteboardBounds,
  style: IWhiteboardStyle,
): IWhiteboardShape {
  return {
    id: newId(),
    type,
    ...bounds,
    text: '',
    fontSize: style.fontSize,
    stroke: style.stroke,
    fill: style.fill,
    strokeWidth: style.strokeWidth,
  }
}

export function createText(x: number, y: number, style: IWhiteboardStyle): IWhiteboardText {
  return {
    id: newId(),
    type: 'text',
    x,
    y,
    width: Math.max(24, measureText('', style.fontSize)),
    height: Math.round(style.fontSize * 1.5),
    text: '',
    fontSize: style.fontSize,
    stroke: style.stroke,
    fill: style.stroke,
    strokeWidth: style.strokeWidth,
  }
}

export function createConnector(
  from: { x: number; y: number },
  to: { x: number; y: number },
  style: IWhiteboardStyle,
): IWhiteboardConnector {
  return withConnectorBounds({
    id: newId(),
    type: 'connector',
    fromId: null,
    toId: null,
    from: { ...from },
    to: { ...to },
    label: '',
    fontSize: style.fontSize,
    stroke: style.stroke,
    fill: style.stroke,
    strokeWidth: style.strokeWidth,
  })
}

export function createPen(points: number[], style: IWhiteboardStyle): IWhiteboardPen {
  const pen: IWhiteboardPen = {
    id: newId(),
    type: 'pen',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    points,
    stroke: style.stroke,
    fill: 'transparent',
    strokeWidth: style.strokeWidth,
  }
  return withPenBounds(pen)
}

/** 重新计算画笔外接矩形 */
export function withPenBounds(pen: IWhiteboardPen): IWhiteboardPen {
  if (pen.points.length < 2) return { ...pen, x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < pen.points.length; i += 2) {
    minX = Math.min(minX, pen.points[i])
    maxX = Math.max(maxX, pen.points[i])
    minY = Math.min(minY, pen.points[i + 1])
    maxY = Math.max(maxY, pen.points[i + 1])
  }
  return { ...pen, x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** 重新计算连接线外接矩形（含线宽余量） */
export function withConnectorBounds(
  connector: Omit<IWhiteboardConnector, 'x' | 'y' | 'width' | 'height'>,
): IWhiteboardConnector {
  const pad = connector.strokeWidth
  const x = Math.min(connector.from.x, connector.to.x) - pad
  const y = Math.min(connector.from.y, connector.to.y) - pad
  return {
    ...connector,
    x,
    y,
    width: Math.abs(connector.to.x - connector.from.x) + pad * 2,
    height: Math.abs(connector.to.y - connector.from.y) + pad * 2,
  }
}

/** 类型守卫：形状元素（可带说明文字） */
export function isShapeElement(element: IWhiteboardElement): element is IWhiteboardShape {
  return element.type === 'rect' || element.type === 'ellipse' || element.type === 'diamond'
}

/** 元素上的可编辑文本：连接线取标签，画笔无文本 */
export function elementText(element: IWhiteboardElement): string {
  if (element.type === 'connector') return element.label
  if (element.type === 'pen') return ''
  return element.text
}

/** 把工具栏样式应用到元素（文本取描边色作为字色，连接线不需要填充） */
export function applyStyleToElement(element: IWhiteboardElement, style: IWhiteboardStyle): IWhiteboardElement {
  if (element.type === 'pen') return { ...element, stroke: style.stroke, strokeWidth: style.strokeWidth }
  if (element.type === 'connector')
    return { ...element, stroke: style.stroke, fill: style.stroke, strokeWidth: style.strokeWidth, fontSize: style.fontSize }
  if (element.type === 'text')
    return { ...element, stroke: style.stroke, fill: style.stroke, strokeWidth: style.strokeWidth, fontSize: style.fontSize }
  return { ...element, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth, fontSize: style.fontSize }
}

/** 命中测试：所有元素都按外接矩形判定（画笔同样适用） */
export function hitTest(element: IWhiteboardElement, x: number, y: number): boolean {  if (element.type === 'pen') {
    // 画笔按折线就近判定，避免大块空白区域误命中
    const threshold = Math.max(6, element.strokeWidth * 2)
    for (let i = 0; i + 3 < element.points.length; i += 2) {
      if (distanceToSegment(x, y, element.points[i], element.points[i + 1], element.points[i + 2], element.points[i + 3]) <= threshold)
        return true
    }
    return element.points.length === 2
      && distanceToSegment(x, y, element.points[0], element.points[1], element.points[0], element.points[1]) <= threshold
  }
  const pad = element.type === 'connector' ? Math.max(6, element.strokeWidth * 2) : 0
  return x >= element.x - pad && x <= element.x + element.width + pad
    && y >= element.y - pad && y <= element.y + element.height + pad
}

/** 平移元素：画笔平移点序列，连接线平移两端，其余平移外接矩形 */
export function translateElement(element: IWhiteboardElement, dx: number, dy: number): IWhiteboardElement {
  if (element.type === 'pen') {
    const points = element.points.map((value, index) => (index % 2 === 0 ? value + dx : value + dy))
    return withPenBounds({ ...element, points })
  }
  if (element.type === 'connector') {
    const moved: IWhiteboardConnector = {
      ...element,
      from: { x: element.from.x + dx, y: element.from.y + dy },
      to: { x: element.to.x + dx, y: element.to.y + dy },
    }
    // 吸附端跟随被吸附元素移动，未吸附端（fromId/toId 为 null）保持绝对坐标
    return withConnectorBounds(moved)
  }
  return { ...element, x: element.x + dx, y: element.y + dy }
}

/** 连接线端点吸附：取两元素中心连线与各自矩形的交点 */
export function connectorAnchors(
  from: IWhiteboardElement,
  to: IWhiteboardElement,
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const fc = centerOf(from)
  const tc = centerOf(to)
  return { from: rectEdgePoint(fc, tc, from), to: rectEdgePoint(tc, fc, to) }
}

export function centerOf(element: IWhiteboardElement): { x: number; y: number } {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 }
}

/** 中心朝 target 方向与矩形边界的交点 */
function rectEdgePoint(
  center: { x: number; y: number },
  target: { x: number; y: number },
  element: IWhiteboardElement,
): { x: number; y: number } {
  const dx = target.x - center.x
  const dy = target.y - center.y
  if (dx === 0 && dy === 0) return center
  const halfW = Math.max(element.width / 2, 1)
  const halfH = Math.max(element.height / 2, 1)
  const scale = Math.min(halfW / Math.abs(dx || 1e-6), halfH / Math.abs(dy || 1e-6))
  return { x: center.x + dx * scale, y: center.y + dy * scale }
}

/** 元素移动后刷新所有吸附到它的连接线端点 */
export function refreshConnectors(elements: IWhiteboardElement[]): IWhiteboardElement[] {
  const byId = new Map(elements.map((el) => [el.id, el]))
  return elements.map((element) => {
    if (element.type !== 'connector') return element
    const from = element.fromId ? byId.get(element.fromId) : null
    const to = element.toId ? byId.get(element.toId) : null
    if (!from || !to) return element
    const anchors = connectorAnchors(from, to)
    return withConnectorBounds({ ...element, from: anchors.from, to: anchors.to })
  })
}

export function unionBounds(elements: IWhiteboardElement[]): IWhiteboardBounds | null {
  if (elements.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const element of elements) {
    minX = Math.min(minX, element.x)
    minY = Math.min(minY, element.y)
    maxX = Math.max(maxX, element.x + element.width)
    maxY = Math.max(maxY, element.y + element.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** 计算把全部内容放进视口的视口参数（演示与「适应视图」共用） */
export function fitViewport(
  elements: IWhiteboardElement[],
  width: number,
  height: number,
  padding = 48,
): IWhiteboardViewport {
  const bounds = unionBounds(elements)
  if (!bounds || bounds.width === 0 || bounds.height === 0)
    return { x: width / 2, y: height / 2, zoom: 1 }
  const zoom = Math.min(
    4,
    Math.max(0.1, Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height)),
  )
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  }
}

/** 文本宽度估算：用离屏 canvas 度量，编辑与导出共用同一套宽度 */
let measureContext: CanvasRenderingContext2D | null | undefined

export function measureText(text: string, fontSize: number): number {
  if (measureContext === undefined) {
    measureContext = document.createElement('canvas').getContext('2d')
  }
  if (!measureContext) return text.length * fontSize * 0.6
  measureContext.font = `${fontSize}px system-ui, sans-serif`
  return measureContext.measureText(text).width
}

/** 按内容收紧文本元素外框（输入时实时跟随） */
export function fitTextElement(element: IWhiteboardText): IWhiteboardText {
  const lines = wrapText(element.text, element.fontSize, Number.POSITIVE_INFINITY)
  const width = Math.max(24, ...lines.map((line) => measureText(line, element.fontSize)))
  return { ...element, width, height: Math.round(element.fontSize * 1.5 * lines.length) }
}

/** 按可用宽度逐字换行（中英文混排均可），空行保留 */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const char of paragraph) {
      const candidate = current + char
      if (current && measureText(candidate, fontSize) > maxWidth) {
        lines.push(current)
        current = char
      } else {
        current = candidate
      }
    }
    lines.push(current)
  }
  return lines
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/* ── 导出：SVG 序列化 → SVG 文件 / PNG 位图 ── */

/** 序列化画布 SVG：补上 xmlns 与显式尺寸，保证独立打开/转码时可用 */
export function serializeSvg(svg: SVGSVGElement, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  return new XMLSerializer().serializeToString(clone)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 导出 SVG 文件（矢量，可再编辑） */
export function exportSvg(svg: SVGSVGElement, filename: string): void {
  const rect = svg.getBoundingClientRect()
  const source = serializeSvg(svg, Math.round(rect.width), Math.round(rect.height))
  downloadBlob(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

/** 导出 PNG 位图：SVG → Image → canvas 2x 缩放，避免高分屏下发虚 */
export async function exportPng(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  const rect = svg.getBoundingClientRect()
  const source = serializeSvg(svg, Math.round(rect.width), Math.round(rect.height))
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('svg decode failed'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rect.width * scale))
    canvas.height = Math.max(1, Math.round(rect.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas 2d unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    await new Promise<void>((resolve) => canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename)
      resolve()
    }, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
