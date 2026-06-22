import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
import Select from '../components/Select'
import ThemedMarkdown from '../components/ThemedMarkdown'
import { graphService } from '../services/graphService'
import { noteService } from '../services/noteService'
import { notebookService } from '../services/notebookService'
import type { IGraphEntity, IGraphRelation, INote, IExtractGraphResult } from '../types'

const ENTITY_COLORS: Record<string, string> = {
  concept: '#6366f1',
  person: '#10b981',
  organization: '#f59e0b',
  technology: '#3b82f6',
  project: '#ef4444',
  custom: '#8b5cf6',
}

const RELATION_LABELS: Record<string, string> = {
  belong_to: '属于',
  related_to: '相关',
  depends_on: '依赖',
  contains: '包含',
  compared_with: '对比',
  custom: '自定义',
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  concept: '概念',
  person: '人物',
  organization: '组织',
  technology: '技术',
  project: '项目',
  custom: '自定义',
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

// --- Force-directed layout hook (unchanged physics, same throttling) ---
function useForceLayout(entities: IGraphEntity[], relations: IGraphRelation[], width: number, height: number, layoutKey: number) {
  const [positions, setPositions] = useState<NodePosition[]>([])
  const positionsRef = useRef<NodePosition[]>([])
  const frameRef = useRef<number>(0)
  const initializedRef = useRef(false)
  const prevLayoutKeyRef = useRef(layoutKey)

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

    let iteration = 0
    // 根据节点数量动态调整迭代次数和节流间隔
    const nodeCount = nodes.length
    const maxIterations = nodeCount > 100 ? 50 : nodeCount > 50 ? 75 : 100
    const THROTTLE_INTERVAL = nodeCount > 100 ? 10 : nodeCount > 50 ? 5 : 3

    const simulate = () => {
      if (iteration >= maxIterations) return

      const repulsion = 5000
      const attraction = 0.005
      const damping = 0.85
      const centerPull = 0.01

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

        node.vx = (node.vx + fx) * damping
        node.vy = (node.vy + fy) * damping
      }

      for (const rel of relations) {
        const source = nodeMap.get(rel.sourceEntityId)
        const target = nodeMap.get(rel.targetEntityId)
        if (!source || !target) continue

        const dx = target.x - source.x
        const dy = target.y - source.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = dist * attraction

        source.vx += (dx / dist) * force
        source.vy += (dy / dist) * force
        target.vx -= (dx / dist) * force
        target.vy -= (dy / dist) * force
      }

      for (const node of nodes) {
        node.x += node.vx
        node.y += node.vy
        node.x = Math.max(40, Math.min(width - 40, node.x))
        node.y = Math.max(40, Math.min(height - 40, node.y))
      }

      iteration++
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
  }, [entities, relations, width, height, layoutKey])

  return positions
}

// --- Canvas renderer hook: draws graph directly on <canvas> via requestAnimationFrame ---
interface CanvasRendererOptions {
  zoom: number
  pan: { x: number; y: number }
  selectedEntityId: string | null
  onSelectEntity: (id: string) => void
  onDeleteRelation: (id: string) => void
  onDeselect: () => void
  onPanChange: (pan: { x: number; y: number }) => void
  onZoomChange: (zoom: number) => void
}

function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  entities: IGraphEntity[],
  relations: IGraphRelation[],
  positions: NodePosition[],
  options: CanvasRendererOptions,
) {
  const { zoom, pan, selectedEntityId, onSelectEntity, onDeleteRelation, onDeselect, onPanChange, onZoomChange } = options
  const animationRef = useRef<number>(0)

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

  const callbacksRef = useRef({ onSelectEntity, onDeleteRelation, onDeselect, onPanChange, onZoomChange })
  useEffect(() => { callbacksRef.current = { onSelectEntity, onDeleteRelation, onDeselect, onPanChange, onZoomChange } })

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
      const z = zoomRef.current, p = panRef.current
      const selId = selectedRef.current
      const posMap = posMapRef.current, emap = entityMapRef.current, rels = relationsRef.current

      ctx.save()
      ctx.clearRect(0, 0, w, h)
      if (posMap.size === 0) { ctx.restore(); animationRef.current = requestAnimationFrame(draw); return }

      ctx.translate(p.x, p.y)
      ctx.scale(z, z)

      // --- Draw relations ---
      for (const rel of rels) {
        const src = posMap.get(rel.sourceEntityId), tgt = posMap.get(rel.targetEntityId)
        if (!src || !tgt) continue
        const sEnt = emap.get(rel.sourceEntityId), tEnt = emap.get(rel.targetEntityId)
        const sR = 18 + Math.min((sEnt?.relationCount ?? 0) * 2, 12)
        const tR = 18 + Math.min((tEnt?.relationCount ?? 0) * 2, 12)
        const dx = tgt.x - src.x, dy = tgt.y - src.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const ux = dx / dist, uy = dy / dist
        const x1 = src.x + ux * sR, y1 = src.y + uy * sR
        const x2 = tgt.x - ux * (tR + 6), y2 = tgt.y - uy * (tR + 6)

        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
        ctx.strokeStyle = 'rgba(203,213,225,0.7)'; ctx.lineWidth = 1.2 / z; ctx.stroke()

        const hl = 6 / z
        ctx.beginPath(); ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - hl * ux + hl * 0.4 * (-uy), y2 - hl * uy + hl * 0.4 * ux)
        ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - hl * ux - hl * 0.4 * (-uy), y2 - hl * uy - hl * 0.4 * ux)
        ctx.strokeStyle = 'rgba(203,213,225,0.8)'; ctx.lineWidth = 1.2 / z; ctx.stroke()

        const fs = Math.max(9, 9 / z)
        ctx.font = `${fs}px -apple-system,BlinkMacSystemFont,sans-serif`
        ctx.fillStyle = 'rgba(156,163,175,0.8)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(RELATION_LABELS[rel.relationType] || rel.relationType, (src.x + tgt.x) / 2, (src.y + tgt.y) / 2 - 6)
      }

      // --- Draw entities ---
      for (const entity of entities) {
        const pos = posMap.get(entity.id); if (!pos) continue
        const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.custom
        const isSel = selId === entity.id
        const r = 18 + Math.min(entity.relationCount * 2, 12)

        if (isSel) {
          const t = Date.now() / 1000, pulseR = r + 4 + Math.sin(t * Math.PI) * 2
          ctx.beginPath(); ctx.arc(pos.x, pos.y, pulseR, 0, Math.PI * 2)
          ctx.strokeStyle = color; ctx.lineWidth = 2 / z
          ctx.globalAlpha = 0.3 + Math.sin(t * Math.PI) * 0.2; ctx.stroke(); ctx.globalAlpha = 1
        }

        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.15)'; ctx.shadowBlur = 6 / z; ctx.shadowOffsetY = 2 / z
        const cr = parseInt(color.slice(1, 3), 16), cg = parseInt(color.slice(3, 5), 16), cb = parseInt(color.slice(5, 7), 16)
        const grad = ctx.createRadialGradient(pos.x - r * 0.25, pos.y - r * 0.25, 0, pos.x, pos.y, r)
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`); grad.addColorStop(1, `rgba(${cr},${cg},${cb},0.8)`)
        ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
        ctx.fillStyle = grad; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.restore()

        const gx = pos.x - r * 0.3, gy = pos.y - r * 0.3, gr = r * 0.4
        ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2)
        const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
        glow.addColorStop(0, 'rgba(255,255,255,0.3)'); glow.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = glow; ctx.fill()

        const lbl = entity.name.length > 6 ? entity.name.slice(0, 5) + '\u2026' : entity.name
        const efs = Math.max(10, 10 / z)
        ctx.font = `500 ${efs}px -apple-system,BlinkMacSystemFont,sans-serif`
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(lbl, pos.x, pos.y + 1)
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

  // --- Mouse interaction (hit-test, pan, zoom, click) ---
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    let isDragging = false, startX = 0, startY = 0

    const hitTest = (sx: number, sy: number): { entity?: string; relation?: string } => {
      const z = zoomRef.current, p = panRef.current
      const rect = canvas.getBoundingClientRect()
      const x = (sx - rect.left - p.x) / z, y = (sy - rect.top - p.y) / z

      for (const entity of entities) {
        const pos = posMapRef.current.get(entity.id); if (!pos) continue
        const r = 18 + Math.min(entity.relationCount * 2, 12)
        if ((x - pos.x) ** 2 + (y - pos.y) ** 2 <= r * r) return { entity: entity.id }
      }
      for (const rel of relationsRef.current) {
        const src = posMapRef.current.get(rel.sourceEntityId), tgt = posMapRef.current.get(rel.targetEntityId)
        if (!src || !tgt) continue
        const sR = 18 + Math.min((entityMapRef.current.get(rel.sourceEntityId)?.relationCount ?? 0) * 2, 12)
        const tR = 18 + Math.min((entityMapRef.current.get(rel.targetEntityId)?.relationCount ?? 0) * 2, 12)
        const dx = tgt.x - src.x, dy = tgt.y - src.y, dist = Math.sqrt(dx * dx + dy * dy); if (dist < 1) continue
        const ux = dx / dist, uy = dy / dist
        const x1 = src.x + ux * sR, y1 = src.y + uy * sR, x2 = tgt.x - ux * (tR + 6), y2 = tgt.y - uy * (tR + 6)
        const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2; if (len2 < 1) continue
        const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / len2))
        const px = x1 + t * (x2 - x1), py = y1 + t * (y2 - y1)
        if (Math.sqrt((x - px) ** 2 + (y - py) ** 2) < 8 / z) return { relation: rel.id }
      }
      return {}
    }

    const onMove = (e: MouseEvent) => {
      const hit = hitTest(e.clientX, e.clientY)
      canvas.style.cursor = (hit.entity || hit.relation) ? 'pointer' : isDragging ? 'grabbing' : 'grab'
    }

    const onWindowMove = (e: MouseEvent) => {
      if (isDragging) {
        callbacksRef.current.onPanChange({ x: e.clientX - startX, y: e.clientY - startY })
      }
    }

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      startX = e.clientX - panRef.current.x; startY = e.clientY - panRef.current.y
      isDragging = false
      const onMoveCheck = (ev: MouseEvent) => {
        if (Math.abs(ev.clientX - startX - panRef.current.x) > 3 || Math.abs(ev.clientY - startY - panRef.current.y) > 3) isDragging = true
      }
      const onUp = () => {
        isDragging = false
        canvas.style.cursor = 'grab'
        window.removeEventListener('mousemove', onMoveCheck)
        window.removeEventListener('mousemove', onWindowMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMoveCheck)
      window.addEventListener('mousemove', onWindowMove)
      window.addEventListener('mouseup', onUp)
    }

    const onClick = (e: MouseEvent) => {
      if (isDragging) { isDragging = false; return }
      const hit = hitTest(e.clientX, e.clientY)
      if (hit.entity) callbacksRef.current.onSelectEntity(hit.entity)
      else if (hit.relation) callbacksRef.current.onDeleteRelation(hit.relation)
      else callbacksRef.current.onDeselect()
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
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
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('mousedown', onDown); canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('click', onClick); canvas.removeEventListener('wheel', onWheel)
    }
  }, [canvasRef, entities])
}

export default function GraphPage() {
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

  const notes = notesData?.items ?? []

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
    for (const noteId of ids) {
      try { const result = await graphService.extractFromNote(noteId); setExtractResults(prev => new Map(prev).set(noteId, result)) }
      catch (err) { setExtractResults(prev => new Map(prev).set(noteId, { error: (err as Error).message || '提取失败' })) }
    }
    setIsExtracting(false); refreshGraph()
  }

  const filteredEntities = useMemo(() => {
    const kw = entitySearch.trim().toLowerCase()
    return entities.filter(e => (typeFilter === 'all' || e.type === typeFilter) && (!kw || `${e.name} ${e.description ?? ''}`.toLowerCase().includes(kw)))
  }, [entitySearch, entities, typeFilter])

  const filteredRelations = useMemo(() => {
    const ids = new Set(filteredEntities.map(e => e.id))
    return relations.filter(r => ids.has(r.sourceEntityId) && ids.has(r.targetEntityId))
  }, [filteredEntities, relations])

  // Use container size for layout if available, otherwise sensible defaults
  const layoutSize = useMemo(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    return { w: rect?.width || 1200, h: rect?.height || 800 }
  }, [filteredEntities.length])

  const positions = useForceLayout(filteredEntities, filteredRelations, layoutSize.w, layoutSize.h, layoutKey)

  useCanvasRenderer(canvasRef, filteredEntities, filteredRelations, positions, {
    zoom, pan, selectedEntityId,
    onSelectEntity: setSelectedEntityId,
    onDeleteRelation: (id) => deleteRelationMutation.mutate(id),
    onDeselect: () => setSelectedEntityId(null),
    onPanChange: setPan,
    onZoomChange: setZoom,
  })

  const entityTypes = useMemo(() => [...new Set(entities.map(e => e.type))], [entities])

  const handleResetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }
  const handleAutoLayout = () => { setLayoutKey(prev => prev + 1) }

  const handleOpenNotePreview = useCallback(async (noteId: string, noteTitle: string) => {
    setPreviewNoteId(noteId)
    setPreviewNoteTitle(noteTitle)
    setIsLoadingNote(true)
    setPreviewNoteContent('')
    try {
      const note = await noteService.getById(noteId)
      setPreviewNoteContent(note.content || '无内容')
    } catch {
      setPreviewNoteContent('加载失败')
    } finally {
      setIsLoadingNote(false)
    }
  }, [])

  const mainContent = (
    <div className="flex flex-1 flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="放大"><ZoomIn size={15} /></button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="缩小"><ZoomOut size={15} /></button>
          <button onClick={handleResetView} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="重置视图"><RotateCcw size={15} /></button>
          <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <button onClick={handleAutoLayout} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="自动布局"><Network size={15} /></button>
          <span className="ml-1 text-xs text-gray-400">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowExtractDialog(true)} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-600" title="用 AI 从笔记中提取实体和关系">
            <Sparkles size={13} />从笔记提取
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
                  <p className="text-sm">正在加载知识图谱...</p>
                  <p className="mt-1 text-xs text-gray-400">已加载 {streamMeta.entityCount} 个实体，{loadedRelations} / {streamMeta.relationCount} 个关系</p>
                  <div className="mx-auto mt-2 h-1 w-48 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: streamMeta.relationCount > 0 ? `${Math.min(100, Math.round((loadedRelations / streamMeta.relationCount) * 100))}%` : '100%' }} />
                  </div>
                </div>
              ) : <p className="mt-3 text-sm">正在连接服务...</p>}
            </div>
          )}

          {!isLoading && !entities.length && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-950">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30"><Network size={36} className="text-indigo-500" /></div>
              <div className="text-center"><h3 className="text-base font-medium text-gray-800 dark:text-gray-100">知识图谱为空</h3><p className="mt-1 text-sm text-gray-500">从笔记中提取实体和关系来构建知识图谱</p></div>
              <button onClick={() => setShowExtractDialog(true)} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600"><Sparkles size={15} />从笔记提取</button>
            </div>
          )}

          <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/90">
            <div className="flex flex-wrap gap-3">
              {Object.entries(ENTITY_COLORS).slice(0, 5).map(([type, color]) => (
                <span key={type} className="flex items-center gap-1.5 text-[10px] text-gray-600 dark:text-gray-400">
                  <span className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ backgroundColor: color }} />{ENTITY_TYPE_LABELS[type] || type}
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
                <div><h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">从笔记提取知识图谱</h3><p className="text-xs text-gray-500">{selectedNoteIds.size > 0 ? `已选择 ${selectedNoteIds.size} 篇笔记` : '选择笔记后 AI 提取实体和关系'}</p></div>
              </div>
              <button onClick={() => { setShowExtractDialog(false); setSelectedNoteIds(new Set()); setExtractResults(new Map()); setExtractSearch('') }} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
            </div>
            <div className="shrink-0 border-b border-gray-100 px-5 py-3 dark:border-gray-700">
              <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={extractSearch} onChange={(e) => setExtractSearch(e.target.value)} placeholder="搜索笔记标题或内容..." className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 dark:border-gray-600 dark:bg-gray-700 dark:placeholder:text-gray-500 dark:focus:border-emerald-600" /></div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {groupedNotes.length === 0 ? (<div className="px-4 py-8 text-center text-sm text-gray-500">{extractSearch ? '未找到匹配的笔记' : '暂无笔记'}</div>) : (
                groupedNotes.map(([notebookId, notebookNotes]) => {
                  const isExpanded = expandedNotebooks.has(notebookId)
                  const notebookName = notebookId === '__none__' ? '未分组' : (notebookNameMap.get(notebookId) || '未知笔记本')
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
                          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{note.title || '未命名笔记'}</span>{result && 'newEntities' in result && <span className="flex items-center gap-1 text-[10px] text-emerald-600">+{result.newEntities}实体 +{result.newRelations}关系</span>}{result && 'error' in result && <span className="text-[10px] text-red-500">失败</span>}</div><p className="mt-0.5 line-clamp-1 text-xs text-gray-400 dark:text-gray-500">{note.content?.slice(0, 80) || '无内容'}</p></div>
                        </div>) })}</div>)}
                    </div>)
                })
              )}
            </div>
            <div className="shrink-0 border-t border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <button onClick={() => { const allNoteIds = groupedNotes.flatMap(([, ns]) => ns.map(n => n.id)); toggleNotebookSelection(allNoteIds) }} className="text-xs text-gray-500 transition-colors hover:text-gray-700 dark:hover:text-gray-300">{selectedNoteIds.size > 0 ? '取消全选' : '全选'}</button>
                <button onClick={handleBatchExtract} disabled={selectedNoteIds.size === 0 || isExtracting} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                  {isExtracting ? (<><Loader2 size={14} className="animate-spin" />提取中...</>) : (<><Sparkles size={14} />提取选中 ({selectedNoteIds.size})</>)}
                </button>
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
                <div className="flex items-center justify-center gap-2 py-12 text-gray-400"><Loader2 size={20} className="animate-spin" />加载中...</div>
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
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">实体详情</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => deleteEntityMutation.mutate(selectedEntityId)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20" title="删除实体"><Trash2 size={14} /></button>
          <button onClick={() => setSelectedEntityId(null)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="关闭"><X size={14} /></button>
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
              <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${ENTITY_COLORS[entityDetail.type] || ENTITY_COLORS.custom}15`, color: ENTITY_COLORS[entityDetail.type] || ENTITY_COLORS.custom }}>{ENTITY_TYPE_LABELS[entityDetail.type] || entityDetail.type}</span>
            </div>
          </div>
          {entityDetail.description && <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{entityDetail.description}</p>}
        </div>
        {entityDetail.sourceNotes.length > 0 && (
          <div className="mb-4">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">来源笔记 ({entityDetail.sourceNotes.length})</h4>
            <div className="space-y-1">{entityDetail.sourceNotes.map(n => (
              <div key={n.noteId} onClick={() => handleOpenNotePreview(n.noteId, n.title)} className="cursor-pointer truncate rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400">
                • {n.title}
              </div>
            ))}</div>
          </div>
        )}
        {entityDetail.relations.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">关系 ({entityDetail.relations.length})</h4>
            <div className="space-y-1.5">{entityDetail.relations.map(rel => (
              <div key={rel.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800">
                <span className="font-medium text-gray-700 dark:text-gray-300">{rel.sourceEntityName}</span>
                <span className="text-indigo-500">→</span>
                <span className="text-gray-400">{RELATION_LABELS[rel.relationType] || rel.relationType}</span>
                <span className="text-indigo-500">→</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{rel.targetEntityName}</span>
              </div>))}</div>
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
      <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">实体</h2></div>
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={entitySearch} onChange={(e) => setEntitySearch(e.target.value)} placeholder="搜索实体..." className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500 dark:focus:border-blue-600 dark:focus:bg-gray-800" /></div>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e)} options={[{ value: 'all', label: '全部类型' }, ...entityTypes.map(type => ({ value: type, label: ENTITY_TYPE_LABELS[type] || type }))]} />
        </div>
        <div className="border-b border-gray-100 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 p-4 dark:border-gray-800 dark:from-indigo-950/20 dark:to-purple-950/20">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white p-3 shadow-sm dark:bg-gray-800"><div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">实体</div><div className="mt-1 text-xl font-bold text-indigo-600 dark:text-indigo-400">{entities.length}</div></div>
            <div className="rounded-xl bg-white p-3 shadow-sm dark:bg-gray-800"><div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">关系</div><div className="mt-1 text-xl font-bold text-purple-600 dark:text-purple-400">{relations.length}</div></div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filteredEntities.length === 0 && <div className="py-8 text-center text-xs text-gray-400">暂无匹配的实体</div>}
          {filteredEntities.map(entity => {
            const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.custom
            const EntityIcon = ENTITY_ICONS[entity.type] || ENTITY_ICONS.custom
            return (
              <div key={entity.id} onClick={() => setSelectedEntityId(entity.id)} className={`group mb-1 cursor-pointer rounded-xl p-3 transition-all ${selectedEntityId === entity.id ? 'bg-indigo-50 shadow-sm dark:bg-indigo-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm" style={{ backgroundColor: `${color}15` }}><EntityIcon size={16} style={{ color }} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2"><h3 className={`truncate text-sm ${selectedEntityId === entity.id ? 'font-medium text-indigo-700 dark:text-indigo-200' : 'font-medium text-gray-800 dark:text-gray-100'}`}>{entity.name}</h3><span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{entity.relationCount}</span></div>
                    <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: `${color}15`, color }}>{ENTITY_TYPE_LABELS[entity.type] || entity.type}</span>
                    {entity.description && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{entity.description}</p>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </AppLayout>
  )
}
