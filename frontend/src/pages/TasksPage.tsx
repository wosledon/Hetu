import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, Clock, Loader2, AlertTriangle, Trash2, XCircle,
  ListTodo, RefreshCw, Cpu, Network, CalendarClock, Plus, Sparkles,
  Pencil, Play, History, Power, Timer, X, Bot,
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

const TASK_KIND_LABELS: Record<ScheduledTaskKind, { label: string; icon: typeof Cpu; color: string; desc: string }> = {
  Skill: { label: '执行技能', icon: Sparkles, color: 'text-amber-500', desc: '调用已配置的技能' },
  AiTask: { label: 'AI 任务', icon: Bot, color: 'text-blue-500', desc: '自定义指令让大模型执行' },
  GraphRebuild: { label: '图谱重建', icon: Network, color: 'text-violet-500', desc: '重新提取知识图谱' },
  EmbeddingRegenerate: { label: 'Embedding 重建', icon: Cpu, color: 'text-indigo-500', desc: '重新生成向量索引' },
}

const LAST_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  Running: { label: '执行中', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
  Success: { label: '成功', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  Failed: { label: '失败', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10' },
}

const EXEC_STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  Running: { label: '执行中', color: 'text-blue-500', icon: Loader2 },
  Queued: { label: '排队中', color: 'text-gray-500', icon: ListTodo },
  Success: { label: '成功', color: 'text-emerald-500', icon: CheckCircle2 },
  Failed: { label: '失败', color: 'text-red-500', icon: XCircle },
}

function formatDateTime(iso?: string) {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatRelative(iso?: string) {
  if (!iso) return '-'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (Math.abs(diffMin) < 1) return '即将'
  if (diffMin > 0 && diffMin < 60) return `${diffMin} 分钟后`
  if (diffMin < 0 && diffMin > -60) return `${-diffMin} 分钟前`
  return formatDateTime(iso)
}

function describeSchedule(task: IScheduledTask): string {
  if (task.scheduleType === 'Cron') return task.cronExpression || '-'
  const m = task.intervalMinutes
  if (m < 60) return `每 ${m} 分钟`
  if (m < 1440) return `每 ${Math.round(m / 60)} 小时`
  return `每 ${Math.round(m / 1440)} 天`
}

function ScheduledTasksView() {
  const queryClient = useQueryClient()
  const [showEditor, setShowEditor] = useState(false)
  const [editingTask, setEditingTask] = useState<IScheduledTask | null>(null)
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null)

  const { data: tasks = [], isLoading, isRefetching } = useQuery({
    queryKey: ['scheduled-tasks'],
    queryFn: scheduledTaskService.getAll,
    refetchInterval: 10000,
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
      <div className="mb-6 flex items-center justify-end gap-2">
        {isRefetching && <Loader2 size={14} className="animate-spin text-gray-400" />}
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
          title="刷新"
        >
          <RefreshCw size={16} />
        </button>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          <Plus size={14} />
          新建定时任务
        </button>
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
                if (confirm(`确定删除定时任务「${task.name}」吗？`)) deleteMutation.mutate(task.id)
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
          taskName={tasks.find((t) => t.id === historyTaskId)?.name ?? '定时任务'}
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
  const kindInfo = TASK_KIND_LABELS[task.taskKind] ?? { label: task.taskKind, icon: Cpu, color: 'text-gray-500' }
  const KindIcon = kindInfo.icon
  const statusInfo = task.lastStatus ? LAST_STATUS_MAP[task.lastStatus] : null

  return (
    <div className="group rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm transition-all hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.03]">
      <div className="flex items-center gap-3">
        {/* Enable indicator */}
        <button
          onClick={onToggle}
          className={`shrink-0 rounded-lg p-1.5 transition-colors ${
            task.isEnabled
              ? 'bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10'
              : 'bg-gray-100 text-gray-400 dark:bg-white/[0.06]'
          }`}
          title={task.isEnabled ? '点击停用' : '点击启用'}
        >
          <Power size={15} />
        </button>

        {/* Kind icon */}
        <div className="flex items-center gap-1.5 shrink-0">
          <KindIcon size={14} className={kindInfo.color} />
        </div>

        {/* Name + description */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`truncate text-sm font-medium ${task.isEnabled ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
              {task.name}
            </span>
            {!task.isEnabled && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-white/[0.06]">已停用</span>
            )}
            {task.retryCount > 0 && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                重试 {task.retryCount}/{task.maxRetries}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Timer size={11} />
              {describeSchedule(task)}
            </span>
            <span>·</span>
            <span>{kindInfo.label}</span>
            {task.targetName && (
              <>
                <span>·</span>
                <span className="truncate">{task.targetName}</span>
              </>
            )}
          </div>
        </div>

        {/* Last status */}
        {statusInfo && (
          <span className={`hidden shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex ${statusInfo.bg} ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        )}

        {/* Next run */}
        <div className="hidden shrink-0 text-right md:block">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">下次运行</div>
          <div className="text-xs text-gray-600 dark:text-gray-300">{task.isEnabled ? formatRelative(task.nextRunAt) : '-'}</div>
        </div>

        {/* Last run */}
        <div className="hidden shrink-0 text-right lg:block">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">上次运行</div>
          <div className="text-xs text-gray-600 dark:text-gray-300">{formatRelative(task.lastRunAt)}</div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button onClick={onRun} className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10" title="立即运行">
            <Play size={14} />
          </button>
          <button onClick={onHistory} className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]" title="执行历史">
            <History size={14} />
          </button>
          <button onClick={onEdit} className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]" title="编辑">
            <Pencil size={14} />
          </button>
          <button onClick={onDelete} className="rounded-md p-1.5 text-gray-300 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-red-400" title="删除">
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
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gradient-to-br from-white to-gray-50/60 py-20 dark:border-white/[0.08] dark:from-white/[0.02] dark:to-transparent">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30">
        <CalendarClock size={28} />
      </div>
      <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">暂无定时任务</p>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">创建定时任务，按计划自动执行技能、重建图谱或 Embedding</p>
      <button
        onClick={onCreate}
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500"
      >
        <Plus size={13} />
        新建定时任务
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
}

const CRON_PRESETS = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 0 点', value: '0 0 * * *' },
  { label: '每天 8 点', value: '0 8 * * *' },
  { label: '每周一 8 点', value: '0 8 * * 1' },
  { label: '每月 1 号 0 点', value: '0 0 1 * *' },
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
    ...localSkills.map((s) => ({ value: s.value, label: `${s.label} · 本地`, source: s.source })),
  ]
  const hasAnySkill = allSkillOptions.length > 0

  const set = <K extends keyof ICreateScheduledTaskRequest>(key: K, value: ICreateScheduledTaskRequest[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async () => {
    setError(null)
    if (!form.name.trim()) { setError('请输入任务名称'); return }
    if (needsTarget && !form.targetId) { setError('请选择目标技能'); return }
    if (isAiTask && !aiPrompt.trim()) { setError('请输入任务指令'); return }
    if (form.scheduleType === 'Cron' && !form.cronExpression?.trim()) { setError('请输入 Cron 表达式'); return }
    if (form.scheduleType === 'Interval' && form.intervalMinutes <= 0) { setError('间隔分钟数必须大于 0'); return }

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
      setError(e instanceof Error ? e.message : '保存失败')
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
            {isEdit ? '编辑定时任务' : '新建定时任务'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">任务名称 *</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="例如：每日知识摘要"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">描述</label>
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="可选"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
            />
          </div>

          {/* Task Kind */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">任务类型 *</label>
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
                        ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-white/[0.08] dark:text-gray-400'
                    }`}
                  >
                    <Icon size={15} className={`mt-0.5 shrink-0 ${active ? info.color : ''}`} />
                    <div className="min-w-0">
                      <div className="font-medium">{info.label}</div>
                      <div className="mt-0.5 text-[10px] leading-tight opacity-70">{info.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Target (Skill only) */}
          {needsTarget && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">目标技能 *</label>
              {!hasAnySkill ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                  暂无可用技能，请先在技能页创建并启用技能，或配置本地技能目录。
                </p>
              ) : (
                <Select
                  value={form.targetId ?? ''}
                  onChange={(v) => set('targetId', v)}
                  placeholder="请选择技能"
                  searchable
                  searchPlaceholder="搜索技能..."
                  options={allSkillOptions.map((s) => ({ value: s.value, label: s.label }))}
                />
              )}
              {localSkills.length > 0 && (
                <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                  已加载 {skills.length} 个数据库技能 + {localSkills.length} 个本地技能
                </p>
              )}
            </div>
          )}

          {/* Parameters (Skill input) */}
          {needsTarget && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">输入参数</label>
              <textarea
                value={form.parameters}
                onChange={(e) => set('parameters', e.target.value)}
                placeholder="传递给技能的输入内容（可选）"
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
              />
            </div>
          )}

          {/* AI Task: system prompt + instruction */}
          {isAiTask && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">系统提示</label>
                <textarea
                  value={aiSystemPrompt}
                  onChange={(e) => setAiSystemPrompt(e.target.value)}
                  placeholder="设定大模型的角色与行为，例如：你是知识整理助手，擅长提炼要点。"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">任务指令 *</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="描述要让大模型完成的任务，例如：总结本周新增笔记的核心要点。"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
                />
                <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                  将使用默认对话模型执行，支持自然语言描述任意任务。
                </p>
              </div>
            </>
          )}

          {/* Schedule Type */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">调度方式</label>
            <div className="inline-flex w-full items-center gap-1 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.04]">
              {(['Interval', 'Cron'] as ScheduleType[]).map((st) => (
                <button
                  key={st}
                  onClick={() => set('scheduleType', st)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    form.scheduleType === st
                      ? 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                  }`}
                >
                  {st === 'Interval' ? '固定间隔' : 'Cron 表达式'}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule config */}
          {form.scheduleType === 'Interval' ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">间隔分钟数 *</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={form.intervalMinutes}
                  onChange={(e) => set('intervalMinutes', Number(e.target.value))}
                  className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
                />
                <span className="text-xs text-gray-400">分钟</span>
                <div className="ml-auto flex gap-1">
                  {[30, 60, 360, 1440].map((m) => (
                    <button
                      key={m}
                      onClick={() => set('intervalMinutes', m)}
                      className="rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400"
                    >
                      {m < 60 ? `${m}分` : m < 1440 ? `${m / 60}时` : `${m / 1440}天`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Cron 表达式 * <span className="font-normal text-gray-400">（分 时 日 月 周）</span></label>
              <input
                value={form.cronExpression}
                onChange={(e) => set('cronExpression', e.target.value)}
                placeholder="0 8 * * *"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => set('cronExpression', p.value)}
                    className="rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Max retries */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">最大重试次数</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={5}
                value={form.maxRetries}
                onChange={(e) => set('maxRetries', Number(e.target.value))}
                className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100"
              />
              <span className="text-xs text-gray-400">失败后指数退避重试（0 = 不重试）</span>
            </div>
          </div>

          {/* Enabled toggle */}
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <span className="text-sm text-gray-700 dark:text-gray-300">创建后立即启用</span>
            <button
              type="button"
              onClick={() => set('isEnabled', !form.isEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                form.isEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
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
            className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? '保存' : '创建'}
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
  const { data: executions = [], isLoading } = useQuery({
    queryKey: ['scheduled-tasks', 'executions', taskId],
    queryFn: () => scheduledTaskService.getExecutions(taskId, 50),
    refetchInterval: 5000,
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/[0.06]">
          <div className="flex items-center gap-2">
            <History size={18} className="text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">执行历史</h2>
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
              <p className="mt-3 text-sm text-gray-400">暂无执行记录</p>
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
        <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
        {exec.isManual && (
          <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">手动</span>
        )}
        {exec.retryAttempt > 0 && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">重试 #{exec.retryAttempt}</span>
        )}
        <span className="ml-auto text-[11px] text-gray-400">{formatDateTime(exec.startedAt)}</span>
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
