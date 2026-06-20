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
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { graphService } from '../services/graphService'
import { noteService } from '../services/noteService'
import type { IGraphEntity, IGraphRelation, INote } from '../types'

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

export default function GraphPage() {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [entitySearch, setEntitySearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 })
  const [showExtractDialog, setShowExtractDialog] = useState(false)
  const [extractingNoteId, setExtractingNoteId] = useState<string | null>(null)
  const [layoutKey, setLayoutKey] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  // Graph data state — populated by SSE stream or fallback query
  const [entities, setEntities] = useState<IGraphEntity[]>([])
  const [relations, setRelations] = useState<IGraphRelation[]>([])
  const [isStreaming, setIsStreaming] = useState(true)
  const [streamMeta, setStreamMeta] = useState<{ entityCount: number; relationCount: number } | null>(null)
  const [loadedRelations, setLoadedRelations] = useState(0)

  const refreshGraph = useCallback(() => {
    setEntities([])
    setRelations([])
    setIsStreaming(true)
    setStreamMeta(null)
    setLoadedRelations(0)
    setRefreshKey(k => k + 1)
  }, [])

  // --- Load graph data via SSE streaming with fallback ---
  useEffect(() => {
    const abortController = new AbortController()

    const startStream = async () => {
      try {
        await graphService.streamGraph(
          {
            onMeta: (meta) => {
              setStreamMeta(meta)
              setLoadedRelations(0)
            },
            onEntities: (newEntities) => {
              setEntities(newEntities)
            },
            onRelations: (batch) => {
              setRelations(prev => [...prev, ...batch])
              setLoadedRelations(prev => prev + batch.length)
            },
            onDone: () => setIsStreaming(false),
            onError: () => {
              // Fallback: load via regular API
              graphService.getGraph()
                .then(data => {
                  if (!abortController.signal.aborted) {
                    setEntities(data.entities)
                    setRelations(data.relations)
                    setIsStreaming(false)
                  }
                })
                .catch(() => setIsStreaming(false))
            },
          },
          abortController.signal,
        )
      } catch {
        // Stream failed, fallback
        graphService.getGraph()
          .then(data => {
            if (!abortController.signal.aborted) {
              setEntities(data.entities)
              setRelations(data.relations)
              setIsStreaming(false)
            }
          })
          .catch(() => setIsStreaming(false))
      }
    }

    startStream()
    return () => abortController.abort()
  }, [refreshKey])

  const isLoading = isStreaming && entities.length === 0

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setSvgSize({ width: rect.width, height: rect.height })
      }
    }

    const observer = new ResizeObserver(() => updateSize())
    observer.observe(el)
    updateSize()

    return () => observer.disconnect()
  }, [isLoading, entities.length])

  const { data: entityDetail } = useQuery({
    queryKey: ['graph-entity', selectedEntityId],
    queryFn: () => graphService.getEntity(selectedEntityId!),
    enabled: !!selectedEntityId,
  })

  const deleteEntityMutation = useMutation({
    mutationFn: (id: string) => graphService.deleteEntity(id),
    onSuccess: () => {
      refreshGraph()
      setSelectedEntityId(null)
    },
  })

  const deleteRelationMutation = useMutation({
    mutationFn: (id: string) => graphService.deleteRelation(id),
    onSuccess: () => refreshGraph(),
  })

  const { data: notesData } = useQuery({
    queryKey: ['graph-extract-notes'],
    queryFn: () => noteService.getList({ page: 1, pageSize: 200 }),
    enabled: showExtractDialog,
  })

  const notes = notesData?.items ?? []

  const extractMutation = useMutation({
    mutationFn: (noteId: string) => graphService.extractFromNote(noteId),
    onSuccess: () => {
      refreshGraph()
      setExtractingNoteId(null)
      setShowExtractDialog(false)
    },
    onError: (err: Error) => {
      alert(err.message || '提取失败')
      setExtractingNoteId(null)
    },
  })

  const filteredEntities = useMemo(() => {
    const keyword = entitySearch.trim().toLowerCase()
    return entities.filter(e =>
      (typeFilter === 'all' || e.type === typeFilter) &&
      (!keyword || `${e.name} ${e.description ?? ''}`.toLowerCase().includes(keyword))
    )
  }, [entitySearch, entities, typeFilter])

  const filteredRelations = useMemo(() => {
    const filteredEntityIds = new Set(filteredEntities.map(e => e.id))
    return relations.filter(
      r => filteredEntityIds.has(r.sourceEntityId) && filteredEntityIds.has(r.targetEntityId)
    )
  }, [filteredEntities, relations])

  // Pre-build Map for O(1) entity lookup in SVG rendering
  const filteredEntityMap = useMemo(
    () => new Map(filteredEntities.map(e => [e.id, e])),
    [filteredEntities],
  )

  const positions = useForceLayout(filteredEntities, filteredRelations, svgSize.width || 800, svgSize.height || 600, layoutKey)
  const posMap = useMemo(() => new Map(positions.map(p => [p.id, p])), [positions])

  const entityTypes = useMemo(() => [...new Set(entities.map(e => e.type))], [entities])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as SVGElement).classList.contains('graph-bg')) {
      setIsPanning(true)
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
      setSelectedEntityId(null)
    }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y })
    }
  }, [isPanning])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    
    const svg = svgRef.current
    if (!svg) return
    
    const rect = svg.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(0.3, Math.min(3, zoom * zoomFactor))
    
    // 计算缩放中心点偏移，保持鼠标位置不变
    const scale = newZoom / zoom
    const newPanX = mouseX - (mouseX - pan.x) * scale
    const newPanY = mouseY - (mouseY - pan.y) * scale
    
    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }, [zoom, pan])

  const handleResetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleAutoLayout = () => {
    setLayoutKey(prev => prev + 1)
  }

  const mainContent = (
    <div className="flex flex-1 flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="放大">
            <ZoomIn size={15} />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="缩小">
            <ZoomOut size={15} />
          </button>
          <button onClick={handleResetView} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="重置视图">
            <RotateCcw size={15} />
          </button>
          <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <button onClick={handleAutoLayout} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" title="自动布局">
            <Network size={15} />
          </button>
          <span className="ml-1 text-xs text-gray-400">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExtractDialog(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-600"
            title="用 AI 从笔记中提取实体和关系"
          >
            <Sparkles size={13} />
            从笔记提取
          </button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center text-gray-500">
          <Loader2 size={32} className="animate-spin text-indigo-500" />
          {streamMeta ? (
            <div className="mt-3 text-center">
              <p className="text-sm">正在加载知识图谱...</p>
              <p className="mt-1 text-xs text-gray-400">
                已加载 {streamMeta.entityCount} 个实体，{loadedRelations} / {streamMeta.relationCount} 个关系
              </p>
              <div className="mx-auto mt-2 h-1 w-48 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{
                    width: streamMeta.relationCount > 0
                      ? `${Math.min(100, Math.round((loadedRelations / streamMeta.relationCount) * 100))}%`
                      : '100%',
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm">正在连接服务...</p>
          )}
        </div>
      ) : !entities.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30">
            <Network size={36} className="text-indigo-500" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-medium text-gray-800 dark:text-gray-100">知识图谱为空</h3>
            <p className="mt-1 text-sm text-gray-500">从笔记中提取实体和关系来构建知识图谱</p>
          </div>
          <button
            onClick={() => setShowExtractDialog(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600"
          >
            <Sparkles size={15} />
            从笔记提取
          </button>
        </div>
      ) : (
        <div ref={containerRef} className="relative flex-1 overflow-hidden">
          {svgSize.width === 0 || svgSize.height === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">正在初始化图谱...</div>
          ) : (
            <>
              <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/90">
                <div className="flex flex-wrap gap-3">
                  {Object.entries(ENTITY_COLORS).slice(0, 5).map(([type, color]) => (
                    <span key={type} className="flex items-center gap-1.5 text-[10px] text-gray-600 dark:text-gray-400">
                      <span className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ backgroundColor: color }} />
                      {type}
                    </span>
                  ))}
                </div>
              </div>

              <svg
                ref={svgRef}
                className="h-full w-full cursor-grab active:cursor-grabbing"
                viewBox={`0 0 ${svgSize.width || 800} ${svgSize.height || 600}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
              >
                <defs>
                  <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </radialGradient>
                  {Object.entries(ENTITY_COLORS).map(([type, color]) => (
                    <radialGradient key={type} id={`grad-${type}`} cx="30%" cy="30%" r="70%">
                      <stop offset="0%" stopColor={color} stopOpacity="1" />
                      <stop offset="100%" stopColor={color} stopOpacity="0.8" />
                    </radialGradient>
                  ))}
                  <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2" />
                  </filter>
                  <marker id="arrowhead" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#cbd5e1" />
                  </marker>
                </defs>
                <rect className="graph-bg" width={svgSize.width || 800} height={svgSize.height || 600} fill="transparent" />
                <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                  {filteredRelations.map(rel => {
                    const source = posMap.get(rel.sourceEntityId)
                    const target = posMap.get(rel.targetEntityId)
                    if (!source || !target) return null
                    const dx = target.x - source.x
                    const dy = target.y - source.y
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1
                    const targetEntity = filteredEntityMap.get(rel.targetEntityId)
                    const sourceEntity = filteredEntityMap.get(rel.sourceEntityId)
                    const targetR = 18 + Math.min((targetEntity?.relationCount ?? 0) * 2, 12)
                    const sourceR = 18 + Math.min((sourceEntity?.relationCount ?? 0) * 2, 12)
                    const ux = dx / dist
                    const uy = dy / dist
                    const x1 = source.x + ux * sourceR
                    const y1 = source.y + uy * sourceR
                    const x2 = target.x - ux * (targetR + 6)
                    const y2 = target.y - uy * (targetR + 6)
                    return (
                      <g key={rel.id}>
                        <line
                          x1={x1} y1={y1}
                          x2={x2} y2={y2}
                          stroke="#cbd5e1"
                          strokeWidth={1.2}
                          strokeOpacity={0.7}
                          markerEnd="url(#arrowhead)"
                          className="cursor-pointer transition-all hover:stroke-indigo-500 hover:stroke-[2]"
                          onClick={() => deleteRelationMutation.mutate(rel.id)}
                        />
                        <text
                          x={(source.x + target.x) / 2}
                          y={(source.y + target.y) / 2 - 6}
                          textAnchor="middle"
                          className="pointer-events-none select-none fill-gray-400 text-[9px]"
                        >
                          {RELATION_LABELS[rel.relationType] || rel.relationType}
                        </text>
                      </g>
                    )
                  })}

                  {filteredEntities.map(entity => {
                    const pos = posMap.get(entity.id)
                    if (!pos) return null
                    const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.custom
                    const isSelected = selectedEntityId === entity.id
                    const nodeRadius = 18 + Math.min(entity.relationCount * 2, 12)
                    const gradId = `url(#grad-${entity.type})`
                    return (
                      <g
                        key={entity.id}
                        className="cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); setSelectedEntityId(entity.id) }}
                      >
                        {isSelected && (
                          <circle cx={pos.x} cy={pos.y} r={nodeRadius + 5} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.3}>
                            <animate attributeName="r" values={`${nodeRadius + 4};${nodeRadius + 6};${nodeRadius + 4}`} dur="2s" repeatCount="indefinite" />
                            <animate attributeName="stroke-opacity" values="0.3;0.5;0.3" dur="2s" repeatCount="indefinite" />
                          </circle>
                        )}
                        <circle
                          cx={pos.x} cy={pos.y} r={nodeRadius}
                          fill={ENTITY_COLORS[entity.type] ? gradId : color}
                          filter="url(#shadow)"
                          className="transition-opacity hover:opacity-100"
                          opacity={0.9}
                        />
                        <circle
                          cx={pos.x - nodeRadius * 0.3} cy={pos.y - nodeRadius * 0.3} r={nodeRadius * 0.4}
                          fill="url(#nodeGlow)"
                          className="pointer-events-none"
                        />
                        <text
                          x={pos.x} y={pos.y + 1}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="pointer-events-none select-none fill-white text-[10px] font-medium"
                        >
                          {entity.name.length > 6 ? entity.name.slice(0, 5) + '…' : entity.name}
                        </text>
                      </g>
                    )
                  })}
                </g>
              </svg>
            </>
          )}
        </div>
      )}

      {showExtractDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                  <Sparkles size={16} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">从笔记提取知识图谱</h3>
                  <p className="text-xs text-gray-500">AI 将分析笔记提取实体和关系</p>
                </div>
              </div>
              <button
                onClick={() => setShowExtractDialog(false)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4">
              <div className="mb-4 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  此过程需要调用 LLM，可能需要 10-30 秒。
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
                {notes.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-500">暂无笔记</div>
                ) : (
                  notes.map((note: INote) => (
                    <button
                      key={note.id}
                      disabled={extractingNoteId === note.id}
                      onClick={() => {
                        setExtractingNoteId(note.id)
                        extractMutation.mutate(note.id)
                      }}
                      className="group flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-700/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                            {note.title || '未命名笔记'}
                          </span>
                          {extractingNoteId === note.id && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600">
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              提取中...
                            </span>
                          )}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                          {note.content || '无内容'}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <AppLayout showSidebar={false} mainContent={mainContent}>
      <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">实体</h2>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              placeholder="搜索实体..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500 dark:focus:border-blue-600 dark:focus:bg-gray-800"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 outline-none transition-colors focus:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            <option value="all">全部类型</option>
            {entityTypes.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>

        <div className="border-b border-gray-100 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 p-4 dark:border-gray-800 dark:from-indigo-950/20 dark:to-purple-950/20">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white p-3 shadow-sm dark:bg-gray-800">
              <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">实体</div>
              <div className="mt-1 text-xl font-bold text-indigo-600 dark:text-indigo-400">{entities.length}</div>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm dark:bg-gray-800">
              <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">关系</div>
              <div className="mt-1 text-xl font-bold text-purple-600 dark:text-purple-400">{relations.length}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredEntities.length === 0 && (
            <div className="py-8 text-center text-xs text-gray-400">暂无匹配的实体</div>
          )}
          {filteredEntities.map(entity => {
            const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.custom
            const EntityIcon = ENTITY_ICONS[entity.type] || ENTITY_ICONS.custom
            return (
              <div
                key={entity.id}
                onClick={() => setSelectedEntityId(entity.id)}
                className={`group mb-1 cursor-pointer rounded-xl p-3 transition-all ${selectedEntityId === entity.id ? 'bg-indigo-50 shadow-sm dark:bg-indigo-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm" style={{ backgroundColor: `${color}15` }}>
                    <EntityIcon size={16} style={{ color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className={`truncate text-sm ${selectedEntityId === entity.id ? 'font-medium text-indigo-700 dark:text-indigo-200' : 'font-medium text-gray-800 dark:text-gray-100'}`}>{entity.name}</h3>
                      <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{entity.relationCount}</span>
                    </div>
                    <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: `${color}15`, color }}>{entity.type}</span>
                    {entity.description && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{entity.description}</p>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {selectedEntityId && entityDetail && (
          <div className="max-h-64 overflow-y-auto border-t border-gray-100 p-4 dark:border-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{entityDetail.name}</h3>
              <button
                onClick={() => deleteEntityMutation.mutate(selectedEntityId)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${ENTITY_COLORS[entityDetail.type] || ENTITY_COLORS.custom}15`, color: ENTITY_COLORS[entityDetail.type] || ENTITY_COLORS.custom }}>
              {entityDetail.type}
            </span>
            {entityDetail.description && (
              <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{entityDetail.description}</p>
            )}
            {entityDetail.relations.length > 0 && (
              <div className="mt-3">
                <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">关系</h4>
                <div className="space-y-1">
                  {entityDetail.relations.map(rel => (
                    <div key={rel.id} className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1.5 text-xs dark:bg-gray-800">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{rel.sourceEntityName}</span>
                      <span className="text-indigo-500">→</span>
                      <span className="text-gray-400">{RELATION_LABELS[rel.relationType] || rel.relationType}</span>
                      <span className="text-indigo-500">→</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{rel.targetEntityName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {entityDetail.sourceNotes.length > 0 && (
              <div className="mt-3">
                <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">来源笔记</h4>
                <div className="space-y-0.5">
                  {entityDetail.sourceNotes.map(n => (
                    <div key={n.noteId} className="truncate text-xs text-gray-500 dark:text-gray-400">• {n.title}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
