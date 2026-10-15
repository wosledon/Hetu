import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, GitPullRequest, GitMerge, Loader2, RefreshCw, Sparkles, Terminal } from 'lucide-react'
import { workGitService } from '../../services/workService'
import { useConfirm } from '../confirm'
import { openExternal } from '../../utils/tauri'
import type { IWorkPrActionRequest, IWorkPrCheck, IWorkPrFeedback, IWorkPrInfo, IWorkPrStatus } from '../../types/work'
import { Button, IconButton, Input, Textarea } from '../ui'

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

/** CI 检查桶 → i18n 键后缀 */
function bucketKey(bucket: string): string {
  switch (bucket) {
    case 'pass': return 'pass'
    case 'fail': return 'fail'
    case 'pending': return 'pending'
    case 'cancel': return 'cancel'
    default: return 'skipped'
  }
}

/** CI 检查桶配色 */
function checkClass(bucket: string): string {
  switch (bucket) {
    case 'pass': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    case 'fail': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
    case 'pending': return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
  }
}

/** 检查统计：面板只报数，明细只列非通过的 */
function summarizeChecks(checks: IWorkPrCheck[]) {
  return checks.reduce(
    (acc, check) => {
      if (check.bucket === 'pass') acc.passed += 1
      else if (check.bucket === 'fail') acc.failed += 1
      else if (check.bucket === 'pending') acc.pending += 1
      return acc
    },
    { passed: 0, failed: 0, pending: 0 },
  )
}

/** 合并门禁 → i18n 键后缀（冲突优先于门禁状态） */
function mergeStateKey(status?: string, mergeable?: string): string {
  if (mergeable?.toUpperCase() === 'CONFLICTING') return 'conflicting'
  switch ((status ?? '').toUpperCase()) {
    case 'CLEAN': return 'clean'
    case 'DIRTY': return 'dirty'
    case 'BLOCKED': return 'blocked'
    case 'BEHIND': return 'behind'
    case 'UNSTABLE': return 'unstable'
    case 'HAS_HOOKS': return 'hasHooks'
    default: return 'unknown'
  }
}

function mergeStateClass(status?: string, mergeable?: string): string {
  if (mergeable?.toUpperCase() === 'CONFLICTING') return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
  switch ((status ?? '').toUpperCase()) {
    case 'CLEAN': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    case 'DIRTY':
    case 'BLOCKED': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
    case 'BEHIND':
    case 'UNSTABLE':
    case 'HAS_HOOKS': return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
  }
}

/** 审查结论 → i18n 键后缀 */
function reviewKey(decision?: string): string {
  switch ((decision ?? '').toUpperCase()) {
    case 'APPROVED': return 'approved'
    case 'CHANGES_REQUESTED': return 'changesRequested'
    case 'REVIEW_REQUIRED': return 'required'
    default: return 'none'
  }
}

function reviewClass(decision?: string): string {
  switch ((decision ?? '').toUpperCase()) {
    case 'APPROVED': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    case 'CHANGES_REQUESTED': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
    case 'REVIEW_REQUIRED': return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
  }
}

/** 门禁是否已经挡住合并（冲突 / 待审查 / 落后源分支） */
function mergeBlocked(status?: string, mergeable?: string, review?: string): boolean {
  if (mergeStateKey(status, mergeable) !== 'clean') return true
  return (review ?? '').toUpperCase() === 'CHANGES_REQUESTED'
}

/** 创建 PR 表单草稿：key 记录草稿基于的初值来源，切换会话/默认分支时自动回到初值 */
interface PrForm {
  key: string
  title: string
  body: string
  baseBranch: string
  draft: boolean
}

/**
 * 工作面板的 PR / MR 页签：按仓库远端自动选 gh（GitHub）或 glab（GitLab）。
 * - CLI 未安装：给出当前系统的安装命令 + 官方地址，复制即用
 * - 已安装但没有 PR：给一个创建表单（标题/描述/目标分支/草稿）
 * - 已有 PR：编号 / 状态 / 变更量 / 门禁（CI 检查 + 审查结论 + 合并状态），可直接转草稿、
 *   合并、关闭、重开，并把失败检查与审查意见一键交给会话里的 Agent 修
 */
export default function WorkPrPanel({ projectId, sessionId, sessionTitle, onHandoffToAgent }: {
  projectId?: string
  sessionId?: string
  sessionTitle?: string
  /** 把「PR 待处理反馈」交给会话里的 Agent：由父级插进输入框 */
  onHandoffToAgent?: (text: string) => void
}) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [copied, setCopied] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [form, setForm] = useState<PrForm | null>(null)
  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>('squash')
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [actionError, setActionError] = useState('')

  const { data: status, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['workPr', projectId, sessionId],
    queryFn: () => workGitService.prStatus(projectId!, sessionId),
    enabled: !!projectId && !!sessionId,
    // 有检查在跑或合并状态还没算出来时自动刷新：面板要能自己熬到「门禁通过」
    refetchInterval: (query) => {
      const pr = query.state.data?.pr
      if (!pr) return false
      const pending = pr.checks?.some((check) => check.bucket === 'pending')
      return pending || pr.mergeable === 'UNKNOWN' ? 5000 : false
    },
  })

  /** 操作接口回传刷新后的状态：直接写缓存，省一次往返；没有则失效重查 */
  const syncStatus = (next?: IWorkPrStatus | null) => {
    if (next) queryClient.setQueryData(['workPr', projectId, sessionId], next)
    else void queryClient.invalidateQueries({ queryKey: ['workPr', projectId, sessionId] })
  }

  // 表单初值（会话标题 + 默认目标分支）用派生值给出，避免在 effect 里同步 setState 预填
  const seedKey = `${sessionId ?? ''}|${status?.baseBranch ?? ''}|${sessionTitle ?? ''}`
  const current: PrForm = form?.key === seedKey
    ? form
    : { key: seedKey, title: sessionTitle ?? '', body: '', baseBranch: status?.baseBranch ?? '', draft: false }
  const { title, body, baseBranch, draft } = current
  const patch = (next: Partial<Omit<PrForm, 'key'>>) => setForm({ ...current, ...next })

  const create = useMutation({
    mutationFn: () => workGitService.createPr(projectId!, { title: title.trim(), body, baseBranch: baseBranch.trim() || undefined, draft }, sessionId),
    onSuccess: (result) => syncStatus(result.status),
  })

  const action = useMutation({
    mutationFn: (data: IWorkPrActionRequest) => workGitService.prAction(projectId!, data, sessionId),
    onSuccess: (result) => {
      setActionError('')
      syncStatus(result.status)
    },
    onError: (error) => setActionError((error as Error).message),
  })

  /** 反馈全文：PR 上下文 + 未通过的检查 + 审查意见 + 失败日志，拼成一段可直接执行的任务说明 */
  const buildPrompt = (feedback: IWorkPrFeedback) => {
    const checks = feedback.checks.map((check) => `- ${check.name}: ${check.state}${check.link ? ` · ${check.link}` : ''}`).join('\n')
    const comments = feedback.comments
      .map((comment) => `- ${comment.author}${comment.path ? ` · ${comment.path}${comment.line ? `:${comment.line}` : ''}` : ''}: ${comment.body}`)
      .join('\n')
    return [
      t('pr.handoffIntro', { number: feedback.number, title: feedback.title, url: feedback.url }),
      t('pr.handoffState', {
        mergeState: t(`pr.mergeState.${mergeStateKey(feedback.mergeStateStatus, feedback.mergeable)}`),
        review: t(`pr.review.${reviewKey(feedback.reviewDecision)}`),
        head: pr?.headBranch ?? '',
        base: pr?.baseBranch ?? '',
      }),
      checks ? t('pr.handoffChecks', { list: checks }) : '',
      comments ? t('pr.handoffComments', { list: comments }) : '',
      feedback.logExcerpt ? t('pr.handoffLogs', { excerpt: feedback.logExcerpt }) : '',
      t('pr.handoffAsk'),
    ].filter((part) => part.length > 0).join('\n\n')
  }

  const handoff = useMutation({
    mutationFn: (mode: 'insert' | 'copy') =>
      workGitService.prFeedback(projectId!, sessionId).then((feedback) => ({ mode, text: buildPrompt(feedback) })),
    onSuccess: ({ mode, text }) => {
      setActionError('')
      if (mode === 'insert' && onHandoffToAgent) {
        onHandoffToAgent(text)
        return
      }
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedPrompt(true)
        setTimeout(() => setCopiedPrompt(false), 1500)
      })
    },
    onError: (error) => setActionError((error as Error).message),
  })

  const open = (url: string) => openExternal(url)

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
  const checks = pr?.checks ?? []
  const checkCounts = summarizeChecks(checks)
  // 通过的不占版面：只列失败 / 进行中 / 跳过的明细
  const openChecks = checks.filter((check) => check.bucket !== 'pass').slice(0, 6)
  const blocked = pr ? mergeBlocked(pr.mergeStateStatus, pr.mergeable, pr.reviewDecision) : false
  const prOpen = (pr?.state ?? '').toUpperCase() === 'OPEN' || (pr?.state ?? '').toUpperCase() === 'OPENED'
  const host = status.host === 'gitlab' ? 'GitLab' : 'GitHub'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部：当前分支 + 使用的 CLI + 刷新 */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 dark:border-gray-800">
        <GitPullRequest size={12} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {status.isRepo ? status.branch : t('explorer.notGitRepo')}
          {status.tool && <span className="ml-1 text-gray-400">· {status.tool}</span>}
        </span>
        <IconButton variant="ghost" tone="gray" className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800" label={t('pr.refresh')} onClick={() => void refetch()}
          disabled={isFetching}
          title={t('pr.refresh')}
          aria-label={t('pr.refresh')}>
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
        </IconButton>
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
                <IconButton variant="ghost" tone="gray" className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]" label={t('pr.copy')} onClick={copyInstall}
                  title={t('pr.copy')}
                  aria-label={t('pr.copy')}>
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </IconButton>
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

        {/* 已有 PR：详情（变更量 / 门禁 / CI）+ 操作 + 交给 Agent */}
        {status.toolInstalled && pr && (
          <div className="space-y-2.5">
            <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <p className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                <GitPullRequest size={11} />{t('pr.currentBranchPr', { branch: status.branch ?? '' })}
              </p>
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${stateClass(pr.state, pr.isDraft)}`}>
                  {pr.isDraft ? t('pr.draft') : pr.state.toUpperCase()}
                </span>
                <span className="text-[12px] font-medium text-gray-700 dark:text-gray-200">#{pr.number}</span>
                {pr.url && (
                  <IconButton variant="ghost" tone="gray" className="ml-auto shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
                    label={t('pr.openInHost', { host })} onClick={() => open(pr.url)}
                    title={t('pr.openInHost', { host })}
                    aria-label={t('pr.openInHost', { host })}>
                    <ExternalLink size={11} />
                  </IconButton>
                )}
              </div>
              <p className="text-[13px] leading-5 text-gray-800 dark:text-gray-100">{pr.title}</p>
              {(pr.baseBranch || pr.headBranch) && (
                <p className="flex items-center gap-1 truncate font-mono text-[11px] text-gray-400">
                  {pr.headBranch}<GitMerge size={11} className="shrink-0" />{pr.baseBranch}
                </p>
              )}

              {/* 变更量 + 门禁：一眼看出「能不能合」 */}
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-white/[0.06]">
                  <span className="text-emerald-600 dark:text-emerald-400">+{pr.additions}</span>
                  <span className="mx-0.5 text-gray-400">/</span>
                  <span className="text-rose-600 dark:text-rose-400">−{pr.deletions}</span>
                </span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
                  {t('pr.changedFiles', { count: pr.changedFiles })}
                </span>
                <span className={`rounded px-1.5 py-0.5 font-medium ${reviewClass(pr.reviewDecision)}`}>
                  {t(`pr.review.${reviewKey(pr.reviewDecision)}`)}
                </span>
                <span className={`rounded px-1.5 py-0.5 font-medium ${mergeStateClass(pr.mergeStateStatus, pr.mergeable)}`}>
                  {t(`pr.mergeState.${mergeStateKey(pr.mergeStateStatus, pr.mergeable)}`)}
                </span>
              </div>

              {/* CI 检查：报总数，明细只列非通过的 */}
              {checks.length > 0 && (
                <div className="space-y-1 border-t border-gray-100 pt-2 dark:border-gray-800">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t('pr.checksSummary', { total: checks.length, passed: checkCounts.passed, failed: checkCounts.failed, pending: checkCounts.pending })}
                  </p>
                  {openChecks.map((check) => (
                    <Button variant="ghost" tone="gray" key={`${check.name}-${check.link ?? ''}`}
                      className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                      onClick={() => check.link && open(check.link)}>
                      <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${checkClass(check.bucket)}`}>
                        {t(`pr.checkBucket.${bucketKey(check.bucket)}`)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-gray-600 dark:text-gray-300">{check.name}</span>
                      {check.link && <ExternalLink size={10} className="shrink-0 text-gray-400" />}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* 操作：转正式 / 转草稿 / 合并 / 关闭 / 重开 */}
            <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="text-[12px] font-medium text-gray-700 dark:text-gray-200">{t('pr.actions')}</div>
              <div className="flex flex-wrap gap-1.5">
                {pr.isDraft ? (
                  <Button variant="ghost" tone="gray" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]"
                    onClick={() => action.mutate({ action: 'ready' })}
                    disabled={action.isPending}>
                    <Check size={11} className="mr-1 inline" />{t('pr.markReady')}
                  </Button>
                ) : (
                  <Button variant="ghost" tone="gray" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]"
                    onClick={() => action.mutate({ action: 'draft' })}
                    disabled={action.isPending}>
                    {t('pr.markDraft')}
                  </Button>
                )}
                {prOpen ? (
                  <Button variant="ghost" tone="gray" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]"
                    onClick={() => confirm({ message: t('pr.closeConfirm', { number: pr.number }), onConfirm: () => action.mutate({ action: 'close' }) })}
                    disabled={action.isPending}>
                    {t('pr.close')}
                  </Button>
                ) : (
                  <Button variant="ghost" tone="gray" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]"
                    onClick={() => action.mutate({ action: 'reopen' })}
                    disabled={action.isPending}>
                    {t('pr.reopen')}
                  </Button>
                )}
              </div>

              {prOpen && (
                <div className="space-y-1.5 rounded-lg bg-gray-50 p-2 dark:bg-white/[0.04]">
                  <div className="flex items-center gap-1.5">
                    <select value={mergeMethod} onChange={(e) => setMergeMethod(e.target.value as 'merge' | 'squash' | 'rebase')}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                      aria-label={t('pr.mergeMethodLabel')}>
                      <option value="squash">{t('pr.mergeMethod.squash')}</option>
                      <option value="merge">{t('pr.mergeMethod.merge')}</option>
                      <option value="rebase">{t('pr.mergeMethod.rebase')}</option>
                    </select>
                    <Button variant="primary" tone="blue" className="shrink-0 rounded-lg bg-blue-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                      onClick={() => confirm({
                        message: t('pr.mergeConfirm', { number: pr.number, target: pr.baseBranch ?? '', method: t(`pr.mergeMethod.${mergeMethod}`) }),
                        onConfirm: () => action.mutate({ action: 'merge', mergeMethod, deleteBranch }),
                      })}
                      disabled={action.isPending}>
                      {action.isPending ? <Loader2 size={11} className="mr-1 inline animate-spin" /> : <GitMerge size={11} className="mr-1 inline" />}{t('pr.merge')}
                    </Button>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />{t('pr.deleteBranch')}
                  </label>
                  {blocked && (
                    <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                      {t('pr.mergeBlockedHint', { reason: t(`pr.mergeState.${mergeStateKey(pr.mergeStateStatus, pr.mergeable)}`) })}
                    </p>
                  )}
                </div>
              )}

              {actionError && <p className="text-[11px] leading-4 text-red-600 dark:text-red-300">{actionError}</p>}
            </div>

            {/* 交给 Agent：失败检查 + 审查意见 + 日志拼成任务说明，插进会话输入框 */}
            <div className="space-y-1.5 rounded-xl border border-blue-200/70 bg-blue-50/50 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-blue-700 dark:text-blue-300">
                <Sparkles size={13} />{t('pr.handoff')}
              </p>
              <p className="text-[11px] leading-4 text-blue-700/80 dark:text-blue-300/80">{t('pr.handoffHint')}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="primary" tone="blue" className="rounded-lg bg-blue-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                  onClick={() => handoff.mutate('insert')}
                  disabled={handoff.isPending}>
                  {handoff.isPending ? <Loader2 size={11} className="mr-1 inline animate-spin" /> : <Sparkles size={11} className="mr-1 inline" />}
                  {handoff.isPending ? t('pr.handoffLoading') : (onHandoffToAgent ? t('pr.handoff') : t('pr.handoffAndCopy'))}
                </Button>
                <IconButton variant="ghost" tone="gray" className="shrink-0 rounded p-1 text-blue-600 transition-colors hover:bg-white/70 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-white/[0.06]"
                  label={t('pr.copyPrompt')} onClick={() => handoff.mutate('copy')}
                  disabled={handoff.isPending}
                  title={t('pr.copyPrompt')}
                  aria-label={t('pr.copyPrompt')}>
                  {copiedPrompt ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </IconButton>
              </div>
            </div>
          </div>
        )}

        {/* 已装 CLI 但当前分支没有 PR：创建表单 */}
        {status.toolInstalled && !pr && (
          <div className="space-y-2">
            <p className="text-[12px] text-gray-500 dark:text-gray-400">{t('pr.noneYet', { branch: status.branch ?? '' })}</p>
            {status.message && <p className="truncate text-[11px] text-gray-400" title={status.message}>{status.message}</p>}
            <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="text-[12px] font-medium text-gray-700 dark:text-gray-200">{t('pr.createTitle')}</div>
              <Input tone="blue" size="sm" glass
                value={title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder={t('pr.titlePlaceholder')}
                className="w-full text-[12px]"
              />
              <Textarea tone="blue" size="sm" glass
                value={body}
                onChange={(e) => patch({ body: e.target.value })}
                rows={4}
                placeholder={t('pr.bodyPlaceholder')}
                className="w-full resize-y text-[12px]"
              />
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('pr.basePlaceholder')}</label>
                <Input tone="blue" size="sm" glass
                  value={baseBranch}
                  onChange={(e) => patch({ baseBranch: e.target.value })}
                  placeholder={status.baseBranch ?? 'main'}
                  className="w-full font-mono text-[11px]"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                <input type="checkbox" checked={draft} onChange={(e) => patch({ draft: e.target.checked })} />{t('pr.draft')}
              </label>
              {!status.branchPushed && (
                <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-[11px] text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-300">
                  {t('pr.branchNotPushed', { branch: status.branch ?? '' })}
                </p>
              )}
              <Button variant="primary" tone="blue" className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50" onClick={() => create.mutate()}
                disabled={create.isPending || !title.trim()}>
                {create.isPending ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />}
                {create.isPending ? t('pr.creating') : t('pr.create', { tool: status.tool })}
              </Button>
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
              <Button variant="ghost" tone="gray" className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5 text-left transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/[0.04]" key={`${item.number}-${item.url}`}
                onClick={() => item.url && open(item.url)}>
                <span className="shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400">#{item.number}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-200">{item.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-gray-400">{item.headBranch}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
