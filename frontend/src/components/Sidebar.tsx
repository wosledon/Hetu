import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { noteService } from '../services/noteService'
import NotesTree from './NotesTree'

/**
 * 全局次级侧栏：嵌套笔记树。点击笔记打开编辑器并把列表切到其子笔记，
 * 与 NotesPage 内的 NotesTree（折叠模式）共用同一组件与选中状态。
 */
export default function Sidebar() {
  const { t } = useTranslation('notes')
  const setSelectedNoteId = useUIStore((s) => s.setSelectedNoteId)

  const { data: notesPaged } = useQuery({
    queryKey: ['notes', 'sidebar-stats'],
    queryFn: () => noteService.getList({ page: 1, pageSize: 1 }),
    staleTime: 30 * 1000,
  })
  const totalNotes = notesPaged?.totalCount ?? 0

  return (
    <aside className="flex h-full min-h-0 w-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <NotesTree
          embedded
          onSelectNote={(note) => setSelectedNoteId(note.id)}
        />
      </div>
      <div className="shrink-0 border-t border-gray-100 px-4 py-2.5 dark:border-gray-800/50">
        <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
          <span className="flex items-center gap-1">
            <FileText size={11} />
            {t('sidebar.notesCount', { n: totalNotes })}
          </span>
        </div>
      </div>
    </aside>
  )
}
