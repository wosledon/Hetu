import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PenTool, Pencil, Plus, Trash2 } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { confirm } from '../components/confirm'
import { whiteboardService } from '../services/whiteboardService'
import { formatDateTime } from '../utils/locale'
import { thumbnailDataUrl } from '../utils/whiteboard'
import type { IWhiteboardListItem } from '../types/whiteboard'
import { Button, Card, IconButton, Input, Modal, PageContainer } from '../components/ui'

/** 画板列表：新建 / 重命名 / 删除 / 进入编辑 */
export default function WhiteboardPage() {
  const { t } = useTranslation('whiteboard')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<IWhiteboardListItem | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const boardsQuery = useQuery({
    queryKey: ['whiteboards'],
    queryFn: () => whiteboardService.list(1, 100),
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['whiteboards'] })

  const createMutation = useMutation({
    mutationFn: (name: string) => whiteboardService.create({ name }),
    onSuccess: (board) => {
      setCreating(false)
      setNewName('')
      void invalidate()
      navigate(`/whiteboard/${board.id}`)
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => whiteboardService.update(id, { name }),
    onSuccess: () => {
      setRenaming(null)
      void invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => whiteboardService.remove(id),
    onSuccess: () => void invalidate(),
  })

  const boards = boardsQuery.data?.items ?? []

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <PageContainer variant="fill" className="flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-200 bg-white glass px-6 py-3 dark:border-white/[0.08] dark:bg-gray-900/50">
            <div className="flex items-center gap-2">
              <PenTool size={20} className="text-blue-500" />
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('page.title')}</h1>
              <span className="text-xs text-gray-400">{t('page.subtitle')}</span>
            </div>
            <Button
              variant="primary"
              tone="blue"
              className="flex items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              onClick={() => {
                setNewName('')
                setCreating(true)
              }}
            >
              <Plus size={15} /> {t('page.newBoard')}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {boards.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/[0.06]">
                  <PenTool size={32} className="text-gray-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">{t('page.emptyTitle')}</h2>
                <p className="mt-1 text-sm text-gray-400">{t('page.emptyHint')}</p>
                <Button
                  variant="primary"
                  tone="blue"
                  className="mt-4 flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                  onClick={() => {
                    setNewName('')
                    setCreating(true)
                  }}
                >
                  <Plus size={16} /> {t('page.newBoard')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {boards.map((board) => (
                  <Card
                    key={board.id}
                    padded={false}
                    interactive
                    className="group cursor-pointer overflow-hidden"
                    onClick={() => navigate(`/whiteboard/${board.id}`)}
                  >
                    {/* 缩略图：有内容显示矢量小图，空画板显示占位 */}
                    <div className="flex h-36 items-center justify-center border-b border-gray-100 bg-gray-50 dark:border-white/[0.06] dark:bg-white/[0.03]">
                      {board.thumbnail
                        ? <img src={thumbnailDataUrl(board.thumbnail)} alt="" className="h-full w-full object-contain" />
                        : <PenTool size={28} className="text-gray-300 dark:text-gray-600" />}
                    </div>
                    <div className="flex items-start justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{board.name}</h3>
                        <p className="mt-1 text-xs text-gray-400">{formatDateTime(board.updatedAt)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <IconButton
                          label={t('page.rename')}
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation()
                            setRenameValue(board.name)
                            setRenaming(board)
                          }}
                        >
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton
                          label={t('page.delete')}
                          size="sm"
                          variant="danger"
                          onClick={(event) => {
                            event.stopPropagation()
                            confirm({
                              title: t('page.delete'),
                              message: t('page.deleteConfirm', { name: board.name }),
                              onConfirm: () => deleteMutation.mutate(board.id),
                            })
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </PageContainer>
      }
    >
      <Modal open={creating} onClose={() => setCreating(false)} size="sm" label={t('page.newBoard')}>
        <div className="p-5">
          <h2 className="mb-3 text-base font-semibold text-gray-800 dark:text-gray-100">{t('page.newBoard')}</h2>
          <Input
            autoFocus
            value={newName}
            placeholder={t('page.namePlaceholder')}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newName.trim()) createMutation.mutate(newName.trim())
            }}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>{t('page.cancel')}</Button>
            <Button
              variant="primary"
              tone="blue"
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(newName.trim())}
            >
              {t('page.create')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={renaming !== null} onClose={() => setRenaming(null)} size="sm" label={t('page.rename')}>
        <div className="p-5">
          <h2 className="mb-3 text-base font-semibold text-gray-800 dark:text-gray-100">{t('page.rename')}</h2>
          <Input
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && renameValue.trim() && renaming)
                renameMutation.mutate({ id: renaming.id, name: renameValue.trim() })
            }}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenaming(null)}>{t('page.cancel')}</Button>
            <Button
              variant="primary"
              tone="blue"
              disabled={!renameValue.trim() || renameMutation.isPending}
              onClick={() => renaming && renameMutation.mutate({ id: renaming.id, name: renameValue.trim() })}
            >
              {t('page.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  )
}
