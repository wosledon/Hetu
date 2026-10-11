import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Cloud, FolderGit2, GitBranch, Loader2 } from 'lucide-react'
import { workGitService, workSessionService } from '../../services/workService'
import type { IWorkSession } from '../../types/work'

/**
 * Code 会话的工作区选择：前一个下拉选「当前分支 / 新工作树」，后一个下拉选工作树的基分支。
 * 工作树不在切换时创建：会话首次发消息时后端按用户输入命名并创建（目录名 = 分支名）。
 * 放在输入框右下角、上下文占用左边。
 */
export default function WorkSessionWorkspacePicker({ session, onChanged }: { session: IWorkSession; onChanged?: (session: IWorkSession) => void }) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const [menu, setMenu] = useState<'mode' | 'branch' | null>(null)

  const { data: branchInfo } = useQuery({
    queryKey: ['work-branches', session.projectId],
    queryFn: () => workGitService.branches(session.projectId),
    staleTime: 60_000,
  })

  const apply = useMutation({
    mutationFn: (payload: { useWorktree?: boolean; baseBranch?: string }) =>
      workSessionService.update(session.id, {
        title: session.title,
        modelId: session.modelId,
        permissionMode: session.permissionMode,
        agentMode: session.agentMode,
        ...payload,
      }),
    onSuccess: (res) => {
      setMenu(null)
      // 会话对象由 WorkPage 持有（本地 state），必须回传，否则标签还是旧工作区
      onChanged?.(res)
      // work-branches 决定「当前分支」显示：主工作区切换分支后必须重取
      for (const key of [['work-branches', session.projectId], ['workSessions', session.projectId], ['workDirEntries', session.projectId], ['workGitStatus', session.projectId], ['workFileChanges', session.id]]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  // 非 git 仓库 / SSH 项目 / 目录不可用时不支持工作树
  const reason = branchInfo?.worktreeUnsupportedReason ?? (branchInfo && !branchInfo.isRepo ? 'not-repo' : null)
  const unsupportedHint = !reason
    ? null
    : reason === 'remote'
      ? t('workspace.localOnly')
      : reason === 'not-repo'
        ? t('workspace.notRepo')
        : t('workspace.projectUnavailable')

  const created = !!session.worktreePath
  const useWorktree = created || !!session.useWorktree
  const currentBranch = branchInfo?.current
  const baseBranch = session.baseBranch ?? currentBranch
  const busy = apply.isPending

  const triggerClass = (active: boolean, worktree = false) =>
    `inline-flex max-w-[11rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${
      active
        ? worktree
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'bg-white text-gray-700 shadow-sm dark:bg-white/10 dark:text-gray-100'
        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
    }`

  const itemClass = (active: boolean) =>
    `flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06] ${
      active ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'
    }`

  return (
    <div className="relative flex items-center gap-1">
      {menu && <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />}

      <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100/80 p-0.5 dark:bg-white/[0.06]" title={t('workspace.title')}>
        {/* 前：当前分支 / 新工作树 */}
        <div className="relative">
          <button
            onClick={() => setMenu(menu === 'mode' ? null : 'mode')}
            disabled={busy}
            title={
              created
                ? t('workspace.worktreeCreatedHint', { branch: session.branch ?? '' })
                : useWorktree
                  ? unsupportedHint ?? t('workspace.newWorktreeTitle')
                  : t('workspace.currentBranchTitle', { branch: currentBranch ?? '…' })
            }
            className={triggerClass(useWorktree, useWorktree)}
          >
            {busy ? <Loader2 size={11} className="shrink-0 animate-spin" /> : useWorktree ? <FolderGit2 size={11} className="shrink-0" /> : <GitBranch size={11} className="shrink-0" />}
            <span className="truncate">
              {created ? t('workspace.worktreeMode') : useWorktree ? t('workspace.newWorktree') : t('workspace.currentBranch')}
            </span>
            {!created && <ChevronDown size={11} className="shrink-0 opacity-70" />}
          </button>

          {menu === 'mode' && (
            <div className="absolute bottom-full left-0 z-50 mb-1.5 w-72 rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-gray-900">
              <button
                onClick={() => apply.mutate({ useWorktree: false })}
                disabled={busy || !useWorktree}
                className={itemClass(!useWorktree)}
              >
                <span className="w-3 shrink-0 pt-0.5">{!useWorktree && <Check size={12} className="text-emerald-500" />}</span>
                <GitBranch size={12} className="mt-0.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t('workspace.modeCurrentBranch')}</span>
                  <span className="block text-[11px] leading-4 text-gray-400">{t('workspace.modeCurrentBranchHint')}</span>
                </span>
              </button>
              <button
                onClick={() => apply.mutate({ useWorktree: true })}
                disabled={busy || useWorktree || (!!unsupportedHint && !created)}
                title={unsupportedHint ?? undefined}
                className={itemClass(useWorktree)}
              >
                <span className="w-3 shrink-0 pt-0.5">{useWorktree && <Check size={12} className="text-emerald-500" />}</span>
                <FolderGit2 size={12} className="mt-0.5 shrink-0 text-emerald-500/80" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t('workspace.modeNewWorktree')}</span>
                  <span className={`block text-[11px] leading-4 ${unsupportedHint ? 'text-amber-600 dark:text-amber-300' : 'text-gray-400'}`}>
                    {created ? t('workspace.worktreeCreatedHint', { branch: session.branch ?? '' }) : unsupportedHint ?? t('workspace.modeNewWorktreeHint')}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>

        {/* 后：分支（主工作区模式＝检出该分支；工作树模式＝新分支的起点） */}
        <div className="relative">
          <button
            onClick={() => setMenu(menu === 'branch' ? null : 'branch')}
            disabled={busy || created || !!unsupportedHint || ((branchInfo?.branches.length ?? 0) === 0 && (branchInfo?.remoteBranches?.length ?? 0) === 0)}
            title={
              created
                ? t('workspace.worktreeCreatedHint', { branch: session.branch ?? '' })
                : useWorktree
                  ? t('workspace.baseBranchTitle')
                  : t('workspace.branchCheckoutTitle')
            }
            className={triggerClass(false)}
          >
            <GitBranch size={11} className="shrink-0 opacity-80" />
            <span className="truncate">{created ? session.branch : useWorktree ? baseBranch ?? '—' : currentBranch ?? '—'}</span>
            {!created && <ChevronDown size={11} className="shrink-0 opacity-70" />}
          </button>

          {menu === 'branch' && (
            <div className="absolute bottom-full right-0 z-50 mb-1.5 w-60 rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-gray-900">
              <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                {useWorktree ? t('workspace.baseBranchTitle') : t('workspace.branchCheckoutTitle')}
              </p>
              <div className="max-h-56 overflow-auto">
                {(branchInfo?.branches ?? []).map((branch) => {
                  const active = useWorktree ? session.baseBranch === branch : branch === currentBranch
                  return (
                    <button
                      key={branch}
                      onClick={() => apply.mutate({ baseBranch: branch })}
                      disabled={busy || active}
                      className={itemClass(active)}
                    >
                      <span className="w-3 shrink-0">{active && <Check size={12} className="text-emerald-500" />}</span>
                      <GitBranch size={12} className="shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 truncate">
                        {branch}
                        {branch === currentBranch && <span className="ml-1 text-gray-400">{t('workspace.baseBranchCurrentTag')}</span>}
                      </span>
                    </button>
                  )
                })}

                {/* 远程分支：选中后按同名建本地跟踪分支（主工作区）或作为工作树起点 */}
                {(branchInfo?.remoteBranches ?? []).length > 0 && (
                  <p className="mt-1 border-t border-gray-100 px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:border-white/[0.06]">
                    {t('workspace.remoteBranches')}
                  </p>
                )}
                {(branchInfo?.remoteBranches ?? []).map((branch) => {
                  const active = useWorktree && session.baseBranch === branch
                  return (
                    <button
                      key={branch}
                      onClick={() => apply.mutate({ baseBranch: branch })}
                      disabled={busy || active}
                      title={t('workspace.remoteBranchHint')}
                      className={itemClass(active)}
                    >
                      <span className="w-3 shrink-0">{active && <Check size={12} className="text-emerald-500" />}</span>
                      <Cloud size={12} className="shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 truncate">{branch}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
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
