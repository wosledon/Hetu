import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownUp, ChevronDown, FolderInput, FolderTree, MessageSquare, Plus, Search, SlidersHorizontal } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ChatTree, { type ChatTreeHandle } from '../components/ChatTree'
import ChatMessageArea from '../components/ChatMessageArea'
import WorkSidebar, { type WorkSidebarHandle } from '../components/work/WorkSidebar'
import WorkSessionArea from '../components/work/WorkSessionArea'
import WorkExplorer from '../components/work/WorkExplorer'
import { chatGroupService, chatTopicService } from '../services/chatService'
import { workProjectService, workSessionService } from '../services/workService'
import { onUiAction } from '../services/signalrService'
import type { IChatGroup, IChatTopic } from '../types'
import type { IWorkProject, IWorkSession } from '../types/work'
import { ContextMenu, PageContainer, SearchInput } from '../components/ui'
import { useUIStore } from '../stores/uiStore'
import type { ProjectGroupBy, ProjectSortBy } from '../stores/uiStore'

/** 合并后的会话页：左栏一级菜单「会话 / 项目」，右侧共用同一套聊天区（Code 会话叠加项目能力）；主对话已单独成页 */
type CodeView = 'chat' | 'code'

const DEFAULT_RIGHT_WIDTH = 560
const MIN_RIGHT_WIDTH = 320
const MAX_RIGHT_WIDTH = 1200
/** 一级菜单「会话 / 项目」展开状态（主对话始终为一级入口） */
const SECTIONS_STORAGE_KEY = 'hetu:code-sidebar-sections'

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

interface SidebarSections {
  chat: boolean
  project: boolean
}

const loadSections = (): SidebarSections => {
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE_KEY)
    if (!raw) return { chat: true, project: true }
    const parsed = JSON.parse(raw) as Partial<SidebarSections>
    return { chat: parsed.chat !== false, project: parsed.project !== false }
  } catch {
    return { chat: true, project: true }
  }
}

/**
 * 项目节的视图选择器：占住一级菜单行上原来搜索按钮的位置。
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

/** 一级菜单行：图标 + 名称 + 数量 + 搜索/新建；点击行本体折叠分区，搜索输入在行下方展开 */
function SectionHeader({
  icon: Icon,
  title,
  count,
  expanded,
  onToggle,
  searchOpen,
  onToggleSearch,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  onAdd,
  addTitle,
  trailing,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  count?: number
  expanded: boolean
  onToggle: () => void
  searchOpen?: boolean
  onToggleSearch?: () => void
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  onAdd: () => void
  addTitle: string
  /** 覆盖默认的搜索按钮（项目节的视图菜单：搜索 + 分组 + 排序收在一处） */
  trailing?: ReactNode
}) {
  const iconBtn = 'shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
  const { t } = useTranslation('work')
  return (
    <div className="shrink-0 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]"
        >
          <ChevronDown size={15} className={`shrink-0 text-gray-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
          <Icon size={16} className="shrink-0 text-gray-500 dark:text-gray-400" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="shrink-0 rounded-full bg-gray-100 glass px-1.5 text-[10px] font-medium leading-4 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
              {count}
            </span>
          )}
        </button>
        {trailing ?? (onToggleSearch && (
          <button
            onClick={onToggleSearch}
            title={searchOpen ? t('page.collapseSearch') : t('common:search')}
            aria-label={t('common:search')}
            aria-pressed={searchOpen}
            className={`${iconBtn} ${searchOpen ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : ''}`}
          >
            <Search size={15} />
          </button>
        ))}
        <button onClick={onAdd} title={addTitle} aria-label={addTitle} className={iconBtn}>
          <Plus size={15} />
        </button>
      </div>
      {searchOpen && onSearchChange && searchValue !== undefined && (
        <div className="relative px-2 pb-2">
          <SearchInput tone="blue" size="sm"
            autoFocus
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full"
          />
        </div>
      )}
    </div>
  )
}

export default function WorkPage() {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // 最近一次打开的编码会话：URL 参数优先，裸 /code 时用它兜底
  const [lastSession] = useState(readLastSession)
  // 右侧聊天区当前绑定的是对话话题还是项目会话
  const [view, setView] = useState<CodeView>(() =>
    (searchParams.get('project') ?? lastSession.projectId) ? 'code' : 'chat')

  // 一级菜单展开状态：主对话始终可见，会话 / 项目可折叠
  const [sections, setSections] = useState<SidebarSections>(loadSections)
  const toggleSection = (key: keyof SidebarSections) => setSections((prev) => ({ ...prev, [key]: !prev[key] }))
  // 一级菜单上的搜索与新建入口（搜索词下发给两个列表，新建交给子组件自己的流程）
  const [chatSearch, setChatSearch] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const chatTreeRef = useRef<ChatTreeHandle>(null)
  const workSidebarRef = useRef<WorkSidebarHandle>(null)

  useEffect(() => {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(sections))
  }, [sections])

  // —— 对话：分组/话题选择（原对话页）——
  // undefined 表示跟随默认选择（首个分组/话题），null 表示显式清空
  const [groupChoice, setGroupChoice] = useState<IChatGroup | null | undefined>(undefined)
  const [topicChoice, setTopicChoice] = useState<IChatTopic | null | undefined>(undefined)

  const { data: groups = [] } = useQuery({
    queryKey: ['chatGroups'],
    queryFn: chatGroupService.getAll,
  })

  const activeGroup = groupChoice ?? groups[0] ?? null

  const { data: topics = [] } = useQuery({
    queryKey: ['chatTopics', activeGroup?.id],
    queryFn: () => (activeGroup ? chatTopicService.getByGroup(activeGroup.id) : Promise.resolve([])),
    enabled: !!activeGroup,
  })

  // 普通分组默认选中第一个话题（主对话已单独成页，不在这里回落）
  const defaultTopic = topics[0] ?? null
  const activeTopic = topicChoice === undefined ? defaultTopic : topicChoice

  const handleSelectGroup = useCallback((group: IChatGroup) => {
    setGroupChoice(group)
    setTopicChoice(undefined)
    setView('chat')
    setSections((prev) => (prev.chat ? prev : { ...prev, chat: true }))
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  const handleSelectTopic = useCallback((topic: IChatTopic) => {
    setTopicChoice(topic)
    setView('chat')
    setSections((prev) => (prev.chat ? prev : { ...prev, chat: true }))
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  const handleDeleteTopic = useCallback(() => setTopicChoice(null), [])

  /** 新建话题：只放一个「草稿话题」占位（id 为空），真正发第一条消息时才落库 */
  const handleStartDraftTopic = useCallback((group: IChatGroup) => {
    const now = new Date().toISOString()
    setGroupChoice(group)
    setTopicChoice({
      id: '',
      groupId: group.id,
      title: '',
      messageCount: 0,
      isPinned: false,
      noteSyncStatus: 'synced',
      createdAt: now,
      updatedAt: now,
    } as IChatTopic)
    setView('chat')
    setSections((prev) => (prev.chat ? prev : { ...prev, chat: true }))
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  // —— 项目：项目/会话选择（原 Code 页）——
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

  // 后端主动推的 open_panel：切到会话视图、展开工作面板，再由 WorkExplorer 激活对应标签；
  // files 带 path 时改走打开文件请求，让编辑器直接展示该文件
  useEffect(() => onUiAction('open_panel', (payload) => {
    const panel = typeof payload.panel === 'string' ? payload.panel : ''
    if (!panel) return
    const url = typeof payload.url === 'string' ? payload.url : undefined
    const path = typeof payload.path === 'string' ? payload.path : undefined
    setView('code')
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
    setView('code')
    setSections((prev) => (prev.project ? prev : { ...prev, project: true }))
    syncSelectionToUrl(project.id, undefined)
  }

  const handleSelectSession = (session: IWorkSession) => {
    setSelectedSession(session)
    setView('code')
    setSections((prev) => (prev.project ? prev : { ...prev, project: true }))
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
    setView('code')
    setSections((prev) => (prev.project ? prev : { ...prev, project: true }))
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
    setView('code')
    setSections((prev) => (prev.project ? prev : { ...prev, project: true }))
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
          {/* 左栏一级菜单：会话（会话组） / 项目（项目与会话）；主对话已提到左侧固定菜单 */}
          <div className="flex w-64 shrink-0 flex-col border-r border-gray-100 dark:border-white/[0.06]">
            {/* 一级：会话（展开为会话组树） */}
            <SectionHeader
              icon={MessageSquare}
              title={t('page.chatSection')}
              count={groups.length}
              expanded={sections.chat}
              onToggle={() => toggleSection('chat')}
              searchOpen={chatSearchOpen}
              onToggleSearch={() => setChatSearchOpen((v) => !v)}
              searchValue={chatSearch}
              onSearchChange={setChatSearch}
              searchPlaceholder={t('page.searchSessionsPlaceholder')}
              onAdd={() => chatTreeRef.current?.startCreateGroup()}
              addTitle={t('page.newChatGroup')}
            />
            {sections.chat && (
              // 会话列表按内容自然增高，浮动在下方的「项目」之上；超过侧栏一半高度时才固定并内部滚动
              // 项目分区折叠时不再受一半限制，可用满整栏
              <div className="flex min-h-0 shrink-0 flex-col" style={{ maxHeight: sections.project ? '50%' : '100%' }}>
                <ChatTree
                  ref={chatTreeRef}
                  embedded
                  hideMainChat
                  search={chatSearch}
                  selectedGroupId={view === 'chat' ? activeGroup?.id : undefined}
                  selectedTopicId={view === 'chat' ? activeTopic?.id : undefined}
                  onSelectGroup={handleSelectGroup}
                  onSelectTopic={handleSelectTopic}
                  onDeleteTopic={handleDeleteTopic}
                  onDeleteGroup={(groupId) => {
                    // 删的正是当前正在看的组：选择权交回默认（首个分组），
                    // 否则会话区还停在已删除的组上
                    if (activeGroup?.id === groupId) {
                      setGroupChoice(undefined)
                      setTopicChoice(undefined)
                    }
                  }}
                  onStartDraftTopic={handleStartDraftTopic}
                />
              </div>
            )}

            {/* 一级：项目（展开为项目树，项目下挂会话） */}
            <SectionHeader
              icon={FolderInput}
              title={t('page.projectSection')}
              count={projects.length}
              expanded={sections.project}
              onToggle={() => toggleSection('project')}
              onAdd={() => workSidebarRef.current?.startCreateProject()}
              addTitle={t('page.newProject')}
              trailing={<ProjectViewMenu search={projectSearch} onSearchChange={setProjectSearch} />}
            />
            {sections.project && (
              <div className="flex min-h-0 flex-1 flex-col">
                <WorkSidebar
                  ref={workSidebarRef}
                  embedded
                  search={projectSearch}
                  selectedProjectId={view === 'code' ? selectedProject?.id : undefined}
                  selectedSessionId={view === 'code' ? selectedSession?.id : undefined}
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
            )}
          </div>

          {view === 'chat' ? (
            activeTopic ? (
              <ChatMessageArea
                key={activeTopic.id}
                topic={activeTopic}
                group={activeGroup ?? undefined}
                onTopicUpdated={setTopicChoice}
                projectId={selectedProject?.id}
              />
            ) : (
              <ChatMessageArea
                topic={undefined}
                group={activeGroup ?? undefined}
                onTopicUpdated={setTopicChoice}
                projectId={selectedProject?.id}
              />
            )
          ) : (
            <>
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
            </>
          )}
        </PageContainer>
      }
    />
  )
}
