import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, FolderInput, MessageSquare, Plus, Search } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ChatTree, { type ChatTreeHandle } from '../components/ChatTree'
import ChatMessageArea from '../components/ChatMessageArea'
import MainChatEntry from '../components/MainChatEntry'
import WorkSidebar, { type WorkSidebarHandle } from '../components/work/WorkSidebar'
import WorkSessionArea from '../components/work/WorkSessionArea'
import WorkExplorer from '../components/work/WorkExplorer'
import { chatGroupService, chatTopicService } from '../services/chatService'
import { workProjectService } from '../services/workService'
import type { IChatGroup, IChatTopic } from '../types'
import type { IWorkProject, IWorkSession } from '../types/work'

/** 合并后的会话页：左栏一级菜单「主对话 / 会话 / 项目」，右侧共用同一套聊天区（Code 会话叠加项目能力） */
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
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  count?: number
  expanded: boolean
  onToggle: () => void
  searchOpen: boolean
  onToggleSearch: () => void
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  onAdd: () => void
  addTitle: string
}) {
  const iconBtn = 'shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
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
            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] font-medium leading-4 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
              {count}
            </span>
          )}
        </button>
        <button
          onClick={onToggleSearch}
          title={searchOpen ? '收起搜索' : '搜索'}
          aria-label="搜索"
          aria-pressed={searchOpen}
          className={`${iconBtn} ${searchOpen ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : ''}`}
        >
          <Search size={15} />
        </button>
        <button onClick={onAdd} title={addTitle} aria-label={addTitle} className={iconBtn}>
          <Plus size={15} />
        </button>
      </div>
      {searchOpen && (
        <div className="relative px-2 pb-2">
          <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-gray-200/80 bg-gray-50/80 py-1.5 pl-7 pr-2 text-[13px] outline-none transition-all placeholder:text-gray-400 focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:focus:border-blue-600"
          />
        </div>
      )}
    </div>
  )
}

export default function WorkPage() {
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
  const [projectSearchOpen, setProjectSearchOpen] = useState(false)
  const chatTreeRef = useRef<ChatTreeHandle>(null)
  const workSidebarRef = useRef<WorkSidebarHandle>(null)

  useEffect(() => {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(sections))
  }, [sections])

  // —— 对话：分组/话题选择（原对话页）——
  // undefined 表示跟随默认选择（主对话或首个分组/话题），null 表示显式清空
  const [groupChoice, setGroupChoice] = useState<IChatGroup | null | undefined>(undefined)
  const [topicChoice, setTopicChoice] = useState<IChatTopic | null | undefined>(undefined)

  // 主对话（全局主对话组 + 唯一主话题）
  const { data: mainChat } = useQuery({
    queryKey: ['chatMain'],
    queryFn: chatGroupService.getMain,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['chatGroups'],
    queryFn: chatGroupService.getAll,
  })

  const activeGroup = groupChoice ?? mainChat?.group ?? groups[0] ?? null

  const { data: topics = [] } = useQuery({
    queryKey: ['chatTopics', activeGroup?.id],
    queryFn: () => (activeGroup ? chatTopicService.getByGroup(activeGroup.id) : Promise.resolve([])),
    enabled: !!activeGroup,
  })

  // 主对话分组默认选中唯一的主话题，普通分组默认选中第一个话题
  const defaultTopic = mainChat && activeGroup?.id === mainChat.group.id ? mainChat.topic : topics[0] ?? null
  const activeTopic = topicChoice === undefined ? defaultTopic : topicChoice
  const selectedMain = mainChat != null && activeTopic?.id === mainChat.topic.id

  const handleSelectMain = useCallback(() => {
    if (!mainChat) return
    setGroupChoice(mainChat.group)
    setTopicChoice(mainChat.topic)
    setView('chat')
    setSections((prev) => (prev.chat ? prev : { ...prev, chat: true }))
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [mainChat, setSearchParams])

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
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null)

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
        <div className="flex h-full min-w-0 flex-1">
          {/* 左栏一级菜单：主对话（置顶） / 会话（会话组） / 项目（项目与会话） */}
          <div className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {/* 一级：主对话 */}
            <div className="shrink-0 p-2">
              <MainChatEntry
                variant="row"
                mainChat={mainChat}
                selected={view === 'chat' && selectedMain}
                onSelect={handleSelectMain}
              />
            </div>

            {/* 一级：会话（展开为会话组树） */}
            <SectionHeader
              icon={MessageSquare}
              title="会话"
              count={groups.length}
              expanded={sections.chat}
              onToggle={() => toggleSection('chat')}
              searchOpen={chatSearchOpen}
              onToggleSearch={() => setChatSearchOpen((v) => !v)}
              searchValue={chatSearch}
              onSearchChange={setChatSearch}
              searchPlaceholder="搜索会话组..."
              onAdd={() => chatTreeRef.current?.startCreateGroup()}
              addTitle="新建会话组"
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
                  mainChat={mainChat}
                  selectedMain={view === 'chat' && selectedMain}
                  selectedGroupId={view === 'chat' ? activeGroup?.id : undefined}
                  selectedTopicId={view === 'chat' ? activeTopic?.id : undefined}
                  onSelectGroup={handleSelectGroup}
                  onSelectTopic={handleSelectTopic}
                  onSelectMain={handleSelectMain}
                  onDeleteTopic={handleDeleteTopic}
                />
              </div>
            )}

            {/* 一级：项目（展开为项目树，项目下挂会话） */}
            <SectionHeader
              icon={FolderInput}
              title="项目"
              count={projects.length}
              expanded={sections.project}
              onToggle={() => toggleSection('project')}
              searchOpen={projectSearchOpen}
              onToggleSearch={() => setProjectSearchOpen((v) => !v)}
              searchValue={projectSearch}
              onSearchChange={setProjectSearch}
              searchPlaceholder="搜索项目或会话..."
              onAdd={() => workSidebarRef.current?.startCreateProject()}
              addTitle="新建项目"
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
                key={selectedSession?.id ?? 'no-session'}
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
            </>
          )}
        </div>
      }
    />
  )
}
