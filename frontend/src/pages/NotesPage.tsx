import { useState } from 'react'
import AppLayout from '../components/AppLayout'
import NoteList from '../components/NoteList'
import NotesTree from '../components/NotesTree'
import MarkdownEditor from '../components/MarkdownEditor'
import { useUIStore } from '../stores/uiStore'
import type { INote } from '../types'

export default function NotesPage() {
  const [selectedNote, setSelectedNote] = useState<INote | null>(null)
  const secondaryMenuStyle = useUIStore((state) => state.secondaryMenuStyle)
  const setSelectedNotebookId = useUIStore((state) => state.setSelectedNotebookId)
  const collapsed = secondaryMenuStyle === 'collapsed'

  return (
    <AppLayout
      showSidebar={!collapsed}
      mainContent={<MarkdownEditor note={selectedNote} />}
    >
      {collapsed ? (
        <NotesTree
          selectedNoteId={selectedNote?.id}
          onSelectNote={(note) => setSelectedNote(note)}
          onSelectNotebook={() => setSelectedNote(null)}
          onClearNotebook={() => setSelectedNotebookId(undefined)}
        />
      ) : (
        <NoteList
          onSelectNote={(note) => setSelectedNote(note)}
          onDeleteNote={(id) => { if (selectedNote?.id === id) setSelectedNote(null) }}
          selectedNoteId={selectedNote?.id}
        />
      )}
    </AppLayout>
  )
}
