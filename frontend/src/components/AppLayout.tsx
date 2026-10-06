import { type ReactNode, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, BookOpen, Database, MessageSquare, Network, Search, Settings, Tag, Zap, ListTodo, Atom, Cpu, Code, GitBranch, ChevronDown, CalendarClock, Waypoints, Gauge } from 'lucide-react'
import Sidebar from './Sidebar'
import BrandMark from './BrandMark'
import { segmentButtonClass } from '../utils/styles'
import { useUIStore } from '../stores/uiStore'

interface AppLayoutProps {
  children?: ReactNode
  mainContent: ReactNode
  showSidebar?: boolean
}

const fixedNavItems = [
  { path: '/', label: '笔记', icon: BookOpen },
  { path: '/chat', label: '对话', icon: MessageSquare },
  { path: '/work', label: 'Code', icon: Code },
  { path: '/workflows', label: '工作流', icon: GitBranch },
  { path: '/search', label: '搜索', icon: Search },
] as const

const allConfigurableItems = [
  { path: '/tags', label: '标签', icon: Tag },
  { path: '/agents', label: '智能体', icon: Bot },
  { path: '/skills', label: '技能', icon: Zap },
  { path: '/knowledge-base', label: '知识库', icon: Database },
  { path: '/graph', label: '知识图谱', icon: Network },
  { path: '/tasks/background', label: '后台任务', icon: ListTodo },
  { path: '/tasks/scheduled', label: '定时任务', icon: CalendarClock },
  { path: '/memories', label: '记忆', icon: Atom },
  { path: '/models', label: '大模型', icon: Cpu },
] as const

// 右侧独立分组：代理与用量
const secondaryNavItems = [
  { path: '/proxy', label: '代理服务', icon: Waypoints },
  { path: '/usage', label: '用量统计', icon: Gauge },
] as const

export default function AppLayout({ children, mainContent, showSidebar = true }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const appName = useUIStore((state) => state.appName)
  const pinnedNavItems = useUIStore((state) => state.pinnedNavItems)
  const lastMoreItem = useUIStore((state) => state.lastMoreItem)
  const setLastMoreItem = useUIStore((state) => state.setLastMoreItem)
  const navStyle = useUIStore((state) => state.navStyle)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; left: number } | null>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const [railCompact, setRailCompact] = useState(false)

  const isVertical = navStyle === 'vertical'

  const pinnedItems = allConfigurableItems.filter((item) => pinnedNavItems.includes(item.path))
  const unpinnedItems = allConfigurableItems.filter((item) => !pinnedNavItems.includes(item.path))
  const lastMoreItemData = lastMoreItem && !pinnedNavItems.includes(lastMoreItem)
    ? allConfigurableItems.find((i) => i.path === lastMoreItem)
    : null

  // 垂直胶囊：高度足够时全部平铺，高度不足时才把可配置项收进"更多"
  useEffect(() => {
    if (!isVertical) { setRailCompact(false); return }
    const el = railRef.current
    if (!el) return
    // 实测内容高度（临时隐藏 flex-1 占位，offsetTop 差自然包含 gap 与 margin）
    const measure = () => {
      const spacer = el.querySelector<HTMLElement>('[data-rail-spacer]')
      const prevDisplay = spacer?.style.display
      if (spacer) spacer.style.display = 'none'
      const nonSpacer = Array.from(el.children).filter((c) => c !== spacer) as HTMLElement[]
      const content = nonSpacer.length === 0 ? 0
        : nonSpacer[nonSpacer.length - 1].offsetTop + nonSpacer[nonSpacer.length - 1].offsetHeight - nonSpacer[0].offsetTop
      if (spacer && prevDisplay !== undefined) spacer.style.display = prevDisplay
      return content
    }
    const check = () => {
      const content = measure()
      if (content > el.clientHeight + 1) { setRailCompact(true); return }
      if (!railCompact) return
      // 收起态：估算展开全部可配置项后的增量，放得下则恢复平铺
      const itemEl = el.querySelector<HTMLElement>('[data-rail-item]')
      const itemWithGap = (itemEl?.offsetHeight ?? 52) + 2
      const lm = lastMoreItemData ? 1 : 0
      const more = unpinnedItems.length > 0 ? 1 : 0
      const delta = (allConfigurableItems.length - pinnedItems.length - lm) * itemWithGap
        - (more ? itemWithGap : 0)
        - (lm ? 11 : 0)
      if (el.clientHeight - content >= delta - 1) setRailCompact(false)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [isVertical, railCompact, pinnedNavItems, lastMoreItem])

  const renderNavButton = (item: { path: string; label: string; icon: React.ComponentType<{ size?: number }> }) => {
    const Icon = item.icon
    const isActive = location.pathname === item.path
    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all ${segmentButtonClass(isActive)}`}
      >
        <Icon size={14} />
        {item.label}
      </button>
    )
  }

  // 垂直胶囊：图标 + 小字标签，纵向堆叠于最左侧
  const renderVerticalNavButton = (item: { path: string; label: string; icon: React.ComponentType<{ size?: number }> }) => {
    const Icon = item.icon
    const isActive = location.pathname === item.path
    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        title={item.label}
        data-rail-item=""
        className={`flex w-12 shrink-0 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-all ${
          isActive
            ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300'
            : 'text-gray-400 hover:bg-gray-100/80 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
        }`}
      >
        <Icon size={18} />
        <span className="max-w-full truncate">{item.label}</span>
      </button>
    )
  }

  const openMoreMenu = () => {
    if (moreOpen) { setMoreOpen(false); return }
    const rect = moreBtnRef.current?.getBoundingClientRect()
    if (!rect) return
    // 垂直样式时菜单在按钮右侧展开，顶部样式时在下方展开
    setMoreMenuPos(
      isVertical
        ? { top: rect.top, left: rect.right + 8 }
        : { top: rect.bottom + 4, left: rect.left }
    )
    setMoreOpen(true)
  }

  const moreMenu = unpinnedItems.length > 0 && moreOpen && moreMenuPos && createPortal(
    <>
      <div
        className="fixed inset-0 z-[99998]"
        onClick={() => setMoreOpen(false)}
      />
      <div
        className="fixed z-[99999] w-40 rounded-xl border border-gray-200/80 bg-white p-1.5 shadow-lg dark:border-white/[0.08] dark:bg-gray-800"
        style={{
          top: moreMenuPos.top,
          left: moreMenuPos.left,
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
      </div>
    </>,
    document.body
  )

  const railExpanded = !railCompact

  const verticalRail = (
    <nav ref={railRef} className="glass-rail flex w-16 shrink-0 flex-col items-center gap-0.5 overflow-y-auto py-3">
      <button onClick={() => navigate('/')} className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80" title={appName}>
        <BrandMark size={24} />
      </button>
      {fixedNavItems.map(renderVerticalNavButton)}

      <div className="my-1 h-px w-6 shrink-0 bg-gray-200 dark:bg-white/10" />
      {railExpanded
        ? allConfigurableItems.map(renderVerticalNavButton)
        : pinnedItems.map(renderVerticalNavButton)}

      {!railExpanded && lastMoreItemData && (
        <>
          <div className="my-1 h-px w-6 shrink-0 bg-gray-200 dark:bg-white/10" />
          {renderVerticalNavButton(lastMoreItemData)}
        </>
      )}

      {!railExpanded && unpinnedItems.length > 0 && (
        <button
          ref={moreBtnRef}
          onClick={openMoreMenu}
          title="更多"
          data-rail-item=""
          className={`flex w-12 shrink-0 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-all ${
            moreOpen
              ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300'
              : 'text-gray-400 hover:bg-gray-100/80 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
          }`}
        >
          <ChevronDown size={18} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
          更多
        </button>
      )}

      <div className="my-1 h-px w-6 shrink-0 bg-gray-200 dark:bg-white/10" />
      {secondaryNavItems.map(renderVerticalNavButton)}

      <div className="flex-1" data-rail-spacer="" />

      <button
        onClick={() => navigate('/settings')}
        title="设置"
        data-rail-item=""
        className={`flex w-12 shrink-0 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-all ${
          location.pathname === '/settings'
            ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300'
            : 'text-gray-400 hover:bg-gray-100/80 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
        }`}
      >
        <Settings size={18} />
        设置
      </button>
    </nav>
  )

  return (
    <div className={`flex h-screen w-full overflow-hidden bg-gray-50 text-gray-900 dark:bg-[#0c0f1a] dark:text-gray-100 ${isVertical ? 'flex-row' : 'flex-col'}`}>
      {isVertical ? verticalRail : (
      <nav className="glass-nav grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-6">
        <div className="flex items-center justify-start">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <BrandMark size={24} />
            <span className="text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100">{appName}</span>
          </button>
        </div>
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center justify-center gap-0.5 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.06]">
          {fixedNavItems.map(renderNavButton)}

          {pinnedItems.length > 0 && (
            <div className="mx-1 h-5 w-px bg-gray-300 dark:bg-white/10" />
          )}

          {pinnedItems.map(renderNavButton)}

          {/* Dynamic recent item from "more" menu */}
          {lastMoreItemData && (
            <>
              <div className="mx-1 h-5 w-px bg-gray-300 dark:bg-white/10" />
              {renderNavButton(lastMoreItemData)}
            </>
          )}

          {/* "更多" dropdown */}
          {unpinnedItems.length > 0 && (
            <div className="relative">
              <button
                ref={moreBtnRef}
                onClick={openMoreMenu}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all ${segmentButtonClass(moreOpen)}`}
              >
                更多
                <ChevronDown size={12} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}
          </div>

          {/* 右侧独立分组：代理服务 / 用量统计 */}
          <div className="flex items-center justify-center gap-0.5 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.06]">
            {secondaryNavItems.map(renderNavButton)}
          </div>
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
        )}
        {moreMenu}
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
