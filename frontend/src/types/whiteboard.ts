/** 白板工具：选择 / 平移 / 形状 / 文本 / 画笔 / 连接线 / 橡皮 */
export type WhiteboardTool =
  | 'select' | 'pan' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'pen' | 'connector' | 'eraser'

/** 可绘制形状（架构图节点） */
export type WhiteboardShapeType = 'rect' | 'ellipse' | 'diamond'

/** 所有元素共用的外接矩形（世界坐标；画笔 / 连接线由内容推导） */
export interface IWhiteboardBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 形状元素：可带说明文字（架构图节点） */
export interface IWhiteboardShape extends IWhiteboardBounds {
  id: string
  type: WhiteboardShapeType
  text: string
  fontSize: number
  stroke: string
  fill: string
  strokeWidth: number
}

/** 文本元素 */
export interface IWhiteboardText extends IWhiteboardBounds {
  id: string
  type: 'text'
  text: string
  fontSize: number
  stroke: string
  fill: string
  strokeWidth: number
}

/** 自由绘制：折线点序列（世界坐标，[x0,y0,x1,y1,…]） */
export interface IWhiteboardPen extends IWhiteboardBounds {
  id: string
  type: 'pen'
  points: number[]
  stroke: string
  fill: string
  strokeWidth: number
}

/** 连接线：两端优先吸附到形状，自由绘制时端点为绝对坐标 */
export interface IWhiteboardConnector extends IWhiteboardBounds {
  id: string
  type: 'connector'
  fromId: string | null
  toId: string | null
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** 端点到被吸附元素中心的相对偏移：决定端点落在边框哪个方向，元素移动时跟随；缺省时朝另一端 */
  fromOffset?: { dx: number; dy: number }
  toOffset?: { dx: number; dy: number }
  label: string
  fontSize: number
  stroke: string
  fill: string
  strokeWidth: number
}

export type IWhiteboardElement =
  | IWhiteboardShape | IWhiteboardText | IWhiteboardPen | IWhiteboardConnector

/** 视口：屏幕 = 世界 × zoom + 平移量 */
export interface IWhiteboardViewport {
  x: number
  y: number
  zoom: number
}

export interface IWhiteboardScene {
  elements: IWhiteboardElement[]
  viewport: IWhiteboardViewport
}

/** 新建元素使用的默认样式 */
export interface IWhiteboardStyle {
  stroke: string
  fill: string
  strokeWidth: number
  fontSize: number
}

/** 画板（场景以后端返回的原始 JSON 字符串传递） */
export interface IWhiteboard {
  id: string
  name: string
  scene: string
  createdAt: string
  updatedAt: string
}

/** 画板列表项（不含场景正文） */
export interface IWhiteboardListItem {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface IWhiteboardSubmit {
  name: string
  scene?: string
}

/** 画布命令式操作：页面快捷键与工具栏通过 ref 调用 */
export interface WhiteboardCanvasHandle {
  deleteSelection(): void
  duplicateSelection(): void
  nudgeSelection(dx: number, dy: number): void
  /** 层级调整：toFront=true 置顶，false 置底 */
  reorderSelection(toFront: boolean): void
  selectAll(): void
}
