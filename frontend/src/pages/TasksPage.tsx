import { confirm } from '../components/confirm'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, Clock, Loader2, AlertTriangle, Trash2, XCircle,
  ListTodo, RefreshCw, Cpu, Network, CalendarClock, Plus, Sparkles,
  Pencil, Play, History, Power, Timer, X, Bot, MessageSquare,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import Select from '../components/Select'
import { taskService } from '../services/taskService'
import { scheduledTaskService } from '../services/scheduledTaskService'
import type {
  ITaskItem, ITaskStats,
  IScheduledTask, IScheduledTaskExecution, IScheduledTaskTargetOption,
  ScheduledTaskKind, ScheduleType, ICreateScheduledTaskRequest,
} from '../types'
import { segmentButtonClass } from '../utils/styles'
import { formatDateTime, formatTime } from '../utils/locale'
import type { TFunction } from 'i18next'

type TasksMode = 'background' | 'scheduled'

const STATUS_MAP: Record<number, { labelKey: string; color: string; bg: string; icon: typeof Clock }> = {
  0: { labelKey: 'tasks.statusQueued', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-white/[0.06]', icon: ListTodo },
  1: { labelKey: 'tasks.statusRunning', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10', icon: Clock },
  2: { labelKey: 'tasks.statusCompleted', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: CheckCircle2 },
  3: { labelKey: 'tasks.statusFailed', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', icon: XCircle },
}

const TYPE_MAP: Record<string, { labelKey: string; icon: typeof Cpu; color: string }> = {
  GenerateEmbedding: { labelKey: 'tasks.typeEmbedding', icon: Cpu, color: 'text-indigo-500' },
  GraphExtract: { labelKey: 'tasks.typeGraphExtract', icon: Network, color: 'text-violet-500' },
}

type FilterStatus = 'all' | '0' | '1' | '2' | '3'

export default function TasksPage({ mode }: { mode: TasksMode }) {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [typeFilter, setTypeFilter] = useState<string>('')

  const { data: tasks = [], isLoading, isRefetching } = useQuery({
    queryKey: ['task-items', typeFilter],
    queryFn: () => taskService.getAll(typeFilter ? { type: typeFilter } : undefined),
    // 仅在有排队/运行中任务时轮询，空闲时停止
    refetchInterval: (query) =>
      query.state.data?.some((t) => t.status === 0 || t.status === 1) ? 3000 : false,
  })

  const { data: stats } = useQuery({
    queryKey: ['task-items', 'stats'],
    queryFn: taskService.getStats,
    refetchInterval: (query) => {
      const d = query.state.data
      return d && (d.queued > 0 || d.running > 0) ? 3000 : false
    },
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
  const headerTitle = isBackground ? t('tasks.backgroundTitle') : t('tasks.scheduledTitle')
  const headerSubtitle = isBackground ? t('tasks.backgroundSubtitle') : t('tasks.scheduledSubtitle')

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-6xl px-8 py-8">
            {/* Header */}
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-sm shadow-sky-500/20">
                  {isBackground ? <ListTodo size={20} className="text-white" /> : <CalendarClock size={20} className="text-white" />}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{headerTitle}</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{headerSubtitle}</p>
                </div>
              </div>
              {isBackground && stats && (
                <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                  <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{stats.total}</b> {t('tasks.recordCount')}</span>
                  {(stats.queued > 0 || stats.running > 0) && (
                    <>
                      <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                      <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                        <Loader2 size={12} className="animate-spin" />
                        {t('tasks.runningQueued', { running: stats.running, queued: stats.queued })}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            {isBackground ? (
              <BackgroundTasksView
                stats={stats}
                tasks={filtered}
                isLoading={isLoading}
                isRefetching={isRefetching}
                filter={filter}
                setFilter={setFilter}
                typeFilter={typeFilter}
                setTypeFilter={setTypeFilter}
                onClearCompleted={() => clearMutation.mutate()}
                onRefresh={() => queryClient.invalidateQueries({ queryKey: ['task-items'] })}
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
  isRefetching: boolean
  filter: FilterStatus
  setFilter: (f: FilterStatus) => void
  typeFilter: string
  setTypeFilter: (t: string) => void
  onClearCompleted: () => void
  onRefresh: () => void
  onDelete: (id: string) => void
}

function BackgroundTasksView({
  stats,
  tasks,
  isLoading,
  isRefetching,
  filter,
  setFilter,
  typeFilter,
  setTypeFilter,
  onClearCompleted,
  onRefresh,
  onDelete,
}: BackgroundTasksViewProps) {
  const { t } = useTranslation('projects')
  return (
    <>
      {/* 筛选：状态 + 类型 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { key: 'all', label: t('common:all'), count: stats?.total },
            { key: '0', label: t('tasks.statusQueued'), count: stats?.queued },
            { key: '1', label: t('tasks.statusRunning'), count: stats?.running },
            { key: '2', label: t('tasks.statusCompleted'), count: stats?.completed },
            { key: '3', label: t('tasks.statusFailed'), count: stats?.failed },
          ] as const).map((subTab) => (
            <button
              key={subTab.key}
              onClick={() => setFilter(subTab.key)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${
                filter === subTab.key
                  ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/20'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              {subTab.label}
              {subTab.count !== undefined && subTab.count > 0 && (
                <span className="text-[11px] opacity-70">{subTab.count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
            <button
              onClick={() => setTypeFilter('')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                !typeFilter ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-200' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              {t('tasks.allTypes')}
            </button>
            {Object.entries(TYPE_MAP).map(([key, val]) => (
              <button
                key={key}
                onClick={() => setTypeFilter(key)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                  typeFilter === key ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-200' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                }`}
              >
                {t(val.labelKey)}
              </button>
            ))}
          </div>
          {stats && stats.completed > 0 && (
            <button
              onClick={onClearCompleted}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Trash2 size={12} /> {t('tasks.clearCompleted')}
            </button>
          )}
          <button
            onClick={onRefresh}
            title={t('common:refresh')}
            className="rounded-full border border-gray-200 bg-white p-2 text-gray-500 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <RefreshCw size={13} className={isRefetching ? 'animate-spin' : ''} />
          </button>
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

const TASK_KIND_LABELS: Record<ScheduledTaskKind, { labelKey: string; icon: typeof Cpu; color: string; descKey: string }> = {
  Skill: { labelKey: 'tasks.kindSkill', icon: Sparkles, color: 'text-amber-500', descKey: 'tasks.kindSkillDesc' },
  AiTask: { labelKey: 'tasks.kindAiTask', icon: Bot, color: 'text-blue-500', descKey: 'tasks.kindAiTaskDesc' },
  GraphRebuild: { labelKey: 'tasks.kindGraphRebuild', icon: Network, color: 'text-violet-500', descKey: 'tasks.kindGraphRebuildDesc' },
  EmbeddingRegenerate: { labelKey: 'tasks.kindEmbeddingRegenerate', icon: Cpu, color: 'text-indigo-500', descKey: 'tasks.kindEmbeddingRegenerateDesc' },
}

const LAST_STATUS_MAP: Record<string, { labelKey: string; color: string; bg: string }> = {
  Running: { labelKey: 'tasks.statusRunning', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
  Success: { labelKey: 'tasks.statusSuccess', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  Failed: { labelKey: 'tasks.statusFailed', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10' },
}

const EXEC_STATUS_MAP: Record<string, { labelKey: string; color: string; icon: typeof Clock }> = {
  Running: { labelKey: 'tasks.statusRunning', color: 'text-blue-500', icon: Loader2 },
  Queued: { labelKey: 'tasks.statusQueued', color: 'text-gray-500', icon: ListTodo },
  Success: { labelKey: 'tasks.statusSuccess', color: 'text-emerald-500', icon: CheckCircle2 },
  Failed: { labelKey: 'tasks.statusFailed', color: 'text-red-500', icon: XCircle },
}

function formatTimeLabel(iso?: string) {
  if (!iso) return '-'
  return formatDateTime(iso, {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatRelative(iso: string | undefined, t: TFunction) {
  if (!iso) return '-'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (Math.abs(diffMin) < 1) return t('tasks.soon')
  if (diffMin > 0 && diffMin < 60) return t('tasks.inMinutes', { count: diffMin })
  if (diffMin < 0 && diffMin > -60) return t('tasks.minutesAgo', { count: -diffMin })
  return formatTimeLabel(iso)
}

function describeSchedule(task: IScheduledTask, t: TFunction): string {
  if (task.scheduleType === 'Cron') return task.cronExpression || '-'
  const m = task.intervalMinutes
  if (m < 60) return t('tasks.everyMinutes', { count: m })
  if (m < 1440) return t('tasks.everyHours', { count: Math.round(m / 60) })
  return t('tasks.everyDays', { count: Math.round(m / 1440) })
}

function ScheduledTasksView() {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()
  const [showEditor, setShowEditor] = useState(false)
  const [editingTask, setEditingTask] = useState<IScheduledTask | null>(null)
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null)

  const { data: tasks = [], isLoading, isRefetching } = useQuery({
    queryKey: ['scheduled-tasks'],
    queryFn: scheduledTaskService.getAll,
    // 仅有任务正在运行时加快轮询，平时 30s 慢速刷新
    refetchInterval: (query) =>
      query.state.data?.some((t) => t.lastStatus === 'Running') ? 5000 : 30000,
  })

  const { data: targetOptions } = useQuery({
    queryKey: ['scheduled-tasks', 'target-options'],
    queryFn: scheduledTaskService.getTargetOptions,
  })

  const toggleMutation = useMutation({
    mutationFn: (id: string) => scheduledTaskService.toggle(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
  })

  const runNowMutation = useMutation({
    mutationFn: (id: string) => scheduledTaskService.runNow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduledTaskService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
  })

  const handleCreate = () => {
    setEditingTask(null)
    setShowEditor(true)
  }

  const handleEdit = (task: IScheduledTask) => {
    setEditingTask(task)
    setShowEditor(true)
  }

  return (
    <>
      {/* 工具栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="ml-auto flex items-center gap-2">
          {isRefetching && <Loader2 size={14} className="animate-spin text-gray-400" />}
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })}
            title={t('common:refresh')}
            className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[13px] font-medium text-gray-600 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RefreshCw size={13} />
            {t('common:refresh')}
          </button>
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-sky-500/20 transition-all hover:shadow-md active:scale-[0.97]"
          >
            <Plus size={15} />
            {t('tasks.newScheduled')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : tasks.length === 0 ? (
        <ScheduledEmptyState onCreate={handleCreate} />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <ScheduledTaskRow
              key={task.id}
              task={task}
              onToggle={() => toggleMutation.mutate(task.id)}
              onRun={() => runNowMutation.mutate(task.id)}
              onEdit={() => handleEdit(task)}
              onHistory={() => setHistoryTaskId(task.id)}
              onDelete={() => {
                confirm({ message: t('tasks.deleteConfirm', { name: task.name }), onConfirm: () => deleteMutation.mutate(task.id) })
              }}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <ScheduledTaskEditor
          task={editingTask}
          skills={targetOptions?.skills ?? []}
          localSkills={targetOptions?.localSkills ?? []}
          onClose={() => setShowEditor(false)}
          onSaved={() => {
            setShowEditor(false)
            queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
          }}
        />
      )}

      {historyTaskId && (
        <ScheduledTaskHistoryModal
          taskId={historyTaskId}
          taskName={tasks.find((t2) => t2.id === historyTaskId)?.name ?? t('tasks.scheduledTitle')}
          onClose={() => setHistoryTaskId(null)}
        />
      )}
    </>
  )
}

function ScheduledTaskRow({
  task, onToggle, onRun, onEdit, onHistory, onDelete,
}: {
  task: IScheduledTask
  onToggle: () => void
  onRun: () => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('projects')
  const kindInfo = TASK_KIND_LABELS[task.taskKind]
  const KindIcon = kindInfo?.icon ?? Cpu
  const kindLabel = kindInfo ? t(kindInfo.labelKey) : task.taskKind
  const statusInfo = task.lastStatus ? LAST_STATUS_MAP[task.lastStatus] : null

  return (
    <div className="group rounded-2xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
      <div className="flex items-center gap-3">
        {/* Enable indicator */}
        <button
          onClick={onToggle}
          className={`shrink-0 rounded-xl p-1.5 transition-colors ${
            task.isEnabled
              ? 'bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10'
              : 'bg-gray-100 text-gray-400 dark:bg-white/[0.06]'
          }`}
          title={task.isEnabled ? t('tasks.clickDisable') : t('tasks.clickEnable')}
        >
          <Power size={15} />
        </button>

        {/* Kind icon */}
        <div className="flex items-center gap-1.5 shrink-0">
          <KindIcon size={14} className={kindInfo?.color ?? 'text-gray-500'} />
        </div>

        {/* Name + description */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`block truncate text-sm font-medium ${task.isEnabled ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
              {task.name}
            </span>
            {!task.isEnabled && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-white/[0.06]">{t('tasks.disabledBadge')}</span>
            )}
            {task.retryCount > 0 && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                {t('tasks.retryCount', { n: task.retryCount, max: task.maxRetries })}
              </span>
            )}
            {task.topicId && (
              <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" title={t('tasks.topicBadgeTitle')}>
                <MessageSquare size={9} />
                {t('tasks.topicBadge')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Timer size={11} />
              {describeSchedule(task, t)}
            </span>
            <span>·</span>
            <span>{kindLabel}</span>
            {task.targetName && (
              <>
                <span>·</span>
                <span className="block min-w-0 truncate">{task.targetName}</span>
              </>
            )}
          </div>
        </div>

        {/* Last status */}
        {statusInfo && (
          <span className={`hidden shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex ${statusInfo.bg} ${statusInfo.color}`}>
            {t(statusInfo.labelKey)}
          </span>
        )}

        {/* Next run */}
        <div className="hidden shrink-0 text-right md:block">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">{t('tasks.nextRun')}</div>
          <div className="text-xs text-gray-600 dark:text-gray-300">{task.isEnabled ? formatRelative(task.nextRunAt, t) : '-'}</div>
        </div>

        {/* Last run */}
        <div className="hidden shrink-0 text-right lg:block">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">{t('tasks.lastRun')}</div>
          <div className="text-xs text-gray-600 dark:text-gray-300">{formatRelative(task.lastRunAt, t)}</div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button onClick={onRun} className="rounded-full p-1.5 text-sky-500 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/10" title={t('tasks.runNow')}>
            <Play size={14} />
          </button>
          <button onClick={onHistory} className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]" title={t('tasks.runHistory')}>
            <History size={14} />
          </button>
          <button onClick={onEdit} className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]" title={t('common:edit')}>
            <Pencil size={14} />
          </button>
          <button onClick={onDelete} className="rounded-full p-1.5 text-red-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/30 dark:hover:text-red-400" title={t('common:delete')}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Error */}
      {task.lastError && task.lastStatus === 'Failed' && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-500/[0.08]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-400" />
          <span className="text-xs text-red-600 dark:text-red-400">{task.lastError}</span>
        </div>
      )}
    </div>
  )
}

function ScheduledEmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation('projects')
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800 dark:text-gray-600">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/30">
        <CalendarClock size={32} />
      </div>
      <p className="text-sm font-medium">{t('tasks.emptyScheduled')}</p>
      <p className="mt-1 text-xs">{t('tasks.emptyScheduledHint')}</p>
      <button
        onClick={onCreate}
        className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-sky-500/20 transition-all hover:shadow-md active:scale-[0.97]"
      >
        <Plus size={15} />
        {t('tasks.newScheduled')}
      </button>
    </div>
  )
}

/* ─── Scheduled Task Editor Modal ─── */

const EMPTY_FORM: ICreateScheduledTaskRequest = {
  name: '',
  description: '',
  taskKind: 'Skill',
  targetId: '',
  targetName: '',
  parameters: '',
  scheduleType: 'Interval',
  intervalMinutes: 60,
  cronExpression: '',
  isEnabled: true,
  maxRetries: 0,
  topicId: undefined,
}

const CRON_PRESETS = [
  { labelKey: 'tasks.cronPresetHourly', value: '0 * * * *' },
  { labelKey: 'tasks.cronPresetDailyMidnight', value: '0 0 * * *' },
  { labelKey: 'tasks.cronPresetDaily8', value: '0 8 * * *' },
  { labelKey: 'tasks.cronPresetWeeklyMonday8', value: '0 8 * * 1' },
  { labelKey: 'tasks.cronPresetMonthly1', value: '0 0 1 * *' },
]

function ScheduledTaskEditor({
  task, skills, localSkills, onClose, onSaved,
}: {
  task: IScheduledTask | null
  skills: IScheduledTaskTargetOption[]
  localSkills: IScheduledTaskTargetOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()

  // AiTask 的系统提示与任务指令单独管理，提交时序列化到 parameters
  const [aiSystemPrompt, setAiSystemPrompt] = useState<string>(() => {
    if (task?.taskKind === 'AiTask' && task.parameters) {
      try {
        const parsed = JSON.parse(task.parameters)
        return parsed.systemPrompt ?? ''
      } catch { return '' }
    }
    return ''
  })
  const [aiPrompt, setAiPrompt] = useState<string>(() => {
    if (task?.taskKind === 'AiTask' && task.parameters) {
      try {
        const parsed = JSON.parse(task.parameters)
        return parsed.prompt ?? task.parameters
      } catch { return task.parameters }
    }
    return ''
  })

  const [form, setForm] = useState<ICreateScheduledTaskRequest>(() =>
    task
      ? {
          name: task.name,
          description: task.description ?? '',
          taskKind: task.taskKind,
          targetId: task.targetId ?? '',
          targetName: task.targetName ?? '',
          parameters: task.parameters ?? '',
          scheduleType: task.scheduleType,
          intervalMinutes: task.intervalMinutes,
          cronExpression: task.cronExpression ?? '',
          isEnabled: task.isEnabled,
          maxRetries: task.maxRetries,
          topicId: task.topicId,
        }
      : { ...EMPTY_FORM }
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isEdit = task !== null
  const needsTarget = form.taskKind === 'Skill'
  const isAiTask = form.taskKind === 'AiTask'

  // 合并技能选项（数据库 + 本地），label 标注来源
  const allSkillOptions = [
    ...skills.map((s) => ({ value: s.value, label: s.label, source: s.source })),
    ...localSkills.map((s) => ({ value: s.value, label: t('tasks.localSkill', { label: s.label }), source: s.source })),
  ]
  const hasAnySkill = allSkillOptions.length > 0

  const set = <K extends keyof ICreateScheduledTaskRequest>(key: K, value: ICreateScheduledTaskRequest[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async () => {
    setError(null)
    if (!form.name.trim()) { setError(t('tasks.nameRequired')); return }
    if (needsTarget && !form.targetId) { setError(t('tasks.targetRequired')); return }
    if (isAiTask && !aiPrompt.trim()) { setError(t('tasks.instructionRequired')); return }
    if (form.scheduleType === 'Cron' && !form.cronExpression?.trim()) { setError(t('tasks.cronRequired')); return }
    if (form.scheduleType === 'Interval' && form.intervalMinutes <= 0) { setError(t('tasks.intervalInvalid')); return }

    // 同步 targetName
    const selectedSkill = allSkillOptions.find((s) => s.value === form.targetId)
    // AiTask 的 parameters 序列化为 { systemPrompt, prompt }
    const aiParameters = isAiTask
      ? JSON.stringify({ systemPrompt: aiSystemPrompt.trim(), prompt: aiPrompt.trim() })
      : form.parameters?.trim() || undefined

    const payload: ICreateScheduledTaskRequest = {
      ...form,
      name: form.name.trim(),
      targetName: needsTarget ? selectedSkill?.label ?? form.targetName : undefined,
      description: form.description?.trim() || undefined,
      parameters: aiParameters,
      cronExpression: form.scheduleType === 'Cron' ? form.cronExpression?.trim() : undefined,
    }

    setSubmitting(true)
    try {
      if (isEdit && task) {
        await scheduledTaskService.update(task.id, payload)
      } else {
        await scheduledTaskService.create(payload)
      }
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.saveFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-gray-900">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4 dark:border-white/[0.06] dark:bg-gray-900">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
            {isEdit ? t('tasks.editorEditTitle') : t('tasks.editorCreateTitle')}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.taskName')}</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={t('tasks.taskNamePlaceholder')}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-sky-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('common:description')}</label>
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('common:optional')}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-sky-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
            />
          </div>

          {/* Task Kind */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.taskKind')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TASK_KIND_LABELS) as ScheduledTaskKind[]).map((kind) => {
                const info = TASK_KIND_LABELS[kind]
                const Icon = info.icon
                const active = form.taskKind === kind
                return (
                  <button
                    key={kind}
                    onClick={() => set('taskKind', kind)}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition-all ${
                      active
                        ? 'border-sky-400 bg-sky-50 text-sky-600 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-300'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-white/[0.08] dark:text-gray-400'
                    }`}
                  >
                    <Icon size={15} className={`mt-0.5 shrink-0 ${active ? info.color : ''}`} />
                    <div className="min-w-0">
                      <div className="font-medium">{t(info.labelKey)}</div>
                      <div className="mt-0.5 text-[10px] leading-tight opacity-70">{t(info.descKey)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Target (Skill only) */}
          {needsTarget && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.targetSkill')}</label>
              {!hasAnySkill ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                  {t('tasks.noSkills')}
                </p>
              ) : (
                <Select
                  value={form.targetId ?? ''}
                  onChange={(v) => set('targetId', v)}
                  placeholder={t('tasks.selectSkillPlaceholder')}
                  searchable
                  searchPlaceholder={t('tasks.searchSkillPlaceholder')}
                  options={allSkillOptions.map((s) => ({ value: s.value, label: s.label }))}
                />
              )}
              {localSkills.length > 0 && (
                <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                  {t('tasks.skillsLoaded', { skills: skills.length, local: localSkills.length })}
                </p>
              )}
            </div>
          )}

          {/* Parameters (Skill input) */}
          {needsTarget && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.parameters')}</label>
              <textarea
                value={form.parameters}
                onChange={(e) => set('parameters', e.target.value)}
                placeholder={t('tasks.parametersPlaceholder')}
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-sky-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
              />
            </div>
          )}

          {/* AI Task: system prompt + instruction */}
          {isAiTask && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.systemPrompt')}</label>
                <textarea
                  value={aiSystemPrompt}
                  onChange={(e) => setAiSystemPrompt(e.target.value)}
                  placeholder={t('tasks.systemPromptPlaceholder')}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-sky-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.aiInstruction')}</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder={t('tasks.aiInstructionPlaceholder')}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-sky-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
                />
                <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                  {t('tasks.aiHint')}
                </p>
              </div>
            </>
          )}

          {/* Schedule Type */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.scheduleType')}</label>
            <div className="inline-flex w-full items-center gap-1 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.04]">
              {(['Interval', 'Cron'] as ScheduleType[]).map((st) => (
                <button
                  key={st}
                  onClick={() => set('scheduleType', st)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${segmentButtonClass(form.scheduleType === st)}`}
                >
                  {st === 'Interval' ? t('tasks.interval') : t('tasks.cron')}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule config */}
          {form.scheduleType === 'Interval' ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.intervalMinutes')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={form.intervalMinutes}
                  onChange={(e) => set('intervalMinutes', Number(e.target.value))}
                  className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-sky-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
                />
                <span className="text-xs text-gray-400">{t('tasks.minutesUnit')}</span>
                <div className="ml-auto flex gap-1">
                  {[30, 60, 360, 1440].map((m) => (
                    <button
                      key={m}
                      onClick={() => set('intervalMinutes', m)}
                      className="rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400"
                    >
                      {m < 60 ? t('tasks.minutesShort', { count: m }) : m < 1440 ? t('tasks.hoursShort', { count: m / 60 }) : t('tasks.daysShort', { count: m / 1440 })}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.cronExpression')} <span className="font-normal text-gray-400">{t('tasks.cronHint')}</span></label>
              <input
                value={form.cronExpression}
                onChange={(e) => set('cronExpression', e.target.value)}
                placeholder="0 8 * * *"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-sky-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => set('cronExpression', p.value)}
                    className="rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400"
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Max retries */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('tasks.maxRetries')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={5}
                value={form.maxRetries}
                onChange={(e) => set('maxRetries', Number(e.target.value))}
                className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-sky-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
              />
              <span className="text-xs text-gray-400">{t('tasks.retryHint')}</span>
            </div>
          </div>

          {/* Bound conversation status */}
          {form.topicId && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/50 px-4 py-2.5 dark:border-sky-500/20 dark:bg-sky-500/[0.06]">
              <MessageSquare size={14} className="shrink-0 text-sky-500" />
              <span className="text-xs text-sky-600 dark:text-sky-400">
                {t('tasks.topicBound')}
              </span>
            </div>
          )}

          {/* Enabled toggle */}
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <span className="text-sm text-gray-700 dark:text-gray-300">{t('tasks.enableOnCreate')}</span>
            <button
              type="button"
              onClick={() => set('isEnabled', !form.isEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                form.isEnabled ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span className={`pointer-events-none absolute top-0.5 left-0.5 inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ${form.isEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-500/[0.08]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-400" />
              <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-gray-100 bg-white px-6 py-4 dark:border-white/[0.06] dark:bg-gray-900">
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            {t('common:cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-sky-500/20 transition-all hover:shadow-md disabled:opacity-50"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? t('common:save') : t('common:create')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Scheduled Task History Modal ─── */

function ScheduledTaskHistoryModal({
  taskId, taskName, onClose,
}: {
  taskId: string
  taskName: string
  onClose: () => void
}) {
  const { t } = useTranslation('projects')
  const { data: executions = [], isLoading } = useQuery({
    queryKey: ['scheduled-tasks', 'executions', taskId],
    queryFn: () => scheduledTaskService.getExecutions(taskId, 50),
    // 仅有运行中/排队执行记录时轮询
    refetchInterval: (query) =>
      query.state.data?.some((e) => e.status === 'Running' || e.status === 'Queued') ? 3000 : false,
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/[0.06]">
          <div className="flex items-center gap-2">
            <History size={18} className="text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">{t('tasks.runHistory')}</h2>
            <span className="text-sm text-gray-400">· {taskName}</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={22} className="animate-spin text-gray-400" />
            </div>
          ) : executions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History size={32} className="text-gray-300 dark:text-gray-600" />
              <p className="mt-3 text-sm text-gray-400">{t('tasks.historyEmpty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {executions.map((exec) => (
                <ExecutionRow key={exec.id} exec={exec} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ExecutionRow({ exec }: { exec: IScheduledTaskExecution }) {
  const { t } = useTranslation('projects')
  const statusInfo = EXEC_STATUS_MAP[exec.status] ?? EXEC_STATUS_MAP.Failed
  const StatusIcon = statusInfo.icon
  const spinning = exec.status === 'Running'

  const formatDur = (ms?: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex items-center gap-2">
        <StatusIcon size={14} className={`${statusInfo.color} ${spinning ? 'animate-spin' : ''}`} />
        <span className={`text-xs font-medium ${statusInfo.color}`}>{t(statusInfo.labelKey)}</span>
        {exec.isManual && (
          <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">{t('tasks.manual')}</span>
        )}
        {exec.retryAttempt > 0 && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">{t('tasks.retryAttempt', { count: exec.retryAttempt })}</span>
        )}
        <span className="ml-auto text-[11px] text-gray-400">{formatTimeLabel(exec.startedAt)}</span>
        <span className="text-[11px] text-gray-400">{formatDur(exec.durationMs)}</span>
      </div>
      {exec.result && (
        <p className="mt-2 rounded bg-white px-2.5 py-1.5 text-xs text-gray-600 dark:bg-white/[0.03] dark:text-gray-400">
          {exec.result}
        </p>
      )}
      {exec.errorMessage && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-red-50 px-2.5 py-1.5 dark:bg-red-500/[0.08]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-red-400" />
          <span className="text-xs text-red-600 dark:text-red-400">{exec.errorMessage}</span>
        </div>
      )}
    </div>
  )
}

/* ─── Task Row ─── */

function TaskRow({ task, onDelete }: { task: ITaskItem; onDelete: () => void }) {
  const { t } = useTranslation('projects')
  const status = STATUS_MAP[task.status] ?? STATUS_MAP[0]
  const typeInfo = TYPE_MAP[task.taskType]
  const StatusIcon = status.icon
  const TypeIcon = typeInfo?.icon ?? Cpu

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  }

  return (
    <div className="group rounded-2xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
      <div className="flex items-center gap-3">
        {/* Status Icon */}
        <div className={`rounded-xl p-1.5 ${status.bg}`}>
          <StatusIcon size={16} className={status.color} />
        </div>

        {/* Type */}
        <div className="flex shrink-0 items-center gap-1.5">
          <TypeIcon size={14} className={typeInfo?.color ?? 'text-gray-500'} />
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{typeInfo ? t(typeInfo.labelKey) : task.taskType}</span>
        </div>

        {/* Entity */}
        <div className="min-w-0 flex-1">
          {task.entityTitle ? (
            <span className="block truncate text-sm text-gray-700 dark:text-gray-300">{task.entityTitle}</span>
          ) : (
            <span className="block truncate font-mono text-xs text-gray-400 dark:text-gray-500">{task.entityId.slice(0, 8)}...</span>
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
          {formatTime(task.createdAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>

        {/* Status Badge */}
        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${status.bg} ${status.color}`}>
          {t(status.labelKey)}
        </span>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="shrink-0 rounded-full p-1 text-red-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          title={t('tasks.deleteRecord')}
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
  const { t } = useTranslation('projects')
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800 dark:text-gray-600">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.04]">
        <ListTodo size={36} className="opacity-50" />
      </div>
      <p className="text-sm font-medium">{t('tasks.emptyTitle')}</p>
      <p className="mt-1 text-xs">{t('tasks.emptyHint')}</p>
    </div>
  )
}
