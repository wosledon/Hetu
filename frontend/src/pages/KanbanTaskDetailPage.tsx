import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Bot, CalendarDays, CheckCircle2, CircleDot, FolderInput, Hash,
  HelpCircle, Loader2, MessageSquare, Pencil, Play, Tag, Trash2, User,
  Workflow as WorkflowIcon, Zap,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ThemedMarkdown from '../components/ThemedMarkdown'
import { confirm } from '../components/confirm'
import { kanbanTaskService } from '../services/kanbanTaskService'
import { usageService } from '../services/usageService'
import AgentUsageBadge from '../components/agent/AgentUsageBadge'
import AgentTimeline from '../components/agent/AgentTimeline'
import { fromRunSteps, type AgentTimelineItem } from '../utils/agentTimeline'
import { type AgentUsage } from '../utils/agentStream'
import { formatDate, formatDateTime } from '../utils/locale'
import type { TFunction } from 'i18next'
import type {
  IKanbanTask, IKanbanTaskComment, IKanbanTaskRun, IKanbanTaskRunStep,
  KanbanTaskPriority, KanbanTaskStatus,
} from '../types'

const STATUS_META: Record<KanbanTaskStatus, { labelKey: string; cls: string }> = {
  Backlog: { labelKey: 'status.backlog', cls: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300' },
  Todo: { labelKey: 'status.todo', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300' },
  InProgress: { labelKey: 'status.inProgress', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' },
  InReview: { labelKey: 'status.inReview', cls: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300' },
  Blocked: { labelKey: 'status.blocked', cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' },
  Done: { labelKey: 'status.done', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' },
  Archived: { labelKey: 'status.archived', cls: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400' },
}

const PRIORITY_META: Record<KanbanTaskPriority, { labelKey: string; cls: string }> = {
  Low: { labelKey: 'priority.low', cls: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400' },
  Medium: { labelKey: 'priority.medium', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' },
  High: { labelKey: 'priority.high', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
  Urgent: { labelKey: 'priority.urgent', cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' },
}

const AUTHOR_META: Record<IKanbanTaskComment['authorType'], { labelKey: string; cls: string; icon: typeof Bot }> = {
  User: { labelKey: 'detail.me', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300', icon: User },
  Agent: { labelKey: 'detail.agentName', cls: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300', icon: Bot },
  Workflow: { labelKey: 'detail.workflowName', cls: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300', icon: WorkflowIcon },
  System: { labelKey: 'detail.system', cls: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400', icon: CircleDot },
}

const RUN_STATUS_META: Record<IKanbanTaskRun['status'], { labelKey: string; cls: string }> = {
  Running: { labelKey: 'detail.running', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' },
  Succeeded: { labelKey: 'tasks.statusSuccess', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' },
  Failed: { labelKey: 'tasks.statusFailed', cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' },
  WaitingAnswer: { labelKey: 'detail.waitingAnswer', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300' },
}

const TRIGGER_KEYS: Record<IKanbanTaskRun['trigger'], string> = {
  Todo: 'detail.triggerTodo',
  Comment: 'detail.triggerComment',
  Manual: 'detail.triggerManual',
}

const NEXT_STATUS: Record<KanbanTaskStatus, KanbanTaskStatus[]> = {
  Backlog: ['Todo', 'Archived'],
  Todo: ['InProgress', 'Backlog', 'Blocked'],
  InProgress: ['InReview', 'Todo', 'Blocked'],
  InReview: ['Done', 'InProgress', 'Blocked'],
  Blocked: ['Todo', 'InProgress'],
  Done: ['Archived', 'InReview'],
  Archived: [],
}

const formatDuration = (start: string | undefined, end: string, t: TFunction) => {
  if (!start) return ''
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return ''
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return t('detail.seconds', { n: seconds })
  return t('detail.minutesSeconds', { m: Math.floor(seconds / 60), s: seconds % 60 })
}

/** 时间线 rail 节点：图标 + 贯穿的连接线 */
function TimelineNode({ icon, tone }: { icon: React.ReactNode; tone: string }) {
  return (
    <div className="relative flex w-9 shrink-0 flex-col items-center">
      <span className={`z-10 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-gray-50 dark:ring-gray-950 ${tone}`}>
        {icon}
      </span>
      <span className="absolute top-7 bottom-[-14px] w-px bg-gray-200 dark:bg-gray-700" />
    </div>
  )
}

/**
 * 整理一次执行的步骤流水：ToolResult 并入对应的 ToolCall，
 * 归一为 AgentTimelineItem 后由共享的 AgentTimeline 渲染
 *（与对话页、编码会话同一套组件）。
 */
function toRunTimeline(steps: IKanbanTaskRunStep[]): AgentTimelineItem[] {
  return fromRunSteps(steps)
}


type TimelineItem =
  | { key: string; at: string; kind: 'created' }
  | { key: string; at: string; kind: 'comment'; comment: IKanbanTaskComment }
  | { key: string; at: string; kind: 'run'; run: IKanbanTaskRun; steps: IKanbanTaskRunStep[] }

// ─── 任务详情：PR / Issue 式的执行过程与评论主导 ───
export default function KanbanTaskDetailPage() {
  const { t } = useTranslation('projects')
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['kanban-task-detail', taskId],
    queryFn: () => kanbanTaskService.getDetail(taskId!),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const d = query.state.data
      if (!d) return false
      const running = d.runs.some((r) => r.status === 'Running')
      const autoPending = d.task.hasAutomation && (d.task.status === 'Todo' || d.task.status === 'InProgress')
      return running || autoPending ? 3000 : false
    },
  })

  // 看板任务的 LLM 用量：与对话页 / 编码会话共用同一徽标，数据来自统一用量表
  const { data: taskUsage = null } = useQuery({
    queryKey: ['usage-logs', 'kanban', taskId],
    queryFn: async () => {
      const logs = await usageService.getLogs(1, 50, 'kanban', taskId!)
      if (logs.length === 0) return null
      return logs.reduce<AgentUsage>(
        (acc, l) => ({
          promptTokens: acc.promptTokens + (l.inputTokens ?? 0),
          completionTokens: acc.completionTokens + (l.outputTokens ?? 0),
          cachedTokens: acc.cachedTokens + (l.cachedTokens ?? 0),
          totalTokens: acc.totalTokens + (l.tokensUsed ?? 0),
          latencyMs: acc.latencyMs + (l.latencyMs ?? 0),
        }),
        { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, latencyMs: 0 },
      )
    },
    enabled: !!taskId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['kanban-task-detail', taskId] })
    queryClient.invalidateQueries({ queryKey: ['kanban-board'] })
  }

  const commentMutation = useMutation({
    mutationFn: (content: string) =>
      kanbanTaskService.addComment(taskId!, { content, triggerAutomation: true }),
    onSuccess: () => { setComment(''); invalidate() },
    onError: (e: Error) => setError(e.message),
  })

  const moveMutation = useMutation({
    mutationFn: (status: KanbanTaskStatus) =>
      kanbanTaskService.move(taskId!, { status }),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const rerunMutation = useMutation({
    mutationFn: () => kanbanTaskService.rerun(taskId!),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => kanbanTaskService.delete(taskId!),
    onSuccess: () => navigate('/kanban'),
    onError: (e: Error) => setError(e.message),
  })

  const task: IKanbanTask | undefined = data?.task

  if (isLoading) {
    return (
      <AppLayout showSidebar={false} mainContent={
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          <Loader2 size={16} className="mr-2 animate-spin" />{t('common:loading')}
        </div>
      } />
    )
  }

  if (!task) {
    return (
      <AppLayout showSidebar={false} mainContent={
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-400">
          <p>{t('detail.notFound')}</p>
          <button onClick={() => navigate('/kanban')} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-600">
            {t('detail.backToBoard')}
          </button>
        </div>
      } />
    )
  }

  const comments = data?.comments ?? []
  const runs = data?.runs ?? []
  const steps = data?.steps ?? []
  // 看板任务的 LLM 用量：与对话页 / 编码会话共用同一徽标，数据来自统一用量表
  const running = runs.some((r) => r.status === 'Running')
  const canReview = task.status === 'InReview'
  const canRework = task.hasAutomation && (task.status === 'InReview' || task.status === 'Blocked')
  // 最近一次执行在等用户回答：评论框转为「回答并继续」
  const pendingAnswerRun = runs.find((r) => r.status === 'WaitingAnswer')

  const submitComment = () => {
    if (!comment.trim()) return
    commentMutation.mutate(comment.trim())
  }

  /** 合并创建、评论、执行记录为一条时间线（PR / Issue 式） */
  const stepsByRun = new Map<string, IKanbanTaskRunStep[]>()
  for (const step of steps) {
    const list = stepsByRun.get(step.runId)
    if (list) list.push(step)
    else stepsByRun.set(step.runId, [step])
  }

  const timeline: TimelineItem[] = [
    { key: 'created', at: task.createdAt, kind: 'created' as const },
    ...comments.map((c): TimelineItem => ({ key: `comment-${c.id}`, at: c.createdAt, kind: 'comment', comment: c })),
    ...runs.map((r): TimelineItem => ({
      key: `run-${r.id}`,
      at: r.startedAt ?? r.createdAt,
      kind: 'run',
      run: r,
      steps: stepsByRun.get(r.id) ?? [],
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return (
    <AppLayout showSidebar={false} mainContent={
      /* 注意：mainContent 位于行向 flex 容器内，根节点必须 flex-1 + min-w-0 才能撑满宽度 */
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div className="flex-1 overflow-y-auto">
          <div className="w-full px-6 py-6 lg:px-10">
            {/* 顶部导航 */}
            <div className="mb-4 flex items-center gap-2">
              <button
                onClick={() => navigate('/kanban')}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <ArrowLeft size={14} />{t('board.title')}
              </button>
              <span className="text-gray-300 dark:text-gray-600">/</span>
              <span className="truncate text-[13px] text-gray-400">{task.title}</span>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
              {/* 主区：标题、时间线、评论 */}
              <div className="min-w-0 space-y-6">
                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{task.title}</h1>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_META[task.status].cls}`}>
                      {t(STATUS_META[task.status].labelKey)}
                    </span>
                    {running && (
                      <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                        <Loader2 size={11} className="animate-spin" />{t('detail.running')}
                      </span>
                    )}
                    <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_META[task.priority].cls}`}>
                      {t(PRIORITY_META[task.priority].labelKey)}
                    </span>
                  </div>

                  {task.description && (
                    <div className="mt-3 border-b border-gray-100 pb-4 text-sm dark:border-gray-800">
                      <ThemedMarkdown source={task.description} />
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canReview && (
                      <button
                        onClick={() => moveMutation.mutate('Done')}
                        disabled={moveMutation.isPending}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
                      >
                        <CheckCircle2 size={13} />{t('detail.approve')}
                      </button>
                    )}
                    {task.status === 'Done' && (
                      <button
                        onClick={() => moveMutation.mutate('Archived')}
                        disabled={moveMutation.isPending}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <Hash size={13} />{t('detail.archive')}
                      </button>
                    )}
                    {task.hasAutomation && task.status === 'Todo' && (
                      <button
                        onClick={() => rerunMutation.mutate()}
                        disabled={rerunMutation.isPending}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <Play size={13} />{t('detail.runNow')}
                      </button>
                    )}
                    <button
                      onClick={() => navigate('/kanban')}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Pencil size={13} />{t('detail.editInBoard')}
                    </button>
                    <button
                      onClick={() => confirm({
                        title: t('detail.deleteTitle'),
                        message: t('detail.deleteConfirm', { title: task.title }),
                        onConfirm: () => deleteMutation.mutate(),
                      })}
                      className="ml-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />{t('common:delete')}
                    </button>
                  </div>
                </div>

                {/* 时间线：创建 / 执行过程 / 评论统一按时间排列（条目自身即卡片，不套外层卡片） */}
                <section>
                  <h2 className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                    <MessageSquare size={14} />{t('detail.timeline')}
                    <span className="text-[11px] font-normal text-gray-400">{comments.length + runs.length + 1}</span>
                  </h2>

                  {timeline.length <= 1 ? (
                    <p className="py-6 text-center text-xs text-gray-400">
                      {t('detail.timelineEmpty')}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {timeline.map((item) => {
                        if (item.kind === 'created' || item.kind === 'comment') {
                          // 「创建了任务」也按系统发送的消息展示
                          const c = item.kind === 'comment'
                            ? item.comment
                            : { authorType: 'System' as const, authorName: t('detail.system'), createdAt: item.at, content: t('detail.taskCreated') }
                          const meta = AUTHOR_META[c.authorType] ?? AUTHOR_META.System
                          const Icon = meta.icon
                          return (
                            <div key={item.key} className="flex items-stretch gap-3">
                              <TimelineNode
                                icon={<Icon size={13} className={c.authorType === 'User' ? 'text-blue-500' : c.authorType === 'System' ? 'text-gray-400' : 'text-violet-500'} />}
                                tone={c.authorType === 'System' ? 'bg-gray-100 dark:bg-gray-800' : 'bg-white dark:bg-gray-900'}
                              />
                              <div className="min-w-0 flex-1 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 dark:border-gray-800 dark:bg-white/[0.02]">
                                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                  <span className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{c.authorName}</span>
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>{t(meta.labelKey)}</span>
                                  <span className="text-[11px] text-gray-400">{formatDateTime(c.createdAt)}</span>
                                </div>
                                <div className="text-sm">
                                  <ThemedMarkdown source={c.content} />
                                </div>
                              </div>
                            </div>
                          )
                        }

                        const { run, steps: runSteps } = item
                        const statusMeta = RUN_STATUS_META[run.status]
                        const isQuestion = run.status === 'WaitingAnswer'
                        return (
                          <div key={item.key} className="flex items-stretch gap-3">
                            <TimelineNode
                              icon={run.status === 'Running'
                                ? <Loader2 size={13} className="animate-spin text-blue-500" />
                                : run.kind === 'Workflow'
                                  ? <WorkflowIcon size={13} className="text-indigo-500" />
                                  : <Bot size={13} className="text-violet-500" />}
                              tone={isQuestion ? 'bg-amber-100 dark:bg-amber-500/15' : 'bg-white dark:bg-gray-900'}
                            />
                            <div className={`min-w-0 flex-1 rounded-xl border p-3.5 ${
                              isQuestion
                                ? 'border-amber-200 bg-amber-50/50 dark:border-amber-500/25 dark:bg-amber-500/[0.06]'
                                : run.status === 'Failed'
                                  ? 'border-red-200 bg-red-50/40 dark:border-red-500/25 dark:bg-red-500/[0.05]'
                                  : 'border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900'
                            }`}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200">
                                  {run.kind === 'Workflow' ? t('detail.runByWorkflow') : t('detail.runByAgent')}
                                </span>
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.cls}`}>{t(statusMeta.labelKey)}</span>
                                <span className="text-[11px] text-gray-400">{t(TRIGGER_KEYS[run.trigger])}</span>
                                <AgentUsageBadge usage={taskUsage} className="ml-auto" />
                                <span className={`${taskUsage ? '' : 'ml-auto '}text-[11px] text-gray-400`}>
                                  {formatDateTime(run.startedAt ?? run.createdAt)}
                                  {run.completedAt && ` · ${t('detail.elapsed', { duration: formatDuration(run.startedAt ?? run.createdAt, run.completedAt, t) })}`}
                                </span>
                              </div>

                              {isQuestion && (
                                <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-amber-600 dark:text-amber-300">
                                  <HelpCircle size={13} />{t('detail.questionPending')}
                                </p>
                              )}
                              {run.status === 'Failed' && run.error && (
                                <p className="mt-2 whitespace-pre-wrap break-words text-[12px] text-red-500">{run.error}</p>
                              )}

                              {/* 详细工作过程：与对话页/编码会话共用 AgentTimeline */}
                              <div className="mt-3 space-y-2">
                                <AgentTimeline items={toRunTimeline(runSteps)} />
                              </div>

                              {/* 输入 / 输出原文 */}
                              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                                {run.input && (
                                  <details className="group">
                                    <summary className="cursor-pointer list-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">{t('detail.viewInput')}</summary>
                                    <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                                      {run.input}
                                    </pre>
                                  </details>
                                )}
                                {run.output && !isQuestion && (
                                  <details className="group">
                                    <summary className="cursor-pointer list-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">{t('detail.viewOutput')}</summary>
                                    <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                                      {run.output}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>

                {/* 评论输入：可主导智能体/工作流行为（输入框自身即容器，不套外层卡片） */}
                <section>
                  <h2 className="mb-3 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                    {pendingAnswerRun ? t('detail.answerQuestion') : t('detail.addComment')}
                  </h2>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                    placeholder={
                      pendingAnswerRun
                        ? t('detail.answerPlaceholder')
                        : canRework
                          ? t('detail.reworkPlaceholder')
                          : t('detail.commentPlaceholder')
                    }
                    className="w-full min-h-[96px] resize-y rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm leading-relaxed outline-none transition-all placeholder:text-gray-400 focus:border-indigo-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:focus:bg-gray-800"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => submitComment()}
                      disabled={!comment.trim() || commentMutation.isPending}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 disabled:opacity-50"
                    >
                      {commentMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                      {pendingAnswerRun ? t('detail.answerAndContinue') : t('detail.submitComment')}
                    </button>
                    {canRework && !pendingAnswerRun && (
                      <button
                        onClick={() => submitComment()}
                        disabled={!comment.trim() || commentMutation.isPending}
                        className="flex items-center gap-1.5 rounded-lg border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-500/30 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                      >
                        <Play size={14} />{t('detail.submitAndRework')}
                      </button>
                    )}
                    <span className="text-[11px] text-gray-400">
                      {pendingAnswerRun
                        ? t('detail.answerHint')
                        : canRework
                          ? t('detail.reworkHint')
                          : t('detail.commentHint')}
                    </span>
                  </div>
                  {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
                </section>
              </div>

              {/* 侧栏：属性与流转（宽屏下固定在右侧，不随时间线滚走） */}
              <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t('detail.properties')}</h3>
                  <dl className="space-y-2.5 text-[13px]">
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">{t('board.status')}</dt>
                      <dd className="flex flex-wrap gap-1">
                        {NEXT_STATUS[task.status].map((s) => (
                          <button
                            key={s}
                            onClick={() => moveMutation.mutate(s)}
                            disabled={moveMutation.isPending}
                            className="rounded-md border border-gray-200 px-2 py-0.5 text-[12px] text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                          >
                            → {t(STATUS_META[s].labelKey)}
                          </button>
                        ))}
                        {NEXT_STATUS[task.status].length === 0 && <span className="text-gray-400">{t('detail.finalState')}</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">{t('board.priority')}</dt>
                      <dd><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_META[task.priority].cls}`}>{t(PRIORITY_META[task.priority].labelKey)}</span></dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">{t('detail.propertyProject')}</dt>
                      <dd className="flex min-w-0 items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.projectId
                          ? <><FolderInput size={12} className="shrink-0 text-gray-400" /><span className="truncate">{task.projectName ?? task.projectId}</span></>
                          : <span className="text-gray-400">{t('board.unspecified')}</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">{t('detail.propertyAgent')}</dt>
                      <dd className="flex min-w-0 items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.agentId || task.agentPromptName
                          ? <><Bot size={12} className="shrink-0 text-violet-400" /><span className="truncate">{task.agentName ?? task.agentPromptName ?? task.agentId}</span></>
                          : <span className="text-gray-400">{t('board.unspecified')}</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">{t('detail.propertyWorkflow')}</dt>
                      <dd className="flex min-w-0 items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.workflowId
                          ? <><WorkflowIcon size={12} className="shrink-0 text-indigo-400" /><span className="truncate">{task.workflowName ?? task.workflowId}</span></>
                          : <span className="text-gray-400">{t('board.unspecified')}</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">{t('detail.propertyAssignee')}</dt>
                      <dd className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.assignee ? <><User size={12} className="shrink-0 text-gray-400" />{task.assignee}</> : <span className="text-gray-400">{t('board.unspecified')}</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">{t('detail.propertyDue')}</dt>
                      <dd className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.dueDate
                          ? <><CalendarDays size={12} className="shrink-0 text-gray-400" />{formatDate(task.dueDate)}</>
                          : <span className="text-gray-400">{t('board.dueDateUnset')}</span>}
                      </dd>
                    </div>
                    {task.tags && (
                      <div className="flex items-start gap-2">
                        <dt className="flex w-16 shrink-0 items-center gap-1 text-gray-400"><Tag size={11} />{t('detail.propertyTags')}</dt>
                        <dd className="flex flex-wrap gap-1">
                          {task.tags.split(',').filter(Boolean).map((t) => (
                            <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{t.trim()}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">{t('detail.propertyCreated')}</dt>
                      <dd className="text-gray-500 dark:text-gray-400">{formatDateTime(task.createdAt)}</dd>
                    </div>
                  </dl>
                </div>

                {task.hasAutomation && (
                  <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4 text-[12px] leading-relaxed text-violet-700 dark:border-violet-500/20 dark:bg-violet-950/20 dark:text-violet-300">
                    <p className="mb-1 flex items-center gap-1 font-medium"><Zap size={12} />{t('detail.automationEnabled')}</p>
                    <p className="text-violet-600/80 dark:text-violet-300/80">
                      {t('detail.automationHint', { kind: task.workflowId ? t('detail.workflowName') : t('detail.agentName') })}
                    </p>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>
      </div>
    } />
  )
}

