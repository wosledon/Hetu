import { Routes, Route } from 'react-router-dom'
import NotesPage from './pages/NotesPage'
import TagsPage from './pages/TagsPage'
import SearchPage from './pages/SearchPage'
import TrashPage from './pages/TrashPage'
import SettingsPage from './pages/SettingsPage'
import ChatPage from './pages/ChatPage'
import GraphPage from './pages/GraphPage'
import AgentsPage from './pages/AgentsPage'
import SkillsPage from './pages/SkillsPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import SharedNotePage from './pages/SharedNotePage'
import TasksPage from './pages/TasksPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<NotesPage />} />
      <Route path="/tags" element={<TagsPage />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/skills" element={<SkillsPage />} />
      <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/graph" element={<GraphPage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/trash" element={<TrashPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/share/:shareCode" element={<SharedNotePage />} />
    </Routes>
  )
}

export default App
