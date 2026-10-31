import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { settingService } from './services/settingService'
import { onUiAction } from './services/signalrService'
import { useUIStore } from './stores/uiStore'
import { useUpdateStore } from './stores/updateStore'
import { updateService } from './services/updateService'
import i18n, { applyLanguage } from './i18n'
import { ACCENT_PRESETS, BACKGROUND_PRESETS, FONT_FAMILY_PRESETS } from './utils/appearance'
import { sanitizeNavPaths } from './utils/navItems'

const NotesPage = lazy(() => import('./pages/NotesPage'))
const MainChatPage = lazy(() => import('./pages/MainChatPage'))
const TagsPage = lazy(() => import('./pages/TagsPage'))
const TrashPage = lazy(() => import('./pages/TrashPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const GraphPage = lazy(() => import('./pages/GraphPage'))
const WhiteboardPage = lazy(() => import('./pages/WhiteboardPage'))
const WhiteboardEditorPage = lazy(() => import('./pages/WhiteboardEditorPage'))
const AgentsPage = lazy(() => import('./pages/AgentsPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const KnowledgeBasePage = lazy(() => import('./pages/KnowledgeBasePage'))
const SharedNotePage = lazy(() => import('./pages/SharedNotePage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const KanbanPage = lazy(() => import('./pages/KanbanPage'))
const KanbanTaskDetailPage = lazy(() => import('./pages/KanbanTaskDetailPage'))
const MemoriesPage = lazy(() => import('./pages/MemoriesPage'))
const ModelsPage = lazy(() => import('./pages/ModelsPage'))
const FoundryLocalPage = lazy(() => import('./pages/FoundryLocalPage'))
const WorkPage = lazy(() => import('./pages/WorkPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const WikiPage = lazy(() => import('./pages/WikiPage'))
const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage'))
const ProxyPage = lazy(() => import('./pages/ProxyPage'))
const UsagePage = lazy(() => import('./pages/UsagePage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))
const ToolsPage = lazy(() => import('./pages/ToolsPage'))

/** 路由级代码分割的加载占位：页面按需加载时避免白屏 */
function RouteFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 text-xs text-gray-400">
      <img src="/ht-monogram-animated.svg" alt="" width={72} height={72} className="select-none" />
      {t('common:loading')}
    </div>
  )
}

/** uiAction notify 的全局通知样式（success / error / info 三档） */
const TOAST_STYLES: Record<'success' | 'error' | 'info', string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/90 dark:text-emerald-200',
  error: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/90 dark:text-rose-200',
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/90 dark:text-blue-200',
}

function App() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  // 后端主动推的 notify：全局轻量通知（如后台任务完成/失败），5 秒后自动消失
  const [toast, setToast] = useState<{ text: string; level: 'success' | 'error' | 'info' } | null>(null)

  // 后端主动推的 navigate：跳转应用页面（路由由工具侧映射，这里只拦非法站内路径）
  useEffect(() => onUiAction('navigate', (payload) => {
    const path = typeof payload.path === 'string' ? payload.path : ''
    if (!path.startsWith('/') || path.startsWith('//') || path === location.pathname) return
    navigate(path)
  }), [navigate, location.pathname])

  useEffect(() => onUiAction('notify', (payload) => {
    const kind = typeof payload.kind === 'string' ? payload.kind : ''
    const title = typeof payload.title === 'string' ? payload.title : ''
    let text: string
    let level: 'success' | 'error' | 'info'
    if (kind === 'background_task') {
      const failed = payload.status === 'failed'
      text = failed
        ? t('notifyTaskFailed', { title, error: typeof payload.error === 'string' ? payload.error : '' })
        : t('notifyTaskCompleted', { title })
      level = failed ? 'error' : 'success'
    } else {
      text = typeof payload.message === 'string' && payload.message ? payload.message : title
      level = payload.level === 'error' ? 'error' : payload.level === 'success' ? 'success' : 'info'
    }
    if (!text) return
    setToast({ text, level })
  }), [t])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  // 后端返回的文案（工具说明、用量来源等）随语言变化：切换语言时让已缓存的查询重新拉取
  useEffect(() => {
    const handler = () => { void queryClient.invalidateQueries() }
    i18n.on('languageChanged', handler)
    return () => { i18n.off('languageChanged', handler) }
  }, [queryClient])

  // 启动后延迟自动检测更新（仅桌面壳）：GitHub 不通时 Tauri 会自动改走加速镜像；
  // 静默失败不打扰用户，设置 → 关于 里可以手动检测
  useEffect(() => {
    if (!updateService.supported()) return
    const timer = window.setTimeout(() => { void useUpdateStore.getState().check(true) }, 4000)
    return () => window.clearTimeout(timer)
  }, [])

  // 启动时把服务端设置灌入 UI store：桌面壳/新安装的 localStorage 为空，
  // 若不预热，导航样式、主题等会一直显示默认值，直到用户进一次设置页
  useEffect(() => {
    let alive = true
    settingService.getSnapshot()
      .then((snapshot) => {
        if (!alive || !snapshot) return
        const store = useUIStore.getState()
        if (snapshot.navStyle === 'top' || snapshot.navStyle === 'vertical' || snapshot.navStyle === 'verticalList') store.setNavStyle(snapshot.navStyle)
        if (snapshot.secondaryMenuStyle === 'flat' || snapshot.secondaryMenuStyle === 'collapsed')
          store.setSecondaryMenuStyle(snapshot.secondaryMenuStyle)
        if (snapshot.theme === 'light' || snapshot.theme === 'dark' || snapshot.theme === 'system')
          store.setTheme(snapshot.theme)
        // 主题配色 / 画布背景 / 亚克力开关同样要预热：否则刷新后回到默认纯色画布，
        // 亚克力材质叠在近白画布上会整块看不见
        const accent = ACCENT_PRESETS.find((p) => p.key === snapshot.themeAccent)
        if (accent) store.setAccent(accent.key)
        const background = BACKGROUND_PRESETS.find((p) => p.key === snapshot.background)
        if (background) store.setBackground(background.key)
        store.setGlass(snapshot.glassEffect !== 'false')
        // 字体 / 字号 / 界面缩放同样预热：否则刷新后回到默认，要看一眼设置页才生效
        const font = FONT_FAMILY_PRESETS.find((p) => p.key === snapshot.fontFamily)
        if (font) store.setFontFamily(font.key)
        const fontSize = Number.parseInt(snapshot.fontSize ?? '', 10)
        if (Number.isFinite(fontSize)) store.setFontSize(fontSize)
        const uiZoom = Number.parseInt(snapshot.uiZoom ?? '', 10)
        if (Number.isFinite(uiZoom)) store.setUiZoom(uiZoom)
        if (snapshot.language === 'zh' || snapshot.language === 'en') void applyLanguage(snapshot.language)
        try {
          const items = JSON.parse(snapshot.pinnedNavItems)
          if (Array.isArray(items) && items.length > 0) store.setPinnedNavItems(sanitizeNavPaths(items))
        } catch { /* 解析失败时保留当前值 */ }
        // 固定区/动态区：键不存在（旧后端）时保留 store 默认值；空数组是用户的合法选择
        const zones: [string | undefined, (items: string[]) => void][] = [
          [snapshot.fixedNavItems, store.setFixedNavItems],
          [snapshot.dynamicNavItems, store.setDynamicNavItems],
        ]
        for (const [raw, apply] of zones) {
          if (!raw) continue
          try {
            const items = JSON.parse(raw)
            if (Array.isArray(items)) apply(sanitizeNavPaths(items))
          } catch { /* 解析失败时保留当前值 */ }
        }
      })
      .catch(() => { /* 后端未就绪时保留本地默认值 */ })
    return () => { alive = false }
  }, [])

  return (
    <>
      {toast && (
        <div role="status" className={`fixed right-4 top-4 z-[100] max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${TOAST_STYLES[toast.level]}`}>
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1 break-words">{toast.text}</span>
            <button
              type="button"
              aria-label={t('close')}
              onClick={() => setToast(null)}
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <Suspense fallback={<RouteFallback />}>
        <Routes>
        <Route path="/" element={<MainChatPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/chat" element={<Navigate to="/code" replace />} />
        <Route path="/work" element={<Navigate to="/code" replace />} />
        {/* 应用页已移除：旧书签与文档链接回落到首页 */}
        <Route path="/apps" element={<Navigate to="/" replace />} />
        <Route path="/code" element={<WorkPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/whiteboard" element={<WhiteboardPage />} />
        <Route path="/whiteboard/:id" element={<WhiteboardEditorPage />} />
        <Route path="/tasks" element={<Navigate to="/tasks/background" replace />} />
        <Route path="/tasks/background" element={<TasksPage mode="background" />} />
        <Route path="/tasks/scheduled" element={<TasksPage mode="scheduled" />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/wiki" element={<WikiPage />} />
        <Route path="/kanban" element={<KanbanPage />} />
        <Route path="/kanban/:taskId" element={<KanbanTaskDetailPage />} />
        <Route path="/memories" element={<MemoriesPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/foundry-local" element={<FoundryLocalPage />} />
        <Route path="/work" element={<WorkPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/proxy" element={<ProxyPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/share/:shareCode" element={<SharedNotePage />} />
        </Routes>
      </Suspense>
    </>
  )
}

export default App
