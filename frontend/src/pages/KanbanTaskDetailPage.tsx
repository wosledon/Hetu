import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Bot, CalendarDays, CheckCircle2, FolderInput, Hash, Loader2,
  MessageSquare, Pencil, Play, Tag, Trash2, User, Workflow as WorkflowIcon, Zap,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ThemedMarkdown from '../components/ThemedMarkdown'
import { confirm } from '../components/confirm'
import { kanbanTaskService } from '../services/kanbanTaskService'
import type { IKanbanTask, IKanbanTaskComment, KanbanTaskPriority, KanbanTaskStatus } from '../types'

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

const AUTHOR_META: Record<IKanbanTaskComment['authorType'], { label: string; cls: string }> = {
  User: { label: '我', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' },
  Agent: { label: '智能体', cls: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300' },
  Workflow: { label: '工作流', cls: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' },
  System: { label: '系统', cls: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400' },
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

function Avatar({ name, tone }: { name: string; tone: string }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${tone}`}>
      {(name || '?').slice(0, 1)}
    </span>
  )
}

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
      <AppLayout mainContent={
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          <Loader2 size={16} className="mr-2 animate-spin" />加载中…
        </div>
      } />
    )
  }

  if (!task) {
    return (
      <AppLayout mainContent={
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
  const running = runs.some((r) => r.status === 'Running')
  const canReview = task.status === 'InReview'
  const canRework = task.hasAutomation && (task.status === 'InReview' || task.status === 'Blocked')

  const submitComment = (withRework?: boolean) => {
    if (!comment.trim()) return
    // 提交空内容不允许；工作流重跑由后端根据当前状态判定
    commentMutation.mutate(comment.trim())
    if (withRework) setComment('')
  }

  return (
    <AppLayout mainContent={
      <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-gray-50 dark:bg-gray-950">
        <div className="mx-auto w-full max-w-6xl px-6 py-6">
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

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            {/* 主区：标题、时间线、评论 */}
            <div className="min-w-0 space-y-5">
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

              {/* 时间线：执行过程与评论 */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                  <MessageSquare size={14} />执行过程与评论
                  <span className="text-[11px] font-normal text-gray-400">{comments.length}</span>
                </h2>

                {comments.length === 0 ? (
                  <p className="py-6 text-center text-xs text-gray-400">还没有评论。任务进入待办后，智能体会在这里记录处理过程。</p>
                ) : (
                  <div className="space-y-5">
                    {comments.map((c) => {
                      const meta = AUTHOR_META[c.authorType] ?? AUTHOR_META.System
                      return (
                        <div key={c.id} className="flex gap-3">
                          <Avatar
                            name={c.authorName}
                            tone={c.authorType === 'User'
                              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
                              : c.authorType === 'System'
                                ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300'}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{c.authorName}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                              <span className="text-[11px] text-gray-400">{formatDateTime(c.createdAt)}</span>
                            </div>
                            <div className="mt-1.5 text-sm">
                              <ThemedMarkdown source={c.content} />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 评论输入：可主导智能体/工作流行为 */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-3 text-[13px] font-semibold text-gray-700 dark:text-gray-300">添加评论</h2>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  placeholder={
                    canRework
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
                    提交评论
                  </button>
                  {canRework && (
                    <button
                      onClick={() => submitComment(true)}
                      disabled={!comment.trim() || commentMutation.isPending}
                      className="flex items-center gap-1.5 rounded-lg border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-500/30 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                    >
                      <Play size={14} />提交并让智能体重新处理
                    </button>
                  )}
                  <span className="text-[11px] text-gray-400">
                    {canRework ? '任务将回到「进行中」，并根据你的评论继续修改' : '审核中或已阻塞时提交评论可触发重新处理'}
                  </span>
                </div>
                {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
              </div>

              {/* 执行记录 */}
              {runs.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                    <Zap size={14} />执行记录
                  </h2>
                  <div className="space-y-2">
                    {runs.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-[12px] dark:border-gray-800">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          r.kind === 'Workflow'
                            ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300'
                            : 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300'
                        }`}>
                          {r.kind === 'Workflow' ? '工作流' : '智能体'}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          r.status === 'Succeeded'
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
                            : r.status === 'Failed'
                              ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300'
                              : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
                        }`}>
                          {r.status === 'Running' ? '执行中' : r.status === 'Succeeded' ? '成功' : '失败'}
                        </span>
                        <span className="text-gray-400">
                          {r.trigger === 'Comment' ? '评论触发' : r.trigger === 'Manual' ? '手动触发' : '进入待办触发'}
                        </span>
                        <span className="ml-auto text-gray-400">{formatDateTime(r.completedAt ?? r.startedAt ?? r.createdAt)}</span>
                        {r.error && <p className="w-full text-red-500">{r.error}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 侧栏：属性与流转 */}
            <aside className="space-y-4">
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
                    任务进入待办后由{task.workflowId ? '工作流' : '智能体'}自动处理；完成后进入审核中并写入收件箱。你在审核中提交评论，任务会回到进行中并按评论继续修改。
                  </p>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    } />
  )
}
