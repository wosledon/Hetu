import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import AppLayout from '../components/AppLayout'
import WorkSidebar from '../components/work/WorkSidebar'
import WorkSessionArea from '../components/work/WorkSessionArea'
import WorkExplorer from '../components/work/WorkExplorer'
import { workProjectService } from '../services/workService'
import type { IWorkProject, IWorkSession } from '../types/work'

const DEFAULT_RIGHT_WIDTH = 560
const MIN_RIGHT_WIDTH = 320
const MAX_RIGHT_WIDTH = 1200

export default function WorkPage() {
  const queryClient = useQueryClient()
  const [preferredProject, setPreferredProject] = useState<IWorkProject | null>(null)
  const [selectedSession, setSelectedSession] = useState<IWorkSession | null>(null)
  // 跨组件联动：当前打开文件 / 打开文件请求 / 终端命令请求 / 对话上下文注入 / 编辑器插入请求
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [openFileRequest, setOpenFileRequest] = useState<{ path: string; nonce: number } | null>(null)
  const [terminalCommandRequest, setTerminalCommandRequest] = useState<{ command: string; nonce: number } | null>(null)
  const [pendingContext, setPendingContext] = useState<{ kind: 'selection'; path: string; text: string; nonce: number } | null>(null)
  const [insertRequest, setInsertRequest] = useState<{ text: string; path?: string; nonce: number } | null>(null)
  // 工作面板默认关闭：只在项目会话中按需从会话头部打开，不常驻右侧
  const [rightCollapsed, setRightCollapsed] = useState(true)
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH)
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null)

  const { data: projects = [] } = useQuery({
    queryKey: ['workProjects'],
    queryFn: workProjectService.getAll,
  })

  // 未显式选择时默认使用第一个项目
  const selectedProject = preferredProject ?? projects[0] ?? null

  const handleSelectProject = (project: IWorkProject) => {
    setPreferredProject(project)
  }

  const handleSelectSession = (session: IWorkSession) => {
    setSelectedSession(session)
    queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
  }

  const handleSessionUpdated = (session: IWorkSession) => {
    setSelectedSession(session)
  }

  const handleSessionCreated = (session: IWorkSession) => {
    queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
    queryClient.invalidateQueries({ queryKey: ['workProjects'] })
    setSelectedSession(session)
  }

  const requestOpenFile = (path: string) => setOpenFileRequest({ path, nonce: Date.now() })
  const requestRunCommand = (command: string) => setTerminalCommandRequest({ command, nonce: Date.now() })
  const addSelectionContext = (path: string, text: string) =>
    setPendingContext({ kind: 'selection', path, text, nonce: Date.now() })
  const requestInsertText = (text: string) => setInsertRequest({ text, path: undefined, nonce: Date.now() })

  // 拖拽调整右侧面板宽度
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = {
      startX: e.clientX,
      startWidth: rightWidth,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [rightWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragging.current
      if (!d) return
      // 手柄是右侧面板左边框：鼠标左移 = 面板变宽，右移 = 变窄
      const delta = e.clientX - d.startX
      const next = d.startWidth - delta
      setRightWidth(Math.min(MAX_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, next)))
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

  // 窗口过窄时：面板自动收起，宽度钳制在可用空间内，避免对话区被压没
  useEffect(() => {
    const SIDEBAR_W = 240
    const CHAT_MIN_W = 320
    const clamp = () => {
      const available = window.innerWidth - SIDEBAR_W - CHAT_MIN_W
      setRightWidth((w) => Math.max(MIN_RIGHT_WIDTH, Math.min(w, Math.max(MIN_RIGHT_WIDTH, available))))
      if (window.innerWidth < SIDEBAR_W + CHAT_MIN_W + MIN_RIGHT_WIDTH) setRightCollapsed(true)
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
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
            onProjectDeleted={(projectId) => {
              if (preferredProject?.id === projectId) setPreferredProject(null)
              if (selectedSession?.projectId === projectId) setSelectedSession(null)
            }}
            onSessionDeleted={(sessionId) => {
              if (selectedSession?.id === sessionId) setSelectedSession(null)
            }}
          />
          <WorkSessionArea
            project={selectedProject ?? undefined}
            session={selectedSession ?? undefined}
            onSessionUpdated={handleSessionUpdated}
            onSessionCreated={handleSessionCreated}
            activeFilePath={activeFilePath}
            onClearActiveFile={() => setActiveFilePath(null)}
            pendingContext={pendingContext}
            onOpenFilePath={requestOpenFile}
            onRunCommand={requestRunCommand}
            onInsertCode={requestInsertText}
            onTogglePanel={() => setRightCollapsed((v) => !v)}
            panelOpen={!rightCollapsed}
          />
          {/* 面板收起时不常驻右侧：只在项目会话内通过会话头部按钮打开 */}
          {!rightCollapsed && (
            <>
              <div
                onMouseDown={onDragStart}
                className="group relative w-px shrink-0 cursor-col-resize bg-gray-200 transition-colors hover:bg-blue-400 dark:bg-gray-800 dark:hover:bg-blue-500"
                title="拖拽调整右侧面板宽度"
              >
                <span className="absolute inset-y-0 -left-[3px] w-[7px]" />
              </div>
              <div className="flex shrink-0 flex-col border-l border-gray-200 dark:border-gray-800" style={{ width: rightWidth }}>
                <WorkExplorer
                  key={selectedProject?.id}
                  projectId={selectedProject?.id}
                  sessionId={selectedSession?.id}
                  onActiveFileChange={setActiveFilePath}
                  openFileRequest={openFileRequest}
                  onAddSelectionContext={addSelectionContext}
                  insertRequest={insertRequest}
                  commandRequest={terminalCommandRequest}
                />
              </div>
            </>
          )}
        </div>
      }
    />
  )
}
