import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, MessageSquare, Network, Search, Settings, Tag } from 'lucide-react'
import Sidebar from './Sidebar'

interface AppLayoutProps {
  children: ReactNode
  mainContent: ReactNode
  showSidebar?: boolean
}

export default function AppLayout({ children, mainContent, showSidebar = true }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const navItems = [
    { path: '/', label: '笔记', icon: BookOpen },
    { path: '/tags', label: '标签', icon: Tag },
    { path: '/chat', label: '对话', icon: MessageSquare },
    { path: '/graph', label: '知识图谱', icon: Network },
    { path: '/search', label: '搜索', icon: Search },
  ]

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <nav className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center space-x-8">
          <button onClick={() => navigate('/')} className="text-xl font-bold text-gray-800 dark:text-gray-100">
            Hetu
          </button>
          <div className="flex space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.path
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon size={15} className="mr-2" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/settings')}
            className={`rounded-lg p-2 transition-colors ${
              location.pathname === '/settings'
                ? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
            title="设置"
          >
            <Settings size={18} />
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
