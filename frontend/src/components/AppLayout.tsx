import { type ReactNode, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, BookOpen, Database, MessageSquare, Network, Search, Settings, Tag, Zap, ListTodo, Atom, Cpu, Workflow, GitBranch, ChevronDown } from 'lucide-react'
import Sidebar from './Sidebar'
import { useUIStore } from '../stores/uiStore'

interface AppLayoutProps {
  children: ReactNode
  mainContent: ReactNode
  showSidebar?: boolean
}

const fixedNavItems = [
  { path: '/', label: '笔记', icon: BookOpen },
  { path: '/chat', label: '对话', icon: MessageSquare },
  { path: '/work', label: 'Work', icon: Workflow },
  { path: '/workflows', label: '工作流', icon: GitBranch },
  { path: '/search', label: '搜索', icon: Search },
] as const

const allConfigurableItems = [
  { path: '/tags', label: '标签', icon: Tag },
  { path: '/agents', label: '智能体', icon: Bot },
  { path: '/skills', label: '技能', icon: Zap },
  { path: '/knowledge-base', label: '知识库', icon: Database },
  { path: '/graph', label: '知识图谱', icon: Network },
  { path: '/tasks', label: '任务', icon: ListTodo },
  { path: '/memories', label: '记忆', icon: Atom },
  { path: '/models', label: '大模型', icon: Cpu },
] as const

export default function AppLayout({ children, mainContent, showSidebar = true }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const appName = useUIStore((state) => state.appName)
  const pinnedNavItems = useUIStore((state) => state.pinnedNavItems)
  const [moreOpen, setMoreOpen] = useState(false)
  const [lastMoreItem, setLastMoreItem] = useState<string | null>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!moreOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (moreRef.current?.contains(target)) return
      if (portalRef.current?.contains(target)) return
      setMoreOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moreOpen])

  const pinnedItems = allConfigurableItems.filter((item) => pinnedNavItems.includes(item.path))
  const unpinnedItems = allConfigurableItems.filter((item) => !pinnedNavItems.includes(item.path))

  const renderNavButton = (item: { path: string; label: string; icon: React.ComponentType<{ size?: number }> }) => {
    const Icon = item.icon
    const isActive = location.pathname === item.path
    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all ${
          isActive
            ? 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        }`}
      >
        <Icon size={14} />
        {item.label}
      </button>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-[#0c0f1a] dark:text-gray-100">
      <nav className="glass-nav grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-6">
        <div className="flex items-center justify-start">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-500/20">
              <BookOpen size={16} className="text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100">{appName}</span>
          </button>
        </div>
        <div className="flex items-center justify-center gap-0.5 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.06]">
          {fixedNavItems.map(renderNavButton)}

          {pinnedItems.length > 0 && (
            <div className="mx-1 h-5 w-px bg-gray-300 dark:bg-white/10" />
          )}

          {pinnedItems.map(renderNavButton)}

          {/* Dynamic recent item from "more" menu */}
          {lastMoreItem && (() => {
            const item = allConfigurableItems.find((i) => i.path === lastMoreItem)
            if (!item) return null
            return renderNavButton(item)
          })()}

          {/* "更多" dropdown */}
          {unpinnedItems.length > 0 && (
            <div ref={moreRef} className="relative">
              <button
                ref={moreBtnRef}
                onClick={() => setMoreOpen(!moreOpen)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all ${
                  moreOpen
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                更多
                <ChevronDown size={12} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
              {moreOpen && moreBtnRef.current && createPortal(
                <div
                  ref={portalRef}
                  className="rounded-xl border border-gray-200/80 bg-white p-1.5 shadow-lg dark:border-white/[0.08] dark:bg-gray-800"
                  style={{
                    position: 'fixed',
                    top: moreBtnRef.current.getBoundingClientRect().bottom + 4,
                    left: moreBtnRef.current.getBoundingClientRect().left,
                    zIndex: 99999,
                  }}
                >
                  {unpinnedItems.map((item) => {
                    const Icon = item.icon
                    const isActive = location.pathname === item.path
                    return (
                      <button
                        key={item.path}
                        onClick={() => { navigate(item.path); setLastMoreItem(item.path); setMoreOpen(false) }}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                          isActive
                            ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        <Icon size={14} />
                        {item.label}
                      </button>
                    )
                  })}
                </div>,
                document.body
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => navigate('/settings')}
            className={`rounded-lg p-2 transition-all ${
              location.pathname === '/settings'
                ? 'bg-gray-100/80 text-gray-800 dark:bg-white/10 dark:text-gray-100'
                : 'text-gray-400 hover:bg-gray-100/60 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'
            }`}
            title="设置"
          >
            <Settings size={17} />
          </button>
        </div>
      </nav>
      <div className="flex min-h-0 flex-1">
        {showSidebar && <Sidebar />}
        <div className="flex min-w-0 flex-1">
          {children}
          {mainContent}
        </div>
      </div>
    </div>
  )
}
