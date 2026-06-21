import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, Circle, Clock, Ban, Plus, Trash2, Edit2, X,
  AlertTriangle, BarChart3, ListTodo, Loader2, ChevronDown,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { taskService } from '../services/taskService'
import type { ITaskItem, ITaskStats } from '../types'

const STATUS_MAP: Record<number, { label: string; color: string; bg: string; icon: typeof Circle }> = {
  0: { label: '待办', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-white/[0.06]', icon: Circle },
  1: { label: '进行中', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10', icon: Clock },
  2: { label: '已完成', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: CheckCircle2 },
  3: { label: '已阻塞', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', icon: Ban },
}

const PRIORITY_MAP: Record<number, { label: string; color: string; dot: string }> = {
  0: { label: '低', color: 'text-gray-400', dot: 'bg-gray-300' },
  1: { label: '中', color: 'text-blue-400', dot: 'bg-blue-400' },
  2: { label: '高', color: 'text-orange-400', dot: 'bg-orange-400' },
  3: { label: '紧急', color: 'text-red-500', dot: 'bg-red-500' },
}

type FilterStatus = 'all' | '0' | '1' | '2' | '3'

export default function TasksPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<ITaskItem | null>(null)

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['task-items'],
    queryFn: taskService.getAll,
  })

  const { data: stats } = useQuery({
    queryKey: ['task-items', 'stats'],
    queryFn: taskService.getStats,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => taskService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-items'] })
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: number }) => taskService.updateStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-items'] }),
  })

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === Number(filter))

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-8">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">任务管理</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">跟踪和管理进行中的任务</p>
              </div>
              <button
                onClick={() => { setEditingItem(null); setShowForm(true) }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md active:scale-[0.98]"
              >
                <Plus size={15} /> 新建任务
              </button>
            </div>

            {/* Stats Cards */}
            {stats && <StatsCards stats={stats} />}

            {/* Filter Tabs */}
            <div className="mb-6 flex items-center gap-1 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.04]">
              {([
                { key: 'all', label: '全部', count: stats?.total },
                { key: '0', label: '待办', count: stats?.todo },
                { key: '1', label: '进行中', count: stats?.inProgress },
                { key: '2', label: '已完成', count: stats?.done },
                { key: '3', label: '已阻塞', count: stats?.blocked },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                    filter === tab.key
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="text-[11px] opacity-60">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Task List */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-gray-400" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState filter={filter} onCreate={() => { setEditingItem(null); setShowForm(true) }} />
            ) : (
              <div className="space-y-2">
                {filtered.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onEdit={() => { setEditingItem(task); setShowForm(true) }}
                    onDelete={() => deleteMutation.mutate(task.id)}
                    onStatusChange={(status) => statusMutation.mutate({ id: task.id, status })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Form Modal */}
          {showForm && (
            <TaskFormModal
              item={editingItem}
              onClose={() => { setShowForm(false); setEditingItem(null) }}
              onSaved={() => {
                setShowForm(false)
                setEditingItem(null)
                queryClient.invalidateQueries({ queryKey: ['task-items'] })
              }}
            />
          )}
        </div>
      }
    >
      {null}
    </AppLayout>
  )
}

/* ─── Stats Cards ─── */

function StatsCards({ stats }: { stats: ITaskStats }) {
  const cards = [
    { label: '进行中', value: stats.inProgress, icon: Clock, color: 'from-blue-500 to-indigo-500', shadow: 'shadow-blue-500/20' },
    { label: '待办', value: stats.todo, icon: ListTodo, color: 'from-gray-400 to-gray-500', shadow: 'shadow-gray-500/20' },
    { label: '已完成', value: stats.done, icon: CheckCircle2, color: 'from-emerald-500 to-teal-500', shadow: 'shadow-emerald-500/20' },
    { label: '已阻塞', value: stats.blocked, icon: Ban, color: 'from-red-500 to-rose-500', shadow: 'shadow-red-500/20' },
  ]

  if (stats.overdue > 0) {
    cards.push({ label: '逾期', value: stats.overdue, icon: AlertTriangle, color: 'from-orange-500 to-amber-500', shadow: 'shadow-orange-500/20' })
  }

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div key={card.label} className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
            <div className="mb-2 flex items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${card.color} text-white shadow-sm ${card.shadow}`}>
                <Icon size={13} />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">{card.label}</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-50">{card.value}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Task Card ─── */

function TaskCard({
  task,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  task: ITaskItem
  onEdit: () => void
  onDelete: () => void
  onStatusChange: (status: number) => void
}) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const status = STATUS_MAP[task.status] ?? STATUS_MAP[0]
  const priority = PRIORITY_MAP[task.priority] ?? PRIORITY_MAP[0]
  const StatusIcon = status.icon
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 2

  return (
    <div className="group relative rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm transition-all hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.03]">
      <div className="flex items-start gap-3">
        {/* Status Icon */}
        <div className="relative mt-0.5">
          <button
            onClick={() => setShowStatusMenu(!showStatusMenu)}
            className={`rounded-lg p-1 transition-colors ${status.color} hover:bg-gray-100 dark:hover:bg-white/[0.06]`}
            title="更改状态"
          >
            <StatusIcon size={18} />
          </button>
          {showStatusMenu && (
            <div className="absolute left-0 top-8 z-20 w-32 rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-white/[0.08] dark:bg-[#12151f]">
              {Object.entries(STATUS_MAP).map(([key, val]) => {
                const Icon = val.icon
                return (
                  <button
                    key={key}
                    onClick={() => { onStatusChange(Number(key)); setShowStatusMenu(false) }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                  >
                    <Icon size={14} className={val.color} />
                    <span className="text-gray-700 dark:text-gray-300">{val.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-1.5 w-1.5 rounded-full ${priority.dot}`} title={priority.label + '优先级'} />
            <h3 className={`text-sm font-medium ${task.status === 2 ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
              {task.title}
            </h3>
            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${status.bg} ${status.color}`}>
              {status.label}
            </span>
            {isOverdue && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-500 dark:bg-orange-500/10">
                <AlertTriangle size={10} /> 逾期
              </span>
            )}
          </div>
          {task.description && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 line-clamp-2">{task.description}</p>
          )}
          <div className="mt-2 flex items-center gap-4">
            {/* Progress Bar */}
            {task.status !== 2 && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-all ${
                      task.progress >= 100 ? 'bg-emerald-500' : task.progress >= 50 ? 'bg-blue-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
                <span className="text-[11px] text-gray-400">{task.progress}%</span>
              </div>
            )}
            {task.dueDate && (
              <span className={`text-[11px] ${isOverdue ? 'text-orange-500 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
                截止 {new Date(task.dueDate).toLocaleDateString('zh-CN')}
              </span>
            )}
            {task.tags && task.tags.split(',').map((tag) => (
              <span key={tag} className="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                {tag.trim()}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onEdit} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300">
            <Edit2 size={14} />
          </button>
          <button onClick={onDelete} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Empty State ─── */

function EmptyState({ filter, onCreate }: { filter: FilterStatus; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-20 dark:border-white/[0.08]">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/[0.06]">
        <BarChart3 size={28} className="text-gray-400" />
      </div>
      <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">
        {filter === 'all' ? '还没有任务' : '没有符合条件的任务'}
      </p>
      {filter === 'all' && (
        <button
          onClick={onCreate}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
        >
          <Plus size={14} /> 创建第一个任务
        </button>
      )}
    </div>
  )
}

/* ─── Task Form Modal ─── */

function TaskFormModal({
  item,
  onClose,
  onSaved,
}: {
  item: ITaskItem | null
  onClose: () => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [status, setStatus] = useState(item?.status ?? 0)
  const [priority, setPriority] = useState(item?.priority ?? 1)
  const [progress, setProgress] = useState(item?.progress ?? 0)
  const [dueDate, setDueDate] = useState(item?.dueDate?.slice(0, 10) ?? '')
  const [tags, setTags] = useState(item?.tags ?? '')

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof taskService.create>[0]) => taskService.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['task-items'] }); onSaved() },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof taskService.update>[1]) => taskService.update(item!.id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['task-items'] }); onSaved() },
  })

  const handleSubmit = () => {
    if (!title.trim()) return
    const data = {
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      progress,
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      tags: tags.trim() || undefined,
      sortOrder: item?.sortOrder ?? 0,
    }
    if (item) updateMutation.mutate(data)
    else createMutation.mutate(data)
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[480px] max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-200/80 bg-white p-6 shadow-2xl dark:border-white/[0.08] dark:bg-[#12151f]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">{item ? '编辑任务' : '新建任务'}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">标题 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="任务标题"
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="任务描述（可选）"
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">状态</label>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => { const s = Number(e.target.value); setStatus(s); if (s === 2) setProgress(100) }}
                  className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
                >
                  {Object.entries(STATUS_MAP).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">优先级</label>
              <div className="relative">
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
                >
                  {Object.entries(PRIORITY_MAP).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">进度 {progress}%</label>
            <input
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">截止日期</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">标签</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="逗号分隔"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || isPending}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {item ? '保存修改' : '创建任务'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
