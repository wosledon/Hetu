import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownUp, FolderInput, FolderTree, Plus, SlidersHorizontal } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import WorkSidebar, { type WorkSidebarHandle } from '../components/work/WorkSidebar'
import WorkSessionArea from '../components/work/WorkSessionArea'
import WorkExplorer from '../components/work/WorkExplorer'
import { workProjectService, workSessionService } from '../services/workService'
import { onUiAction } from '../services/signalrService'
import type { IWorkProject, IWorkSession } from '../types/work'
import { ContextMenu, PageContainer, SearchInput } from '../components/ui'
import { useUIStore } from '../stores/uiStore'
import type { ProjectGroupBy, ProjectSortBy } from '../stores/uiStore'

/** Code 页：左栏项目树（项目下挂编码会话），右侧为会话区与工作面板；主对话与普通对话已各自成页 */
const DEFAULT_RIGHT_WIDTH = 560
const MIN_RIGHT_WIDTH = 320
const MAX_RIGHT_WIDTH = 1200

/**
 * 最近打开的编码会话（projectId + sessionId）。
 * URL 参数只在带参访问时有效——点导航栏「Code」进去的是裸 /code，参数丢了会话还是回不来。
 * sessionStorage 按标签页保存，覆盖「切走再回来」与「刷新」，关掉标签页即忘。
 */
const LAST_SESSION_KEY = 'hetu:code-last-session'

const readLastSession = (): { projectId?: string; sessionId?: string } => {
  try {
    const raw = sessionStorage.getItem(LAST_SESSION_KEY)
    const parsed = raw ? (JSON.parse(raw) as { projectId?: string; sessionId?: string }) : {}
    return typeof parsed.sessionId === 'string' && parsed.sessionId ? parsed : {}
  } catch {
    return {}
  }
}

const writeLastSession = (projectId?: string, sessionId?: string) => {
  try {
    if (projectId && sessionId) sessionStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ projectId, sessionId }))
    else sessionStorage.removeItem(LAST_SESSION_KEY)
  } catch { /* 隐私模式下 sessionStorage 不可写，忽略 */ }
}

/**
 * 项目节的视图选择器：占住左栏标题行上原来搜索按钮的位置。
 * 一级菜单向右展开，内含搜索框；「分组方式 / 排序方式」各自再向右展开二级菜单（带当前值提示）。
 */
function ProjectViewMenu({ search, onSearchChange }: { search: string; onSearchChange: (value: string) => void }) {
  const { t } = useTranslation('work')
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const close = useCallback(() => setAnchor(null), [])
  const triggerRef = useRef<HTMLButtonElement>(null)

  const groupBy = useUIStore((state) => state.projectGroupBy)
  const sortBy = useUIStore((state) => state.projectSortBy)
  const setGroupBy = useUIStore((state) => state.setProjectGroupBy)
  const setSortBy = useUIStore((state) => state.setProjectSortBy)

  const groupOptions: Array<[ProjectGroupBy, string]> = [
    ['category', t('sidebar.groupByCategory')],
    ['group', t('sidebar.groupByGroup')],
    ['connection', t('sidebar.groupByConnection')],
    ['none', t('sidebar.groupByNone')],
  ]
  const sortOptions: Array<[ProjectSortBy, string]> = [
    ['manual', t('sidebar.sortByManual')],
    ['name', t('sidebar.sortByName')],
    ['updated', t('sidebar.sortByUpdated')],
    ['sessions', t('sidebar.sortBySessions')],
  ]
  const groupLabel = groupOptions.find(([v]) => v === groupBy)?.[1] ?? ''
  const sortLabel = sortOptions.find(([v]) => v === sortBy)?.[1] ?? ''

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4 })
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => (anchor ? close() : openPanel())}
        title={t('page.projectView')}
        aria-label={t('page.projectView')}
        aria-expanded={!!anchor}
        className={`shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 ${
          anchor || search ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : ''
        }`}
      >
        <SlidersHorizontal size={15} />
      </button>
      <ContextMenu
        anchor={anchor}
        onClose={close}
        minWidth={196}
        header={
          <SearchInput
            size="sm"
            autoFocus
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('page.searchProjectsPlaceholder')}
            className="w-full"
          />
        }
        items={[
          {
            key: 'group',
            label: t('page.groupBy'),
            icon: <FolderTree size={14} className="shrink-0 text-gray-400" />,
            hint: groupLabel,
            items: groupOptions.map(([value, label]) => ({
              key: value,
              label,
              checked: groupBy === value,
              onSelect: () => setGroupBy(value),
            })),
          },
          {
            key: 'sort',
            label: t('page.sortBy'),
            icon: <ArrowDownUp size={14} className="shrink-0 text-gray-400" />,
            hint: sortLabel,
            items: sortOptions.map(([value, label]) => ({
              key: value,
              label,
              checked: sortBy === value,
              onSelect: () => setSortBy(value),
            })),
          },
        ]}
      />
    </>
  )
}

/** 左栏顶部工具条：项目标题 + 数量 + 视图菜单（搜索/分组/排序）+ 新建项目 */
function SectionHeader({
  icon: Icon,
  title,
  count,
  onAdd,
  addTitle,
  trailing,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  count?: number
  onAdd: () => void
  addTitle: string
  /** 项目节的视图菜单：搜索 + 分组 + 排序收在一处 */
  trailing?: ReactNode
}) {
  const iconBtn = 'shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
  return (
    <div className="shrink-0 border-b border-gray-200/80 dark:border-white/[0.07]">
      <div className="flex h-14 items-center gap-1 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5">
          <Icon size={16} className="shrink-0 text-gray-500 dark:text-gray-400" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="shrink-0 rounded-full bg-gray-100 glass px-1.5 text-[10px] font-medium leading-4 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
              {count}
            </span>
          )}
        </div>
        {trailing}
        <button onClick={onAdd} title={addTitle} aria-label={addTitle} className={iconBtn}>
          <Plus size={15} />
        </button>
      </div>
    </div>
  )
}

export default function WorkPage() {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // 最近一次打开的编码会话：URL 参数优先，裸 /code 时用它兜底
  const [lastSession] = useState(readLastSession)

  // 左栏工具条上的搜索与新建入口（搜索词下发给项目列表，新建交给子组件自己的流程）
  const [projectSearch, setProjectSearch] = useState('')
  const workSidebarRef = useRef<WorkSidebarHandle>(null)

  // —— 项目：项目/会话选择 ——
  const [preferredProject, setPreferredProject] = useState<IWorkProject | null>(null)
  // 显式选中的会话；为空时回落到 URL 上的 session id（切走再回来 / 刷新都能回到同一处）。
  // 用派生而非 effect 回填：effect 里 setState 会多一次渲染，也容易和用户操作打架
  const [chosenSession, setChosenSession] = useState<IWorkSession | null>(null)
  const setSelectedSession = setChosenSession
  // 跨组件联动：当前打开文件 / 打开文件请求 / 终端命令请求 / 对话上下文注入 / 编辑器插入请求
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [openFileRequest, setOpenFileRequest] = useState<{ path: string; nonce: number } | null>(null)
  const [terminalCommandRequest, setTerminalCommandRequest] = useState<{ command: string; nonce: number } | null>(null)
  const [pendingContext, setPendingContext] = useState<{ kind: 'selection'; path: string; text: string; nonce: number } | null>(null)
  const [insertRequest, setInsertRequest] = useState<{ text: string; path?: string; nonce: number } | null>(null)
  // 工作面板默认关闭：只在项目会话中按需从会话头部打开，不常驻右侧
  const [rightCollapsed, setRightCollapsed] = useState(true)
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH)
  // 智能体唤起面板请求（SignalR open_panel）：nonce 保证重复唤起同一面板也会触发
  const [panelRequest, setPanelRequest] = useState<{ panel: string; url?: string; path?: string; nonce: number } | null>(null)
  // PR 面板「交给 Agent 修」：把收集到的反馈插进会话输入框（nonce 保证多次交接都生效）
  const [agentPromptRequest, setAgentPromptRequest] = useState<{ text: string; nonce: number } | null>(null)
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null)

  // 后端主动推的 open_panel：展开工作面板，再由 WorkExplorer 激活对应标签；
  // files 带 path 时改走打开文件请求，让编辑器直接展示该文件
  useEffect(() => onUiAction('open_panel', (payload) => {
    const panel = typeof payload.panel === 'string' ? payload.panel : ''
    if (!panel) return
    const url = typeof payload.url === 'string' ? payload.url : undefined
    const path = typeof payload.path === 'string' ? payload.path : undefined
    setRightCollapsed(false)
    setPanelRequest((prev) => ({ panel, url, path, nonce: (prev?.nonce ?? 0) + 1 }))
    if (panel === 'files' && path) setOpenFileRequest((prev) => ({ path, nonce: (prev?.nonce ?? 0) + 1 }))
  }), [])

  const { data: projects = [] } = useQuery({
    queryKey: ['workProjects'],
    queryFn: workProjectService.getAll,
  })

  // 会话选择只放在组件 state 里：切去别的页面再回来 WorkPage 重挂载，chosenSession 丢光，
  // 用户回到 /code 看到的是空页面（「会话就断了」）。URL 参数优先，其次 sessionStorage 里
  // 最近打开的会话（点导航栏「Code」进来是裸 /code，没有参数）。
  const sessionParam = searchParams.get('session') ?? lastSession.sessionId ?? null
  const projectParam = searchParams.get('project') ?? lastSession.projectId ?? null

  // 未显式选择时默认使用第一个项目
  const selectedProject = preferredProject ?? projects.find((p) => p.id === projectParam) ?? projects[0] ?? null

  const { data: paramSession } = useQuery({
    queryKey: ['workSession', sessionParam],
    queryFn: () => workSessionService.getById(sessionParam!),
    enabled: !!sessionParam && chosenSession?.id !== sessionParam,
  })
  const selectedSession = chosenSession ?? paramSession ?? null

  /** 同步 URL 上的 project / session，并记进 sessionStorage：刷新与「切走再回来」都回到同一处 */
  const syncSelectionToUrl = (projectId?: string, sessionId?: string) => {
    writeLastSession(projectId, sessionId)
    const params = new URLSearchParams(searchParams)
    if (projectId) params.set('project', projectId)
    if (sessionId) params.set('session', sessionId)
    else params.delete('session')
    setSearchParams(params, { replace: true })
  }

  const handleSelectProject = (project: IWorkProject) => {
    setPreferredProject(project)
    setSelectedSession((prev) => (prev?.projectId === project.id ? prev : null))
    syncSelectionToUrl(project.id, undefined)
  }

  const handleSelectSession = (session: IWorkSession) => {
    setSelectedSession(session)
    queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
    syncSelectionToUrl(session.projectId, session.id)
  }

  const handleSessionUpdated = (session: IWorkSession) => {
    setSelectedSession(session)
  }

  const handleSessionCreated = (session: IWorkSession) => {
    queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
    queryClient.invalidateQueries({ queryKey: ['workProjects'] })
    setSelectedSession(session)
    // 草稿会话落库后补上 URL：此前 id 为空写不进去
    syncSelectionToUrl(session.projectId, session.id)
  }

  /**
   * 新建会话：只放一个「草稿会话」占位（id 为空），真正发第一条消息时才落库，
   * 避免点一下就在侧栏留下一条空会话。
   */
  const handleStartDraftSession = (project: IWorkProject) => {
    const now = new Date().toISOString()
    setPreferredProject(project)
    setSelectedSession({
      id: '',
      projectId: project.id,
      title: '',
      messageCount: 0,
      permissionMode: 'ask',
      agentMode: 'interactive',
      turnCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      createdAt: now,
      updatedAt: now,
    })
    const params = new URLSearchParams(searchParams)
    params.set('project', project.id)
    setSearchParams(params, { replace: true })
  }

  const requestOpenFile = (path: string) => setOpenFileRequest({ path, nonce: Date.now() })
  const requestRunCommand = (command: string) => setTerminalCommandRequest({ command, nonce: Date.now() })
  const addSelectionContext = (path: string, text: string) =>
    setPendingContext({ kind: 'selection', path, text, nonce: Date.now() })
  const requestInsertText = (text: string) => setInsertRequest({ text, path: undefined, nonce: Date.now() })
  const handoffToAgent = (text: string) => setAgentPromptRequest({ text, nonce: Date.now() })

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
    const SIDEBAR_W = 256
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
        <PageContainer variant="fill">
          {/* 左栏：项目树（项目下挂会话），左栏工具条负责搜索 / 分组 / 新建 */}
          <div className="flex w-64 shrink-0 flex-col border-r border-gray-200/80 bg-white/35 dark:border-white/[0.07] dark:bg-slate-950/20">
            <SectionHeader
              icon={FolderInput}
              title={t('page.projectSection')}
              count={projects.length}
              onAdd={() => workSidebarRef.current?.startCreateProject()}
              addTitle={t('page.newProject')}
              trailing={<ProjectViewMenu search={projectSearch} onSearchChange={setProjectSearch} />}
            />
            <div className="flex min-h-0 flex-1 flex-col">
              <WorkSidebar
                ref={workSidebarRef}
                embedded
                search={projectSearch}
                selectedProjectId={selectedProject?.id}
                selectedSessionId={selectedSession?.id}
                onSelectProject={handleSelectProject}
                onSelectSession={handleSelectSession}
                onStartDraftSession={handleStartDraftSession}
                onProjectDeleted={(projectId) => {
                  if (preferredProject?.id === projectId) setPreferredProject(null)
                  if (selectedSession?.projectId === projectId) setSelectedSession(null)
                }}
                onSessionDeleted={(sessionId) => {
                  if (selectedSession?.id === sessionId) {
                    setSelectedSession(null)
                    syncSelectionToUrl(undefined, undefined)
                  }
                }}
              />
            </div>
          </div>

          <WorkSessionArea
            key={selectedSession?.id || selectedSession?.projectId || 'no-session'}
            project={selectedProject ?? undefined}
            session={selectedSession ?? undefined}
            onSessionUpdated={handleSessionUpdated}
            onSessionCreated={handleSessionCreated}
            onStartDraft={() => selectedProject && handleStartDraftSession(selectedProject)}
            activeFilePath={activeFilePath}
            onClearActiveFile={() => setActiveFilePath(null)}
            pendingContext={pendingContext}
            agentPromptRequest={agentPromptRequest}
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
                title={t('page.dragPanelWidth')}
              >
                <span className="absolute inset-y-0 -left-[3px] w-[7px]" />
              </div>
              <div className="flex shrink-0 flex-col border-l border-gray-200 dark:border-gray-800" style={{ width: rightWidth }}>
                <WorkExplorer
                  key={selectedProject?.id}
                  projectId={selectedProject?.id}
                  sessionId={selectedSession?.id}
                  sessionTitle={selectedSession?.title}
                  panelRequest={panelRequest}
                  onActiveFileChange={setActiveFilePath}
                  openFileRequest={openFileRequest}
                  onAddSelectionContext={addSelectionContext}
                  onHandoffToAgent={handoffToAgent}
                  insertRequest={insertRequest}
                  commandRequest={terminalCommandRequest}
                />
              </div>
            </>
          )}
        </PageContainer>
      }
    />
  )
}
