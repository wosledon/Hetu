import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, GitPullRequest, GitMerge, Loader2, RefreshCw, Terminal } from 'lucide-react'
import { workGitService } from '../../services/workService'
import type { IWorkPrInfo } from '../../types/work'

/** PR 状态色：草稿/合并/关闭/进行中 */
function stateClass(state: string, isDraft: boolean): string {
  if (isDraft) return 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
  switch (state.toUpperCase()) {
    case 'MERGED': return 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
    case 'CLOSED': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
    case 'OPENED':
    case 'OPEN': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
  }
}

/**
 * 工作面板的 PR / MR 页签：按仓库远端自动选 gh（GitHub）或 glab（GitLab）。
 * - CLI 未安装：给出当前系统的安装命令 + 官方地址，复制即用
 * - 已安装但没有 PR：给一个创建表单（标题/描述/目标分支/草稿）
 * - 已有 PR：展示编号、状态、标题、目标分支，可跳转到托管平台
 */
export default function WorkPrPanel({ projectId, sessionId, sessionTitle }: { projectId?: string; sessionId?: string; sessionTitle?: string }) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [draft, setDraft] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data: status, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['workPr', projectId, sessionId],
    queryFn: () => workGitService.prStatus(projectId!, sessionId),
    enabled: !!projectId && !!sessionId,
  })

  // 展开表单时用会话标题 + 默认目标分支预填
  useEffect(() => {
    if (title || !status) return
    setTitle(sessionTitle ?? '')
    setBaseBranch(status.baseBranch ?? '')
  }, [status, sessionTitle, title])

  const create = useMutation({
    mutationFn: () => workGitService.createPr(projectId!, { title: title.trim(), body, baseBranch: baseBranch.trim() || undefined, draft }, sessionId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workPr', projectId, sessionId] }),
  })

  const open = (url: string) => window.open(url, '_blank', 'noopener')

  const copyInstall = () => {
    if (!status?.installHint) return
    void navigator.clipboard.writeText(status.installHint).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (!projectId || !sessionId) {
    return <div className="p-3 text-[12px] text-gray-400">{t('pr.selectSession')}</div>
  }
  if (isLoading || !status) {
    return <div className="flex items-center gap-2 p-3 text-[12px] text-gray-400"><Loader2 size={13} className="animate-spin" />{t('common:loading')}</div>
  }

  const pr: IWorkPrInfo | null = status.pr ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部：当前分支 + 使用的 CLI + 刷新 */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 dark:border-gray-800">
        <GitPullRequest size={12} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {status.isRepo ? status.branch : t('explorer.notGitRepo')}
          {status.tool && <span className="ml-1 text-gray-400">· {status.tool}</span>}
        </span>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          title={t('pr.refresh')}
          aria-label={t('pr.refresh')}
          className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* 不是 git / 没有远端 / 不认识的托管平台 */}
        {!status.isRepo && <p className="text-[12px] text-gray-400">{t('explorer.notGitRepo')}</p>}
        {status.isRepo && status.message === 'no-remote' && <p className="text-[12px] text-gray-400">{t('pr.noRemote')}</p>}
        {status.isRepo && status.message === 'unsupported-host' && (
          <div className="space-y-1 text-[12px] text-gray-500 dark:text-gray-400">
            <p>{t('pr.unsupportedHost')}</p>
            {status.remoteUrl && <p className="truncate font-mono text-[11px] text-gray-400">{status.remoteUrl}</p>}
          </div>
        )}

        {/* CLI 未安装：引导安装 */}
        {status.host && !status.toolInstalled && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800/60 dark:bg-amber-950/20">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-amber-800 dark:text-amber-300">
              <Terminal size={13} />
              {t('pr.needCli', { tool: status.tool })}
            </p>
            <p className="text-[11px] text-amber-700/90 dark:text-amber-300/80">{t('pr.installHint', { host: status.host === 'gitlab' ? 'GitLab' : 'GitHub' })}</p>
            {status.installHint && (
              <div className="flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1.5 dark:bg-white/[0.04]">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">{status.installHint}</code>
                <button
                  onClick={copyInstall}
                  title={t('pr.copy')}
                  aria-label={t('pr.copy')}
                  className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
                >
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </button>
              </div>
            )}
            {status.installUrl && (
              <button
                onClick={() => open(status.installUrl!)}
                className="inline-flex items-center gap-1 text-[11px] text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
              >
                <ExternalLink size={11} />{t('pr.installDocs')}
              </button>
            )}
          </div>
        )}

        {/* 已有 PR */}
        {status.toolInstalled && pr && (
          <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <p className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
              <GitPullRequest size={11} />{t('pr.currentBranchPr', { branch: status.branch ?? '' })}
            </p>
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${stateClass(pr.state, pr.isDraft)}`}>
                {pr.isDraft ? t('pr.draft') : pr.state.toUpperCase()}
              </span>
              <span className="text-[12px] font-medium text-gray-700 dark:text-gray-200">#{pr.number}</span>
            </div>
            <p className="text-[13px] leading-5 text-gray-800 dark:text-gray-100">{pr.title}</p>
            {(pr.baseBranch || pr.headBranch) && (
              <p className="flex items-center gap-1 truncate font-mono text-[11px] text-gray-400">
                {pr.headBranch}<GitMerge size={11} className="shrink-0" />{pr.baseBranch}
              </p>
            )}
            {pr.url && (
              <button
                onClick={() => open(pr.url)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                <ExternalLink size={11} />{t('pr.openInHost', { host: status.host === 'gitlab' ? 'GitLab' : 'GitHub' })}
              </button>
            )}
          </div>
        )}

        {/* 已装 CLI 但当前分支没有 PR：创建表单 */}
        {status.toolInstalled && !pr && (
          <div className="space-y-2">
            <p className="text-[12px] text-gray-500 dark:text-gray-400">{t('pr.noneYet', { branch: status.branch ?? '' })}</p>
            {status.message && <p className="truncate text-[11px] text-gray-400" title={status.message}>{status.message}</p>}
            <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="text-[12px] font-medium text-gray-700 dark:text-gray-200">{t('pr.createTitle')}</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('pr.titlePlaceholder')}
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-blue-300 dark:border-gray-600 dark:bg-gray-800"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder={t('pr.bodyPlaceholder')}
                className="w-full resize-y rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-blue-300 dark:border-gray-600 dark:bg-gray-800"
              />
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('pr.basePlaceholder')}</label>
                <input
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder={status.baseBranch ?? 'main'}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-mono text-[11px] outline-none focus:border-blue-300 dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />{t('pr.draft')}
              </label>
              {!status.branchPushed && (
                <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-[11px] text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-300">
                  {t('pr.branchNotPushed', { branch: status.branch ?? '' })}
                </p>
              )}
              <button
                onClick={() => create.mutate()}
                disabled={create.isPending || !title.trim()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                {create.isPending ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />}
                {create.isPending ? t('pr.creating') : t('pr.create', { tool: status.tool })}
              </button>
              {create.isError && <p className="text-[11px] text-red-600 dark:text-red-300">{(create.error as Error).message}</p>}
              <p className="text-[10px] leading-4 text-gray-400">{t('pr.createHint', { tool: status.tool, base: baseBranch || status.baseBranch || '' })}</p>
            </div>
          </div>
        )}
        {/* 仓库开放中的 PR：和「当前分支的 PR」对照着看 */}
        {status.toolInstalled && (status.openPrs?.length ?? 0) > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
              {t('pr.openTitle', { host: status.host === 'gitlab' ? 'GitLab' : 'GitHub', count: status.openPrs!.length })}
            </p>
            {status.openPrs!.map((item) => (
              <button
                key={`${item.number}-${item.url}`}
                onClick={() => item.url && open(item.url)}
                className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5 text-left transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/[0.04]"
              >
                <span className="shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400">#{item.number}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-200">{item.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-gray-400">{item.headBranch}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
