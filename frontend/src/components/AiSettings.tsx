import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Star, Bot, X, Download, Eye, EyeOff, Sparkles, Wrench, Brain, Pencil, Zap } from 'lucide-react'
import { aiProviderService, aiModelService } from '../services/aiProviderService'
import type { RemoteModelInfo } from '../services/aiProviderService'
import Select from './Select'

const inputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20'

export default function AiSettings() {
  const queryClient = useQueryClient()
  const [showProviderForm, setShowProviderForm] = useState(false)
  const [showModelForm, setShowModelForm] = useState(false)
  const [showFetchForm, setShowFetchForm] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [editingModel, setEditingModel] = useState<{ id: string; modelId: string; displayName: string; purpose: 'chat' | 'embedding'; contextWindow?: number; dimensions?: number; reasoningMode: string; reasoningEffort: string; supportsVision: boolean; supportsReasoning: boolean; supportsTools: boolean; isVisible: boolean; isDefault: boolean } | null>(null)

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
      setEditingModel(null)
    },
  })

  const updateModel = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof aiModelService.update>[1] }) =>
      aiModelService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
      setShowModelForm(false)
      setEditingModel(null)
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

  const toggleModelVisibility = useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      aiModelService.update(id, {
        modelId: '',
        displayName: '',
        purpose: 'chat',
        isVisible,
      }),
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
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">管理 AI 提供商和模型配置</p>
        </div>
        <button
          onClick={() => setShowProviderForm(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/30 active:scale-[0.98]"
        >
          <Plus size={15} /> 添加提供商
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
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">还没有 AI 提供商</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">点击上方按钮添加第一个提供商</p>
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
                onClick={() => {
                  setSelectedProviderId(provider.id)
                  setShowFetchForm(true)
                }}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
                title="自动获取模型"
              >
                <Download size={15} />
              </button>
              <button
                onClick={() => deleteProvider.mutate(provider.id)}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                title="删除提供商"
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
                        {model.purpose === 'chat' ? '对话' : model.purpose === 'embedding' ? 'Embedding' : model.purpose}
                      </span>
                      {model.supportsVision && (
                        <span title="视觉" className="inline-flex shrink-0 items-center rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
                          <Sparkles size={10} className="mr-0.5" />视觉
                        </span>
                      )}
                      {model.supportsReasoning && (
                        <span title="推理" className="inline-flex shrink-0 items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                          <Brain size={10} className="mr-0.5" />推理
                        </span>
                      )}
                      {model.supportsTools && (
                        <span title="工具调用" className="inline-flex shrink-0 items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                          <Wrench size={10} className="mr-0.5" />工具
                        </span>
                      )}
                      {model.reasoningMode && model.reasoningMode !== 'none' && (
                        <span className="inline-flex shrink-0 items-center rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
                          {model.reasoningMode === 'native' ? '原生推理' : '标签推理'} · {model.reasoningEffort === 'low' ? '低' : model.reasoningEffort === 'medium' ? '中' : model.reasoningEffort === 'high' ? '高' : '关闭'}
                        </span>
                      )}
                      {!model.isVisible && (
                        <span className="inline-flex shrink-0 items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-white/[0.06] dark:text-gray-500">
                          已隐藏
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setDefaultModel.mutate(model.id)}
                        className={`rounded-md p-1.5 transition-colors ${model.isDefault ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400 dark:text-gray-600'}`}
                        title={model.isDefault ? '默认模型' : '设为默认'}
                      >
                        <Star size={14} className={model.isDefault ? 'fill-amber-400' : ''} />
                      </button>
                      <button
                        onClick={() => {
                          setEditingModel(model)
                          setShowModelForm(true)
                        }}
                        className="rounded-md p-1.5 text-gray-300 transition-colors hover:text-blue-500 dark:text-gray-600 dark:hover:text-blue-400"
                        title="编辑模型"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => toggleModelVisibility.mutate({ id: model.id, isVisible: !model.isVisible })}
                        className={`rounded-md p-1.5 transition-colors ${model.isVisible ? 'text-gray-300 hover:text-gray-500 dark:text-gray-600' : 'text-gray-300 hover:text-blue-400 dark:text-gray-600'}`}
                        title={model.isVisible ? '隐藏模型' : '显示模型'}
                      >
                        {model.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
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
          initialData={editingModel ?? undefined}
          isEdit={!!editingModel}
          onSubmit={(data) => {
            if (editingModel) {
              updateModel.mutate({ id: editingModel.id, data })
            } else {
              createModel.mutate({ ...data, providerId: selectedProviderId })
            }
          }}
          onCancel={() => { setShowModelForm(false); setEditingModel(null) }}
        />
      )}

      {/* Fetch Models Modal */}
      {showFetchForm && (
        <FetchModelsForm
          providerId={selectedProviderId}
          onAdd={(modelId) => createModel.mutate({ providerId: selectedProviderId, modelId, displayName: modelId, purpose: 'chat' })}
          onCancel={() => setShowFetchForm(false)}
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
      <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-gray-200">添加提供商</h3>
      <div className="space-y-3">
        <Select
          value={providerType}
          onChange={(value) => setProviderType(value as 'openai' | 'anthropic')}
          options={[
            { value: 'openai', label: 'OpenAI' },
            { value: 'anthropic', label: 'Anthropic' },
          ]}
        />
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
  initialData,
  isEdit,
  onSubmit,
  onCancel,
}: {
  initialData?: { modelId: string; displayName: string; purpose: 'chat' | 'embedding'; contextWindow?: number; dimensions?: number; reasoningMode: string; reasoningEffort: string; supportsVision: boolean; supportsReasoning: boolean; supportsTools: boolean; isVisible: boolean; isDefault: boolean }
  isEdit?: boolean
  onSubmit: (data: { modelId: string; displayName: string; purpose: 'chat' | 'embedding'; isDefault: boolean; contextWindow?: number; dimensions?: number; reasoningMode: string; reasoningEffort: string; supportsVision: boolean; supportsReasoning: boolean; supportsTools: boolean; isVisible: boolean }) => void
  onCancel: () => void
}) {
  const [modelId, setModelId] = useState(initialData?.modelId ?? '')
  const [displayName, setDisplayName] = useState(initialData?.displayName ?? '')
  const [purpose, setPurpose] = useState<'chat' | 'embedding'>(initialData?.purpose ?? 'chat')
  const [isDefault, setIsDefault] = useState(initialData?.isDefault ?? false)
  const [contextWindow, setContextWindow] = useState(initialData?.contextWindow?.toString() ?? '')
  const [dimensions, setDimensions] = useState(initialData?.dimensions?.toString() ?? '')
  const [reasoningMode, setReasoningMode] = useState(initialData?.reasoningMode ?? 'none')
  const [reasoningEffort, setReasoningEffort] = useState(initialData?.reasoningEffort ?? 'medium')
  const [supportsVision, setSupportsVision] = useState(initialData?.supportsVision ?? false)
  const [supportsReasoning, setSupportsReasoning] = useState(initialData?.supportsReasoning ?? false)
  const [supportsTools, setSupportsTools] = useState(initialData?.supportsTools ?? false)
  const [isVisible, setIsVisible] = useState(initialData?.isVisible ?? true)

  const isChat = purpose === 'chat'
  const isEmbedding = purpose === 'embedding'

  const handleSubmit = () => {
    onSubmit({
      modelId,
      displayName: displayName || modelId,
      purpose,
      isDefault,
      contextWindow: contextWindow ? parseInt(contextWindow) : undefined,
      dimensions: dimensions ? parseInt(dimensions) : undefined,
      reasoningMode: isChat ? reasoningMode : 'none',
      reasoningEffort: isChat ? reasoningEffort : 'medium',
      supportsVision: isChat ? supportsVision : false,
      supportsReasoning: isChat ? supportsReasoning : false,
      supportsTools: isChat ? supportsTools : false,
      isVisible,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-[460px] max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-200/80 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-[#12151f]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/[0.06]">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">{isEdit ? '编辑模型' : '添加模型'}</h3>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* ── 基础信息 ── */}
          <section className="space-y-3.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">基础信息</h4>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">用途</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPurpose('chat')}
                  className={`flex items-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                    isChat
                      ? 'border-blue-500 bg-blue-50/60 text-blue-700 shadow-sm dark:border-blue-400/60 dark:bg-blue-950/30 dark:text-blue-300'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <Bot size={16} />
                  对话模型
                </button>
                <button
                  type="button"
                  onClick={() => setPurpose('embedding')}
                  className={`flex items-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                    isEmbedding
                      ? 'border-violet-500 bg-violet-50/60 text-violet-700 shadow-sm dark:border-violet-400/60 dark:bg-violet-950/30 dark:text-violet-300'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <Zap size={16} />
                  Embedding 模型
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">模型 ID</label>
              <input
                type="text"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder={isChat ? 'gpt-4o, claude-3-opus, ...' : 'text-embedding-3-small, ...'}
                disabled={isEdit}
                className={`${inputClass} ${isEdit ? 'opacity-60' : ''}`}
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
          </section>

          {/* ── 对话模型专属配置 ── */}
          {isChat && (
            <section className="space-y-3.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">对话配置</h4>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">上下文窗口</label>
                <input
                  type="number"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(e.target.value)}
                  placeholder="如 128000"
                  className={inputClass}
                />
                <p className="text-[11px] text-gray-400 dark:text-gray-500">模型支持的最大 Token 数（可选）</p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">推理模式</label>
                <Select
                  value={reasoningMode}
                  onChange={(value) => setReasoningMode(value)}
                  options={[
                    { value: 'none', label: '不支持推理' },
                    { value: 'tag', label: '标签模式（<thinking> 标签）' },
                    { value: 'native', label: '原生模式（o1 / Claude 等）' },
                  ]}
                />
              </div>
              {reasoningMode !== 'none' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">推理强度</label>
                  <Select
                    value={reasoningEffort}
                    onChange={(value) => setReasoningEffort(value)}
                    options={[
                      { value: 'off', label: '关闭' },
                      { value: 'low', label: '低' },
                      { value: 'medium', label: '中' },
                      { value: 'high', label: '高' },
                    ]}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">AI 能力</label>
                <div className="grid grid-cols-3 gap-2">
                  <label className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-xs font-medium transition-all ${
                    supportsVision
                      ? 'border-sky-400 bg-sky-50/60 text-sky-700 dark:border-sky-500/40 dark:bg-sky-950/20 dark:text-sky-300'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-white/[0.08] dark:text-gray-400'
                  }`}>
                    <input type="checkbox" checked={supportsVision} onChange={(e) => setSupportsVision(e.target.checked)} className="sr-only" />
                    <Sparkles size={18} className={supportsVision ? 'text-sky-500' : 'text-gray-400'} />
                    视觉
                  </label>
                  <label className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-xs font-medium transition-all ${
                    supportsReasoning
                      ? 'border-amber-400 bg-amber-50/60 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-300'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-white/[0.08] dark:text-gray-400'
                  }`}>
                    <input type="checkbox" checked={supportsReasoning} onChange={(e) => setSupportsReasoning(e.target.checked)} className="sr-only" />
                    <Brain size={18} className={supportsReasoning ? 'text-amber-500' : 'text-gray-400'} />
                    推理
                  </label>
                  <label className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-xs font-medium transition-all ${
                    supportsTools
                      ? 'border-emerald-400 bg-emerald-50/60 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/20 dark:text-emerald-300'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-white/[0.08] dark:text-gray-400'
                  }`}>
                    <input type="checkbox" checked={supportsTools} onChange={(e) => setSupportsTools(e.target.checked)} className="sr-only" />
                    <Wrench size={18} className={supportsTools ? 'text-emerald-500' : 'text-gray-400'} />
                    工具
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* ── Embedding 模型专属配置 ── */}
          {isEmbedding && (
            <section className="space-y-3.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Embedding 配置</h4>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">向量维度</label>
                <input
                  type="number"
                  value={dimensions}
                  onChange={(e) => setDimensions(e.target.value)}
                  placeholder="如 1536, 3072"
                  className={inputClass}
                />
                <p className="text-[11px] text-gray-400 dark:text-gray-500">必须与模型实际输出维度一致</p>
              </div>
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
            </section>
          )}

          {/* ── 通用设置 ── */}
          <section className="space-y-3 border-t border-gray-100 pt-4 dark:border-white/[0.06]">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
              />
              设为默认{isChat ? '对话' : 'Embedding'}模型
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={isVisible}
                onChange={(e) => setIsVisible(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
              />
              在 UI 中可见
            </label>
          </section>
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-gray-100 px-6 py-4 dark:border-white/[0.06]">
          <button
            onClick={handleSubmit}
            disabled={!modelId.trim()}
            className="flex-1 rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50"
          >
            {isEdit ? '更新' : '添加'}
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

// ─── Fetch Models Form ───

function FetchModelsForm({
  providerId,
  onAdd,
  onCancel,
}: {
  providerId: string
  onAdd: (modelId: string) => void
  onCancel: () => void
}) {
  const [models, setModels] = useState<RemoteModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useState(() => {
    aiProviderService.fetchModels(providerId)
      .then((data) => {
        setModels(data)
        setLoading(false)
      })
      .catch((err) => {
        setError((err as Error).message)
        setLoading(false)
      })
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-[480px] max-h-[80vh] overflow-y-auto rounded-2xl border border-gray-200/80 bg-white p-6 shadow-2xl dark:border-white/[0.08] dark:bg-[#12151f]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">自动获取模型</h3>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span className="ml-3 text-sm text-gray-500">正在获取模型列表...</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && models.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">未获取到可用模型</p>
        )}

        {!loading && !error && models.length > 0 && (
          <div className="space-y-2">
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">点击「添加」将模型加入配置：</p>
            {models.map((m) => (
              <div
                key={m.modelId}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 transition-colors hover:bg-gray-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{m.modelId}</p>
                  {m.contextWindow && (
                    <p className="text-xs text-gray-400">上下文: {m.contextWindow.toLocaleString()}</p>
                  )}
                </div>
                <button
                  onClick={() => onAdd(m.modelId)}
                  className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-blue-600 active:scale-[0.97]"
                >
                  添加
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-xl border border-gray-200 px-5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
