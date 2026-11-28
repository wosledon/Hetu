import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  SquareKanban, Plus, X, Pencil, Trash2, RefreshCw, Zap, CheckCircle2, AlertTriangle, Archive, ChevronLeft, ChevronRight, ChevronDown, Check, User, CalendarDays, Loader2, MessageSquare, CircleDot, Flag, Tags, Bot, FolderKanban, Server, Workflow, } from 'lucide-react'
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
  IKanbanBoard, IKanbanTask, IKanbanTaskForm, IKanbanTaskSubmit, IKanbanTaskMove, KanbanTaskStatus, KanbanTaskPriority, } from '../types'
import { Button, Card, IconButton, Input, Modal, PageContainer, PillTabs, SearchInput, Textarea, SurfaceButton } from '../components/ui'

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

/** 优先级下拉里的小旗子颜色 */
const PRIORITY_FLAG: Record<KanbanTaskPriority, string> = {
  Low: 'text-gray-400',
  Medium: 'text-sky-500',
  High: 'text-amber-500',
  Urgent: 'text-red-500',
}

/** 属性栏的下拉触发器：与输入框同宽的紧凑样式 */
const formSelectTriggerCls =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:border-indigo-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:focus:border-indigo-500/60'

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

  // 看板横向滚动：列宽保持原始宽度，放不下时用「列导航胶囊 + 左右翻页按钮」切换
  const boardRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [activeColumn, setActiveColumn] = useState<KanbanTaskStatus>('Backlog')
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 2)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
      // 当前视图最左侧可见的列 = 导航胶囊里的高亮项
      const base = el.getBoundingClientRect().left
      let current: KanbanTaskStatus = 'Backlog'
      for (const node of el.querySelectorAll<HTMLElement>('[data-column]')) {
        if (node.getBoundingClientRect().left - base <= 40) current = node.dataset.column as KanbanTaskStatus
      }
      setActiveColumn(current)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])

  /** 翻页：按可视宽度滚动约一屏 */
  const scrollBoard = (direction: 1 | -1) => {
    boardRef.current?.scrollBy({ left: direction * (boardRef.current?.clientWidth ?? 0) * 0.85, behavior: 'smooth' })
  }

  /** 跳到指定列：对齐到可视区左边缘（抵消滚动容器的 px-8 内边距） */
  const scrollToColumn = (status: KanbanTaskStatus) => {
    const el = boardRef.current
    if (!el) return
    const node = el.querySelector<HTMLElement>(`[data-column="${status}"]`)
    if (!node) return
    const left = node.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft - 32
    el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }

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
  const formColumn = COLUMNS.find((c) => c.status === form.status) ?? COLUMNS[0]
  const { data: copilotAssets } = useQuery({
    queryKey: ['workCopilotAssets', linkedWorkProjectId],
    queryFn: () => workProjectService.getCopilotAssets(linkedWorkProjectId),
    enabled: !!linkedWorkProjectId,
    staleTime: 5 * 60 * 1000,
  })
  const projectAgents = copilotAssets?.agents ?? []

  // 自动处理选择器：按类别切换 + 搜索；候选可能很多，不再塞进一条长下拉
  const [automationOpen, setAutomationOpen] = useState(false)
  const [automationTab, setAutomationTab] = useState<'project' | 'agent' | 'workflow'>('agent')
  const [automationQuery, setAutomationQuery] = useState('')
  const automationBtnRef = useRef<HTMLButtonElement>(null)
  const automationPanelRef = useRef<HTMLDivElement>(null)
  const [automationPanelStyle, setAutomationPanelStyle] = useState<React.CSSProperties>({})

  const automationGroups = [
    { key: 'project' as const, label: t('board.groupProject'), icon: FolderKanban, tint: 'text-amber-500', items: projectAgents.map((a) => ({ value: `project-agent:${a.name}`, label: a.name })) },
    { key: 'agent' as const, label: t('board.groupAgents'), icon: Bot, tint: 'text-indigo-500', items: professionalAgents.map((a) => ({ value: `agent:${a.id}`, label: a.name })) },
    { key: 'workflow' as const, label: t('board.groupWorkflows'), icon: Workflow, tint: 'text-emerald-500', items: workflows.map((w) => ({ value: `workflow:${w.id}`, label: w.name })) },
  ]
  const automationGroupsWithItems = automationGroups.filter((group) => group.items.length > 0)
  const activeAutomationGroup = automationGroupsWithItems.find((group) => group.key === automationTab) ?? automationGroupsWithItems[0] ?? null
  const automationItems = (activeAutomationGroup?.items ?? []).filter((item) =>
    item.label.toLowerCase().includes(automationQuery.trim().toLowerCase()))
  const selectedAutomation = automationGroups
    .flatMap((group) => group.items.map((item) => ({ ...item, group })))
    .find((item) => item.value === form.automation) ?? null
  const SelectedAutomationIcon = selectedAutomation?.group.icon ?? Bot

  // 面板跟随触发按钮定位；属性栏在弹窗底部，空间不足时向上展开
  useEffect(() => {
    if (!automationOpen) return
    const update = () => {
      const rect = automationBtnRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(220, window.innerWidth - 16)
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
      const openUp = window.innerHeight - rect.bottom < 260 && rect.top > 260
      setAutomationPanelStyle({
        position: 'fixed',
        left,
        width,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [automationOpen])

  useEffect(() => {
    if (!automationOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (automationBtnRef.current?.contains(target) || automationPanelRef.current?.contains(target)) return
      setAutomationOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAutomationOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [automationOpen])

  const openAutomationPicker = () => {
    const currentGroup = automationGroups.find((group) => group.items.some((item) => item.value === form.automation))
    setAutomationTab(currentGroup?.key ?? automationGroupsWithItems[0]?.key ?? 'agent')
    setAutomationQuery('')
    setAutomationOpen(true)
  }

  const chooseAutomation = (value: string) => {
    // 项目智能体选项带正文：选中时一并写入表单，其余选项清空
    const projectAgent = projectAgents.find((a) => `project-agent:${a.name}` === value)
    setForm({ ...form, automation: value, agentPrompt: projectAgent?.content ?? '', agentPromptName: projectAgent?.name ?? '' })
    setAutomationOpen(false)
  }

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
        <PageContainer variant="fill" className="flex-col">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-gray-200/80 bg-white/35 px-8 py-5 dark:border-white/[0.07] dark:bg-slate-950/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-200/70 bg-indigo-50 text-indigo-600 shadow-sm dark:border-indigo-400/15 dark:bg-indigo-500/10 dark:text-indigo-300">
                <SquareKanban size={20} />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{t('board.title')}</h1>
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
              <SurfaceButton
                disabled
                title={t('board.automationTooltip')}
                className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500"
              >
                <Zap size={14} />{t('board.automation')}
              </SurfaceButton>
              <IconButton variant="ghost" tone="gray" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800" label={t('common:refresh')} onClick={() => invalidate()}
                
                title={t('common:refresh')}>
                <RefreshCw size={16} className={isRefetching ? 'animate-spin' : ''} />
              </IconButton>
              <Button variant="primary" tone="indigo" className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500" onClick={() => openCreate('Backlog')}>
                <Plus size={16} />{t('board.newTask')}
              </Button>
            </div>
          </div>

          {error && (
            <div className="mx-8 mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <AlertTriangle size={14} />{error}
            </div>
          )}

          {/* 列导航：一屏放不下所有列时，点胶囊直接跳到对应列，高亮跟随滚动位置 */}
          <div className="flex items-center overflow-x-auto px-8 py-2">
            <PillTabs
              value={activeColumn}
              onSelect={(key) => scrollToColumn(key as typeof activeColumn)}
              className="shrink-0"
              items={COLUMNS.map((col) => ({
                key: col.status,
                title: t('board.scrollToColumn', { column: t(col.labelKey) }),
                label: (
                  <>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${col.dot}`} />
                    {t(col.labelKey)}
                    <span className="tabular-nums opacity-60">{board ? columnTasks(board, col.status).length : 0}</span>
                  </>
                ),
              }))}
            />
          </div>

          {/* Board */}
          <div className="relative flex-1 min-h-0">
            {/* 左右切换按钮：只在对应方向还有内容时出现，点一下滚动约一屏 */}
            {canScrollLeft && (
              <Button variant="ghost" tone="gray" pill className="absolute left-3 top-1/2 z-10 flex h-9 w-9 p-0 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/90 text-gray-500 shadow-lg backdrop-blur transition hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-400 dark:hover:text-gray-100" onClick={() => scrollBoard(-1)}
                title={t('board.scrollLeft')}
                aria-label={t('board.scrollLeft')}>
                <ChevronLeft size={18} />
              </Button>
            )}
            {canScrollRight && (
              <Button variant="ghost" tone="gray" pill className="absolute right-3 top-1/2 z-10 flex h-9 w-9 p-0 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/90 text-gray-500 shadow-lg backdrop-blur transition hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-400 dark:hover:text-gray-100" onClick={() => scrollBoard(1)}
                title={t('board.scrollRight')}
                aria-label={t('board.scrollRight')}>
                <ChevronRight size={18} />
              </Button>
            )}
            <div ref={boardRef} className="h-full overflow-x-auto overflow-y-hidden px-8 py-4">
              <div className="flex h-full min-w-min gap-4">
              {COLUMNS.map((col) => {
                const tasks = board ? columnTasks(board, col.status) : []
                const canDrop = dragTaskId != null && findTask(board, dragTaskId)?.status !== col.status
                  && TRANSITIONS[findTask(board, dragTaskId)?.status ?? 'Backlog'].includes(col.status)
                return (
                  <Card
                    key={col.status}
                    padded={false}
                    data-column={col.status}
                    onDragOver={(e) => { e.preventDefault(); if (canDrop) setDragOverColumn(col.status) }}
                    onDragLeave={() => setDragOverColumn((c) => (c === col.status ? null : c))}
                    onDrop={() => handleDrop(col.status, null)}
                    className={`flex h-full w-72 shrink-0 flex-col transition-colors ${
                      dragOverColumn === col.status
                        ? 'border-indigo-300 ring-2 ring-indigo-300/70 dark:border-indigo-500/40 dark:ring-indigo-500/40'
                        : ''
                    }`}
                  >
                    {/* Column header */}
                    <div className="flex items-center gap-2 px-4 py-3">
                      <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t(col.labelKey)}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${col.countBg}`}>{tasks.length}</span>
                      {col.status === 'Archived' && <span className="text-[11px] text-gray-400">{t('board.within7Days')}</span>}
                      <IconButton variant="ghost" tone="gray" className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-200/60 hover:text-gray-600 dark:hover:bg-gray-700" label={t('board.createInColumn', { column: t(col.labelKey) })} onClick={() => openCreate(col.status)}
                        
                        title={t('board.createInColumn', { column: t(col.labelKey) })}>
                        <Plus size={14} />
                      </IconButton>
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
                        <div className="mx-1 my-4 rounded-xl border border-dashed border-gray-200 px-3 py-6 text-center text-[11px] text-gray-400 dark:border-white/[0.08] dark:text-gray-500">{t('board.noTasks')}</div>
                      )}
                    </div>
                  </Card>
                )
              })}
              </div>
            </div>
          </div>

          {/* Create/Edit modal：左侧写作区 + 右侧属性栏 */}
          {showForm && (
            <Modal open onClose={() => setShowForm(false)} dismissible={false} size="2xl" label={editingId ? t('board.editTitle') : t('board.newTask')} className="flex max-h-[86vh] flex-col overflow-hidden">
              <div
                className="flex min-h-0 flex-1 flex-col"
                onKeyDown={(e) => {
                  // 任意位置 Ctrl/Cmd + Enter 直接创建，避免长描述后还要找按钮
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && form.title.trim() && !createMutation.isPending && !updateMutation.isPending) {
                    e.preventDefault()
                    handleSave()
                  }
                }}
              >
                {/* Header */}
                <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-6 py-4 dark:border-white/[0.06]">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-50 text-indigo-600 dark:border-indigo-400/20 dark:bg-indigo-500/10 dark:text-indigo-300">
                    <SquareKanban size={17} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                        {editingId ? t('board.editTitle') : t('board.newTask')}
                      </h3>
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-300">
                        <span className={`h-1.5 w-1.5 rounded-full ${formColumn.dot}`} />
                        {t(formColumn.labelKey)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{t('board.formSubtitle')}</p>
                  </div>
                  <IconButton variant="ghost" tone="gray" className="ml-auto shrink-0" label={t('common:close')} onClick={closeForm}>
                    <X size={18} />
                  </IconButton>
                </div>

                {/* Body */}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
                  {/* 写作区 */}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col px-6 py-5">
                    <Input
                      variant="bare"
                      tone="indigo"
                      autoFocus
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing && form.title.trim() && !createMutation.isPending && !updateMutation.isPending) {
                          e.preventDefault()
                          handleSave()
                        }
                      }}
                      placeholder={t('board.titlePlaceholder')}
                      className="h-auto w-full px-0 text-[20px] font-semibold leading-8 tracking-tight placeholder:font-normal placeholder:text-gray-300 dark:placeholder:text-gray-600"
                    />
                    <div className="mt-2 h-px w-full bg-gray-100 dark:bg-white/[0.06]" />
                    <Textarea
                      variant="bare"
                      tone="indigo"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={8}
                      placeholder={t('board.descriptionPlaceholder')}
                      className="mt-3 min-h-[160px] w-full flex-1 resize-none px-0 text-[13px] leading-relaxed"
                    />
                  </div>

                  {/* 属性栏 */}
                  <div className="w-full shrink-0 border-t border-gray-100 bg-gray-50/60 px-5 py-5 md:w-72 md:overflow-y-auto md:border-l md:border-t-0 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('board.properties')}</p>
                    <div className="space-y-2.5">
                      <FormField icon={<CircleDot size={12} />} label={t('board.status')}>
                        <Select
                          value={form.status}
                          onChange={(value) => setForm({ ...form, status: value as KanbanTaskStatus })}
                          options={COLUMNS.map((c) => ({
                            value: c.status,
                            label: t(c.labelKey),
                            icon: <span className={`h-2 w-2 rounded-full ${c.dot}`} />,
                          }))}
                          triggerClassName={formSelectTriggerCls}
                          dense
                        />
                      </FormField>
                      <FormField icon={<Flag size={12} />} label={t('board.priority')}>
                        <Select
                          value={form.priority}
                          onChange={(value) => setForm({ ...form, priority: value as KanbanTaskPriority })}
                          options={(Object.keys(PRIORITY_META) as KanbanTaskPriority[]).map((p) => ({
                            value: p,
                            label: t(PRIORITY_META[p].labelKey),
                            icon: <Flag size={12} className={PRIORITY_FLAG[p]} />,
                          }))}
                          triggerClassName={formSelectTriggerCls}
                          dense
                        />
                      </FormField>
                      <FormField icon={<User size={12} />} label={t('board.assignee')}>
                        <Input tone="indigo"
                          value={form.assignee}
                          onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                          placeholder={t('common:optional')}
                          className="h-8 w-full text-[12px]"
                        />
                      </FormField>
                      <FormField icon={<CalendarDays size={12} />} label={t('board.dueDate')}>
                        <DatePicker
                          value={form.dueDate}
                          onChange={(dueDate) => setForm({ ...form, dueDate })}
                          placeholder={t('board.dueDateUnset')}
                          triggerClassName={formSelectTriggerCls}
                        />
                      </FormField>
                      <FormField icon={<Tags size={12} />} label={t('board.tags')}>
                        <Input tone="indigo"
                          value={form.tags}
                          onChange={(e) => setForm({ ...form, tags: e.target.value })}
                          placeholder={t('board.tagsPlaceholder')}
                          className="h-8 w-full text-[12px]"
                        />
                      </FormField>
                      {form.status === 'Blocked' && (
                        <FormField icon={<AlertTriangle size={12} />} label={t('board.blockedReason')}>
                          <Input tone="red"
                            value={form.blockedReason}
                            onChange={(e) => setForm({ ...form, blockedReason: e.target.value })}
                            placeholder={t('board.blockedReasonPlaceholder')}
                            className="h-8 w-full text-[12px]"
                          />
                        </FormField>
                      )}
                    </div>

                    {/* 自动处理：指定项目 + 智能体/工作流后，进入待办即自动执行 */}
                    <div className="mt-5 border-t border-gray-200/70 pt-4 dark:border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                        <Zap size={12} className="text-indigo-500" />
                        {t('board.automation')}
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">{t('board.automationHint')}</p>
                      <div className="mt-2.5 space-y-2.5">
                        <FormField icon={<FolderKanban size={12} />} label={t('board.project')}>
                          <Select
                            value={form.projectId}
                            onChange={(projectId) => setForm({ ...form, projectId })}
                            placeholder={t('board.unspecified')}
                            options={[
                              { value: '', label: t('board.unspecified') },
                              ...projects.map((p) => ({
                                value: p.id,
                                label: p.name,
                                icon: p.projectType === 'Ssh'
                                  ? <Server size={12} className="text-violet-400" />
                                  : <FolderKanban size={12} className="text-gray-400" />,
                                description: p.directoryPath,
                              })),
                            ]}
                            triggerClassName={formSelectTriggerCls}
                            dense
                          />
                        </FormField>
                        <FormField icon={<Bot size={12} />} label={t('board.automationLabel')}>
                          <SurfaceButton
                            ref={automationBtnRef}
                            type="button"
                            onClick={() => { if (automationOpen) setAutomationOpen(false); else openAutomationPicker() }}
                            className={`${formSelectTriggerCls} justify-between`}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <SelectedAutomationIcon size={12} className={`shrink-0 ${selectedAutomation ? selectedAutomation.group.tint : 'text-gray-400'}`} />
                              <span className="truncate">{selectedAutomation?.label ?? t('board.unspecified')}</span>
                            </span>
                            <ChevronDown size={13} className={`shrink-0 text-gray-400 transition-transform ${automationOpen ? 'rotate-180' : ''}`} />
                          </SurfaceButton>
                          {automationOpen && createPortal(
                            <div
                              ref={automationPanelRef}
                              style={automationPanelStyle}
                              className="animate-popover z-[9999] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-black/5 glass glass-float dark:border-white/[0.08] dark:bg-[#1a1d2e] dark:shadow-black/30"
                            >
                              <div className="border-b border-gray-100 px-2 py-1.5 dark:border-white/[0.06]">
                                <SearchInput
                                  size="sm"
                                  autoFocus
                                  value={automationQuery}
                                  onChange={(e) => setAutomationQuery(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && automationItems[0]) {
                                      e.preventDefault()
                                      chooseAutomation(automationItems[0].value)
                                    }
                                  }}
                                  placeholder={t('board.automationSearch')}
                                  className="w-full"
                                />
                              </div>
                              {automationGroupsWithItems.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-2 py-1 dark:border-white/[0.06]">
                                  {automationGroupsWithItems.map((group) => {
                                    const GroupIcon = group.icon
                                    const active = group.key === activeAutomationGroup?.key
                                    return (
                                      <SurfaceButton
                                        key={group.key}
                                        type="button"
                                        onClick={() => { setAutomationTab(group.key); setAutomationQuery('') }}
                                        className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                          active
                                            ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300'
                                            : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]'
                                        }`}
                                      >
                                        <GroupIcon size={11} className={group.tint} />
                                        {group.label}
                                        <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">{group.items.length}</span>
                                      </SurfaceButton>
                                    )
                                  })}
                                </div>
                              )}
                              <div className="max-h-48 overflow-y-auto p-1">
                                <SurfaceButton
                                  type="button"
                                  onClick={() => chooseAutomation('')}
                                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left text-[12px] transition-colors ${
                                    form.automation === ''
                                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300'
                                      : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.04]'
                                  }`}
                                >
                                  <X size={12} className="shrink-0 text-gray-400" />
                                  <span className="min-w-0 flex-1 truncate">{t('board.automationNone')}</span>
                                  {form.automation === '' && <Check size={13} className="shrink-0 text-indigo-500 dark:text-indigo-400" />}
                                </SurfaceButton>
                                {activeAutomationGroup && automationItems.map((item) => {
                                  const ItemIcon = activeAutomationGroup.icon
                                  const isSelected = form.automation === item.value
                                  return (
                                    <SurfaceButton
                                      key={item.value}
                                      type="button"
                                      onClick={() => chooseAutomation(item.value)}
                                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left text-[12px] transition-colors ${
                                        isSelected
                                          ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300'
                                          : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.04]'
                                      }`}
                                    >
                                      <ItemIcon size={12} className={`shrink-0 ${activeAutomationGroup.tint}`} />
                                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                      {isSelected && <Check size={13} className="shrink-0 text-indigo-500 dark:text-indigo-400" />}
                                    </SurfaceButton>
                                  )
                                })}
                                {automationItems.length === 0 && (
                                  <p className="px-3 py-6 text-center text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
                                    {automationQuery.trim() ? t('ui:noMatch') : t('board.automationEmpty')}
                                  </p>
                                )}
                              </div>
                            </div>,
                            document.body
                          )}
                        </FormField>
                        {projectAgents.length > 0 && (
                          <p className="text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">
                            {t('board.agentsLoaded', { count: projectAgents.length })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 px-6 py-3.5 dark:border-white/[0.06]">
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('board.shortcutCreate')}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" tone="gray" onClick={closeForm}>{t('common:cancel')}</Button>
                    <Button variant="primary" tone="indigo" className="px-4" onClick={handleSave}
                      disabled={!form.title.trim() || createMutation.isPending || updateMutation.isPending}>
                      {editingId ? t('common:save') : t('common:create')}
                    </Button>
                  </div>
                </div>
              </div>
            </Modal>
          )}

          {/* 阻塞原因 modal */}
          {blockingTask && (
            <Modal open onClose={() => setBlockingTask(null)} dismissible={false} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                    <AlertTriangle size={16} className="text-red-600 dark:text-red-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('board.markBlocked')}</h3>
                </div>
                <SurfaceButton onClick={() => setBlockingTask(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700">
                  <X size={18} />
                </SurfaceButton>
              </div>
              <div className="px-5 py-4">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('board.blockedReason')}</label>
                <Input tone="red"
                  autoFocus
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmBlock()}
                  placeholder={t('board.blockReasonPlaceholder')}
                  className="w-full"
                />
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
                <Button variant="ghost" tone="gray" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700" onClick={() => setBlockingTask(null)}>{t('common:cancel')}</Button>
                <Button variant="danger" className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-600" onClick={confirmBlock}>{t('board.confirmBlock')}</Button>
              </div>
            </Modal>
          )}
        </PageContainer>
      }
    />
  )
}

/* ─── 任务卡片 ─── */

/** 属性栏的一行：左侧小标签（图标 + 文案），右侧控件 */
function FormField({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-[72px] shrink-0 items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

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
  const running = task.lastRunStatus === 'Running'

  return (
    <Card
      variant="tile"
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
      className={`group cursor-pointer transition-colors active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      } ${dropAbove ? 'border-indigo-400' : 'hover:border-gray-300 dark:hover:border-white/15'} ${task.priority === 'Urgent' ? 'ring-1 ring-red-200 dark:ring-red-500/30' : ''}`}
    >
      {/* 任务执行中：卡片外沿绕行的流光，与「处理中」徽标一起给出正反馈 */}
      {running && <span className="running-ring" aria-hidden />}
      <div className="flex items-start gap-2">
        <span className="text-sm font-medium leading-snug text-gray-800 dark:text-gray-100">{task.title}</span>
        {running && (
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
          <SurfaceButton
            key={status}
            onClick={(e) => { e.stopPropagation(); onMove(status) }}
            title={t('board.transitionTo', { status: t(STATUS_KEYS[status]) })}
            className={`flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] text-gray-400 transition-colors hover:text-indigo-600 dark:text-gray-500 dark:hover:text-indigo-400 ${
              status === 'Blocked' ? 'hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {status === 'Blocked' ? <AlertTriangle size={11} /> : <ChevronRight size={11} />}
            {t(STATUS_KEYS[status])}
          </SurfaceButton>
        ))}
        <div className="ml-auto flex items-center gap-0.5 text-gray-300 transition-colors dark:text-gray-600">
          <IconButton variant="ghost" tone="gray" className="rounded-md p-1 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200" label={t('common:edit')} onClick={onEdit} title={t('common:edit')}>
            <Pencil size={12} />
          </IconButton>
          <IconButton variant="ghost" tone="gray" className="rounded-md p-1 transition-colors hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700" label={t('common:delete')} onClick={(e) => { e.stopPropagation(); onDelete() }} title={t('common:delete')}>
            <Trash2 size={12} />
          </IconButton>
        </div>
      </div>
    </Card>
  )
}
