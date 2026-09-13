import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

const NotesPage = lazy(() => import('./pages/NotesPage'))
const TagsPage = lazy(() => import('./pages/TagsPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const TrashPage = lazy(() => import('./pages/TrashPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const GraphPage = lazy(() => import('./pages/GraphPage'))
const AgentsPage = lazy(() => import('./pages/AgentsPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const KnowledgeBasePage = lazy(() => import('./pages/KnowledgeBasePage'))
const SharedNotePage = lazy(() => import('./pages/SharedNotePage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const MemoriesPage = lazy(() => import('./pages/MemoriesPage'))
const ModelsPage = lazy(() => import('./pages/ModelsPage'))
const WorkPage = lazy(() => import('./pages/WorkPage'))
const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage'))
const ProxyPage = lazy(() => import('./pages/ProxyPage'))
const UsagePage = lazy(() => import('./pages/UsagePage'))

/** 路由级代码分割的加载占位：页面按需加载时避免白屏 */
function RouteFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center text-xs text-gray-400">加载中…</div>
  )
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<NotesPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/tasks" element={<Navigate to="/tasks/background" replace />} />
        <Route path="/tasks/background" element={<TasksPage mode="background" />} />
        <Route path="/tasks/scheduled" element={<TasksPage mode="scheduled" />} />
        <Route path="/memories" element={<MemoriesPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/work" element={<WorkPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/proxy" element={<ProxyPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/share/:shareCode" element={<SharedNotePage />} />
      </Routes>
    </Suspense>
  )
}

export default App
