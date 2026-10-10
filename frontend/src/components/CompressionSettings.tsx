import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { settingService, type CompressionPipelineConfig } from '../services/settingService'
import { aiModelService } from '../services/aiProviderService'
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

const MODE_OPTIONS: Record<string, { labelKey: string; descKey: string }> = {
  algorithmic: { labelKey: 'compression.algorithmicLabel', descKey: 'compression.algorithmicDesc' },
  llm: { labelKey: 'compression.llmLabel', descKey: 'compression.llmDesc' },
  hybrid: { labelKey: 'compression.hybridLabel', descKey: 'compression.hybridDesc' },
}

export default function CompressionSettings() {
  const { t } = useTranslation('chat')
  const queryClient = useQueryClient()
  const [draftOverride, setDraftOverride] = useState<CompressionPipelineConfig | null>(null)

  const { data: config, isLoading } = useQuery({
    queryKey: ['compressionConfig'],
    queryFn: () => settingService.getCompressionConfig(),
  })

  const { data: models = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })

  const saveMutation = useMutation({
    mutationFn: (data: CompressionPipelineConfig) => settingService.setCompressionConfig(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['compressionConfig'] }),
  })

  // 以服务端配置为基线，用户编辑后以本地草稿为准
  const draft = draftOverride ?? config ?? null

  if (isLoading || !draft) {
    return <div className="flex items-center gap-2 p-6"><Loader2 size={16} className="animate-spin text-gray-400" /><span className="text-sm text-gray-500">{t('common:loading')}</span></div>
  }

  const chatModels = models.filter(m => m.purpose === 'chat' && m.providerId)
  const saveNow = (next: CompressionPipelineConfig) => {
    setDraftOverride(next)
    saveMutation.mutate(next)
  }
  const enabledCount = draft?.nodes.filter(n => n.enabled).length ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('compression.pipeline')}</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {draft.enabled
              ? enabledCount === 0 ? t('compression.enabledNoNodes') : t('compression.enabledNodes', { count: enabledCount })
              : t('compression.disabledHint')}
          </div>
        </div>
        <Toggle checked={draft.enabled} onChange={() => saveNow({ ...draft, enabled: !draft.enabled })} />
      </div>

      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('compression.mode')}</label>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(MODE_OPTIONS).map(([key, { labelKey, descKey }]) => (
            <button
              key={key}
              onClick={() => saveNow({ ...draft, mode: key })}
              className={`rounded-lg border p-3 text-left transition-colors ${
                draft.mode === key
                  ? 'border-violet-500 bg-violet-50 dark:border-violet-600 dark:bg-violet-950/30'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
              }`}
            >
              <div className={`text-xs font-semibold ${draft.mode === key ? 'text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-300'}`}>{t(labelKey)}</div>
              <div className="mt-0.5 text-[10px] text-gray-400">{t(descKey)}</div>
            </button>
          ))}
        </div>
      </div>

      {(draft.mode === 'llm' || draft.mode === 'hybrid') && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-800/30">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('compression.model')}</label>
            <Select
              value={draft.llmModelId ?? ''}
              onChange={(v) => saveNow({ ...draft, llmModelId: v || undefined })}
              options={[{ value: '', label: t('compression.defaultModel') }, ...chatModels.map(m => ({ value: m.id, label: m.displayName }))]}
              searchable
              placeholder={t('compression.selectModel')}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('compression.llmThreshold')}</label>
            <input
              type="number"
              min={0}
              value={draft.llmThreshold ?? 500}
              onChange={(e) => saveNow({ ...draft, llmThreshold: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })}
              className="w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-300 dark:border-gray-600 dark:bg-gray-700"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {t('compression.thresholdHint')}
            </p>
          </div>
        </div>
      )}

      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('compression.nodes')}</label>
        <div className="space-y-1.5">
          {[...draft.nodes].sort((a, b) => a.order - b.order).map((node, idx) => (
            <div
              key={node.key}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
            >
              <span className="text-[10px] text-gray-300 tabular-nums w-4">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{node.label}</div>
                <div className="mt-0.5 text-[10px] text-gray-400 truncate">{node.description}</div>
              </div>
              <Toggle checked={node.enabled} onChange={() => saveNow({ ...draft, nodes: draft.nodes.map(n => n.key === node.key ? { ...n, enabled: !n.enabled } : n) })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
