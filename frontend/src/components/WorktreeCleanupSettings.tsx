import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderGit2, Loader2, RefreshCw } from 'lucide-react'
import { settingService, type WorktreeCleanupConfig } from '../services/settingService'
import { formatDateTime } from '../utils/locale'
import Select from './Select'

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
        checked ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
        style={{ marginTop: '2px' }}
      />
    </button>
  )
}

/**
 * Code 工作树自动清理设置：工作树干净且它的提交都已并入集成分支（或远端分支已被删除，
 * 即 squash 合并后删分支）时，空闲一段时间后自动清掉本地工作树，会话回到「当前分支」。
 * 无主的残留目录始终清理；「立即清理」按同一套判定跑一次，不受开关与空闲阈值限制。
 */
export default function WorktreeCleanupSettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [draftOverride, setDraftOverride] = useState<WorktreeCleanupConfig | null>(null)
  const [runResult, setRunResult] = useState<string | null>(null)

  const intervalOptions = [
    { value: '1', label: t('worktreeCleanup.interval1h') },
    { value: '6', label: t('worktreeCleanup.interval6h') },
    { value: '12', label: t('worktreeCleanup.interval12h') },
    { value: '24', label: t('worktreeCleanup.intervalDaily') },
  ]

  const { data: config, isLoading } = useQuery({
    queryKey: ['worktreeCleanupConfig'],
    queryFn: () => settingService.getWorktreeCleanupConfig(),
  })

  const saveMutation = useMutation({
    mutationFn: (data: WorktreeCleanupConfig) => settingService.setWorktreeCleanupConfig(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['worktreeCleanupConfig'] }),
  })

  const runMutation = useMutation({
    mutationFn: () => settingService.runWorktreeCleanup(),
    onSuccess: (r) => {
      setRunResult(t('worktreeCleanup.runDone', { removed: r.removed, checked: r.checked, kept: r.kept }))
      queryClient.invalidateQueries({ queryKey: ['worktreeCleanupConfig'] })
      queryClient.invalidateQueries({ queryKey: ['workSessions'] })
    },
    onError: (e: Error) => setRunResult(t('worktreeCleanup.runFailed', { error: e.message })),
  })

  const draft = draftOverride ?? config ?? null
  if (isLoading || !draft) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-gray-400" />
        <span className="text-sm text-gray-500">{t('common:loading')}</span>
      </div>
    )
  }

  const saveNow = (next: WorktreeCleanupConfig) => {
    setDraftOverride(next)
    saveMutation.mutate(next)
  }

  const numberField = (value: number, min: number, max: number, onChange: (v: number) => void) => (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = parseInt(e.target.value || '0', 10) || 0
        onChange(Math.min(max, Math.max(min, v)))
      }}
      className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 dark:border-gray-600 dark:bg-gray-700"
    />
  )

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-50">
          <FolderGit2 size={17} className="text-emerald-500" />
          {t('worktreeCleanup.title')}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('worktreeCleanup.subtitle')}</p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('worktreeCleanup.autoTitle')}</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {draft.enabled
              ? t('worktreeCleanup.autoOn', {
                  hours: draft.intervalHours,
                  last: draft.lastRunAt ? formatDateTime(draft.lastRunAt) : t('worktreeCleanup.neverRun'),
                  removed: draft.lastRemoved ?? 0,
                })
              : t('worktreeCleanup.autoOff')}
          </div>
        </div>
        <Toggle checked={draft.enabled} onChange={() => saveNow({ ...draft, enabled: !draft.enabled })} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('worktreeCleanup.interval')}</label>
          <Select
            value={String(draft.intervalHours)}
            onChange={(v) => saveNow({ ...draft, intervalHours: parseInt(v, 10) })}
            options={intervalOptions}
            placeholder={t('worktreeCleanup.interval')}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('worktreeCleanup.idleHours')}</label>
          {numberField(draft.idleHours, 1, 8760, (v) => saveNow({ ...draft, idleHours: v }))}
          <p className="mt-1 text-[11px] text-gray-400">{t('worktreeCleanup.idleHoursHint')}</p>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{t('worktreeCleanup.deleteBranchTitle')}</div>
          <div className="mt-0.5 text-xs text-gray-500">{t('worktreeCleanup.deleteBranchHint')}</div>
        </div>
        <Toggle checked={draft.deleteMergedBranch} onChange={() => saveNow({ ...draft, deleteMergedBranch: !draft.deleteMergedBranch })} />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-500/25 dark:bg-emerald-950/20">
        <div className="text-xs text-emerald-700 dark:text-emerald-300">
          <p className="font-medium">{t('worktreeCleanup.manualTitle')}</p>
          <p className="mt-0.5 text-emerald-600/80 dark:text-emerald-300/80">{t('worktreeCleanup.manualHint')}</p>
        </div>
        <button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:opacity-50"
        >
          {runMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {runMutation.isPending ? t('worktreeCleanup.running') : t('worktreeCleanup.runOnce')}
        </button>
      </div>

      {runResult && (
        <p className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">{runResult}</p>
      )}
    </section>
  )
}
