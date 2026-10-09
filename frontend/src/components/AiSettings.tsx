import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Star, Bot, X, Download, Eye, EyeOff, Sparkles, Wrench, Brain, Pencil, Zap, Search } from 'lucide-react'
import { aiProviderService, aiModelService, aiModelCatalogService } from '../services/aiProviderService'
import type { RemoteModelInfo, CatalogModelInfo, CatalogProviderInfo } from '../services/aiProviderService'
import Select from './Select'

const inputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20'

/** 现代 LLM 常见的推理强度等级（models.dev reasoning_options: effort） */
const DEFAULT_EFFORT_VALUES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function effortLabel(value: string): string {
  switch (value) {
    case 'off':
    case 'none':
      return '关闭'
    case 'minimal':
      return '最低'
    case 'low':
      return '低'
    case 'medium':
      return '中'
    case 'high':
      return '高'
    case 'xhigh':
      return '超高'
    case 'max':
      return '最大'
    default:
      return /^\d+$/.test(value) ? `${value} tokens` : value
  }
}

/** models.dev 供应商一次性批量导入的模型数量上限 */
const CATALOG_IMPORT_LIMIT = 40

/** 从模型目录条目推导默认推理强度：优先取目录声明的 effort 值，其次按预算下限。 */
function catalogDefaultEffort(model: CatalogModelInfo): string {
  if (model.reasoningEffortValues.includes('medium')) return 'medium'
  if (model.reasoningEffortValues.length > 0) {
    const middle = model.reasoningEffortValues[Math.floor(model.reasoningEffortValues.length / 2)]
    return middle
  }
  if (model.reasoningBudgetMin) return 'medium'
  return 'medium'
}

/** 从模型目录条目生成模型创建请求（保留可编辑，用户仍可手动调整）。 */
function catalogToModelRequest(providerId: string, model: CatalogModelInfo) {
  // models.dev 的 reasoning_options.effort：随模型一起存下来，对话/Code 的强度选择器据此渲染
  const efforts = model.reasoningEffortValues.join(',')
  if (!model.reasoning) {
    return {
      providerId,
      modelId: model.modelId,
      displayName: model.name || model.modelId,
      purpose: 'chat' as const,
      reasoningMode: 'none',
      reasoningEffort: 'medium',
    }
  }
  return {
    providerId,
    modelId: model.modelId,
    displayName: model.name || model.modelId,
    purpose: 'chat' as const,
    contextWindow: model.contextWindow,
    reasoningMode: 'native',
    reasoningEffort: catalogDefaultEffort(model),
    reasoningEfforts: efforts.length > 0 ? efforts : undefined,
    reasoningBudgetTokens: model.reasoningBudgetMin ?? undefined,
    supportsVision: model.supportsVision,
    supportsReasoning: true,
    supportsTools: model.supportsTools,
  }
}

/** 按模型 ID 精确检索模型目录，用于供应商自动获取模型时补齐能力配置。 */
async function lookupCatalogModel(modelId: string): Promise<CatalogModelInfo | null> {
  try {
    const results = await aiModelCatalogService.search(modelId, 10)
    return results.find((m) => m.modelId === modelId) ?? null
  } catch {
    return null
  }
}

export default function AiSettings() {
  const queryClient = useQueryClient()
  const [showProviderForm, setShowProviderForm] = useState(false)
  const [showModelForm, setShowModelForm] = useState(false)
  const [showFetchForm, setShowFetchForm] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [editingModel, setEditingModel] = useState<{ id: string; modelId: string; displayName: string; purpose: 'chat' | 'embedding'; contextWindow?: number; dimensions?: number; reasoningMode: string; reasoningEffort: string; reasoningEfforts?: string; reasoningBudgetTokens?: number; supportsVision: boolean; supportsReasoning: boolean; supportsTools: boolean; isVisible: boolean; isDefault: boolean } | null>(null)

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

  const createModelBatch = useMutation({
    mutationFn: aiModelService.createBatch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
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
          onSubmit={async (data) => {
            // 从 models.dev 选择供应商时：保存供应商后按其目录批量导入模型，用户只需提供 Key
            const created = await createProvider.mutateAsync({
              providerType: data.providerType,
              name: data.name.trim(),
              apiKey: data.apiKey,
              baseUrl: data.baseUrl,
            })
            if (data.catalogProviderId && data.importModels && created?.id) {
              try {
                const detail = await aiModelCatalogService.provider(data.catalogProviderId)
                const chatModels = (detail?.models ?? [])
                  .filter((m) => !/embed/i.test(m.modelId))
                  .slice(0, CATALOG_IMPORT_LIMIT)
                if (chatModels.length > 0) {
                  await createModelBatch.mutateAsync(
                    chatModels.map((m) => catalogToModelRequest(created.id, m))
                  )
                }
              } catch {
                // 目录导入失败不影响供应商本身创建成功
              }
            }
          }}
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
                          {model.reasoningMode === 'native' ? '原生推理' : '标签推理'} · {effortLabel(model.reasoningEffort)}
                          {model.reasoningBudgetTokens ? ` (${model.reasoningBudgetTokens})` : ''}
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
          onAdd={async (modelId) => {
            const catalogModel = await lookupCatalogModel(modelId)
            if (catalogModel) {
              createModel.mutate(catalogToModelRequest(selectedProviderId, catalogModel))
            } else {
              createModel.mutate({ providerId: selectedProviderId, modelId, displayName: modelId, purpose: 'chat' })
            }
          }}
          onAddBatch={(models) => {
            createModelBatch.mutate(models.map((m) => catalogToModelRequest(selectedProviderId, m)))
          }}
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
  onSubmit: (data: {
    providerType: 'openai' | 'anthropic'
    name: string
    apiKey: string
    baseUrl?: string
    /** 选中的 models.dev 供应商 ID（用于创建后批量导入其模型） */
    catalogProviderId?: string
    importModels?: boolean
  }) => void
  onCancel: () => void
}) {
  const [providerType, setProviderType] = useState<'openai' | 'anthropic'>('openai')
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  // models.dev 供应商目录：选中后仅需填写 API Key
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogResults, setCatalogResults] = useState<CatalogProviderInfo[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogProvider, setCatalogProvider] = useState<CatalogProviderInfo | null>(null)
  const [importModels, setImportModels] = useState(true)

  useEffect(() => {
    const q = catalogQuery.trim()
    if (q.length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      setCatalogLoading(true)
      aiModelCatalogService
        .searchProviders(q, 15)
        .then((data) => {
          if (!cancelled) setCatalogResults(data)
        })
        .catch(() => {
          if (!cancelled) setCatalogResults([])
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [catalogQuery])

  const applyCatalogProvider = (provider: CatalogProviderInfo) => {
    const isAnthropic = provider.npm === '@ai-sdk/anthropic'
    setProviderType(isAnthropic ? 'anthropic' : 'openai')
    setName(provider.name)
    setBaseUrl(provider.api ?? '')
    setCatalogProvider(provider)
    setCatalogResults([])
    setCatalogQuery('')
  }

  return (
    <div className="rounded-xl border border-blue-200/60 bg-blue-50/30 p-5 dark:border-blue-500/20 dark:bg-blue-950/10">
      <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-gray-200">添加提供商</h3>
      <div className="space-y-3">
        {/* 供应商目录：选中后只需填 API Key */}
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder="从 models.dev 选择供应商，如 deepseek / moonshot / zhipu"
            className={`${inputClass} pl-9`}
          />
          {!catalogProvider && catalogQuery.trim().length >= 2 && (catalogLoading || catalogResults.length > 0) && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/[0.08] dark:bg-[#12151f]">
              {catalogLoading && <p className="px-3 py-2 text-[11px] text-gray-400">正在检索供应商目录...</p>}
              {!catalogLoading &&
                catalogResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyCatalogProvider(p)}
                    className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                  >
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.name}</span>
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{p.id}</span>
                    <span className="ml-2 text-[11px] text-gray-400 dark:text-gray-500">{p.modelCount} 个模型</span>
                    {p.api && <span className="ml-2 text-[11px] text-gray-400 dark:text-gray-500">{p.api}</span>}
                  </button>
                ))}
            </div>
          )}
        </div>
        {catalogProvider && (
          <div className="rounded-lg border border-gray-200 bg-white/60 px-3 py-2 text-[11px] text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-400">
            已选择目录供应商，名称与 Base URL 自动填充
            {!catalogProvider.api && '（目录未提供 Base URL，请手动填写）'}
            {catalogProvider.env && <span className="ml-1">· Key 对应环境变量 {catalogProvider.env}</span>}
            <button
              type="button"
              onClick={() => {
                setCatalogProvider(null)
                setImportModels(false)
                setName('')
                setBaseUrl('')
              }}
              className="ml-2 text-blue-500 hover:underline dark:text-blue-400"
            >
              清除
            </button>
          </div>
        )}

        <Select
          value={providerType}
          onChange={(value) => setProviderType(value as 'openai' | 'anthropic')}
          options={[
            { value: 'openai', label: 'OpenAI 兼容' },
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
          placeholder={catalogProvider?.env ?? 'API Key'}
          className={inputClass}
        />
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="Base URL（可选，默认官方地址）"
          className={inputClass}
        />
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onSubmit({
              providerType,
              name,
              apiKey,
              baseUrl: baseUrl || undefined,
              catalogProviderId: catalogProvider?.id,
              importModels: importModels && !!catalogProvider,
            })}
            disabled={!name.trim()}
            className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50"
          >
            {catalogProvider && importModels ? '保存并导入模型' : '保存'}
          </button>
          <button
            onClick={onCancel}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
          >
            取消
          </button>
        </div>
        {catalogProvider && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={importModels}
              onChange={(e) => setImportModels(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
            />
            同时导入该供应商模型（{Math.min(catalogProvider.modelCount, CATALOG_IMPORT_LIMIT)} 个，能力配置自动填充）
          </label>
        )}
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
  initialData?: { modelId: string; displayName: string; purpose: 'chat' | 'embedding'; contextWindow?: number; dimensions?: number; reasoningMode: string; reasoningEffort: string; reasoningEfforts?: string; reasoningBudgetTokens?: number; supportsVision: boolean; supportsReasoning: boolean; supportsTools: boolean; isVisible: boolean; isDefault: boolean }
  isEdit?: boolean
  onSubmit: (data: { modelId: string; displayName: string; purpose: 'chat' | 'embedding'; isDefault: boolean; contextWindow?: number; dimensions?: number; reasoningMode: string; reasoningEffort: string; reasoningEfforts?: string; reasoningBudgetTokens?: number; supportsVision: boolean; supportsReasoning: boolean; supportsTools: boolean; isVisible: boolean }) => void
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
  const [reasoningBudgetTokens, setReasoningBudgetTokens] = useState(initialData?.reasoningBudgetTokens?.toString() ?? '')
  const [customEffort, setCustomEffort] = useState(() => !!initialData && !DEFAULT_EFFORT_VALUES.includes(initialData.reasoningEffort))
  const [catalogEffortValues, setCatalogEffortValues] = useState<string[]>(() =>
    (initialData?.reasoningEfforts ?? '')
      .split(/[,;，；\s]+/)
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0),
  )
  const [catalogBudgetMin, setCatalogBudgetMin] = useState<number | null>(null)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogResults, setCatalogResults] = useState<CatalogModelInfo[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [supportsVision, setSupportsVision] = useState(initialData?.supportsVision ?? false)
  const [supportsReasoning, setSupportsReasoning] = useState(initialData?.supportsReasoning ?? false)
  const [supportsTools, setSupportsTools] = useState(initialData?.supportsTools ?? false)
  const [isVisible, setIsVisible] = useState(initialData?.isVisible ?? true)

  const isChat = purpose === 'chat'
  const isEmbedding = purpose === 'embedding'

  // 编辑已有模型且未存过档位时：自动从 models.dev 拉一次，补齐档位候选（仍需保存才落库）
  useEffect(() => {
    const modelId = initialData?.modelId
    if (!modelId || initialData?.reasoningEfforts) return
    let cancelled = false
    lookupCatalogModel(modelId)
      .then((model) => {
        if (cancelled || !model) return
        if (model.reasoningEffortValues.length > 0) setCatalogEffortValues(model.reasoningEffortValues)
        if (model.reasoningBudgetMin) setCatalogBudgetMin(model.reasoningBudgetMin)
      })
      .catch(() => { /* 目录不可用时保持内置三档 */ })
    return () => { cancelled = true }
    // 仅在打开表单时执行一次：按模型 ID 去重
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData?.modelId])

  // models.dev 模型目录检索（防抖 350ms，关键词至少 2 个字符）
  useEffect(() => {
    const q = catalogQuery.trim()
    if (q.length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      setCatalogLoading(true)
      aiModelCatalogService
        .search(q, 20)
        .then((data) => {
          if (cancelled) return
          setCatalogResults(data)
          setCatalogError(null)
        })
        .catch((err) => {
          if (!cancelled) setCatalogError((err as Error).message)
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [catalogQuery])

  // 选择目录模型后自动填充配置，用户仍可在此基础上手动修改
  const applyCatalogModel = (model: CatalogModelInfo) => {
    setModelId(model.modelId)
    setDisplayName(model.name || model.modelId)
    if (model.contextWindow) setContextWindow(String(model.contextWindow))
    setSupportsVision(model.supportsVision)
    setSupportsTools(model.supportsTools)
    setSupportsReasoning(model.reasoning)
    setCatalogEffortValues(model.reasoningEffortValues)
    setCatalogBudgetMin(model.reasoningBudgetMin ?? null)
    if (model.reasoning) {
      setReasoningMode('native')
      setReasoningEffort(catalogDefaultEffort(model))
      setReasoningBudgetTokens(model.reasoningBudgetMin ? String(Math.max(model.reasoningBudgetMin, 16384)) : '')
      setCustomEffort(false)
    } else {
      setReasoningMode('none')
      setReasoningEffort('medium')
      setReasoningBudgetTokens('')
    }
    setCatalogResults([])
    setCatalogQuery('')
  }

  const effortOptions = catalogEffortValues.length > 0 ? catalogEffortValues : DEFAULT_EFFORT_VALUES
  const effortInOptions = effortOptions.includes(reasoningEffort)
  const catalogActive = catalogQuery.trim().length >= 2

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
      // 档位列表随模型保存：来自 models.dev 的用目录值，否则存当前可选集合（对话/Code 选择器据此渲染）
      reasoningEfforts: isChat && reasoningMode !== 'none' ? effortOptions.join(',') : undefined,
      reasoningBudgetTokens: isChat && reasoningBudgetTokens.trim() ? parseInt(reasoningBudgetTokens) : undefined,
      supportsVision: isChat ? supportsVision : false,
      supportsReasoning: isChat ? supportsReasoning : false,
      supportsTools: isChat ? supportsTools : false,
      isVisible,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-[560px] max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-200/80 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-[#12151f]"
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
          {/* ── 模型目录（models.dev） ── */}
          {!isEdit && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">从模型目录选择</h4>
                <a
                  href="https://models.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-blue-500 hover:underline dark:text-blue-400"
                >
                  models.dev
                </a>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="搜索模型，如 gpt-5 / claude / deepseek / glm / kimi"
                  className={`${inputClass} pl-9`}
                />
              </div>
              {catalogQuery.trim().length === 1 && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500">至少输入 2 个字符</p>
              )}
              {catalogActive && catalogLoading && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500">正在检索模型目录...</p>
              )}
              {catalogActive && catalogError && (
                <p className="text-[11px] text-red-500">{catalogError}</p>
              )}
              {catalogActive && !catalogLoading && !catalogError && catalogResults.length === 0 && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500">未找到匹配模型，仍可手动填写</p>
              )}
              {catalogActive && catalogResults.length > 0 && (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-1.5 dark:border-white/[0.06]">
                  {catalogResults.map((m) => (
                    <button
                      key={`${m.providerId}/${m.modelId}`}
                      type="button"
                      onClick={() => applyCatalogModel(m)}
                      className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{m.name || m.modelId}</span>
                        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{m.modelId}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                        <span className="shrink-0">{m.providerName}</span>
                        {m.reasoning && (
                          <span className="inline-flex shrink-0 items-center rounded bg-amber-50 px-1 py-px text-[10px] font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                            推理{m.reasoningEffortValues.length > 0 ? `: ${m.reasoningEffortValues.map(effortLabel).join('/')}` : m.reasoningBudgetMin ? `: ≥${m.reasoningBudgetMin} tokens` : ''}
                          </span>
                        )}
                        {m.supportsVision && (
                          <span className="inline-flex shrink-0 items-center rounded bg-sky-50 px-1 py-px text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">视觉</span>
                        )}
                        {m.supportsTools && (
                          <span className="inline-flex shrink-0 items-center rounded bg-emerald-50 px-1 py-px text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">工具</span>
                        )}
                        {m.contextWindow ? <span className="shrink-0">{(m.contextWindow / 1024).toLocaleString()}K 上下文</span> : null}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

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
                    value={effortInOptions && !customEffort ? reasoningEffort : '__custom__'}
                    onChange={(value) => {
                      if (value === '__custom__') {
                        setCustomEffort(true)
                        return
                      }
                      setCustomEffort(false)
                      setReasoningEffort(value)
                    }}
                    options={[
                      ...effortOptions.map((value) => ({ value, label: effortLabel(value) })),
                      { value: '__custom__', label: '自定义值…' },
                    ]}
                  />
                  {customEffort && (
                    <input
                      type="text"
                      value={reasoningEffort}
                      onChange={(e) => setReasoningEffort(e.target.value)}
                      placeholder="自定义强度，如 minimal / xhigh / max 或数字 Token 预算"
                      className={inputClass}
                    />
                  )}
                  {catalogEffortValues.length > 0 && (
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">
                      选项来自模型目录声明：{catalogEffortValues.map(effortLabel).join(' / ')}
                    </p>
                  )}
                </div>
              )}
              {reasoningMode !== 'none' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">推理 Token 预算（可选）</label>
                  <input
                    type="number"
                    value={reasoningBudgetTokens}
                    onChange={(e) => setReasoningBudgetTokens(e.target.value)}
                    placeholder={catalogBudgetMin ? `如 ${catalogBudgetMin}（Claude budget_tokens）` : '如 4096（Claude budget_tokens）'}
                    className={inputClass}
                  />
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    留空按推理强度自动换算；Anthropic 最小 1024，且需小于最大输出 Token
                  </p>
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
  onAddBatch,
  onCancel,
}: {
  providerId: string
  onAdd: (modelId: string) => void
  /** 从模型目录批量导入（自动填充能力配置） */
  onAddBatch?: (models: CatalogModelInfo[]) => void
  onCancel: () => void
}) {
  const [models, setModels] = useState<RemoteModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 模型目录（models.dev）批量导入
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogResults, setCatalogResults] = useState<CatalogModelInfo[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    aiProviderService
      .fetchModels(providerId)
      .then((data) => {
        if (!cancelled) setModels(data)
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId])

  useEffect(() => {
    const q = catalogQuery.trim()
    if (q.length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      setCatalogLoading(true)
      aiModelCatalogService
        .search(q, 30)
        .then((data) => {
          if (!cancelled) setCatalogResults(data)
        })
        .catch(() => {
          if (!cancelled) setCatalogResults([])
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [catalogQuery])

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedModels = catalogResults.filter((m) => selected.has(`${m.providerId}/${m.modelId}`))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto rounded-2xl border border-gray-200/80 bg-white p-6 shadow-2xl dark:border-white/[0.08] dark:bg-[#12151f]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">自动获取模型</h3>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]">
            <X size={16} />
          </button>
        </div>

        {/* 模型目录批量导入 */}
        {onAddBatch && (
          <section className="mb-5 space-y-2 border-b border-gray-100 pb-5 dark:border-white/[0.06]">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">从模型目录批量导入</h4>
              <a href="https://models.dev" target="_blank" rel="noreferrer" className="text-[11px] text-blue-500 hover:underline dark:text-blue-400">
                models.dev
              </a>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="搜索模型，如 deepseek / glm / kimi / qwen"
                className={`${inputClass} pl-9`}
              />
            </div>
            {catalogQuery.trim().length >= 2 && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                {catalogLoading ? '正在检索模型目录...' : catalogResults.length > 0 ? `匹配 ${catalogResults.length} 个模型，能力配置自动填充` : '未找到匹配模型'}
              </p>
            )}
            {catalogResults.length > 0 && (
              <>
                <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-1.5 dark:border-white/[0.06]">
                  {catalogResults.map((m) => {
                    const key = `${m.providerId}/${m.modelId}`
                    const checked = selected.has(key)
                    return (
                      <label
                        key={key}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${checked ? 'bg-blue-50/60 dark:bg-blue-950/20' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelected(key)}
                          className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">{m.name || m.modelId}</span>
                        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{m.providerName}</span>
                        {m.reasoning && (
                          <span className="shrink-0 rounded bg-amber-50 px-1 py-px text-[10px] font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">推理</span>
                        )}
                        {m.supportsVision && (
                          <span className="shrink-0 rounded bg-sky-50 px-1 py-px text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">视觉</span>
                        )}
                        {m.supportsTools && (
                          <span className="shrink-0 rounded bg-emerald-50 px-1 py-px text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">工具</span>
                        )}
                        {m.contextWindow ? <span className="shrink-0 text-[11px] text-gray-400">{(m.contextWindow / 1024).toLocaleString()}K</span> : null}
                      </label>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelected(new Set(catalogResults.map((m) => `${m.providerId}/${m.modelId}`)))}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
                  >
                    全选
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
                  >
                    清空
                  </button>
                  <button
                    onClick={() => {
                      onAddBatch(selectedModels)
                      setSelected(new Set())
                      setCatalogQuery('')
                      setCatalogResults([])
                    }}
                    disabled={selectedModels.length === 0}
                    className="ml-auto rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-blue-600 active:scale-[0.97] disabled:opacity-50"
                  >
                    导入所选（{selectedModels.length}）
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">供应商接口返回</h4>
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
