import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Waypoints, Copy, Check, Route as RouteIcon, Zap, Plus, Trash2, Save,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import Select from '../components/Select'
import { proxyService, type IProxyConfig } from '../services/proxyService'
import { aiProviderService } from '../services/aiProviderService'

const CATEGORIES = [
  { value: 'simple', label: '简单问答' },
  { value: 'complex', label: '复杂推理' },
  { value: 'code', label: '编程代码' },
  { value: 'creative', label: '写作创作' },
  { value: 'math', label: '数学计算' },
  { value: 'default', label: '默认兜底' },
]

interface ModelOption {
  value: string
  label: string
}

/** 单个固定代理配置卡（route 或 shadow） */
function ProxyCard({
  mode,
  title,
  description,
  icon,
  modelOptions,
}: {
  mode: 'route' | 'shadow'
  title: string
  description: string
  icon: React.ReactNode
  modelOptions: ModelOption[]
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<IProxyConfig | null>(null)
  const [copied, setCopied] = useState(false)
  const [dirty, setDirty] = useState(false)

  const { data: configs = [] } = useQuery({ queryKey: ['proxyConfig'], queryFn: proxyService.getAll })
  const server = configs.find((c) => c.mode === mode)

  // 服务端数据加载后初始化表单
  useEffect(() => {
    if (server && !form) {
      setForm({
        ...server,
        routeRules: server.routeRules.length > 0
          ? server.routeRules
          : [{ category: 'default', targetModelKey: '', sortOrder: 0 }],
      })
    }
  }, [server, form])

  const saveMut = useMutation({
    mutationFn: proxyService.save,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxyConfig'] })
      setDirty(false)
    },
  })

  const patch = (p: Partial<IProxyConfig>) => {
    setForm((f) => (f ? { ...f, ...p } : f))
    setDirty(true)
  }

  const copyKey = () => {
    if (!form) return
    navigator.clipboard.writeText(form.modelKey).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!form) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
        <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
      </div>
    )
  }

  const canSave = form.modelKey.trim() &&
    (mode === 'shadow' ? !!form.shadowTargetModelKey : form.routeRules.some((r) => r.targetModelKey))

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${mode === 'route' ? 'bg-violet-50 dark:bg-violet-500/10' : 'bg-blue-50 dark:bg-blue-500/10'}`}>
            {icon}
          </div>
          <div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">{title}</div>
            <div className="mt-0.5 text-xs text-gray-400">{description}</div>
          </div>
        </div>
        <button
          onClick={() => saveMut.mutate(form)}
          disabled={!canSave || !dirty || saveMut.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-blue-600 disabled:opacity-40"
        >
          <Save size={13} />
          {saveMut.isPending ? '保存中...' : dirty ? '保存' : '已保存'}
        </button>
      </div>

      {/* 对外模型 ID */}
      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">对外模型 ID</label>
        <div className="flex items-center gap-2">
          <input
            value={form.modelKey}
            onChange={(e) => patch({ modelKey: e.target.value })}
            className="w-64 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm outline-none focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-900"
          />
          <button onClick={copyKey} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]" title="复制">
            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          </button>
          <span className="text-[11px] text-gray-400">客户端请求的 model 填这个值</span>
        </div>
      </div>

      {/* 影子模式：目标模型 */}
      {mode === 'shadow' && (
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">代理到的目标模型</label>
          <Select
            value={form.shadowTargetModelKey ?? ''}
            onChange={(v) => patch({ shadowTargetModelKey: v })}
            options={modelOptions}
            placeholder="选择模型"
            searchable
          />
          <p className="mt-1 text-[11px] text-gray-400">所有请求都转发到这一个模型，可在应用上随时切换</p>
        </div>
      )}

      {/* 路由模式：分类模型 + 规则 */}
      {mode === 'route' && (
        <>
          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">分类模型（可选）</label>
            <Select
              value={form.routeClassifierModelKey ?? ''}
              onChange={(v) => patch({ routeClassifierModelKey: v })}
              options={[{ value: '', label: '不使用（纯规则启发）' }, ...modelOptions]}
              placeholder="用于判断问题类型的模型"
              searchable
            />
            <p className="mt-1 text-[11px] text-gray-400">不配置则用内置规则启发式分类</p>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300">路由规则</label>
              <button
                onClick={() => patch({ routeRules: [...form.routeRules, { category: 'simple', targetModelKey: '', sortOrder: form.routeRules.length }] })}
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
              >
                <Plus size={12} /> 加规则
              </button>
            </div>
            <div className="space-y-2">
              {form.routeRules.map((rule, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="w-28 shrink-0">
                    <Select
                      value={rule.category}
                      onChange={(v) => patch({ routeRules: form.routeRules.map((r, i) => (i === idx ? { ...r, category: v } : r)) })}
                      options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                    />
                  </div>
                  <span className="text-gray-400">→</span>
                  <div className="min-w-0 flex-1">
                    <Select
                      value={rule.targetModelKey}
                      onChange={(v) => patch({ routeRules: form.routeRules.map((r, i) => (i === idx ? { ...r, targetModelKey: v } : r)) })}
                      options={modelOptions}
                      placeholder="目标模型"
                      searchable
                    />
                  </div>
                  <button
                    onClick={() => patch({ routeRules: form.routeRules.filter((_, i) => i !== idx) })}
                    className="shrink-0 rounded p-1 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function ProxyPage() {
  const { data: providers = [] } = useQuery({ queryKey: ['aiProviders'], queryFn: aiProviderService.getAll })

  // 所有可选 chat 模型（复合键 providerId:modelId，带供应商前缀区分同名）
  const modelOptions = useMemo(() => {
    const opts: ModelOption[] = []
    for (const p of providers) {
      if (!p.isEnabled) continue
      for (const m of p.models) {
        if (m.purpose !== 'chat') continue
        opts.push({ value: `${p.id}:${m.modelId}`, label: `${p.name} / ${m.displayName || m.modelId}` })
      }
    }
    return opts
  }, [providers])

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <div className="mb-6">
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                <Waypoints size={22} className="text-blue-500" />
                代理服务
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                对外暴露统一的模型 ID，把请求代理到配置的真实模型
              </p>
            </div>

            <div className="space-y-5">
              <ProxyCard
                mode="shadow"
                title="影子代理"
                description="固定代理到一个模型，应用侧只需配置这一个模型 ID"
                icon={<Zap size={18} className="text-blue-500" />}
                modelOptions={modelOptions}
              />
              <ProxyCard
                mode="route"
                title="路由代理"
                description="按问题类型智能分发到不同能力的模型"
                icon={<RouteIcon size={18} className="text-violet-500" />}
                modelOptions={modelOptions}
              />
            </div>
          </div>
        </div>
      }
    />
  )
}
