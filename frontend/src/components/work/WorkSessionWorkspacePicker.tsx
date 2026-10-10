import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, GitBranch, Loader2, TreePine } from 'lucide-react'
import { workGitService, workSessionService } from '../../services/workService'
import type { IWorkSession } from '../../types/work'

/**
 * Code 会话的工作区选择器：主工作区（项目目录当前分支）或独立工作树（指定/新建分支）。
 * 放在输入框右下角、上下文占用左边。切换后本会话的文件/命令/git 工具都落在新的工作区里。
 */
export default function WorkSessionWorkspacePicker({ session, onChanged }: { session: IWorkSession; onChanged?: (session: IWorkSession) => void }) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data: branchInfo, isLoading } = useQuery({
    queryKey: ['work-branches', session.projectId],
    queryFn: () => workGitService.branches(session.projectId),
    staleTime: 60_000,
  })

  const apply = useMutation({
    mutationFn: (payload: { useWorktree: boolean; branch?: string }) =>
      workSessionService.update(session.id, {
        title: session.title,
        modelId: session.modelId,
        permissionMode: session.permissionMode,
        agentMode: session.agentMode,
        useWorktree: payload.useWorktree,
        branch: payload.branch,
      }),
    onSuccess: (res) => {
      setOpen(false)
      // 会话对象由 WorkPage 持有（本地 state），必须回传，否则标签仍是旧工作区
      onChanged?.(res)
      for (const key of [['workSessions', session.projectId], ['workDirEntries', session.projectId], ['workGitStatus', session.projectId], ['workFileChanges', session.id]]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const inWorktree = !!session.worktreePath
  const label = useMemo(() => {
    if (inWorktree) return t('workspace.worktree', { branch: session.branch ?? '' })
    return t('workspace.branch', { branch: branchInfo?.current ?? '…' })
  }, [inWorktree, session.branch, branchInfo?.current, t])

  const unsupported = branchInfo?.worktreeUnsupportedReason
  const branches = branchInfo?.branches ?? []
  const busy = apply.isPending

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title={t('workspace.title')}
        className={`inline-flex max-w-[15rem] items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
          inWorktree
            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'
        }`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : inWorktree ? <TreePine size={12} /> : <GitBranch size={12} />}
        <span className="truncate">{label}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-gray-900">
            <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">{t('workspace.title')}</p>

            {/* 主工作区 */}
            <button
              onClick={() => apply.mutate({ useWorktree: false })}
              disabled={busy || !inWorktree}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/[0.06]"
            >
              <span className="w-3 shrink-0">{!inWorktree && <Check size={12} className="text-emerald-500" />}</span>
              <GitBranch size={12} className="shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate">
                {t('workspace.mainArea')}
                <span className="ml-1 text-gray-400">{branchInfo?.current ? `· ${branchInfo.current}` : ''}</span>
              </span>
            </button>

            {/* 独立工作树 */}
            <div className="mt-1 border-t border-gray-100 pt-1 dark:border-white/[0.06]">
              <p className="px-2 py-1 text-[10px] text-gray-400">
                {inWorktree ? t('workspace.worktreeCurrent', { branch: session.branch ?? '' }) : t('workspace.worktreeHint')}
              </p>

              {unsupported ? (
                <p className="px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-300">
                  {unsupported === 'remote' ? t('workspace.localOnly') : t('workspace.projectUnavailable')}
                </p>
              ) : isLoading ? (
                <p className="px-2 py-1.5 text-[11px] text-gray-400">{t('common:loading')}</p>
              ) : branches.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] text-gray-400">{t('workspace.noBranches')}</p>
              ) : (
                <div className="max-h-56 overflow-auto">
                  {branches.map((branch) => {
                    const active = inWorktree && session.branch === branch
                    return (
                      <button
                        key={branch}
                        onClick={() => apply.mutate({ useWorktree: true, branch })}
                        disabled={busy}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/[0.06]"
                      >
                        <span className="w-3 shrink-0">{active && <Check size={12} className="text-emerald-500" />}</span>
                        <TreePine size={12} className="shrink-0 text-emerald-500/70" />
                        <span className="min-w-0 flex-1 truncate">{branch}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {!unsupported && branches.length > 0 && (
                <button
                  onClick={() => apply.mutate({ useWorktree: true })}
                  disabled={busy}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-200 px-2 py-1.5 text-left text-[12px] text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/[0.04]"
                >
                  <span className="w-3 shrink-0" />
                  <TreePine size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t('workspace.newWorktreeBranch')}</span>
                </button>
              )}
            </div>

            {apply.isError && (
              <p className="mt-1 border-t border-gray-100 px-2 pt-1.5 text-[11px] text-red-600 dark:border-white/[0.06] dark:text-red-300">
                {(apply.error as Error)?.message}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
