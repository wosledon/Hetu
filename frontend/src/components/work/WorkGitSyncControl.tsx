import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Loader2, RefreshCw } from 'lucide-react'
import { workGitService } from '../../services/workService'
import type { IWorkSession } from '../../types/work'

/**
 * Git 同步控件（分支选择器右侧）：只展示与上游的领先/落后提交数 + 一个同步按钮。
 * 按钮按当前状态自动决定动作：有待推送 → 推送（无上游则发布分支）；有待拉取 → 拉取；都没有 → 刷新状态。
 * 结果通过按钮提示（tooltip）反馈，不弹面板。作用范围同会话工作区（带工作树的会话作用于工作树）。
 */
export default function WorkGitSyncControl({ session }: { session: IWorkSession }) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<string | null>(null)

  const { data: status, refetch, isFetching } = useQuery({
    queryKey: ['workGitStatus', session.projectId, session.id],
    queryFn: () => workGitService.status(session.projectId, session.id),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const invalidate = () => {
    for (const key of [['workGitStatus', session.projectId], ['work-branches', session.projectId], ['workDirEntries', session.projectId], ['workFileChanges', session.id]]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const pull = useMutation({
    mutationFn: () => workGitService.pull(session.projectId, session.id),
    onSuccess: () => { setFeedback(t('gitSync.donePull')); invalidate() },
    onError: (e: Error) => setFeedback(e.message),
  })
  const push = useMutation({
    mutationFn: () => workGitService.push(session.projectId, session.id),
    onSuccess: () => { setFeedback(t('gitSync.donePush')); invalidate() },
    onError: (e: Error) => setFeedback(e.message),
  })

  const isRepo = !!status?.isRepo
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const dirty = status?.files.length ?? 0
  const hasUpstream = !!status?.upstream

  const action = ahead > 0 ? 'push' : behind > 0 ? 'pull' : 'refresh'
  const busy = pull.isPending || push.isPending || isFetching
  const failed = (pull.isError || push.isError) && !!feedback

  const actionHint = (() => {
    if (!hasUpstream && ahead > 0) return t('gitSync.doPublish')
    if (action === 'push') return t('gitSync.doPush', { count: ahead })
    if (action === 'pull') return t('gitSync.doPull', { count: behind })
    return t('gitSync.doRefresh')
  })()
  const statusHint = `${t('gitSync.ahead', { count: ahead })} · ${t('gitSync.behind', { count: behind })}${dirty > 0 ? ` · ${t('gitSync.uncommitted', { count: dirty })}` : ''}`

  const run = () => {
    setFeedback(null)
    if (action === 'push') push.mutate()
    else if (action === 'pull') pull.mutate()
    else void refetch().then(() => setFeedback(t('gitSync.doneRefresh')))
  }

  return (
    <div className="flex items-center gap-1">
      <span
        title={statusHint}
        className={`flex items-center gap-1 text-[11px] font-medium ${
          isRepo && (ahead > 0 || behind > 0) ? 'text-amber-600 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        <ArrowUp size={10} />
        {ahead}
        <ArrowDown size={10} className="ml-0.5" />
        {behind}
        {dirty > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
      </span>
      <button
        onClick={run}
        disabled={busy || !isRepo}
        title={feedback ?? actionHint}
        aria-label={actionHint}
        className={`rounded-lg p-1.5 transition-colors disabled:opacity-50 ${
          failed
            ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'
        }`}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      </button>
    </div>
  )
}
