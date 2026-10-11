import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { GitPullRequest, GitMerge } from 'lucide-react'
import { workGitService } from '../../services/workService'
import type { IWorkSession } from '../../types/work'

/** PR 状态色：草稿/合并/关闭/进行中 */
function chipClass(state: string, isDraft: boolean): string {
  if (isDraft) return 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
  switch (state.toUpperCase()) {
    case 'MERGED': return 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
    case 'CLOSED': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
    default: return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
  }
}

/**
 * 会话标题旁的 PR 标识：当前分支已有 PR / MR 时展示编号与状态（点击打开托管页面），没有则不渲染。
 * 与工作面板的 PR 页签共用同一份查询缓存。
 */
export default function WorkSessionPrBadge({ session, className = '' }: { session: IWorkSession; className?: string }) {
  const { t } = useTranslation('work')
  const { data: status } = useQuery({
    queryKey: ['workPr', session.projectId, session.id],
    queryFn: () => workGitService.prStatus(session.projectId, session.id),
    enabled: !!session.id,
    staleTime: 60_000,
    retry: false,
  })

  const pr = status?.pr
  if (!pr) return null

  return (
    <button
      onClick={() => pr.url && window.open(pr.url, '_blank', 'noopener')}
      title={t('pr.badgeTitle', { number: pr.number, title: pr.title })}
      className={`inline-flex max-w-[16rem] shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${chipClass(pr.state, pr.isDraft)} ${className}`}
    >
      {pr.state.toUpperCase() === 'MERGED' ? <GitMerge size={11} className="shrink-0" /> : <GitPullRequest size={11} className="shrink-0" />}
      <span className="shrink-0">#{pr.number}</span>
      <span className="min-w-0 truncate font-normal opacity-80">
        {pr.isDraft ? t('pr.draft') : pr.state.toUpperCase()}
      </span>
    </button>
  )
}
