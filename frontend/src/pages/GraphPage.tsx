import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Network,
  Plus,
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
    const maxIterations = 100

    const simulate = () => {
      if (iteration >= maxIterations) return

      const repulsion = 5000
      const attraction = 0.005
      const damping = 0.85
      const centerPull = 0.01

      for (let i = 0; i < nodes.length; i++) {
        let fx = 0, fy = 0

        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = repulsion / (dist * dist)
          fx += (dx / dist) * force
          fy += (dy / dist) * force
        }

        fx += (cx - nodes[i].x) * centerPull
        fy += (cy - nodes[i].y) * centerPull

        nodes[i].vx = (nodes[i].vx + fx) * damping
        nodes[i].vy = (nodes[i].vy + fy) * damping
      }

      for (const rel of relations) {
        const source = nodes.find(n => n.id === rel.sourceEntityId)
        const target = nodes.find(n => n.id === rel.targetEntityId)
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
      positionsRef.current = [...nodes]
      setPositions(positionsRef.current)

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
  const queryClient = useQueryClient()
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
  }, [])

  const { data: graphData, isLoading } = useQuery({
    queryKey: ['graph'],
    queryFn: () => graphService.getGraph(),
  })

  const { data: entityDetail } = useQuery({
    queryKey: ['graph-entity', selectedEntityId],
    queryFn: () => graphService.getEntity(selectedEntityId!),
    enabled: !!selectedEntityId,
  })

  const deleteEntityMutation = useMutation({
    mutationFn: (id: string) => graphService.deleteEntity(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] })
      setSelectedEntityId(null)
    },
  })

  const deleteRelationMutation = useMutation({
    mutationFn: (id: string) => graphService.deleteRelation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['graph'] }),
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
      queryClient.invalidateQueries({ queryKey: ['graph'] })
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
    return graphData?.entities?.filter(e =>
      (typeFilter === 'all' || e.type === typeFilter) &&
      (!keyword || `${e.name} ${e.description ?? ''}`.toLowerCase().includes(keyword))
    ) ?? []
  }, [entitySearch, graphData?.entities, typeFilter])

  const filteredRelations = useMemo(() => {
    const filteredEntityIds = new Set(filteredEntities.map(e => e.id))
    return graphData?.relations?.filter(
      r => filteredEntityIds.has(r.sourceEntityId) && filteredEntityIds.has(r.targetEntityId)
    ) ?? []
  }, [filteredEntities, graphData?.relations])

  const positions = useForceLayout(filteredEntities, filteredRelations, svgSize.width || 800, svgSize.height || 600, layoutKey)
  const posMap = useMemo(() => new Map(positions.map(p => [p.id, p])), [positions])

  const entityTypes = useMemo(() => [...new Set(graphData?.entities?.map(e => e.type) ?? [])], [graphData?.entities])

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

  const handleResetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleAutoLayout = () => {
    setLayoutKey(prev => prev + 1)
  }

  const mainContent = (
    <div className="flex flex-1 flex-col bg-white dark:bg-gray-900">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="rounded p-2 text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800" title="放大">
            <ZoomIn size={16} />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="rounded p-2 text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800" title="缩小">
            <ZoomOut size={16} />
          </button>
          <button onClick={handleResetView} className="rounded p-2 text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800" title="重置视图">
            <RotateCcw size={16} />
          </button>
          <div className="h-6 w-px bg-gray-300 dark:bg-gray-700" />
          <button onClick={handleAutoLayout} className="rounded p-2 text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800" title="自动布局">
            <Network size={16} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <select className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900">
            <option>显示全部</option>
            <option>仅显示 2 度关系</option>
            <option>仅显示 1 度关系</option>
          </select>
          <button className="rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600">
            <Download size={14} className="mr-1 inline" />导出
          </button>
          <button
            onClick={() => setShowExtractDialog(true)}
            className="flex items-center gap-1 rounded bg-emerald-500 px-3 py-1.5 text-sm text-white hover:bg-emerald-600"
            title="用 AI 从笔记中提取实体和关系"
          >
            <Sparkles size={14} />
            从笔记提取
          </button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-gray-500">加载中...</div>
      ) : !graphData?.entities?.length ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
          <Network size={48} className="text-gray-300 dark:text-gray-700" />
          <p>知识图谱为空</p>
          <p className="text-sm text-gray-400">从笔记中提取实体和关系来构建知识图谱</p>
          <button
            onClick={() => setShowExtractDialog(true)}
            className="flex items-center gap-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm text-white hover:bg-emerald-600"
          >
            <Sparkles size={15} />
            从笔记提取
          </button>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 relative overflow-hidden">
          {svgSize.width === 0 || svgSize.height === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">正在初始化图谱...</div>
          ) : (
            <>
              <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2">
                {Object.entries(ENTITY_COLORS).slice(0, 5).map(([type, color]) => (
                  <span key={type} className="flex items-center gap-1 text-[10px] text-gray-500">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    {type}
                  </span>
                ))}
              </div>

              <svg
                ref={svgRef}
                className="w-full h-full cursor-grab active:cursor-grabbing"
                viewBox={`0 0 ${svgSize.width || 800} ${svgSize.height || 600}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <rect className="graph-bg" width={svgSize.width || 800} height={svgSize.height || 600} fill="transparent" />
                <defs>
                  <marker id="arrowhead" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                  </marker>
                </defs>
                <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                  {filteredRelations.map(rel => {
                    const source = posMap.get(rel.sourceEntityId)
                    const target = posMap.get(rel.targetEntityId)
                    if (!source || !target) return null
                    return (
                      <g key={rel.id}>
                        <line
                          x1={source.x} y1={source.y}
                          x2={target.x} y2={target.y}
                          stroke="#94a3b8"
                          strokeWidth={1.5}
                          markerEnd="url(#arrowhead)"
                          className="cursor-pointer hover:stroke-blue-500 hover:stroke-[2.5]"
                          onClick={() => deleteRelationMutation.mutate(rel.id)}
                        />
                        <text
                          x={(source.x + target.x) / 2}
                          y={(source.y + target.y) / 2 - 6}
                          textAnchor="middle"
                          className="text-[8px] fill-gray-400 pointer-events-none select-none"
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
                    return (
                      <g
                        key={entity.id}
                        className="cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); setSelectedEntityId(entity.id) }}
                      >
                        {isSelected && (
                          <circle cx={pos.x} cy={pos.y} r={nodeRadius + 4} fill="none" stroke={color} strokeWidth={2} opacity={0.4} />
                        )}
                        <circle
                          cx={pos.x} cy={pos.y} r={nodeRadius}
                          fill={color}
                          opacity={0.85}
                          className="hover:opacity-100 transition-opacity"
                        />
                        <text
                          x={pos.x} y={pos.y + 1}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="text-[9px] fill-white font-medium pointer-events-none select-none"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-emerald-500" />
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">从笔记提取知识图谱</h3>
              </div>
              <button
                onClick={() => setShowExtractDialog(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                AI 将分析笔记内容，提取实体（人物、技术、概念等）和它们之间的关系。此过程需要调用 LLM，可能需要 10-30 秒。
              </p>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
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
                        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {(note.content || '').slice(0, 80)}
                          {(note.content || '').length > 80 ? '...' : ''}
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
        <div className="border-b border-gray-200 p-4 dark:border-gray-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">实体</h2>
            <button className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" title="新建实体">
              <Plus size={14} />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              placeholder="搜索实体..."
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="all">全部类型</option>
              {entityTypes.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <button className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600">筛选</button>
          </div>
        </div>

        <div className="border-b border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/40">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-gray-500">实体总数</div>
              <div className="text-lg font-bold text-gray-800 dark:text-gray-100">{graphData?.entities?.length ?? 0}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-gray-500">关系总数</div>
              <div className="text-lg font-bold text-gray-800 dark:text-gray-100">{graphData?.relations?.length ?? 0}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredEntities.map(entity => {
            const color = ENTITY_COLORS[entity.type] || ENTITY_COLORS.custom
            const EntityIcon = ENTITY_ICONS[entity.type] || ENTITY_ICONS.custom
            return (
              <div
                key={entity.id}
                onClick={() => setSelectedEntityId(entity.id)}
                className={`cursor-pointer border-b border-gray-100 p-3 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50 ${selectedEntityId === entity.id ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded" style={{ backgroundColor: `${color}22` }}>
                      <EntityIcon size={15} style={{ color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{entity.name}</div>
                      <div className="text-xs text-gray-500">{entity.type}</div>
                    </div>
                  </div>
                  <span className={`shrink-0 text-xs ${selectedEntityId === entity.id ? 'font-medium text-blue-600' : 'text-gray-400'}`}>{entity.relationCount} 条关系</span>
                </div>
                {entity.description && <p className="mt-2 line-clamp-2 text-xs text-gray-600 dark:text-gray-400">{entity.description}</p>}
              </div>
            )
          })}
        </div>

        {selectedEntityId && entityDetail && (
          <div className="border-t border-gray-200 dark:border-gray-800 p-3 max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold truncate">{entityDetail.name}</h3>
              <button
                onClick={() => deleteEntityMutation.mutate(selectedEntityId)}
                className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-800 text-gray-500 mb-2">
              {entityDetail.type}
            </span>
            {entityDetail.description && (
              <p className="text-xs text-gray-500 mb-2">{entityDetail.description}</p>
            )}
            {entityDetail.relations.length > 0 && (
              <div className="mt-2">
                <h4 className="text-[10px] font-medium text-gray-400 mb-1">关系</h4>
                {entityDetail.relations.map(rel => (
                  <div key={rel.id} className="text-[10px] text-gray-500 py-0.5 flex items-center gap-1">
                    <span className="font-medium">{rel.sourceEntityName}</span>
                    <span className="text-blue-400">→{RELATION_LABELS[rel.relationType] || rel.relationType}→</span>
                    <span className="font-medium">{rel.targetEntityName}</span>
                  </div>
                ))}
              </div>
            )}
            {entityDetail.sourceNotes.length > 0 && (
              <div className="mt-2">
                <h4 className="text-[10px] font-medium text-gray-400 mb-1">来源笔记</h4>
                {entityDetail.sourceNotes.map(n => (
                  <div key={n.noteId} className="text-[10px] text-gray-500 py-0.5 truncate">{n.title}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
