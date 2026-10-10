import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Loader2, TreePine } from 'lucide-react'
import { workGitService, workSessionService } from '../../services/workService'
import type { IWorkSession } from '../../types/work'

/**
 * Code 会话的工作区二选一：当前分支（项目目录）或独立工作树。
 * 分支不由用户挑：工作树里的分支交给 Agent 自己处理。放在输入框右下角、上下文占用左边。
 */
export default function WorkSessionWorkspacePicker({ session, onChanged }: { session: IWorkSession; onChanged?: (session: IWorkSession) => void }) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()

  const { data: branchInfo } = useQuery({
    queryKey: ['work-branches', session.projectId],
    queryFn: () => workGitService.branches(session.projectId),
    staleTime: 60_000,
  })

  const apply = useMutation({
    mutationFn: (useWorktree: boolean) =>
      workSessionService.update(session.id, {
        title: session.title,
        modelId: session.modelId,
        permissionMode: session.permissionMode,
        agentMode: session.agentMode,
        useWorktree,
      }),
    onSuccess: (res) => {
      // 会话对象由 WorkPage 持有（本地 state），必须回传，否则标签仍是旧工作区
      onChanged?.(res)
      for (const key of [['workSessions', session.projectId], ['workDirEntries', session.projectId], ['workGitStatus', session.projectId], ['workFileChanges', session.id]]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const inWorktree = !!session.worktreePath
  const busy = apply.isPending
  const target = apply.isPending ? apply.variables : undefined
  const reason = branchInfo?.worktreeUnsupportedReason ?? (branchInfo && !branchInfo.isRepo ? 'not-repo' : null)
  const unsupportedHint = !reason
    ? null
    : reason === 'remote'
      ? t('workspace.localOnly')
      : reason === 'not-repo'
        ? t('workspace.notRepo')
        : t('workspace.projectUnavailable')
  const currentBranch = branchInfo?.current

  const segmentClass = (active: boolean, worktree: boolean) =>
    `inline-flex max-w-[10rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${
      active
        ? worktree
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'bg-white text-gray-700 shadow-sm dark:bg-white/10 dark:text-gray-100'
        : 'text-gray-500 hover:text-gray-700 disabled:hover:text-gray-500 dark:text-gray-400 dark:hover:text-gray-200'
    }`

  return (
    <div className="relative flex items-center gap-1">
      <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100/80 p-0.5 dark:bg-white/[0.06]" title={t('workspace.title')}>
        <button
          onClick={() => apply.mutate(false)}
          disabled={busy || !inWorktree}
          title={t('workspace.currentBranchTitle', { branch: currentBranch ?? '…' })}
          className={segmentClass(!inWorktree, false)}
        >
          {target === false ? <Loader2 size={11} className="shrink-0 animate-spin" /> : <GitBranch size={11} className="shrink-0" />}
          <span className="truncate">{!inWorktree && currentBranch ? `${t('workspace.currentBranch')} · ${currentBranch}` : t('workspace.currentBranch')}</span>
        </button>
        <button
          onClick={() => apply.mutate(true)}
          disabled={busy || (!!unsupportedHint && !inWorktree)}
          title={unsupportedHint ?? t('workspace.newWorktreeTitle')}
          className={segmentClass(inWorktree, true)}
        >
          {target === true ? <Loader2 size={11} className="shrink-0 animate-spin" /> : <TreePine size={11} className="shrink-0" />}
          <span className="truncate">{inWorktree && session.branch ? t('workspace.worktree', { branch: session.branch }) : t('workspace.newWorktree')}</span>
        </button>
      </div>

      {apply.isError && (
        <button
          onClick={() => apply.reset()}
          title={t('workspace.dismissError')}
          className="absolute bottom-full right-0 z-50 mb-1.5 max-w-[20rem] rounded-lg border border-red-200 bg-white px-2 py-1 text-left text-[11px] text-red-600 shadow-lg dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300"
        >
          {(apply.error as Error)?.message}
        </button>
      )}
    </div>
  )
}
