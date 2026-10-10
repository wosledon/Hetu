import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  SquareKanban, Plus, X, Pencil, Trash2, RefreshCw, Zap, CheckCircle2,
  AlertTriangle, Archive, ChevronRight, User, CalendarDays, Loader2, MessageSquare,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import Select from '../components/Select'
import DatePicker from '../components/DatePicker'
import { confirm } from '../components/confirm'
import { kanbanTaskService } from '../services/kanbanTaskService'
import { projectService } from '../services/projectService'
import { promptPresetService } from '../services/promptPresetService'
import { workflowService } from '../services/workflowService'
import { workProjectService } from '../services/workService'
import { formatDate } from '../utils/locale'
import type {
  IKanbanBoard, IKanbanTask, IKanbanTaskForm, IKanbanTaskSubmit, IKanbanTaskMove,
  KanbanTaskStatus, KanbanTaskPriority,
} from '../types'

/* ─── 列与流转配置（与后端 KanbanTaskTransitions 保持一致） ─── */

interface ColumnMeta {
  status: KanbanTaskStatus
  labelKey: string
  dot: string
  countBg: string
}

const COLUMNS: ColumnMeta[] = [
  { status: 'Backlog', labelKey: 'status.backlog', dot: 'bg-gray-400', countBg: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300' },
  { status: 'Todo', labelKey: 'status.todo', dot: 'bg-sky-500', countBg: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' },
  { status: 'InProgress', labelKey: 'status.inProgress', dot: 'bg-blue-500', countBg: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' },
  { status: 'InReview', labelKey: 'status.inReview', dot: 'bg-violet-500', countBg: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400' },
  { status: 'Blocked', labelKey: 'status.blocked', dot: 'bg-red-500', countBg: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' },
  { status: 'Done', labelKey: 'status.done', dot: 'bg-emerald-500', countBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' },
  { status: 'Archived', labelKey: 'status.archived', dot: 'bg-gray-300', countBg: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400' },
]

const STATUS_KEYS: Record<KanbanTaskStatus, string> = {
  Backlog: 'status.backlog',
  Todo: 'status.todo',
  InProgress: 'status.inProgress',
  InReview: 'status.inReview',
  Blocked: 'status.blocked',
  Done: 'status.done',
  Archived: 'status.archived',
}

const TRANSITIONS: Record<KanbanTaskStatus, KanbanTaskStatus[]> = {
  Backlog: ['Todo', 'Archived'],
  Todo: ['InProgress', 'Backlog', 'Blocked'],
  InProgress: ['InReview', 'Todo', 'Blocked'],
  InReview: ['Done', 'InProgress', 'Blocked'],
  Blocked: ['Todo', 'InProgress'],
  Done: ['Archived', 'InReview'],
  Archived: [],
}

const PRIORITY_META: Record<KanbanTaskPriority, { labelKey: string; cls: string }> = {
  Low: { labelKey: 'priority.low', cls: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400' },
  Medium: { labelKey: 'priority.medium', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' },
  High: { labelKey: 'priority.high', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
  Urgent: { labelKey: 'priority.urgent', cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' },
}

/** 表单下拉触发器：与弹窗内的输入框视觉保持一致 */
const formSelectTriggerCls =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-300 dark:border-gray-600 dark:bg-gray-700'

const emptyForm: IKanbanTaskForm = {
  title: '', description: '', status: 'Backlog', priority: 'Medium',
  assignee: '', tags: '', dueDate: '', blockedReason: '',
  projectId: '', automation: '', agentId: '', workflowId: '',
  agentPrompt: '', agentPromptName: '',
}

const COLUMN_STATUSES: KanbanTaskStatus[] = COLUMNS.map((c) => c.status)

/** 取某一列的任务列表（board 下标同时含 stats，需按列键窄化） */
function columnTasks(board: IKanbanBoard, status: KanbanTaskStatus): IKanbanTask[] {
  switch (status) {
    case 'Backlog': return board.backlog
    case 'Todo': return board.todo
    case 'InProgress': return board.inProgress
    case 'InReview': return board.inReview
    case 'Blocked': return board.blocked
    case 'Done': return board.done
    case 'Archived': return board.archived
  }
}

function findTask(board: IKanbanBoard | undefined, id: string): IKanbanTask | undefined {
  if (!board) return undefined
  for (const status of COLUMN_STATUSES) {
    const found = columnTasks(board, status).find((t) => t.id === id)
    if (found) return found
  }
  return undefined
}

function isOverdue(task: IKanbanTask): boolean {
  return !!task.dueDate && task.status !== 'Done' && task.status !== 'Archived' && new Date(task.dueDate) < new Date()
}

export default function KanbanPage() {
  const { t } = useTranslation('projects')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<IKanbanTaskForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<KanbanTaskStatus | null>(null)
  const [blockingTask, setBlockingTask] = useState<{ id: string; status: KanbanTaskStatus; beforeTaskId: string | null } | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [error, setError] = useState('')

  const { data: board, isLoading, isRefetching } = useQuery({
    queryKey: ['kanban-board'],
    queryFn: kanbanTaskService.getBoard,
    // 有执行中或待自动处理的任务时轮询，状态流转实时反映到看板
    refetchInterval: (query) => {
      const b = query.state.data
      if (!b) return false
      const busy = COLUMN_STATUSES.some((s) => columnTasks(b, s).some((t) =>
        t.lastRunStatus === 'Running' || t.lastRunStatus === 'WaitingAnswer'
        || (t.hasAutomation && (t.status === 'Todo' || t.status === 'InProgress'))
      ))
      return busy ? 3000 : false
    },
  })

  // 任务可绑定的项目 / 专业智能体 / 工作流
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: projectService.getAll })
  const { data: presets = [] } = useQuery({ queryKey: ['promptPresets'], queryFn: promptPresetService.getAll })
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: workflowService.getAll })
  const professionalAgents = presets.filter(p => (p.agentType ?? 'General') === 'Professional')

  // 选中的项目若已与 Code 项目互通，自动加载其 .github 智能体，作为「项目」分组候选
  const linkedWorkProjectId = projects.find(p => p.id === form.projectId)?.workProjectId ?? ''
  const { data: copilotAssets } = useQuery({
    queryKey: ['workCopilotAssets', linkedWorkProjectId],
    queryFn: () => workProjectService.getCopilotAssets(linkedWorkProjectId),
    enabled: !!linkedWorkProjectId,
    staleTime: 5 * 60 * 1000,
  })
  const projectAgents = copilotAssets?.agents ?? []

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 4000)
    return () => clearTimeout(timer)
  }, [error])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['kanban-board'] })

  const createMutation = useMutation({
    mutationFn: kanbanTaskService.create,
    onSuccess: () => { invalidate(); closeForm() },
    onError: (e: Error) => setError(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: IKanbanTaskSubmit }) => kanbanTaskService.update(id, data),
    onSuccess: () => { invalidate(); closeForm() },
    onError: (e: Error) => setError(e.message),
  })

  const moveMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: IKanbanTaskMove }) => kanbanTaskService.move(id, data),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: kanbanTaskService.delete,
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  function openCreate(status: KanbanTaskStatus = 'Backlog') {
    setEditingId(null)
    setForm({ ...emptyForm, status })
    setShowForm(true)
  }

  function openEdit(task: IKanbanTask) {
    setEditingId(task.id)
    setForm({
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      assignee: task.assignee ?? '',
      tags: task.tags ?? '',
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      blockedReason: task.blockedReason ?? '',
      projectId: task.projectId ?? '',
      automation: task.workflowId
        ? `workflow:${task.workflowId}`
        : task.agentId
          ? `agent:${task.agentId}`
          : task.agentPrompt
            ? `project-agent:${task.agentPromptName ?? ''}`
            : '',
      agentId: task.agentId ?? '',
      workflowId: task.workflowId ?? '',
      agentPrompt: task.agentPrompt ?? '',
      agentPromptName: task.agentPromptName ?? '',
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  function handleSave() {
    if (!form.title.trim()) return
    // 自动处理：合并下拉二选一（专业智能体 / 项目智能体 / 工作流）
    const agentId = form.automation.startsWith('agent:') ? form.automation.slice('agent:'.length) : ''
    const workflowId = form.automation.startsWith('workflow:') ? form.automation.slice('workflow:'.length) : ''
    // 项目 .github 智能体：正文随任务保存，执行时作为系统提示
    const agentPrompt = form.automation.startsWith('project-agent:') ? form.agentPrompt : ''
    const agentPromptName = agentPrompt ? form.agentPromptName : ''
    // 可选字段留空时传 undefined 而非 ""，否则后端 Guid?/DateTimeOffset? 绑定失败返回 400
    const payload = {
      ...form,
      dueDate: form.dueDate || undefined,
      projectId: form.projectId || undefined,
      agentId: agentId || undefined,
      workflowId: workflowId || undefined,
      agentPrompt: agentPrompt || undefined,
      agentPromptName: agentPromptName || undefined,
    }
    if (editingId) updateMutation.mutate({ id: editingId, data: payload })
    else createMutation.mutate(payload)
  }

  /** 目标为已阻塞时先弹原因输入，其余直接流转 */
  function requestMove(task: IKanbanTask, status: KanbanTaskStatus, beforeTaskId: string | null = null) {
    if (!TRANSITIONS[task.status].includes(status)) {
      setError(t('board.invalidTransition', { from: t(STATUS_KEYS[task.status]), to: t(STATUS_KEYS[status]) }))
      return
    }
    if (status === 'Blocked') {
      setBlockingTask({ id: task.id, status, beforeTaskId })
      setBlockReason(task.blockedReason ?? '')
      return
    }
    moveMutation.mutate({ id: task.id, data: { status, beforeTaskId } })
  }

  function confirmBlock() {
    if (!blockingTask) return
    moveMutation.mutate({
      id: blockingTask.id,
      data: { status: blockingTask.status, beforeTaskId: blockingTask.beforeTaskId, blockedReason: blockReason },
    })
    setBlockingTask(null)
    setBlockReason('')
  }

  function handleDrop(status: KanbanTaskStatus, beforeTaskId: string | null) {
    setDragOverColumn(null)
    if (!dragTaskId) return
    const task = findTask(board, dragTaskId)
    setDragTaskId(null)
    if (!task) return
    if (task.status === status && beforeTaskId === null) return
    requestMove(task, status, beforeTaskId)
  }

  const stats = board?.stats
  const boardReady = !!board

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex h-full min-w-0 flex-col bg-gray-50 dark:bg-gray-950">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-gray-100 px-8 py-4 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:ring-indigo-500/20">
                <SquareKanban size={20} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('board.title')}</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('board.subtitle')}</p>
              </div>
            </div>

            {stats && (
              <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{stats.active}</b> {t('board.activeTasks')}</span>
                {stats.overdue > 0 && (
                  <span className="flex items-center gap-1 text-red-500">
                    <AlertTriangle size={12} />{t('board.overdue', { count: stats.overdue })}
                  </span>
                )}
                <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                <span>{t('board.doneArchived', { done: stats.done, archived: stats.archived })}</span>
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              {/* 预留：自动化规则（定时流转、到期提醒、自动归档）稍后实现 */}
              <button
                disabled
                title={t('board.automationTooltip')}
                className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500"
              >
                <Zap size={14} />{t('board.automation')}
              </button>
              <button
                onClick={() => invalidate()}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                title={t('common:refresh')}
              >
                <RefreshCw size={16} className={isRefetching ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => openCreate('Backlog')}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-600"
              >
                <Plus size={16} />{t('board.newTask')}
              </button>
            </div>
          </div>

          {error && (
            <div className="mx-8 mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <AlertTriangle size={14} />{error}
            </div>
          )}

          {/* Board */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden px-8 py-4">
            <div className="flex h-full min-w-min gap-4">
              {COLUMNS.map((col) => {
                const tasks = board ? columnTasks(board, col.status) : []
                const canDrop = dragTaskId != null && findTask(board, dragTaskId)?.status !== col.status
                  && TRANSITIONS[findTask(board, dragTaskId)?.status ?? 'Backlog'].includes(col.status)
                return (
                  <div
                    key={col.status}
                    onDragOver={(e) => { e.preventDefault(); if (canDrop) setDragOverColumn(col.status) }}
                    onDragLeave={() => setDragOverColumn((c) => (c === col.status ? null : c))}
                    onDrop={() => handleDrop(col.status, null)}
                    className={`flex h-full w-72 shrink-0 flex-col rounded-2xl border transition-colors ${
                      dragOverColumn === col.status
                        ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-500/40 dark:bg-indigo-500/5'
                        : 'border-gray-100 bg-gray-100/60 dark:border-gray-800 dark:bg-white/[0.02]'
                    }`}
                  >
                    {/* Column header */}
                    <div className="flex items-center gap-2 px-4 py-3">
                      <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t(col.labelKey)}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${col.countBg}`}>{tasks.length}</span>
                      {col.status === 'Archived' && <span className="text-[11px] text-gray-400">{t('board.within7Days')}</span>}
                      <button
                        onClick={() => openCreate(col.status)}
                        className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-200/60 hover:text-gray-600 dark:hover:bg-gray-700"
                        title={t('board.createInColumn', { column: t(col.labelKey) })}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                      {tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          isDragging={dragTaskId === task.id}
                          onEdit={(e) => { e.stopPropagation(); openEdit(task) }}
                          onDelete={() => confirm({
                            title: t('board.deleteTitle'),
                            message: t('board.deleteConfirm', { title: task.title }),
                            onConfirm: () => deleteMutation.mutate(task.id),
                          })}
                          onOpenDetail={() => navigate(`/kanban/${task.id}`)}
                          onDragStart={() => setDragTaskId(task.id)}
                          onDragEnd={() => { setDragTaskId(null); setDragOverColumn(null) }}
                          onMove={(status) => requestMove(task, status)}
                          onDropBefore={() => handleDrop(task.status, task.id)}
                        />
                      ))}
                      {isLoading && <div className="py-8 text-center text-xs text-gray-400">{t('common:loading')}</div>}
                      {boardReady && tasks.length === 0 && (
                        <div className="py-8 text-center text-xs text-gray-300 dark:text-gray-600">{t('board.noTasks')}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Create/Edit modal */}
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                      <SquareKanban size={16} className="text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {editingId ? t('board.editTitle') : t('board.newTask')}
                    </h3>
                  </div>
                  <button onClick={closeForm} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700">
                    <X size={18} />
                  </button>
                </div>
                <div className="space-y-4 px-5 py-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.titleField')}</label>
                    <input
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder={t('board.titlePlaceholder')}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-gray-700"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.description')}</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={6}
                      placeholder={t('board.descriptionPlaceholder')}
                      className="w-full min-h-[120px] resize-y rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-relaxed outline-none focus:border-indigo-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-gray-700"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.status')}</label>
                      <Select
                        value={form.status}
                        onChange={(value) => setForm({ ...form, status: value as KanbanTaskStatus })}
                        options={COLUMNS.map((c) => ({ value: c.status, label: t(c.labelKey) }))}
                        triggerClassName={formSelectTriggerCls}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.priority')}</label>
                      <Select
                        value={form.priority}
                        onChange={(value) => setForm({ ...form, priority: value as KanbanTaskPriority })}
                        options={(Object.keys(PRIORITY_META) as KanbanTaskPriority[]).map((p) => ({
                          value: p,
                          label: t(PRIORITY_META[p].labelKey),
                        }))}
                        triggerClassName={formSelectTriggerCls}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.assignee')}</label>
                      <input
                        value={form.assignee}
                        onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                        placeholder={t('common:optional')}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-gray-700"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.dueDate')}</label>
                      <DatePicker
                        value={form.dueDate}
                        onChange={(dueDate) => setForm({ ...form, dueDate })}
                        placeholder={t('board.dueDateUnset')}
                        triggerClassName={formSelectTriggerCls}
                      />
                    </div>
                  </div>
                  {/* 自动处理：指定项目 + 智能体/工作流后，进入待办即自动执行 */}
                  <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-700 dark:bg-gray-700/20">
                    <p className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
                      {t('board.automationHint')}
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.project')}</label>
                        <Select
                          value={form.projectId}
                          onChange={(projectId) => setForm({ ...form, projectId })}
                          placeholder={t('board.unspecified')}
                          options={projects.map((p) => ({ value: p.id, label: p.name }))}
                          triggerClassName={formSelectTriggerCls}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.automationLabel')}</label>
                        <Select
                          value={form.automation}
                          onChange={(automation) => {
                            // 项目智能体选项带正文：选中时一并写入表单，其余选项清空
                            const projectAgent = projectAgents.find(a => `project-agent:${a.name}` === automation)
                            setForm({
                              ...form,
                              automation,
                              agentPrompt: projectAgent?.content ?? '',
                              agentPromptName: projectAgent?.name ?? '',
                            })
                          }}
                          placeholder={t('board.unspecified')}
                          searchable
                          options={[
                            ...(projectAgents.length > 0
                              ? [{ value: '__project', label: t('board.groupProject'), disabled: true }]
                              : []),
                            ...projectAgents.map((a) => ({ value: `project-agent:${a.name}`, label: a.name })),
                            ...(professionalAgents.length > 0
                              ? [{ value: '__agents', label: t('board.groupAgents'), disabled: true }]
                              : []),
                            ...professionalAgents.map((a) => ({ value: `agent:${a.id}`, label: a.name })),
                            ...(workflows.length > 0
                              ? [{ value: '__workflows', label: t('board.groupWorkflows'), disabled: true }]
                              : []),
                            ...workflows.map((w) => ({ value: `workflow:${w.id}`, label: w.name })),
                          ]}
                          triggerClassName={formSelectTriggerCls}
                        />
                        {projectAgents.length > 0 && (
                          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                            {t('board.agentsLoaded', { count: projectAgents.length })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.tags')}</label>
                    <input
                      value={form.tags}
                      onChange={(e) => setForm({ ...form, tags: e.target.value })}
                      placeholder={t('board.tagsPlaceholder')}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-gray-700"
                    />
                  </div>
                  {form.status === 'Blocked' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.blockedReason')}</label>
                      <input
                        value={form.blockedReason}
                        onChange={(e) => setForm({ ...form, blockedReason: e.target.value })}
                        placeholder={t('board.blockedReasonPlaceholder')}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-red-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700"
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
                  <button onClick={closeForm} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">{t('common:cancel')}</button>
                  <button
                    onClick={handleSave}
                    disabled={!form.title.trim() || createMutation.isPending || updateMutation.isPending}
                    className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {editingId ? t('common:save') : t('common:create')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 阻塞原因 modal */}
          {blockingTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                      <AlertTriangle size={16} className="text-red-600 dark:text-red-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('board.markBlocked')}</h3>
                  </div>
                  <button onClick={() => setBlockingTask(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700">
                    <X size={18} />
                  </button>
                </div>
                <div className="px-5 py-4">
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.blockedReason')}</label>
                  <input
                    autoFocus
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && confirmBlock()}
                    placeholder={t('board.blockReasonPlaceholder')}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-red-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
                  <button onClick={() => setBlockingTask(null)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">{t('common:cancel')}</button>
                  <button onClick={confirmBlock} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-600">{t('board.confirmBlock')}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      }
    />
  )
}

/* ─── 任务卡片 ─── */

interface TaskCardProps {
  task: IKanbanTask
  isDragging: boolean
  onEdit: (e: React.MouseEvent) => void
  onDelete: () => void
  onOpenDetail: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (status: KanbanTaskStatus) => void
  onDropBefore: () => void
}

function TaskCard({ task, isDragging, onEdit, onDelete, onOpenDetail, onDragStart, onDragEnd, onMove, onDropBefore }: TaskCardProps) {
  const { t } = useTranslation('projects')
  const [dropAbove, setDropAbove] = useState(false)
  const targets = TRANSITIONS[task.status]

  return (
    <div
      draggable
      onClick={onOpenDetail}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        setDropAbove(e.clientY < rect.top + rect.height / 2)
      }}
      onDragLeave={() => setDropAbove(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDropAbove(false); onDropBefore() }}
      className={`group cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition-colors active:cursor-grabbing dark:bg-gray-800 ${
        isDragging ? 'opacity-40' : ''
      } ${dropAbove ? 'border-indigo-400' : 'border-gray-100 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'} ${task.priority === 'Urgent' ? 'ring-1 ring-red-200 dark:ring-red-500/30' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm font-medium leading-snug text-gray-800 dark:text-gray-100">{task.title}</span>
        {task.lastRunStatus === 'Running' && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
            <Loader2 size={10} className="animate-spin" />{t('board.processing')}
          </span>
        )}
        <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_META[task.priority].cls}`}>
          {t(PRIORITY_META[task.priority].labelKey)}
        </span>
      </div>

      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{task.description}</p>
      )}

      {task.status === 'Blocked' && task.blockedReason && (
        <p className="mt-1.5 flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle size={11} className="shrink-0" />{task.blockedReason}
        </p>
      )}

      {/* 自动处理来源：项目 / 智能体 / 工作流 */}
      {task.hasAutomation && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {task.projectName && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{task.projectName}</span>
          )}
          {task.agentName && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">{task.agentName}</span>
          )}
          {!task.agentName && task.agentPromptName && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
              {task.agentPromptName}
            </span>
          )}
          {task.workflowName && (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">{task.workflowName}</span>
          )}
          {task.commentCount > 0 && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
              <MessageSquare size={10} />{task.commentCount}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-gray-400 dark:text-gray-500">
        {task.assignee && <span className="flex items-center gap-1"><User size={11} />{task.assignee}</span>}
        {task.dueDate && (
          <span className={`flex items-center gap-1 ${isOverdue(task) ? 'text-red-500' : ''}`} title={formatDate(task.dueDate)}>
            {isOverdue(task) ? <AlertTriangle size={11} /> : <CalendarDays size={11} />}{formatDate(task.dueDate)}
          </span>
        )}
        {task.tags && task.tags.split(',').filter(Boolean).map((tag) => (
          <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{tag.trim()}</span>
        ))}
        {task.status === 'Done' && task.completedAt && (
          <span className="flex items-center gap-1 text-emerald-500"><CheckCircle2 size={11} />{t('board.completed')}</span>
        )}
        {task.status === 'Archived' && task.archivedAt && (
          <span className="flex items-center gap-1"><Archive size={11} />{t('board.archivedAt', { date: formatDate(task.archivedAt) })}</span>
        )}
      </div>

      {/* 操作区常驻显示：未悬停时保持弱化，避免卡片显得空荡 */}
      <div className="mt-2.5 flex items-center gap-1 border-t border-gray-50 pt-2 dark:border-gray-700/50">
        {targets.map((status) => (
          <button
            key={status}
            onClick={(e) => { e.stopPropagation(); onMove(status) }}
            title={t('board.transitionTo', { status: t(STATUS_KEYS[status]) })}
            className={`flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] text-gray-400 transition-colors hover:text-indigo-600 dark:text-gray-500 dark:hover:text-indigo-400 ${
              status === 'Blocked' ? 'hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {status === 'Blocked' ? <AlertTriangle size={11} /> : <ChevronRight size={11} />}
            {t(STATUS_KEYS[status])}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5 text-gray-300 transition-colors dark:text-gray-600">
          <button onClick={onEdit} title={t('common:edit')} className="rounded-md p-1 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200">
            <Pencil size={12} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }} title={t('common:delete')} className="rounded-md p-1 transition-colors hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
