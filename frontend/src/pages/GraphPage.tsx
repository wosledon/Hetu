import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Network,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  Lightbulb,
  Code,
  Building,
  Brain,
  Box,
  Tag,
  Loader2,
  Check,
  FolderOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ThemedMarkdown from '../components/ThemedMarkdown'
import { graphService } from '../services/graphService'
import { noteService } from '../services/noteService'
import { notebookService } from '../services/notebookService'
import i18n from '../i18n'
import type { IGraphEntity, IGraphRelation, INote, IExtractGraphResult } from '../types'

const ENTITY_COLORS: Record<string, string> = {
  concept: '#6366f1',
  person: '#10b981',
  organization: '#f59e0b',
  technology: '#3b82f6',
  project: '#ef4444',
  custom: '#8b5cf6',
}

const RELATION_LABEL_KEYS: Record<string, string> = {
  belong_to: 'knowledge:graph.relationTypes.belongTo',
  related_to: 'knowledge:graph.relationTypes.relatedTo',
  depends_on: 'knowledge:graph.relationTypes.dependsOn',
  contains: 'knowledge:graph.relationTypes.contains',
  compared_with: 'knowledge:graph.relationTypes.comparedWith',
  custom: 'knowledge:graph.relationTypes.custom',
}

const ENTITY_TYPE_LABEL_KEYS: Record<string, string> = {
  concept: 'knowledge:graph.entityTypes.concept',
  person: 'knowledge:graph.entityTypes.person',
  organization: 'knowledge:graph.entityTypes.organization',
  technology: 'knowledge:graph.entityTypes.technology',
  project: 'knowledge:graph.entityTypes.project',
  custom: 'knowledge:graph.entityTypes.custom',
}

const relationLabel = (type: string): string => {
  const key = RELATION_LABEL_KEYS[type]
  return key ? i18n.t(key) : type
}

const entityTypeLabel = (type: string): string => {
  const key = ENTITY_TYPE_LABEL_KEYS[type]
  return key ? i18n.t(key) : type
}

const ENTITY_ICONS: Record<string, React.ElementType> = {
  concept: Lightbulb,
  technology: Code,
  tech: Code,
  organization: Building,
  person: Brain,
  project: Box,
  custom: Tag,
}

interface NodePosition {
  id: string
  x: number
  y: number
  vx: number
  vy: number
}

interface DragState { id: string | null; x: number; y: number }

// Obsidian 风格：节点半径按连接数增长，但整体保持小巧
const nodeRadius = (e: IGraphEntity) => Math.min(14, 4.5 + Math.sqrt(Math.max(0, e.relationCount)) * 2.4)

const hexToRgb = (hex: string) => {
  const v = (s: string) => { const n = parseInt(s, 16); return Number.isNaN(n) ? 0 : n }
  return { r: v(hex.slice(1, 3)), g: v(hex.slice(3, 5)), b: v(hex.slice(5, 7)) }
}

// --- Force-directed layout hook (unchanged physics, same throttling) ---
function useForceLayout(
  entities: IGraphEntity[],
  relations: IGraphRelation[],
  width: number,
  height: number,
  layoutKey: number,
  dragRef: React.RefObject<DragState>,
  wakeKey: number,
  onSettle?: (nodes: NodePosition[]) => void,
) {
  const [positions, setPositions] = useState<NodePosition[]>([])
  const positionsRef = useRef<NodePosition[]>([])
  const frameRef = useRef<number>(0)
  const initializedRef = useRef(false)
  const prevLayoutKeyRef = useRef(layoutKey)
  const onSettleRef = useRef(onSettle)
  useEffect(() => { onSettleRef.current = onSettle })

  useEffect(() => {
    if (entities.length === 0) {
      positionsRef.current = []
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPositions((prev) => (prev.length === 0 ? prev : []))
      initializedRef.current = false
      return
    }

    // 当 layoutKey 变化时，重新初始化布局
    if (prevLayoutKeyRef.current !== layoutKey) {
      initializedRef.current = false
      prevLayoutKeyRef.current = layoutKey
    }

    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) * 0.3

    let nodes: NodePosition[]
    if (!initializedRef.current) {
      nodes = entities.map((e, i) => {
        const angle = (2 * Math.PI * i) / entities.length
        return {
          id: e.id,
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
          vx: 0,
          vy: 0,
        }
      })
      initializedRef.current = true
    } else {
      const existing = new Map(positionsRef.current.map(p => [p.id, p]))
      nodes = entities.map((e) => {
        const prev = existing.get(e.id)
        if (prev) return { ...prev }
        const angle = Math.random() * 2 * Math.PI
        return {
          id: e.id,
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
          vx: 0,
          vy: 0,
        }
      })
    }

    // 拖拽中的节点：以最新拖拽坐标为准
    if (dragRef.current.id) {
      const dragNode = nodes.find(n => n.id === dragRef.current.id)
      if (dragNode) { dragNode.x = dragRef.current.x; dragNode.y = dragRef.current.y }
    }

    let iteration = 0
    let alpha = 1
    // 根据节点数量动态调整迭代次数和节流间隔
    const nodeCount = nodes.length
    const maxIterations = Math.max(200, nodeCount > 100 ? 260 : 320)
    const THROTTLE_INTERVAL = nodeCount > 100 ? 8 : 4
    // d3-force 式冷却：力随 alpha 衰减，布局平滑收敛而非生硬停摆
    const alphaDecay = 1 - Math.pow(0.001, 1 / maxIterations)
    const velocityDecay = 0.6

    const simulate = () => {
      if (iteration >= maxIterations || alpha < 0.015) {
        onSettleRef.current?.(nodes)
        return
      }

      const repulsion = 4200
      const attraction = 0.02
      const centerPull = 0.02

      // Pre-build node map for O(1) lookups during relation processing
      const nodeMap = new Map<string, NodePosition>()
      for (const n of nodes) nodeMap.set(n.id, n)

      // 优化：使用网格分割近似计算排斥力（Barnes-Hut 简化版）
      // 对于大量节点，远处节点的影响可以近似处理
      const gridSize = 200
      const grid = new Map<string, NodePosition[]>()
      
      for (const node of nodes) {
        const gx = Math.floor(node.x / gridSize)
        const gy = Math.floor(node.y / gridSize)
        const key = `${gx},${gy}`
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key)!.push(node)
      }

      for (let i = 0; i < nodes.length; i++) {
        let fx = 0, fy = 0
        const node = nodes[i]
        const gx = Math.floor(node.x / gridSize)
        const gy = Math.floor(node.y / gridSize)

        // 只计算周围 3x3 网格内的排斥力
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = `${gx + dx},${gy + dy}`
            const cellNodes = grid.get(key)
            if (!cellNodes) continue

            for (const other of cellNodes) {
              if (other === node) continue
              const ddx = node.x - other.x
              const ddy = node.y - other.y
              const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1
              const force = repulsion / (dist * dist)
              fx += (ddx / dist) * force
              fy += (ddy / dist) * force
            }
          }
        }

        fx += (cx - node.x) * centerPull
        fy += (cy - node.y) * centerPull
        fx *= alpha
        fy *= alpha

        node.vx = (node.vx + fx) * velocityDecay
        node.vy = (node.vy + fy) * velocityDecay
      }

      for (const rel of relations) {
        const source = nodeMap.get(rel.sourceEntityId)
        const target = nodeMap.get(rel.targetEntityId)
        if (!source || !target) continue

        const dx = target.x - source.x
        const dy = target.y - source.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = dist * attraction * alpha

        source.vx += (dx / dist) * force
        source.vy += (dy / dist) * force
        target.vx -= (dx / dist) * force
        target.vy -= (dy / dist) * force
      }

      for (const node of nodes) {
        if (dragRef.current.id === node.id) {
          node.x = dragRef.current.x; node.y = dragRef.current.y
          node.vx = 0; node.vy = 0
          continue
        }
        node.x += node.vx
        node.y += node.vy
        node.x = Math.max(40, Math.min(width - 40, node.x))
        node.y = Math.max(40, Math.min(height - 40, node.y))
      }

      iteration++
      alpha += alphaDecay * (0 - alpha)
      positionsRef.current = nodes

      // Throttle React state updates: every THROTTLE_INTERVAL iterations + always on last
      if (iteration % THROTTLE_INTERVAL === 0 || iteration >= maxIterations) {
        setPositions([...nodes])
      }

      if (iteration < maxIterations) {
        frameRef.current = requestAnimationFrame(simulate)
      }
    }

    frameRef.current = requestAnimationFrame(simulate)
    return () => cancelAnimationFrame(frameRef.current)
  }, [entities, relations, width, height, layoutKey, wakeKey, dragRef])

  const setNodePosition = useCallback((id: string, x: number, y: number) => {
    const p = positionsRef.current.find(n => n.id === id)
    if (p) { p.x = x; p.y = y; p.vx = 0; p.vy = 0 }
  }, [])

  return { positions, setNodePosition }
}

// --- Canvas renderer hook: draws graph directly on <canvas> via requestAnimationFrame ---
interface CanvasRendererOptions {
  zoom: number
  pan: { x: number; y: number }
  selectedEntityId: string | null
  externalHoverId: string | null
  onSelectEntity: (id: string) => void
  onDeleteRelation: (id: string) => void
  onDeselect: () => void
  onPanChange: (pan: { x: number; y: number }) => void
  onZoomChange: (zoom: number) => void
  onWakeSimulation: () => void
  setNodePosition: (id: string, x: number, y: number) => void
  dragRef: React.RefObject<DragState>
}

function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  entities: IGraphEntity[],
  relations: IGraphRelation[],
  positions: NodePosition[],
  options: CanvasRendererOptions,
) {
  const { zoom, pan, selectedEntityId, onSelectEntity, onDeleteRelation, onDeselect, onPanChange, onZoomChange, onWakeSimulation, setNodePosition, externalHoverId } = options
  const animationRef = useRef<number>(0)
  const hoveredIdRef = useRef<string | null>(null)
  const externalHoverRef = useRef(externalHoverId)
  useEffect(() => { externalHoverRef.current = externalHoverId }, [externalHoverId])

  // 平滑显示变换：逻辑值由 props 驱动，展示值逐帧收敛/补间，缩放与平移更顺滑
  const dispZoomRef = useRef(zoom)
  const dispPanRef = useRef(pan)
  const animRef = useRef<{
    t0: number; dur: number
    fromPan: { x: number; y: number }; fromZoom: number
    toPan: { x: number; y: number }; toZoom: number
  } | null>(null)

  // Keep refs in sync with latest props for the render loop (avoids stale closures)
  const posMapRef = useRef<Map<string, NodePosition>>(new Map())
  useEffect(() => { posMapRef.current = new Map(positions.map(p => [p.id, p])) }, [positions])

  const entityMapRef = useRef<Map<string, IGraphEntity>>(new Map())
  useEffect(() => { entityMapRef.current = new Map(entities.map(e => [e.id, e])) }, [entities])

  const relationsRef = useRef(relations)
  useEffect(() => { relationsRef.current = relations }, [relations])

  const zoomRef = useRef(zoom), panRef = useRef(pan), selectedRef = useRef(selectedEntityId)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { selectedRef.current = selectedEntityId }, [selectedEntityId])

  const callbacksRef = useRef({ onSelectEntity, onDeleteRelation, onDeselect, onPanChange, onZoomChange, onWakeSimulation, setNodePosition })
  useEffect(() => { callbacksRef.current = { onSelectEntity, onDeleteRelation, onDeselect, onPanChange, onZoomChange, onWakeSimulation, setNodePosition } })

  // --- Render loop ---
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      // Always keep canvas buffer in sync with CSS layout
      const targetW = Math.round(rect.width * dpr)
      const targetH = Math.round(rect.height * dpr)
      if (rect.width > 0 && rect.height > 0 && (canvas.width !== targetW || canvas.height !== targetH)) {
        canvas.width = targetW
        canvas.height = targetH
      }
      const w = canvas.width / dpr, h = canvas.height / dpr
      // 展示变换：补间动画优先，否则向逻辑值收敛
      const anim = animRef.current
      if (anim) {
        const t = Math.min(1, (performance.now() - anim.t0) / anim.dur)
        const e = 1 - Math.pow(1 - t, 3)
        dispPanRef.current = {
          x: anim.fromPan.x + (anim.toPan.x - anim.fromPan.x) * e,
          y: anim.fromPan.y + (anim.toPan.y - anim.fromPan.y) * e,
        }
        dispZoomRef.current = anim.fromZoom + (anim.toZoom - anim.fromZoom) * e
        if (t >= 1) animRef.current = null
      } else {
        dispZoomRef.current += (zoomRef.current - dispZoomRef.current) * 0.22
        dispPanRef.current.x += (panRef.current.x - dispPanRef.current.x) * 0.22
        dispPanRef.current.y += (panRef.current.y - dispPanRef.current.y) * 0.22
      }
      const z = dispZoomRef.current, p = dispPanRef.current
      const selId = selectedRef.current
      const posMap = posMapRef.current, emap = entityMapRef.current, rels = relationsRef.current

      ctx.save()
      ctx.clearRect(0, 0, w, h)
      if (posMap.size === 0) { ctx.restore(); animationRef.current = requestAnimationFrame(draw); return }

      ctx.translate(p.x, p.y)
      ctx.scale(z, z)

      const isDark = document.documentElement.classList.contains('dark')

      // 悬停高亮（画布内悬停优先，其次侧栏联动）：计算邻居集合，其余节点/连线淡化
      const hovered = hoveredIdRef.current ?? externalHoverRef.current
      const hoverSet = new Set<string>()
      if (hovered) {
        hoverSet.add(hovered)
        for (const rel of rels) {
          if (rel.sourceEntityId === hovered) hoverSet.add(rel.targetEntityId)
          if (rel.targetEntityId === hovered) hoverSet.add(rel.sourceEntityId)
        }
      }

      // --- Draw relations:细线、微弯、无箭头无文字标签（Obsidian 风格） ---
      for (const rel of rels) {
        const src = posMap.get(rel.sourceEntityId), tgt = posMap.get(rel.targetEntityId)
        if (!src || !tgt) continue
        const sEnt = emap.get(rel.sourceEntityId), tEnt = emap.get(rel.targetEntityId)
        const sR = sEnt ? nodeRadius(sEnt) : 5
        const tR = tEnt ? nodeRadius(tEnt) : 5
        const dx = tgt.x - src.x, dy = tgt.y - src.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const ux = dx / dist, uy = dy / dist
        const x1 = src.x + ux * sR, y1 = src.y + uy * sR
        const x2 = tgt.x - ux * (tR + 2), y2 = tgt.y - uy * (tR + 2)

        // 轻微弯曲，避免直线网格感
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
        const nx = -(y2 - y1), ny = (x2 - x1)
        const nl = Math.sqrt(nx * nx + ny * ny) || 1
        const bend = Math.min(28, dist * 0.07)
        const cx = mx + (nx / nl) * bend, cy = my + (ny / nl) * bend

        const touched = hovered !== null && (rel.sourceEntityId === hovered || rel.targetEntityId === hovered)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.quadraticCurveTo(cx, cy, x2, y2)
        if (touched) {
          ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.6)' : 'rgba(100,116,139,0.6)'
          ctx.lineWidth = 1.4 / z
        } else if (hovered) {
          ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.05)' : 'rgba(148,163,184,0.07)'
          ctx.lineWidth = 1 / z
        } else {
          ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.32)'
          ctx.lineWidth = 1 / z
        }
        ctx.stroke()
      }

      // --- Draw entities:小圆点 + 柔光晕 ---
      for (const entity of entities) {
        const pos = posMap.get(entity.id); if (!pos) continue
        const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.custom
        const rgb = hexToRgb(color)
        const isSel = selId === entity.id
        const isHov = hovered === entity.id
        const isNeighbor = hovered !== null && !isHov && hoverSet.has(entity.id)
        const dimmed = hovered !== null && !hoverSet.has(entity.id)
        const r = nodeRadius(entity)
        const rr = isSel || isHov ? r * 1.2 : r

        ctx.save()
        if (dimmed) ctx.globalAlpha = 0.18

        // 柔光晕
        const halo = ctx.createRadialGradient(pos.x, pos.y, rr * 0.9, pos.x, pos.y, rr * 2.8)
        const haloAlpha = isSel || isHov ? 0.5 : isNeighbor ? 0.4 : 0.26
        halo.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${haloAlpha})`)
        halo.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
        ctx.fillStyle = halo
        ctx.beginPath(); ctx.arc(pos.x, pos.y, rr * 2.8, 0, Math.PI * 2); ctx.fill()

        // 核心圆点：纯色填充，选中/悬停/邻居加描边
        ctx.beginPath(); ctx.arc(pos.x, pos.y, rr, 0, Math.PI * 2)
        ctx.fillStyle = color; ctx.fill()
        if (isSel || isHov || isNeighbor) {
          ctx.lineWidth = (isSel || isHov ? 2 : 1.2) / z
          ctx.strokeStyle = isDark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.95)'
          ctx.stroke()
        }
        ctx.restore()
      }

      // --- Labels:节点下方完整名称，防重叠剔除（悬停/选中/高度数节点优先） ---
      const labelCandidates: { entity: IGraphEntity; pos: NodePosition; rr: number; isSel: boolean; isHov: boolean }[] = []
      for (const entity of entities) {
        const pos = posMap.get(entity.id); if (!pos) continue
        const isSel = selId === entity.id
        const isHov = hovered === entity.id
        const dimmed = hovered !== null && !hoverSet.has(entity.id)
        if (dimmed) continue
        if (!(z >= 0.45 || isSel || isHov)) continue
        const r = nodeRadius(entity)
        const rr = isSel || isHov ? r * 1.2 : r
        labelCandidates.push({ entity, pos, rr, isSel, isHov })
      }
      labelCandidates.sort((a, b) => {
        const wa = (a.isSel ? 2 : 0) + (a.isHov ? 2 : 0) + a.entity.relationCount / 100
        const wb = (b.isSel ? 2 : 0) + (b.isHov ? 2 : 0) + b.entity.relationCount / 100
        return wb - wa
      })
      const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
      for (const c of labelCandidates) {
        const fsc = Math.max(10, 11.5 / z)
        ctx.font = `${c.isSel || c.isHov ? 600 : 400} ${fsc}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`
        const tw = ctx.measureText(c.entity.name).width * z
        const sx = c.pos.x * z + p.x, sy = c.pos.y * z + p.y
        const ly = sy + c.rr * z + 5
        const lh = fsc * z
        const rect = { x1: sx - tw / 2 - 3, x2: sx + tw / 2 + 3, y1: ly - 2, y2: ly + lh + 2 }
        if (!c.isSel && !c.isHov && placed.some(r => r.x1 < rect.x2 && r.x2 > rect.x1 && r.y1 < rect.y2 && r.y2 > rect.y1)) continue
        placed.push(rect)

        ctx.textAlign = 'center'; ctx.textBaseline = 'top'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3 / z
        ctx.strokeStyle = isDark ? 'rgba(2,6,23,0.85)' : 'rgba(248,250,252,0.9)'
        ctx.strokeText(c.entity.name, c.pos.x, c.pos.y + c.rr + 5 / z)
        ctx.fillStyle = isDark ? 'rgba(226,232,240,0.95)' : 'rgba(51,65,85,0.95)'
        ctx.fillText(c.entity.name, c.pos.x, c.pos.y + c.rr + 5 / z)
      }

      ctx.restore()
      animationRef.current = requestAnimationFrame(draw)
    }
    animationRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animationRef.current)
  }, [canvasRef, entities])

  // --- Resize observer ---
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr)
        const ctx = canvas.getContext('2d'); if (ctx) ctx.scale(dpr, dpr)
      }
    }
    resize()
    const obs = new ResizeObserver(resize); obs.observe(canvas)
    return () => obs.disconnect()
  }, [canvasRef, entities.length])

  // --- Mouse interaction (hit-test, pan, zoom, drag node, hover highlight) ---
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const drag = options.dragRef
    let mode: 'none' | 'pan' | 'node' = 'none'
    let moved = false
    let startCX = 0, startCY = 0
    let startPanX = 0, startPanY = 0
    let dragId: string | null = null
    let dragOX = 0, dragOY = 0

    const toGraph = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const z = dispZoomRef.current, p = dispPanRef.current
      return { x: (clientX - rect.left - p.x) / z, y: (clientY - rect.top - p.y) / z }
    }

    const hitTest = (sx: number, sy: number): { entity?: string; relation?: string } => {
      const z = dispZoomRef.current, p = dispPanRef.current
      const rect = canvas.getBoundingClientRect()
      const x = (sx - rect.left - p.x) / z, y = (sy - rect.top - p.y) / z

      for (const entity of entities) {
        const pos = posMapRef.current.get(entity.id); if (!pos) continue
        const r = nodeRadius(entity) + 3 / z
        if ((x - pos.x) ** 2 + (y - pos.y) ** 2 <= r * r) return { entity: entity.id }
      }
      for (const rel of relationsRef.current) {
        const src = posMapRef.current.get(rel.sourceEntityId), tgt = posMapRef.current.get(rel.targetEntityId)
        if (!src || !tgt) continue
        const sEnt = entityMapRef.current.get(rel.sourceEntityId), tEnt = entityMapRef.current.get(rel.targetEntityId)
        const sR = sEnt ? nodeRadius(sEnt) : 5
        const tR = tEnt ? nodeRadius(tEnt) : 5
        const dx = tgt.x - src.x, dy = tgt.y - src.y, dist = Math.sqrt(dx * dx + dy * dy); if (dist < 1) continue
        const ux = dx / dist, uy = dy / dist
        const x1 = src.x + ux * sR, y1 = src.y + uy * sR, x2 = tgt.x - ux * (tR + 2), y2 = tgt.y - uy * (tR + 2)
        const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2; if (len2 < 1) continue
        const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / len2))
        const px = x1 + t * (x2 - x1), py = y1 + t * (y2 - y1)
        if (Math.sqrt((x - px) ** 2 + (y - py) ** 2) < 8 / z) return { relation: rel.id }
      }
      return {}
    }

    const onMove = (e: MouseEvent) => {
      if (mode !== 'none') { canvas.style.cursor = 'grabbing'; return }
      const hit = hitTest(e.clientX, e.clientY)
      hoveredIdRef.current = hit.entity ?? null
      canvas.style.cursor = (hit.entity || hit.relation) ? 'pointer' : 'grab'
    }

    const onLeave = () => { hoveredIdRef.current = null }

    const onWinMove = (e: MouseEvent) => {
      if (mode === 'none') return
      if (Math.abs(e.clientX - startCX) > 3 || Math.abs(e.clientY - startCY) > 3) moved = true
      if (mode === 'pan') {
        callbacksRef.current.onPanChange({ x: startPanX + e.clientX - startCX, y: startPanY + e.clientY - startCY })
      } else if (mode === 'node' && dragId) {
        const g = toGraph(e.clientX, e.clientY)
        const x = g.x - dragOX, y = g.y - dragOY
        const pos = posMapRef.current.get(dragId)
        if (pos) { pos.x = x; pos.y = y }
        drag.current = { id: dragId, x, y }
        callbacksRef.current.setNodePosition(dragId, x, y)
      }
    }

    const onWinUp = () => {
      if (mode === 'node' && dragId) {
        drag.current = { id: null, x: 0, y: 0 }
        callbacksRef.current.onWakeSimulation()
      }
      mode = 'none'; dragId = null
    }

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      moved = false
      startCX = e.clientX; startCY = e.clientY
      const hit = hitTest(e.clientX, e.clientY)
      if (hit.entity) {
        mode = 'node'; dragId = hit.entity
        const pos = posMapRef.current.get(hit.entity)
        const g = toGraph(e.clientX, e.clientY)
        dragOX = pos ? g.x - pos.x : 0
        dragOY = pos ? g.y - pos.y : 0
        if (pos) drag.current = { id: hit.entity, x: pos.x, y: pos.y }
      } else {
        mode = 'pan'
        startPanX = panRef.current.x; startPanY = panRef.current.y
      }
    }

    const onClick = (e: MouseEvent) => {
      if (moved) { moved = false; return }
      const hit = hitTest(e.clientX, e.clientY)
      if (hit.entity) callbacksRef.current.onSelectEntity(hit.entity)
      else if (hit.relation) callbacksRef.current.onDeleteRelation(hit.relation)
      else callbacksRef.current.onDeselect()
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      animRef.current = null
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const cz = zoomRef.current, cp = panRef.current
      const nz = Math.max(0.3, Math.min(3, cz * (e.deltaY > 0 ? 0.9 : 1.1)))
      const s = nz / cz
      callbacksRef.current.onZoomChange(nz)
      callbacksRef.current.onPanChange({ x: mx - (mx - cp.x) * s, y: my - (my - cp.y) * s })
    }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('mousemove', onWinMove)
    window.addEventListener('mouseup', onWinUp)
    return () => {
      canvas.removeEventListener('mousedown', onDown); canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      canvas.removeEventListener('click', onClick); canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('mousemove', onWinMove)
      window.removeEventListener('mouseup', onWinUp)
    }
  }, [canvasRef, entities, options.dragRef])

  // 平滑地将视图居中到指定实体（从侧栏/详情跳转时用）
  const centerOnEntity = useCallback((id: string) => {
    const pos = posMapRef.current.get(id)
    const canvas = canvasRef.current
    if (!pos || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const z = Math.max(0.3, Math.min(1.5, dispZoomRef.current))
    const toPan = { x: rect.width / 2 - pos.x * z, y: rect.height / 2 - pos.y * z }
    animRef.current = {
      t0: performance.now(),
      dur: 450,
      fromPan: { ...dispPanRef.current },
      fromZoom: dispZoomRef.current,
      toPan,
      toZoom: z,
    }
    // 同步逻辑态，避免动画结束后显示值向旧逻辑值漂移
    callbacksRef.current.onPanChange(toPan)
    callbacksRef.current.onZoomChange(z)
  }, [canvasRef])

  // 平滑地将整幅图谱适配进视口（首次布局收敛后用）
  const fitToNodes = useCallback((nodes: NodePosition[]) => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return
    const rect = canvas.getBoundingClientRect()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x)
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y)
    }
    const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1)
    const pad = 70
    const z = Math.max(0.3, Math.min(1.5, Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh)))
    const toPan = { x: rect.width / 2 - ((minX + maxX) / 2) * z, y: rect.height / 2 - ((minY + maxY) / 2) * z }
    animRef.current = {
      t0: performance.now(),
      dur: 600,
      fromPan: { ...dispPanRef.current },
      fromZoom: dispZoomRef.current,
      toPan,
      toZoom: z,
    }
    callbacksRef.current.onPanChange(toPan)
    callbacksRef.current.onZoomChange(z)
  }, [canvasRef])

  return { centerOnEntity, fitToNodes }
}

export default function GraphPage() {
  const { t } = useTranslation('knowledge')
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [entitySearch, setEntitySearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showExtractDialog, setShowExtractDialog] = useState(false)
  const [extractSearch, setExtractSearch] = useState('')
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set())
  const [extractResults, setExtractResults] = useState<Map<string, IExtractGraphResult | { error: string }>>(new Map())
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractQueued, setExtractQueued] = useState<string | null>(null)
  const [layoutKey, setLayoutKey] = useState(0)
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null)
  const [previewNoteTitle, setPreviewNoteTitle] = useState('')
  const [previewNoteContent, setPreviewNoteContent] = useState('')
  const [isLoadingNote, setIsLoadingNote] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [entities, setEntities] = useState<IGraphEntity[]>([])
  const [relations, setRelations] = useState<IGraphRelation[]>([])
  const [isStreaming, setIsStreaming] = useState(true)
  const [streamMeta, setStreamMeta] = useState<{ entityCount: number; relationCount: number } | null>(null)
  const [loadedRelations, setLoadedRelations] = useState(0)

  const refreshGraph = useCallback(() => {
    setEntities([]); setRelations([]); setIsStreaming(true)
    setStreamMeta(null); setLoadedRelations(0); setRefreshKey(k => k + 1)
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    const run = async () => {
      try {
        await graphService.streamGraph({
          onMeta: (m) => { setStreamMeta(m); setLoadedRelations(0) },
          onEntities: (e) => setEntities(e),
          onRelations: (b) => { setRelations(p => [...p, ...b]); setLoadedRelations(p => p + b.length) },
          onDone: () => setIsStreaming(false),
          onError: () => {
            graphService.getGraph().then(d => { if (!ac.signal.aborted) { setEntities(d.entities); setRelations(d.relations); setIsStreaming(false) } }).catch(() => setIsStreaming(false))
          },
        }, ac.signal)
      } catch {
        graphService.getGraph().then(d => { if (!ac.signal.aborted) { setEntities(d.entities); setRelations(d.relations); setIsStreaming(false) } }).catch(() => setIsStreaming(false))
      }
    }
    run()
    return () => ac.abort()
  }, [refreshKey])

  const isLoading = isStreaming && entities.length === 0

  const { data: entityDetail } = useQuery({
    queryKey: ['graph-entity', selectedEntityId],
    queryFn: () => graphService.getEntity(selectedEntityId!),
    enabled: !!selectedEntityId,
  })

  const deleteEntityMutation = useMutation({
    mutationFn: (id: string) => graphService.deleteEntity(id),
    onSuccess: () => { refreshGraph(); setSelectedEntityId(null) },
  })

  const deleteRelationMutation = useMutation({
    mutationFn: (id: string) => graphService.deleteRelation(id),
    onSuccess: () => refreshGraph(),
  })

  const { data: notesData } = useQuery({
    queryKey: ['graph-extract-notes'],
    queryFn: () => noteService.getList({ page: 1, pageSize: 500 }),
    enabled: showExtractDialog,
  })

  const { data: notebooks } = useQuery({
    queryKey: ['graph-extract-notebooks'],
    queryFn: () => notebookService.getTree(),
    enabled: showExtractDialog,
  })

  const notes = useMemo(() => notesData?.items ?? [], [notesData])

  const notebookNameMap = useMemo(() => {
    const map = new Map<string, string>()
    const walk = (nbs: typeof notebooks) => { if (!nbs) return; for (const nb of nbs) { map.set(nb.id, nb.name); walk(nb.children) } }
    walk(notebooks); return map
  }, [notebooks])

  const groupedNotes = useMemo(() => {
    const kw = extractSearch.trim().toLowerCase()
    const filtered = notes.filter(n => !n.isDeleted && (!kw || n.title.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw)))
    const groups = new Map<string, INote[]>()
    for (const note of filtered) { const key = note.notebookId || '__none__'; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(note) }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === '__none__') return 1; if (b === '__none__') return -1
      return (notebookNameMap.get(a) || '').localeCompare(notebookNameMap.get(b) || '')
    })
  }, [notes, extractSearch, notebookNameMap])

  const toggleNoteSelection = (noteId: string) => {
    setSelectedNoteIds(prev => { const next = new Set(prev); if (next.has(noteId)) next.delete(noteId); else next.add(noteId); return next })
  }

  const toggleNotebookSelection = (noteIds: string[]) => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev)
      if (noteIds.every(id => next.has(id))) noteIds.forEach(id => next.delete(id))
      else noteIds.forEach(id => next.add(id))
      return next
    })
  }

  const handleBatchExtract = async () => {
    const ids = [...selectedNoteIds]; if (ids.length === 0) return
    setIsExtracting(true); setExtractResults(new Map())
    try {
      const result = await graphService.batchExtractQueue(ids)
      setExtractQueued(result.queuedCount > 0
        ? `${t('graph.queued', { n: result.queuedCount })}${result.skippedCount > 0 ? t('graph.queuedSkipped', { n: result.skippedCount }) : ''}`
        : t('graph.allRunning'))
      setTimeout(() => setExtractQueued(null), 5000)
    } catch (err) {
      setExtractResults(new Map([[ids[0], { error: (err as Error).message || t('graph.queueFailed') }]]))
    }
    setIsExtracting(false)
  }

  const filteredEntities = useMemo(() => {
    const kw = entitySearch.trim().toLowerCase()
    return entities.filter(e => (typeFilter === 'all' || e.type === typeFilter) && (!kw || `${e.name} ${e.description ?? ''}`.toLowerCase().includes(kw)))
  }, [entitySearch, entities, typeFilter])

  const filteredRelations = useMemo(() => {
    const ids = new Set(filteredEntities.map(e => e.id))
    return relations.filter(r => ids.has(r.sourceEntityId) && ids.has(r.targetEntityId))
  }, [filteredEntities, relations])

  // 容器尺寸变化时重新计算布局尺寸
  const [layoutSize, setLayoutSize] = useState({ w: 1200, h: 800 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => setLayoutSize({ w: container.clientWidth || 1200, h: container.clientHeight || 800 })
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(container)
    return () => obs.disconnect()
  }, [])

  const dragRef = useRef<DragState>({ id: null, x: 0, y: 0 })
  const [wakeKey, setWakeKey] = useState(0)
  const [externalHoverId, setExternalHoverId] = useState<string | null>(null)
  const firstSettleRef = useRef(true)
  const fitToNodesRef = useRef<(nodes: NodePosition[]) => void>(() => {})

  const { positions, setNodePosition } = useForceLayout(filteredEntities, filteredRelations, layoutSize.w, layoutSize.h, layoutKey, dragRef, wakeKey, (nodes) => {
    // 首次布局收敛后自动适配视图，把整个图谱框进画面
    if (!firstSettleRef.current) return
    firstSettleRef.current = false
    fitToNodesRef.current(nodes)
  })

  const { centerOnEntity, fitToNodes } = useCanvasRenderer(canvasRef, filteredEntities, filteredRelations, positions, {
    zoom, pan, selectedEntityId, externalHoverId,
    onSelectEntity: setSelectedEntityId,
    onDeleteRelation: (id) => deleteRelationMutation.mutate(id),
    onDeselect: () => setSelectedEntityId(null),
    onPanChange: setPan,
    onZoomChange: setZoom,
    onWakeSimulation: () => setWakeKey(k => k + 1),
    setNodePosition,
    dragRef,
  })
  useEffect(() => { fitToNodesRef.current = fitToNodes }, [fitToNodes])

  const entityTypes = useMemo(() => [...new Set(entities.map(e => e.type))], [entities])

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entities) m.set(e.type, (m.get(e.type) ?? 0) + 1)
    return m
  }, [entities])

  const handleResetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }
  const handleAutoLayout = () => { firstSettleRef.current = true; setLayoutKey(prev => prev + 1) }

  const handleOpenNotePreview = useCallback(async (noteId: string, noteTitle: string) => {
    setPreviewNoteId(noteId)
    setPreviewNoteTitle(noteTitle)
    setIsLoadingNote(true)
    setPreviewNoteContent('')
    try {
      const note = await noteService.getById(noteId)
      setPreviewNoteContent(note.content || t('graph.noContent'))
    } catch {
      setPreviewNoteContent(t('common:loadingFailed'))
    } finally {
      setIsLoadingNote(false)
    }
  }, [t])

  const mainContent = (
    <div className="flex flex-1 flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title={t('graph.zoomIn')}><ZoomIn size={15} /></button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title={t('graph.zoomOut')}><ZoomOut size={15} /></button>
          <button onClick={handleResetView} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title={t('graph.resetView')}><RotateCcw size={15} /></button>
          <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <button onClick={handleAutoLayout} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title={t('graph.autoLayout')}><Network size={15} /></button>
          <span className="ml-1 text-xs text-gray-400">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowExtractDialog(true)} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-600" title={t('graph.extractTooltip')}>
            <Sparkles size={13} />{t('graph.extractFromNotes')}
          </button>
        </div>
      </div>
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
          <canvas ref={canvasRef} className="block h-full w-full" style={{ cursor: 'grab', width: '100%', height: '100%' }} />

          {isLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-50/80 text-gray-500 backdrop-blur-sm dark:bg-gray-950/80">
              <Loader2 size={32} className="animate-spin text-indigo-500" />
              {streamMeta ? (
                <div className="mt-3 text-center">
                  <p className="text-sm">{t('graph.loading')}</p>
                  <p className="mt-1 text-xs text-gray-400">{t('graph.loadingProgress', { entities: streamMeta.entityCount, loaded: loadedRelations, total: streamMeta.relationCount })}</p>
                  <div className="mx-auto mt-2 h-1 w-48 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: streamMeta.relationCount > 0 ? `${Math.min(100, Math.round((loadedRelations / streamMeta.relationCount) * 100))}%` : '100%' }} />
                  </div>
                </div>
              ) : <p className="mt-3 text-sm">{t('graph.connecting')}</p>}
            </div>
          )}

          {!isLoading && !entities.length && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-950">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30"><Network size={36} className="text-indigo-500" /></div>
              <div className="text-center"><h3 className="text-base font-medium text-gray-800 dark:text-gray-100">{t('graph.emptyTitle')}</h3><p className="mt-1 text-sm text-gray-500">{t('graph.emptyHint')}</p></div>
              <button onClick={() => setShowExtractDialog(true)} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600"><Sparkles size={15} />{t('graph.extractFromNotes')}</button>
            </div>
          )}

          <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/90">
            <div className="flex flex-wrap gap-3">
              {Object.entries(ENTITY_COLORS).slice(0, 5).map(([type, color]) => (
                <span key={type} className="flex items-center gap-1.5 text-[10px] text-gray-600 dark:text-gray-400">
                  <span className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ backgroundColor: color }} />{entityTypeLabel(type)}
                </span>
              ))}
            </div>
          </div>
        </div>

      {showExtractDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><Sparkles size={16} className="text-emerald-600 dark:text-emerald-400" /></div>
                <div><h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('graph.extractDialogTitle')}</h3><p className="text-xs text-gray-500">{selectedNoteIds.size > 0 ? t('graph.selectedNotes', { n: selectedNoteIds.size }) : t('graph.extractDialogHint')}</p></div>
              </div>
              <button onClick={() => { setShowExtractDialog(false); setSelectedNoteIds(new Set()); setExtractResults(new Map()); setExtractSearch('') }} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
            </div>
            <div className="shrink-0 border-b border-gray-100 px-5 py-3 dark:border-gray-700">
              <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={extractSearch} onChange={(e) => setExtractSearch(e.target.value)} placeholder={t('graph.searchNotesPlaceholder')} className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 dark:border-gray-600 dark:bg-gray-700 dark:placeholder:text-gray-500 dark:focus:border-emerald-600" /></div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {groupedNotes.length === 0 ? (<div className="px-4 py-8 text-center text-sm text-gray-500">{extractSearch ? t('graph.noMatchingNotes') : t('graph.noNotes')}</div>) : (
                groupedNotes.map(([notebookId, notebookNotes]) => {
                  const isExpanded = expandedNotebooks.has(notebookId)
                  const notebookName = notebookId === '__none__' ? t('graph.ungrouped') : (notebookNameMap.get(notebookId) || t('graph.unknownNotebook'))
                  const allSelected = notebookNotes.every(n => selectedNoteIds.has(n.id))
                  const someSelected = notebookNotes.some(n => selectedNoteIds.has(n.id))
                  return (
                    <div key={notebookId} className="mb-1">
                      <button onClick={() => { setExpandedNotebooks(prev => { const next = new Set(prev); if (next.has(notebookId)) next.delete(notebookId); else next.add(notebookId); return next }) }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                        <FolderOpen size={14} className="text-emerald-500" /><span className="flex-1 text-xs font-medium text-gray-600 dark:text-gray-300">{notebookName}</span>
                        <span className="text-[10px] text-gray-400">{notebookNotes.length}</span>
                        <div onClick={(e) => { e.stopPropagation(); toggleNotebookSelection(notebookNotes.map(n => n.id)) }} className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors ${allSelected ? 'border-emerald-500 bg-emerald-500' : someSelected ? 'border-emerald-400 bg-emerald-100 dark:bg-emerald-900/30' : 'border-gray-300 dark:border-gray-600'}`}>{(allSelected || someSelected) && <Check size={10} className="text-white" />}</div>
                      </button>
                      {isExpanded && (<div className="ml-5 space-y-0.5">{notebookNotes.map((note) => { const isSelected = selectedNoteIds.has(note.id); const result = extractResults.get(note.id); return (
                        <div key={note.id} onClick={() => toggleNoteSelection(note.id)} className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors ${isSelected ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                          <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 dark:border-gray-600'}`}>{isSelected && <Check size={10} className="text-white" />}</div>
                          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{note.title || t('graph.untitledNote')}</span>{result && 'newEntities' in result && <span className="flex items-center gap-1 text-[10px] text-emerald-600">{t('graph.resultDelta', { entities: result.newEntities, relations: result.newRelations })}</span>}{result && 'error' in result && <span className="text-[10px] text-red-500">{t('graph.failed')}</span>}</div><p className="mt-0.5 line-clamp-1 text-xs text-gray-400 dark:text-gray-500">{note.content?.slice(0, 80) || t('graph.noContent')}</p></div>
                        </div>) })}</div>)}
                    </div>)
                })
              )}
            </div>
            <div className="shrink-0 border-t border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <button onClick={() => { const allNoteIds = groupedNotes.flatMap(([, ns]) => ns.map(n => n.id)); toggleNotebookSelection(allNoteIds) }} className="text-xs text-gray-500 transition-colors hover:text-gray-700 dark:hover:text-gray-300">{selectedNoteIds.size > 0 ? t('graph.deselectAll') : t('common:selectAll')}</button>
                <button onClick={handleBatchExtract} disabled={selectedNoteIds.size === 0 || isExtracting} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                  {isExtracting ? (<><Loader2 size={14} className="animate-spin" />{t('graph.extracting')}</>) : (<><Sparkles size={14} />{t('graph.extractSelected', { n: selectedNoteIds.size })}</>)}
                </button>
                {extractQueued && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check size={12} />{extractQueued}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {previewNoteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setPreviewNoteId(null); setPreviewNoteContent('') }}>
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800" onClick={e => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                  <FolderOpen size={16} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{previewNoteTitle}</h3>
              </div>
              <button onClick={() => { setPreviewNoteId(null); setPreviewNoteContent('') }} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {isLoadingNote ? (
                <div className="flex items-center justify-center gap-2 py-12 text-gray-400"><Loader2 size={20} className="animate-spin" />{t('common:loading')}</div>
              ) : (
                <ThemedMarkdown source={previewNoteContent} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const rightPanel = selectedEntityId && entityDetail ? (
    <div className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('graph.entityDetails')}</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => deleteEntityMutation.mutate(selectedEntityId)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20" title={t('graph.deleteEntity')}><Trash2 size={14} /></button>
          <button onClick={() => setSelectedEntityId(null)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200" title={t('common:close')}><X size={14} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-sm" style={{ backgroundColor: `${ENTITY_COLORS[entityDetail.type] || ENTITY_COLORS.custom}15` }}>
              {(() => { const Icon = ENTITY_ICONS[entityDetail.type] || ENTITY_ICONS.custom; return <Icon size={18} style={{ color: ENTITY_COLORS[entityDetail.type] || ENTITY_COLORS.custom }} /> })()}
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{entityDetail.name}</h3>
              <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${ENTITY_COLORS[entityDetail.type] || ENTITY_COLORS.custom}15`, color: ENTITY_COLORS[entityDetail.type] || ENTITY_COLORS.custom }}>{entityTypeLabel(entityDetail.type)}</span>
            </div>
          </div>
          {entityDetail.description && <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{entityDetail.description}</p>}
        </div>
        {entityDetail.sourceNotes.length > 0 && (
          <div className="mb-4">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">{t('graph.sourceNotes', { n: entityDetail.sourceNotes.length })}</h4>
            <div className="space-y-1">{entityDetail.sourceNotes.map(n => (
              <div key={n.noteId} onClick={() => handleOpenNotePreview(n.noteId, n.title)} className="cursor-pointer truncate rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400">
                • {n.title}
              </div>
            ))}</div>
          </div>
        )}
        {entityDetail.relations.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">{t('graph.relationsTitle', { n: entityDetail.relations.length })}</h4>
            <div className="space-y-1">{entityDetail.relations.map(rel => {
              const otherId = rel.sourceEntityId === entityDetail.id ? rel.targetEntityId : rel.sourceEntityId
              return (
                <div
                  key={rel.id}
                  onClick={() => { setSelectedEntityId(otherId); centerOnEntity(otherId) }}
                  onMouseEnter={() => setExternalHoverId(otherId)}
                  onMouseLeave={() => setExternalHoverId(null)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-2 text-xs transition-colors hover:bg-indigo-50 dark:bg-gray-800 dark:hover:bg-indigo-950/30"
                >
                  <span className="truncate font-medium text-gray-700 dark:text-gray-300" title={rel.sourceEntityName}>{rel.sourceEntityName}</span>
                  <span className="shrink-0 text-gray-400">{relationLabel(rel.relationType)}</span>
                  <span className="shrink-0 text-indigo-400">→</span>
                  <span className="truncate font-medium text-gray-700 dark:text-gray-300" title={rel.targetEntityName}>{rel.targetEntityName}</span>
                </div>
              )
            })}</div>
          </div>
        )}
      </div>
    </div>
  ) : null

  return (
    <AppLayout showSidebar={false} mainContent={
      <div className="flex flex-1 overflow-hidden">
        {mainContent}
        {rightPanel}
      </div>
    }>
      <div className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('graph.entitiesHeader')}</h2>
            <span className="text-[11px] tabular-nums text-gray-400">{filteredEntities.length} / {entities.length}</span>
          </div>
          <div className="relative mb-3"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={entitySearch} onChange={(e) => setEntitySearch(e.target.value)} placeholder={t('graph.searchEntitiesPlaceholder')} className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500 dark:focus:border-blue-600 dark:focus:bg-gray-800" /></div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setTypeFilter('all')} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${typeFilter === 'all' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'}`}>{t('common:all')} {entities.length}</button>
            {entityTypes.map(type => (
              <button key={type} onClick={() => setTypeFilter(type)} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${typeFilter === type ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ENTITY_COLORS[type] || ENTITY_COLORS.custom }} />{entityTypeLabel(type)} {typeCounts.get(type) ?? 0}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span><span className="font-semibold text-gray-800 dark:text-gray-200">{entities.length}</span> {t('graph.entitiesSuffix')}</span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span><span className="font-semibold text-gray-800 dark:text-gray-200">{relations.length}</span> {t('graph.relationsSuffix')}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {filteredEntities.length === 0 && <div className="py-8 text-center text-xs text-gray-400">{t('graph.noMatchingEntities')}</div>}
          {filteredEntities.map(entity => {
            const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.custom
            const active = selectedEntityId === entity.id
            return (
              <div
                key={entity.id}
                title={entity.name}
                onClick={() => { setSelectedEntityId(entity.id); centerOnEntity(entity.id) }}
                onMouseEnter={() => setExternalHoverId(entity.id)}
                onMouseLeave={() => setExternalHoverId(null)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${active ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className={`flex-1 truncate text-sm ${active ? 'font-medium text-indigo-700 dark:text-indigo-200' : 'text-gray-700 dark:text-gray-200'}`}>{entity.name}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-gray-400">{entity.relationCount}</span>
              </div>
            )
          })}
        </div>
      </div>
    </AppLayout>
  )
}
