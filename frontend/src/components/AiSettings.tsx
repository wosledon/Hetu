import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Star } from 'lucide-react'
import { aiProviderService, aiModelService } from '../services/aiProviderService'

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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">AI Provider</h2>
        <button
          onClick={() => setShowProviderForm(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md"
        >
          <Plus size={14} /> 添加 Provider
        </button>
      </div>

      {showProviderForm && (
        <ProviderForm
          onSubmit={(data) => createProvider.mutate(data)}
          onCancel={() => setShowProviderForm(false)}
        />
      )}

      {providers.map((provider) => (
        <div key={provider.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-medium">{provider.name}</h3>
              <p className="text-sm text-gray-500">{provider.providerType} · {provider.isEnabled ? '启用' : '禁用'}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedProviderId(provider.id)
                  setShowModelForm(true)
                }}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                title="添加模型"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => deleteProvider.mutate(provider.id)}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {provider.models.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded"
              >
                <div>
                  <span className="text-sm font-medium">{model.displayName}</span>
                  <span className="text-xs text-gray-500 ml-2">{model.modelId} · {model.purpose}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDefaultModel.mutate(model.id)}
                    className={`p-1 rounded ${model.isDefault ? 'text-amber-400' : 'text-gray-400 hover:text-amber-400'}`}
                    title={model.isDefault ? '默认模型' : '设为默认'}
                  >
                    <Star size={14} className={model.isDefault ? 'fill-amber-400' : ''} />
                  </button>
                  <button
                    onClick={() => deleteModel.mutate(model.id)}
                    className="p-1 rounded text-gray-400 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {showModelForm && (
        <ModelForm
          onSubmit={(data) => createModel.mutate({ ...data, providerId: selectedProviderId })}
          onCancel={() => setShowModelForm(false)}
        />
      )}
    </div>
  )
}

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
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
      <select
        value={providerType}
        onChange={(e) => setProviderType(e.target.value as 'openai' | 'anthropic')}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
      >
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="名称"
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
      />
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="API Key"
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
      />
      <input
        type="text"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="Base URL（可选，默认 OpenAI 官方）"
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSubmit({ providerType, name, apiKey, baseUrl: baseUrl || undefined })}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md"
        >
          保存
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md"
        >
          取消
        </button>
      </div>
    </div>
  )
}

function ModelForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { modelId: string; displayName: string; purpose: 'chat' | 'embedding' | 'completion'; isDefault: boolean; contextWindow?: number; dimensions?: number }) => void
  onCancel: () => void
}) {
  const [modelId, setModelId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [purpose, setPurpose] = useState<'chat' | 'embedding' | 'completion'>('chat')
  const [isDefault, setIsDefault] = useState(false)
  const [contextWindow, setContextWindow] = useState('')
  const [dimensions, setDimensions] = useState('')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-96 space-y-3">
        <h3 className="font-medium">添加模型</h3>
        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="模型 ID（如 gpt-4o）"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
        />
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="显示名称"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
        />
        <select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as 'chat' | 'embedding' | 'completion')}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
        >
          <option value="chat">对话</option>
          <option value="embedding">Embedding</option>
          <option value="completion">补全</option>
        </select>
        <input
          type="number"
          value={contextWindow}
          onChange={(e) => setContextWindow(e.target.value)}
          placeholder="上下文窗口（可选）"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
        />
        <input
          type="number"
          value={dimensions}
          onChange={(e) => setDimensions(e.target.value)}
          placeholder="向量维度（Embedding 模型专用，如 1536）"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          设为默认
        </label>
        <div className="flex gap-2">
          <button
            onClick={() =>
              onSubmit({
                modelId,
                displayName: displayName || modelId,
                purpose,
                isDefault,
                contextWindow: contextWindow ? parseInt(contextWindow) : undefined,
                dimensions: dimensions ? parseInt(dimensions) : undefined,
              })
            }
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md"
          >
            保存
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
