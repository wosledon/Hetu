import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Waypoints, Copy, Check, Route as RouteIcon, Zap, Plus, Trash2, Globe, Braces,
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

/** 复制按钮（带反馈） */
function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
        copied
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-gray-400 hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-300'
      }`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? '已复制' : label ?? '复制'}
    </button>
  )
}

/** 单张代理配置卡 */
function ProxyCard({
  mode,
  modelOptions,
}: {
  mode: 'route' | 'shadow'
  modelOptions: ModelOption[]
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<IProxyConfig | null>(null)
  const [dirty, setDirty] = useState(false)

  const { data: configs = [] } = useQuery({ queryKey: ['proxyConfig'], queryFn: proxyService.getAll })
  const server = configs.find((c) => c.mode === mode)

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

  if (!form) {
    return <div className="py-16 text-center text-sm text-gray-400">加载中...</div>
  }

  const canSave = form.modelKey.trim() &&
    (mode === 'shadow' ? !!form.shadowTargetModelKey : form.routeRules.some((r) => r.targetModelKey))

  return (
    <div className="space-y-6">
      {/* 对外模型 ID */}
      <section>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">对外模型 ID</label>
          <span className="text-[11px] text-gray-400">客户端请求时的 model 参数</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <Braces size={14} className="shrink-0 text-gray-400" />
          <input
            value={form.modelKey}
            onChange={(e) => patch({ modelKey: e.target.value })}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-gray-800 outline-none dark:text-gray-100"
          />
          <CopyBtn text={form.modelKey} />
        </div>
      </section>

      {/* 影子模式：目标模型 */}
      {mode === 'shadow' && (
        <section>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">代理到的目标模型</label>
            <span className="text-[11px] text-gray-400">所有请求统一转发到它</span>
          </div>
          <Select
            value={form.shadowTargetModelKey ?? ''}
            onChange={(v) => patch({ shadowTargetModelKey: v })}
            options={modelOptions}
            placeholder="选择模型"
            searchable
          />
        </section>
      )}

      {/* 路由模式 */}
      {mode === 'route' && (
        <>
          <section>
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">分类模型</label>
              <span className="text-[11px] text-gray-400">可选，留空走规则启发</span>
            </div>
            <Select
              value={form.routeClassifierModelKey ?? ''}
              onChange={(v) => patch({ routeClassifierModelKey: v })}
              options={[{ value: '', label: '不使用（纯规则启发）' }, ...modelOptions]}
              placeholder="用于判断问题类型的模型"
              searchable
            />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">路由规则</label>
              <button
                onClick={() => patch({ routeRules: [...form.routeRules, { category: 'simple', targetModelKey: '', sortOrder: form.routeRules.length }] })}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10"
              >
                <Plus size={13} /> 加规则
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.08]">
              {form.routeRules.map((rule, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2.5 px-3 py-2.5 ${idx > 0 ? 'border-t border-gray-100 dark:border-white/[0.06]' : ''} bg-white dark:bg-transparent`}
                >
                  <div className="w-28 shrink-0">
                    <Select
                      value={rule.category}
                      onChange={(v) => patch({ routeRules: form.routeRules.map((r, i) => (i === idx ? { ...r, category: v } : r)) })}
                      options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                    />
                  </div>
                  <span className="shrink-0 text-gray-300 dark:text-gray-600">→</span>
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
                    className="shrink-0 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-600 dark:hover:bg-red-500/10"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">按问题类型匹配第一条规则，都不命中走「默认兜底」</p>
          </section>
        </>
      )}

      {/* 保存栏 */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-4 dark:border-white/[0.06]">
        <span className="text-[11px] text-gray-400">
          {dirty ? '有未保存的修改' : '配置已是最新'}
        </span>
        <button
          onClick={() => saveMut.mutate(form)}
          disabled={!canSave || !dirty || saveMut.isPending}
          className="rounded-xl bg-blue-500 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {saveMut.isPending ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  )
}

export default function ProxyPage() {
  const [tab, setTab] = useState<'shadow' | 'route'>('shadow')
  const { data: providers = [] } = useQuery({ queryKey: ['aiProviders'], queryFn: aiProviderService.getAll })

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

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const endpoints = [
    { label: 'OpenAI 兼容', value: `${origin}/v1/chat/completions` },
    { label: 'Anthropic 兼容', value: `${origin}/v1/anthropic/messages` },
  ]

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-8">
            {/* 标题 */}
            <div className="mb-6">
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                <Waypoints size={22} className="text-blue-500" />
                代理服务
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                对外暴露统一模型 ID，把请求代理到配置的真实模型
              </p>
            </div>

            {/* 接入信息 */}
            <div className="mb-6 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
              <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                <Globe size={13} className="text-blue-500" />
                接入地址
              </div>
              <div className="space-y-1.5">
                {endpoints.map((e) => (
                  <div key={e.label} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-white/[0.04]">
                    <span className="w-24 shrink-0 text-[11px] text-gray-400">{e.label}</span>
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700 dark:text-gray-300">{e.value}</code>
                    <CopyBtn text={e.value} />
                  </div>
                ))}
              </div>
            </div>

            {/* Tab 切换 */}
            <div className="mb-5 flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/[0.06]">
              {([
                { key: 'shadow', label: '影子代理', desc: '固定代理到一个模型', icon: Zap },
                { key: 'route', label: '路由代理', desc: '按问题类型智能分发', icon: RouteIcon },
              ] as const).map((t) => {
                const Icon = t.icon
                const active = tab === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                      active
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-gray-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    <Icon size={15} className={active ? (t.key === 'route' ? 'text-violet-500' : 'text-blue-500') : ''} />
                    <span>{t.label}</span>
                    <span className={`hidden text-[11px] sm:inline ${active ? 'text-gray-400' : 'text-gray-400/70'}`}>{t.desc}</span>
                  </button>
                )
              })}
            </div>

            {/* 配置卡 */}
            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
              <ProxyCard key={tab} mode={tab} modelOptions={modelOptions} />
            </div>
          </div>
        </div>
      }
    />
  )
}
