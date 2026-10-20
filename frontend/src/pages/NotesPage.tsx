import { useQuery } from '@tanstack/react-query'
import AppLayout from '../components/AppLayout'
import NoteList from '../components/NoteList'
import NotesTree from '../components/NotesTree'
import MarkdownEditor from '../components/MarkdownEditor'
import { useUIStore } from '../stores/uiStore'
import { noteService } from '../services/noteService'

export default function NotesPage() {
  const secondaryMenuStyle = useUIStore((state) => state.secondaryMenuStyle)
  const selectedNoteId = useUIStore((state) => state.selectedNoteId)
  const setSelectedNoteId = useUIStore((state) => state.setSelectedNoteId)
  const collapsed = secondaryMenuStyle === 'collapsed'

  // 选中笔记由 store 持有（侧栏树与列表共用），详情按需拉取
  const { data: selectedNote } = useQuery({
    queryKey: ['note', selectedNoteId],
    queryFn: () => noteService.getById(selectedNoteId!),
    enabled: !!selectedNoteId,
  })

  return (
    <AppLayout
      showSidebar={!collapsed}
      mainContent={<MarkdownEditor note={selectedNote ?? null} />}
    >
      {collapsed ? (
        <NotesTree
          selectedNoteId={selectedNoteId}
          onSelectNote={(note) => setSelectedNoteId(note.id)}
        />
      ) : (
        <NoteList
          onSelectNote={(note) => setSelectedNoteId(note.id)}
          onDeleteNote={(id) => { if (selectedNoteId === id) setSelectedNoteId(undefined) }}
          selectedNoteId={selectedNoteId}
        />
      )}
    </AppLayout>
  )
}
