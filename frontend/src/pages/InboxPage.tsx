import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { confirm } from '../components/confirm'
import {
  Inbox,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CheckCheck,
  MailOpen,
  Archive,
  ArchiveRestore,
  Trash2,
  Check,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { inboxService } from '../services/inboxService'
import type { IInboxNotification, InboxLevel, InboxBatchAction } from '../types'

const LEVEL_STYLE: Record<InboxLevel, { icon: typeof Info; className: string }> = {
  Info: { icon: Info, className: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10' },
  Success: { icon: CheckCircle2, className: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' },
  Warning: { icon: AlertTriangle, className: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
  Error: { icon: XCircle, className: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
}

const CATEGORY_STYLE: Record<string, string> = {
  '定时任务': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  '工作流': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  '系统': 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

function getCategoryStyle(category: string): string {
  return CATEGORY_STYLE[category] ?? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 30) return `${diffDays} 天前`
  return date.toLocaleDateString('zh-CN')
}

export default function InboxPage() {
  const queryClient = useQueryClient()
  const [archived, setArchived] = useState(false)
  const [category, setCategory] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox'] })
    setSelected([])
  }

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['inbox', 'list', archived, category],
    queryFn: () => inboxService.getAll({ archived, category: category ?? undefined }),
  })

  const { data: categories } = useQuery({
    queryKey: ['inbox', 'categories', archived],
    queryFn: () => inboxService.getCategories(archived),
  })

  const { data: unreadCount } = useQuery({
    queryKey: ['inbox', 'unread-count'],
    queryFn: inboxService.getUnreadCount,
  })

  const batchMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: InboxBatchAction }) =>
      inboxService.batch(ids, action),
    onSuccess: invalidate,
  })

  const markReadMutation = useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) => inboxService.markRead(id, isRead),
    onSuccess: invalidate,
  })

  const archiveMutation = useMutation({
    mutationFn: ({ id, isArchived }: { id: string; isArchived: boolean }) =>
      inboxService.setArchived(id, isArchived),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: inboxService.delete,
    onSuccess: invalidate,
  })

  const items = notifications ?? []
  const selectedSet = new Set(selected)
  const allSelected = items.length > 0 && items.every((n) => selectedSet.has(n.id))

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleSelectAll = () => {
    setSelected(allSelected ? [] : items.map((n) => n.id))
  }

  const runBatch = (action: InboxBatchAction) => {
    if (selected.length === 0) return
    if (action === 'delete') {
      confirm({
        title: '删除通知',
        message: `确定删除选中的 ${selected.length} 条通知？`,
        onConfirm: () => batchMutation.mutate({ ids: selected, action }),
      })
      return
    }
    batchMutation.mutate({ ids: selected, action })
  }

  const handleItemClick = (item: IInboxNotification) => {
    if (!item.isRead) markReadMutation.mutate({ id: item.id, isRead: true })
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-4xl px-8 py-8">
            {/* Header */}
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-500/20">
                  <Inbox size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">收件箱</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">应用内的通知汇总，支持归档与批量操作</p>
                </div>
              </div>
              {!archived && (unreadCount ?? 0) > 0 && (
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  {unreadCount} 条未读
                </span>
              )}
            </div>

            {/* 归档切换 + 分类筛选 */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                <button
                  onClick={() => { setArchived(false); setSelected([]) }}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all ${
                    !archived
                      ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  收件箱
                </button>
                <button
                  onClick={() => { setArchived(true); setCategory(null); setSelected([]) }}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all ${
                    archived
                      ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  已归档
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => { setCategory(null); setSelected([]) }}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    category === null
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
                  }`}
                >
                  全部
                </button>
                {(categories ?? []).map((c) => (
                  <button
                    key={c.category}
                    onClick={() => { setCategory(c.category); setSelected([]) }}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      category === c.category
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
                    }`}
                  >
                    {c.category}
                    {c.unreadCount > 0 && (
                      <span className={`ml-1 ${category === c.category ? 'text-blue-100' : 'text-blue-500'}`}>
                        {c.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 列表 */}
            <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              {/* 工具栏：全选 + 批量操作 */}
              <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
                  />
                  全选
                </label>
                {selected.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">已选 {selected.length} 条</span>
                    <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
                    <BatchButton icon={CheckCheck} label="已读" onClick={() => runBatch('read')} />
                    <BatchButton icon={MailOpen} label="未读" onClick={() => runBatch('unread')} />
                    {archived ? (
                      <BatchButton icon={ArchiveRestore} label="取消归档" onClick={() => runBatch('unarchive')} />
                    ) : (
                      <BatchButton icon={Archive} label="归档" onClick={() => runBatch('archive')} />
                    )}
                    <BatchButton icon={Trash2} label="删除" danger onClick={() => runBatch('delete')} />
                  </div>
                )}
              </div>

              {isLoading ? (
                <div className="flex h-40 items-center justify-center text-xs text-gray-400 dark:text-gray-500">
                  加载中…
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
                  <Inbox size={28} className="opacity-40" />
                  <p className="text-xs">{archived ? '暂无归档通知' : '暂无通知'}</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {items.map((item) => {
                    const level = LEVEL_STYLE[item.level] ?? LEVEL_STYLE.Info
                    const LevelIcon = level.icon
                    return (
                      <li
                        key={item.id}
                        className={`group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03] ${
                          item.isRead ? '' : 'bg-blue-50/40 dark:bg-blue-500/[0.04]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSet.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-gray-300 dark:border-gray-600"
                        />
                        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${level.className}`}>
                          <LevelIcon size={13} />
                        </div>
                        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => handleItemClick(item)}>
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-gray-900 dark:text-gray-100">
                              {item.title}
                            </span>
                            {item.occurrenceCount > 1 && (
                              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                                ×{item.occurrenceCount}
                              </span>
                            )}
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${getCategoryStyle(item.category)}`}>
                              {item.category}
                            </span>
                            <span className="ml-auto shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                              {formatTime(item.updatedAt)}
                            </span>
                          </div>
                          {item.content && (
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                              {item.content}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          {!item.isRead && (
                            <button
                              title="标记已读"
                              onClick={() => markReadMutation.mutate({ id: item.id, isRead: true })}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                            >
                              <Check size={14} />
                            </button>
                          )}
                          {archived ? (
                            <button
                              title="取消归档"
                              onClick={() => archiveMutation.mutate({ id: item.id, isArchived: false })}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                            >
                              <ArchiveRestore size={14} />
                            </button>
                          ) : (
                            <button
                              title="归档"
                              onClick={() => archiveMutation.mutate({ id: item.id, isArchived: true })}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                            >
                              <Archive size={14} />
                            </button>
                          )}
                          <button
                            title="删除"
                            onClick={() =>
                              confirm({
                                title: '删除通知',
                                message: '确定删除该通知？',
                                onConfirm: () => deleteMutation.mutate(item.id),
                              })
                            }
                            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      }
    />
  )
}

function BatchButton({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: typeof Check
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
        danger
          ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'
      }`}
    >
      <Icon size={12} />
      {label}
    </button>
  )
}
