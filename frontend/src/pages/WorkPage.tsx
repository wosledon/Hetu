import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownUp, Check, ChevronDown, ChevronRight, FolderInput, FolderTree, MessageSquare, Plus, Search, SlidersHorizontal } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ChatTree, { type ChatTreeHandle } from '../components/ChatTree'
import ChatMessageArea from '../components/ChatMessageArea'
import WorkSidebar, { type WorkSidebarHandle } from '../components/work/WorkSidebar'
import WorkSessionArea from '../components/work/WorkSessionArea'
import WorkExplorer from '../components/work/WorkExplorer'
import { chatGroupService, chatTopicService } from '../services/chatService'
import { workProjectService } from '../services/workService'
import { onUiAction } from '../services/signalrService'
import { useDismissOnOutside } from '../hooks/useDismissOnOutside'
import type { IChatGroup, IChatTopic } from '../types'
import type { IWorkProject, IWorkSession } from '../types/work'
import { Card, PageContainer, SearchInput } from '../components/ui'
import { useUIStore } from '../stores/uiStore'
import type { ProjectGroupBy, ProjectSortBy } from '../stores/uiStore'

/** 合并后的会话页：左栏一级菜单「会话 / 项目」，右侧共用同一套聊天区（Code 会话叠加项目能力）；主对话已单独成页 */
type CodeView = 'chat' | 'code'

const DEFAULT_RIGHT_WIDTH = 560
const MIN_RIGHT_WIDTH = 320
const MAX_RIGHT_WIDTH = 1200
/** 一级菜单「会话 / 项目」展开状态（主对话始终为一级入口） */
const SECTIONS_STORAGE_KEY = 'hetu:code-sidebar-sections'

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

const MENU_PANEL_CLS =
  'fixed z-50 min-w-[196px] overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl glass dark:border-gray-700 dark:bg-gray-800'
const MENU_ROW_CLS =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
/** 子菜单默认宽 160px：定位时据此决定向左还是向右翻转 */
const SUBMENU_WIDTH = 160

/** 子菜单锚点：右侧空间不够时翻到左边，顶部越界时上移 */
function placeSubmenu(anchor: DOMRect, width: number): { left: number; top: number } {
  const left = anchor.right + 4 + width > window.innerWidth - 8
    ? anchor.left - width - 4
    : anchor.right + 4
  return { left: Math.max(8, left), top: Math.max(8, anchor.top - 4) }
}

/**
 * 项目节的视图选择器：占住一级菜单行上原来搜索按钮的位置。
 * 一级菜单向右展开，内含搜索框；「分组方式 / 排序方式」各自再向右展开二级菜单（带当前值提示）。
 */
function ProjectViewMenu({ search, onSearchChange }: { search: string; onSearchChange: (value: string) => void }) {
  const { t } = useTranslation('work')
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const [sub, setSub] = useState<'group' | 'sort' | null>(null)
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => { setOpen(false); setSub(null) }, [])
  useDismissOnOutside(open, close, [triggerRef, menuRef, subRef])

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
    if (rect) setAnchor(placeSubmenu(rect, 196))
    setOpen(true)
  }

  /** 悬停即展开二级菜单（与右键菜单的子菜单行为一致），点击同样可触发 */
  const openSub = (kind: 'group' | 'sort') => (e: React.MouseEvent<HTMLButtonElement>) => {
    setSubPos(placeSubmenu(e.currentTarget.getBoundingClientRect(), SUBMENU_WIDTH))
    setSub(kind)
  }

  const subOptions = sub === 'group' ? groupOptions : sortOptions
  const subCurrent = sub === 'group' ? groupBy : sortBy
  const pickSub = (value: string) => {
    if (sub === 'group') setGroupBy(value as ProjectGroupBy)
    else setSortBy(value as ProjectSortBy)
    close()
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => (open ? close() : openPanel())}
        title={t('page.projectView')}
        aria-label={t('page.projectView')}
        aria-expanded={open}
        className={`shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 ${
          open || search ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : ''
        }`}
      >
        <SlidersHorizontal size={15} />
      </button>
      {open && anchor && createPortal(
        <div
          ref={menuRef}
          className={MENU_PANEL_CLS}
          style={{ left: anchor.left, top: anchor.top }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 pb-2 pt-2">
            <SearchInput
              size="sm"
              autoFocus
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('page.searchProjectsPlaceholder')}
              className="w-full"
            />
          </div>
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          <button className={MENU_ROW_CLS} onMouseEnter={openSub('group')} onClick={openSub('group')}>
            <FolderTree size={14} className="shrink-0 text-gray-400" />
            <span className="min-w-0 flex-1 truncate">{t('page.groupBy')}</span>
            <span className="shrink-0 text-[11px] text-gray-400">{groupLabel}</span>
            <ChevronRight size={13} className="shrink-0 text-gray-400" />
          </button>
          <button className={MENU_ROW_CLS} onMouseEnter={openSub('sort')} onClick={openSub('sort')}>
            <ArrowDownUp size={14} className="shrink-0 text-gray-400" />
            <span className="min-w-0 flex-1 truncate">{t('page.sortBy')}</span>
            <span className="shrink-0 text-[11px] text-gray-400">{sortLabel}</span>
            <ChevronRight size={13} className="shrink-0 text-gray-400" />
          </button>
        </div>,
        document.body
      )}
      {open && sub && subPos && createPortal(
        <div ref={subRef} className={MENU_PANEL_CLS} style={{ left: subPos.left, top: subPos.top, minWidth: SUBMENU_WIDTH }}>
          {subOptions.map(([value, label]) => (
            <button key={value} className={MENU_ROW_CLS} onClick={() => pickSub(value)}>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {subCurrent === value && <Check size={13} className="shrink-0 text-blue-500 dark:text-blue-400" />}
            </button>
          ))}
        </div>,
        document.body
      )}
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
  // 右侧聊天区当前绑定的是对话话题还是项目会话
  const [view, setView] = useState<CodeView>(searchParams.get('project') ? 'code' : 'chat')

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
      isAutoOrganizeEnabled: false,
      createdAt: now,
      updatedAt: now,
    } as IChatTopic)
    setView('chat')
    setSections((prev) => (prev.chat ? prev : { ...prev, chat: true }))
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  // —— 项目：项目/会话选择（原 Code 页）——
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

  // 未显式选择时默认使用第一个项目
  const selectedProject = preferredProject ?? projects.find((p) => p.id === searchParams.get('project')) ?? projects[0] ?? null

  const handleSelectProject = (project: IWorkProject) => {
    setPreferredProject(project)
    setSelectedSession((prev) => (prev?.projectId === project.id ? prev : null))
    setView('code')
    setSections((prev) => (prev.project ? prev : { ...prev, project: true }))
    const params = new URLSearchParams(searchParams)
    params.set('project', project.id)
    setSearchParams(params, { replace: true })
  }

  const handleSelectSession = (session: IWorkSession) => {
    setSelectedSession(session)
    setView('code')
    setSections((prev) => (prev.project ? prev : { ...prev, project: true }))
    queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
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
          <Card padded={false} className="flex w-64 shrink-0 flex-col border-r">
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
                    if (selectedSession?.id === sessionId) setSelectedSession(null)
                  }}
                />
              </div>
            )}
          </Card>

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
