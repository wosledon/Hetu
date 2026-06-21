import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Star, Bot, X } from 'lucide-react'
import { aiProviderService, aiModelService } from '../services/aiProviderService'

const inputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20'
const selectClass = 'w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20'

export default function AiSettings() {
  const queryClient = useQueryClient()
  const [showProviderForm, setShowProviderForm] = useState(false)
  const [showModelForm, setShowModelForm] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')

  const { data: providers = [] } = useQuery({
    queryKey: ['aiProviders'],
    queryFn: aiProviderService.getAll,
  })

  const createProvider = useMutation({
    mutationFn: aiProviderService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
      setShowProviderForm(false)
    },
  })

  const deleteProvider = useMutation({
    mutationFn: aiProviderService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
    },
  })

  const createModel = useMutation({
    mutationFn: aiModelService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
      setShowModelForm(false)
    },
  })

  const deleteModel = useMutation({
    mutationFn: aiModelService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
    },
  })

  const setDefaultModel = useMutation({
    mutationFn: aiModelService.setDefault,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">AI 模型</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">管理 AI Provider 和模型配置</p>
        </div>
        <button
          onClick={() => setShowProviderForm(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/30 active:scale-[0.98]"
        >
          <Plus size={15} /> 添加 Provider
        </button>
      </div>

      {/* Provider Form */}
      {showProviderForm && (
        <ProviderForm
          onSubmit={(data) => createProvider.mutate(data)}
          onCancel={() => setShowProviderForm(false)}
        />
      )}

      {/* Empty State */}
      {providers.length === 0 && !showProviderForm && (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-12 dark:border-white/[0.08]">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/[0.06]">
            <Bot size={24} className="text-gray-400" />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">还没有 AI Provider</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">点击上方按钮添加第一个 Provider</p>
        </div>
      )}

      {/* Provider Cards */}
      {providers.map((provider) => (
        <div key={provider.id} className="rounded-xl border border-gray-200/80 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]">
          {/* Provider Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm shadow-indigo-500/25">
                <Bot size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{provider.name}</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {provider.providerType}
                  <span className="mx-1.5">·</span>
                  <span className={provider.isEnabled ? 'text-emerald-500' : 'text-gray-400'}>
                    {provider.isEnabled ? '启用' : '禁用'}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  setSelectedProviderId(provider.id)
                  setShowModelForm(true)
                }}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
                title="添加模型"
              >
                <Plus size={15} />
              </button>
              <button
                onClick={() => deleteProvider.mutate(provider.id)}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                title="删除 Provider"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          {/* Models List */}
          <div className="p-4">
            {provider.models.length === 0 ? (
              <p className="py-3 text-center text-xs text-gray-400 dark:text-gray-500">暂无模型，点击 + 添加</p>
            ) : (
              <div className="space-y-2">
                {provider.models.map((model) => (
                  <div
                    key={model.id}
                    className="group flex items-center justify-between rounded-lg px-3.5 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{model.displayName}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{model.modelId}</span>
                      <span className="inline-flex shrink-0 items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                        {model.purpose}
                      </span>
                      {model.reasoningMode && model.reasoningMode !== 'none' && (
                        <span className="inline-flex shrink-0 items-center rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
                          {model.reasoningMode === 'native' ? '原生推理' : '标签推理'} · {model.reasoningEffort === 'low' ? '低' : model.reasoningEffort === 'medium' ? '中' : model.reasoningEffort === 'high' ? '高' : '关闭'}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => setDefaultModel.mutate(model.id)}
                        className={`rounded-md p-1.5 transition-colors ${model.isDefault ? 'text-amber-400 opacity-100' : 'text-gray-300 hover:text-amber-400 dark:text-gray-600'}`}
                        title={model.isDefault ? '默认模型' : '设为默认'}
                      >
                        <Star size={14} className={model.isDefault ? 'fill-amber-400' : ''} />
                      </button>
                      <button
                        onClick={() => deleteModel.mutate(model.id)}
                        className="rounded-md p-1.5 text-gray-300 transition-colors hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Model Form Modal */}
      {showModelForm && (
        <ModelForm
          onSubmit={(data) => createModel.mutate({ ...data, providerId: selectedProviderId })}
          onCancel={() => setShowModelForm(false)}
        />
      )}
    </div>
  )
}

/* ─── Provider Form ─── */

function ProviderForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { providerType: 'openai' | 'anthropic'; name: string; apiKey: string; baseUrl?: string }) => void
  onCancel: () => void
}) {
  const [providerType, setProviderType] = useState<'openai' | 'anthropic'>('openai')
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  return (
    <div className="rounded-xl border border-blue-200/60 bg-blue-50/30 p-5 dark:border-blue-500/20 dark:bg-blue-950/10">
      <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-gray-200">添加 Provider</h3>
      <div className="space-y-3">
        <select
          value={providerType}
          onChange={(e) => setProviderType(e.target.value as 'openai' | 'anthropic')}
          className={selectClass}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名称（如 My OpenAI）"
          className={inputClass}
        />
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API Key"
          className={inputClass}
        />
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="Base URL（可选，默认官方地址）"
          className={inputClass}
        />
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSubmit({ providerType, name, apiKey, baseUrl: baseUrl || undefined })}
            className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            保存
          </button>
          <button
            onClick={onCancel}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Model Form Modal ─── */

function ModelForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { modelId: string; displayName: string; purpose: 'chat' | 'embedding' | 'completion'; isDefault: boolean; contextWindow?: number; dimensions?: number; reasoningMode: string; reasoningEffort: string }) => void
  onCancel: () => void
}) {
  const [modelId, setModelId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [purpose, setPurpose] = useState<'chat' | 'embedding' | 'completion'>('chat')
  const [isDefault, setIsDefault] = useState(false)
  const [contextWindow, setContextWindow] = useState('')
  const [dimensions, setDimensions] = useState('')
  const [reasoningMode, setReasoningMode] = useState('none')
  const [reasoningEffort, setReasoningEffort] = useState('medium')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-[420px] max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-200/80 bg-white p-6 shadow-2xl dark:border-white/[0.08] dark:bg-[#12151f]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">添加模型</h3>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">模型 ID</label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="gpt-4o, claude-3-opus, ..."
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">显示名称</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="留空则使用模型 ID"
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">用途</label>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as 'chat' | 'embedding' | 'completion')}
              className={selectClass}
            >
              <option value="chat">对话</option>
              <option value="embedding">Embedding</option>
              <option value="completion">补全</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">上下文窗口</label>
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="可选"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">向量维度</label>
              <input
                type="number"
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                placeholder="Embedding 专用"
                className={inputClass}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">推理模式</label>
            <select
              value={reasoningMode}
              onChange={(e) => setReasoningMode(e.target.value)}
              className={selectClass}
            >
              <option value="none">不支持</option>
              <option value="tag">标签模式（&lt;thinking&gt; 标签）</option>
              <option value="native">原生模式（o1/Claude 等）</option>
            </select>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">标签模式适用于普通模型，原生模式适用于内置推理的模型</p>
          </div>
          {reasoningMode !== 'none' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">推理强度</label>
              <select
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value)}
                className={selectClass}
              >
                <option value="off">关闭</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
            />
            设为默认模型
          </label>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={() =>
              onSubmit({
                modelId,
                displayName: displayName || modelId,
                purpose,
                isDefault,
                contextWindow: contextWindow ? parseInt(contextWindow) : undefined,
                dimensions: dimensions ? parseInt(dimensions) : undefined,
                reasoningMode,
                reasoningEffort,
              })
            }
            className="flex-1 rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            保存
          </button>
          <button
            onClick={onCancel}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
