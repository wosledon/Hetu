import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { IProjectGroup, ICreateProjectGroupRequest, IUpdateProjectGroupRequest } from '../../types/project'
import { Button, IconButton, Input, Modal } from '../ui'

interface GroupManagerDialogProps {
  groups: IProjectGroup[]
  pending: boolean
  onCreate: (data: ICreateProjectGroupRequest) => void
  onUpdate: (id: string, data: IUpdateProjectGroupRequest) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export default function GroupManagerDialog({
  groups, pending, onCreate, onUpdate, onDelete, onClose,
}: GroupManagerDialogProps) {
  const { t } = useTranslation('projects')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submitNew = () => {
    if (!newName.trim()) { setError(t('groupDialog.nameRequired')); return }
    setError('')
    onCreate({ name: newName.trim() })
    setNewName('')
  }

  const submitRename = (group: IProjectGroup) => {
    const name = editingName.trim()
    if (!name) { setError(t('groupDialog.nameEmpty')); return }
    setError('')
    onUpdate(group.id, { name, description: group.description, sortOrder: group.sortOrder })
    setEditingId(null)
  }

  return (
    <Modal open onClose={onClose} className="max-w-md max-h-[85vh] overflow-hidden">

        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('groupDialog.title')}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-gray-400">{t('groupDialog.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {groups.map((group) => (
                <li
                  key={group.id}
                  className="group flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800"
                >
                  {editingId === group.id ? (
                    <>
                      <Input tone="blue" size="sm"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitRename(group)}
                        autoFocus
                        className="min-w-0 flex-1"
                      />
                      <Button variant="link" tone="emerald" className="shrink-0 p-1 text-emerald-600 hover:bg-gray-100" onClick={() => submitRename(group)}
                        
                        title={t('common:save')}>
                        <Pencil size={13} />
                      </Button>
                      <IconButton variant="ghost" label={t('common:cancel')} className="shrink-0 p-1 text-gray-400 hover:bg-emerald-50" onClick={() => setEditingId(null)}
                        
                        title={t('common:cancel')}>
                        <X size={13} />
                      </IconButton>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700 dark:text-gray-300" title={group.name}>
                        {group.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-gray-400">{t('groupDialog.projectCount', { count: group.projectCount })}</span>
                      <IconButton label={t('common:rename')} variant="ghost" className="shrink-0 p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-100" onClick={() => { setEditingId(group.id); setEditingName(group.name); setError('') }}
                        
                        title={t('common:rename')}>
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton variant="ghost" label={t('groupDialog.deleteTitle')} className="shrink-0 p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600" onClick={() => {
                          if (window.confirm(t('groupDialog.deleteConfirm', { name: group.name }))) onDelete(group.id)
                        }}
                        
                        title={t('groupDialog.deleteTitle')}>
                        <Trash2 size={13} />
                      </IconButton>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Input tone="blue"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitNew()}
              placeholder={t('groupDialog.newGroupPlaceholder')}
              className="min-w-0 flex-1"
            />
            <Button variant="primary" size="sm" className="flex shrink-0 items-center gap-1 px-3.5 py-2 hover:bg-gray-100 hover:text-red-500" onClick={submitNew}
              disabled={pending}>
              {pending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {t('groupDialog.create')}
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <p className="mt-2 text-[11px] leading-relaxed text-gray-400">{t('groupDialog.deleteHint')}</p>
        </div>
</Modal>
  )
}
