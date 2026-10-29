import dagre from 'dagre'
import type {
  ConnectorRouteMode, IWhiteboardBounds, IWhiteboardConnector, IWhiteboardElement, IWhiteboardPen,
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
    return fitTextElement({ ...element, stroke: style.stroke, fill: style.stroke, strokeWidth: style.strokeWidth, fontSize: style.fontSize })
  return { ...element, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth, fontSize: style.fontSize }
}

/* ── 自动布局：按连接关系排布图形节点（dagre） ── */

export type AutoLayoutDirection = 'LR' | 'TB'

export interface AutoLayoutOptions {
  direction: AutoLayoutDirection
  /** 同层节点间距 */
  nodeSep?: number
  /** 层间距 */
  rankSep?: number
}

/**
 * 自动布局：形状 / 文本按连接线关系重新排布，连接线端点自动跟随。
 * 画笔（手绘批注）保持原位，避免布局把涂鸦也搬走。
 */
export function layoutElements(
  elements: IWhiteboardElement[],
  options: AutoLayoutOptions,
): IWhiteboardElement[] {
  const nodes = elements.filter((element) => element.type !== 'connector' && element.type !== 'pen')
  if (nodes.length < 2) return elements

  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: options.direction,
    nodesep: options.nodeSep ?? 48,
    ranksep: options.rankSep ?? 80,
    marginx: 0,
    marginy: 0,
  })
  graph.setDefaultEdgeLabel(() => ({}))

  const nodeIds = new Set(nodes.map((element) => element.id))
  for (const node of nodes) {
    graph.setNode(node.id, { width: Math.max(node.width, 1), height: Math.max(node.height, 1) })
  }
  let edgeCount = 0
  for (const element of elements) {
    if (element.type !== 'connector') continue
    if (element.fromId && element.toId && nodeIds.has(element.fromId) && nodeIds.has(element.toId)) {
      graph.setEdge(element.fromId, element.toId)
      edgeCount += 1
    }
  }
  // 没有任何连接关系时不布局：避免把用户摆好的散图打乱
  if (edgeCount === 0) return elements

  dagre.layout(graph)

  const moved = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const position = graph.node(node.id)
    if (!position) continue
    moved.set(node.id, { x: position.x - node.width / 2, y: position.y - node.height / 2 })
  }

  return elements.map((element) => {
    const position = moved.get(element.id)
    return position ? { ...element, ...position } : element
  })
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
  if (element.type === 'connector') {
    // 连接线按折线路由就近判定：斜线的外接矩形很大，按矩形会把整块区域都算成线
    const threshold = Math.max(8, element.strokeWidth * 2)
    const points = element.route && element.route.length >= 4
      ? element.route
      : [element.from.x, element.from.y, element.to.x, element.to.y]
    for (let i = 0; i + 3 < points.length; i += 2) {
      if (distanceToSegment(x, y, points[i], points[i + 1], points[i + 2], points[i + 3]) <= threshold)
        return true
    }
    return false
  }
  return x >= element.x && x <= element.x + element.width
    && y >= element.y && y <= element.y + element.height
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
  return { from: borderPointToward(from, tc), to: borderPointToward(to, fc) }
}

export function centerOf(element: IWhiteboardElement): { x: number; y: number } {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 }
}

/** 连接线端点吸附半径（世界坐标）：落在方块附近即视为连接，容忍手抖 */
export const CONNECTOR_SNAP_RADIUS = 28

/** 点到矩形的最短距离（内部为 0） */
export function distanceToRect(element: IWhiteboardElement, x: number, y: number): number {
  const dx = Math.max(element.x - x, 0, x - (element.x + element.width))
  const dy = Math.max(element.y - y, 0, y - (element.y + element.height))
  return Math.hypot(dx, dy)
}

/**
 * 查找可吸附的目标元素：先精确命中，否则取「连接吸附距离」内的最近一个。
 * 距离只朝 toward 方向放宽（正在连的另一端），避免误吸到旁边无关的元素。
 */
export function findAttachTarget(
  elements: IWhiteboardElement[],
  x: number,
  y: number,
  toward?: { x: number; y: number },
): IWhiteboardElement | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i]
    if (element.type !== 'connector' && hitTest(element, x, y)) return element
  }
  let best: IWhiteboardElement | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i]
    if (element.type === 'connector') continue
    const distance = attachDistance(element, x, y, toward)
    if (distance <= CONNECTOR_SNAP_RADIUS && distance < bestDistance) {
      best = element
      bestDistance = distance
    }
  }
  return best
}

/** 连接吸附距离：朝 toward 一侧放宽半径，其余方向仍按矩形距离 */
function attachDistance(
  element: IWhiteboardElement,
  x: number,
  y: number,
  toward?: { x: number; y: number },
): number {
  if (!toward) return distanceToRect(element, x, y)
  const center = centerOf(element)
  const left = element.x - (toward.x < center.x ? CONNECTOR_SNAP_RADIUS : 0)
  const right = element.x + element.width + (toward.x > center.x ? CONNECTOR_SNAP_RADIUS : 0)
  const top = element.y - (toward.y < center.y ? CONNECTOR_SNAP_RADIUS : 0)
  const bottom = element.y + element.height + (toward.y > center.y ? CONNECTOR_SNAP_RADIUS : 0)
  const dx = Math.max(left - x, 0, x - right)
  const dy = Math.max(top - y, 0, y - bottom)
  return Math.hypot(dx, dy)
}

/** 元素边界上朝目标点一侧的交点（连接线端点吸附用） */
export function borderPointToward(element: IWhiteboardElement, target: { x: number; y: number }): { x: number; y: number } {
  const center = centerOf(element)
  const dx = target.x - center.x
  const dy = target.y - center.y
  if (dx === 0 && dy === 0) return center
  const halfW = Math.max(element.width / 2, 1)
  const halfH = Math.max(element.height / 2, 1)
  const scale = Math.min(halfW / Math.abs(dx || 1e-6), halfH / Math.abs(dy || 1e-6))
  return { x: center.x + dx * scale, y: center.y + dy * scale }
}

/**
 * 重算连接线两端：两端都吸到元素时取边界交点，只吸一端时该端朝另一端收，
 * 都没吸时保持自由端点。元素移动、端点拖拽后都走这里。
 */
export function resolveConnectorEnds(
  connector: IWhiteboardConnector,
  elements: IWhiteboardElement[],
): IWhiteboardConnector {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const from = connector.fromId ? byId.get(connector.fromId) ?? null : null
  const to = connector.toId ? byId.get(connector.toId) ?? null : null
  const next = { ...connector }
  // 方向点（松手位置 / 对方中心）确定落在边框哪一侧，再投影到边框上
  if (from && to) {
    next.from = borderPointToward(from, anchorTarget(from, connector.fromOffset, to))
    next.to = borderPointToward(to, anchorTarget(to, connector.toOffset, from))
  } else if (from) {
    next.from = borderPointToward(from, anchorTarget(from, connector.fromOffset, null, connector.to))
  } else if (to) {
    next.to = borderPointToward(to, anchorTarget(to, connector.toOffset, null, connector.from))
  }
  return withConnectorBounds(next)
}

/** 端点方向点：有偏移用松手时的相对位置，否则朝另一个被吸附元素的中心（稳定，不随操作顺序漂移） */
function anchorTarget(
  element: IWhiteboardElement,
  offset: { dx: number; dy: number } | undefined,
  otherElement: IWhiteboardElement | null,
  otherPoint?: { x: number; y: number },
): { x: number; y: number } {
  const center = centerOf(element)
  if (offset && (Math.abs(offset.dx) > 0.5 || Math.abs(offset.dy) > 0.5))
    return { x: center.x + offset.dx, y: center.y + offset.dy }
  if (otherElement) return centerOf(otherElement)
  return otherPoint ?? center
}

/** 记录端点相对元素中心的偏移：之后元素移动 / 缩放都按这个相对位置跟随 */
export function connectorOffset(
  element: IWhiteboardElement,
  point: { x: number; y: number },
): { dx: number; dy: number } {
  const center = centerOf(element)
  return { dx: point.x - center.x, dy: point.y - center.y }
}

/** 元素移动后刷新所有吸附到它的连接线端点，并重算折线路由 */
export function refreshConnectors(
  elements: IWhiteboardElement[],
  routeMode: ConnectorRouteMode = 'orthogonal',
): IWhiteboardElement[] {
  const resolved = elements.map((element) => (
    element.type === 'connector' ? resolveConnectorEnds(element, elements) : element
  ))
  // 同两端元素的多条连接线分组错开布线，避免完全重叠看不清
  const groupSizes = new Map<string, number>()
  for (const element of resolved) {
    if (element.type !== 'connector' || !element.fromId || !element.toId) continue
    const key = [element.fromId, element.toId].sort().join('|')
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return resolved.map((element) => {
    if (element.type !== 'connector') return element
    const key = element.fromId && element.toId
      ? [element.fromId, element.toId].sort().join('|')
      : element.id
    const index = seen.get(key) ?? 0
    seen.set(key, index + 1)
    return { ...element, route: connectorRoute(element, resolved, routeMode, index, groupSizes.get(key) ?? 1) }
  })
}

/** 端点出线方向：看端点贴在哪条边框上——左右边框水平出线，上下边框垂直出线 */
function exitDirection(element: IWhiteboardElement | null, point: { x: number; y: number }): 'h' | 'v' {
  if (!element) return 'h'
  const horizontal = Math.min(Math.abs(point.x - element.x), Math.abs(point.x - (element.x + element.width)))
  const vertical = Math.min(Math.abs(point.y - element.y), Math.abs(point.y - (element.y + element.height)))
  return vertical < horizontal ? 'v' : 'h'
}

/** 出线方向的单位向量（由端点相对元素中心的位置决定，保证朝外） */
function exitSign(element: IWhiteboardElement | null, point: { x: number; y: number }, axis: 'x' | 'y'): number {
  if (!element) return 1
  const center = centerOf(element)
  const delta = axis === 'x' ? point.x - center.x : point.y - center.y
  return delta === 0 ? 1 : Math.sign(delta)
}

/**
 * 连接线路由：正交折线（出线段 → 转向 → 入线段）或直线。
 * 同组多条线按 index 把中线错开，减少重叠；距离很近时直接走直线。
 */
export function connectorRoute(
  connector: IWhiteboardConnector,
  elements: IWhiteboardElement[],
  routeMode: ConnectorRouteMode = 'orthogonal',
  siblingIndex = 0,
  siblingCount = 1,
): number[] {
  const { from, to } = connector
  const straight = [from.x, from.y, to.x, to.y]
  if (routeMode === 'straight') return straight
  if (Math.hypot(to.x - from.x, to.y - from.y) < 48) return straight

  const byId = new Map(elements.map((element) => [element.id, element]))
  const fromElement = connector.fromId ? byId.get(connector.fromId) ?? null : null
  const toElement = connector.toId ? byId.get(connector.toId) ?? null : null
  const fromDir = exitDirection(fromElement, from)
  const toDir = exitDirection(toElement, to)
  const stub = Math.max(16, Math.min(40, Math.hypot(to.x - from.x, to.y - from.y) / 5))

  const p1 = fromDir === 'h'
    ? { x: from.x + exitSign(fromElement, from, 'x') * stub, y: from.y }
    : { x: from.x, y: from.y + exitSign(fromElement, from, 'y') * stub }
  // 终点侧的出线段同样朝外（远离被吸附元素），否则会插进方块里再折回
  const p3 = toDir === 'h'
    ? { x: to.x + exitSign(toElement, to, 'x') * stub, y: to.y }
    : { x: to.x, y: to.y + exitSign(toElement, to, 'y') * stub }

  // 同组连线把中线扇开，避免多条线糊成一条
  const fan = (siblingIndex - (siblingCount - 1) / 2) * 20

  let points: { x: number; y: number }[]
  if (fromDir === 'h' && toDir === 'h') {
    const midX = (p1.x + p3.x) / 2 + fan
    points = [from, p1, { x: midX, y: p1.y }, { x: midX, y: p3.y }, p3, to]
  } else if (fromDir === 'v' && toDir === 'v') {
    const midY = (p1.y + p3.y) / 2 + fan
    points = [from, p1, { x: p1.x, y: midY }, { x: p3.x, y: midY }, p3, to]
  } else if (fromDir === 'h') {
    points = [from, p1, { x: p1.x, y: p3.y }, p3, to]
  } else {
    points = [from, p1, { x: p3.x, y: p1.y }, p3, to]
  }

  const flattened: number[] = []
  for (const point of points) {
    const lastX = flattened[flattened.length - 2]
    const lastY = flattened[flattened.length - 1]
    if (flattened.length >= 2 && Math.hypot(point.x - lastX, point.y - lastY) < 1) continue
    flattened.push(point.x, point.y)
  }
  return flattened
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

/** 按可用宽度逐字换行（中英文混排均可），空行保留 */export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
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

/* ── 列表缩略图：把场景渲染成一张独立的矢量小图 ── */

/** 缩略图画布尺寸（宽高比 3:2，适合卡片） */
const THUMB_WIDTH = 300
const THUMB_HEIGHT = 200

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成画板缩略图 SVG 字符串：按内容边界适配进 300x200，供列表卡片 <img> 使用。
 * 空画板返回 null（卡片显示占位图标）。
 */
export function renderThumbnailSvg(elements: IWhiteboardElement[]): string | null {
  const bounds = unionBounds(elements)
  if (!bounds || (bounds.width < 1 && bounds.height < 1)) return null

  const padding = 12
  const zoom = Math.min(
    (THUMB_WIDTH - padding * 2) / Math.max(bounds.width, 1),
    (THUMB_HEIGHT - padding * 2) / Math.max(bounds.height, 1),
  )
  const offsetX = (THUMB_WIDTH - bounds.width * zoom) / 2 - bounds.x * zoom
  const offsetY = (THUMB_HEIGHT - bounds.height * zoom) / 2 - bounds.y * zoom
  const transform = `translate(${offsetX.toFixed(2)},${offsetY.toFixed(2)}) scale(${zoom.toFixed(4)})`

  const parts: string[] = []
  for (const element of elements) {
    const stroke = escapeXml(element.stroke)
    const strokeWidth = Math.max(0.5, element.strokeWidth / zoom).toFixed(2)
    if (element.type === 'rect') {
      parts.push(`<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="6" fill="${escapeXml(element.fill)}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`)
      if (element.text) parts.push(textSvg(element, zoom, escapeXml))
    } else if (element.type === 'ellipse') {
      parts.push(`<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" fill="${escapeXml(element.fill)}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`)
      if (element.text) parts.push(textSvg(element, zoom, escapeXml))
    } else if (element.type === 'diamond') {
      const cx = element.x + element.width / 2
      const cy = element.y + element.height / 2
      const points = `${element.x},${cy} ${cx},${element.y} ${element.x + element.width},${cy} ${cx},${element.y + element.height}`
      parts.push(`<polygon points="${points}" fill="${escapeXml(element.fill)}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`)
      if (element.text) parts.push(textSvg(element, zoom, escapeXml))
    } else if (element.type === 'text') {
      if (element.text) parts.push(textSvg(element, zoom, escapeXml))
    } else if (element.type === 'pen') {
      parts.push(`<polyline points="${element.points.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`)
    } else if (element.type === 'connector') {
      const points = element.route && element.route.length >= 4 ? element.route : [element.from.x, element.from.y, element.to.x, element.to.y]
      parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`)
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" viewBox="0 0 ${THUMB_WIDTH} ${THUMB_HEIGHT}"><rect width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" fill="#f8fafc"/><g transform="${transform}">${parts.join('')}</g></svg>`
}

/** 元素内文字：居中排布，字号按缩略图缩放归算保持可读 */
function textSvg(element: IWhiteboardShape | IWhiteboardText, zoom: number, escape: (value: string) => string): string {
  const fontSize = element.fontSize
  const lines = wrapText(element.text, fontSize, element.type === 'text' ? Number.POSITIVE_INFINITY : Math.max(10, element.width - 16))
  const lineHeight = fontSize * 1.4
  const startY = element.y + element.height / 2 - (lineHeight * lines.length) / 2 + fontSize * 0.85
  const anchor = element.type === 'text' ? 'start' : 'middle'
  const x = element.type === 'text' ? element.x : element.x + element.width / 2
  const fill = element.type === 'text' ? element.fill : element.stroke
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" y="${startY + lineHeight * index}">${escape(line)}</tspan>`)
    .join('')
  void zoom
  return `<text font-family="system-ui, sans-serif" font-size="${fontSize}" fill="${escape(fill)}" text-anchor="${anchor}">${tspans}</text>`
}

/** 把 SVG 字符串转成 <img> 可用的 data URL */
export function thumbnailDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
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
