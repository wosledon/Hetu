import { useState } from 'react'
import AppLayout from '../components/AppLayout'
import NoteList from '../components/NoteList'
import MarkdownEditor from '../components/MarkdownEditor'
import type { INote } from '../types'

export default function TrashPage() {
  const [selectedNote, setSelectedNote] = useState<INote | null>(null)

  return (
    <AppLayout
      showSidebar={false}
      mainContent={<MarkdownEditor note={selectedNote} />}
    >
      <NoteList
        onSelectNote={setSelectedNote}
        selectedNoteId={selectedNote?.id}
        includeDeleted
      />
    </AppLayout>
  )
}
