import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

const MODE_LABELS: Record<string, { label: string; desc: string }> = {
  algorithmic: { label: '算法压缩', desc: '使用内置算法去重、归一化、停用词过滤等' },
  llm: { label: 'LLM 压缩', desc: '使用 AI 模型智能摘要压缩文本' },
  hybrid: { label: '混合压缩', desc: '先算法压缩、再 LLM 摘要，兼顾速度和效果' },
}

export default function CompressionSettings() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<CompressionPipelineConfig | null>(null)

  const { data: config, isLoading } = useQuery({
    queryKey: ['compressionConfig'],
    queryFn: () => settingService.getCompressionConfig(),
  })

  const { data: models = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })

  useEffect(() => {
    if (config && !draft) setDraft(JSON.parse(JSON.stringify(config)))
  }, [config])

  const saveMutation = useMutation({
    mutationFn: (data: CompressionPipelineConfig) => settingService.setCompressionConfig(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['compressionConfig'] }),
  })

  if (isLoading || !draft) {
    return <div className="flex items-center gap-2 p-6"><Loader2 size={16} className="animate-spin text-gray-400" /><span className="text-sm text-gray-500">加载中...</span></div>
  }

  const chatModels = models.filter(m => m.purpose === 'chat' && m.providerId)
  const saveNow = (next: CompressionPipelineConfig) => {
    setDraft(next)
    saveMutation.mutate(next)
  }
  const enabledCount = draft?.nodes.filter(n => n.enabled).length ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">压缩管道</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {draft.enabled
              ? enabledCount === 0 ? '已开启，请至少启用一个节点' : `已启用 ${enabledCount} 个节点`
              : '关闭后消息将原样发送'}
          </div>
        </div>
        <Toggle checked={draft.enabled} onChange={() => saveNow({ ...draft, enabled: !draft.enabled })} />
      </div>

      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">压缩模式</label>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(MODE_LABELS).map(([key, { label, desc }]) => (
            <button
              key={key}
              onClick={() => saveNow({ ...draft, mode: key })}
              className={`rounded-lg border p-3 text-left transition-colors ${
                draft.mode === key
                  ? 'border-violet-500 bg-violet-50 dark:border-violet-600 dark:bg-violet-950/30'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
              }`}
            >
              <div className={`text-xs font-semibold ${draft.mode === key ? 'text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-300'}`}>{label}</div>
              <div className="mt-0.5 text-[10px] text-gray-400">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {(draft.mode === 'llm' || draft.mode === 'hybrid') && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-800/30">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">压缩模型</label>
            <Select
              value={draft.llmModelId ?? ''}
              onChange={(v) => saveNow({ ...draft, llmModelId: v || undefined })}
              options={[{ value: '', label: '默认模型' }, ...chatModels.map(m => ({ value: m.id, label: m.displayName }))]}
              searchable
              placeholder="选择模型"
            />
          </div>
        </div>
      )}

      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">压缩节点</label>
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
