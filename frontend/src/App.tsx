import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { settingService } from './services/settingService'
import { useUIStore } from './stores/uiStore'

const NotesPage = lazy(() => import('./pages/NotesPage'))
const TagsPage = lazy(() => import('./pages/TagsPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const TrashPage = lazy(() => import('./pages/TrashPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const GraphPage = lazy(() => import('./pages/GraphPage'))
const AgentsPage = lazy(() => import('./pages/AgentsPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const KnowledgeBasePage = lazy(() => import('./pages/KnowledgeBasePage'))
const SharedNotePage = lazy(() => import('./pages/SharedNotePage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const KanbanPage = lazy(() => import('./pages/KanbanPage'))
const KanbanTaskDetailPage = lazy(() => import('./pages/KanbanTaskDetailPage'))
const MemoriesPage = lazy(() => import('./pages/MemoriesPage'))
const ModelsPage = lazy(() => import('./pages/ModelsPage'))
const WorkPage = lazy(() => import('./pages/WorkPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const WikiPage = lazy(() => import('./pages/WikiPage'))
const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage'))
const ProxyPage = lazy(() => import('./pages/ProxyPage'))
const UsagePage = lazy(() => import('./pages/UsagePage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))
const AppsPage = lazy(() => import('./pages/AppsPage'))
const ToolsPage = lazy(() => import('./pages/ToolsPage'))

/** 路由级代码分割的加载占位：页面按需加载时避免白屏 */
function RouteFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center text-xs text-gray-400">加载中…</div>
  )
}

function App() {
  // 启动时把服务端设置灌入 UI store：桌面壳/新安装的 localStorage 为空，
  // 若不预热，导航样式、主题等会一直显示默认值，直到用户进一次设置页
  useEffect(() => {
    let alive = true
    settingService.getSnapshot()
      .then((snapshot) => {
        if (!alive || !snapshot) return
        const store = useUIStore.getState()
        if (snapshot.navStyle === 'top' || snapshot.navStyle === 'vertical') store.setNavStyle(snapshot.navStyle)
        if (snapshot.secondaryMenuStyle === 'flat' || snapshot.secondaryMenuStyle === 'collapsed')
          store.setSecondaryMenuStyle(snapshot.secondaryMenuStyle)
        if (snapshot.theme === 'light' || snapshot.theme === 'dark' || snapshot.theme === 'system')
          store.setTheme(snapshot.theme)
        try {
          const items = JSON.parse(snapshot.pinnedNavItems)
          if (Array.isArray(items) && items.length > 0) store.setPinnedNavItems(items)
        } catch { /* 解析失败时保留当前值 */ }
      })
      .catch(() => { /* 后端未就绪时保留本地默认值 */ })
    return () => { alive = false }
  }, [])

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<NotesPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/chat" element={<Navigate to="/code" replace />} />
        <Route path="/work" element={<Navigate to="/code" replace />} />
        <Route path="/code" element={<WorkPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/tasks" element={<Navigate to="/tasks/background" replace />} />
        <Route path="/tasks/background" element={<TasksPage mode="background" />} />
        <Route path="/tasks/scheduled" element={<TasksPage mode="scheduled" />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/wiki" element={<WikiPage />} />
        <Route path="/kanban" element={<KanbanPage />} />
        <Route path="/kanban/:taskId" element={<KanbanTaskDetailPage />} />
        <Route path="/memories" element={<MemoriesPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/work" element={<WorkPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/proxy" element={<ProxyPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/share/:shareCode" element={<SharedNotePage />} />
      </Routes>
    </Suspense>
  )
}

export default App
