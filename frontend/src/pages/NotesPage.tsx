import { useState } from 'react'
import AppLayout from '../components/AppLayout'
import NoteList from '../components/NoteList'
import MarkdownEditor from '../components/MarkdownEditor'
import type { INote } from '../types'

export default function NotesPage() {
  const [selectedNote, setSelectedNote] = useState<INote | null>(null)

  return (
    <AppLayout
      mainContent={<MarkdownEditor note={selectedNote} />}
    >
      <NoteList
        onSelectNote={(note) => setSelectedNote(note)}
        onDeleteNote={(id) => { if (selectedNote?.id === id) setSelectedNote(null) }}
        selectedNoteId={selectedNote?.id}
      />
    </AppLayout>
  )
}
