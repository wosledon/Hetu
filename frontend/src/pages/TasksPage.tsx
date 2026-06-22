import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, Clock, Loader2, AlertTriangle, Trash2, XCircle,
  ListTodo, RefreshCw, Cpu, Network, CalendarClock, Plus, Sparkles,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { taskService } from '../services/taskService'
import type { ITaskItem, ITaskStats } from '../types'

type TasksMode = 'background' | 'scheduled'

const STATUS_MAP: Record<number, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  0: { label: '排队中', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-white/[0.06]', icon: ListTodo },
  1: { label: '执行中', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10', icon: Clock },
  2: { label: '已完成', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: CheckCircle2 },
  3: { label: '失败', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', icon: XCircle },
}

const TYPE_MAP: Record<string, { label: string; icon: typeof Cpu; color: string }> = {
  GenerateEmbedding: { label: 'Embedding 生成', icon: Cpu, color: 'text-indigo-500' },
  GraphExtract: { label: '知识图谱提取', icon: Network, color: 'text-violet-500' },
}

type FilterStatus = 'all' | '0' | '1' | '2' | '3'

export default function TasksPage({ mode }: { mode: TasksMode }) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [typeFilter, setTypeFilter] = useState<string>('')

  const { data: tasks = [], isLoading, isRefetching } = useQuery({
    queryKey: ['task-items', typeFilter],
    queryFn: () => taskService.getAll(typeFilter ? { type: typeFilter } : undefined),
    refetchInterval: 5000,
  })

  const { data: stats } = useQuery({
    queryKey: ['task-items', 'stats'],
    queryFn: taskService.getStats,
    refetchInterval: 5000,
  })

  const clearMutation = useMutation({
    mutationFn: taskService.clearCompleted,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-items'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => taskService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-items'] }),
  })

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === Number(filter))

  const isBackground = mode === 'background'
  const headerTitle = isBackground ? '后台任务' : '定时任务'
  const headerSubtitle = isBackground ? '系统后台任务的执行状态和历史记录' : '按计划周期触发的定时任务'

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-8">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">{headerTitle}</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{headerSubtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                {isBackground && isRefetching && <Loader2 size={14} className="animate-spin text-gray-400" />}
                {isBackground && (
                  <button
                    onClick={() => {
                      queryClient.invalidateQueries({ queryKey: ['task-items'] })
                    }}
                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
                    title="刷新"
                  >
                    <RefreshCw size={16} />
                  </button>
                )}
                {isBackground && stats && stats.completed > 0 && (
                  <button
                    onClick={() => clearMutation.mutate()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
                  >
                    <Trash2 size={12} /> 清除已完成
                  </button>
                )}
              </div>
            </div>

            {isBackground ? (
              <BackgroundTasksView
                stats={stats}
                tasks={filtered}
                isLoading={isLoading}
                filter={filter}
                setFilter={setFilter}
                typeFilter={typeFilter}
                setTypeFilter={setTypeFilter}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ) : (
              <ScheduledTasksView />
            )}
          </div>
        </div>
      }
    >
      {null}
    </AppLayout>
  )
}

/* ─── Background Tasks View ─── */

interface BackgroundTasksViewProps {
  stats: ITaskStats | undefined
  tasks: ITaskItem[]
  isLoading: boolean
  filter: FilterStatus
  setFilter: (f: FilterStatus) => void
  typeFilter: string
  setTypeFilter: (t: string) => void
  onDelete: (id: string) => void
}

function BackgroundTasksView({
  stats,
  tasks,
  isLoading,
  filter,
  setFilter,
  typeFilter,
  setTypeFilter,
  onDelete,
}: BackgroundTasksViewProps) {
  return (
    <>
      {/* Stats */}
      {stats && <StatsCards stats={stats} />}

      {/* Filters */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.04]">
          {([
            { key: 'all', label: '全部', count: stats?.total },
            { key: '0', label: '排队中', count: stats?.queued },
            { key: '1', label: '执行中', count: stats?.running },
            { key: '2', label: '已完成', count: stats?.completed },
            { key: '3', label: '失败', count: stats?.failed },
          ] as const).map((subTab) => (
            <button
              key={subTab.key}
              onClick={() => setFilter(subTab.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                filter === subTab.key
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {subTab.label}
              {subTab.count !== undefined && subTab.count > 0 && (
                <span className="text-[11px] opacity-60">{subTab.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-gray-100/60 p-0.5 dark:bg-white/[0.04]">
          <button
            onClick={() => setTypeFilter('')}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              !typeFilter ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-200' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            全部类型
          </button>
          {Object.entries(TYPE_MAP).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                typeFilter === key ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-200' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              {val.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onDelete={() => onDelete(task.id)} />
          ))}
        </div>
      )}
    </>
  )
}

/* ─── Scheduled Tasks View ─── */

function ScheduledTasksView() {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gradient-to-br from-white to-gray-50/60 p-12 dark:border-white/[0.08] dark:from-white/[0.02] dark:to-transparent">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="relative">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30">
            <CalendarClock size={28} />
          </div>
          <div className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-white shadow-md">
            <Sparkles size={12} />
          </div>
        </div>
        <h2 className="mt-5 text-lg font-semibold text-gray-900 dark:text-gray-100">定时任务</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          按计划周期触发的任务，例如：定时同步、定时备份、定时摘要、Cron 表达式调度等。
        </p>
        <div className="mt-6 w-full rounded-xl border border-gray-200/80 bg-white/80 p-4 text-left dark:border-white/[0.08] dark:bg-white/[0.03]">
          <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-300">即将支持的能力</p>
          <ul className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
              Cron 表达式 / 简易周期（每天 / 每周 / 每月）
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
              定时执行 Skill、Workflow、知识库重建
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
              下一次运行时间预览与历史执行记录
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
              失败重试与告警通知
            </li>
          </ul>
        </div>
        <button
          disabled
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-400 dark:bg-white/[0.06] dark:text-gray-500"
          title="功能开发中"
        >
          <Plus size={13} />
          新建定时任务（开发中）
        </button>
      </div>
    </div>
  )
}

/* ─── Stats ─── */

function StatsCards({ stats }: { stats: ITaskStats }) {
  const cards = [
    { label: '排队中', value: stats.queued, icon: ListTodo, color: 'from-gray-400 to-gray-500', shadow: 'shadow-gray-500/20' },
    { label: '执行中', value: stats.running, icon: Clock, color: 'from-blue-500 to-indigo-500', shadow: 'shadow-blue-500/20' },
    { label: '已完成', value: stats.completed, icon: CheckCircle2, color: 'from-emerald-500 to-teal-500', shadow: 'shadow-emerald-500/20' },
    { label: '失败', value: stats.failed, icon: XCircle, color: 'from-red-500 to-rose-500', shadow: 'shadow-red-500/20' },
  ]

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

/* ─── Task Row ─── */

function TaskRow({ task, onDelete }: { task: ITaskItem; onDelete: () => void }) {
  const status = STATUS_MAP[task.status] ?? STATUS_MAP[0]
  const typeInfo = TYPE_MAP[task.taskType] ?? { label: task.taskType, icon: Cpu, color: 'text-gray-500' }
  const StatusIcon = status.icon
  const TypeIcon = typeInfo.icon

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  }

  return (
    <div className="group rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm transition-all hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.03]">
      <div className="flex items-center gap-3">
        {/* Status Icon */}
        <div className={`rounded-lg p-1.5 ${status.bg}`}>
          <StatusIcon size={16} className={status.color} />
        </div>

        {/* Type */}
        <div className="flex items-center gap-1.5">
          <TypeIcon size={14} className={typeInfo.color} />
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{typeInfo.label}</span>
        </div>

        {/* Entity */}
        <div className="min-w-0 flex-1">
          {task.entityTitle ? (
            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{task.entityTitle}</span>
          ) : (
            <span className="text-sm text-gray-400 dark:text-gray-500 font-mono text-xs">{task.entityId.slice(0, 8)}...</span>
          )}
        </div>

        {/* Duration */}
        {task.durationMs !== null && task.durationMs !== undefined && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
            {formatDuration(task.durationMs)}
          </span>
        )}

        {/* Time */}
        <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
          {new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>

        {/* Status Badge */}
        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${status.bg} ${status.color}`}>
          {status.label}
        </span>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="rounded-md p-1 text-gray-300 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-red-400"
          title="删除记录"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Error */}
      {task.errorMessage && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-500/[0.08]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-400" />
          <span className="text-xs text-red-600 dark:text-red-400">{task.errorMessage}</span>
        </div>
      )}
    </div>
  )
}

/* ─── Empty State ─── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-20 dark:border-white/[0.08]">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/[0.06]">
        <ListTodo size={28} className="text-gray-400" />
      </div>
      <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">暂无后台任务</p>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">编辑笔记时会自动生成 Embedding 和提取知识图谱</p>
    </div>
  )
}
