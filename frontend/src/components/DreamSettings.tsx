import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Moon, Sparkles } from 'lucide-react'
import { settingService, type DreamConfig } from '../services/settingService'
import { memoryService } from '../services/memoryService'
import i18n from '../i18n'
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
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`} style={{ marginTop: '2px' }} />
    </button>
  )
}

function formatTime(value?: string): string {
  if (!value) return i18n.t('knowledge:dream.neverRun')
  return formatDateTime(value)
}

/**
 * Dream 记忆巩固设置：模拟人类睡眠期整理记忆——
 * 自动模式按周期后台执行；也可手动「立即巩固一次」，与记忆页的 Dream 按钮共用同一逻辑。
 */
export default function DreamSettings() {
  const { t } = useTranslation('knowledge')
  const queryClient = useQueryClient()
  const [draftOverride, setDraftOverride] = useState<DreamConfig | null>(null)
  const [dreamResult, setDreamResult] = useState<string | null>(null)

  const intervalOptions = [
    { value: '12', label: t('dream.interval12h') },
    { value: '24', label: t('dream.intervalDaily') },
    { value: '48', label: t('dream.interval48h') },
    { value: '168', label: t('dream.intervalWeekly') },
  ]

  const { data: config, isLoading } = useQuery({
    queryKey: ['dreamConfig'],
    queryFn: () => settingService.getDreamConfig(),
  })

  const saveMutation = useMutation({
    mutationFn: (data: DreamConfig) => settingService.setDreamConfig(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dreamConfig'] }),
  })

  const dreamMutation = useMutation({
    mutationFn: () => memoryService.dream(),
    onSuccess: (r) => {
      setDreamResult(t('memories.dreamDone', { merged: r.merged, decayed: r.decayed, forgotten: r.forgotten, remaining: r.remaining }))
      queryClient.invalidateQueries({ queryKey: ['dreamConfig'] })
      queryClient.invalidateQueries({ queryKey: ['memories'] })
    },
    onError: (e: Error) => setDreamResult(t('memories.dreamFailed', { msg: e.message })),
  })

  const draft = draftOverride ?? config ?? null

  if (isLoading || !draft) {
    return <div className="flex items-center gap-2 p-6"><Loader2 size={16} className="animate-spin text-gray-400" /><span className="text-sm text-gray-500">{t('common:loading')}</span></div>
  }

  const saveNow = (next: DreamConfig) => {
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <Moon size={15} className="text-indigo-500" />
            {t('dream.autoTitle')}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            {draft.enabled
              ? t('dream.autoOn', { time: formatTime(draft.lastRunAt) })
              : t('dream.autoOff')}
          </div>
        </div>
        <Toggle checked={draft.enabled} onChange={() => saveNow({ ...draft, enabled: !draft.enabled })} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('dream.interval')}</label>
          <Select
            value={String(draft.intervalHours)}
            onChange={(v) => saveNow({ ...draft, intervalHours: parseInt(v, 10) })}
            options={intervalOptions}
            placeholder={t('dream.interval')}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('dream.mergeThreshold')}</label>
          {numberField(Math.round(draft.mergeThreshold * 100), 50, 99, (v) => saveNow({ ...draft, mergeThreshold: v / 100 }))}
          <p className="mt-1 text-[11px] text-gray-400">{t('dream.mergeThresholdHint')}</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('dream.decayDays')}</label>
          {numberField(draft.decayDays, 1, 3650, (v) => saveNow({ ...draft, decayDays: v }))}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('dream.forgetDays')}</label>
          {numberField(draft.forgetDays, 1, 3650, (v) => saveNow({ ...draft, forgetDays: v }))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-500/25 dark:bg-indigo-950/20">
        <div className="text-xs text-indigo-700 dark:text-indigo-300">
          <p className="flex items-center gap-1.5 font-medium"><Sparkles size={13} />{t('dream.manualTitle')}</p>
          <p className="mt-0.5 text-indigo-600/80 dark:text-indigo-300/80">{t('dream.manualHint')}</p>
        </div>
        <button
          onClick={() => dreamMutation.mutate()}
          disabled={dreamMutation.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 disabled:opacity-50"
        >
          {dreamMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
          {dreamMutation.isPending ? t('dream.running') : t('dream.runOnce')}
        </button>
      </div>

      {dreamResult && (
        <p className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">{dreamResult}</p>
      )}
    </div>
  )
}
