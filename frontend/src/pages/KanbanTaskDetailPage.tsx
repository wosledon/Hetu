import { useState } from 'react'
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
import type {
  IKanbanTask, IKanbanTaskComment, IKanbanTaskRun, IKanbanTaskRunStep,
  KanbanTaskPriority, KanbanTaskStatus,
} from '../types'

const STATUS_META: Record<KanbanTaskStatus, { label: string; cls: string }> = {
  Backlog: { label: '待规划', cls: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300' },
  Todo: { label: '待办', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300' },
  InProgress: { label: '进行中', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' },
  InReview: { label: '审核中', cls: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300' },
  Blocked: { label: '已阻塞', cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' },
  Done: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' },
  Archived: { label: '已归档', cls: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400' },
}

const PRIORITY_META: Record<KanbanTaskPriority, { label: string; cls: string }> = {
  Low: { label: '低', cls: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400' },
  Medium: { label: '中', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' },
  High: { label: '高', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
  Urgent: { label: '紧急', cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' },
}

const AUTHOR_META: Record<IKanbanTaskComment['authorType'], { label: string; cls: string; icon: typeof Bot }> = {
  User: { label: '我', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300', icon: User },
  Agent: { label: '智能体', cls: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300', icon: Bot },
  Workflow: { label: '工作流', cls: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300', icon: WorkflowIcon },
  System: { label: '系统', cls: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400', icon: CircleDot },
}

const RUN_STATUS_META: Record<IKanbanTaskRun['status'], { label: string; cls: string }> = {
  Running: { label: '执行中', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' },
  Succeeded: { label: '成功', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' },
  Failed: { label: '失败', cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' },
  WaitingAnswer: { label: '等待回答', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300' },
}

const TRIGGER_LABEL: Record<IKanbanTaskRun['trigger'], string> = {
  Todo: '进入待办触发',
  Comment: '评论触发',
  Manual: '手动触发',
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

const formatDateTime = (value?: string) => {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const formatDuration = (start?: string, end?: string) => {
  if (!start) return ''
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()
  if (ms < 0) return ''
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
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
      const running = query.state.data?.runs.some((r) => r.status === 'Running')
      return running ? 3000 : false
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
          <Loader2 size={16} className="mr-2 animate-spin" />加载中…
        </div>
      } />
    )
  }

  if (!task) {
    return (
      <AppLayout showSidebar={false} mainContent={
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-400">
          <p>任务不存在或已删除</p>
          <button onClick={() => navigate('/kanban')} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-600">
            返回看板
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
                <ArrowLeft size={14} />任务看板
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
                      {STATUS_META[task.status].label}
                    </span>
                    {running && (
                      <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                        <Loader2 size={11} className="animate-spin" />执行中
                      </span>
                    )}
                    <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_META[task.priority].cls}`}>
                      {PRIORITY_META[task.priority].label}
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
                        <CheckCircle2 size={13} />通过审核
                      </button>
                    )}
                    {task.status === 'Done' && (
                      <button
                        onClick={() => moveMutation.mutate('Archived')}
                        disabled={moveMutation.isPending}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <Hash size={13} />归档
                      </button>
                    )}
                    {task.hasAutomation && task.status === 'Todo' && (
                      <button
                        onClick={() => rerunMutation.mutate()}
                        disabled={rerunMutation.isPending}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <Play size={13} />立即执行
                      </button>
                    )}
                    <button
                      onClick={() => navigate('/kanban')}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Pencil size={13} />在看板中编辑
                    </button>
                    <button
                      onClick={() => confirm({
                        title: '删除任务',
                        message: `确定删除「${task.title}」吗？`,
                        onConfirm: () => deleteMutation.mutate(),
                      })}
                      className="ml-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />删除
                    </button>
                  </div>
                </div>

                {/* 时间线：创建 / 执行过程 / 评论统一按时间排列（条目自身即卡片，不套外层卡片） */}
                <section>
                  <h2 className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                    <MessageSquare size={14} />执行过程与评论
                    <span className="text-[11px] font-normal text-gray-400">{comments.length + runs.length + 1}</span>
                  </h2>

                  {timeline.length <= 1 ? (
                    <p className="py-6 text-center text-xs text-gray-400">
                      还没有执行记录。任务进入待办后，智能体会在这里记录完整的处理过程。
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {timeline.map((item) => {
                        if (item.kind === 'created' || item.kind === 'comment') {
                          // 「创建了任务」也按系统发送的消息展示
                          const c = item.kind === 'comment'
                            ? item.comment
                            : { authorType: 'System' as const, authorName: '系统', createdAt: item.at, content: '创建了任务' }
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
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
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
                                  {run.kind === 'Workflow' ? '工作流执行' : '智能体执行'}
                                </span>
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.cls}`}>{statusMeta.label}</span>
                                <span className="text-[11px] text-gray-400">{TRIGGER_LABEL[run.trigger]}</span>
                                <AgentUsageBadge usage={taskUsage} className="ml-auto" />
                                <span className={`${taskUsage ? '' : 'ml-auto '}text-[11px] text-gray-400`}>
                                  {formatDateTime(run.startedAt ?? run.createdAt)}
                                  {run.completedAt && ` · 耗时 ${formatDuration(run.startedAt ?? run.createdAt, run.completedAt)}`}
                                </span>
                              </div>

                              {isQuestion && (
                                <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-amber-600 dark:text-amber-300">
                                  <HelpCircle size={13} />智能体提出了问题，等待你在下方回答后继续
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
                                    <summary className="cursor-pointer list-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">查看提交给执行器的输入</summary>
                                    <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                                      {run.input}
                                    </pre>
                                  </details>
                                )}
                                {run.output && !isQuestion && (
                                  <details className="group">
                                    <summary className="cursor-pointer list-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">查看执行输出原文</summary>
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
                    {pendingAnswerRun ? '回答智能体的问题' : '添加评论'}
                  </h2>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                    placeholder={
                      pendingAnswerRun
                        ? '回答上面的问题，任务会回到进行中并继续处理…'
                        : canRework
                          ? '说明哪里需要调整，智能体会根据评论重新处理…'
                          : '补充信息、提出疑问或给出验收意见…'
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
                      {pendingAnswerRun ? '回答并继续处理' : '提交评论'}
                    </button>
                    {canRework && !pendingAnswerRun && (
                      <button
                        onClick={() => submitComment()}
                        disabled={!comment.trim() || commentMutation.isPending}
                        className="flex items-center gap-1.5 rounded-lg border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-500/30 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                      >
                        <Play size={14} />提交并让智能体重新处理
                      </button>
                    )}
                    <span className="text-[11px] text-gray-400">
                      {pendingAnswerRun
                        ? '提交后任务回到「进行中」，智能体结合你的回答继续执行'
                        : canRework
                          ? '任务将回到「进行中」，并根据你的评论继续修改'
                          : '审核中或已阻塞时提交评论可触发重新处理'}
                    </span>
                  </div>
                  {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
                </section>
              </div>

              {/* 侧栏：属性与流转（宽屏下固定在右侧，不随时间线滚走） */}
              <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">属性</h3>
                  <dl className="space-y-2.5 text-[13px]">
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">状态</dt>
                      <dd className="flex flex-wrap gap-1">
                        {NEXT_STATUS[task.status].map((s) => (
                          <button
                            key={s}
                            onClick={() => moveMutation.mutate(s)}
                            disabled={moveMutation.isPending}
                            className="rounded-md border border-gray-200 px-2 py-0.5 text-[12px] text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                          >
                            → {STATUS_META[s].label}
                          </button>
                        ))}
                        {NEXT_STATUS[task.status].length === 0 && <span className="text-gray-400">终态</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">优先级</dt>
                      <dd><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_META[task.priority].cls}`}>{PRIORITY_META[task.priority].label}</span></dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">项目</dt>
                      <dd className="flex min-w-0 items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.projectId
                          ? <><FolderInput size={12} className="shrink-0 text-gray-400" /><span className="truncate">{task.projectName ?? task.projectId}</span></>
                          : <span className="text-gray-400">未指定</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">智能体</dt>
                      <dd className="flex min-w-0 items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.agentId
                          ? <><Bot size={12} className="shrink-0 text-violet-400" /><span className="truncate">{task.agentName ?? task.agentId}</span></>
                          : <span className="text-gray-400">未指定</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">工作流</dt>
                      <dd className="flex min-w-0 items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.workflowId
                          ? <><WorkflowIcon size={12} className="shrink-0 text-indigo-400" /><span className="truncate">{task.workflowName ?? task.workflowId}</span></>
                          : <span className="text-gray-400">未指定</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">负责人</dt>
                      <dd className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.assignee ? <><User size={12} className="shrink-0 text-gray-400" />{task.assignee}</> : <span className="text-gray-400">未指定</span>}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">截止</dt>
                      <dd className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                        {task.dueDate
                          ? <><CalendarDays size={12} className="shrink-0 text-gray-400" />{formatDateTime(task.dueDate).slice(0, 10)}</>
                          : <span className="text-gray-400">未设置</span>}
                      </dd>
                    </div>
                    {task.tags && (
                      <div className="flex items-start gap-2">
                        <dt className="flex w-16 shrink-0 items-center gap-1 text-gray-400"><Tag size={11} />标签</dt>
                        <dd className="flex flex-wrap gap-1">
                          {task.tags.split(',').filter(Boolean).map((t) => (
                            <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{t.trim()}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <dt className="w-16 shrink-0 text-gray-400">创建</dt>
                      <dd className="text-gray-500 dark:text-gray-400">{formatDateTime(task.createdAt)}</dd>
                    </div>
                  </dl>
                </div>

                {task.hasAutomation && (
                  <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4 text-[12px] leading-relaxed text-violet-700 dark:border-violet-500/20 dark:bg-violet-950/20 dark:text-violet-300">
                    <p className="mb-1 flex items-center gap-1 font-medium"><Zap size={12} />自动处理已启用</p>
                    <p className="text-violet-600/80 dark:text-violet-300/80">
                      任务进入待办后由{task.workflowId ? '工作流' : '智能体'}自动处理，工具调用自动批准；只有智能体提问时会阻塞并等待你的回答。完成后进入审核中并写入收件箱，你在审核中提交评论可让其按评论继续修改。
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

