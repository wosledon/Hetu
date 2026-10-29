import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import WhiteboardCanvas from '../components/whiteboard/WhiteboardCanvas'
import WhiteboardPresentation from '../components/whiteboard/WhiteboardPresentation'
import WhiteboardToolbar, { type WhiteboardSaveState } from '../components/whiteboard/WhiteboardToolbar'
import { whiteboardService } from '../services/whiteboardService'
import type {
  IWhiteboardElement, IWhiteboardScene, IWhiteboardStyle, WhiteboardCanvasHandle, WhiteboardTool,
} from '../types/whiteboard'
import {
  DEFAULT_STYLE, EMPTY_SCENE, applyStyleToElement, exportPng, exportSvg, fitViewport, layoutElements,
  parseScene, refreshConnectors, serializeScene, type AutoLayoutDirection,
} from '../utils/whiteboard'
import { Button, PageContainer } from '../components/ui'

/** 白板编辑器：工具栏 + 画布 + 自动保存 + 演示 */
export default function WhiteboardEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation('whiteboard')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const boardQuery = useQuery({
    queryKey: ['whiteboard', id],
    queryFn: () => whiteboardService.get(id as string),
    enabled: !!id,
  })
  const boardsQuery = useQuery({
    queryKey: ['whiteboards'],
    queryFn: () => whiteboardService.list(1, 100),
  })

  const [scene, setScene] = useState<IWhiteboardScene>(EMPTY_SCENE)
  const [sceneReady, setSceneReady] = useState(false)
  const [tool, setTool] = useState<WhiteboardTool>('select')
  const [style, setStyle] = useState<IWhiteboardStyle>(DEFAULT_STYLE)
  const [snap, setSnap] = useState(true)
  const [selection, setSelection] = useState<IWhiteboardElement[]>([])
  const [saveState, setSaveState] = useState<WhiteboardSaveState>('saved')
  const [presenting, setPresenting] = useState(false)
  const [notice, setNotice] = useState('')
  const [historySizes, setHistorySizes] = useState({ past: 0, future: 0 })

  const svgRef = useRef<SVGSVGElement | null>(null)
  const canvasHandle = useRef<WhiteboardCanvasHandle | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const pastRef = useRef<IWhiteboardScene[]>([])
  const futureRef = useRef<IWhiteboardScene[]>([])
  const loadedIdRef = useRef<string | null>(null)
  const savedSceneRef = useRef('')

  const board = boardQuery.data ?? null
  const boardName = board?.name ?? ''

  /* ── 加载：按画板 id 去重，切换画板（演示翻页）时重新装载 ── */

  useEffect(() => {
    if (!boardQuery.data || loadedIdRef.current === boardQuery.data.id) return
    loadedIdRef.current = boardQuery.data.id
    savedSceneRef.current = boardQuery.data.scene
    setScene(parseScene(boardQuery.data.scene))
    pastRef.current = []
    futureRef.current = []
    setHistorySizes({ past: 0, future: 0 })
    setSaveState('saved')
    setSceneReady(true)
  }, [boardQuery.data])

  /* ── 场景变更与历史栈 ── */

  const applyScene = useCallback((next: IWhiteboardScene, historySnapshot?: IWhiteboardScene) => {
    if (historySnapshot) {
      pastRef.current = [...pastRef.current, historySnapshot].slice(-100)
      futureRef.current = []
      setHistorySizes({ past: pastRef.current.length, future: 0 })
    }
    setScene(next)
  }, [])

  const undo = useCallback(() => {
    const previous = pastRef.current[pastRef.current.length - 1]
    if (!previous) return
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [...futureRef.current, scene]
    setScene(previous)
    setHistorySizes({ past: pastRef.current.length, future: futureRef.current.length })
  }, [scene])

  const redo = useCallback(() => {
    const next = futureRef.current[futureRef.current.length - 1]
    if (!next) return
    futureRef.current = futureRef.current.slice(0, -1)
    pastRef.current = [...pastRef.current, scene]
    setScene(next)
    setHistorySizes({ past: pastRef.current.length, future: futureRef.current.length })
  }, [scene])

  const canUndo = historySizes.past > 0
  const canRedo = historySizes.future > 0

  /* ── 自动保存：停笔 800ms 后写回 ── */

  useEffect(() => {
    if (!sceneReady || !id) return
    const serialized = serializeScene(scene)
    if (serialized === savedSceneRef.current) {
      setSaveState('saved')
      return
    }
    setSaveState('dirty')
    const timer = window.setTimeout(() => {
      setSaveState('saving')
      whiteboardService.update(id, { scene: serialized })
        .then(() => {
          savedSceneRef.current = serialized
          setSaveState('saved')
          void queryClient.invalidateQueries({ queryKey: ['whiteboards'] })
        })
        .catch(() => setSaveState('dirty'))
    }, 800)
    return () => window.clearTimeout(timer)
  }, [scene, sceneReady, id, queryClient])

  /* ── 视图操作 ── */

  const stageSize = () => ({
    width: stageRef.current?.clientWidth ?? 960,
    height: stageRef.current?.clientHeight ?? 600,
  })

  const zoomBy = useCallback((factor: number) => {
    const { width, height } = stageSize()
    const zoom = Math.min(4, Math.max(0.1, scene.viewport.zoom * factor))
    const ratio = zoom / scene.viewport.zoom
    setScene({
      ...scene,
      viewport: {
        zoom,
        x: width / 2 - (width / 2 - scene.viewport.x) * ratio,
        y: height / 2 - (height / 2 - scene.viewport.y) * ratio,
      },
    })
  }, [scene])

  const zoomReset = useCallback(() => {
    setScene({ ...scene, viewport: { x: 0, y: 0, zoom: 1 } })
  }, [scene])

  const zoomFit = useCallback(() => {
    const { width, height } = stageSize()
    setScene({ ...scene, viewport: fitViewport(scene.elements, width, height) })
  }, [scene])

  /* ── 样式：同时作用于新建元素与当前选中 ── */

  const handleStyleChange = useCallback((next: IWhiteboardStyle) => {
    setStyle(next)
    if (selection.length === 0) return
    const ids = new Set(selection.map((element) => element.id))
    applyScene(
      { ...scene, elements: scene.elements.map((element) => (ids.has(element.id) ? applyStyleToElement(element, next) : element)) },
      scene,
    )
  }, [applyScene, scene, selection])

  /* ── 导出 ── */

  const flashNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }

  const handleExportPng = async () => {
    if (!svgRef.current) return
    try {
      await exportPng(svgRef.current, `${boardName || 'whiteboard'}.png`)
    } catch {
      flashNotice(t('exportFailed'))
    }
  }

  const handleExportSvg = () => {
    if (!svgRef.current) return
    try {
      exportSvg(svgRef.current, `${boardName || 'whiteboard'}.svg`)
    } catch {
      flashNotice(t('exportFailed'))
    }
  }

  /* ── 自动布局：按连接关系重排图形，再适应视图 ── */

  const [layoutDirection, setLayoutDirection] = useState<AutoLayoutDirection>('LR')

  const handleAutoLayout = useCallback(() => {
    const { width, height } = stageSize()
    const elements = refreshConnectors(layoutElements(scene.elements, { direction: layoutDirection }))
    applyScene({ elements, viewport: fitViewport(elements, width, height) }, scene)
  }, [applyScene, scene, layoutDirection])

  const canAutoLayout = useMemo(
    () => scene.elements.some((element) => element.type === 'connector' && element.fromId && element.toId),
    [scene.elements],
  )

  /* ── 快捷键 ── */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
        return
      const meta = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (meta && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (meta && key === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (meta && key === 'd') {
        event.preventDefault()
        canvasHandle.current?.duplicateSelection()
        return
      }
      if (meta && key === 'a') {
        event.preventDefault()
        canvasHandle.current?.selectAll()
        return
      }
      if (meta && (key === ']' || key === '[')) {
        event.preventDefault()
        canvasHandle.current?.reorderSelection(key === ']')
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        canvasHandle.current?.deleteSelection()
        return
      }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const step = event.shiftKey ? 40 : 10
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        canvasHandle.current?.nudgeSelection(dx, dy)
        return
      }
      const toolByKey: Record<string, WhiteboardTool> = {
        v: 'select', h: 'pan', r: 'rect', o: 'ellipse', d: 'diamond',
        t: 'text', p: 'pen', l: 'connector', e: 'eraser',
      }
      const nextTool = toolByKey[key]
      if (nextTool && !meta) {
        event.preventDefault()
        setTool(nextTool)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  /* ── 演示：在多张画板间翻页 ── */

  const boards = boardsQuery.data?.items ?? []
  const boardIndex = boards.findIndex((item) => item.id === id)
  const goBoard = (offset: number) => {
    const next = boards[boardIndex + offset]
    if (next) navigate(`/whiteboard/${next.id}`)
  }

  if (boardQuery.isError) {
    return (
      <AppLayout
        showSidebar={false}
        mainContent={
          <PageContainer variant="centered">
            <div className="flex flex-col items-center gap-4 py-24 text-center">
              <h1 className="text-lg font-semibold text-gray-700 dark:text-gray-200">{t('page.notFound')}</h1>
              <Button variant="primary" tone="blue" onClick={() => navigate('/whiteboard')}>
                <ArrowLeft size={15} /> {t('page.backToList')}
              </Button>
            </div>
          </PageContainer>
        }
      />
    )
  }

  if (!board) {
    return (
      <AppLayout
        showSidebar={false}
        mainContent={
          <PageContainer variant="fill" className="items-center justify-center">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </PageContainer>
        }
      />
    )
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <PageContainer variant="fill" className="flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-gray-200 bg-white glass px-3 py-2 dark:border-white/[0.08] dark:bg-gray-900/50">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/whiteboard')}>
              <ArrowLeft size={15} /> {t('page.backToList')}
            </Button>
            <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">{boardName}</span>
            <span className="text-xs text-gray-400">
              {scene.elements.length} {t('page.elementCount')}
            </span>
            {notice && <span className="text-xs text-red-500">{notice}</span>}
          </div>

          <WhiteboardToolbar
            tool={tool}
            onToolChange={setTool}
            style={style}
            onStyleChange={handleStyleChange}
            snap={snap}
            onSnapChange={setSnap}
            zoom={scene.viewport.zoom}
            onZoomIn={() => zoomBy(1.2)}
            onZoomOut={() => zoomBy(1 / 1.2)}
            onZoomReset={zoomReset}
            onZoomFit={zoomFit}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onDelete={() => canvasHandle.current?.deleteSelection()}
            onDuplicate={() => canvasHandle.current?.duplicateSelection()}
            onExportPng={() => void handleExportPng()}
            onExportSvg={handleExportSvg}
            onPresent={() => setPresenting(true)}
            saveState={saveState}
            hasSelection={selection.length > 0}
            layoutDirection={layoutDirection}
            onLayoutDirectionChange={setLayoutDirection}
            onAutoLayout={handleAutoLayout}
            canAutoLayout={canAutoLayout}
          />

          <div ref={stageRef} className="min-h-0 min-w-0 flex-1">
            <WhiteboardCanvas
              scene={scene}
              tool={tool}
              style={style}
              snap={snap}
              onSceneChange={applyScene}
              onSelectionChange={setSelection}
              svgRef={svgRef}
              handleRef={canvasHandle}
            />
          </div>
        </PageContainer>
      }
    >
      {presenting && (
        <WhiteboardPresentation
          boardName={boardName}
          boardIndex={boardIndex + 1}
          boardCount={boards.length}
          scene={scene}
          onExit={() => setPresenting(false)}
          onPrev={() => goBoard(-1)}
          onNext={() => goBoard(1)}
        />
      )}
    </AppLayout>
  )
}
