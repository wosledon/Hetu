import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { FolderGit2, GitBranch } from 'lucide-react'
import { workGitService } from '../../services/workService'
import type { IWorkSession } from '../../types/work'

/**
 * 会话标题旁的工作区标识（只读）：会话一旦开始，工作树/分支就固定了，
 * 切换按钮不再出现在输入框，这里展示当前工作区。
 */
export default function WorkSessionWorkspaceBadge({ session, className = '' }: { session: IWorkSession; className?: string }) {
  const { t } = useTranslation('work')
  const { data: branchInfo } = useQuery({
    queryKey: ['work-branches', session.projectId],
    queryFn: () => workGitService.branches(session.projectId),
    staleTime: 60_000,
  })

  const inWorktree = !!session.worktreePath
  if (!inWorktree && !branchInfo?.current) return null

  return (
    <span
      title={inWorktree
        ? t('workspace.worktreeCreatedHint', { branch: session.branch ?? '' })
        : t('workspace.currentBranchTitle', { branch: branchInfo?.current ?? '' })}
      className={`inline-flex max-w-[12rem] shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
        inWorktree
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
      } ${className}`}
    >
      {inWorktree ? <FolderGit2 size={11} className="shrink-0" /> : <GitBranch size={11} className="shrink-0" />}
      <span className="truncate">{inWorktree ? t('workspace.worktree', { branch: session.branch ?? '' }) : branchInfo?.current}</span>
    </span>
  )
}
