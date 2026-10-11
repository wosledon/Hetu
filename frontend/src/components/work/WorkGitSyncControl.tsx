import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { workGitService } from '../../services/workService'
import type { IWorkSession } from '../../types/work'

/**
 * Git 同步控件（放在分支选择器右侧）：展示与上游的领先/落后提交数、未提交文件数，
 * 并提供拉取（--ff-only）与推送（无上游时自动 push -u origin <branch>）按钮。
 * 作用范围同会话工作区：带工作树的会话操作工作树。
 */
export default function WorkGitSyncControl({ session }: { session: IWorkSession }) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data: status, isLoading } = useQuery({
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

  const pull = useMutation({ mutationFn: () => workGitService.pull(session.projectId, session.id), onSuccess: invalidate })
  const push = useMutation({ mutationFn: () => workGitService.push(session.projectId, session.id), onSuccess: invalidate })
  const busy = pull.isPending || push.isPending

  const isRepo = !!status?.isRepo
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const dirty = status?.files.length ?? 0
  const upstream = status?.upstream
  const synced = isRepo && !ahead && !behind
  const result = (pull.isError ? pull.error : push.isError ? push.error : null) as Error | null
  const output = pull.data?.output || push.data?.output

  const triggerClass = `inline-flex max-w-[11rem] items-center gap-1.5 rounded-lg bg-gray-100/80 px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 dark:bg-white/[0.06] ${
    !synced ? 'text-amber-600 hover:text-amber-700 dark:text-amber-300' : 'text-gray-500 hover:text-gray-700 dark:text-gray-300'
  }`

  return (
    <div className="relative flex items-center">
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!isRepo || isLoading}
        title={t('gitSync.title')}
        className={triggerClass}
      >
        {busy || isLoading ? (
          <Loader2 size={11} className="shrink-0 animate-spin" />
        ) : synced ? (
          <Check size={11} className="shrink-0" />
        ) : (
          <RefreshCw size={11} className="shrink-0" />
        )}
        <span className="flex shrink-0 items-center gap-1">
          <ArrowUp size={10} />
          {ahead}
          <ArrowDown size={10} className="ml-0.5" />
          {behind}
        </span>
        {dirty > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
        <ChevronDown size={11} className={`shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && isRepo && (
        <div className="absolute bottom-full right-0 z-50 mb-1.5 w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-gray-900">
          <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-gray-400">
            <GitBranchText upstream={upstream} branch={status?.branch ?? ''} />
          </div>

          <div className="px-2 pb-1 text-[12px] text-gray-600 dark:text-gray-300">
            <p>{t('gitSync.ahead', { count: ahead })}</p>
            <p>{t('gitSync.behind', { count: behind })}</p>
            <p className={dirty > 0 ? 'text-amber-600 dark:text-amber-300' : ''}>{t('gitSync.uncommitted', { count: dirty })}</p>
          </div>

          <div className="mt-1 flex items-center gap-1 border-t border-gray-100 pt-1.5 dark:border-white/[0.06]">
            <button
              onClick={() => pull.mutate()}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/[0.06]"
            >
              {pull.isPending ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
              {t('gitSync.pull')}
            </button>
            <button
              onClick={() => push.mutate()}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/[0.06]"
            >
              {push.isPending ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
              {upstream ? t('gitSync.push') : t('gitSync.publish')}
            </button>
          </div>

          <p className="px-2 pt-1 text-[10px] leading-4 text-gray-400">{t('gitSync.pullHint')}</p>

          {(output || result) && (
            <pre
              onClick={() => {
                pull.reset()
                push.reset()
              }}
              title={t('gitSync.dismiss')}
              className={`mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border px-2 py-1.5 text-[11px] ${
                result
                  ? 'border-red-200 text-red-600 dark:border-red-900/50 dark:text-red-300'
                  : 'border-gray-100 text-gray-500 dark:border-white/10 dark:text-gray-400'
              }`}
            >
              {result?.message || output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function GitBranchText({ upstream, branch }: { upstream?: string; branch: string }) {
  const { t } = useTranslation('work')
  return (
    <>
      <span className="truncate text-gray-500 dark:text-gray-400">{branch}</span>
      <span>{upstream ? `→ ${upstream}` : `· ${t('gitSync.noUpstream')}`}</span>
    </>
  )
}
