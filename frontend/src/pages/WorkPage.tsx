import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PanelRightOpen } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import WorkSidebar from '../components/work/WorkSidebar'
import WorkSessionArea from '../components/work/WorkSessionArea'
import WorkExplorer from '../components/work/WorkExplorer'
import WorkTerminal from '../components/work/WorkTerminal'
import { workProjectService } from '../services/workService'
import type { IWorkProject, IWorkSession } from '../types/work'

const DEFAULT_RIGHT_WIDTH = 560
const MIN_RIGHT_WIDTH = 320
const MAX_RIGHT_WIDTH = 1200
const DEFAULT_TERMINAL_HEIGHT = 208
const MIN_TERMINAL_HEIGHT = 96
const MAX_TERMINAL_HEIGHT = 480

export default function WorkPage() {
  const queryClient = useQueryClient()
  const [selectedProject, setSelectedProject] = useState<IWorkProject | null>(null)
  const [selectedSession, setSelectedSession] = useState<IWorkSession | null>(null)
  const [showTerminal, setShowTerminal] = useState(true)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH)
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT)
  const dragging = useRef<{ type: 'width' | 'height'; startX: number; startY: number; startWidth: number; startHeight: number } | null>(null)

  const { data: projects = [] } = useQuery({
    queryKey: ['workProjects'],
    queryFn: workProjectService.getAll,
  })

  // 默认选中第一个项目
  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0])
    }
  }, [projects, selectedProject])

  const handleSelectProject = (project: IWorkProject) => {
    setSelectedProject(project)
  }

  const handleSelectSession = (session: IWorkSession) => {
    setSelectedSession(session)
    queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
  }

  const handleSessionUpdated = (session: IWorkSession) => {
    setSelectedSession(session)
  }

  // 拖拽调宽/调高
  const onDragStart = useCallback((type: 'width' | 'height') => (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rightWidth,
      startHeight: terminalHeight,
    }
    document.body.style.cursor = type === 'width' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [rightWidth, terminalHeight])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragging.current
      if (!d) return
      if (d.type === 'width') {
        // 手柄是右侧面板左边框：鼠标左移 = 面板变宽，右移 = 变窄
        const delta = e.clientX - d.startX
        const next = d.startWidth - delta
        setRightWidth(Math.min(MAX_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, next)))
      } else {
        // 手柄是终端上边框：鼠标上移 = 终端变高，下移 = 变矮
        const delta = e.clientY - d.startY
        const next = d.startHeight - delta
        setTerminalHeight(Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, next)))
      }
    }
    const onUp = () => {
      dragging.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex h-full min-w-0 flex-1">
          <WorkSidebar
            selectedProjectId={selectedProject?.id}
            selectedSessionId={selectedSession?.id}
            onSelectProject={handleSelectProject}
            onSelectSession={handleSelectSession}
          />
          <WorkSessionArea
            project={selectedProject ?? undefined}
            session={selectedSession ?? undefined}
            onSessionUpdated={handleSessionUpdated}
          />
          {!rightCollapsed && (
            <div
              onMouseDown={onDragStart('width')}
              className="w-1 shrink-0 cursor-col-resize bg-gray-200/70 transition-colors hover:bg-blue-400 dark:bg-gray-800 dark:hover:bg-blue-600"
              title="拖拽调整右侧面板宽度"
            />
          )}
          {rightCollapsed ? (
            <button
              onClick={() => setRightCollapsed(false)}
              className="flex w-8 shrink-0 flex-col items-center justify-center border-l border-gray-200 bg-gray-50 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
              title="展开右侧面板"
            >
              <PanelRightOpen size={14} />
            </button>
          ) : (
            <div className="flex shrink-0 flex-col border-l border-gray-200 dark:border-gray-800" style={{ width: rightWidth }}>
              <div className="flex min-h-0 flex-1">
                <WorkExplorer
                  projectId={selectedProject?.id}
                  sessionId={selectedSession?.id}
                  onCollapse={() => setRightCollapsed(true)}
                />
              </div>
              {showTerminal && (
                <>
                  <div
                    onMouseDown={onDragStart('height')}
                    className="h-1 shrink-0 cursor-row-resize bg-gray-200/70 transition-colors hover:bg-blue-400 dark:bg-gray-800 dark:hover:bg-blue-600"
                    title="拖拽调整终端高度"
                  />
                  <WorkTerminal
                    projectId={selectedProject?.id}
                    onClose={() => setShowTerminal(false)}
                    height={terminalHeight}
                  />
                </>
              )}
            </div>
          )}
        </div>
      }
    />
  )
}
