import { Routes, Route } from 'react-router-dom'
import NotesPage from './pages/NotesPage'
import TagsPage from './pages/TagsPage'
import SearchPage from './pages/SearchPage'
import TrashPage from './pages/TrashPage'
import SettingsPage from './pages/SettingsPage'
import ChatPage from './pages/ChatPage'
import GraphPage from './pages/GraphPage'
import AgentsPage from './pages/AgentsPage'
import SharedNotePage from './pages/SharedNotePage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<NotesPage />} />
      <Route path="/tags" element={<TagsPage />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/graph" element={<GraphPage />} />
      <Route path="/trash" element={<TrashPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/share/:shareCode" element={<SharedNotePage />} />
    </Routes>
  )
}

export default App
