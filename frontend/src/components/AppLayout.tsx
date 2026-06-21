import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, BookOpen, Database, MessageSquare, Network, Search, Settings, Tag, Zap, ListTodo, Atom, Cpu, Workflow } from 'lucide-react'
import Sidebar from './Sidebar'
import { useUIStore } from '../stores/uiStore'

interface AppLayoutProps {
  children: ReactNode
  mainContent: ReactNode
  showSidebar?: boolean
}

export default function AppLayout({ children, mainContent, showSidebar = true }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const appName = useUIStore((state) => state.appName)
  const navItems = [
    { path: '/', label: '笔记', icon: BookOpen },
    { path: '/tags', label: '标签', icon: Tag },
    { path: '/chat', label: '对话', icon: MessageSquare },
    { path: '/agents', label: '智能体', icon: Bot },
    { path: '/skills', label: '技能', icon: Zap },
    { path: '/knowledge-base', label: '知识库', icon: Database },
    { path: '/graph', label: '知识图谱', icon: Network },
    { path: '/tasks', label: '任务', icon: ListTodo },
    { path: '/memories', label: '记忆', icon: Atom },
    { path: '/models', label: '大模型', icon: Cpu },
    { path: '/work', label: 'Work', icon: Workflow },
    { path: '/search', label: '搜索', icon: Search },
  ]

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-[#0c0f1a] dark:text-gray-100">
      <nav className="glass-nav flex h-14 shrink-0 items-center justify-between px-6">
        <div className="flex items-center space-x-6">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-500/20">
              <BookOpen size={16} className="text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100">{appName}</span>
          </button>
          <div className="flex items-center gap-0.5 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.06]">
            {navItems.map((item) => {
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
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
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
